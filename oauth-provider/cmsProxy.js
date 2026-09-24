// Folio team sign-in for the Decap CMS, instead of personal GitHub accounts.
//
// Decap's github backend is pointed at this service as its `api_root`
// (admin/config.yml), so every GitHub API call the CMS makes comes through
// here: we check the caller's session token (minted from a signed Folio
// ticket, see /folio-callback), make the call with one server-side GitHub
// token, and only let through the handful of writes Decap's normal
// save/delete flow uses — blob, tree, commit, then moving main — checking
// what an Author is allowed to touch on the way. Commits are authored as
// the team member.
//
// Levels come from Folio (cmsLevelFor in booking-engine-app's lib/
// cmsTicket.js): admins get "full" - save anything, and delete; people an
// admin ticked as "Website author" in Users & access get "author" - edit/
// add pages and blog posts and upload photos, nothing else.
//
// Admins can instead sign in with their own GitHub account (the original
// /auth flow in server.js): a GitHub token with push access to the repo is
// accepted here as "full", and its calls are made with that token, so
// commits are theirs on GitHub as before.
const crypto = require("crypto");

const REPO = "sameerlinger/linger-wp";
const BRANCH = "main";
const GITHUB_API = "https://api.github.com";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PENDING_TTL_MS = 10 * 60 * 1000;
const GITHUB_LOGIN_CACHE_MS = 5 * 60 * 1000;

// Same format as booking-engine-app's lib/cmsTicket.js (duplicated rather
// than shared): base64url(JSON) + "." + base64url(HMAC-SHA256).
function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

