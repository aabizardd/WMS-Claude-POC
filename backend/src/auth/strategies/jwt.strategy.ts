import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { getJwtSecret } from '../jwt-secret.util';

export interface JwtPayload {
  sub: number;
  username: string;
  role: string;
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  // Whatever this returns is attached to request.user
  async validate(payload: JwtPayload) {
    // Revalidate against the DB on every request so deactivating a user takes
    // effect immediately (a JWT otherwise stays valid until it expires).
    // Cheap indexed lookups by primary key.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        isActive: true,
        role: { select: { isActive: true } },
        warehouses: { select: { warehouseId: true } },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is inactive or no longer exists');
    }
    // Setting a role inactive also cuts off sessions already open with it.
    if (!user.role.isActive) {
      throw new UnauthorizedException('Your role is inactive');
    }

    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions ?? [],
      // Read fresh, so a changed assignment applies without signing in again.
      warehouseIds: user.warehouses.map((w) => w.warehouseId),
    };
  }
}
