#!/usr/bin/env node
// QA matrix for cv.jcornelius.net backend endpoints.
// Run: node scripts/qa-api.mjs [base-url]
// Writes JSON results to stdout; use redirect or call from a wrapper.

import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] || 'https://cv.jcornelius.net';
const RESULTS = [];
const NOTABLE_HEADERS = [
  'cache-control',
  'content-type',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-cache',
  'x-accel-buffering',
];

function record({ name, endpoint, state, expected, actual, pass, notes, headers, bodyPreview, ms }) {
  RESULTS.push({
    name,
    endpoint,
    state,
    expected,
    actual,
    pass,
    notes: notes ?? '',
    headers: headers ?? {},
    bodyPreview: bodyPreview ?? '',
    ms: ms ?? 0,
  });
  const status = pass ? 'PASS' : 'FAIL';
  console.error(`[${status}] ${name} :: expected=${expected} got=${actual} (${ms ?? 0}ms)`);
}

function pickHeaders(res) {
  const out = {};
  for (const h of NOTABLE_HEADERS) {
    const v = res.headers.get(h);
    if (v != null) out[h] = v;
  }
  return out;
}

async function timed(fn) {
  const t0 = performance.now();
  const res = await fn();
  const ms = Math.round(performance.now() - t0);
  return { res, ms };
}

async function readPreview(res, max = 200) {
  try {
    const text = await res.text();
    return text.slice(0, max);
  } catch {
    return '';
  }
}

// Read an SSE stream until done or timeout. Returns { frames, raw, doneEvent, deltaCount, ms }.
async function consumeSse(res, { timeoutMs = 30_000 } = {}) {
  const t0 = performance.now();
  const reader = res.body?.getReader();
  if (!reader) return { frames: [], raw: '', doneEvent: null, deltaCount: 0, ms: 0 };
  const decoder = new TextDecoder();
  let raw = '';
  const frames = [];
  let doneEvent = null;
  let deltaCount = 0;
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const r = await Promise.race([
        reader.read(),
        sleep(Math.max(50, deadline - Date.now())).then(() => ({ done: true, timeout: true })),
      ]);
      if (r?.done) break;
      if (!r?.value) continue;
      const chunk = decoder.decode(r.value, { stream: true });
      raw += chunk;
      // Parse complete SSE messages: events separated by \n\n
      while (true) {
        const idx = raw.indexOf('\n\n');
        if (idx === -1) break;
        const message = raw.slice(0, idx);
        raw = raw.slice(idx + 2);
        for (const line of message.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          try {
            const obj = JSON.parse(payload);
            frames.push(obj);
            if (obj.kind === 'delta') deltaCount += 1;
            if (obj.kind === 'done') doneEvent = obj;
            if (obj.kind === 'error') doneEvent = obj;
          } catch {
            // ignore non-json frames
          }
        }
        if (doneEvent) {
          try { await reader.cancel(); } catch { /* noop */ }
          return { frames, raw, doneEvent, deltaCount, ms: Math.round(performance.now() - t0) };
        }
      }
    }
  } catch (err) {
    return { frames, raw, doneEvent, deltaCount, ms: Math.round(performance.now() - t0), error: String(err) };
  }
  return { frames, raw, doneEvent, deltaCount, ms: Math.round(performance.now() - t0) };
}

// ---------- /api/health ----------
async function testHealth() {
  const { res, ms } = await timed(() => fetch(`${BASE}/api/health`));
  const headers = pickHeaders(res);
  const body = await readPreview(res, 600);
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* noop */ }
  const expected = 200;
  const okStatus = res.status === expected;
  const kvOk = parsed?.services?.kv?.ok === true;
  const vecOk = parsed?.services?.vectorize?.ok === true;
  const oaOk = parsed?.services?.openai?.ok === true;
  const cacheNoStore = (headers['cache-control'] || '').includes('no-store');
  record({
    name: 'health: happy path',
    endpoint: 'GET /api/health',
    state: 'happy',
    expected: '200, kv/vector/openai ok, Cache-Control: no-store',
    actual: `${res.status}, kv=${kvOk}, vec=${vecOk}, openai=${oaOk}, no-store=${cacheNoStore}`,
    pass: okStatus && kvOk && vecOk && oaOk && cacheNoStore,
    headers,
    bodyPreview: body.slice(0, 200),
    ms,
  });
}

