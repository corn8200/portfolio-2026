// GET /api/health — light probe of the three external surfaces the
// RAG endpoint depends on. Each probe is wrapped in a 2.5s timeout so a
// hung dependency cannot turn the health check into a hung handler.

import type { APIContext } from 'astro';
import OpenAI from 'openai';
import type { HealthResponse, RuntimeEnv } from '../../lib/rag/types';

export const prerender = false;

const PROBE_TIMEOUT_MS = 2500;
const KV_SENTINEL_KEY = 'health:sentinel';

interface AppLocalsRuntime {
  runtime?: { env?: RuntimeEnv };
}

function getEnv(locals: unknown): RuntimeEnv | null {
  const l = locals as AppLocalsRuntime | undefined;
  return l?.runtime?.env ?? null;
}

async function withTimeout<T>(p: Promise<T>, ms = PROBE_TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function probeKv(kv: KVNamespace | undefined): Promise<HealthResponse['services']['kv']> {
  if (!kv) return { ok: false, error: 'binding_missing' };
  const started = Date.now();
  try {
    await withTimeout(kv.get(KV_SENTINEL_KEY));
    return { ok: true, latency_ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - started,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

async function probeVectorize(
  index: VectorizeIndex | undefined,
): Promise<HealthResponse['services']['vectorize']> {
  if (!index) return { ok: false, error: 'binding_missing' };
  const started = Date.now();
  try {
    const desc = await withTimeout(index.describe());
    return {
      ok: true,
      latency_ms: Date.now() - started,
      vectors: typeof desc.vectorsCount === 'number' ? desc.vectorsCount : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - started,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

async function probeOpenAi(apiKey: string | undefined): Promise<HealthResponse['services']['openai']> {
  if (!apiKey) return { ok: false, error: 'key_missing' };
  const started = Date.now();
  try {
    const client = new OpenAI({ apiKey });
    await withTimeout(client.models.list());
    return { ok: true, latency_ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - started,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

export async function GET(ctx: APIContext): Promise<Response> {
  const env = getEnv(ctx.locals);
  const buildId = env?.SITE_VERSION ?? 'unknown';
  if (!env) {
    const body: HealthResponse = {
      ok: false,
      services: {
        kv: { ok: false, error: 'runtime_unavailable' },
        vectorize: { ok: false, error: 'runtime_unavailable' },
        openai: { ok: false, error: 'runtime_unavailable' },
      },
      build_id: buildId,
    };
    return new Response(JSON.stringify(body), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [kv, vectorize, openai] = await Promise.all([
    probeKv(env.CACHE),
    probeVectorize(env.CV_INDEX),
    probeOpenAi(env.OPENAI_API_KEY),
  ]);

  const ok = kv.ok && vectorize.ok && openai.ok;
  const body: HealthResponse = { ok, services: { kv, vectorize, openai }, build_id: buildId };
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
