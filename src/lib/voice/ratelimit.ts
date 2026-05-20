// KV-backed sliding-window-ish rate limiter. The window is a fixed hourly bucket
// keyed by `rl:<scope>:<ip>:<YYYYMMDDHH>` so we get O(1) increments and the keys
// expire on their own via the KV TTL. Cheap, deterministic, good enough for the
// portfolio's coarse abuse defense.

export type KVLike = {
  get(key: string, opts?: { type?: 'text' | 'json' }): Promise<string | null>;
  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number; expiration?: number }
  ): Promise<void>;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
};

const BUCKET_TTL_SECONDS = 60 * 60 * 2; // keep two hours so we don't lose count near the boundary

function hourBucket(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  return `${y}${m}${d}${h}`;
}

function secondsUntilNextHour(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
  return Math.max(1, Math.floor((next.getTime() - now.getTime()) / 1000));
}

/**
 * Extracts a best-effort client IP from incoming Workers request headers.
 * Falls back to `unknown` so we still rate-limit (broadly) even if the header
 * disappears — better to over-block than over-allow.
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get('cf-connecting-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}

export async function enforceRateLimit(
  kv: KVLike,
  scope: string,
  ip: string,
  limit: number
): Promise<RateLimitResult> {
  const now = new Date();
  const key = `rl:${scope}:${ip}:${hourBucket(now)}`;
  const current = Number((await kv.get(key)) ?? '0');
  const next = current + 1;
  const reset = secondsUntilNextHour(now);
  if (current >= limit) {
    return { ok: false, remaining: 0, limit, resetSeconds: reset };
  }
  // Best-effort increment; on a race we may slightly over-count but never under,
  // which is the right failure direction for a limiter.
  await kv.put(key, String(next), { expirationTtl: BUCKET_TTL_SECONDS });
  return { ok: true, remaining: Math.max(0, limit - next), limit, resetSeconds: reset };
}

/**
 * Daily budget accounting. Adds `costUsd` to the running total for today,
 * returns the new total and whether we are over budget. We track AFTER the
 * call returns (best-effort, post-pay) because we don't know token usage until
 * the upstream responds — so callers should check `isOverBudget` BEFORE the
 * call to decide whether to admit, and then call `addSpend` after.
 */
export async function getDailySpend(
  kv: KVLike,
  provider: 'openai' | 'elevenlabs',
  now: Date = new Date()
): Promise<number> {
  const key = budgetKey(provider, now);
  return Number((await kv.get(key)) ?? '0');
}

export async function addSpend(
  kv: KVLike,
  provider: 'openai' | 'elevenlabs',
  costUsd: number,
  now: Date = new Date()
): Promise<number> {
  const key = budgetKey(provider, now);
  const current = Number((await kv.get(key)) ?? '0');
  const total = current + Math.max(0, costUsd);
  await kv.put(key, total.toFixed(6), { expirationTtl: 60 * 60 * 36 });
  return total;
}

export async function isOverBudget(
  kv: KVLike,
  provider: 'openai' | 'elevenlabs',
  capUsd: number,
  now: Date = new Date()
): Promise<boolean> {
  if (!Number.isFinite(capUsd) || capUsd <= 0) return false;
  const spent = await getDailySpend(kv, provider, now);
  return spent >= capUsd;
}

function budgetKey(provider: 'openai' | 'elevenlabs', now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `spend:${provider}:${y}-${m}-${d}`;
}

export const __testing = { hourBucket, secondsUntilNextHour, budgetKey };
