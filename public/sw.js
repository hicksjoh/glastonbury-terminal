// Glastonbury Terminal — Service Worker SELF-DESTRUCT (p7-3)
//
// The previous SW (gt-v1) cached responses including the /oauth/consent
// HTML, which carried the pre-p7-1 form-action CSP. Even after the new
// build shipped, browsers running the old SW kept serving the stale CSP
// from DYNAMIC_CACHE, silently blocking the OAuth redirect to
// https://claude.ai/api/mcp/auth_callback. Bumping CACHE_VERSION wasn't
// enough — the old SW had to be torn down completely.
//
// This SW does one thing on activation: nukes every cache, unregisters
// itself, and forces every open client to reload. After it runs once,
// the origin has no service worker. The PWA's offline + push features
// will need to be re-added in a later commit with /oauth/* explicitly
// bypassed; for now, getting Claude.app's MCP connector working wins.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Wipe every cache this origin owns.
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // Unregister this SW so the browser stops invoking it.
      await self.registration.unregister();

      // Force every controlled tab to reload — they're still running
      // against the old SW until they navigate again. A hard reload
      // here means the next page load goes straight to origin.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        try {
          client.navigate(client.url);
        } catch {
          /* some browsers reject navigate() — ignore, the unregister
             alone is enough for the next user-initiated navigation. */
        }
      }
    })(),
  );
});

// No fetch handler — every request goes to the network untouched.
