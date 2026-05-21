// Shared types for the RAG pipeline.
//
// Lives between the chunker, embedder, retriever, and the public Ask
// endpoint. Endpoint code imports from here so the wire shape stays
// consistent with the worker-side and the offline ingest script.

/**
 * The runtime bindings injected by `@astrojs/cloudflare`. The shape mirrors
 * `wrangler.toml` (CACHE / CV_INDEX / AI) plus the Pages secrets that
 * we read inside endpoints via `Astro.locals.runtime.env`.
 */
export interface RuntimeEnv {
  CACHE: KVNamespace;
  CV_INDEX: VectorizeIndex;
  AI: Ai;
  OPENAI_API_KEY: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  SITE_VERSION?: string;
  OPENAI_DAILY_BUDGET_USD?: string;
  // Visitor-conversation email notification (Resend).
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL_TO?: string;
  NOTIFY_EMAIL_FROM?: string;
}

/**
 * Source kind for a chunk. Drives the id prefix and how the citation
 * renders in the UI (CV section vs. project case study).
 */
export type ChunkSource = 'cv' | 'project';

/**
 * A discrete unit the embedder sees. The id is stable (slug + section +
 * ordinal) so re-ingests are idempotent — same id + same content hash =
 * skip. Token count is approximate (chars/4) and only used for budgeting,
 * not as ground truth.
 */
export interface Chunk {
  id: string;
  source: ChunkSource;
  /** Project slug for project chunks, "cv" for the CV. */
  docId: string;
  /** Human-visible label for citations (e.g. "About", "Overseer / Reliability"). */
  heading: string;
  /** Path to the page that should be linked from the citation. */
  url: string;
  /** Raw markdown body of the chunk. */
  text: string;
  /** Approximate token count (chars / 4). */
  approxTokens: number;
  /** sha256 hex of `text`. Used to detect drift between source and index. */
  contentHash: string;
  /** Ordinal within (docId, section) for stable ordering. */
  ordinal: number;
}

/**
 * A chunk that has been embedded. The vector is 1536 floats per
 * `text-embedding-3-small`. Metadata is what we round-trip through
 * Vectorize so the retriever can render citations without a second
 * fetch.
 */
export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

/**
 * Citation surfaced to the client. Numbered to match `[n]` markers in
 * the answer text.
 */
export interface Citation {
  n: number;
  id: string;
  heading: string;
  url: string;
  /** A short excerpt (<= 240 chars) — enough to verify by eye. */
  excerpt: string;
  /** Cosine similarity from Vectorize (0..1). */
  score: number;
}

/**
 * A retrieved chunk pre-citation — keeps the raw fields the answer
 * step needs to build the prompt context.
 */
export interface RetrievedChunk {
  chunk: Chunk;
  score: number;
}

export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskRequest {
  query: string;
  history?: AskMessage[];
}

export interface AskUsage {
  retrieval_ms: number;
  embed_tokens: number;
  /** Token usage for the answer LLM call, when known. */
  completion_tokens?: number;
  prompt_tokens?: number;
  cache_hit: boolean;
  vector_matches: number;
}

export interface AskResponse {
  text: string;
  citations: Citation[];
  usage: AskUsage;
}

/**
 * SSE event shape the client decodes. We emit:
 * - `delta` for streamed text tokens
 * - `done` once with `{ citations, usage }` and `text` empty
 * - `error` for terminal failures
 */
export type AskSseEvent =
  | { kind: 'delta'; delta: string }
  | { kind: 'done'; citations: Citation[]; usage: AskUsage }
  | { kind: 'error'; message: string };

/**
 * Daily embedding budget snapshot kept in KV under
 * `embed-budget:${YYYY-MM-DD}`. Tokens are summed across calls so a
 * runaway re-ingest does not silently nuke the OpenAI bill.
 */
export interface EmbedBudgetSnapshot {
  date: string;
  tokens: number;
  requests: number;
  estUsd: number;
}

/** Result returned from `health.ts` for monitoring. */
export interface HealthResponse {
  ok: boolean;
  services: {
    kv: { ok: boolean; latency_ms?: number; error?: string };
    vectorize: { ok: boolean; latency_ms?: number; vectors?: number; error?: string };
    openai: { ok: boolean; latency_ms?: number; error?: string };
  };
  build_id: string;
}
