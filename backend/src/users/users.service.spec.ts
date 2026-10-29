import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

/** One user, many warehouses: what a non-admin may hand out. */
describe('UsersService — warehouse assignment', () => {
  const service = new UsersService({} as never);
  const resolve = (requested: string[], scope?: { role: string; warehouseIds: string[] | null }, current?: string[]) =>
    (service as unknown as {
      resolveWarehouses: (r: string[], s: typeof scope, c?: string[]) => string[];
    }).resolveWarehouses(requested, scope, current);

  it('lets an admin assign any warehouses, once each', () => {
    expect(resolve(['wh-a', 'wh-c', 'wh-a'], { role: 'admin', warehouseIds: null })).toEqual(['wh-a', 'wh-c']);
  });

  it("refuses a warehouse the non-admin is not assigned", () => {
    expect(() => resolve(['wh-a', 'wh-c'], { role: 'staff', warehouseIds: ['wh-a', 'wh-b'] })).toThrow(
      ForbiddenException,
    );
  });

  it("keeps the target's warehouses the editor cannot see", () => {
    expect(resolve(['wh-b'], { role: 'staff', warehouseIds: ['wh-a', 'wh-b'] }, ['wh-a', 'wh-z'])).toEqual([
      'wh-z',
      'wh-b',
    ]);
  });
});
