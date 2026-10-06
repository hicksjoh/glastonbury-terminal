// Admission policy for RFC 7591 dynamic client registration.
//
// Pure decision function — no I/O, no env reads — so the whole matrix is
// unit-testable (src/lib/__tests__/oauth-registration-policy.test.ts). The
// route (src/app/api/oauth/register/route.ts) gathers the inputs.
//
// Order (first match wins):
//   1. valid gt-auth session cookie          → admit  (via 'session')
//   2. OAUTH_REGISTRATION_TOKEN bearer match → admit  (via 'token')
//   3. OAUTH_OPEN_DCR === '1'                → admit  (via 'open-dcr')
//   4. OAUTH_REGISTRATION_TOKEN configured   → DENY   (gate is on, no match)
//   5. NODE_ENV === 'production'             → DENY   (fail closed)
//   6. otherwise (dev)                       → admit  (via 'dev', with a warn)
//
// History:
//   - p1-5 added the session / token gates.
//   - p6-1 made production fail closed when the token gate was unset.
//   - p7-1 (commit 97756c3, never merged to main) added OAUTH_OPEN_DCR. It is
//     re-applied here by intent. Claude.app's custom-connector backend does
//     standard anonymous RFC 7591 registration and cannot attach a bearer, so
//     without the opt-in a fresh connector can never register in production.
//
// Open DCR is an EXPLICIT opt-in (a flag that must equal "1"), never the
// silent result of some other variable being absent — that was the p6-1
// lesson. Without the flag, behaviour is exactly what it was before this
// change, in every environment.
//
// Registration grants no access by itself. The security gate is the consent
// screen: /api/oauth/authorize needs Wes's session and /oauth/consent needs a
// human click before any code is minted. Open DCR is additionally bounded by
// the 5/min/IP rate limit and the MAX_NEW_CLIENTS_PER_24H table cap.

import { safeSecretEqual } from '@/lib/safe-compare';

export type AdmissionVia = 'session' | 'token' | 'open-dcr' | 'dev' | 'denied';

export interface AdmissionResult {
  ok: boolean;
  via: AdmissionVia;
}

export interface AdmissionInput {
  /** True when the request carried a gt-auth cookie that verified. */
  sessionValid: boolean;
  /** Raw `Authorization` header, if any. */
  authorizationHeader: string | null | undefined;
  /** process.env.OAUTH_REGISTRATION_TOKEN */
  registrationToken: string | undefined;
  /** process.env.OAUTH_OPEN_DCR */
  openDcr: string | undefined;
  /** process.env.NODE_ENV */
  nodeEnv: string | undefined;
}

export function decideRegistrationAdmission(input: AdmissionInput): AdmissionResult {
  if (input.sessionValid) return { ok: true, via: 'session' };

  const expected = input.registrationToken;
  const tokenConfigured = typeof expected === 'string' && expected.length > 0;
  if (tokenConfigured) {
    const header = input.authorizationHeader ?? '';
    if (header.startsWith('Bearer ') && safeSecretEqual(header.slice(7), expected)) {
      return { ok: true, via: 'token' };
    }
    // Configured but not matched — fall through: the open-DCR opt-in may
    // still admit this caller as an ANONYMOUS registrant (both gates can
    // coexist: token for admin scripts, open DCR for Claude.app).
  }

  if (input.openDcr === '1') return { ok: true, via: 'open-dcr' };

  // No opt-in. From here on behaviour is identical to pre-flag main.
  if (tokenConfigured) return { ok: false, via: 'denied' };
  if (input.nodeEnv === 'production') return { ok: false, via: 'denied' };
  return { ok: true, via: 'dev' };
}

/** Admissions that carry no proof of who is registering. Subject to the cap. */
export function isAnonymousAdmission(via: AdmissionVia): boolean {
  return via === 'open-dcr' || via === 'dev';
}
