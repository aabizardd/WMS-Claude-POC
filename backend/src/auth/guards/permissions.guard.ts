import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly securityLogger = new Logger('Security');

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No permission metadata -> route is open to any authenticated user.
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const { user } = req;
    // 'admin' is a superuser and bypasses permission checks.
    if (user?.role === 'admin') {
      return true;
    }

    const userPermissions: string[] = user?.permissions ?? [];
    const ok = required.every((p) => userPermissions.includes(p));
    if (!ok) {
      // Surface authorization failures (possible endpoint probing) in logs.
      const ip = req?.ip ?? req?.socket?.remoteAddress ?? 'unknown';
      const path = req?.originalUrl ?? req?.url ?? '?';
      this.securityLogger.warn(
        `Forbidden: user "${user?.username ?? 'anonymous'}" (role ${user?.role ?? '-'}) ` +
          `lacked [${required.join(', ')}] on ${req?.method ?? '?'} ${path} from ${ip}`,
      );
      throw new ForbiddenException('You do not have the required permission');
    }
    return true;
  }
}
