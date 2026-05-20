// Resume text extraction.
//
// Two paths:
// 1. Plain text/markdown: strip and return.
// 2. PDF: hand the raw bytes to OpenAI's Responses API as an `input_file`
//    with base64-encoded `file_data`. gpt-4o-mini handles PDF rendering on
//    OpenAI's side — Cloudflare Workers do not ship a PDF rasterizer and
//    pdf-parse would balloon the bundle. We cap at 6 pages by truncating
//    output if the model goes long; the upstream 4 MB file cap is the real
//    primary bound.
//
// Returns the extracted UTF-8 text plus light source metadata for logging.

import type { ExtractResult } from './types';
import { MAX_RESUME_CHARS } from './types';

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}

function toBase64(bytes: Uint8Array): string {
  // Chunked to avoid blowing the call stack on large inputs.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa is available in the Workers runtime.
  return btoa(binary);
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n\n[...truncated]';
}

export interface ExtractInput {
  bytes?: Uint8Array;
  text?: string;
  filename?: string;
  /** OpenAI API key — needed only for the PDF path. */
  openaiApiKey?: string;
}

const PDF_PROMPT =
  'Extract every line of text from this resume PDF. Preserve section ' +
  'headings, role titles, dates, and bullet structure. Output plain text ' +
  'only — no commentary, no markdown decoration beyond newlines. Cover at ' +
  'most the first 6 pages; if there are more, stop and append the line ' +
  '"[additional pages omitted]".';

async function extractPdfViaOpenAI(bytes: Uint8Array, apiKey: string, filename: string): Promise<string> {
  const base64 = toBase64(bytes);
  const body = {
    model: 'gpt-4o-mini',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: filename || 'resume.pdf',
            file_data: `data:application/pdf;base64,${base64}`,
          },
          { type: 'input_text', text: PDF_PROMPT },
        ],
      },
    ],
    max_output_tokens: 4000,
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`pdf-extract-failed: ${res.status} ${errText.slice(0, 240)}`);
  }

  const json = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  // Prefer the convenience field; fall back to the structured output.
  if (typeof json.output_text === 'string' && json.output_text.trim()) {
    return json.output_text.trim();
  }
  const collected: string[] = [];
  for (const item of json.output ?? []) {
    for (const c of item.content ?? []) {
      if (c?.type === 'output_text' && typeof c.text === 'string') collected.push(c.text);
    }
  }
  const joined = collected.join('\n').trim();
  if (!joined) throw new Error('pdf-extract-empty');
  return joined;
}

/** Strip text resumes down to a tidy UTF-8 string. */
function cleanText(s: string): string {
  // Normalize newlines and drop control characters except \n and \t.
  // eslint-disable-next-line no-control-regex
  const stripped = s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  // Collapse runs of >2 blank lines.
  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractResume(input: ExtractInput): Promise<ExtractResult> {
  const start = Date.now();

  if (typeof input.text === 'string' && input.text.length > 0) {
    const text = clamp(cleanText(input.text), MAX_RESUME_CHARS);
    return { text, source: 'text', extractMs: Date.now() - start };
  }

  if (!input.bytes || input.bytes.length === 0) {
    throw new Error('extract: no input provided');
  }

  const isPdf =
    looksLikePdf(input.bytes) ||
    (input.filename ?? '').toLowerCase().endsWith('.pdf');

  if (isPdf) {
    if (!input.openaiApiKey) throw new Error('extract: missing OPENAI_API_KEY for PDF extraction');
    const raw = await extractPdfViaOpenAI(input.bytes, input.openaiApiKey, input.filename ?? 'resume.pdf');
    const text = clamp(cleanText(raw), MAX_RESUME_CHARS);
    return { text, source: 'pdf-vision', extractMs: Date.now() - start };
  }

  // Treat as UTF-8 text.
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = clamp(cleanText(decoder.decode(input.bytes)), MAX_RESUME_CHARS);
  return { text, source: 'text', extractMs: Date.now() - start };
}
