import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Public()
  async check() {
    let dbConnected = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbConnected = true;
    } catch { /* db not available */ }

    return {
      status: dbConnected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbConnected ? 'connected' : 'disconnected',
    };
  }
}
