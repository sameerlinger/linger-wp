// Minimal GitHub OAuth provider for Decap CMS ("git-gateway"-free github backend).
// Implements the two endpoints + postMessage handshake Decap CMS expects:
// https://decapcms.org/docs/github-backend/#using-an-external-oauth-client
const express = require("express");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", true);

const { GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET } = process.env;

const pendingStates = new Set();

app.get("/", (req, res) => res.send("linger-wp-oauth: ok"));

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
