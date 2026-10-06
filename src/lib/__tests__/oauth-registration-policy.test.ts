import { describe, it, expect } from 'vitest';
import {
  decideRegistrationAdmission,
  isAnonymousAdmission,
  type AdmissionInput,
} from '../oauth/registration-policy';

/**
 * Admission matrix for RFC 7591 dynamic client registration.
 *
 * The contract being pinned:
 *   - OAUTH_OPEN_DCR=1 admits anonymous registration in production EVEN WHEN
 *     OAUTH_REGISTRATION_TOKEN is set (that is the production configuration,
 *     and without it Claude.app's connector cannot register).
 *   - With the flag absent, every cell is identical to pre-flag behaviour,
 *     including fail-closed in production.
 */

// Fixture value, not a credential.
const TOKEN = 'unit-test-registration-token';

const base: AdmissionInput = {
  sessionValid: false,
  authorizationHeader: null,
  registrationToken: undefined,
  openDcr: undefined,
  nodeEnv: 'production',
};
const decide = (over: Partial<AdmissionInput>) => decideRegistrationAdmission({ ...base, ...over });

describe('registration admission — session', () => {
  for (const nodeEnv of ['production', 'development', 'test']) {
    for (const openDcr of [undefined, '1']) {
      for (const registrationToken of [undefined, TOKEN]) {
        it(`valid session admits (env=${nodeEnv}, flag=${openDcr ?? 'off'}, token ${registrationToken ? 'set' : 'unset'})`, () => {
          expect(decide({ sessionValid: true, nodeEnv, openDcr, registrationToken })).toEqual({
            ok: true,
            via: 'session',
          });
        });
      }
    }
  }
});

describe('registration admission — registration token', () => {
  it('correct bearer admits via token, in production and in dev', () => {
    for (const nodeEnv of ['production', 'development']) {
      expect(
        decide({ nodeEnv, registrationToken: TOKEN, authorizationHeader: `Bearer ${TOKEN}` }),
      ).toEqual({ ok: true, via: 'token' });
    }
  });

  it('correct bearer is still attributed to the token when the flag is also on', () => {
    expect(
      decide({ registrationToken: TOKEN, authorizationHeader: `Bearer ${TOKEN}`, openDcr: '1' }),
    ).toEqual({ ok: true, via: 'token' });
  });

  it('wrong bearer, flag off → denied (production AND dev, exactly as before the flag existed)', () => {
    for (const nodeEnv of ['production', 'development']) {
      expect(
        decide({ nodeEnv, registrationToken: TOKEN, authorizationHeader: 'Bearer nope' }),
      ).toEqual({ ok: false, via: 'denied' });
    }
  });

  it('near-miss bearers are denied', () => {
    const cases = [
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(0, -1)}`,
      `bearer ${TOKEN}`, // scheme is case-sensitive here, as it was before
      TOKEN, // no scheme
      'Bearer ',
      '',
    ];
    for (const authorizationHeader of cases) {
      expect(decide({ registrationToken: TOKEN, authorizationHeader })).toEqual({ ok: false, via: 'denied' });
    }
  });

  it('a bearer can never match when no token is configured', () => {
    expect(decide({ registrationToken: undefined, authorizationHeader: 'Bearer undefined' }).ok).toBe(false);
    expect(decide({ registrationToken: '', authorizationHeader: 'Bearer ' }).ok).toBe(false);
  });

  it('wrong bearer, flag on → admitted, but only as an ANONYMOUS open-dcr registrant', () => {
    const r = decide({ registrationToken: TOKEN, authorizationHeader: 'Bearer nope', openDcr: '1' });
    expect(r).toEqual({ ok: true, via: 'open-dcr' });
    expect(isAnonymousAdmission(r.via)).toBe(true);
  });
});

describe('registration admission — OAUTH_OPEN_DCR flag', () => {
  it('flag on: anonymous registration is admitted in production even with the token gate set', () => {
    expect(decide({ openDcr: '1', registrationToken: TOKEN })).toEqual({ ok: true, via: 'open-dcr' });
  });

  it('flag on: anonymous registration is admitted in production with no token configured', () => {
    expect(decide({ openDcr: '1' })).toEqual({ ok: true, via: 'open-dcr' });
  });

  it('flag off, production, no session, no token → denied (fail closed)', () => {
    expect(decide({})).toEqual({ ok: false, via: 'denied' });
    expect(decide({ registrationToken: TOKEN })).toEqual({ ok: false, via: 'denied' });
  });

  it('only the exact string "1" opts in', () => {
    for (const openDcr of ['0', 'true', 'TRUE', 'yes', ' 1', '1 ', '', 'on', '01']) {
      expect(decide({ openDcr })).toEqual({ ok: false, via: 'denied' });
    }
  });
});

describe('registration admission — production vs dev', () => {
  it('dev, no token configured, flag off → allowed as dev (unchanged ergonomic path)', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      expect(decide({ nodeEnv })).toEqual({ ok: true, via: 'dev' });
    }
  });

  it('dev with a token configured and no match → denied (unchanged)', () => {
    expect(decide({ nodeEnv: 'development', registrationToken: TOKEN })).toEqual({ ok: false, via: 'denied' });
  });

  it('dev with the flag on → open-dcr', () => {
    expect(decide({ nodeEnv: 'development', openDcr: '1' })).toEqual({ ok: true, via: 'open-dcr' });
  });
});

describe('isAnonymousAdmission', () => {
  it('only unauthenticated admissions are subject to the flood cap', () => {
    expect(isAnonymousAdmission('open-dcr')).toBe(true);
    expect(isAnonymousAdmission('dev')).toBe(true);
    expect(isAnonymousAdmission('session')).toBe(false);
    expect(isAnonymousAdmission('token')).toBe(false);
    expect(isAnonymousAdmission('denied')).toBe(false);
  });
});
