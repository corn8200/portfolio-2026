// Minimal ElevenLabs streaming TTS client for Workers.
// We deliberately keep the surface tiny: one function that returns the upstream
// `ReadableStream<Uint8Array>` of MP3 bytes so the Astro endpoint can `tee` or
// pipe directly to the response without buffering in the worker.

export type ElevenTtsOptions = {
  apiKey: string;
  voiceId: string;
  text: string;
  /** Defaults to eleven_turbo_v2_5 for low-latency conversational use. */
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  /** 0..4; 2 = balanced latency-vs-quality per ElevenLabs docs. */
  optimizeStreamingLatency?: number;
  /** MP3 sample/bitrate combo; 22050_32 is the small/quick default. */
  outputFormat?: string;
  /** AbortSignal so callers can bound the upstream call. */
  signal?: AbortSignal;
};

export type ElevenTtsResult = {
  stream: ReadableStream<Uint8Array>;
  /** Set if upstream reported character count via response header. */
  charactersBilled?: number;
};

const DEFAULT_MODEL = 'eleven_turbo_v2_5';
const DEFAULT_OUTPUT = 'mp3_22050_32';

export async function streamTts(opts: ElevenTtsOptions): Promise<ElevenTtsResult> {
  const {
    apiKey,
    voiceId,
    text,
    modelId = DEFAULT_MODEL,
    stability = 0.5,
    similarityBoost = 0.75,
    optimizeStreamingLatency = 2,
    outputFormat = DEFAULT_OUTPUT,
    signal,
  } = opts;

  if (!apiKey) throw new Error('eleven: missing api key');
  if (!voiceId) throw new Error('eleven: missing voice id');
  if (!text || !text.trim()) throw new Error('eleven: empty text');

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`);
  url.searchParams.set('optimize_streaming_latency', String(optimizeStreamingLatency));
  url.searchParams.set('output_format', outputFormat);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability, similarity_boost: similarityBoost },
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await safeReadError(res);
    throw new Error(`eleven: upstream ${res.status} ${res.statusText} :: ${errText}`);
  }

  const charsHeader = res.headers.get('character-cost') || res.headers.get('x-character-cost');
  const charactersBilled = charsHeader ? Number(charsHeader) : undefined;

  return { stream: res.body, charactersBilled };
}

/**
 * ElevenLabs Turbo v2.5 is billed per character; current public pricing puts
 * the Creator/Pro tiers near ~$0.0003 / character output-equivalent. We use a
 * conservative estimate so the daily-budget gate triggers a touch early rather
 * than late.
 */
export function estimateTtsCostUsd(charCount: number): number {
  return charCount * 0.0003;
}

async function safeReadError(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 400);
  } catch {
    return '<unreadable body>';
  }
}
