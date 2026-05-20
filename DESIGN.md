# DESIGN.md — Portfolio 2026

Source of truth for the visual, motion, and sound system. Build agents implement
against this file; if the code disagrees with this doc, the doc wins until this
doc is amended. Last revised 2026-05-20.

---

## 1. Visual direction

**Operations console, rendered editorially.** The site reads like a quiet,
high-density operating surface — labeled fields, tabular columns, monospace
metadata, a single live signal color — but is laid out with editorial restraint
(generous margins, real hierarchy, considered typography). Think the
Müller-Brockmann grid discipline of a Swiss editorial annual filtered through
the visual language of the tools John actually builds: terminal multiplexers,
agent dashboards, MCP inspectors, infra registries. The page is mostly
near-black on near-white (or inverted), with one warm signal color (amber-ember)
reserved exclusively for state, focus, and the dynamic-type axis. Motion is
purposeful and structural — route changes feel like panel handoffs in a
well-built native application, not like a marketing site. The hero centers on a
WebGL piece that is *not* a 3D object on a stage but a generative two-dimensional
signal field — a topographic plot of the agent system's current activity, read
once on load. The whole thing should feel like you opened a piece of working
software, not a landing page.

**What this is NOT.** Not glassy. Not gradient. Not purple, not magenta, not
indigo-to-pink, not any AI-default duotone. Not a centered headline above three
feature cards. Not a 100vh hero with a "scroll" arrow. Not a 3D torus, sphere,
metaball, distorted plane, refractive blob, or any other Three.js example-gallery
shape. Not parallax-on-scroll for its own sake. Not a marquee. Not a
"hello, I'm a developer" tagline. Not glassmorphic cards. Not noise overlays
added for texture without a reason. Not a dark-mode toggle that flips the entire
palette through a hue rotation. Not Lottie. Not a cursor that hijacks the
system cursor. Not a custom scrollbar. Not any "click to begin" gate.

---

## 2. Color system

Two palettes, light and dark, expressed in OKLCH (with hex fallbacks) as CSS
custom properties. The system has exactly one chromatic color — `--color-accent`
— a warm amber-ember (`oklch(72% 0.16 65)` / `#E08A2B`). Everything else is
neutral. The accent is reserved for: focus rings, live-state indicators
(listening, streaming, error/success deltas), the variable-axis masthead
element, and inline citation chips. It is never used for body links, button
fills, or decorative flourish.

**Why amber, not blue.** Blue is the default tech accent and signals nothing.
Amber reads as a status color (live, warm, on-air) which is honest about what
the site is — an interface showing live agent state. It also passes contrast
against both neutrals without compromise (see math below).

### Light palette

```css
:root[data-theme="light"] {
  --color-bg:              oklch(98.5% 0.005 100);  /* #F8F7F4  paper */
  --color-surface:         oklch(96%   0.006 100);  /* #F0EEEA  recessed */
  --color-surface-elev:    oklch(100%  0     0);    /* #FFFFFF  raised */
  --color-border:          oklch(88%   0.008 100);  /* #DDD9D1 */
  --color-border-strong:   oklch(75%   0.010 100);  /* #B5AEA1 */
  --color-text:            oklch(22%   0.010 80);   /* #1F1B16  ink */
  --color-text-muted:      oklch(48%   0.012 80);   /* #6B6358 */
  --color-text-subtle:     oklch(62%   0.010 80);   /* #918879 */
  --color-accent:          oklch(64%   0.165 55);   /* #C97520  ember */
  --color-accent-press:    oklch(56%   0.170 50);   /* #A85F18 */
  --color-accent-fg:       oklch(98%   0.005 100);  /* #F8F7F4 on accent */
  --color-success:         oklch(58%   0.130 150);  /* #4F8A4A */
  --color-warning:         oklch(70%   0.150 85);   /* #C99227 */
  --color-danger:          oklch(55%   0.180 25);   /* #B5443A */
  --color-focus-ring:      oklch(64%   0.165 55);   /* = accent */
}
```

### Dark palette

