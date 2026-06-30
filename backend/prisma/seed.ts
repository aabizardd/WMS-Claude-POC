import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  PERMISSIONS,
  ALL_PERMISSION_KEYS,
  STAFF_PERMISSION_KEYS,
} from '../src/auth/permissions.catalog';

const prisma = new PrismaClient();

// Create/refresh permissions, then assign a set of permission keys to a role.
async function assignPermissions(roleId: number, keys: string[]) {
  const perms = await prisma.permission.findMany({
    where: { key: { in: keys } },
    select: { id: true },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId } });
  if (perms.length) {
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
}

async function main() {
  // --- Permissions catalog ---
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { resource: p.resource, action: p.action, description: p.description },
      create: p,
    });
  }

  // --- Roles (master data) ---
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', description: 'Full access to the WMS' },
  });

  const staffRole = await prisma.role.upsert({
    where: { name: 'staff' },
    update: {},
    create: { name: 'staff', description: 'Warehouse operator / staff' },
  });

  // admin -> all permissions; staff -> read-only baseline
  await assignPermissions(adminRole.id, ALL_PERMISSION_KEYS);
  await assignPermissions(staffRole.id, STAFF_PERMISSION_KEYS);

  // --- Default admin user ---
  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@wms.local' },
    update: {},
    create: {
      name: 'Administrator',
      email: 'admin@wms.local',
      username: 'admin',
      password: passwordHash,
      roleId: adminRole.id,
      isActive: true,
    },
  });

  // --- UOM master ---
  const pcs = await prisma.uom.upsert({
    where: { uomCode: 'pcs' },
    update: {},
    create: { uomName: 'Pieces', uomCode: 'pcs' },
  });
  const kg = await prisma.uom.upsert({
    where: { uomCode: 'Kg' },
    update: {},
    create: { uomName: 'Kilogram', uomCode: 'Kg' },
  });

  // --- Material category & type master ---
  const sparepartCat = await prisma.materialCategory.upsert({
    where: { materialCategoryCode: 'CAT-002' },
    update: {},
    create: {
      materialCategoryName: 'Sparepart',
      materialCategoryCode: 'CAT-002',
    },
  });
  const sparepartType = await prisma.materialType.upsert({
    where: { materialTypeCode: 'MATTYPE-002' },
    update: {},
    create: { materialTypeName: 'Sparepart', materialTypeCode: 'MATTYPE-002' },
  });

  // --- Sample material ---
  await prisma.material.upsert({
    where: { materialCode: '102010890' },
    update: {},
    create: {
      materialName: '102010890',
      materialCode: '102010890',
      materialCategoryId: sparepartCat.id,
      materialTypeId: sparepartType.id,
      primaryUomId: pcs.id,
      weightUomId: kg.id,
      createdBy: 'System Administrator',
      modifiedBy: 'System Administrator',
    },
  });

  // --- Warehouse management sample masters ---
  await prisma.uom.upsert({
    where: { uomCode: 'cm' },
    update: {},
    create: { uomName: 'Centimeter', uomCode: 'cm' },
  });

  const areaTypes = [
    ['IELJKT - Storage Area', 'STORAGEAREA'],
    ['IELJKT - Stock In Area', 'STOCKINAREA'],
    ['IELJKT - Stock Out Area', 'STOCKOUTAREA'],
    ['IELJKT - Discrepancy Area', 'DISCREPANCYAREA'],
  ];
  for (const [name, code] of areaTypes) {
    await prisma.areaType.upsert({
      where: { areaTypeCode: code },
      update: {},
      create: { areaTypeName: name, areaTypeCode: code },
    });
  }

  const aisles = [
    ['IELJKT-S-A1', 'IELJKTSA1'],
    ['IELJKT-I-A1', 'IELJKTIA1'],
    ['IELJKT-O-A1', 'IELJKTOA1'],
    ['IELJKT-D-A1', 'IELJKTDA1'],
  ];
  for (const [name, code] of aisles) {
    await prisma.aisle.upsert({
      where: { aisleCode: code },
      update: {},
      create: { aisleName: name, aisleCode: code },
    });
  }

  const shelves = [
    ['IELJKT-S-A1-S1', 'IELJKTSA1S1'],
    ['IELJKT-I-A1-S1', 'IELJKTIA1S1'],
    ['IELJKT-O-A1-S1', 'IELJKTOA1S1'],
    ['IELJKT-D-A1-S1', 'IELJKTDA1S1'],
  ];
  for (const [label, code] of shelves) {
    await prisma.shelf.upsert({
      where: { shelfCode: code },
      update: {},
      create: { shelfLabel: label, shelfCode: code },
    });
  }

  console.log('Seed complete.');
  console.log(`Permissions: ${PERMISSIONS.length}`);
  console.log('Roles:', adminRole.name, staffRole.name);
  console.log('Login -> username: admin  password: admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
