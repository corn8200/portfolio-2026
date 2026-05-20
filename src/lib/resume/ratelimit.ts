// KV-backed per-IP rate limiter.
//
// Key pattern is the shared convention so a future src/lib/voice/ratelimit.ts
// can use the same namespace without collision:
//   rl:${endpoint}:${ip}:${hourBucket}
//
// Hour bucket = Math.floor(Date.now()/3_600_000) — a fixed-window per-hour
// counter. Good enough at this scale; a sliding window would need a Durable
// Object and we don't want that footprint yet.

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

export interface RateLimitOpts {
  endpoint: string;
  ip: string;
  limit: number;
  /** Optional override of "now" for tests. */
  now?: number;
}

export async function checkAndIncrement(kv: KVNamespace, opts: RateLimitOpts): Promise<RateLimitResult> {
  const now = opts.now ?? Date.now();
  const hourBucket = Math.floor(now / 3_600_000);
  const key = `rl:${opts.endpoint}:${opts.ip}:${hourBucket}`;
  const resetAt = (hourBucket + 1) * 3_600_000;

  const raw = await kv.get(key);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;

  if (current >= opts.limit) {
    return { ok: false, remaining: 0, limit: opts.limit, resetAt };
  }

  const next = current + 1;
  // expirationTtl needs to outlive the bucket but not by much. Add 60s slack
  // so we don't end up with negative TTL near the bucket edge.
  const ttl = Math.max(60, Math.ceil((resetAt - now) / 1000) + 60);
  await kv.put(key, String(next), { expirationTtl: ttl });

  return { ok: true, remaining: Math.max(0, opts.limit - next), limit: opts.limit, resetAt };
}

/** Best-effort IP extraction from a Cloudflare Pages request. */
export function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return '0.0.0.0';
}
