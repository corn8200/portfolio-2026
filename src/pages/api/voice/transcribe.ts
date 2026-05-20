// POST /api/voice/transcribe
// Accepts multipart/form-data with field `audio` (any common audio container
// Whisper handles: webm, mp3, wav, m4a). Returns { ok, text }.

import type { APIRoute } from 'astro';
import {
  addSpend,
  clientIp,
  enforceRateLimit,
  isOverBudget,
  type KVLike,
} from '@/lib/voice/ratelimit';
import type { TranscribeResponse } from '@/lib/voice/types';

export const prerender = false;

const WHISPER_TIMEOUT_MS = 12_000;
const TRANSCRIBE_LIMIT_PER_IP_PER_HOUR = 30;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI's stated cap

// Whisper-1 is $0.006/min. We don't know the duration here without decoding;
// use a conservative per-call cost estimate of ~5 seconds avg ($0.0005).
const PER_CALL_COST_USD = 0.0005;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as { runtime?: { env: Record<string, unknown> } }).runtime?.env ?? {};
  const cache = env.CACHE as KVLike | undefined;
  const apiKey = env.OPENAI_API_KEY as string | undefined;
  const dailyCap = Number(env.OPENAI_DAILY_BUDGET_USD ?? 0);

  if (!cache) return json({ ok: false, reason: 'kv-unbound' }, 500);
  if (!apiKey) return json({ ok: false, reason: 'openai-unbound' }, 500);

  const ip = clientIp(request);
  const rl = await enforceRateLimit(cache, 'transcribe', ip, TRANSCRIBE_LIMIT_PER_IP_PER_HOUR);
  if (!rl.ok) {
    return json({ ok: false, reason: 'rate-limit' }, 429, { 'Retry-After': String(rl.resetSeconds) });
  }

  if (await isOverBudget(cache, 'openai', dailyCap)) {
    return json({ ok: false, reason: 'daily-budget-reached' }, 503);
  }

  let inForm: FormData;
  try {
    inForm = await request.formData();
  } catch {
    return json({ ok: false, reason: 'bad-form' }, 400);
  }
  const audio = inForm.get('audio');
  if (!(audio instanceof Blob)) return json({ ok: false, reason: 'missing-audio' }, 400);
  if (audio.size === 0) return json({ ok: false, reason: 'empty-audio' }, 400);
  if (audio.size > MAX_AUDIO_BYTES) return json({ ok: false, reason: 'audio-too-large' }, 413);

  const upstreamForm = new FormData();
  // Whisper requires a filename. The Blob from MediaRecorder may not carry one.
  const fileName = (audio as File).name || 'clip.webm';
  upstreamForm.append('file', audio, fileName);
  upstreamForm.append('model', 'whisper-1');
  upstreamForm.append('response_format', 'json');
  upstreamForm.append('temperature', '0');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const reason = err instanceof Error ? err.message : 'whisper-failed';
    return json({ ok: false, reason }, 502);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return json({ ok: false, reason: `openai-${res.status}`, detail: txt.slice(0, 400) }, 502);
  }
  const data = (await res.json().catch(() => null)) as { text?: string } | null;
  if (!data || typeof data.text !== 'string') {
    return json({ ok: false, reason: 'malformed-whisper' }, 502);
  }

  addSpend(cache, 'openai', PER_CALL_COST_USD).catch(() => undefined);

  return json({ ok: true, text: data.text, durationMs: Date.now() - startedAt }, 200);
};

function json(payload: TranscribeResponse | Record<string, unknown>, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}
