// Pitch generation. Streams a Markdown pitch from gpt-4o-mini given the
// visitor's resume text, the chosen direction, and John's CV as system
// context.
//
// The prompt is opinionated: it must call out gaps, not flatter, and use the
// `[John]` / `[you]` citation convention so the reader can trace any claim
// back to its source.

import { getCvRaw } from '../content';
import type { PitchDirection } from './types';

export interface PitchOptions {
  apiKey: string;
  direction: PitchDirection;
  resumeText: string;
  visitorName?: string;
  /** Caller-supplied AbortSignal (e.g. when the SSE client disconnects). */
  signal?: AbortSignal;
}

export interface PitchUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface PitchStream {
  /** Async iterable of UTF-8 text deltas. */
  deltas: AsyncGenerator<string, void, void>;
  /** Resolves after the stream completes with whatever usage we could parse. */
  usage(): Promise<PitchUsage>;
}

const SYSTEM_PREAMBLE = [
  'You are the Resume Mirror for John Cornelius\' portfolio site.',
  'Your job is to produce an honest, opinionated pitch in Markdown.',
  '',
  'Rules:',
  '- No preamble, no sign-off, no "Sure, here is" framing.',
  '- Markdown only. No code fences around the whole output.',
  '- Format: one bold verdict line, then 3-5 numbered points, then a short',
  '  closing CTA paragraph (1-2 sentences).',
  '- Cite the source of every concrete claim. Use `[John]` when the claim',
  '  comes from John\'s CV, `[you]` when it comes from the visitor\'s resume.',
  '- Honesty over flattery. If John has no Kubernetes experience visible,',
  '  say so. If the visitor\'s years at FAANG do not outweigh John shipping',
  '  eight solo systems this year, say so. Real overlap > fake symmetry.',
  '- Surface gaps in the direction the pitch is going. A "hire John" pitch',
  '  should still name where John is thin. A "John should hire you" pitch',
  '  should still name where the visitor is thin.',
  '- Concrete examples beat adjectives. Pull specific systems, dates, and',
  '  metrics from both documents.',
  '- Maximum ~280 words. Tight, scannable, no filler.',
].join('\n');

function directionInstructions(direction: PitchDirection, name?: string): string {
  const visitor = name && name.trim() ? name.trim() : 'the visitor';
  if (direction === 'pitch-them-to-john') {
    return [
      `DIRECTION: Pitch JOHN to ${visitor} — i.e. ${visitor} is considering`,
      'hiring John or bringing him onto a project. Lead with the strongest',
      'overlap between John\'s actual work and what the visitor\'s resume',
      'implies they need. End with a CTA inviting them to reach out',
      '(`corn82@icloud.com`) with one specific question or scope.',
    ].join('\n');
  }
  return [
    `DIRECTION: Pitch ${visitor} to JOHN — i.e. argue whether John should`,
    'hire or collaborate with the visitor based on their resume. Be candid',
    'about fit: what they bring that John currently lacks, what looks',
    'redundant, and where they\'re thin for the kind of operator-grade',
    'systems John ships. End with a CTA telling the visitor what one piece',
    'of evidence (a repo, a write-up, a metric) would tip the scale.',
  ].join('\n');
}

function buildSystemMessage(direction: PitchDirection, name: string | undefined, cv: string): string {
  return [
    SYSTEM_PREAMBLE,
    '',
    directionInstructions(direction, name),
    '',
    '--- BEGIN John\'s CV ---',
    cv.trim(),
    '--- END John\'s CV ---',
  ].join('\n');
}

function buildUserMessage(resumeText: string, name?: string): string {
  const header = name && name.trim() ? `Visitor name: ${name.trim()}\n\n` : '';
  return (
    `${header}--- BEGIN visitor's resume ---\n${resumeText.trim()}\n--- END visitor's resume ---\n\n` +
    'Produce the pitch now. Markdown only.'
  );
}

/**
 * Open a streaming chat completion. Returns an async iterable of text deltas.
 * Throws synchronously only on the initial HTTP failure; per-chunk parsing
 * errors are swallowed (we just stop yielding).
 */
export async function streamPitch(opts: PitchOptions): Promise<PitchStream> {
  const cv = getCvRaw();
  if (!cv) throw new Error('pitch: CV source not available at build time');

  const system = buildSystemMessage(opts.direction, opts.visitorName, cv);
  const user = buildUserMessage(opts.resumeText, opts.visitorName);

  const body = {
    model: 'gpt-4o-mini',
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.4,
    max_tokens: 800,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`pitch-failed: ${res.status} ${errText.slice(0, 240)}`);
  }

  let resolveUsage: (u: PitchUsage) => void;
  const usagePromise = new Promise<PitchUsage>((r) => {
    resolveUsage = r;
  });
  let finalUsage: PitchUsage = {};

  async function* iterate(): AsyncGenerator<string, void, void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames separated by blank lines.
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) yield delta;
              if (parsed.usage) {
                finalUsage = {
                  prompt_tokens: parsed.usage.prompt_tokens,
                  completion_tokens: parsed.usage.completion_tokens,
                };
              }
            } catch {
              // Ignore non-JSON frames (comments, keepalives).
            }
          }
        }
      }
    } finally {
      resolveUsage(finalUsage);
    }
  }

  return {
    deltas: iterate(),
    usage: () => usagePromise,
  };
}
