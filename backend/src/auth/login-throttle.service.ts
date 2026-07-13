import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory per-username login lockout to blunt brute-force / credential
 * stuffing that spreads across many IPs (which the per-IP HTTP rate limit
 * cannot catch). This is additive protection: it only rejects logins that are
 * already failing — it does not change the login business flow for valid users.
 *
 * Single-instance, non-persistent (state resets on restart) — chosen on purpose
 * to avoid a schema change / DB writes on every failed attempt.
 */
interface Attempt {
  fails: number;
  firstFailAt: number;
  lockedUntil: number;
}

@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger('Security');
  private readonly attempts = new Map<string, Attempt>();

  // Max consecutive failures before a temporary lock kicks in.
  private readonly maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
  // How long an account stays locked (ms).
  private readonly lockMs =
    Number(process.env.LOGIN_LOCK_SECONDS ?? 15 * 60) * 1000;
  // Sliding window: failures older than this are forgotten (ms).
  private readonly windowMs =
    Number(process.env.LOGIN_FAIL_WINDOW_SECONDS ?? 15 * 60) * 1000;

  private key(username: string) {
    return username.trim().toLowerCase();
  }

  /**
   * Throws (via the provided factory) when the account is currently locked.
   * Returns remaining lock seconds when locked, else null.
   */
  getLockRemainingSeconds(username: string): number | null {
    const entry = this.attempts.get(this.key(username));
    if (!entry) return null;
    const now = Date.now();
    if (entry.lockedUntil > now) {
      return Math.ceil((entry.lockedUntil - now) / 1000);
    }
    return null;
  }

  /** Record a failed login. Returns true if this failure triggered a lock. */
  recordFailure(username: string, ip: string): boolean {
    const k = this.key(username);
    const now = Date.now();
    let entry = this.attempts.get(k);

    // Start a fresh window if none / expired.
    if (!entry || now - entry.firstFailAt > this.windowMs) {
      entry = { fails: 0, firstFailAt: now, lockedUntil: 0 };
    }
    entry.fails += 1;

    let justLocked = false;
    if (entry.fails >= this.maxAttempts && entry.lockedUntil <= now) {
      entry.lockedUntil = now + this.lockMs;
      justLocked = true;
    }
    this.attempts.set(k, entry);

    this.logger.warn(
      `Failed login for "${username}" from ${ip} (attempt ${entry.fails}/${this.maxAttempts})`,
    );
    if (justLocked) {
      this.logger.warn(
        `Account "${username}" temporarily locked for ${this.lockMs / 1000}s after ${entry.fails} failed attempts (last IP ${ip})`,
      );
    }
    return justLocked;
  }

  /** Clear failure state on a successful login. */
  recordSuccess(username: string) {
    this.attempts.delete(this.key(username));
  }
}
