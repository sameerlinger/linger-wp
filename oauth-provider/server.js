// Minimal GitHub OAuth provider for Decap CMS ("git-gateway"-free github backend).
// Implements the two endpoints + postMessage handshake Decap CMS expects:
// https://decapcms.org/docs/github-backend/#using-an-external-oauth-client
const express = require("express");
const crypto = require("crypto");
const { mountCmsProxy } = require("./cmsProxy");

const app = express();
app.set("trust proxy", true);

const {
  GITHUB_OAUTH_CLIENT_ID,
  GITHUB_OAUTH_CLIENT_SECRET,
  LINGER_WP_DEPLOY_HOOK_URL,
  CMS_SSO_SECRET,
  GITHUB_CONTENT_TOKEN,
  FOLIO_URL = "https://linger-booking-engine.onrender.com",
} = process.env;

const pendingStates = new Set();

app.get("/", (req, res) => res.send("linger-wp-oauth: ok"));

// Lets the "Sync properties" button on the Decap CMS admin page (see
// admin/index.html) force a fresh linger-wp build/deploy on demand, instead
// of waiting for the next unrelated CMS edit to pick up a dormant-status
// change made in Folio. Deliberately unauthenticated (same trust level as
// any other visitor-facing action on this static site) since triggering a
// rebuild isn't destructive or sensitive - just rate-limited so it can't be
// hammered. The actual secret (the Render deploy hook URL) stays
// server-side; the browser never sees it.
const SYNC_ALLOWED_ORIGINS = [
  "https://linger.in",
  "https://www.linger.in",
  "https://linger-wp.onrender.com",
  "http://localhost:8080",
];
const SYNC_RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000;
let lastSyncAt = 0;

function applySyncCors(req, res) {
  const origin = req.headers.origin;
  if (origin && SYNC_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

app.options("/sync-deploy", (req, res) => {
  applySyncCors(req, res);
  res.status(204).end();
});

app.post("/sync-deploy", async (req, res) => {
  applySyncCors(req, res);

  if (!LINGER_WP_DEPLOY_HOOK_URL) {
    return res.status(500).json({ error: "Not configured - missing LINGER_WP_DEPLOY_HOOK_URL" });
  }

  const now = Date.now();
  if (now - lastSyncAt < SYNC_RATE_LIMIT_WINDOW_MS) {
    return res.status(429).json({ error: "A sync was just triggered - please wait a couple of minutes and try again" });
  }
  lastSyncAt = now;

  try {
    const hookRes = await fetch(LINGER_WP_DEPLOY_HOOK_URL, { method: "POST" });
    if (!hookRes.ok) throw new Error(`deploy hook responded ${hookRes.status}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[sync-deploy]", err.message);
    return res.status(502).json({ error: "Could not trigger a redeploy" });
  }
});

// Where the CMS admin page can be opened from: the live site, and Render's
// PR previews of it (so a CMS change can be tried before merging).
const ADMIN_ORIGIN = /^(https:\/\/(www\.)?linger\.in|https:\/\/linger-wp(-pr-\d+)?\.onrender\.com|http:\/\/localhost:8080)$/;

// Folio team sign-in + GitHub API proxy — see cmsProxy.js. Big limit for
// base64 photo uploads.
app.use("/github", express.json({ limit: "40mb" }));
mountCmsProxy(app, {
  secret: CMS_SSO_SECRET,
  githubToken: GITHUB_CONTENT_TOKEN,
  folioUrl: FOLIO_URL,
  isAllowedOrigin: ADMIN_ORIGIN,
});

// The original personal-GitHub-account sign-in (/auth + /callback). Unused
// once admin/config.yml points at /folio-auth; kept until that's live.
app.get("/auth", (req, res) => {
  if (!GITHUB_OAUTH_CLIENT_ID) {
    return res.status(500).send("Missing GITHUB_OAUTH_CLIENT_ID");
  }
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const redirectUri = `${req.protocol}://${req.get("host")}/callback`;
  const params = new URLSearchParams({
    client_id: GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "repo,user",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!state || !pendingStates.has(state)) {
    return res.status(400).send("Invalid or expired state");
  }
  pendingStates.delete(state);

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_OAUTH_CLIENT_ID,
        client_secret: GITHUB_OAUTH_CLIENT_SECRET,
        code,
      }),
    });
    const tokenJson = await tokenRes.json();

    if (tokenJson.error || !tokenJson.access_token) {
      return res.status(400).send(`OAuth error: ${tokenJson.error_description || tokenJson.error || "unknown"}`);
    }

    const payload = JSON.stringify({ token: tokenJson.access_token, provider: "github" });

    res.send(`<!doctype html><html><body>
<script>
(function() {
  function receiveMessage(e) {
    window.opener.postMessage(
      'authorization:github:success:${payload.replace(/'/g, "\\'")}',
      e.origin
    );
    window.removeEventListener('message', receiveMessage, false);
  }
  window.addEventListener('message', receiveMessage, false);
  window.opener.postMessage('authorizing:github', '*');
})();
</script>
</body></html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth callback failed");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`linger-wp-oauth listening on ${port}`));
