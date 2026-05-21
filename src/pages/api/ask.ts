// POST /api/ask — SSE-streamed RAG answer endpoint.
//
// Accepts `{ query, history? }`, rate-limits per IP via KV, optionally
// serves from a 6h response cache, and otherwise streams `{ delta }`
// events from the answer pipeline followed by a terminal `{ done }`
// event carrying citations + usage.

import type { APIContext } from 'astro';
import { streamAnswer } from '../../lib/rag';
import { notifyVisitorAsync } from '../../lib/notify';
import type {
  AskMessage,
  AskRequest,
  AskResponse,
  AskUsage,
  Citation,
  RuntimeEnv,
} from '../../lib/rag/types';

export const prerender = false;

const RATE_LIMIT_PER_HOUR = 30;
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
  'X-Accel-Buffering': 'no',
  Connection: 'keep-alive',
};

interface AppLocalsRuntime {
  runtime?: { env?: RuntimeEnv };
}

function getEnv(locals: unknown): RuntimeEnv | null {
  const l = locals as AppLocalsRuntime | undefined;
  return l?.runtime?.env ?? null;
}

function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'unknown';
  return 'unknown';
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

interface RateRecord {
  count: number;
  resetAt: number;
}

async function checkRate(
  kv: KVNamespace,
  ip: string,
): Promise<{ allowed: boolean; retryAfter?: number; remaining: number }> {
  const key = `ratelimit:ask:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const raw = await kv.get(key);
  let record: RateRecord = raw ? JSON.parse(raw) : { count: 0, resetAt: now + 3600 };
  if (record.resetAt <= now) {
    record = { count: 0, resetAt: now + 3600 };
  }
  if (record.count >= RATE_LIMIT_PER_HOUR) {
    return { allowed: false, retryAfter: record.resetAt - now, remaining: 0 };
  }
  record.count += 1;
  const ttl = Math.max(record.resetAt - now, 60);
  await kv.put(key, JSON.stringify(record), { expirationTtl: ttl });
  return { allowed: true, remaining: RATE_LIMIT_PER_HOUR - record.count };
}

function historySignature(history?: AskMessage[]): string {
  if (!history?.length) return '';
  return history.slice(-6).map((h) => `${h.role}:${h.content}`).join('|');
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function encodeSse(payload: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(ctx: APIContext): Promise<Response> {
  const env = getEnv(ctx.locals);
  if (!env) {
    return jsonResponse({ error: 'runtime_unavailable' }, { status: 503 });
  }
  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: 'openai_key_missing' }, { status: 503 });
  }

  let body: AskRequest;
  try {
    body = (await ctx.request.json()) as AskRequest;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, { status: 400 });
  }
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 1000) {
    return jsonResponse({ error: 'invalid_query' }, { status: 400 });
  }
  const history: AskMessage[] | undefined = Array.isArray(body.history)
    ? body.history
        .filter(
          (h): h is AskMessage =>
            !!h &&
            (h.role === 'user' || h.role === 'assistant') &&
            typeof h.content === 'string' &&
            h.content.length < 4000,
        )
        .slice(-6)
    : undefined;

  // Visitor context: name/org from body if the agent client shared them;
  // geo from the Cloudflare request object (always present in Workers runtime).
  const extra = body as unknown as { name?: unknown; org?: unknown; session?: unknown };
  const visitorName = typeof extra.name === 'string'
    ? extra.name.trim().slice(0, 80) || null
    : null;
  const visitorOrg = typeof extra.org === 'string'
    ? extra.org.trim().slice(0, 120) || null
    : null;
  const sessionId = typeof extra.session === 'string'
    ? extra.session.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    : '';
  const cf = (ctx.request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  const visitor = {
    name: visitorName,
    org: visitorOrg,
    city: typeof cf.city === 'string' ? cf.city : null,
    region: typeof cf.region === 'string' ? cf.region : null,
    country: typeof cf.country === 'string' ? cf.country : null,
    timezone: typeof cf.timezone === 'string' ? cf.timezone : null,
  };

  // Fire-and-forget notification email — one per session per 24h.
  if (sessionId && env.RESEND_API_KEY && env.NOTIFY_EMAIL_TO && env.NOTIFY_EMAIL_FROM) {
    const exec = (ctx as unknown as { runtime?: { ctx?: { waitUntil: (p: Promise<unknown>) => void } } })
      .runtime?.ctx?.waitUntil;
    notifyVisitorAsync(
      {
        env: {
          CACHE: env.CACHE,
          RESEND_API_KEY: env.RESEND_API_KEY as string,
          NOTIFY_EMAIL_TO: env.NOTIFY_EMAIL_TO as string,
          NOTIFY_EMAIL_FROM: env.NOTIFY_EMAIL_FROM as string,
        },
        sessionId,
        visitor,
        firstQuery: query,
        userAgent: ctx.request.headers.get('user-agent') ?? '',
      },
      exec,
    );
  }

  const ip = clientIp(ctx.request);
  const rate = await checkRate(env.CACHE, ip);
  if (!rate.allowed) {
    return jsonResponse(
      { error: 'rate_limited', retry_after: rate.retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(rate.retryAfter ?? 3600),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  const url = new URL(ctx.request.url);
  const noCache = url.searchParams.get('nocache') === '1';
  // Cache key includes visitor name/org so personalized answers don't bleed across visitors.
  const visitorSig = `${visitor.name ?? ''}|${visitor.org ?? ''}`;
  const cacheKey = `ask:v2:${await sha256Hex(`${query}\n${historySignature(history)}\n${visitorSig}`)}`;

  // Cache hit short-circuits to a single SSE flush with the saved payload.
  if (!noCache) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as AskResponse;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encodeSse({ kind: 'delta', delta: parsed.text }));
          controller.enqueue(
            encodeSse({
              kind: 'done',
              citations: parsed.citations,
              usage: { ...parsed.usage, cache_hit: true },
            }),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { ...SSE_HEADERS, 'X-Cache': 'HIT' },
      });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (payload: object) => {
        try {
          controller.enqueue(encodeSse(payload));
        } catch {
          // Stream already closed (client disconnect) — fall through.
        }
      };
      try {
        const result = await streamAnswer({
          env,
          query,
          history,
          visitor,
          onDelta: (delta) => {
            enqueue({ kind: 'delta', delta });
          },
        });
        const usage: AskUsage = { ...result.usage, cache_hit: false };
        const citations: Citation[] = result.citations;
        enqueue({ kind: 'done', citations, usage });

        // Persist the full text + citations for the 6h cache window.
        const payload: AskResponse = { text: result.fullText, citations, usage };
        await env.CACHE.put(cacheKey, JSON.stringify(payload), {
          expirationTtl: CACHE_TTL_SECONDS,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown_error';
        enqueue({ kind: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...SSE_HEADERS, 'X-Cache': 'MISS' },
  });
}

export async function GET(): Promise<Response> {
  return jsonResponse({ error: 'method_not_allowed' }, { status: 405 });
}
