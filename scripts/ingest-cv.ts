// Offline ingest script: chunk cv-source.md + project case studies,
// embed via OpenAI, then upsert vectors into Cloudflare Vectorize via
// the REST API. Idempotent — chunks whose id + contentHash are
// already present in the index are skipped.
//
// Run with:
//   npx tsx scripts/ingest-cv.ts
//
// Reads OPENAI_API_KEY from .dev.vars and Cloudflare creds from
// 1Password via the service account token at
// ~/.config/op-service-account-token.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

import { chunkAll, parseFrontmatter } from '../src/lib/rag/chunker';
import type { Chunk } from '../src/lib/rag/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const CONTENT_DIR = join(ROOT, 'content');
const PROJECTS_DIR = join(CONTENT_DIR, 'projects');
const TMP_DIR = join(ROOT, '.tmp');
const INDEX_NAME = 'portfolio-cv';
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 1536;
const BATCH_SIZE = 100;
const USD_PER_MILLION_TOKENS = 0.02;

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[ingest]', ...args);
}

function readDevVars(): Record<string, string> {
  const path = join(ROOT, '.dev.vars');
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

function opRead(path: string): string {
  const token = readFileSync(`${process.env.HOME}/.config/op-service-account-token`, 'utf8').trim();
  const output = execFileSync('op', ['read', path], {
    env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: token },
    encoding: 'utf8',
  });
  return output.trim();
}

interface CloudflareCreds {
  accountId: string;
  email: string;
  globalApiKey: string;
}

function loadCloudflareCreds(): CloudflareCreds {
  return {
    accountId: opRead('op://MachineAutoBiz/CLOUDFLARE_ACCOUNT_ID/password'),
    email: opRead('op://MachineAutoBiz/CLOUDFLARE_EMAIL/password'),
    globalApiKey: opRead('op://MachineAutoBiz/CLOUDFLARE_GLOBAL_API_KEY/password'),
  };
}

function cfHeaders(creds: CloudflareCreds, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Auth-Email': creds.email,
    'X-Auth-Key': creds.globalApiKey,
    'Content-Type': 'application/json',
    ...extra,
  };
}

interface VectorizeDescribeResponse {
  result?: {
    name: string;
    config?: { dimensions?: number; metric?: string };
    vectorsCount?: number;
  };
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
}

async function describeIndex(creds: CloudflareCreds): Promise<VectorizeDescribeResponse> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/vectorize/v2/indexes/${INDEX_NAME}`,
    { headers: cfHeaders(creds) },
  );
  return (await res.json()) as VectorizeDescribeResponse;
}

interface VectorizeGetByIdsResponse {
  result?: Array<{
    id: string;
    values?: number[];
    metadata?: Record<string, unknown>;
  }>;
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
}

async function getExistingMetadata(
  creds: CloudflareCreds,
  ids: string[],
): Promise<Map<string, { contentHash?: string }>> {
  if (ids.length === 0) return new Map();
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/vectorize/v2/indexes/${INDEX_NAME}/get_by_ids`;
  const out = new Map<string, { contentHash?: string }>();
  // The endpoint accepts up to 20 ids per request.
  for (let i = 0; i < ids.length; i += 20) {
    const slice = ids.slice(i, i + 20);
    const res = await fetch(url, {
      method: 'POST',
      headers: cfHeaders(creds),
      body: JSON.stringify({ ids: slice }),
    });
    const body = (await res.json()) as VectorizeGetByIdsResponse;
    if (!body.success) {
      log('  get-by-ids non-fatal error:', body.errors);
      continue;
    }
    for (const row of body.result ?? []) {
      const meta = row.metadata ?? {};
      out.set(row.id, { contentHash: typeof meta.contentHash === 'string' ? meta.contentHash : undefined });
    }
  }
  return out;
}

interface UpsertVector {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

function toNdjson(vectors: UpsertVector[]): string {
  return vectors.map((v) => JSON.stringify(v)).join('\n') + '\n';
}

interface VectorizeUpsertResponse {
  result?: { mutationId?: string; count?: number };
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
}

async function upsertVectors(creds: CloudflareCreds, vectors: UpsertVector[]): Promise<number> {
  if (vectors.length === 0) return 0;
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/vectorize/v2/indexes/${INDEX_NAME}/upsert`;
  let total = 0;
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const slice = vectors.slice(i, i + BATCH_SIZE);
    const body = toNdjson(slice);
    const res = await fetch(url, {
      method: 'POST',
      headers: cfHeaders(creds, { 'Content-Type': 'application/x-ndjson' }),
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vectorize upsert failed: HTTP ${res.status} ${text.slice(0, 500)}`);
    }
    const parsed = (await res.json()) as VectorizeUpsertResponse;
    if (!parsed.success) {
      throw new Error(`Vectorize upsert non-success: ${JSON.stringify(parsed.errors)}`);
    }
    total += slice.length;
    log(`  upserted batch ${i / BATCH_SIZE + 1} (${slice.length} vectors, mutationId=${parsed.result?.mutationId ?? 'n/a'})`);
  }
  return total;
}

function loadCv(): string {
  return readFileSync(join(CONTENT_DIR, 'cv-source.md'), 'utf8');
}