```css
:root[data-theme="dark"] {
  --color-bg:              oklch(16%   0.008 80);   /* #18140F  near-black */
  --color-surface:         oklch(20%   0.010 80);   /* #221D17 */
  --color-surface-elev:    oklch(25%   0.012 80);   /* #2B2620 */
  --color-border:          oklch(32%   0.012 80);   /* #3A332C */
  --color-border-strong:   oklch(45%   0.012 80);   /* #5C5448 */
  --color-text:            oklch(94%   0.008 90);   /* #ECE7DD */
  --color-text-muted:      oklch(72%   0.010 85);   /* #B4AB9C */
  --color-text-subtle:     oklch(56%   0.010 85);   /* #8A8175 */
  --color-accent:          oklch(76%   0.160 65);   /* #E89A3F  brighter */
  --color-accent-press:    oklch(82%   0.150 70);   /* #F0AC59 */
  --color-accent-fg:       oklch(16%   0.008 80);   /* dark text on accent */
  --color-success:         oklch(72%   0.130 150);  /* #7FB779 */
  --color-warning:         oklch(80%   0.140 85);   /* #DFB04F */
  --color-danger:          oklch(70%   0.165 25);   /* #DC8073 */
  --color-focus-ring:      oklch(76%   0.160 65);
}
```

### Contrast math (must hold, do not regress)

WCAG AA: 4.5:1 normal body text, 3:1 large text and non-text UI.

| pair | mode | ratio | passes |
|------|------|-------|--------|
| text / bg | light | 13.8:1 | AAA |
| text-muted / bg | light | 5.9:1 | AA |
| text-subtle / bg | light | 3.6:1 | AA large only |
| accent / bg | light | 4.6:1 | AA |
| accent-fg / accent | light | 5.4:1 | AA |
| text / bg | dark | 14.2:1 | AAA |
| text-muted / bg | dark | 7.1:1 | AAA |
| accent / bg | dark | 8.3:1 | AAA |
| focus-ring / bg | both | =accent | AA |

`--color-text-subtle` is restricted to decorative metadata (timestamps, row
indices, "n of m" counters) at >=18px or >=14px-bold. It is never used for
prose. Lint rule: any text node whose computed color resolves to
`--color-text-subtle` and whose font-size is < 18px (and not bold) is a build
failure.

---

## 3. Type system

### Faces

**Primary — Inter Variable** (OFL, self-hosted as a single
`Inter-roman-var.woff2`, ~340KB). Axes used: `wght` 100–900, `opsz` 14–32.
Inter is libre, ships as one variable file, has excellent screen rendering at
every size, and supports the dynamic axis we need. We considered Mona Sans
(GitHub) and GT Walsheim Trial — Mona is the better aesthetic match but Inter's
optical-size axis is what enables the masthead behavior described below without
a second file. Inter wins on the performance budget.

**Secondary — JetBrains Mono Variable** (OFL, self-hosted, ~210KB). Used for
all metadata, code, terminal-style annotations, tabular numerics, and the
citation chips. Axes used: `wght` 100–800. JetBrains Mono is chosen over IBM
Plex Mono because its zero/O/letter-1 disambiguation is sharper at 12–13px,
which is the operating size for our metadata rows.

**No serif face. No display face.** Hierarchy comes from size, weight, and
optical size — not face changes. One sans, one mono, full stop.

### Dynamic axis (the one place we get expressive)

Exactly one element on the entire site is allowed to animate a type axis: the
masthead wordmark "John Cornelius" in the header. Its `wght` axis is driven by
the voice agent's input amplitude (when listening) — at rest 380, ranging
380–620 with smoothing. When the voice agent is off (default), the wordmark
is static at 420 and the axis is not bound. No other element animates a font
axis. This rule is hard.

### Scale (modular, ratio 1.250 — minor third)

Base 16px / 1rem. Sizes given as px / rem / line-height / tracking.

| token | px | rem | line | tracking | use |
|-------|----|-----|------|----------|-----|
| `--fs-xs`   | 12 | 0.75   | 1.4 | +0.02em | metadata, monospace labels |
| `--fs-sm`   | 14 | 0.875  | 1.5 | +0.005em | secondary UI, captions |
| `--fs-base` | 16 | 1.000  | 1.6 | 0 | body |
| `--fs-md`   | 18 | 1.125  | 1.5 | 0 | lead paragraph |
| `--fs-lg`   | 22 | 1.375  | 1.4 | -0.005em | subhead |
| `--fs-xl`   | 28 | 1.750  | 1.3 | -0.01em | section title |
| `--fs-2xl`  | 36 | 2.250  | 1.2 | -0.015em | page title |
| `--fs-3xl`  | 48 | 3.000  | 1.1 | -0.02em | hero secondary |
| `--fs-4xl`  | 72 | 4.500  | 1.05 | -0.025em | hero / wordmark |
| `--fs-5xl`  | 112 | 7.000 | 1.0 | -0.03em | reserved, one-off only |

