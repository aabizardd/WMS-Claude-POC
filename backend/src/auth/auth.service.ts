import {
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
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

    const permissions = this.permissionKeys(user);

    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role.name,
      permissions,
      warehouseId: user.warehouseId,
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
        warehouseId: user.warehouseId,
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
      warehouseId: user.warehouseId,
    };
  }
}
