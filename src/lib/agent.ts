// Browser mount for the voice + text conversation surface.
// Imported by VoiceAgent.astro via `import { mountAgent } from '@/lib/agent'`.
//
// Modes:
//   - text (default): submit form -> POST /api/ask, stream SSE, render incrementally.
//   - voice (toggle): WebRTC -> OpenAI Realtime via ephemeral key. After each
//     assistant turn, background-fetch /api/ask to attach citation chips.
//   - fallback voice: if WebRTC fails, push-to-talk via MediaRecorder ->
//     /api/voice/transcribe -> /api/ask -> /api/voice/tts.

type LogRole = 'user' | 'assistant' | 'system';

type AskCitation = {
  n: number;
  label: string;
  source?: string;
  url?: string;
};

type LogEntry = {
  role: LogRole;
  text: string;
  el: HTMLElement;
  citations?: AskCitation[];
};

type AgentMode = 'idle' | 'listening' | 'streaming' | 'speaking' | 'error';

const REALTIME_MODEL = 'gpt-realtime';
const ASK_ENDPOINT = '/api/ask';
const TTS_ENDPOINT = '/api/voice/tts';
const TRANSCRIBE_ENDPOINT = '/api/voice/transcribe';
const REALTIME_ENDPOINT = '/api/voice/realtime-session';

