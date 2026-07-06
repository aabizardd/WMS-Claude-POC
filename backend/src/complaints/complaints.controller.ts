import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ComplaintsService } from './complaints.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { UpdateComplaintStatusDto } from './dto/update-status.dto';
import { QueryComplaintDto } from './dto/query-complaint.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator';

@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly service: ComplaintsService) {}

  @Post()
  @RequirePermissions('complaints:create')
  create(@Body() dto: CreateComplaintDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, {
      userId: user.userId,
      role: user.role,
      warehouseId: user.warehouseId,
    });
  }

  @Get()
  @RequirePermissions('complaints:read')
  findAll(@Query() query: QueryComplaintDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, {
      userId: user.userId,
      role: user.role,
      warehouseId: user.warehouseId,
    });
  }

  @Get(':id')
  @RequirePermissions('complaints:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, {
      userId: user.userId,
      role: user.role,
      warehouseId: user.warehouseId,
    });
  }

  // Admin-only: change complaint status (e.g. to Solved).
  @Patch(':id/status')
  @RequirePermissions('complaints:update')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateComplaintStatusDto,
  ) {
    return this.service.updateStatus(id, dto.status);
  }
}
