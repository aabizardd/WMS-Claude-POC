import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ErpAuthResponse {
  success: boolean;
  data?: { access_token: string; token_type?: string; expires_in?: number };
}

/**
 * Shared HTTP client for the Oracle/NetSuite bridge. Centralizes the concerns
 * that were previously duplicated (and mis-tuned) in every sync service:
 *
 *  - ONE cached access token, shared across all modules and refreshed only when
 *    (near) expired — instead of every module re-authenticating each run.
 *  - A GLOBAL throttle: a minimum interval between the start of ANY two ERP
 *    requests (auth + data alike), so we never fire the old "auth + first page"
 *    burst. All requests are serialized through a single queue.
 *  - 429 / 5xx retry with exponential backoff honoring Retry-After — applied to
 *    EVERY call, not just the materials sync.
 *
 * No sync business logic lives here; services just call post<T>(path, body).
 */
@Injectable()
export class ErpHttpService {
  private readonly logger = new Logger(ErpHttpService.name);

  private token: string | null = null;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string> | null = null;

  // Serialize + space out every request through this tail promise.
  private tail: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const url = this.config.get<string>('ERP_BASE_URL');
    if (!url) throw new Error('ERP_BASE_URL is not configured');
    return url.replace(/\/$/, '');
  }

  private minIntervalMs(): number {
    return Number(this.config.get('ERP_MIN_REQUEST_INTERVAL_MS') ?? 1200);
  }
  private maxRetries(): number {
    return Number(this.config.get('ERP_SYNC_MAX_RETRIES') ?? 6);
  }
  private backoffMs(attempt: number): number {
    const base = Number(this.config.get('ERP_SYNC_RETRY_BACKOFF_MS') ?? 5000);
    return base * Math.pow(2, attempt);
  }

  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Run fn after the previous queued request and after the min interval has
  // elapsed since the last request started. Every ERP call (incl. auth) uses it.
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs() - Date.now();
      if (wait > 0) await this.delay(wait);
      this.lastRequestAt = Date.now();
      return fn();
    });
    // Keep the queue flowing even if a request rejects.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async fetchToken(): Promise<string> {
    const res = await this.enqueue(() =>
      fetch(`${this.baseUrl()}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.config.get<string>('ERP_CLIENT_ID'),
          client_secret: this.config.get<string>('ERP_CLIENT_SECRET'),
        }),
      }),
    );
    if (!res.ok) {
      throw new Error(`ERP auth failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as ErpAuthResponse;
    const token = json?.data?.access_token;
    if (!token) throw new Error('ERP auth: access_token missing in response');
    this.token = token;
    this.tokenExpiresAt =
      Date.now() + (Number(json?.data?.expires_in) || 3600) * 1000;
    return token;
  }

  // Cached token (refresh ~30s before expiry). De-duplicates concurrent refreshes.
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.token;
    }
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  /** Backwards-compatible helper for callers that still want a raw token. */
  getAccessToken(): Promise<string> {
    return this.getToken();
  }

  /**
   * POST JSON to a bridge endpoint and return the parsed body. Throttled,
   * authenticated, and retried on 401 (stale token) / 429 / 5xx.
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    const maxRetries = this.maxRetries();
    const url = `${this.baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const token = await this.getToken();
        res = await this.enqueue(() =>
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        // Network error — retry a few times with backoff.
        if (attempt < maxRetries) {
          const wait = this.backoffMs(attempt);
          this.logger.warn(
            `ERP ${path} network error (attempt ${attempt + 1}/${maxRetries}): ${
              (e as Error).message
            }. Waiting ${wait}ms…`,
          );
          await this.delay(wait);
          continue;
        }
        throw e;
      }

      if (res.ok) return (await res.json()) as T;

      // Stale/invalid token — refresh once and retry immediately.
      if (res.status === 401 && attempt < maxRetries) {
        this.token = null;
        this.tokenExpiresAt = 0;
        continue;
      }

      // Rate limited or transient server error — back off and retry.
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.backoffMs(attempt);
        this.logger.warn(
          `ERP ${path} ${res.status} (attempt ${attempt + 1}/${maxRetries}). Waiting ${wait}ms…`,
        );
        await this.delay(wait);
        continue;
      }

      throw new Error(`ERP ${path} failed: ${res.status} ${await res.text()}`);
    }
  }

  /**
   * Like post(), but returns the parsed body together with the HTTP status even
   * for non-2xx business errors (4xx) — so the caller can read a bridge
   * `message`. Still throttled/authenticated and retries 401/429/5xx.
   */
  async postRaw<T>(
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; body: T | null }> {
    const maxRetries = this.maxRetries();
    const url = `${this.baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const token = await this.getToken();
        res = await this.enqueue(() =>
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        if (attempt < maxRetries) {
          await this.delay(this.backoffMs(attempt));
          continue;
        }
        throw e;
      }

      if (res.status === 401 && attempt < maxRetries) {
        this.token = null;
        this.tokenExpiresAt = 0;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.backoffMs(attempt);
        this.logger.warn(
          `ERP ${path} ${res.status} (attempt ${attempt + 1}/${maxRetries}). Waiting ${wait}ms…`,
        );
        await this.delay(wait);
        continue;
      }

      const parsed = (await res.json().catch(() => null)) as T | null;
      return { ok: res.ok, status: res.status, body: parsed };
    }
  }
}