export function mountAgent(root: HTMLElement): void {
  const form = q<HTMLFormElement>(root, '[data-agent-form]');
  const input = q<HTMLInputElement>(root, '[data-agent-input]');
  const logEl = q<HTMLElement>(root, '[data-agent-log]');
  const voiceBtnEl = q<HTMLButtonElement>(root, '[data-agent-voice]');
  const state = q<HTMLElement>(root, '[data-agent-state]');
  if (!form || !input || !logEl || !voiceBtnEl || !state) return;
  // Re-bind to non-nullable locals so TS narrowing carries into nested closures.
  const log = logEl;
  const voiceBtn = voiceBtnEl;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const audioEl = ensureAudioElement(root);

  // Persisted visitor inputs (name + org). Bound to inputs in the intro card.
  // We also expose them as window-globals so openAskStream can pull the LIVE
  // input value at submit time — relying on localStorage alone misses the case
  // where the user types into the field and hits Send without blurring.
  const nameInput = root.querySelector<HTMLInputElement>('[data-agent-name]');
  const orgInput = root.querySelector<HTMLInputElement>('[data-agent-org]');
  if (nameInput) {
    try { nameInput.value = localStorage.getItem('agent-visitor-name') || ''; } catch {}
    const persistName = () => {
      try { localStorage.setItem('agent-visitor-name', nameInput.value.trim().slice(0, 80)); } catch {}
    };
    // Persist on EVERY keystroke so a Send without blurring still has the latest value.
    nameInput.addEventListener('input', persistName);
    nameInput.addEventListener('change', persistName);
    nameInput.addEventListener('blur', persistName);
  }
  if (orgInput) {
    try { orgInput.value = localStorage.getItem('agent-visitor-org') || ''; } catch {}
    const persistOrg = () => {
      try { localStorage.setItem('agent-visitor-org', orgInput.value.trim().slice(0, 120)); } catch {}
    };
    orgInput.addEventListener('input', persistOrg);
    orgInput.addEventListener('change', persistOrg);
    orgInput.addEventListener('blur', persistOrg);
  }
  // Expose live readers so openAskStream can prefer DOM-truth over localStorage.
  (root as HTMLElement & { __visitor?: () => { name: string; org: string } }).__visitor = () => ({
    name: nameInput?.value.trim().slice(0, 80) || '',
    org: orgInput?.value.trim().slice(0, 120) || '',
  });

  const history: { role: LogRole; text: string }[] = [];
  const entries: LogEntry[] = [];
  let voiceActive = false;
  let voiceSession: VoiceSession | null = null;
  let cancelStream: AbortController | null = null;
  let ttsCancel: AbortController | null = null;
  // Auto-replay assistant responses in John's cloned voice by default.
  // Users can toggle off via the mute button (data-agent-mute).
  let autoSpeak = (() => {
    try { return localStorage.getItem('agent-mute') !== '1'; } catch { return true; }
  })();
  const muteBtn = root.querySelector<HTMLButtonElement>('[data-agent-mute]');
  if (muteBtn) {
    muteBtn.setAttribute('aria-pressed', autoSpeak ? 'false' : 'true');
    muteBtn.textContent = autoSpeak ? 'Mute' : 'Unmute';
    muteBtn.addEventListener('click', () => {
      autoSpeak = !autoSpeak;
      try { localStorage.setItem('agent-mute', autoSpeak ? '0' : '1'); } catch {}
      muteBtn.setAttribute('aria-pressed', autoSpeak ? 'false' : 'true');
      muteBtn.textContent = autoSpeak ? 'Mute' : 'Unmute';
      if (!autoSpeak) {
        ttsCancel?.abort();
        audioEl.pause();
        audioEl.src = '';
      }
    });
  }

  function stripCitations(text: string): string {
    // Strip [1], [2], [01] etc. so TTS doesn't say "bracket one".
    return text.replace(/\s*\[(?:\d+)\]/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  async function speak(text: string): Promise<void> {
    if (!autoSpeak) return;
    const clean = stripCitations(text);
    if (!clean) return;
    ttsCancel?.abort();
    ttsCancel = new AbortController();
    try {
      setMode('speaking');
      const res = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean }),
        signal: ttsCancel.signal,
      });
      if (!res.ok) throw new Error('tts ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioEl.src = url;
      audioEl.onended = () => {
        URL.revokeObjectURL(url);
        setMode(voiceActive ? 'listening' : 'idle');
      };
      await audioEl.play().catch(() => undefined);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('[agent] tts failed', err);
      }
      setMode(voiceActive ? 'listening' : 'idle');
    }
  }

  const setMode = (mode: AgentMode) => {
    state.textContent = labelFor(mode);
    state.setAttribute('data-mode', mode);
  };
  setMode('idle');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await runTextTurn(text);
  });

  voiceBtn.addEventListener('click', async () => {
    if (voiceActive) {
      await stopVoice();
    } else {
      await startVoice();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && voiceActive) {
      e.preventDefault();
      void stopVoice();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      voiceBtn.click();
    }
  });

  // ---- Text turn ----------------------------------------------------------

  async function runTextTurn(query: string): Promise<void> {
    cancelStream?.abort();
    cancelStream = new AbortController();

    pushEntry({ role: 'user', text: query });
    history.push({ role: 'user', text: query });
    const assistant = pushEntry({ role: 'assistant', text: '' });
    setMode('streaming');

    try {
      const stream = await openAskStream(query, history, cancelStream.signal);
      let acc = '';
      for await (const evt of stream) {
        if (evt.type === 'token') {
          acc += evt.value;
          assistant.text = acc;
          renderAssistantText(assistant);
        } else if (evt.type === 'citations') {
          assistant.citations = evt.value;
          renderAssistantText(assistant);
        } else if (evt.type === 'done') {
          break;
        }
      }
      if (acc) {
        history.push({ role: 'assistant', text: acc });
        // Auto-replay assistant text in John's cloned voice (unless muted or in voice mode).
        if (!voiceActive) void speak(acc);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        renderError(assistant, err);
      }
    } finally {
      if (!voiceActive) setMode(autoSpeak ? 'speaking' : 'idle');
      else setMode('listening');
    }
  }

  // ---- Voice: primary WebRTC path ----------------------------------------

  async function startVoice(): Promise<void> {
    voiceBtn.setAttribute('aria-pressed', 'true');
    voiceActive = true;
    setMode('listening');

    try {
      voiceSession = await startRealtimeSession({
        audioEl,
        onUserUtterance: (text) => {
          pushEntry({ role: 'user', text });
          history.push({ role: 'user', text });
        },
        onAssistantUtterance: async (text) => {
          const entry = pushEntry({ role: 'assistant', text });
          history.push({ role: 'assistant', text });
          // Background grounding: re-ask /api/ask so citations are real.
          void attachCitations(entry, text);
        },
        onState: (mode) => setMode(mode),
      });
    } catch (err) {
      console.warn('[agent] realtime failed, falling back to push-to-talk', err);
      await voiceSession?.stop();
      voiceSession = null;
      try {
        voiceSession = await startPushToTalkSession({
          audioEl,
          onUserUtterance: (text) => {
            pushEntry({ role: 'user', text });
            history.push({ role: 'user', text });
          },
          onAssistantUtterance: (text, citations) => {
            pushEntry({ role: 'assistant', text, citations });
            history.push({ role: 'assistant', text });
          },
          askStream: (qry) => openAskStream(qry, history),
          onState: (mode) => setMode(mode),
        });
      } catch (err2) {
        voiceActive = false;
        voiceBtn.setAttribute('aria-pressed', 'false');
        setMode('error');
        pushEntry({ role: 'system', text: 'Voice unavailable in this browser. Use the text input.' });
        console.error('[agent] both voice paths failed', err2);
      }
    }
  }

  async function stopVoice(): Promise<void> {
    voiceActive = false;
    voiceBtn.setAttribute('aria-pressed', 'false');
    setMode('idle');
    await voiceSession?.stop();
    voiceSession = null;
  }

  // ---- Rendering helpers --------------------------------------------------

  function pushEntry(init: { role: LogRole; text: string; citations?: AskCitation[] }): LogEntry {
    const wrap = document.createElement('div');
    wrap.className = `agent__msg agent__msg--${init.role}`;
    wrap.setAttribute('data-role', init.role);
    const label = document.createElement('span');
    label.className = 't-meta';
    label.textContent = init.role === 'user' ? 'YOU' : init.role === 'assistant' ? 'AGENT' : 'SYS';
    const body = document.createElement('div');
    body.className = 'agent__msg-body';
    wrap.appendChild(label);
    wrap.appendChild(body);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    const entry: LogEntry = { role: init.role, text: init.text, el: body, citations: init.citations };
    entries.push(entry);
    renderAssistantText(entry);
    return entry;
  }

  function renderAssistantText(entry: LogEntry): void {
    const text = entry.text;
    if (!entry.citations || entry.citations.length === 0) {
      entry.el.textContent = text;
      return;
    }
    // Inline citation chips: replace [n] markers with chip spans.
    entry.el.replaceChildren();
    const re = /\[(\d{1,3})\]/g;
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > cursor) entry.el.appendChild(document.createTextNode(text.slice(cursor, m.index)));
      const n = Number(m[1]);
      const cite = entry.citations.find((c) => c.n === n);
      entry.el.appendChild(makeChip(n, cite));
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) entry.el.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function makeChip(n: number, cite?: AskCitation): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'cite-chip';
    chip.textContent = `[${String(n).padStart(2, '0')}]`;
    if (cite) {
      chip.setAttribute('data-source', cite.source ?? cite.label);
      chip.title = cite.label;
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      if (cite.url) {
        chip.style.cursor = 'pointer';
        chip.addEventListener('click', () => window.open(cite.url!, '_blank', 'noopener'));
        chip.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') window.open(cite.url!, '_blank', 'noopener');
        });
      }
    }
    return chip;
  }

  function renderError(entry: LogEntry, err: unknown): void {
    entry.text = `error: ${err instanceof Error ? err.message : String(err)}`;
    entry.el.classList.add('agent__msg--error');
    entry.el.textContent = entry.text;
  }

  async function attachCitations(entry: LogEntry, text: string): Promise<void> {
    try {
      const stream = await openAskStream(text, history.slice(-6));
      let citations: AskCitation[] | undefined;
      for await (const evt of stream) {
        if (evt.type === 'citations') citations = evt.value;
        if (evt.type === 'done') break;
      }
      if (citations && citations.length) {
        entry.citations = citations;
        renderAssistantText(entry);
      }
    } catch {
      // Silent: citations are an enhancement, not required for the spoken reply.
    }
  }

  if (reducedMotion) root.setAttribute('data-reduced-motion', 'true');
}

