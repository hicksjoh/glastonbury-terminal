'use client';

import { useState } from 'react';

// Approve / Deny controls for the OAuth consent screen.
//
// Why this is a client component (2026-09-19 connector QA): Approve used to
// be a plain <form> with no submit guard. A second submit — a double-click,
// an impatient re-click while the cross-origin 303 to claude.ai was still in
// flight — POSTed the same consent transaction twice. The transaction is
// single-use, so the second POST landed on an error page that replaced the
// in-flight redirect, stranding a perfectly good authorization code. See the
// production trace in src/app/api/oauth/finalize/route.ts.
//
// /api/oauth/finalize now recovers from a duplicate submit on its own. This
// is the other half: don't send the duplicate in the first place. Two
// independent guards, because the server one depends on a database write
// landing before the second request reads it.

export default function ApproveForm({ tx }: { tx: string }) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      method="post"
      action="/api/oauth/finalize"
      onSubmit={(e) => {
        if (submitting) {
          // Already sent. Swallow the repeat rather than racing ourselves.
          e.preventDefault();
          return;
        }
        setSubmitting(true);
      }}
      style={{ display: 'flex', gap: 12, marginTop: 24 }}
    >
      {/* The transaction id IS the consent — finalize loads everything server-side. */}
      <input type="hidden" name="tx" value={tx} />

      <button
        type="submit"
        disabled={submitting}
        style={{
          flex: 1,
          padding: '12px 16px',
          borderRadius: 8,
          border: '1px solid #2a7d4f',
          backgroundColor: submitting ? '#16402a' : '#1f5e3c',
          color: submitting ? '#8fbfa4' : '#fff',
          fontSize: 14,
          fontWeight: 600,
          cursor: submitting ? 'wait' : 'pointer',
        }}
      >
        {submitting ? 'Approving…' : 'Approve access'}
      </button>
      <a
        href="/"
        style={{
          flex: 1,
          padding: '12px 16px',
          borderRadius: 8,
          border: '1px solid #3a3a4a',
          backgroundColor: 'transparent',
          color: '#c0c0d0',
          fontSize: 14,
          fontWeight: 600,
          textAlign: 'center',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        Deny
      </a>
    </form>
  );
}
