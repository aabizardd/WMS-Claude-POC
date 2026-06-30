import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
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

    const { user } = context.switchToHttp().getRequest();
    // 'admin' is a superuser and bypasses permission checks.
    if (user?.role === 'admin') {
      return true;
    }

    const userPermissions: string[] = user?.permissions ?? [];
    const ok = required.every((p) => userPermissions.includes(p));
    if (!ok) {
      throw new ForbiddenException('You do not have the required permission');
    }
    return true;
  }
}