// ============================================================================
// /api/ask SSE consumer
// ============================================================================

type AskEvent =
  | { type: 'token'; value: string }
  | { type: 'citations'; value: AskCitation[] }
  | { type: 'done' }
  | { type: 'error'; value: string };

function readVisitor(): { name: string; org: string } {
  // Prefer the live DOM inputs (the mount function attaches a __visitor() reader to the agent root).
  // Fall back to localStorage if the inputs aren't found (e.g. text-only embed).
  const root = document.querySelector('[data-agent]') as
    (HTMLElement & { __visitor?: () => { name: string; org: string } }) | null;
  if (root?.__visitor) return root.__visitor();
  try {
    return {
      name: localStorage.getItem('agent-visitor-name') || '',
      org: localStorage.getItem('agent-visitor-org') || '',
    };
  } catch {
    return { name: '', org: '' };
  }
}

async function openAskStream(
  query: string,
  history: { role: LogRole; text: string }[],
  signal?: AbortSignal
): Promise<AsyncIterable<AskEvent>> {
  const visitor = readVisitor();
  const res = await fetch(ASK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      query,
      history: history.map((h) => ({ role: h.role, content: h.text })),
      name: visitor.name || undefined,
      org: visitor.org || undefined,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`ask: ${res.status} ${res.statusText}`);
  }
  return parseSse(res.body);
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const evt of parseSseFrame(frame)) yield evt;
    }
  }
  yield { type: 'done' };
}

