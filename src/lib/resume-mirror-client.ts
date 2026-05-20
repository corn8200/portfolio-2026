// Client-side mount for the Resume Mirror component.
//
// Owns: drop-zone state, file validation, fetch+SSE parse, render.
// Markdown rendering is intentionally tiny — no library; we only need
// headings, bold, lists, links, `[John]` / `[you]` citation chips.

import {
  ALLOWED_EXT,
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  normalizeDirection,
  type PitchDirection,
  type ResumeMirrorSseEvent,
} from './resume/types';

type Direction = PitchDirection;

interface MountState {
  file: File | null;
  direction: Direction;
  busy: boolean;
}

function $(root: HTMLElement, sel: string): HTMLElement | null {
  return root.querySelector(sel) as HTMLElement | null;
}

function hasAllowedExt(name: string): boolean {
  const lower = name.toLowerCase();
  for (const ext of ALLOWED_EXT) if (lower.endsWith(ext)) return true;
  return false;
}

function validateFile(file: File): string | null {
  if (file.size === 0) return 'file is empty';
  if (file.size > MAX_UPLOAD_BYTES) return 'file too large (max 4 MB)';
  const mimeOk = ALLOWED_MIME.has(file.type);
  const extOk = hasAllowedExt(file.name);
  if (!mimeOk && !extOk) return 'unsupported type — pdf, txt, or md only';
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minimal Markdown -> HTML for our constrained output (headings, lists, bold, citations). */
function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inList: 'ol' | 'ul' | null = null;

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };

  const inline = (s: string): string => {
    let safe = escapeHtml(s);
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    safe = safe.replace(/\[(John|you)\]/g, '<span class="mirror-cite mirror-cite--$1">[$1]</span>');
    safe = safe.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return safe;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = Math.min(6, h[1]!.length + 2);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      continue;
    }

    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ol) {
      if (inList !== 'ol') {
        closeList();
        out.push('<ol class="mirror-list mirror-list--ol">');
        inList = 'ol';
      }
      out.push(`<li>${inline(ol[2]!)}</li>`);
      continue;
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (inList !== 'ul') {
        closeList();
        out.push('<ul class="mirror-list mirror-list--ul">');
        inList = 'ul';
      }
      out.push(`<li>${inline(ul[1]!)}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

function setState(root: HTMLElement, partial: Partial<MountState>): void {
  const cur = (root as HTMLElement & { _mirrorState?: MountState })._mirrorState ?? {
    file: null,
    direction: 'pitch-them-to-john',
    busy: false,
  };
  const next: MountState = { ...cur, ...partial };
  (root as HTMLElement & { _mirrorState?: MountState })._mirrorState = next;
  renderState(root, next);
}

function getState(root: HTMLElement): MountState {
  return (
    (root as HTMLElement & { _mirrorState?: MountState })._mirrorState ?? {
      file: null,
      direction: 'pitch-them-to-john',
      busy: false,
    }
  );
}

function renderState(root: HTMLElement, state: MountState): void {
  const status = $(root, '[data-mirror-status]');
  const submitBtn = $(root, '[data-mirror-submit]') as HTMLButtonElement | null;
  const dropLabel = $(root, '[data-mirror-droplabel]');

  if (submitBtn) submitBtn.disabled = !state.file || state.busy;

  if (status) {
    if (state.busy) {
      status.textContent = 'streaming…';
      status.dataset.state = 'busy';
    } else if (state.file) {
      const kb = Math.max(1, Math.round(state.file.size / 1024));
      status.textContent = `${state.file.name} · ${kb} KB`;
      status.dataset.state = 'ready';
    } else {
      status.textContent = 'no file';
      status.dataset.state = 'idle';
    }
  }

  if (dropLabel) {
    dropLabel.textContent = state.file ? 'replace file' : 'drop a pdf or text resume here';
  }

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-mirror-direction]')) {
    const dir = normalizeDirection(btn.dataset.mirrorDirection ?? '');
    const active = dir === state.direction;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

async function submitMirror(root: HTMLElement): Promise<void> {
  const state = getState(root);
  if (!state.file || state.busy) return;

  const result = $(root, '[data-mirror-result]');
  if (!result) return;

  const nameInput = $(root, '[data-mirror-name]') as HTMLInputElement | null;
  const name = nameInput?.value?.trim() ?? '';

  setState(root, { busy: true });
  result.innerHTML = '<p class="mirror-result__waiting t-meta">extracting resume…</p>';
  result.classList.add('is-streaming');

  const form = new FormData();
  form.append('resume', state.file);
  form.append('direction', state.direction);
  if (name) form.append('name', name);

  let buffer = '';
  let collected = '';
  const renderCollected = () => {
    result.innerHTML = renderMarkdown(collected);
  };

  try {
    const res = await fetch('/api/resume-mirror', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { reason?: string };
        if (j.reason) reason = j.reason;
      } catch {
        // ignore
      }
      result.innerHTML = `<p class="mirror-result__error">${escapeHtml(reason)}</p>`;
      result.classList.remove('is-streaming');
      setState(root, { busy: false });
      return;
    }

    if (!res.body) throw new Error('no response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let firstDelta = true;
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
          if (!payload) continue;
          try {
            const ev = JSON.parse(payload) as ResumeMirrorSseEvent;
            if (ev.kind === 'delta') {
              if (firstDelta) {
                result.innerHTML = '';
                firstDelta = false;
              }
              collected += ev.delta;
              renderCollected();
            } else if (ev.kind === 'done') {
              renderCollected();
              const meta = document.createElement('p');
              meta.className = 't-meta mirror-result__meta';
              const cache = ev.usage.cache_hit ? 'cached' : 'fresh';
              const tokens = ev.usage.completion_tokens
                ? `${ev.usage.completion_tokens} out / ${ev.usage.prompt_tokens ?? '?'} in`
                : 'tokens unknown';
              meta.textContent = `${cache} · ${tokens} · extract ${ev.usage.extract_ms ?? 0}ms`;
              result.appendChild(meta);
            } else if (ev.kind === 'error') {
              result.innerHTML += `<p class="mirror-result__error">${escapeHtml(ev.message)}</p>`;
            }
          } catch {
            // skip malformed frame
          }
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'request failed';
    result.innerHTML = `<p class="mirror-result__error">${escapeHtml(msg)}</p>`;
  } finally {
    result.classList.remove('is-streaming');
    setState(root, { busy: false });
  }
}

export function mountResumeMirror(root: HTMLElement): void {
  setState(root, { file: null, direction: 'pitch-them-to-john', busy: false });

  const drop = $(root, '[data-mirror-drop]');
  const fileInput = $(root, '[data-mirror-file]') as HTMLInputElement | null;

  if (drop && fileInput) {
    drop.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input[type="file"]')) return;
      fileInput.click();
    });
    drop.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('is-drag');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-drag');
      const dt = (e as DragEvent).dataTransfer;
      if (!dt || dt.files.length === 0) return;
      const file = dt.files[0]!;
      const err = validateFile(file);
      if (err) {
        const result = $(root, '[data-mirror-result]');
        if (result) result.innerHTML = `<p class="mirror-result__error">${escapeHtml(err)}</p>`;
        return;
      }
      setState(root, { file });
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const err = validateFile(file);
      if (err) {
        const result = $(root, '[data-mirror-result]');
        if (result) result.innerHTML = `<p class="mirror-result__error">${escapeHtml(err)}</p>`;
        fileInput.value = '';
        return;
      }
      setState(root, { file });
    });
  }

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-mirror-direction]')) {
    btn.addEventListener('click', () => {
      const dir = normalizeDirection(btn.dataset.mirrorDirection ?? '');
      if (dir) setState(root, { direction: dir });
    });
  }

  const form = $(root, '[data-mirror-form]') as HTMLFormElement | null;
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submitMirror(root);
    });
  }
}