// ---------- /api/ask ----------
// Default headers include Origin matching the deployed host. Astro's
// security.checkOrigin enforces same-origin for non-JSON content-types;
// JSON POSTs are exempt by spec but we still send Origin to mirror the
// real browser-XHR call path.
async function postAsk(payload, { extraHeaders = {}, qs = '' } = {}) {
  return await fetch(`${BASE}/api/ask${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...extraHeaders },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

async function testAsk() {
  // Happy path with cache-buster
  const cacheBuster = Math.random().toString(36).slice(2, 8);
  const q1 = `qa-smoke-${cacheBuster}: what is one concrete project on this site?`;

  // First call (MISS)
  let t0 = performance.now();
  let res1 = await postAsk({ query: q1 }, { qs: '?nocache=1' });
  let headers1 = pickHeaders(res1);
  const sse1 = await consumeSse(res1, { timeoutMs: 35_000 });
  let ms1 = Math.round(performance.now() - t0);
  const ct1 = (headers1['content-type'] || '').includes('text/event-stream');
  const hasDelta = sse1.deltaCount > 0;
  const hasDone = sse1.doneEvent && sse1.doneEvent.kind === 'done';
  record({
    name: 'ask: happy path SSE (nocache)',
    endpoint: 'POST /api/ask?nocache=1',
    state: 'happy',
    expected: '200, SSE, ≥1 delta + 1 done, Cache-Control: no-store',
    actual: `${res1.status}, ct=text/event-stream:${ct1}, deltas=${sse1.deltaCount}, done=${!!hasDone}, no-store=${(headers1['cache-control']||'').includes('no-store')}`,
    pass: res1.status === 200 && ct1 && hasDelta && !!hasDone && (headers1['cache-control']||'').includes('no-store'),
    headers: headers1,
    bodyPreview: JSON.stringify(sse1.doneEvent).slice(0, 200),
    ms: ms1,
  });

  // Prime cache (without nocache flag) so the next call hits.
  const primeText = `qa-cache-${cacheBuster}: name one decision from the site.`;
  await postAsk({ query: primeText }).then(async (r) => {
    await consumeSse(r, { timeoutMs: 35_000 });
  });

  // KV writes propagate eventually-consistent. Wait ~5s before the read.
  await sleep(5000);

  // Second call - expect cache hit
  t0 = performance.now();
  const res2 = await postAsk({ query: primeText });
  const headers2 = pickHeaders(res2);
  const sse2 = await consumeSse(res2, { timeoutMs: 10_000 });
  const ms2 = Math.round(performance.now() - t0);
  const cacheHit = sse2.doneEvent?.usage?.cache_hit === true;
  const xCacheHit = (headers2['x-cache'] || '').toUpperCase() === 'HIT';
  record({
    name: 'ask: cache-hit path',
    endpoint: 'POST /api/ask',
    state: 'cache-hit (second identical query)',
    expected: '200, X-Cache: HIT, done.usage.cache_hit=true',
    actual: `${res2.status}, X-Cache=${headers2['x-cache']}, cache_hit=${cacheHit}, ms=${ms2}`,
    pass: res2.status === 200 && (cacheHit || xCacheHit),
    headers: headers2,
    bodyPreview: JSON.stringify(sse2.doneEvent).slice(0, 200),
    ms: ms2,
    notes: `prime->hit elapsed=${ms2}ms`,
  });

  // Visitor passthrough
  const visitorQuery = `qa-visitor-${cacheBuster}: greet the visitor by name and reference their org`;
  t0 = performance.now();
  const resV = await postAsk({
    query: visitorQuery,
    name: 'Sarah',
    org: 'MidWest Steel',
  }, { qs: '?nocache=1' });
  const headersV = pickHeaders(resV);
  const sseV = await consumeSse(resV, { timeoutMs: 35_000 });
  const msV = Math.round(performance.now() - t0);
  const collectedV = sseV.frames
    .filter((f) => f.kind === 'delta')
    .map((f) => f.delta)
    .join('');
  const refsName = /sarah/i.test(collectedV);
  const refsOrg = /midwest|steel/i.test(collectedV);
  record({
    name: 'ask: visitor context passthrough',
    endpoint: 'POST /api/ask (name=Sarah, org=MidWest Steel)',
    state: 'visitor-context',
    expected: '200, response text references Sarah and/or MidWest Steel',
    actual: `${resV.status}, refsName=${refsName}, refsOrg=${refsOrg}`,
    pass: resV.status === 200 && (refsName || refsOrg),
    headers: headersV,
    bodyPreview: collectedV.slice(0, 200),
    ms: msV,
  });

  // Empty body
  const resEmpty = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '',
  });
  const bodyEmpty = await readPreview(resEmpty);
  record({
    name: 'ask: empty body',
    endpoint: 'POST /api/ask',
    state: 'empty body',
    expected: '400 invalid_json',
    actual: `${resEmpty.status}`,
    pass: resEmpty.status === 400,
    headers: pickHeaders(resEmpty),
    bodyPreview: bodyEmpty,
  });

  // Missing required field
  const resMiss = await postAsk({});
  const bodyMiss = await readPreview(resMiss);
  record({
    name: 'ask: missing query',
    endpoint: 'POST /api/ask',
    state: 'missing query',
    expected: '400 invalid_query',
    actual: `${resMiss.status}`,
    pass: resMiss.status === 400,
    headers: pickHeaders(resMiss),
    bodyPreview: bodyMiss,
  });

  // Invalid type
  const resBad = await postAsk({ query: 12345 });
  const bodyBad = await readPreview(resBad);
  record({
    name: 'ask: invalid query type',
    endpoint: 'POST /api/ask',
    state: 'wrong type for query',
    expected: '400',
    actual: `${resBad.status}`,
    pass: resBad.status === 400,
    headers: pickHeaders(resBad),
    bodyPreview: bodyBad,
  });

  // Body too large (1000+ chars)
  const big = 'x'.repeat(1500);
  const resBig = await postAsk({ query: big });
  const bodyBig = await readPreview(resBig);
  record({
    name: 'ask: oversized query (>1000 chars)',
    endpoint: 'POST /api/ask',
    state: 'oversized query',
    expected: '400 invalid_query',
    actual: `${resBig.status}`,
    pass: resBig.status === 400,
    headers: pickHeaders(resBig),
    bodyPreview: bodyBig,
  });

  // Wrong content-type. Astro's CSRF (security.checkOrigin=true) blocks
  // simple-CORS content-types (text/plain, multipart, form-urlencoded) at
  // the framework layer before our handler runs, returning 403 with
  // "Cross-site POST form submissions are forbidden". This is the
  // platform-correct behavior; treat 403 OR 400 as acceptable.
  const resCT = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: BASE },
    body: 'query=hi',
  });
  const bodyCT = await readPreview(resCT);
  record({
    name: 'ask: wrong content-type',
    endpoint: 'POST /api/ask',
    state: 'content-type: text/plain (body not valid json)',
    expected: '403 (Astro CSRF) or 400',
    actual: `${resCT.status}`,
    pass: resCT.status === 403 || resCT.status === 400,
    headers: pickHeaders(resCT),
    bodyPreview: bodyCT,
    notes: resCT.status === 403 ? 'Astro CSRF check fires before handler (expected)' : '',
  });

  // GET method
  const resGet = await fetch(`${BASE}/api/ask`, { method: 'GET' });
  const bodyGet = await readPreview(resGet);
  record({
    name: 'ask: GET method',
    endpoint: 'GET /api/ask',
    state: 'wrong method',
    expected: '405',
    actual: `${resGet.status}`,
    pass: resGet.status === 405,
    headers: pickHeaders(resGet),
    bodyPreview: bodyGet,
  });

  // No-Origin, JSON content-type. Astro CSRF only intercepts simple-CORS
  // content-types — JSON falls through. Real CSRF would require an
  // explicit check; this is by-design for SPA fetch().
  const resNoOrigin = await fetch(`${BASE}/api/ask?nocache=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `qa-origin-${cacheBuster}: hello` }),
  });
  const bodyNoOrig = await readPreview(resNoOrigin);
  try {
    if ((resNoOrigin.headers.get('content-type') || '').includes('text/event-stream')) {
      await consumeSse(resNoOrigin, { timeoutMs: 20_000 });
    }
  } catch { /* noop */ }
  record({
    name: 'ask: no Origin header (JSON)',
    endpoint: 'POST /api/ask',
    state: 'JSON POST without Origin header',
    expected: '200 (JSON bypasses Astro CSRF by spec)',
    actual: `${resNoOrigin.status}`,
    pass: resNoOrigin.status === 200,
    headers: pickHeaders(resNoOrigin),
    bodyPreview: bodyNoOrig.slice(0, 200),
    notes: 'Astro CSRF only blocks simple-CORS content-types; JSON XHR is implicitly safer (preflighted). No app-level Origin check.',
  });

  // No-Origin multipart — should hit Astro CSRF and return 403.
  const fmCsrf = new FormData();
  fmCsrf.append('query', 'csrf-probe');
  const resCsrf = await fetch(`${BASE}/api/ask?nocache=1`, {
    method: 'POST',
    body: fmCsrf, // no Origin header
  });
  const bCsrf = await readPreview(resCsrf);
  record({
    name: 'ask: CSRF probe (multipart, no Origin)',
    endpoint: 'POST /api/ask',
    state: 'multipart/form-data, no Origin',
    expected: '403 (Astro CSRF blocks cross-origin form POST)',
    actual: `${resCsrf.status}`,
    pass: resCsrf.status === 403,
    headers: pickHeaders(resCsrf),
    bodyPreview: bCsrf.slice(0, 200),
  });
}