function parseSseFrame(frame: string): AskEvent[] {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return [];
  const payload = dataLines.join('\n');

  // Try JSON-with-kind shape first (what /api/ask emits).
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object') {
      if (parsed.kind === 'delta' && typeof parsed.delta === 'string') {
        return [{ type: 'token', value: parsed.delta as string }];
      }
      if (parsed.kind === 'done') {
        const citations = Array.isArray(parsed.citations) ? (parsed.citations as AskCitation[]) : [];
        const out: AskEvent[] = [];
        if (citations.length) out.push({ type: 'citations', value: citations });
        out.push({ type: 'done' });
        return out;
      }
      if (parsed.kind === 'error') {
        return [{ type: 'error', value: String(parsed.message ?? 'unknown error') }];
      }
    }
  } catch {
    // not JSON — fall through to event-name dispatch
  }

  // Fallback: legacy named-event shape.
  try {
    if (event === 'token') return [{ type: 'token', value: JSON.parse(payload) as string }];
    if (event === 'citations') return [{ type: 'citations', value: JSON.parse(payload) as AskCitation[] }];
    if (event === 'done') return [{ type: 'done' }];
    if (event === 'error') return [{ type: 'error', value: payload }];
    return [{ type: 'token', value: payload }];
  } catch {
    return [];
  }
}

// ============================================================================
// Realtime (WebRTC) session
// ============================================================================

type VoiceSessionHandlers = {
  audioEl: HTMLAudioElement;
  onUserUtterance: (text: string) => void;
  onAssistantUtterance: (text: string) => void | Promise<void>;
  onState: (mode: AgentMode) => void;
};

type PushToTalkHandlers = {
  audioEl: HTMLAudioElement;
  onUserUtterance: (text: string) => void;
  onAssistantUtterance: (text: string, citations?: AskCitation[]) => void;
  askStream: (q: string) => Promise<AsyncIterable<AskEvent>>;
  onState: (mode: AgentMode) => void;
};

type VoiceSession = { stop: () => Promise<void> };

