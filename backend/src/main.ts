import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Standard security headers (HSTS, X-Content-Type-Options, frameguard, ...).
  app.use(helmet());

  // Behind a reverse proxy (Render/Nginx) so rate limiting reads the real
  // client IP from X-Forwarded-For instead of the proxy IP.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api');

  // Allow base64 image evidence (complaints) in JSON bodies.
  const { json, urlencoded } = await import('express');
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN?.split(',') ?? 'http://localhost:5173',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`WMS backend running on http://localhost:${port}/api`);
}
bootstrap();