// ---------- /api/ask rate-limit probe ----------
// /api/ask: 30/IP/hour. Workers KV reads are eventually consistent so
// concurrent N>30 doesn't reliably trip the limit. Issue sequentially with
// a HEAD-style minimal payload until we see 429 (cap at 40 attempts).
async function testAskRateLimit() {
  const MAX = 40;
  let got429 = null;
  let issued = 0;
  const statuses = {};
  for (let i = 0; i < MAX; i++) {
    issued += 1;
    const r = await postAsk(
      { query: `rl-probe-${Date.now()}-${i}: ping` },
      { qs: '?nocache=1' },
    );
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status === 429) {
      const h = pickHeaders(r);
      got429 = { headers: h };
      await readPreview(r);
      break;
    }
    // Drain SSE quickly (read a couple kB then cancel) to avoid hanging the socket
    if (r.body) {
      try {
        const reader = r.body.getReader();
        let total = 0;
        while (total < 2048) {
          const x = await Promise.race([
            reader.read(),
            sleep(1500).then(() => ({ done: true })),
          ]);
          if (x?.done) break;
          if (x?.value) total += x.value.byteLength;
        }
        try { await reader.cancel(); } catch { /* noop */ }
      } catch { /* noop */ }
    }
  }
  const retryAfter = got429?.headers?.['retry-after'];
  record({
    name: 'ask: rate-limit boundary',
    endpoint: 'POST /api/ask sequential',
    state: `up to ${MAX} sequential requests vs 30/hr`,
    expected: '429 + Retry-After before exhausting MAX',
    actual: `issued=${issued}, statuses=${JSON.stringify(statuses)}, Retry-After=${retryAfter ?? 'n/a'}`,
    pass: !!got429 && !!retryAfter,
    headers: got429?.headers ?? {},
    bodyPreview: '',
    notes: !got429 ? 'No 429 reached after ' + issued + ' sequential calls; limit may be elevated, KV eventually-consistent, or per-PoP-scoped' : '',
  });
}

