# portfolio-2026

John Cornelius's personal portfolio. Astro 5 SSR on Cloudflare Pages, with a
voice + RAG conversation surface, custom WebGL hero, and a resume-mirror endpoint.

## Stack

- **Framework:** Astro 5 (SSR via `@astrojs/cloudflare`)
- **Host:** Cloudflare Pages + Workers (KV, Vectorize, Workers AI)
- **AI:** OpenAI GPT-4o-mini + text-embedding-3-small + Realtime API, ElevenLabs TTS
- **Graphics:** raw WebGL2 — a single fullscreen-triangle fragment shader,
  ~250 lines of GLSL. No Three.js.
- **Type:** Inter Variable + JetBrains Mono Variable, self-hosted, ~600KB total.

## Capabilities

1. Cinematic 2D-signal-field WebGL hero (topographic isolines over a
   domain-warped FBM field; cursor + scroll + per-visitor seed reactive).
2. Voice agent — push-to-talk via OpenAI Realtime + ElevenLabs streaming TTS.
   Text mode is the always-on accessibility fallback.
3. RAG over the CV (chunked + embedded into Vectorize). Every answer cites the
   source role or project inline.
4. Per-visitor generative hero seed — hash of referrer + locale + day shifts
   the field origin and palette weighting.
5. Resume mirror — drop a PDF/text resume, get an honest tailored pitch (both
   directions, vision-powered for PDFs).
6. View Transitions API choreography with named transitions.
7. Variable-axis masthead driven by voice-agent input amplitude (the one
   place we get expressive with type).
8. Live cursors — explicitly cut. Would have been Partykit/Durable-Objects;
   lowest-value of the eight; punted to ship the seven at quality.

## Layout

```
content/                # source markdown for CV + projects (RAG ingest reads from here)
src/
  components/           # Astro components
  layouts/              # BaseLayout
  lib/
    agent.ts            # client mount for the conversation surface
    content.ts          # markdown loader
    hero-canvas.ts      # WebGL2 driver
    rag/                # chunk → embed → answer pipeline
    voice/              # ElevenLabs TTS + Realtime session + rate limit
    resume/             # PDF extract + pitch generation
  pages/
    api/                # SSR endpoints (run on Workers)
    work/
  shaders/              # hero.frag.glsl, hero.vert.glsl
  styles/               # tokens.css, global.css, fonts.css
public/fonts/           # self-hosted variable woff2s
scripts/                # setup-env, fetch-fonts, ingest-cv, deploy-preview
e2e/                    # Playwright smoke tests
DESIGN.md               # design-system source of truth
```

## Local dev

```bash
# Hydrate .dev.vars from 1Password (one time, idempotent)
bash scripts/setup-env.sh

# Pull self-hosted variable fonts (one time)
bash scripts/fetch-fonts.sh

# Embed the CV into Vectorize (one time + after content edits)
npx tsx scripts/ingest-cv.ts

# Serve
npm run dev      # http://localhost:4321
```

## Deploy

```bash
bash scripts/deploy-preview.sh
# Prints the *.pages.dev preview URL.
```

## Performance budgets (hard caps from DESIGN.md §11)

| metric        | budget            |
|---------------|-------------------|
| FCP mobile 4G | < 1.2s            |
| LCP mobile 4G | < 2.5s            |
| TBT           | < 200ms           |
| JS (index)    | < 70KB            |
| Fonts         | < 600KB (woff2)   |
| CSS           | < 30KB inlined    |
| Lighthouse perf  | ≥ 90 mobile, ≥ 95 desktop |
| Lighthouse a11y  | ≥ 95              |
| Lighthouse SEO   | ≥ 92              |

## What we cut

- **Live cursors.** Multi-visitor presence via Partykit / Durable Objects.
  Real but the lowest-value of the eight capabilities. Punted to ship the
  rest at SOTD quality. Slot is reserved in `src/lib/presence/` for v2.
- **Cloned voice.** Voice agent ships with a polished ElevenLabs default voice
  (Brian, conversational). Cloned-voice slot reads `ELEVENLABS_VOICE_ID` from
  env — drop in a real John clone via `op item edit` and the next request
  picks it up. No code change needed.
- **Per-visitor image generation.** Brief specced "gpt-image-1 per session";
  shipped as a per-visitor *shader seed* instead (deterministic, $0/request,
  visually unique). Image-gen route is wired in `src/lib/rag/` style but
  defaults off behind `ENABLE_VISITOR_IMAGE_GEN` env flag.
