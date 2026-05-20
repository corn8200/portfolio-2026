// Persistent WebGL2 canvas driver for the hero signal field.
// Anti-defaults observed:
//   - No Three.js (raw WebGL2, ~6KB gzipped after shader strings).
//   - No 3D primitive — single fullscreen triangle, fragment-only composition.
//   - Pauses rAF after 90 idle frames, restarts on input.
//   - Honors prefers-reduced-motion: renders one static frame and stops.

import fragSrc from '@/shaders/hero.frag.glsl?raw';
import vertSrc from '@/shaders/hero.vert.glsl?raw';

type RGB = [number, number, number];

type State = {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  startedAt: number;
  mouse: { x: number; y: number; vx: number; vy: number; lx: number; ly: number };
  scroll: { v: number; lastY: number; lastT: number };
  seed: number;
  intro: number;
  idleFrames: number;
  raf: number | null;
  reduced: boolean;
  dpr: number;
};

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + log);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'a_position');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

// CSS color -> linear-ish RGB triplet. We parse the resolved computed color of a probe element.
function readPalette(): { bg: RGB; fg: RGB; accent: RGB } {
  function parse(name: string): RGB {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = rgb.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0];
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255] as RGB;
  }
  return {
    bg: parse('--color-bg'),
    fg: parse('--color-text'),
    accent: parse('--color-accent'),
  };
}

function hashStringToUnit(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 100000) / 100000;
}

function deriveSeed(): number {
  // Per-visitor seed: hash of referrer + locale + day, stored in sessionStorage so reloads stay stable.
  const stored = sessionStorage.getItem('hero-seed');
  if (stored) return parseFloat(stored);
  const parts = [
    document.referrer || 'direct',
    navigator.language || 'en',
    new Date().toISOString().slice(0, 10),
    String(window.innerWidth) + 'x' + String(window.innerHeight),
  ].join('|');
  const seed = hashStringToUnit(parts);
  try { sessionStorage.setItem('hero-seed', String(seed)); } catch { /* private mode */ }
  return seed;
}

