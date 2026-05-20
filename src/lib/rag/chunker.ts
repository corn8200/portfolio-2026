// Markdown chunker for cv-source.md and project case studies.
//
// Splits each source on H2/H3 headings, then packs paragraphs into
// ~600-token windows so a single chunk holds enough context to answer
// a focused question on its own. Preserves the heading trail as
// metadata so the citation shows where the snippet came from.

import type { Chunk, ChunkSource } from './types';

const TARGET_TOKENS = 600;
const HARD_TOKEN_LIMIT = 850;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function parseFrontmatter(raw: string): {
  body: string;
  meta: { title?: string; slug?: string; summary?: string };
} {
  if (!raw.startsWith('---')) return { body: raw, meta: {} };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { body: raw, meta: {} };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  const meta: { title?: string; slug?: string; summary?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].replace(/^"|"$/g, '').trim();
    if (key === 'title' || key === 'slug' || key === 'summary') meta[key] = value;
  }
  return { body, meta };
}

function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

function slugifyHeading(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'section';
}

interface Section {
  trail: string;
  slug: string;
  body: string;
}

function splitSections(body: string, docTitle: string): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  let h2: string | null = null;
  let h3: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (!text) {
      buffer = [];
      return;
    }
    const parts: string[] = [docTitle];
    if (h2) parts.push(h2);
    if (h3) parts.push(h3);
    const trail = parts.join(' / ');
    const slug = slugifyHeading(h3 ?? h2 ?? docTitle);
    sections.push({ trail, slug, body: text });
    buffer = [];
  };

  for (const line of lines) {
    const m2 = /^##\s+(.+?)\s*$/.exec(line);
    const m3 = /^###\s+(.+?)\s*$/.exec(line);
    if (m2) {
      flush();
      h2 = m2[1].trim();
      h3 = null;
      continue;
    }
    if (m3) {
      flush();
      h3 = m3[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (sections.length === 0) {
    const text = body.trim();
    if (text) sections.push({ trail: docTitle, slug: slugifyHeading(docTitle), body: text });
  }

  return sections;
}

function packParagraphs(body: string): string[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const windows: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length) {
      windows.push(current.join('\n\n'));
      current = [];
      currentTokens = 0;
    }
  };

  for (const para of paragraphs) {
    const t = approxTokens(para);
    if (t > HARD_TOKEN_LIMIT) {
      flush();
      const sentences = para.split(/(?<=[.!?])\s+/);
      let bucket: string[] = [];
      let bucketTokens = 0;
      for (const s of sentences) {
        const st = approxTokens(s);
        if (bucketTokens + st > TARGET_TOKENS && bucket.length) {
          windows.push(bucket.join(' '));
          bucket = [];
          bucketTokens = 0;
        }
        bucket.push(s);
        bucketTokens += st;
      }
      if (bucket.length) windows.push(bucket.join(' '));
      continue;
    }
    if (currentTokens + t > TARGET_TOKENS && current.length) {
      flush();
    }
    current.push(para);
    currentTokens += t;
  }
  flush();
  return windows;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function buildChunkId(source: ChunkSource, docId: string, sectionSlug: string, ordinal: number): string {
  const prefix = source === 'cv' ? 'cv' : 'proj';
  return `${prefix}:${docId}:${sectionSlug}:${ordinal}`;
}

export interface ChunkInput {
  source: ChunkSource;
  docId: string;
  docTitle: string;
  url: string;
  raw: string;
}

export async function chunkDoc(input: ChunkInput): Promise<Chunk[]> {
  const { body } = parseFrontmatter(input.raw);
  const cleaned = stripHtmlComments(body).trim();
  const sections = splitSections(cleaned, input.docTitle);

  const out: Chunk[] = [];
  for (const section of sections) {
    const windows = packParagraphs(section.body);
    for (let i = 0; i < windows.length; i++) {
      const text = windows[i];
      const ordinal = i + 1;
      const id = buildChunkId(input.source, input.docId, section.slug, ordinal);
      const contentHash = await sha256Hex(text);
      out.push({
        id,
        source: input.source,
        docId: input.docId,
        heading: section.trail,
        url: input.url,
        text,
        approxTokens: approxTokens(text),
        contentHash,
        ordinal,
      });
    }
  }
  return out;
}

export async function chunkAll(args: {
  cvRaw: string;
  projects: Array<{ slug: string; title: string; raw: string }>;
}): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  const cvChunks = await chunkDoc({
    source: 'cv',
    docId: 'cv',
    docTitle: 'John Cornelius',
    url: '/',
    raw: args.cvRaw,
  });
  chunks.push(...cvChunks);

  for (const project of args.projects) {
    const projectChunks = await chunkDoc({
      source: 'project',
      docId: project.slug,
      docTitle: project.title,
      url: `/work/${project.slug}`,
      raw: project.raw,
    });
    chunks.push(...projectChunks);
  }
  return chunks;
}
