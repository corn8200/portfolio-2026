// OpenAI text-embedding-3-small wrapper with batching, retry, and a
// per-day token budget tracked in KV. Used by both the Worker (re-embed
// the query at request time) and the offline ingest script.

import OpenAI from 'openai';
import type { Chunk, EmbedBudgetSnapshot, EmbeddedChunk, RuntimeEnv } from './types';

export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIMENSIONS = 1536;
/** OpenAI's per-call cap for the embeddings endpoint is 2048 inputs. We pick a
 * smaller batch to keep individual calls cheap to retry. */
export const BATCH_SIZE = 100;
/** $0.02 per 1M tokens for text-embedding-3-small. */
const USD_PER_MILLION_TOKENS = 0.02;
/** Best-effort default daily budget when the env var is missing. */
const DEFAULT_DAILY_BUDGET_USD = 25;

function isoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function budgetKey(date: string): string {
  return `embed-budget:${date}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BudgetGateOptions {
  kv?: KVNamespace;
  dailyBudgetUsd: number;
  estimatedTokens: number;
}

/**
 * Read the current day's budget snapshot from KV and refuse to proceed
 * if the projected USD spend would blow the cap. KV is optional — when
 * absent (e.g. running outside of a Worker), the check is a no-op.
 */
async function checkBudget(opts: BudgetGateOptions): Promise<EmbedBudgetSnapshot> {
  const today = isoDate();
  if (!opts.kv) {
    return { date: today, tokens: 0, requests: 0, estUsd: 0 };
  }
  const raw = await opts.kv.get(budgetKey(today));
  const snap: EmbedBudgetSnapshot = raw
    ? (JSON.parse(raw) as EmbedBudgetSnapshot)
    : { date: today, tokens: 0, requests: 0, estUsd: 0 };
  const projectedTokens = snap.tokens + opts.estimatedTokens;
  const projectedUsd = (projectedTokens / 1_000_000) * USD_PER_MILLION_TOKENS;
  if (projectedUsd > opts.dailyBudgetUsd) {
    throw new Error(
      `Embedding budget exceeded: projected $${projectedUsd.toFixed(4)} would cross daily cap $${opts.dailyBudgetUsd}.`,
    );
  }
  return snap;
}

async function recordSpend(kv: KVNamespace | undefined, tokens: number): Promise<void> {
  if (!kv) return;
  const today = isoDate();
  const raw = await kv.get(budgetKey(today));
  const snap: EmbedBudgetSnapshot = raw
    ? (JSON.parse(raw) as EmbedBudgetSnapshot)
    : { date: today, tokens: 0, requests: 0, estUsd: 0 };
  snap.tokens += tokens;
  snap.requests += 1;
  snap.estUsd = (snap.tokens / 1_000_000) * USD_PER_MILLION_TOKENS;
  // 36h TTL so the entry expires even if today rolls over without another write.
  await kv.put(budgetKey(today), JSON.stringify(snap), { expirationTtl: 60 * 60 * 36 });
}

interface EmbedCallOptions {
  client: OpenAI;
  inputs: string[];
  attempts?: number;
}

/**
 * One embedding call with exponential backoff. Throws after `attempts`
 * tries. Returns vectors + the prompt_tokens reported by the API.
 */
async function embedOnce(opts: EmbedCallOptions): Promise<{ vectors: number[][]; tokens: number }> {
  const attempts = opts.attempts ?? 5;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await opts.client.embeddings.create({
        model: EMBED_MODEL,
        input: opts.inputs,
      });
      const vectors = res.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding as number[]);
      const tokens = res.usage?.prompt_tokens ?? Math.ceil(opts.inputs.join(' ').length / 4);
      return { vectors, tokens };
    } catch (err) {
      lastErr = err;
      const backoff = Math.min(1000 * 2 ** i, 8000) + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('embedOnce failed');
}

export interface EmbedChunksOptions {
  env: Pick<RuntimeEnv, 'CACHE' | 'OPENAI_API_KEY' | 'OPENAI_DAILY_BUDGET_USD'>;
  chunks: Chunk[];
  /** When true, the budget check + spend record are skipped (offline scripts). */
  skipBudget?: boolean;
}

export interface EmbedChunksResult {
  embedded: EmbeddedChunk[];
  totalTokens: number;
  estUsd: number;
}

/**
 * Batched embed. Splits `chunks` into BATCH_SIZE groups, calls the API,
 * stitches the vectors back onto the chunks. Updates the daily budget
 * snapshot in KV when a CACHE binding is available.
 */
export async function embedChunks(opts: EmbedChunksOptions): Promise<EmbedChunksResult> {
  if (opts.chunks.length === 0) {
    return { embedded: [], totalTokens: 0, estUsd: 0 };
  }
  const client = new OpenAI({ apiKey: opts.env.OPENAI_API_KEY });
  const kv = opts.skipBudget ? undefined : opts.env.CACHE;
  const dailyBudget = Number(opts.env.OPENAI_DAILY_BUDGET_USD ?? DEFAULT_DAILY_BUDGET_USD);

  const estimatedTokens = opts.chunks.reduce((acc, c) => acc + c.approxTokens, 0);
  if (!opts.skipBudget) {
    await checkBudget({ kv, dailyBudgetUsd: dailyBudget, estimatedTokens });
  }

  const embedded: EmbeddedChunk[] = [];
  let totalTokens = 0;
  for (let i = 0; i < opts.chunks.length; i += BATCH_SIZE) {
    const batch = opts.chunks.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((c) => c.text);
    const { vectors, tokens } = await embedOnce({ client, inputs });
    if (vectors.length !== batch.length) {
      throw new Error(`Embedding mismatch: expected ${batch.length} vectors, got ${vectors.length}`);
    }
    for (let j = 0; j < batch.length; j++) {
      embedded.push({ ...batch[j], vector: vectors[j] });
    }
    totalTokens += tokens;
    if (!opts.skipBudget) {
      await recordSpend(kv, tokens);
    }
  }
  const estUsd = (totalTokens / 1_000_000) * USD_PER_MILLION_TOKENS;
  return { embedded, totalTokens, estUsd };
}

/**
 * Embed a single query string. Used in the retrieval path. Always
 * routed through the budget guard so spammy traffic can't burn the
 * budget on embed calls.
 */
export async function embedQuery(
  env: Pick<RuntimeEnv, 'CACHE' | 'OPENAI_API_KEY' | 'OPENAI_DAILY_BUDGET_USD'>,
  query: string,
): Promise<{ vector: number[]; tokens: number }> {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const dailyBudget = Number(env.OPENAI_DAILY_BUDGET_USD ?? DEFAULT_DAILY_BUDGET_USD);
  await checkBudget({
    kv: env.CACHE,
    dailyBudgetUsd: dailyBudget,
    estimatedTokens: Math.ceil(query.length / 4),
  });
  const { vectors, tokens } = await embedOnce({ client, inputs: [query] });
  await recordSpend(env.CACHE, tokens);
  return { vector: vectors[0], tokens };
}