function verifyToken(token, secret) {
  if (!secret || typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("base64url"));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

// A Folio ticket carries the popup's `state`; our own session tokens carry
// typ "session" instead, so neither can be passed off as the other.
function sessionFromTicket(ticket, secret) {
  const t = verifyToken(ticket, secret);
  if (!t || t.typ || !t.state || !["full", "author"].includes(t.level)) return null;
  return {
    state: t.state,
    token: signToken(
      {
        typ: "session",
        sub: t.sub,
        name: t.name || t.email || "Linger team",
        email: t.email || `cms-${t.sub}@users.noreply.linger.in`,
        level: t.level,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      },
      secret
    ),
  };
}

function verifySession(token, secret) {
  const s = verifyToken(token, secret);
  return s && s.typ === "session" ? s : null;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)$/i;

// What an Author may write. Pages (src/content/*.md, not categories),
// blog posts, and photos in any page's image folder or uploads — but not
// the site's own logo/assets folder, and no SVG (it can carry script and
// is served from the site's own origin).
function authorMayWrite(path) {
  return (
    /^src\/content\/[^/]+\.md$/.test(path) ||
    /^src\/content\/blog\/[^/]+\.md$/.test(path) ||
    (/^src\/images\/[^/]+\/[^/]+$/.test(path) && !path.startsWith("src/images/site/") && IMAGE_EXT.test(path))
  );
}

// Returns an error message, or null if this tree body is OK for this level.
function checkTreeEntries(tree, level) {
  if (!Array.isArray(tree) || tree.length === 0) return "Nothing to save";
  for (const entry of tree) {
    const path = entry && entry.path;
    if (typeof path !== "string" || path.startsWith("/") || path.split("/").includes("..")) return "Invalid file path";
    if (entry.type !== "blob" || entry.mode !== "100644") return "Only plain files can be saved from the CMS";
    if (level === "full") continue;
    if (entry.sha === null) return "Authors can't delete pages, posts or photos - ask a website admin";
    if (!authorMayWrite(path)) return `Authors can't change ${path} - ask a website admin`;
  }
  return null;
}

// Short-lived memory of the trees/commits this service created, so a commit
// can only use a tree we checked, and main can only move to a commit we
// made on top of its current head. Single instance on Render, and a save is
// a few seconds end to end, so in-memory is enough.
function createLedger() {
  const entries = new Map();
  return {
    add(sha, info) {
      entries.set(sha, { ...info, at: Date.now() });
      for (const [k, v] of entries) if (Date.now() - v.at > PENDING_TTL_MS) entries.delete(k);
    },
    take(sha, sub) {
      const e = entries.get(sha);
      if (!e || e.sub !== sub || Date.now() - e.at > PENDING_TTL_MS) return null;
      entries.delete(sha);
      return e;
    },
  };
}

function mountCmsProxy(app, { secret, githubToken, folioUrl, isAllowedOrigin, githubApi = GITHUB_API }) {
  const pendingStates = new Map();
  const trees = createLedger();
  const commits = createLedger();
  const repoPrefix = `/github/repos/${REPO}`;

  // `as`: a signed-in admin's own GitHub token; otherwise the service's.
  async function github(method, path, { body, accept, as } = {}) {
    return fetch(`${githubApi}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${as || githubToken}`,
        Accept: accept || "application/vnd.github+json",
        "User-Agent": "linger-wp-oauth",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function headOfMain(as) {
    const res = await github("GET", `/repos/${REPO}/branches/${BRANCH}`, { as });
    if (!res.ok) throw new Error(`branch lookup ${res.status}`);
    const json = await res.json();
    return { commit: json.commit.sha, tree: json.commit.commit.tree.sha };
  }

  async function relay(res, ghRes, req, transform) {
    res.status(ghRes.status);
    const type = ghRes.headers.get("content-type");
    if (type) res.setHeader("Content-Type", type);
    const link = ghRes.headers.get("link");
    if (link) res.setHeader("Link", link.split(githubApi).join(`${req.protocol}://${req.get("host")}/github`));
    if (transform && ghRes.ok) return res.json(transform(await ghRes.json()));
    res.send(Buffer.from(await ghRes.arrayBuffer()));
  }

  const deny = (res, status, message) => res.status(status).json({ message });

  // --- Sign-in: Decap opens this in a popup (backend.auth_endpoint). ---
  // Decap only has one login button, so this first asks which way in.
  app.get("/folio-auth", (req, res, next) => {
    if (req.query.via === "folio") return next();
    res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in - Linger website</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 22rem; margin: 3rem auto; padding: 0 1rem; text-align: center">
<h1 style="font-size: 1.2rem; margin-bottom: 1.5rem">Sign in to edit linger.in</h1>
<a href="/folio-auth?via=folio" style="display: block; padding: .8rem; border-radius: 6px; background: #2f5d3a; color: #fff; text-decoration: none; font-weight: 600">Team member &mdash; sign in with LingerApp</a>
<p style="color: #666; font-size: .85rem; margin: .5rem 0 1.5rem">Same Google or phone + PIN login as the booking admin.</p>
<a href="/auth" style="display: block; padding: .7rem; border-radius: 6px; border: 1px solid #bbb; color: #333; text-decoration: none">Admin &mdash; sign in with GitHub</a>
</body></html>`);
  });
  app.get("/folio-auth", (req, res) => {
    if (!secret || !githubToken) return res.status(500).send("CMS sign-in isn't configured yet (CMS_SSO_SECRET / GITHUB_CONTENT_TOKEN)");
    const state = crypto.randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now());
    for (const [k, at] of pendingStates) if (Date.now() - at > PENDING_TTL_MS) pendingStates.delete(k);
    res.redirect(`${folioUrl}/api/cms/authorize?state=${state}`);
  });

  app.get("/folio-callback", (req, res) => {
    const session = sessionFromTicket(req.query.ticket, secret);
    const startedAt = session && pendingStates.get(session.state);
    if (!startedAt || Date.now() - startedAt > PENDING_TTL_MS) {
      return res.status(400).send("Sign-in expired or invalid - close this window and try again.");
    }
    pendingStates.delete(session.state);

    // Decap's popup handshake: announce, then answer the opener's reply
    // with the token — but only if the opener is one of our own admin
    // pages, so another site can't open this popup and collect a token.
    const payload = JSON.stringify({ token: session.token, provider: "github" });
    res.send(`<!doctype html><html><body>
<script>
(function() {
  var allowed = ${JSON.stringify(isAllowedOrigin.source)};
  function receiveMessage(e) {
    if (!new RegExp(allowed).test(e.origin)) return;
    window.opener.postMessage('authorization:github:success:' + ${JSON.stringify(payload)}, e.origin);
    window.removeEventListener('message', receiveMessage, false);
  }
  window.addEventListener('message', receiveMessage, false);
  window.opener.postMessage('authorizing:github', '*');
})();
</script>
</body></html>`);
  });

  // An admin's own GitHub token (from /auth): accepted as "full" if it can
  // push to the repo. Checked with GitHub, then remembered for a few minutes.
  const githubLogins = new Map();
  async function sessionFromGithubToken(token) {
    const cached = githubLogins.get(token);
    if (cached && Date.now() - cached.at < GITHUB_LOGIN_CACHE_MS) return cached.session;
    const [repoRes, userRes] = await Promise.all([
      github("GET", `/repos/${REPO}`, { as: token }),
      github("GET", "/user", { as: token }),
    ]);
    if (!repoRes.ok || !userRes.ok) return null;
    const [repo, user] = await Promise.all([repoRes.json(), userRes.json()]);
    if (!repo.permissions || !repo.permissions.push) return null;
    const session = { sub: `github:${user.id}`, level: "full", githubToken: token };
    githubLogins.set(token, { session, at: Date.now() });
    for (const [k, v] of githubLogins) if (Date.now() - v.at > GITHUB_LOGIN_CACHE_MS) githubLogins.delete(k);
    return session;
  }

  // --- GitHub API proxy (backend.api_root) ---
  app.use("/github", async (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "Link");
    }
    if (req.method === "OPTIONS") return res.status(204).end();

    const [keyword, token] = (req.headers.authorization || "").split(" ");
    let session = null;
    if (keyword && keyword.toLowerCase() === "token" && token) {
      try {
        // Our own session tokens contain a "."; GitHub's never do.
        session = token.includes(".") ? verifySession(token, secret) : await sessionFromGithubToken(token);
      } catch (err) {
        console.error("[cms-proxy auth]", err.message);
        return deny(res, 502, "GitHub request failed");
      }
    }
    if (!session) return deny(res, 401, "Please sign in again");
    req.cmsSession = session;
    next();
  });

  app.get("/github/user", async (req, res) => {
    const s = req.cmsSession;
    if (s.githubToken) return relay(res, await github("GET", "/user", { as: s.githubToken }), req);
    res.json({ login: s.email, name: s.name, email: s.email, avatar_url: "", level: s.level });
  });

  // Decap's notes feature searches GitHub issues; nothing to show.
  app.get("/github/search/issues", (req, res) => res.json({ total_count: 0, incomplete_results: false, items: [] }));

  // Any read inside this one repo (trees, blobs, commits, branches...).
  app.get(/^\/github\/repos\/[^/]+\/[^/]+(\/.*)?$/, async (req, res) => {
    // Resolved the way fetch will resolve it, so "..", encoded dots etc.
    // can't walk out of the repo to some other GitHub endpoint.
    const url = new URL(req.originalUrl.slice("/github".length), GITHUB_API);
    if (url.pathname !== `/repos/${REPO}` && !url.pathname.startsWith(`/repos/${REPO}/`)) {
      return deny(res, 403, "Not available from the CMS");
    }
    try {
      const ghRes = await github("GET", url.pathname + url.search, { accept: req.headers.accept, as: req.cmsSession.githubToken });
      // Decap refuses to load unless the token "has push access".
      const isRepoRoot = url.pathname === `/repos/${REPO}`;
      await relay(res, ghRes, req, isRepoRoot ? (repo) => ({ ...repo, permissions: { ...repo.permissions, push: true } }) : null);
    } catch (err) {
      console.error("[cms-proxy GET]", err.message);
      deny(res, 502, "GitHub request failed");
    }
  });

  app.post(`${repoPrefix}/git/blobs`, async (req, res) => {
    try {
      const { content, encoding } = req.body || {};
      if (typeof content !== "string") return deny(res, 400, "Missing content");
      relay(res, await github("POST", `/repos/${REPO}/git/blobs`, { body: { content, encoding }, as: req.cmsSession.githubToken }), req);
    } catch (err) {
      console.error("[cms-proxy blob]", err.message);
      deny(res, 502, "GitHub request failed");
    }
  });

  app.post(`${repoPrefix}/git/trees`, async (req, res) => {
    const s = req.cmsSession;
    const { base_tree: baseTree, tree } = req.body || {};
    const problem = checkTreeEntries(tree, s.level);
    if (problem) return deny(res, 403, problem);
    try {
      const head = await headOfMain(s.githubToken);
      if (baseTree !== head.commit && baseTree !== head.tree) {
        return deny(res, 409, "The site changed while you were editing - reload the CMS and try again");
      }
      const ghRes = await github("POST", `/repos/${REPO}/git/trees`, { body: { base_tree: baseTree, tree }, as: s.githubToken });
      if (!ghRes.ok) return relay(res, ghRes, req);
      const created = await ghRes.json();
      trees.add(created.sha, { sub: s.sub, parent: head.commit });
      res.status(ghRes.status).json(created);
    } catch (err) {
      console.error("[cms-proxy tree]", err.message);
      deny(res, 502, "GitHub request failed");
    }
  });

  app.post(`${repoPrefix}/git/commits`, async (req, res) => {
    const s = req.cmsSession;
    const { message, tree, parents } = req.body || {};
    const known = trees.take(tree, s.sub);
    if (!known || !Array.isArray(parents) || parents.length !== 1 || parents[0] !== known.parent) {
      return deny(res, 403, "This save didn't come from the CMS's normal flow - reload and try again");
    }
    try {
      const ghRes = await github("POST", `/repos/${REPO}/git/commits`, {
        body: {
          message: String(message || "Update from CMS").slice(0, 1000),
          tree,
          parents,
          // A GitHub sign-in commits as that GitHub user already.
          ...(s.githubToken ? {} : { author: { name: s.name, email: s.email, date: new Date().toISOString() } }),
        },
        as: s.githubToken,
      });
      if (!ghRes.ok) return relay(res, ghRes, req);
      const created = await ghRes.json();
      commits.add(created.sha, { sub: s.sub });
      res.status(ghRes.status).json(created);
    } catch (err) {
      console.error("[cms-proxy commit]", err.message);
      deny(res, 502, "GitHub request failed");
    }
  });

  app.patch(`${repoPrefix}/git/refs/heads/${BRANCH}`, async (req, res) => {
    const { sha } = req.body || {};
    if (!commits.take(sha, req.cmsSession.sub)) {
      return deny(res, 403, "This save didn't come from the CMS's normal flow - reload and try again");
    }
    try {
      // Never forced: if main moved since the tree was built, GitHub
      // rejects this as a non-fast-forward rather than losing that change.
      relay(res, await github("PATCH", `/repos/${REPO}/git/refs/heads/${BRANCH}`, { body: { sha, force: false }, as: req.cmsSession.githubToken }), req);
    } catch (err) {
      console.error("[cms-proxy ref]", err.message);
      deny(res, 502, "GitHub request failed");
    }
  });

  app.all("/github/*", (req, res) => deny(res, 403, "Not available from the CMS"));
}

module.exports = { mountCmsProxy, sessionFromTicket, verifySession, checkTreeEntries, authorMayWrite, signToken };
