import { findClient } from '@/lib/oauth/clients';

// OAuth consent screen.
//
// Server component — reads the request's search params, looks up the client
// metadata, and renders a single-screen Approve/Deny form. This is the
// only place where Wes can grant a client access to /api/mcp; without
// this approval the auth code is never minted.
//
// The form posts to /api/oauth/finalize, which mints the code and 303s
// to the client's redirect_uri. The Deny button just redirects back to
// home — clients don't get notified, but they'll fail the eventual token
// exchange and Claude.app shows its own "didn't work" UI.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ConsentSearchParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: ConsentSearchParams;
}) {
  const {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    scope = 'mcp',
    state,
  } = searchParams;

  // Bare-minimum guard — /api/oauth/authorize already validated, but if a
  // user lands here directly (e.g., bookmarked) we want a clean error.
  if (!client_id || !redirect_uri || !code_challenge) {
    return (
      <Shell>
        <h1 style={{ color: '#ff6b6b', marginTop: 0 }}>Invalid consent request</h1>
        <p style={{ color: '#a0a0b0' }}>
          This page must be reached through an OAuth authorization request.
          If you got here by clicking a link, the link is incomplete or
          tampered with.
        </p>
      </Shell>
    );
  }

  const client = await findClient(client_id);
  if (!client) {
    return (
      <Shell>
        <h1 style={{ color: '#ff6b6b', marginTop: 0 }}>Unknown client</h1>
        <p style={{ color: '#a0a0b0' }}>
          The application requesting access (<code>{client_id}</code>) is
          not registered. Reject this request — never approve it.
        </p>
      </Shell>
    );
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    return (
      <Shell>
        <h1 style={{ color: '#ff6b6b', marginTop: 0 }}>Mismatched redirect URI</h1>
        <p style={{ color: '#a0a0b0' }}>
          The redirect URI in this request does not match any URI registered
          for <strong>{escapeHtml(client.client_name)}</strong>. This is
          a strong signal of tampering — do not approve.
        </p>
      </Shell>
    );
  }

  // Resolve the redirect host for display, so Wes sees what domain Claude
  // is bouncing the auth code to.
  let redirectHost = '';
  try {
    redirectHost = new URL(redirect_uri).host;
  } catch {
    /* shouldn't happen post-validation, but be safe */
  }

  return (
    <Shell>
      <h1 style={{ marginTop: 0, fontSize: 24, fontWeight: 600 }}>
        Approve Glastonbury Terminal access
      </h1>
      <p style={{ color: '#c0c0d0', lineHeight: 1.5, marginBottom: 24 }}>
        <strong style={{ color: '#fff' }}>{escapeHtml(client.client_name)}</strong>{' '}
        is requesting access to your terminal&rsquo;s MCP tools.
      </p>

      <Section title="What this grants">
        <ul style={{ margin: 0, paddingLeft: 18, color: '#c0c0d0', lineHeight: 1.6 }}>
          <li>Read your portfolio, watchlist, briefings, and shared agent memory</li>
          <li>Add symbols to your watchlist</li>
          <li>Write to shared agent memory</li>
        </ul>
        <p style={{ color: '#888', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          Cannot place trades. Cannot access financial accounts directly.
        </p>
      </Section>

      <Section title="Where the code is sent">
        <code style={{ color: '#7dd3fc', fontSize: 13, wordBreak: 'break-all' }}>
          {escapeHtml(redirect_uri)}
        </code>
        {redirectHost ? (
          <p style={{ color: '#888', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            Domain: <strong style={{ color: '#c0c0d0' }}>{escapeHtml(redirectHost)}</strong>
          </p>
        ) : null}
      </Section>

      <Section title="Token lifetime">
        <p style={{ margin: 0, color: '#c0c0d0' }}>
          Access tokens expire after 1 hour. The client will re-prompt you
          when expired.
        </p>
      </Section>

      <form method="post" action="/api/oauth/finalize" style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <input type="hidden" name="client_id" value={client_id} />
        <input type="hidden" name="redirect_uri" value={redirect_uri} />
        <input type="hidden" name="code_challenge" value={code_challenge} />
        <input type="hidden" name="code_challenge_method" value={code_challenge_method ?? 'S256'} />
        <input type="hidden" name="scope" value={scope} />
        {state ? <input type="hidden" name="state" value={state} /> : null}

        <button
          type="submit"
          style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: 8,
            border: '1px solid #2a7d4f',
            backgroundColor: '#1f5e3c',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Approve access
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

      <p style={{ color: '#666', fontSize: 12, marginTop: 16, marginBottom: 0 }}>
        Only approve clients you trust. The application above will be able to
        read your portfolio data until the token expires.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#08080d',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: '100%',
          border: '1px solid #2a2a3a',
          borderRadius: 16,
          padding: 32,
          backgroundColor: '#1a1a24',
          color: '#fff',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: '#7a7a90',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function escapeHtml(s: string): string {
  // Server component renders this through React, which already escapes —
  // but keep an explicit pass-through helper so we never accidentally
  // dangerouslySetInnerHTML these values during a refactor.
  return s;
}
