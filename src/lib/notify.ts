// Fire-and-forget notification: send John an email when a visitor starts a
// conversation. One email per session per day, gated by a KV sentinel so we
// don't spam on every turn.
//
// Resend is the transport (sender = info@sentryaithermal.com is Resend-verified
// per ops setup). Sender domain is configurable via NOTIFY_EMAIL_FROM secret.

export interface NotifyVisitor {
  name?: string | null;
  org?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  timezone?: string | null;
}

export interface NotifyOptions {
  env: {
    CACHE: KVNamespace;
    RESEND_API_KEY?: string;
    NOTIFY_EMAIL_TO?: string;
    NOTIFY_EMAIL_FROM?: string;
  };
  /** Stable session id from the client (uuid in localStorage). */
  sessionId: string;
  visitor: NotifyVisitor;
  /** First user query — included verbatim in the email. */
  firstQuery: string;
  /** Browser UA — informational. */
  userAgent?: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h — one email per visitor session per day

/** Schedule the notification on the next tick. Never throws to the caller. */
export function notifyVisitorAsync(opts: NotifyOptions, waitUntil?: (p: Promise<unknown>) => void): void {
  const p = notifyVisitor(opts).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[notify] send failed:', (err as Error)?.message ?? err);
  });
  if (waitUntil) waitUntil(p);
}

async function notifyVisitor(opts: NotifyOptions): Promise<void> {
  const { env, sessionId, visitor, firstQuery } = opts;
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL_TO || !env.NOTIFY_EMAIL_FROM) return;
  if (!sessionId) return;

  const key = `notify-session:${sessionId}`;
  const seen = await env.CACHE.get(key);
  if (seen) return;
  // Mark first so a race doesn't double-send.
  await env.CACHE.put(key, '1', { expirationTtl: SESSION_TTL_SECONDS });

  const subject = visitor.name
    ? `Talk: ${visitor.name}${visitor.org ? ` · ${visitor.org}` : ''}`
    : 'Talk: anonymous visitor';

  const geo = [visitor.city, visitor.region, visitor.country].filter(Boolean).join(', ') || '(unknown)';
  const tz = visitor.timezone || '(unknown)';

  const lines = [
    `Someone just started a conversation on cv.jcornelius.net.`,
    ``,
    `Name:     ${visitor.name || '(not given)'}`,
    `Company:  ${visitor.org || '(not given)'}`,
    `Geo:      ${geo}`,
    `Timezone: ${tz}`,
    ``,
    `First question:`,
    `  ${firstQuery.replace(/\s+/g, ' ').slice(0, 480)}`,
    ``,
    `Session id: ${sessionId.slice(0, 12)}…`,
    `UA: ${(opts.userAgent || '').slice(0, 160)}`,
    ``,
    `One email per session per 24h. Reply to this email to break the loop.`,
  ];

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'User-Agent': 'cv.jcornelius.net/notify (Cloudflare Workers)',
    },
    body: JSON.stringify({
      from: env.NOTIFY_EMAIL_FROM,
      to: [env.NOTIFY_EMAIL_TO],
      subject,
      text: lines.join('\n'),
    }),
  });
}
