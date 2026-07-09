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
  warehouseId: string | null;
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
    // Cheap indexed lookup by primary key.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is inactive or no longer exists');
    }

    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions ?? [],
      warehouseId: payload.warehouseId ?? null,
    };
  }
}