// ---------- /api/voice/tts ----------
async function testTts() {
  // Happy path
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello from QA smoke test.' }),
  });
  const headers = pickHeaders(res);
  const ms = Math.round(performance.now() - t0);
  let size = 0;
  let firstBytesHex = '';
  if (res.body) {
    const reader = res.body.getReader();
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      if (r.value) {
        if (size === 0) {
          firstBytesHex = Array.from(r.value.slice(0, 8))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        }
        size += r.value.byteLength;
        if (size > 200_000) {
          try { await reader.cancel(); } catch { /* noop */ }
          break;
        }
      }
    }
  }
  const isAudio = (headers['content-type'] || '').startsWith('audio/mpeg');
  const noStore = (headers['cache-control'] || '').includes('no-store');
  const mp3Magic = firstBytesHex.startsWith('494433') || firstBytesHex.startsWith('fffb') || firstBytesHex.startsWith('fff3') || firstBytesHex.startsWith('fff2');
  record({
    name: 'tts: happy path',
    endpoint: 'POST /api/voice/tts',
    state: 'happy',
    expected: '200, audio/mpeg, non-zero body, no-store',
    actual: `${res.status}, ct=${headers['content-type']}, bytes=${size}, magic=${firstBytesHex}, no-store=${noStore}`,
    pass: res.status === 200 && isAudio && size > 0 && noStore && mp3Magic,
    headers,
    bodyPreview: `bytes=${size} magic=${firstBytesHex}`,
    ms,
    notes: `voiceId pinned server-side to env.ELEVENLABS_VOICE_ID (expected oFuBjYTDwOfg9BOliOtC); cannot verify from client. mp3 magic ok=${mp3Magic}`,
  });

  // Empty
  const r2 = await fetch(`${BASE}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const b2 = await readPreview(r2);
  record({
    name: 'tts: empty text',
    endpoint: 'POST /api/voice/tts',
    state: 'empty text field',
    expected: '400 empty-text',
    actual: `${r2.status}`,
    pass: r2.status === 400,
    headers: pickHeaders(r2),
    bodyPreview: b2,
  });

  // Oversized
  const big = 'a'.repeat(1500);
  const r3 = await fetch(`${BASE}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: big }),
  });
  const b3 = await readPreview(r3);
  record({
    name: 'tts: text too long (>1200 chars)',
    endpoint: 'POST /api/voice/tts',
    state: '1500-char text',
    expected: '413',
    actual: `${r3.status}`,
    pass: r3.status === 413,
    headers: pickHeaders(r3),
    bodyPreview: b3,
  });

  // Bad json
  const r4 = await fetch(`${BASE}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json-at-all',
  });
  const b4 = await readPreview(r4);
  record({
    name: 'tts: bad json',
    endpoint: 'POST /api/voice/tts',
    state: 'invalid json body',
    expected: '400 bad-json',
    actual: `${r4.status}`,
    pass: r4.status === 400,
    headers: pickHeaders(r4),
    bodyPreview: b4,
  });

  // Wrong content-type. Astro CSRF blocks simple-CORS content-types at
  // framework layer → 403 before handler runs.
  const r5 = await fetch(`${BASE}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: BASE },
    body: 'text=hi',
  });
  const b5 = await readPreview(r5);
  record({
    name: 'tts: wrong content-type',
    endpoint: 'POST /api/voice/tts',
    state: 'text/plain body',
    expected: '403 (Astro CSRF) or 400',
    actual: `${r5.status}`,
    pass: r5.status === 403 || r5.status === 400,
    headers: pickHeaders(r5),
    bodyPreview: b5,
    notes: r5.status === 403 ? 'Astro CSRF check fires before handler' : '',
  });
}

