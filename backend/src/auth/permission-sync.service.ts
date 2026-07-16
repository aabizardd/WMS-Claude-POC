import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from './permissions.catalog';

/**
 * Keeps the Permission table in step with the code catalog.
 *
 * The Role form renders its checkboxes from the permission rows in the DB, so a
 * resource that exists in the catalog but not in the DB shows up as a leaf with
 * no checkboxes and simply cannot be granted. That silently happened to both
 * `transfer-orders` and `purchase-orders`: the catalog grew, but the rows were
 * only ever created by `prisma:seed`, which is not part of a deploy.
 *
 * This runs on every boot and is purely additive — it upserts permission
 * DEFINITIONS only. It never grants anything to a role and never deletes:
 * removing a permission here would silently revoke access, so retiring one is
 * left as a deliberate manual step.
 */
@Injectable()
export class PermissionSyncService implements OnModuleInit {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const existing = await this.prisma.permission.findMany({
        select: { key: true },
      });
      const have = new Set(existing.map((p) => p.key));
      const missing = PERMISSIONS.filter((p) => !have.has(p.key));

      if (missing.length === 0) {
        this.logger.log(`Permission catalog in sync (${PERMISSIONS.length} keys)`);
        return;
      }

      for (const p of missing) {
        // upsert (not create) so concurrent instances booting together race
        // harmlessly instead of throwing a unique-constraint error.
        await this.prisma.permission.upsert({
          where: { key: p.key },
          update: { resource: p.resource, action: p.action, description: p.description },
          create: p,
        });
      }
      this.logger.warn(
        `Permission catalog: added ${missing.length} missing key(s) -> ${missing
          .map((p) => p.key)
          .join(', ')}. Grant them to roles via Roles UI as needed.`,
      );
    } catch (e) {
      // Never block startup on this — a failed sync degrades RBAC management,
      // it must not take the API down.
      this.logger.error(`Permission catalog sync failed: ${(e as Error).message}`);
    }
  }
}
