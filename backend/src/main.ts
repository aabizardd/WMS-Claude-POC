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

  // CORS allow-list from FRONTEND_ORIGIN (comma-separated). Parsed defensively:
  // `''?.split(',')` yields [''] — an allow-list matching nothing — which would
  // reject every browser request, and untrimmed entries never match a real
  // Origin header.
  const origins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const isProd = process.env.NODE_ENV === 'production';
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  } else if (!isProd) {
    // Dev convenience only — never fall back to localhost in production.
    app.enableCors({ origin: 'http://localhost:5173', credentials: true });
  } else {
    // No allow-list in production: correct for a same-origin deploy (the nginx
    // in front forwards /api). Split-origin deploys MUST set FRONTEND_ORIGIN.
    console.warn(
      '[CORS] FRONTEND_ORIGIN is not set — CORS disabled (same-origin mode). ' +
        'Set it if the frontend is served from a different origin.',
    );
  }

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