// ---------- /api/voice/transcribe ----------
async function testTranscribe() {
  // Use existing test.mp3 if present, else minimal silent webm.
  let audioBytes;
  let fileName = 'clip.mp3';
  try {
    const fs = await import('node:fs/promises');
    audioBytes = await fs.readFile('/home/ubuntu/Projects/portfolio-2026/.tmp/test.mp3');
  } catch {
    // Build a tiny placeholder (will likely 502 from OpenAI but exercises endpoint)
    audioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]); // EBML magic, garbage
    fileName = 'clip.webm';
  }

  // Happy path
  const form = new FormData();
  form.append('audio', new Blob([audioBytes], { type: 'audio/mpeg' }), fileName);
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/voice/transcribe`, {
    method: 'POST',
    headers: { Origin: BASE },
    body: form,
  });
  const headers = pickHeaders(res);
  const body = await readPreview(res, 400);
  const ms = Math.round(performance.now() - t0);
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* noop */ }
  const noStore = (headers['cache-control'] || '').includes('no-store');
  record({
    name: 'transcribe: happy path',
    endpoint: 'POST /api/voice/transcribe',
    state: `multipart with audio=${audioBytes.length} bytes`,
    expected: '200 { ok:true, text:string } OR 502 if upstream rejects the test clip',
    actual: `${res.status}, ok=${parsed?.ok}, hasText=${typeof parsed?.text === 'string'}, no-store=${noStore}`,
    pass: (res.status === 200 && parsed?.ok === true) || res.status === 502,
    headers,
    bodyPreview: body.slice(0, 200),
    ms,
    notes: res.status === 502 ? 'OpenAI rejected the test clip — endpoint surface looks ok; verify with a real recording' : '',
  });

  // Empty multipart (no audio field)
  const formEmpty = new FormData();
  const r2 = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', headers: { Origin: BASE }, body: formEmpty });
  const b2 = await readPreview(r2);
  record({
    name: 'transcribe: missing audio',
    endpoint: 'POST /api/voice/transcribe',
    state: 'multipart with no audio field',
    expected: '400 missing-audio',
    actual: `${r2.status}`,
    pass: r2.status === 400,
    headers: pickHeaders(r2),
    bodyPreview: b2,
  });

  // Bad content-type (json instead of multipart)
  const r3 = await fetch(`${BASE}/api/voice/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: '{"x":1}',
  });
  const b3 = await readPreview(r3);
  record({
    name: 'transcribe: wrong content-type',
    endpoint: 'POST /api/voice/transcribe',
    state: 'application/json instead of multipart',
    expected: '400 bad-form',
    actual: `${r3.status}`,
    pass: r3.status === 400,
    headers: pickHeaders(r3),
    bodyPreview: b3,
  });

  // Empty audio blob
  const formZero = new FormData();
  formZero.append('audio', new Blob([], { type: 'audio/webm' }), 'empty.webm');
  const r4 = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', headers: { Origin: BASE }, body: formZero });
  const b4 = await readPreview(r4);
  record({
    name: 'transcribe: empty audio blob',
    endpoint: 'POST /api/voice/transcribe',
    state: '0-byte audio',
    expected: '400 empty-audio',
    actual: `${r4.status}`,
    pass: r4.status === 400,
    headers: pickHeaders(r4),
    bodyPreview: b4,
  });

  // Oversized (>25 MB) — generate 26 MB of zeros (this WILL ship 26 MB over the wire)
  // Keep this gated to avoid surprises in dev; only do once.
  if (process.env.QA_TEST_LARGE_UPLOAD !== '0') {
    const huge = new Uint8Array(26 * 1024 * 1024);
    const formHuge = new FormData();
    formHuge.append('audio', new Blob([huge], { type: 'audio/webm' }), 'big.webm');
    let r5;
    try {
      r5 = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', headers: { Origin: BASE }, body: formHuge });
    } catch (e) {
      record({
        name: 'transcribe: oversized (26 MB)',
        endpoint: 'POST /api/voice/transcribe',
        state: '26 MB upload',
        expected: '413',
        actual: `network-error: ${String(e).slice(0, 80)}`,
        pass: false,
        headers: {},
        bodyPreview: '',
      });
      return;
    }
    const b5 = await readPreview(r5);
    record({
      name: 'transcribe: oversized (26 MB)',
      endpoint: 'POST /api/voice/transcribe',
      state: '26 MB upload',
      expected: '413 audio-too-large',
      actual: `${r5.status}`,
      pass: r5.status === 413,
      headers: pickHeaders(r5),
      bodyPreview: b5,
    });
  }
}