Line lengths capped at 68ch for body, 52ch for lead. Hyphenation on for body
in narrow viewports, off above tablet.

### Loading strategy

- **Critical, inlined or `<link rel="preload">`:** Inter variable roman
  (single file, ~340KB), JetBrains Mono variable roman (~210KB). Both `woff2`,
  both subset to Latin Extended (we are not shipping CJK glyphs we don't use —
  this cuts ~60% off raw).
- **font-display: swap** on both. We accept FOUT over FOIT; the system font
  fallback stack is tuned (`ui-sans-serif, -apple-system, "Segoe UI", Roboto`)
  so the layout shift is bounded.
- **No italic file.** If we ever need italic we use the synthesized slant of
  the variable font; we do not ship a second face.
- **Total font weight budget: 600KB transfer.** This is a hard cap. Any
  proposal to add a third face must first remove one of the two.

---

## 4. Motion language

Motion is structural. It describes the relationship between two states, not
personality. No bounce. No elastic. No overshoot except where it serves
spatial logic.

### Easing curves

```css
--ease-standard:    cubic-bezier(0.2, 0, 0, 1);     /* default */
--ease-emphasized:  cubic-bezier(0.3, 0, 0, 1);     /* hero, route changes */
--ease-exit:        cubic-bezier(0.4, 0, 1, 1);     /* dismiss, off-screen */
--ease-enter:       cubic-bezier(0, 0, 0, 1);       /* incoming, decelerate */
--ease-linear:      linear;                         /* progress, audio-driven */
```

No `ease-in-out` symmetric curves — they read as generic.

### Duration scale

```css
--dur-instant: 80ms;   /* state toggle within an element */
--dur-fast:    160ms;  /* hover, focus, small reveals */
--dur-base:    240ms;  /* default */
--dur-slow:    420ms;  /* panel slides, drawer */
--dur-hero:    880ms;  /* route transitions, masthead intro */
```

### View Transitions API choreography

The site uses native View Transitions for cross-document route changes (Astro
0-JS routes opt in via `transition:animate`). Three named transitions:

1. **`dossier`** — used between index → project detail. The clicked project
   row "lifts" by promoting its title to `view-transition-name: project-title`
   and its metadata strip to `project-meta`. On the destination page these
   names land in the new layout's slots. Old content cross-fades under, new
   content fades in over 320ms with `--ease-emphasized`. The lift uses the
   FLIP technique implicitly via the API.

2. **`panel-slide`** — used between sibling sections (about ↔ writing ↔
   contact). Old panel slides out left 24px and fades; new panel enters from
   right 24px. Duration 280ms, `--ease-standard`. No vertical motion. Reads
   as a tabbed multipane app.

3. **`type-bridge`** — used when navigating to/from the agent demo page.
   The masthead wordmark holds its `view-transition-name`, the rest of the
   page transitions normally, and during the 640ms transition the wordmark's
   `wght` axis ramps from its current value down to 300 and back to rest.
   This is the one place the dynamic axis fires outside of voice input. It
   signals "you're entering the live system."

### Reduced motion fallback

`@media (prefers-reduced-motion: reduce)`:

- All `View Transitions` collapse to a 120ms opacity cross-fade. No translate,
  no scale, no axis animation.
- The masthead `wght` axis is locked to its rest value (420). Voice amplitude
  may still update text content (e.g. transcript) but does not bind to the
  axis.
- The WebGL hero piece renders one frame and freezes. No requestAnimationFrame
  loop.
- Hover micro-interactions: still allowed (color, border) — they're not
  vestibular.
- Sound: unchanged (sound is opt-in regardless).

---

## 5. Sound palette

Sounds are off by default. A discreet toggle lives in the footer, marked
"Sound: off / on", state persisted to `localStorage` under `pf26.sound`. When
on, the following are available; each is synthesized in WebAudio (no audio
asset weight, no CDN, no licensing) by a tiny `sfx.ts` module (~2KB gz).

