// Wire shapes for the Resume Mirror feature.
//
// Direction names match the visitor's mental model:
// - `pitch-them-to-john`  -> "Why you should hire John" (visitor is hiring)
// - `pitch-john-to-them`  -> "Why John should hire you" (visitor is candidate)
//
// The endpoint accepts the shorter `them-to-john` / `john-to-them` aliases on
// the wire to keep the form payload tidy; the canonical names live here.

export type PitchDirection = 'pitch-them-to-john' | 'pitch-john-to-them';

export type PitchDirectionWire = 'them-to-john' | 'john-to-them';

export function normalizeDirection(value: string | null | undefined): PitchDirection | null {
  switch (value) {
    case 'pitch-them-to-john':
    case 'them-to-john':
      return 'pitch-them-to-john';
    case 'pitch-john-to-them':
    case 'john-to-them':
      return 'pitch-john-to-them';
    default:
      return null;
  }
}

/** A multipart upload arrives as a `File`; JSON requests carry inline text. */
export interface ResumeMirrorRequest {
  direction: PitchDirection;
  /** Visitor-supplied name, optional. Used to humanize the opening line. */
  name?: string;
  /** Either a File (multipart) or a pre-extracted string (JSON path). */
  resume: File | string;
}

export interface ResumeMirrorUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  extract_ms?: number;
  pitch_ms?: number;
  cache_hit: boolean;
  extracted_chars: number;
}

/**
 * SSE event shape. We emit:
 * - `delta` per streamed token
 * - `done` once with `{ mode, usage }`
 * - `error` for terminal failures
 */
export type ResumeMirrorSseEvent =
  | { kind: 'delta'; delta: string }
  | { kind: 'done'; mode: PitchDirection; usage: ResumeMirrorUsage }
  | { kind: 'error'; message: string };

export interface ExtractResult {
  text: string;
  /** Source of the text — useful for debugging / observability. */
  source: 'text' | 'pdf-vision';
  pages?: number;
  extractMs: number;
}

/** Upper bound on visitor resume length we ship to the pitch model (chars). */
export const MAX_RESUME_CHARS = 12_000;

/** 4 MB upload cap, per spec. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Allowed MIME types / extensions for the drop-zone. */
export const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  // Some browsers send octet-stream for .md — we fall back to extension.
  'application/octet-stream',
]);

export const ALLOWED_EXT = new Set(['.pdf', '.txt', '.md']);
