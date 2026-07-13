import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';

/**
 * ThrottlerGuard that logs whenever a client exceeds the rate limit, so brute
 * force / API abuse / traffic spikes are visible in the security logs. Behaves
 * identically to the stock guard otherwise (still throws HTTP 429).
 */
@Injectable()
export class LoggingThrottlerGuard extends ThrottlerGuard {
  private readonly securityLogger = new Logger('Security');

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest();
    const ip = req?.ip ?? req?.socket?.remoteAddress ?? 'unknown';
    const method = req?.method ?? '?';
    const path = req?.originalUrl ?? req?.url ?? '?';
    this.securityLogger.warn(
      `Rate limit exceeded from ${ip} on ${method} ${path} ` +
        `(limit ${throttlerLimitDetail.limit}/${throttlerLimitDetail.ttl}ms)`,
    );
    throw new ThrottlerException();
  }
}