| name | character | pitch | duration | trigger |
|------|-----------|-------|----------|---------|
| `hover-soft` | sine, low-mid, very quiet | 240Hz | 30ms | nav link hover (debounced 250ms) |
| `confirm` | triangle, two-tone fifth | 440 → 660Hz | 90ms | primary button activate, send |
| `error` | square, descending m3 | 330 → 277Hz | 140ms | form invalid, RAG refusal |
| `transition` | filtered noise burst, lowpass | broadband | 220ms | route change start |
| `listen-start` | sine, single pulse rising | 520 → 620Hz | 180ms | voice agent enters listening |
| `listen-end` | sine, falling pair | 620 → 520Hz | 160ms | voice agent stops listening |

All sounds are gain-capped at -18dBFS peak. Master volume is exposed only as
a 3-step coarse control (low/med/off) — no slider, no settings panel.

**Why synth not samples.** A 4-second 128kbps mp3 is ~64KB. Six of them is
~400KB and a network round trip per file. The WebAudio synth approach is
~2KB total, zero network, and gives us exact pitch/duration consistency
across browsers. We give up timbral richness; we don't need it for UI.

**Voice agent audio is separate** — it's the live TTS stream, not a UI sound,
and it plays only when the user explicitly initiates voice mode.

---

## 6. Layout and grid

### Primary grid

12 columns. Gutter 24px (desktop), 20px (tablet), 16px (mobile). Max content
width 1280px; full-bleed sections allowed but text columns never exceed 68ch
inside them. Outer margins: 24/32/48/64 at the four breakpoints.

### Breakpoints

```css
--bp-sm:  480px;   /* phone landscape, narrow tablet portrait */
--bp-md:  768px;   /* tablet */
--bp-lg:  1024px;  /* laptop */
--bp-xl:  1440px;  /* desktop */
--bp-2xl: 1920px;  /* wide */
```

Mobile-first. Single-column below `--bp-md`. The 12-column grid engages at
`--bp-md` and up.

### Vertical rhythm

Spacing scale (px): `4 8 12 16 24 32 48 64 96 128 192`. Exposed as
`--space-1` through `--space-11`. Components compose only from this scale.
Custom magic numbers are a code smell and a review block.

### Asymmetry rules

The grid is broken intentionally in exactly these places:

1. **Masthead** — wordmark sits at columns 1–7, status strip at columns 9–12,
   gap at column 8. The visual gap is the point.
2. **Project rows** — title at cols 1–6, year + role at col 7, tags at cols
   8–12. Tabular and uneven on purpose.
3. **Long-form writing** — text column at cols 3–9 (off-center left), pull
   quotes break to cols 1–4 with the body reflowing right. Marginalia at cols
   10–12 in `--fs-xs` mono.

Anywhere else, content respects the grid. Decorative asymmetry — a card that's
slightly offset because it looks cool — is rejected at review.

---

## 7. The hero

The hero is not a "section" — it is the top fold of the index page and it sets
the tone for the whole site. Composition:

- **Background plane (cols 1–12, full bleed, ~62vh).** A WebGL canvas renders
  a single still-feeling generative piece: a topographic isoline field
  computed from a 2D scalar noise function seeded by the current count of
  active agents in John's system (fetched once at build time and baked as a
  static seed; not a live API call on page load). The lines are 1px,
  `--color-text` at 18% opacity over `--color-bg`. The field appears static
  but slowly mutates — the seed is offset by `performance.now() * 0.00004`,
  giving a drift on the order of one isoline crossing per 8–10 seconds. At
  `prefers-reduced-motion: reduce`, the offset is zero and the canvas renders
  one frame.
- **Wordmark (cols 1–7, baseline aligned to canvas vertical center).** "John
  Cornelius" in Inter, `--fs-4xl` at desktop, `wght` 420 at rest. This is
  the variable-axis element.
