// POST /api/voice/tts
// Body: { text: string }
// Returns: audio/mpeg stream from ElevenLabs.
// Rate limited per IP per hour. Honours the daily ElevenLabs spend cap.

import type { APIRoute } from 'astro';
import { streamTts, estimateTtsCostUsd } from '@/lib/voice/eleven';
import {
  addSpend,
  clientIp,
  enforceRateLimit,
  isOverBudget,
  type KVLike,
} from '@/lib/voice/ratelimit';
import type { ApiError, TtsRequest } from '@/lib/voice/types';

export const prerender = false;

const TTS_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 1200; // ~ a few sentences; refuse anything novel-sized

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as { runtime?: { env: Record<string, unknown> } }).runtime?.env ?? {};
  const cache = env.CACHE as KVLike | undefined;
  const apiKey = env.ELEVENLABS_API_KEY as string | undefined;
  const voiceId = env.ELEVENLABS_VOICE_ID as string | undefined;
  const limitPerHour = Number(env.RATE_LIMIT_VOICE_PER_IP_PER_HOUR ?? 20);
  const dailyCap = Number(env.ELEVENLABS_DAILY_BUDGET_USD ?? 0);

  if (!cache) return json({ ok: false, reason: 'kv-unbound' }, 500);
  if (!apiKey || !voiceId) return json({ ok: false, reason: 'eleven-unbound' }, 500);

  const ip = clientIp(request);
  const rl = await enforceRateLimit(cache, 'tts', ip, limitPerHour);
  if (!rl.ok) {
    return json({ ok: false, reason: 'rate-limit' }, 429, {
      'Retry-After': String(rl.resetSeconds),
      'X-RateLimit-Limit': String(rl.limit),
      'X-RateLimit-Remaining': '0',
    });
  }

  if (await isOverBudget(cache, 'elevenlabs', dailyCap)) {
    return json({ ok: false, reason: 'daily-budget-reached' }, 503);
  }

  let body: TtsRequest;
  try {
    body = (await request.json()) as TtsRequest;
  } catch {
    return json({ ok: false, reason: 'bad-json' }, 400);
  }
  const text = (body?.text ?? '').toString().trim();
  if (!text) return json({ ok: false, reason: 'empty-text' }, 400);
  if (text.length > MAX_TEXT_CHARS) return json({ ok: false, reason: 'text-too-long' }, 413);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await streamTts({
      apiKey,
      voiceId,
      text,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const reason = err instanceof Error ? err.message : 'tts-failed';
    return json({ ok: false, reason }, 502);
  }

  // Spend bookkeeping happens only AFTER the stream completes, so an aborted /
  // disconnected client doesn't get billed against the daily cap. Same for the
  // timeout handle — clear it in flush AND cancel paths to prevent leaks.
  const cost = estimateTtsCostUsd(text.length);
  let billed = false;
  const settle = () => {
    clearTimeout(timeout);
    if (billed) return;
    billed = true;
    addSpend(cache, 'elevenlabs', cost).catch(() => undefined);
  };
  const cancelOnly = () => {
    clearTimeout(timeout);
  };

  const bridged = upstream.stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      flush() { settle(); },
      cancel() { cancelOnly(); },
    })
  );

  return new Response(bridged, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-RateLimit-Limit': String(rl.limit),
      'X-RateLimit-Remaining': String(rl.remaining),
    },
  });
};

function json(payload: ApiError | Record<string, unknown>, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}
