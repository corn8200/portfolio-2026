// POST /api/resume-mirror
//
// Accepts either:
//   - multipart/form-data: { resume: File, direction, name? }
//   - application/json:    { resume: string, direction, name? }
//
// Streams an SSE response: { delta } chunks, then a terminal { done } chunk.
//
// Rate-limited 5/IP/hour against the shared KV. 4 MB upload cap. KV-cached
// by sha256(resumeText + direction) for 24h so a repeat submission with the
// same content doesn't re-bill the model.

import type { APIRoute } from 'astro';
import {
  ALLOWED_EXT,
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  normalizeDirection,
  type PitchDirection,
  type ResumeMirrorSseEvent,
  type ResumeMirrorUsage,
} from '@lib/resume/types';
import { extractResume } from '@lib/resume/extract';
import { streamPitch } from '@lib/resume/pitch';
import { checkAndIncrement, clientIp } from '@lib/resume/ratelimit';

export const prerender = false;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function jsonError(status: number, reason: string): Response {
  return new Response(JSON.stringify({ ok: false, reason }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseEvent(ev: ResumeMirrorSseEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function hasAllowedExt(filename: string): boolean {
  const lower = filename.toLowerCase();
  for (const ext of ALLOWED_EXT) if (lower.endsWith(ext)) return true;
  return false;
}

type ParsedInput =
  | { kind: 'text'; text: string; name?: string; direction: PitchDirection }
  | { kind: 'file'; bytes: Uint8Array; filename: string; name?: string; direction: PitchDirection };

async function parseInput(request: Request): Promise<ParsedInput | Response> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, 'invalid multipart payload');
    }

    const direction = normalizeDirection(form.get('direction')?.toString() ?? null);
    if (!direction) return jsonError(400, 'invalid direction');

    const name = form.get('name')?.toString().slice(0, 120) || undefined;
    const resume = form.get('resume');

    if (resume instanceof File) {
      if (resume.size === 0) return jsonError(400, 'empty file');
      if (resume.size > MAX_UPLOAD_BYTES) return jsonError(413, 'file too large (max 4 MB)');
      const mimeOk = ALLOWED_MIME.has(resume.type) || hasAllowedExt(resume.name);
      const extOk = hasAllowedExt(resume.name);
      if (!mimeOk && !extOk) return jsonError(415, 'unsupported file type — pdf / txt / md only');

      const buf = new Uint8Array(await resume.arrayBuffer());
      return { kind: 'file', bytes: buf, filename: resume.name, name, direction };
    }

    if (typeof resume === 'string' && resume.trim()) {
      return { kind: 'text', text: resume, name, direction };
    }

    return jsonError(400, 'missing resume');
  }

  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid json payload');
    }
    const obj = body as { direction?: string; resume?: string; name?: string };
    const direction = normalizeDirection(obj.direction ?? null);
    if (!direction) return jsonError(400, 'invalid direction');
    if (typeof obj.resume !== 'string' || !obj.resume.trim()) return jsonError(400, 'missing resume');
    if (obj.resume.length > MAX_UPLOAD_BYTES) return jsonError(413, 'resume too large');
    return {
      kind: 'text',
      text: obj.resume,
      name: obj.name?.slice(0, 120),
      direction,
    };
  }

  return jsonError(415, 'unsupported content-type — use multipart/form-data or application/json');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as unknown as { runtime?: { env: Env } }).runtime?.env;
  if (!env) return jsonError(500, 'runtime bindings unavailable');
  if (!env.OPENAI_API_KEY) return jsonError(500, 'missing OPENAI_API_KEY');

  const ip = clientIp(request);
  const limit = Number.parseInt(env.RATE_LIMIT_RESUME_PER_IP_PER_HOUR ?? '5', 10) || 5;

  const rl = await checkAndIncrement(env.CACHE, {
    endpoint: 'resume-mirror',
    ip,
    limit,
  });
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'rate-limited', resetAt: rl.resetAt }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
        },
      },
    );
  }

  const parsed = await parseInput(request);
  if (parsed instanceof Response) return parsed;

  // Extract.
  let extracted: { text: string; source: 'text' | 'pdf-vision'; extractMs: number };
  try {
    if (parsed.kind === 'text') {
      extracted = await extractResume({ text: parsed.text });
    } else {
      extracted = await extractResume({
        bytes: parsed.bytes,
        filename: parsed.filename,
        openaiApiKey: env.OPENAI_API_KEY,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'extract failed';
    return jsonError(422, `could not extract resume: ${msg}`);
  }

  if (!extracted.text.trim()) {
    return jsonError(422, 'resume appears empty after extraction');
  }

  const cacheKey = `resume-mirror:${await sha256Hex(extracted.text + '\n' + parsed.direction)}`;
  const cached = await env.CACHE.get(cacheKey);

  const direction = parsed.direction;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (ev: ResumeMirrorSseEvent) => controller.enqueue(encoder.encode(sseEvent(ev)));

      const pitchStart = Date.now();
      try {
        if (cached) {
          // Replay cached markdown as a single delta so the client renderer
          // is identical between fresh and cached paths.
          send({ kind: 'delta', delta: cached });
          const usage: ResumeMirrorUsage = {
            cache_hit: true,
            extracted_chars: extracted.text.length,
            extract_ms: extracted.extractMs,
            pitch_ms: Date.now() - pitchStart,
          };
          send({ kind: 'done', mode: direction, usage });
          controller.close();
          return;
        }

        const pitch = await streamPitch({
          apiKey: env.OPENAI_API_KEY,
          direction,
          resumeText: extracted.text,
          visitorName: parsed.name,
          signal: request.signal,
        });

        let collected = '';
        for await (const delta of pitch.deltas) {
          collected += delta;
          send({ kind: 'delta', delta });
        }

        const usageRaw = await pitch.usage();
        const usage: ResumeMirrorUsage = {
          cache_hit: false,
          extracted_chars: extracted.text.length,
          extract_ms: extracted.extractMs,
          pitch_ms: Date.now() - pitchStart,
          prompt_tokens: usageRaw.prompt_tokens,
          completion_tokens: usageRaw.completion_tokens,
        };

        // 24h cache (KV minimum TTL is 60s; 86400 is well above that).
        if (collected.trim()) {
          await env.CACHE.put(cacheKey, collected, { expirationTtl: 60 * 60 * 24 });
        }

        send({ kind: 'done', mode: direction, usage });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        try {
          send({ kind: 'error', message: msg });
        } catch {
          // controller already closed
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
};

export const GET: APIRoute = () => jsonError(405, 'use POST');
