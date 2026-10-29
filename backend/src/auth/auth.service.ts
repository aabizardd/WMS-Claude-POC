import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { buildName, cleanEmployeeId, uniqueViolation } from '../users/users.service';
import { LoginThrottleService } from './login-throttle.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private loginThrottle: LoginThrottleService,
  ) {}

  private roleInclude = {
    role: { include: { permissions: { include: { permission: true } } } },
    warehouses: { select: { warehouseId: true } },
  };

  private permissionKeys(user: {
    role: { permissions: { permission: { key: string } }[] };
  }) {
    return user.role.permissions.map((rp) => rp.permission.key);
  }

  async login(dto: LoginDto, ip = 'unknown') {
    // Reject early if the account is under a temporary lock (too many recent
    // failed attempts). Uses HTTP 429 so clients can distinguish it.
    const lockRemaining = this.loginThrottle.getLockRemainingSeconds(
      dto.username,
    );
    if (lockRemaining !== null) {
      throw new HttpException(
        `Too many failed login attempts. Try again in ${lockRemaining}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: this.roleInclude,
    });

    if (!user || !user.isActive) {
      this.loginThrottle.recordFailure(dto.username, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      this.loginThrottle.recordFailure(dto.username, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful auth → clear the failure counter for this account.
    this.loginThrottle.recordSuccess(dto.username);

    // Right credentials, but the user's role has been set inactive.
    if (!user.role.isActive) {
      throw new UnauthorizedException(
        `Your role "${user.role.name}" is inactive. Contact an administrator.`,
      );
    }

    const permissions = this.permissionKeys(user);

    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role.name,
      permissions,
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role.name,
        permissions,
        warehouseIds: user.warehouses.map((w) => w.warehouseId),
      },
    };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: this.roleInclude,
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role.name,
      permissions: this.permissionKeys(user),
      warehouseIds: user.warehouses.map((w) => w.warehouseId),
    };
  }

  // ---------- own profile ----------

  private readonly profileSelect = {
    id: true,
    name: true,
    firstName: true,
    lastName: true,
    username: true,
    email: true,
    employeeId: true,
    role: { select: { name: true } },
    warehouses: {
      select: { warehouse: { select: { name: true } } },
      orderBy: { warehouse: { name: 'asc' } },
    },
    department: { select: { name: true } },
    subsidiary: { select: { name: true } },
    updatedAt: true,
  } satisfies Prisma.UserSelect;

  async profile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.profileSelect,
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  /**
   * Update the signed-in user's own name, username, email, employee id and,
   * when both password fields are filled and match, the password. The session
   * stays valid: the token is checked by user id, not by username.
   */
  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!existing) throw new UnauthorizedException();

    const data: Prisma.UserUpdateInput = {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName?.trim() || null,
      name: buildName(dto.firstName.trim(), dto.lastName?.trim(), existing.name),
      username: dto.username.trim(),
      email: dto.email.trim(),
      employeeId: cleanEmployeeId(dto.employeeId),
    };

    if (dto.newPassword || dto.confirmPassword) {
      if (!dto.newPassword || dto.newPassword !== dto.confirmPassword) {
        throw new BadRequestException('New password and confirm password do not match');
      }
      data.password = await bcrypt.hash(dto.newPassword, 10);
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data,
        select: this.profileSelect,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw uniqueViolation(e);
      }
      throw e;
    }
  }
}
