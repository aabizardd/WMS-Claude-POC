import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: number;
  username: string;
  role: string;
  permissions: string[];
  /**
   * Warehouses this request may see: a non-admin's assigned warehouses, all
   * together; for an admin the one picked in the header selector, or null
   * (no limit) on "All sites".
   */
  warehouseIds: string[] | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const raw = request.user as AuthUser;
    if (!raw) return data ? undefined : raw;
    // Admin can switch the active warehouse via the X-Warehouse-Id header
    // (from the header selector). Non-admins always see every warehouse they
    // are assigned and the header is ignored.
    const user: AuthUser = { ...raw };
    if (raw.role === 'admin') {
      const h = request.headers['x-warehouse-id'];
      const wh = Array.isArray(h) ? h[0] : h;
      user.warehouseIds = wh && String(wh).trim() ? [String(wh).trim()] : null;
    }
    return data ? user[data] : user;
  },
);
