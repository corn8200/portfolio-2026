// Shared shapes for the voice endpoints. Keep these small — the wire format
// is read by both the Cloudflare endpoint and the browser agent.

export type TtsRequest = {
  text: string;
  /** Optional override of the configured voice id. Server may ignore. */
  voiceId?: string;
};

export type TranscribeResponse = {
  ok: true;
  text: string;
  durationMs?: number;
} | {
  ok: false;
  reason: string;
};

export type RealtimeSessionRequest = {
  /** Optional override of system instructions (server may reject). */
  instructions?: string;
};

/**
 * Mirror of the OpenAI `/v1/realtime/sessions` response we forward to the browser.
 * We intentionally do not narrow client_secret beyond `unknown` because the
 * shape can shift across model versions and the browser only reads `value`.
 */
export type RealtimeSessionResponse = {
  ok: true;
  session: {
    id: string;
    model: string;
    expires_at?: number;
    client_secret: { value: string; expires_at?: number };
    [k: string]: unknown;
  };
} | {
  ok: false;
  reason: string;
};

export type ApiError = { ok: false; reason: string };

export type DailyBudgetKey = `spend:${'openai' | 'elevenlabs'}:${string}`;
