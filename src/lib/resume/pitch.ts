// Role-fit pitch. Streams a Markdown pitch from gpt-4o-mini given a visitor's
// job posting / role description and John's CV as system context.
//
// Single direction: visitor describes a role; the model returns an honest
// pitch on whether and how John fits. Calls out gaps explicitly.

import { getCvRaw } from '../content';
import type { PitchDirection } from './types';

export interface PitchOptions {
  apiKey: string;
  /** Kept for back-compat with the existing endpoint shape. Only one direction is used. */
  direction: PitchDirection;
  /** Body of the job posting / role description / company info pasted by the visitor. */
  resumeText: string;
  /** Visitor's name or company. */
  visitorName?: string;
  signal?: AbortSignal;
}

export interface PitchUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface PitchStream {
  deltas: AsyncGenerator<string, void, void>;
  usage(): Promise<PitchUsage>;
}

const SYSTEM_PREAMBLE = [
  'You are the Role-Fit Pitch for John Cornelius\' portfolio site.',
  'The visitor has provided a job posting, role description, or company overview.',
  'John is NOT hiring — John is the candidate. Your job is to produce an honest,',
  'opinionated pitch in Markdown on whether and how John fits the role.',
  '',
  'Rules:',
  '- No preamble, no sign-off, no "Sure, here is" framing.',
  '- Markdown only. No code fences around the whole output.',
  '- Format: one bold verdict line ("Strong fit", "Partial fit", "Mismatch — here\'s why"), then 3-5 numbered points mapping John\'s actual experience to specific requirements in the role, then a short closing CTA.',
  '- Cite using `[John]` for claims drawn from John\'s CV, `[role]` for the role description.',
  '- Honesty over flattery. If the role requires Kubernetes and John has no visible Kubernetes experience, name it. If a "5+ years FAANG" line item is missing from John\'s record, name it. Real overlap > fake symmetry.',
  '- Lead with the strongest, most specific overlap. Examples beat adjectives: pull metrics, dates, system names from John\'s CV.',
  '- The CTA should suggest a 20-minute intro call to `corn82@icloud.com`, optionally naming one specific aspect of the role to discuss first.',
  '- Maximum ~280 words. Tight, scannable, no filler.',
].join('\n');

function buildSystemMessage(direction: PitchDirection, name: string | undefined, cv: string): string {
  // direction parameter retained for back-compat; we only do one direction now.
  void direction;
  void name;
  return [
    SYSTEM_PREAMBLE,
    '',
    '--- BEGIN John\'s CV ---',
    cv.trim(),
    '--- END John\'s CV ---',
  ].join('\n');
}

function buildUserMessage(roleText: string, name?: string): string {
  const header = name && name.trim() ? `Company or team: ${name.trim()}\n\n` : '';
  return (
    `${header}--- BEGIN role description ---\n${roleText.trim()}\n--- END role description ---\n\n` +
    'Produce the pitch now. Markdown only.'
  );
}

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
              // ignore
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
