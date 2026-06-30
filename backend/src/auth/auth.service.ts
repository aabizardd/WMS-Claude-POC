import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private roleInclude = {
    role: { include: { permissions: { include: { permission: true } } } },
  };

  private permissionKeys(user: {
    role: { permissions: { permission: { key: string } }[] };
  }) {
    return user.role.permissions.map((rp) => rp.permission.key);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: this.roleInclude,
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

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
