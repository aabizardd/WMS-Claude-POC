import { Controller, Get } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}

  // Viewing the permission catalog is part of role management.
  @Get()
  @RequirePermissions('roles:read')
  findAll() {
    return this.service.findAll();
  }
}