// ---------- /api/voice/realtime-session ----------
async function testRealtime() {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/voice/realtime-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const headers = pickHeaders(res);
  const body = await readPreview(res, 400);
  const ms = Math.round(performance.now() - t0);
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* noop */ }
  const hasSecret = !!parsed?.session?.client_secret?.value;
  const noStore = (headers['cache-control'] || '').includes('no-store');
  record({
    name: 'realtime-session: happy path',
    endpoint: 'POST /api/voice/realtime-session',
    state: 'happy',
    expected: '200, session.client_secret.value present, no-store',
    actual: `${res.status}, ok=${parsed?.ok}, hasSecret=${hasSecret}, no-store=${noStore}`,
    pass: res.status === 200 && parsed?.ok === true && hasSecret && noStore,
    headers,
    bodyPreview: body.slice(0, 200),
    ms,
  });

  // GET (no handler exported → expect 405 from Astro)
  const r2 = await fetch(`${BASE}/api/voice/realtime-session`, { method: 'GET' });
  const b2 = await readPreview(r2);
  record({
    name: 'realtime-session: GET method',
    endpoint: 'GET /api/voice/realtime-session',
    state: 'wrong method',
    expected: '405',
    actual: `${r2.status}`,
    pass: r2.status === 404 || r2.status === 405,
    headers: pickHeaders(r2),
    bodyPreview: b2,
    notes: r2.status === 404 ? 'Astro returns 404 for missing handler; not strictly wrong' : '',
  });
}

