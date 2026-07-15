import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;

  const mockPrisma = {
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return ok when db is connected', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe('connected');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('uptime');
  });

  it('should return degraded when db is disconnected', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection failed'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.db).toBe('disconnected');
  });

  it('should include uptime as a number', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    const result = await controller.check();
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should include ISO timestamp', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    const result = await controller.check();
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
