export type ProviderBackoffOptions = {
  now?: () => number;
  random?: () => number;
  baseDelayMs?: number;
  maximumDelayMs?: number;
  retrySpacingMs?: number;
};

export class ProviderBackoff {
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly baseDelayMs: number;
  private readonly maximumDelayMs: number;
  private readonly retrySpacingMs: number;
  private cooldownUntil = 0;
  private nextRetryAt = 0;

  constructor(options: ProviderBackoffOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maximumDelayMs = options.maximumDelayMs ?? 30_000;
    this.retrySpacingMs = options.retrySpacingMs ?? 250;
  }

  reserveRetry(attempt: number, retryAfterMs?: number) {
    const exponentialDelay = Math.min(
      this.maximumDelayMs,
      this.baseDelayMs * 2 ** Math.max(0, attempt),
    );
    const jitter = Math.floor(exponentialDelay * 0.2 * this.random());
    const requestedDelay = Math.min(
      this.maximumDelayMs,
      Math.max(0, retryAfterMs ?? exponentialDelay + jitter),
    );
    const now = this.now();
    const earliestRetry = now + requestedDelay;
    const scheduledRetry = Math.max(earliestRetry, this.nextRetryAt);
    this.cooldownUntil = Math.max(this.cooldownUntil, earliestRetry);
    this.nextRetryAt = scheduledRetry + this.retrySpacingMs;
    return scheduledRetry - now;
  }

  remainingCooldown() {
    return Math.max(0, this.cooldownUntil - this.now());
  }
}