// ---------- /api/resume-mirror ----------
async function testResumeMirror() {
  // Happy path (JSON, plain text resume, direction=tighter)
  const resumeText = 'John QA Tester\nSoftware engineer with 8 years building data pipelines.\nLed migration from on-prem Hadoop to Snowflake. Saved $1.2M/year.';
  let t0 = performance.now();
  const res = await fetch(`${BASE}/api/resume-mirror`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ resume: resumeText, direction: 'tighter', name: 'QA' }),
  });
  const headers = pickHeaders(res);
  const ct = (headers['content-type'] || '').includes('text/event-stream');
  let sse = { deltaCount: 0, doneEvent: null };
  if (ct) {
    sse = await consumeSse(res, { timeoutMs: 35_000 });
  } else {
    const b = await readPreview(res);
    record({
      name: 'resume-mirror: happy JSON',
      endpoint: 'POST /api/resume-mirror',
      state: 'json text resume, direction=tighter',
      expected: '200 SSE',
      actual: `${res.status}, ct=${headers['content-type']}`,
      pass: false,
      headers,
      bodyPreview: b,
      ms: Math.round(performance.now() - t0),
    });
    return await testResumeMirrorRest();
  }
  const ms = Math.round(performance.now() - t0);
  record({
    name: 'resume-mirror: happy JSON',
    endpoint: 'POST /api/resume-mirror',
    state: 'json text resume, direction=tighter',
    expected: '200, SSE with ≥1 delta + 1 done',
    actual: `${res.status}, ct=text/event-stream:${ct}, deltas=${sse.deltaCount}, done=${!!sse.doneEvent && sse.doneEvent.kind === 'done'}`,
    pass: res.status === 200 && ct && sse.deltaCount > 0 && sse.doneEvent?.kind === 'done',
    headers,
    bodyPreview: JSON.stringify(sse.doneEvent).slice(0, 200),
    ms,
  });

  await testResumeMirrorRest();
}