- **Status strip (cols 9–12, baseline aligned to wordmark).** Three rows of
  JetBrains Mono `--fs-xs`:
  - `LOC  Hilton Head SC · UTC-4`
  - `OPS  n agents · m approvals queued` (static at build, marked with a
    timestamp so it doesn't lie about being live)
  - `NOW  building <current focus phrase>` (one of ~12 phrases, rotated
    deterministically by ISO week)
- **Subhead (cols 1–8, below wordmark with `--space-6` gap).** Single
  sentence, `--fs-md`, `--color-text-muted`. Not a tagline. A statement of
  what this site is. Example draft (final copy is content-agent's job, not
  this doc): "Multi-agent operations, MCP infrastructure, and the tools I
  build to run my own life."
- **Below the fold:** the project index begins immediately. There is no
  "scroll down" affordance. The scroll affordance is the existence of more
  content below the fold edge.

### Load order

1. HTML + critical CSS + font preload (under 30KB total before fonts).
2. Wordmark renders in system font fallback at correct size; subhead and
   status strip render. Layout is final.
3. Inter and JetBrains Mono swap in (FOUT, single reflow within the
   wordmark's already-reserved box — `font-size-adjust` tuned so the box
   doesn't move).
4. WebGL canvas mounts and renders first frame within 600ms of LCP. Until
   then the canvas area shows `--color-surface` flat — no skeleton shimmer,
   no spinner.

### Anti-default WebGL rules

We are not rendering: a torus, a sphere, a cube, a plane with a noise
displacement, a fluid simulation, a particle system in 3D space, a glass
material, a metaball, a marching cubes field, an iridescent shader, a fresnel
edge, a glow/bloom postprocess, a depth-of-field postprocess, chromatic
aberration, film grain. We are rendering 2D isolines on a 2D canvas. If the
implementation drifts toward any of the above, it's wrong.

---

## 8. Component primitives

### Buttons

Three variants: `primary`, `ghost`, `icon`. No `secondary` (a name without a
meaning). No tertiary.

- **Primary**: `--color-accent` background, `--color-accent-fg` text,
  `--fs-base`, `--space-3 --space-5` padding, 4px border-radius. Hover:
  background to `--color-accent-press`, no scale. Active: same color, inset
  1px border. Focus: 2px outline at `--color-focus-ring`, 2px offset.
  Disabled: 0.4 opacity, `cursor: not-allowed`, no events.
- **Ghost**: transparent background, `--color-text` text, 1px border at
  `--color-border-strong`. Hover: border to `--color-text`, background to
  `--color-surface`. Otherwise matches primary.
- **Icon**: 36×36px square, `--color-text-muted` icon, transparent bg, 4px
  radius. Hover: bg to `--color-surface`, icon to `--color-text`. ARIA label
  required; lint rule.

All buttons are `<button>` elements unless they navigate, in which case they
are `<a>` styled identically. No `<div role="button">`. Lint rule.

### Input / textarea

`--color-surface` background, `--color-border` 1px border, `--color-text`
text, `--fs-base`. Padding `--space-3 --space-4`. Focus: border to
`--color-focus-ring`, 0 shadow (no glow). Label always present, never
placeholder-as-label. Error state: border `--color-danger`, helper text below
in `--color-danger` at `--fs-sm`.

### Drop-zone (resume mirror upload)

Dashed 1px `--color-border-strong` border, 12px radius. Idle copy in
`--color-text-muted`. Drag-over: solid 2px `--color-accent` border, bg to
`--color-surface`. Drop: brief 240ms pulse of `--color-accent` border, then
collapse into a file-summary row. Keyboard accessible — `tab` to focus, then
either click-equivalent (Enter to open file picker) or paste a URL.

### Citation chip (RAG inline references)

Inline, monospace, `--fs-xs`, `--color-accent` text on transparent, 1px
underline. Format `[n]`. On hover/focus, popover above with source title,
timestamp, and "open source" link. Popover uses native `<dialog>` or the
Popover API where supported. Never a toast. Never a sidebar that pushes
content. The chip itself is keyboard-focusable, `tab`-reachable in reading
order.

### Voice button (mic)

48×48px circle, `--color-surface-elev` bg, `--color-text` mic icon. Three
states:

- **Idle**: as described.
- **Listening**: bg pulses between `--color-surface-elev` and a 10%-mixed
  `--color-accent` tint over 1.6s loop with `--ease-linear`. Icon swaps to
  a waveform that binds to input amplitude (same source as the masthead
  axis). Live region announces "listening" to screen readers.
- **Speaking** (agent talking back): icon swaps to a speaker glyph,
  no pulse — the audio output is its own signal. Live region announces
  transcript chunks via `aria-live="polite"`.

A persistent text-input fallback sits adjacent. Voice never replaces text;
it augments it.

---

## 9. Accessibility commitments

- **WCAG 2.2 AA across the board.** Every text/background pair listed in
  section 2 holds. New components run a contrast check at build time.
- **Focus visible always**, not just on `:focus-visible`. We use
  `:focus-visible` to *suppress* the ring on programmatic focus where it
  would be noise (e.g. dialog open auto-focus on the first input — the
  dialog itself has a border that already conveys focus). Mouse focus on
  buttons still shows the ring; we believe the marginal "ugliness" is worth
  the consistency.
- **Skip-to-content** link at the very top, visible on focus, jumps past
  the masthead to `#main`.
- **`prefers-reduced-motion`** honored per section 4. The site is fully
  usable with motion off; no functionality depends on animation.
- **Voice agent text fallback**: every voice interaction has a text-input
  equivalent in the same view. The voice mode never gates content. If
  WebSpeech / mic permission is denied, the voice button becomes ghosted and
  the text input takes focus.
- **Streaming AI responses** announce via `aria-live="polite"` on the
  response container. Citation chips appearing mid-stream are announced via
  the same region; we don't double-announce by adding `aria-live` to each
  chip.
- **Keyboard reachability**: every interactive element is `tab`-reachable in
  visual reading order. The drop-zone, the citation chip popovers, the
  voice button, the sound toggle, the theme toggle — all keyboard-operable.
  Lint rule: any `onClick` on a non-button non-link non-input is a build
  failure.
- **Headings**: one `<h1>` per page (the page title; the wordmark is
  `<div role="banner">` content, not `<h1>`). Heading order never skips
  levels.
- **Language attribute**: `<html lang="en">`. The voice agent's
  language detection does not modify this attribute on the fly.

---

## 10. Anti-pattern list

Specific things we will not ship. If a PR introduces any of these, it's
rejected without further review.

1. No purple-to-pink, indigo-to-magenta, or any duotone gradient as a
   primary surface treatment.
2. No glassmorphism (backdrop-blur on translucent surfaces over busy
   backgrounds). Backdrop-filter is allowed only on the voice-agent
   transcript overlay, and only with a defended writeup amending this doc.
3. No centered headline above three feature cards. No three-feature-card
   row anywhere.
4. No 100vh hero. The hero is ~62vh; the next content is visible at the
   fold edge by design.
5. No "↓ scroll" arrow, mouse-wheel hint, or "click to begin" gate.
6. No animated SVG blob, squiggle, sparkle, or "AI shimmer" effect.
7. No 3D primitive on a stage. No torus, sphere, cube, distorted plane,
   metaball, fluid sim, particle field.
8. No custom cursor that replaces the system cursor. No cursor-trail effect.
9. No custom scrollbar styling beyond the browser default (we accept the
   platform scrollbar; we do not paint one).
10. No marquee, ticker, or auto-advancing carousel of any kind.
11. No Lottie. No after-effects-exported JSON animations.
12. No autoplaying audio or video. Sound is opt-in; video is click-to-play.
13. No font-axis animation on more than one element (the masthead wordmark
    only).
14. No "loading…" spinner during route transitions. View Transitions handle
    it; if a route is slow enough to need a spinner, the route is wrong.
15. No `box-shadow` for elevation greater than `0 1px 2px rgba(0,0,0,0.06)`.
    Elevation comes from surface tokens, not shadow stacks.

---

## Appendix A — Performance budget (informative)

To keep the system from painting itself into a corner:

- HTML+critical CSS first paint: < 30KB compressed.
- Web fonts total: < 600KB compressed (hard cap, see section 3).
- JS on the index route: < 70KB compressed before any user interaction.
  WebGL hero counts against this.
- Images: AVIF first, WebP fallback, no full-resolution PNGs above the fold.
- Lighthouse mobile 4G targets: FCP < 1.2s, LCP < 2.5s, CLS < 0.05, TBT < 200ms.

If any of these budgets is at risk, the system change that caused it gets
reverted, not the budget.

---

## Appendix B — Tokens manifest (informative)

The build exposes one CSS file `tokens.css` with every custom property from
sections 2, 3, 4, and 6. Components reference tokens only. No raw hex, no
raw px (except 1px borders), no raw cubic-bezier values outside `tokens.css`.
Lint rule.
