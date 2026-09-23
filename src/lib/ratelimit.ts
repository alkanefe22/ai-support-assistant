import { createHmac } from "node:crypto";
import { getConfig } from "./config";

/**
 * In-memory sliding-window limiter. Per server instance only — on a multi-instance
 * deployment swap it for a shared store (e.g. Upstash Redis), see README.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return { ok: false, retryAfterSec: Math.ceil((list[0] + this.windowMs - now) / 1000) };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep(from);
    return { ok: true, retryAfterSec: 0 };
  }

  private sweep(from: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
  }
}

const g = globalThis as unknown as { __chatLimiter?: SlidingWindowLimiter; __leadLimiter?: SlidingWindowLimiter };

export function chatLimiter() {
  return (g.__chatLimiter ??= new SlidingWindowLimiter(getConfig().rateLimitPerMinute, 60_000));
}

export function leadLimiter() {
  return (g.__leadLimiter ??= new SlidingWindowLimiter(3, 10 * 60_000));
}

/** IPs are never stored raw; only a keyed hash is used as the limiter key. */
export function hashIp(ip: string): string {
  return createHmac("sha256", getConfig().sessionSecret).update(ip).digest("hex").slice(0, 16);
}

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