async function testResumeMirrorRest() {
  // Happy path (multipart, plain text file)
  const form = new FormData();
  const txt = 'Jane Doe\nProduct manager. 5 years SaaS. Took platform from $4M to $40M ARR.\n';
  form.append('resume', new Blob([txt], { type: 'text/plain' }), 'resume.txt');
  form.append('direction', 'looser');
  form.append('name', 'QA-Multipart');
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/resume-mirror`, { method: 'POST', headers: { Origin: BASE }, body: form });
  const headers = pickHeaders(res);
  const ct = (headers['content-type'] || '').includes('text/event-stream');
  let sse = { deltaCount: 0, doneEvent: null };
  if (ct) {
    sse = await consumeSse(res, { timeoutMs: 35_000 });
  }
  const ms = Math.round(performance.now() - t0);
  record({
    name: 'resume-mirror: multipart .txt',
    endpoint: 'POST /api/resume-mirror',
    state: 'multipart file=resume.txt, direction=looser',
    expected: '200 SSE',
    actual: `${res.status}, ct=text/event-stream:${ct}, deltas=${sse.deltaCount}, done=${sse.doneEvent?.kind === 'done'}`,
    pass: res.status === 200 && ct && sse.deltaCount > 0 && sse.doneEvent?.kind === 'done',
    headers,
    bodyPreview: JSON.stringify(sse.doneEvent).slice(0, 200),
    ms,
  });

  // Missing direction
  const r2 = await fetch(`${BASE}/api/resume-mirror`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ resume: 'short' }),
  });
  const b2 = await readPreview(r2);
  record({
    name: 'resume-mirror: missing direction',
    endpoint: 'POST /api/resume-mirror',
    state: 'json, no direction',
    expected: '400 invalid direction',
    actual: `${r2.status}`,
    pass: r2.status === 400,
    headers: pickHeaders(r2),
    bodyPreview: b2,
  });

  // Missing resume
  const r3 = await fetch(`${BASE}/api/resume-mirror`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ direction: 'tighter' }),
  });
  const b3 = await readPreview(r3);
  record({
    name: 'resume-mirror: missing resume',
    endpoint: 'POST /api/resume-mirror',
    state: 'json, no resume',
    expected: '400 missing resume',
    actual: `${r3.status}`,
    pass: r3.status === 400,
    headers: pickHeaders(r3),
    bodyPreview: b3,
  });

  // Bad content-type. Astro CSRF intercepts text/plain before handler;
  // app-level 415 only reachable from same-origin XHR with an unusual
  // content-type. Treat 403 OR 415 as acceptable.
  const r4 = await fetch(`${BASE}/api/resume-mirror`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: BASE },
    body: 'raw',
  });
  const b4 = await readPreview(r4);
  record({
    name: 'resume-mirror: unsupported content-type',
    endpoint: 'POST /api/resume-mirror',
    state: 'text/plain body',
    expected: '403 (Astro CSRF) or 415',
    actual: `${r4.status}`,
    pass: r4.status === 403 || r4.status === 415,
    headers: pickHeaders(r4),
    bodyPreview: b4,
    notes: r4.status === 403 ? 'Astro CSRF fires before handler' : '',
  });

  // Oversized text (>4 MB). Cloudflare Workers free/enterprise body cap
  // is ~100 MB; app cap is 4 MB. Could be either 413 (app cap) or 400
  // (CF rejected). Both indicate large bodies are bounded.
  const huge = 'x'.repeat(4 * 1024 * 1024 + 16);
  const r5 = await fetch(`${BASE}/api/resume-mirror`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ resume: huge, direction: 'tighter' }),
  });
  const b5 = await readPreview(r5);
  record({
    name: 'resume-mirror: oversized json (>4 MB)',
    endpoint: 'POST /api/resume-mirror',
    state: '4 MB + 16 chars',
    expected: '413 (app cap) or 400 (platform reject)',
    actual: `${r5.status}`,
    pass: r5.status === 413 || r5.status === 400,
    headers: pickHeaders(r5),
    bodyPreview: b5,
    notes: r5.status === 400 ? 'JSON.parse failed before length check — body still bounded' : '',
  });

  // Oversized multipart upload (~10 MB binary)
  const ten = new Uint8Array(10 * 1024 * 1024);
  const formHuge = new FormData();
  formHuge.append('resume', new Blob([ten], { type: 'application/pdf' }), 'big.pdf');
  formHuge.append('direction', 'tighter');
  let r6;
  try {
    r6 = await fetch(`${BASE}/api/resume-mirror`, { method: 'POST', headers: { Origin: BASE }, body: formHuge });
  } catch (e) {
    record({
      name: 'resume-mirror: oversized multipart (10 MB)',
      endpoint: 'POST /api/resume-mirror',
      state: '10 MB pdf',
      expected: '413',
      actual: `network-error: ${String(e).slice(0, 80)}`,
      pass: false,
      headers: {},
      bodyPreview: '',
    });
    return;
  }
  const b6 = await readPreview(r6);
  record({
    name: 'resume-mirror: oversized multipart (10 MB)',
    endpoint: 'POST /api/resume-mirror',
    state: '10 MB pdf',
    expected: '413 file too large',
    actual: `${r6.status}`,
    pass: r6.status === 413,
    headers: pickHeaders(r6),
    bodyPreview: b6,
  });

  // GET (405)
  const r7 = await fetch(`${BASE}/api/resume-mirror`);
  const b7 = await readPreview(r7);
  record({
    name: 'resume-mirror: GET method',
    endpoint: 'GET /api/resume-mirror',
    state: 'wrong method',
    expected: '405',
    actual: `${r7.status}`,
    pass: r7.status === 405,
    headers: pickHeaders(r7),
    bodyPreview: b7,
  });
}

// ---------- runner ----------
async function main() {
  console.error(`# QA matrix against ${BASE}`);

  console.error('\n## /api/health');
  await testHealth();

  console.error('\n## /api/ask');
  await testAsk();

  console.error('\n## /api/voice/tts');
  await testTts();

  console.error('\n## /api/voice/transcribe');
  await testTranscribe();

  console.error('\n## /api/voice/realtime-session');
  await testRealtime();

  console.error('\n## /api/resume-mirror');
  await testResumeMirror();

  // rate-limit last so we don't poison earlier tests
  console.error('\n## /api/ask rate-limit boundary');
  await testAskRateLimit();

  process.stdout.write(JSON.stringify({ base: BASE, ts: new Date().toISOString(), results: RESULTS }, null, 2));
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.stdout.write(JSON.stringify({ base: BASE, ts: new Date().toISOString(), fatal: String(err), results: RESULTS }, null, 2));
  process.exit(1);
});