function loadProjects(): Array<{ slug: string; title: string; raw: string }> {
  const files = readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const out: Array<{ slug: string; title: string; raw: string }> = [];
  for (const file of files) {
    const raw = readFileSync(join(PROJECTS_DIR, file), 'utf8');
    const { meta } = parseFrontmatter(raw);
    const slug = meta.slug ?? file.replace(/^project-|\.md$/g, '');
    const title = meta.title ?? slug;
    out.push({ slug, title, raw });
  }
  return out;
}

async function embedAll(client: OpenAI, chunks: Chunk[]): Promise<{ vectors: number[][]; tokens: number }> {
  const vectors: number[][] = [];
  let totalTokens = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    let attempt = 0;
    while (true) {
      try {
        const res = await client.embeddings.create({
          model: EMBED_MODEL,
          input: batch.map((c) => c.text),
        });
        const ordered = res.data.sort((a, b) => a.index - b.index);
        for (const item of ordered) vectors.push(item.embedding as number[]);
        totalTokens += res.usage?.prompt_tokens ?? 0;
        log(`  embedded batch ${i / BATCH_SIZE + 1} (${batch.length} chunks)`);
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 5) throw err;
        const wait = 1000 * 2 ** attempt;
        log(`  retry ${attempt} after error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  if (vectors.length !== chunks.length) {
    throw new Error(`embed mismatch: chunks=${chunks.length} vectors=${vectors.length}`);
  }
  return { vectors, tokens: totalTokens };
}

function chunkToMetadata(chunk: Chunk): Record<string, unknown> {
  return {
    source: chunk.source,
    docId: chunk.docId,
    heading: chunk.heading,
    url: chunk.url,
    text: chunk.text,
    approxTokens: chunk.approxTokens,
    contentHash: chunk.contentHash,
    ordinal: chunk.ordinal,
  };
}

interface IngestSummary {
  ranAt: string;
  index: string;
  totalChunks: number;
  newlyUpserted: number;
  skipped: number;
  failed: string[];
  embedTokens: number;
  estUsd: number;
  vectorizeAfter?: { vectors?: number };
}

async function main(): Promise<void> {
  log('starting');
  const devVars = readDevVars();
  const openaiKey = devVars.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY missing — set in .dev.vars or env');
  }
  const creds = loadCloudflareCreds();
  log('cloudflare account:', creds.accountId);

  const describe = await describeIndex(creds);
  if (!describe.success || !describe.result) {
    throw new Error(`Vectorize describe failed: ${JSON.stringify(describe.errors)}`);
  }
  const dims = describe.result.config?.dimensions;
  log(
    'index:',
    describe.result.name,
    'dimensions:',
    dims,
    'vectorsCount:',
    describe.result.vectorsCount ?? 0,
  );
  if (dims !== EMBED_DIMENSIONS) {
    throw new Error(
      `Vectorize index dimensions (${dims}) do not match embed model (${EMBED_DIMENSIONS})`,
    );
  }

  const cvRaw = loadCv();
  const projects = loadProjects();
  log(`loaded ${projects.length} project markdowns`);
  const allChunks = await chunkAll({ cvRaw, projects });
  log(`chunked ${allChunks.length} total`);

  const existing = await getExistingMetadata(creds, allChunks.map((c) => c.id));
  log(`existing index covers ${existing.size}/${allChunks.length} ids`);

  const toEmbed: Chunk[] = [];
  let skipped = 0;
  for (const chunk of allChunks) {
    const existingMeta = existing.get(chunk.id);
    if (existingMeta?.contentHash === chunk.contentHash) {
      skipped += 1;
      continue;
    }
    toEmbed.push(chunk);
  }
  log(`embed plan: ${toEmbed.length} new/changed, ${skipped} unchanged`);

  let newlyUpserted = 0;
  let totalTokens = 0;
  const failed: string[] = [];

  if (toEmbed.length > 0) {
    const client = new OpenAI({ apiKey: openaiKey });
    try {
      const { vectors, tokens } = await embedAll(client, toEmbed);
      totalTokens = tokens;
      const upsertPayload: UpsertVector[] = toEmbed.map((chunk, i) => ({
        id: chunk.id,
        values: vectors[i],
        metadata: chunkToMetadata(chunk),
      }));
      newlyUpserted = await upsertVectors(creds, upsertPayload);
    } catch (err) {
      log('FATAL during embed/upsert:', (err as Error).message);
      failed.push(`embed_or_upsert: ${(err as Error).message}`);
    }
  }

  let postDescribe: { vectors?: number } | undefined;
  try {
    const d = await describeIndex(creds);
    postDescribe = { vectors: d.result?.vectorsCount };
  } catch {
    // best-effort
  }

  const summary: IngestSummary = {
    ranAt: new Date().toISOString(),
    index: INDEX_NAME,
    totalChunks: allChunks.length,
    newlyUpserted,
    skipped,
    failed,
    embedTokens: totalTokens,
    estUsd: (totalTokens / 1_000_000) * USD_PER_MILLION_TOKENS,
    vectorizeAfter: postDescribe,
  };

  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  const summaryPath = join(TMP_DIR, 'ingest-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log('summary written:', summaryPath);
  log(JSON.stringify(summary, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  log('UNCAUGHT:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
