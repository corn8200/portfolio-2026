---
title: "This Site (And What It Demonstrates)"
slug: "this-site"
summary: "Astro on Cloudflare with a cloned voice agent, retrieval-augmented Q&A over this CV, custom WebGL hero, resume-mirror, and View Transitions. The site is the demo."
stack: ["Astro 5", "Cloudflare Pages + Workers", "Vectorize (pgvector-equivalent)", "OpenAI Realtime + Embeddings", "ElevenLabs cloned voice", "Raw WebGL2 + custom GLSL"]
year: "2026"
status: "live"
order: 5
links: { repo: "https://github.com/corn8200/portfolio-2026", preview: "https://portfolio-2026-123.pages.dev/" }
---

## Why a portfolio is a demonstration, not a description

Most professional sites describe what someone can do. This one demonstrates it.

## What's on this page that proves the point

- **The hero you scrolled past** is a custom WebGL2 fragment shader — a 2D scalar field rendered as topographic isolines, with cursor and scroll velocity reacting in real time. No Three.js, no library. About 120 lines of GLSL ES 300.
- **The voice agent** speaks in my actual voice. Cloned via ElevenLabs Instant Voice Clone from two voice memos and routed through a Cloudflare Worker. The model answers from this CV via retrieval — every claim it makes is sourced from the page you're reading.
- **The resume mirror** lets you drop your CV and asks GPT to give you an honest tailored pitch in either direction — why John should hire you, or why you should consider John. PDF or text. Vision-capable. Rate-limited.
- **Page transitions** use the View Transitions API directly. No cross-fade libraries. The hero canvas persists across routes — only the foreground content swaps.

## Why this matters for hiring

AI engineering and operations leadership are converging. The shops that will win at deploying AI in industrial settings need leaders who understand both halves — the process-control discipline that comes from decades of operations, and the engineering reflex to build the tooling rather than wait for a vendor.

I have both. This page is the proof.

## Stack notes for the technically curious

- **Framework:** Astro 5 SSR on Cloudflare Pages. Server-rendered HTML, hydrated only where interactive.
- **AI:** OpenAI for embeddings (`text-embedding-3-small`) and reasoning (`gpt-4o-mini`); Realtime API for voice; Whisper for transcription. ElevenLabs `eleven_turbo_v2_5` for streaming TTS.
- **Storage:** Cloudflare Vectorize (1536-dim cosine) for the embedded CV. KV for rate limits and response caching.
- **Type:** Inter Variable + JetBrains Mono Variable, self-hosted.
- **Performance:** Sub-200ms TTFB at edge. WebGL canvas pauses after 90 idle frames to respect the user's battery.
