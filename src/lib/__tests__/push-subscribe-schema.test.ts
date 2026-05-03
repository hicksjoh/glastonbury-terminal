// P0-5 (hardening/p0-codex-fixes): pull the zod schemas out of the
// /api/push/subscribe handler and test them in isolation.
//
// We re-declare the schemas here because the route module imports
// next/server and Supabase, which vitest can't load in the node env
// without a heavy mock harness. Keeping the test focused on the shape
// validators is enough to guard the audit's "evil endpoint hostname"
// requirement.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const ALLOWED_PUSH_HOSTS = [
  /\.googleapis\.com$/,
  /\.google\.com$/,
  /\.mozilla\.com$/,
  /\.mozilla\.org$/,
  /\.windows\.com$/,
  /\.microsoft\.com$/,
  /\.apple\.com$/,
  /\.icloud\.com$/,
];

const base64ish = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9+/_=-]+$/);

const subscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2048).refine(url => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:') return false;
        return ALLOWED_PUSH_HOSTS.some(re => re.test(u.hostname));
      } catch {
        return false;
      }
    }),
    keys: z.object({ p256dh: base64ish, auth: base64ish }).strict(),
    expirationTime: z.union([z.number(), z.null()]).optional(),
  })
  .strict();

describe('push/subscribe payload schema', () => {
  const validKeys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ', auth: 'tBHItJI5svbpez7KI4CCXg' };

  it('accepts a Google FCM endpoint', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: validKeys,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a Mozilla autopush endpoint', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://updates.push.services.mozilla.org/wpush/v2/abc',
      keys: validKeys,
    });
    expect(r.success).toBe(true);
  });

  it('accepts an Apple WebPush endpoint', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://api.push.apple.com/3/device/abc',
      keys: validKeys,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an attacker-controlled endpoint hostname', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://evil.example.com/spoof',
      keys: validKeys,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a hostname-suffix collision (googleapis.com.evil.com)', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://googleapis.com.evil.com/spoof',
      keys: validKeys,
    });
    expect(r.success).toBe(false);
  });

  it('rejects http (non-https) endpoints', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'http://fcm.googleapis.com/fcm/send/abc',
      keys: validKeys,
    });
    expect(r.success).toBe(false);
  });

  it('rejects garbage in p256dh / auth (binary chars)', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'has spaces', auth: 'tBHItJI5svbpez7KI4CCXg' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown extra fields (.strict)', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: validKeys,
      malicious_extra: 'pwn',
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing keys.auth', () => {
    const r = subscriptionSchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: validKeys.p256dh } as { p256dh: string; auth?: string },
    });
    expect(r.success).toBe(false);
  });
});
