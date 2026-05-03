import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';
import { publicError, validationError, captureAndPublic } from '@/lib/api-error';

// P0-5 (hardening/p0-codex-fixes).
//
// Before: /api/push/subscribe was middleware-public AND wrote to Supabase
// with the service-role key. Any unauthenticated caller could fill the
// push_subscriptions table or poison notification delivery by registering
// an endpoint pointing at a server they control.
//
// After:
//   - middleware.ts no longer lists this route under PUBLIC_API_ROUTES, so
//     the session-cookie gate runs first
//   - the payload is zod-validated (endpoint is a URL, hostname is on the
//     standard push-provider allowlist, p256dh + auth are base64-ish)
//   - durable rate limit keyed by session: 5 subscribes / hour
//   - DELETE follows the same rules
//
// Browser flow already includes the session cookie when calling this from
// the app shell — the client doesn't have to change.

// Hostnames Apple/Google/Mozilla/Microsoft actually use for Push Service
// endpoints. Anything else is suspicious.
const ALLOWED_PUSH_HOSTS = [
  /\.googleapis\.com$/,
  /\.google\.com$/,
  /\.mozilla\.com$/,
  /\.mozilla\.org$/, // updates.push.services.mozilla.org etc.
  /\.windows\.com$/,
  /\.microsoft\.com$/,
  /\.apple\.com$/,
  /\.icloud\.com$/, // sometimes APNS-relay endpoints
];

const base64ish = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9+/_=-]+$/, 'expected base64url-ish characters');

const subscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine(
        url => {
          try {
            const u = new URL(url);
            if (u.protocol !== 'https:') return false;
            return ALLOWED_PUSH_HOSTS.some(re => re.test(u.hostname));
          } catch {
            return false;
          }
        },
        {
          message: 'endpoint hostname is not on the push-provider allowlist',
        },
      ),
    keys: z
      .object({
        p256dh: base64ish,
        auth: base64ish,
      })
      .strict(),
    expirationTime: z.union([z.number(), z.null()]).optional(),
  })
  .strict();

const requestSchema = z
  .object({
    subscription: subscriptionSchema,
  })
  .strict();

const deleteSchema = z
  .object({
    endpoint: z.string().url().max(2048),
  })
  .strict();

async function getSession(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  return verifySessionJwt(cookie?.value);
}

async function rateLimitOrReject(sub: string) {
  const limit = await checkRateLimitDurable('push-subscribe', sub, 5, 3600);
  if (!limit.allowed) {
    return publicError('RATE_LIMITED', 'Too many subscribe requests this hour');
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Belt + suspenders: middleware should have already 401'd unauthenticated
  // calls now that this route is gated, but we re-check inside the handler
  // because PUBLIC_API_ROUTES history shows route configs drift over time.
  const session = await getSession(req);
  if (!session) return publicError('UNAUTHORIZED');

  const limited = await rateLimitOrReject(session.sub);
  if (limited) return limited;

  let parsed;
  try {
    const raw = await req.json();
    const result = requestSchema.safeParse(raw);
    if (!result.success) return validationError(result.error);
    parsed = result.data;
  } catch (err) {
    return captureAndPublic(err, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          endpoint: parsed.subscription.endpoint,
          p256dh: parsed.subscription.keys.p256dh,
          auth: parsed.subscription.keys.auth,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      );
    if (error) throw new Error(error.message);
  } catch (err) {
    return captureAndPublic(err, 'INTERNAL_ERROR', 'Failed to save subscription');
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return publicError('UNAUTHORIZED');

  const limited = await rateLimitOrReject(session.sub);
  if (limited) return limited;

  let parsed;
  try {
    const raw = await req.json();
    const result = deleteSchema.safeParse(raw);
    if (!result.success) return validationError(result.error);
    parsed = result.data;
  } catch (err) {
    return captureAndPublic(err, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  try {
    const supabase = createServiceClient();
    await supabase.from('push_subscriptions').delete().eq('endpoint', parsed.endpoint);
  } catch (err) {
    return captureAndPublic(err, 'INTERNAL_ERROR', 'Failed to delete subscription');
  }

  return NextResponse.json({ success: true });
}
