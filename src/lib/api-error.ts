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
 */
export function captureAndPublic(
  err: unknown,
  code: ApiErrorCode,
  message?: string,
  status?: number,
): NextResponse {
  let eventId: string | undefined;
  try {
    eventId = Sentry.captureException(err) || undefined;
  } catch {
    // Sentry init failures must never mask the real error response.
  }
  return publicError(code, message, status, eventId ? { eventId } : undefined);
}
