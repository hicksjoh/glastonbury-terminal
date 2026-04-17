/**
 * Minimal Resend email client. Used by research completion notifications,
 * storm alerts, tax harvester, and coach reviews. Graceful no-op when
 * RESEND_API_KEY is unset so nothing breaks in dev.
 */

type SendArgs = {
  subject: string;
  text: string;
  html?: string;
  to?: string | string[];
};

export async function sendResendEmail(args: SendArgs): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const defaultTo = process.env.RESEND_TO_EMAIL;
  if (!key || !from) return { ok: false, error: 'RESEND not configured' };

  const to = args.to ?? defaultTo;
  if (!to) return { ok: false, error: 'No recipient configured' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body?.message ?? `HTTP ${res.status}` };
    return { ok: true, id: body?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