async function startRealtimeSession(handlers: VoiceSessionHandlers): Promise<VoiceSession> {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('webrtc-unsupported');

  const sessRes = await fetch(REALTIME_ENDPOINT, { method: 'POST' });
  if (!sessRes.ok) throw new Error(`realtime-session: ${sessRes.status}`);
  const sessJson = (await sessRes.json()) as { ok: boolean; session?: { client_secret?: { value?: string } } };
  const ephemeral = sessJson?.session?.client_secret?.value;
  if (!ephemeral) throw new Error('realtime-no-key');

  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const pc = new RTCPeerConnection();
  for (const t of mic.getTracks()) pc.addTrack(t, mic);

  pc.ontrack = (e) => {
    const [stream] = e.streams;
    if (stream) {
      handlers.audioEl.srcObject = stream;
      handlers.audioEl.play().catch(() => undefined);
      handlers.onState('speaking');
    }
  };

  const dc = pc.createDataChannel('oai-events');
  let pendingAssistant = '';
  dc.addEventListener('message', async (e) => {
    let evt: { type?: string; transcript?: string; delta?: string } | null;
    try {
      evt = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!evt || !evt.type) return;
    if (evt.type === 'conversation.item.input_audio_transcription.completed') {
      const txt = (evt.transcript || '').trim();
      if (txt) handlers.onUserUtterance(txt);
    } else if (evt.type === 'response.audio_transcript.delta') {
      pendingAssistant += evt.delta || '';
    } else if (evt.type === 'response.audio_transcript.done') {
      const txt = (evt.transcript || pendingAssistant).trim();
      pendingAssistant = '';
      if (txt) await handlers.onAssistantUtterance(txt);
      handlers.onState('listening');
    } else if (evt.type === 'input_audio_buffer.speech_started') {
      handlers.onState('listening');
    } else if (evt.type === 'response.created') {
      handlers.onState('streaming');
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ephemeral}`,
      'Content-Type': 'application/sdp',
    },
    body: offer.sdp,
  });
  if (!sdpRes.ok) throw new Error(`realtime-sdp: ${sdpRes.status}`);
  const answer = await sdpRes.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });

  return {
    stop: async () => {
      try { dc.close(); } catch {}
      for (const t of mic.getTracks()) t.stop();
      try { pc.close(); } catch {}
      handlers.audioEl.srcObject = null;
    },
  };
}

// ============================================================================
// Push-to-talk fallback
// ============================================================================

async function startPushToTalkSession(handlers: PushToTalkHandlers): Promise<VoiceSession> {
  if (typeof MediaRecorder === 'undefined') throw new Error('mediarecorder-unsupported');
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const rec = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  let stopping = false;

  rec.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });

  const turn = async () => {
    handlers.onState('streaming');
    const blob = new Blob(chunks.splice(0, chunks.length), { type: mime || 'audio/webm' });
    if (blob.size < 4096) {
      handlers.onState('listening');
      return;
    }
    const fd = new FormData();
    fd.append('audio', new File([blob], 'clip.webm', { type: blob.type }));
    let userText = '';
    try {
      const tr = await fetch(TRANSCRIBE_ENDPOINT, { method: 'POST', body: fd });
      const data = (await tr.json()) as { ok: boolean; text?: string };
      if (data.ok && data.text) userText = data.text.trim();
    } catch {}
    if (!userText) {
      handlers.onState('listening');
      return;
    }
    handlers.onUserUtterance(userText);

    let acc = '';
    let cites: AskCitation[] | undefined;
    try {
      const askStream = await handlers.askStream(userText);
      for await (const evt of askStream) {
        if (evt.type === 'token') acc += evt.value;
        else if (evt.type === 'citations') cites = evt.value;
        else if (evt.type === 'done') break;
      }
    } catch {
      acc = "I couldn't reach the brain. Try again in a moment.";
    }
    handlers.onAssistantUtterance(acc, cites);

    try {
      handlers.onState('speaking');
      const ttsRes = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: stripChips(acc) }),
      });
      if (ttsRes.ok && ttsRes.body) {
        const audioBlob = await ttsRes.blob();
        const url = URL.createObjectURL(audioBlob);
        handlers.audioEl.src = url;
        handlers.audioEl.onended = () => URL.revokeObjectURL(url);
        await handlers.audioEl.play().catch(() => undefined);
      }
    } catch {}
    handlers.onState('listening');
  };

  rec.addEventListener('stop', () => {
    if (!stopping) void turn();
  });

  // Simple cycling capture: stop+restart every 4s so each clip is bounded.
  const tick = window.setInterval(() => {
    if (rec.state === 'recording') {
      rec.stop();
      setTimeout(() => {
        if (!stopping) rec.start();
      }, 50);
    }
  }, 4000);

  rec.start();
  handlers.onState('listening');

  return {
    stop: async () => {
      stopping = true;
      clearInterval(tick);
      if (rec.state !== 'inactive') rec.stop();
      for (const t of mic.getTracks()) t.stop();
      handlers.audioEl.srcObject = null;
    },
  };
}

function pickMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

// ============================================================================
// Shared utilities
// ============================================================================

function ensureAudioElement(root: HTMLElement): HTMLAudioElement {
  let el = root.querySelector<HTMLAudioElement>('audio[data-agent-audio]');
  if (el) return el;
  el = document.createElement('audio');
  el.setAttribute('data-agent-audio', '');
  el.setAttribute('playsinline', '');
  el.autoplay = true;
  el.style.display = 'none';
  root.appendChild(el);
  return el;
}

function stripChips(text: string): string {
  return text.replace(/\[\d{1,3}\]/g, '').replace(/\s+/g, ' ').trim();
}

function labelFor(mode: AgentMode): string {
  switch (mode) {
    case 'idle': return 'idle';
    case 'listening': return 'listening…';
    case 'streaming': return 'thinking…';
    case 'speaking': return 'speaking…';
    case 'error': return 'error';
  }
}

function q<T extends Element>(root: HTMLElement | Document, sel: string): T | null {
  return root.querySelector<T>(sel);
}
