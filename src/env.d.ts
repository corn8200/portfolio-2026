/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

interface Env {
  CACHE: KVNamespace;
  CV_INDEX: VectorizeIndex;
  AI: Ai;
  OPENAI_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  OPENAI_DAILY_BUDGET_USD?: string;
  ELEVENLABS_DAILY_BUDGET_USD?: string;
  RATE_LIMIT_VOICE_PER_IP_PER_HOUR?: string;
  RATE_LIMIT_RESUME_PER_IP_PER_HOUR?: string;
  SITE_NAME?: string;
}

declare namespace App {
  interface Locals extends Runtime {}
}

// allow `?raw` imports of GLSL and markdown
declare module '*.glsl?raw' {
  const src: string;
  export default src;
}
declare module '*.md?raw' {
  const src: string;
  export default src;
}
