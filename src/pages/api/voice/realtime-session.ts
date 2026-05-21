// POST /api/voice/realtime-session
// Mints an ephemeral OpenAI Realtime session token the browser uses to open a
// WebRTC PeerConnection directly to OpenAI. The browser never sees the long-
// lived API key.

import type { APIRoute } from 'astro';
import {
  clientIp,
  enforceRateLimit,
  isOverBudget,
  type KVLike,
} from '@/lib/voice/ratelimit';
import type { ApiError, RealtimeSessionResponse } from '@/lib/voice/types';

export const prerender = false;

const REALTIME_TIMEOUT_MS = 12_000;
const REALTIME_LIMIT_PER_IP_PER_HOUR = 6;
// OpenAI Realtime GA model. `gpt-4o-realtime-preview-2024-12-17` was deprecated;
// `gpt-realtime` is the rolling GA alias.
const REALTIME_MODEL = 'gpt-realtime';

const SYSTEM_PROMPT = [
  'You are the live voice agent for John Cornelius\' engineering portfolio.',
  'Tone: operator. Compact. Specific. No filler, no apologies, no "as an AI".',
  'Keep replies under 60 words unless the user explicitly asks for depth.',
  'When the user asks about a specific project, decision, stack choice, dollar figure,',
  'date, or system you are NOT certain of, do NOT guess — say "let me pull that"',
  'and stop. The page will fetch a grounded answer from /api/ask and inject the',
  'citation chips into the transcript. You then continue with the verified facts.',
  'If asked who built you, you are an Astro + Cloudflare Workers + OpenAI Realtime',
  '+ ElevenLabs voice agent over a Cloudflare Vectorize RAG store.',
  'Never read citation chips aloud. Never spell out URLs unless asked.',
].join(' ');

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as { runtime?: { env: Record<string, unknown> } }).runtime?.env ?? {};
  const cache = env.CACHE as KVLike | undefined;
  const apiKey = env.OPENAI_API_KEY as string | undefined;
  const dailyCap = Number(env.OPENAI_DAILY_BUDGET_USD ?? 0);

  if (!cache) return json({ ok: false, reason: 'kv-unbound' }, 500);
  if (!apiKey) return json({ ok: false, reason: 'openai-unbound' }, 500);

  const ip = clientIp(request);
  const rl = await enforceRateLimit(cache, 'realtime', ip, REALTIME_LIMIT_PER_IP_PER_HOUR);
  if (!rl.ok) {
    return json({ ok: false, reason: 'rate-limit' }, 429, {
      'Retry-After': String(rl.resetSeconds),
    });
  }

  if (await isOverBudget(cache, 'openai', dailyCap)) {
    return json({ ok: false, reason: 'daily-budget-reached' }, 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REALTIME_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice: 'alloy',
        modalities: ['audio', 'text'],
        instructions: SYSTEM_PROMPT,
        turn_detection: { type: 'server_vad' },
        // gpt-4o-transcribe is the current best-in-class STT for Realtime;
        // whisper-1 still works but is the older path.
        input_audio_transcription: { model: 'gpt-4o-transcribe' },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const reason = err instanceof Error ? err.message : 'realtime-failed';
    return json({ ok: false, reason }, 502);
  }
  clearTimeout(timeout);

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => '');
    return json(
      { ok: false, reason: `openai-${upstream.status}`, detail: errBody.slice(0, 400) },
      502
    );
  }

  type OkSession = Extract<RealtimeSessionResponse, { ok: true }>['session'];
  const session = (await upstream.json().catch(() => null)) as OkSession | null;
  if (!session || typeof session !== 'object' || !session.client_secret?.value) {
    return json({ ok: false, reason: 'malformed-session' }, 502);
  }

  const payload: RealtimeSessionResponse = { ok: true, session };
  return json(payload, 200);
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
