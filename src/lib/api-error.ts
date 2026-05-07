// Shared API error helpers (P0-4, hardening/p0-codex-fixes).
//
// Order routes (and ideally every API route over time) should never echo
// raw upstream error bodies to the client — they leak provider names,
// account state, internal stack traces, and useful reconnaissance to
// attackers. Instead:
//
//   - validation failures → publicError('VALIDATION_ERROR', message, 400)
//   - upstream rejections → captureAndPublic(err, 'ORDER_REJECTED')
//   - generic 500s        → captureAndPublic(err, 'INTERNAL_ERROR')
//
// Sentry gets the full error (when SENTRY_DSN is configured); the browser
// gets a stable code + a generic message + the Sentry event ID for support
// triage.

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type { ZodError } from 'zod';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'ORDER_REJECTED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  ORDER_REJECTED: 422,
  UPSTREAM_UNAVAILABLE: 502,
  INTERNAL_ERROR: 500,
};

const GENERIC_MESSAGE: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Request payload failed validation',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Too many requests',
  ORDER_REJECTED: 'Order rejected by broker',
  UPSTREAM_UNAVAILABLE: 'Upstream provider unavailable',
  INTERNAL_ERROR: 'Internal server error',
};

interface PublicErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Zod issues — only set on VALIDATION_ERROR. PropertyKey covers
   *  string|number|symbol because Zod 4 returns `PropertyKey[]` paths. */
  issues?: { path: PropertyKey[]; message: string }[];
  /** Sentry event ID — present whenever an error was captured. */
  eventId?: string;
}

export function publicError(
  code: ApiErrorCode,
  message?: string,
  status?: number,
  extra?: Partial<PublicErrorBody>,
): NextResponse {
  const body: PublicErrorBody = {
    code,
    message: message ?? GENERIC_MESSAGE[code],
    ...extra,
  };
  return NextResponse.json(body, { status: status ?? DEFAULT_STATUS[code] });
}

/**
 * Convert a zod ZodError into a 400 VALIDATION_ERROR with structured issues.
 */
export function validationError(zodErr: ZodError, message?: string): NextResponse {
  const issues = zodErr.issues.map(i => ({
    path: i.path,
    message: i.message,
  }));
  return publicError('VALIDATION_ERROR', message, 400, { issues });
}

/**
 * Capture an exception to Sentry (no-op if no DSN) and return a generic
 * client response with the captured eventId. The original error message is
 * NEVER echoed to the client.
 *
 * `extras` lets callers attach request-scoped context (request_id, route,
 * relevant input fields) so the Sentry event is grep-correlatable with
 * the structured log line for the same request. p2-5's loggerFor returns
 * `request_id` — pass it through here for end-to-end traceability.
 */
export function captureAndPublic(
  err: unknown,
  code: ApiErrorCode,
  message?: string,
  status?: number,
  extras?: Record<string, unknown>,
): NextResponse {
  let eventId: string | undefined;
  try {
    eventId = Sentry.captureException(err, extras ? { extra: extras } : undefined) || undefined;
  } catch {
    // Sentry init failures must never mask the real error response.
  }
  return publicError(code, message, status, eventId ? { eventId } : undefined);
}

/**
 * Capture an error to Sentry with route context, return the eventId for
 * correlation, but DO NOT construct a NextResponse. Use this when the
 * caller wants to keep its existing response shape (legacy `success:
 * false` envelopes, custom error fields) but still wants Sentry capture.
 *
 * Standard call site:
 *   } catch (err) {
 *     const eventId = captureRouteError(err, { request_id, route });
 *     log.error({ err: msg, sentry_event_id: eventId }, 'route X failed');
 *     return NextResponse.json({ success: false, error: '...' }, { status: 500 });
 *   }
 *
 * The eventId is the bridge between the structured log line and the
 * Sentry event — Logtail query → eventId → Sentry issue.
 */
export function captureRouteError(
  err: unknown,
  extras?: Record<string, unknown>,
): string | undefined {
  try {
    return Sentry.captureException(err, extras ? { extra: extras } : undefined) || undefined;
  } catch {
    return undefined;
  }
}