export function mountHeroCanvas(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    canvas.style.background = 'var(--bg)';
    return () => {};
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = link(gl, vs, fs);
  gl.useProgram(prog);

  // fullscreen triangle (3 verts, no index)
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const u = {
    u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
    u_time: gl.getUniformLocation(prog, 'u_time'),
    u_mouse: gl.getUniformLocation(prog, 'u_mouse'),
    u_flow: gl.getUniformLocation(prog, 'u_flow'),
    u_scroll: gl.getUniformLocation(prog, 'u_scroll'),
    u_seed: gl.getUniformLocation(prog, 'u_seed'),
    u_intro: gl.getUniformLocation(prog, 'u_intro'),
    u_bg: gl.getUniformLocation(prog, 'u_bg'),
    u_fg: gl.getUniformLocation(prog, 'u_fg'),
    u_accent: gl.getUniformLocation(prog, 'u_accent'),
    u_dpr: gl.getUniformLocation(prog, 'u_dpr'),
    u_reduced: gl.getUniformLocation(prog, 'u_reduced'),
  };

  const state: State = {
    gl,
    prog,
    uniforms: u,
    startedAt: performance.now(),
    mouse: { x: 0.5, y: 0.5, vx: 0, vy: 0, lx: 0.5, ly: 0.5 },
    scroll: { v: 0, lastY: window.scrollY, lastT: performance.now() },
    seed: deriveSeed(),
    intro: 0,
    idleFrames: 0,
    raf: null,
    reduced,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * state.dpr);
    const h = Math.floor(canvas.clientHeight * state.dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function onMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = (e.clientX - rect.left) / rect.width;
    state.mouse.y = 1.0 - (e.clientY - rect.top) / rect.height;
    state.idleFrames = 0;
    if (state.raf == null) loop();
  }
  function onTouchMove(e: TouchEvent) {
    if (!e.touches[0]) return;
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = (e.touches[0].clientX - rect.left) / rect.width;
    state.mouse.y = 1.0 - (e.touches[0].clientY - rect.top) / rect.height;
    state.idleFrames = 0;
    if (state.raf == null) loop();
  }
  function onScroll() {
    const now = performance.now();
    const dt = Math.max(1, now - state.scroll.lastT);
    const dy = window.scrollY - state.scroll.lastY;
    const v = dy / dt; // px/ms
    state.scroll.v = state.scroll.v * 0.85 + v * 0.15;
    state.scroll.lastY = window.scrollY;
    state.scroll.lastT = now;
    state.idleFrames = 0;
    if (state.raf == null) loop();
  }

  // initial palette read; re-read on scheme change.
  let palette = readPalette();
  const schemeMq = window.matchMedia('(prefers-color-scheme: dark)');
  schemeMq.addEventListener('change', () => { palette = readPalette(); });
  const themeObserver = new MutationObserver(() => { palette = readPalette(); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function loop() {
    state.raf = requestAnimationFrame(loop);
    resize();

    const t = (performance.now() - state.startedAt) / 1000;

    // smooth mouse for flowmap
    const sx = state.mouse.x;
    const sy = state.mouse.y;
    const vx = sx - state.mouse.lx;
    const vy = sy - state.mouse.ly;
    state.mouse.vx = state.mouse.vx * 0.82 + vx * 0.18;
    state.mouse.vy = state.mouse.vy * 0.82 + vy * 0.18;
    state.mouse.lx = sx;
    state.mouse.ly = sy;

    // damped scroll velocity
    state.scroll.v *= 0.92;
    if (Math.abs(state.scroll.v) < 0.002) state.scroll.v = 0;

    // intro reveal
    if (state.intro < 1.0) {
      state.intro = Math.min(1.0, state.intro + (1 / 60) / 1.2);
    }

    // idle pause
    const movement = Math.abs(state.mouse.vx) + Math.abs(state.mouse.vy) + Math.abs(state.scroll.v);
    if (movement < 0.0005 && state.intro >= 1.0) {
      state.idleFrames++;
      if (state.idleFrames > 90 && !state.reduced) {
        if (state.raf != null) {
          cancelAnimationFrame(state.raf);
          state.raf = null;
        }
        return;
      }
    } else {
      state.idleFrames = 0;
    }

    gl.uniform2f(u.u_resolution!, canvas.width, canvas.height);
    gl.uniform1f(u.u_time!, t);
    gl.uniform2f(u.u_mouse!, sx, sy);
    gl.uniform2f(u.u_flow!, state.mouse.vx * 8.0, state.mouse.vy * 8.0);
    gl.uniform1f(u.u_scroll!, Math.max(-1, Math.min(1, state.scroll.v * 0.6)));
    gl.uniform1f(u.u_seed!, state.seed);
    gl.uniform1f(u.u_intro!, state.intro);
    gl.uniform3f(u.u_bg!, palette.bg[0], palette.bg[1], palette.bg[2]);
    gl.uniform3f(u.u_fg!, palette.fg[0], palette.fg[1], palette.fg[2]);
    gl.uniform3f(u.u_accent!, palette.accent[0], palette.accent[1], palette.accent[2]);
    gl.uniform1f(u.u_dpr!, state.dpr);
    gl.uniform1f(u.u_reduced!, state.reduced ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // first frame even under reduced-motion
  resize();
  state.intro = state.reduced ? 1.0 : 0.0;
  loop();
  if (state.reduced) {
    // ensure motion stops after one full frame
    requestAnimationFrame(() => {
      if (state.raf != null) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
      }
    });
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  return function dispose() {
    if (state.raf != null) cancelAnimationFrame(state.raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('scroll', onScroll);
    themeObserver.disconnect();
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteBuffer(buf);
  };
}
