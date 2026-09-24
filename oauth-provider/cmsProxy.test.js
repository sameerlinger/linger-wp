// node --test — runs the proxy against a tiny fake GitHub API.
const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const { mountCmsProxy, signToken } = require("./cmsProxy");

const SECRET = "test-secret";
const REPO = "/repos/sameerlinger/linger-wp";

function fakeGithub() {
  const gh = express();
  gh.use(express.json({ limit: "40mb" }));
  const state = { head: "c0", tree: "t0", n: 0, commits: {}, calls: [], auths: new Set() };
  gh.use((req, res, next) => {
    state.calls.push(`${req.method} ${req.originalUrl}`);
    state.auths.add(req.headers.authorization);
    next();
  });
  // "gho_admin" is a GitHub user with push access; "gho_stranger" isn't.
  gh.get(`${REPO}`, (req, res) => res.json({ owner: { login: "sameerlinger" }, permissions: { push: req.headers.authorization === "Bearer gho_admin" } }));
  gh.get("/user", (req, res) => res.json({ id: 7, login: req.headers.authorization === "Bearer gho_admin" ? "sameerlinger" : "stranger", name: "Sameer" }));
  gh.get(`${REPO}/branches/main`, (req, res) => res.json({ commit: { sha: state.head, commit: { tree: { sha: state.tree } } } }));
  gh.get(`${REPO}/contents/x`, (req, res) => res.set("Link", `<http://${req.get("host")}${REPO}/contents/x?page=2>; rel="next"`).json([]));
  gh.post(`${REPO}/git/blobs`, (req, res) => res.status(201).json({ sha: `b${++state.n}` }));
  gh.post(`${REPO}/git/trees`, (req, res) => res.status(201).json({ sha: `t${++state.n}` }));
  gh.post(`${REPO}/git/commits`, (req, res) => {
    const sha = `c${++state.n}`;
    state.commits[sha] = req.body;
    res.status(201).json({ sha });
  });
  gh.patch(`${REPO}/git/refs/heads/main`, (req, res) => {
    state.head = req.body.sha;
    state.lastForce = req.body.force;
    res.json({ object: { sha: req.body.sha } });
  });
  gh.use((req, res) => res.status(404).json({ message: "fake github: not found" }));
  return { gh, state };
}

async function start() {
  const { gh, state } = fakeGithub();
  const ghServer = gh.listen(0);
  const githubApi = `http://127.0.0.1:${ghServer.address().port}`;
  const app = express();
  app.use("/github", express.json({ limit: "40mb" }));
  mountCmsProxy(app, {
    secret: SECRET,
    githubToken: "gh-token",
    folioUrl: "https://folio.example",
    isAllowedOrigin: /^https:\/\/linger\.in$/,
    githubApi,
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, state, githubApi, close: () => (server.close(), ghServer.close()) };
}

const session = (level, sub = "u1") =>
  signToken({ typ: "session", sub, name: "Asha K", email: "asha@linger.in", level, exp: Date.now() / 1000 + 600 }, SECRET);

function api(base, token) {
  return async (method, path, body) => {
    const res = await fetch(`${base}/github${path}`, {
      method,
      headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };
}

// Decap's own save sequence: blob → tree on head → commit → move main.
async function save(call, entries) {
  const head = (await call("GET", `${REPO}/branches/main`)).json.commit.sha;
  const tree = await call("POST", `${REPO}/git/trees`, { base_tree: head, tree: entries });
  if (tree.status !== 201) return tree;
  const commit = await call("POST", `${REPO}/git/commits`, { message: "Update", tree: tree.json.sha, parents: [head] });
  if (commit.status !== 201) return commit;
  return call("PATCH", `${REPO}/git/refs/heads/main`, { sha: commit.json.sha, force: true });
}

const file = (path, sha = "b1") => ({ path, mode: "100644", type: "blob", sha });

test("rejects missing or forged tokens", async () => {
  const t = await start();
  try {
    assert.equal((await api(t.base, "nope")("GET", "/user")).status, 401);
    const ticketNotSession = signToken({ sub: "u1", level: "full", state: "abc", exp: Date.now() / 1000 + 60 }, SECRET);
    assert.equal((await api(t.base, ticketNotSession)("GET", "/user")).status, 401);
    assert.equal((await api(t.base, session("full").replace(/.$/, "x"))("GET", "/user")).status, 401);
  } finally {
    t.close();
  }
});

test("reports the team member as the user and grants push on the repo", async () => {
  const t = await start();
  try {
    const call = api(t.base, session("author"));
    assert.deepEqual((await call("GET", "/user")).json, { login: "asha@linger.in", name: "Asha K", email: "asha@linger.in", avatar_url: "", level: "author" });
    assert.equal((await call("GET", REPO)).json.permissions.push, true);
    const listed = await call("GET", `${REPO}/contents/x`);
    assert.match(listed.headers.get("link"), new RegExp(`^<${t.base}/github${REPO}/contents/x\\?page=2>`));
  } finally {
    t.close();
  }
});

test("reads can't leave the repo", async () => {
  const t = await start();
  try {
    const call = api(t.base, session("full"));
    assert.equal((await call("GET", "/repos/sameerlinger/linger-wpX/contents")).status, 403);
    assert.equal((await call("GET", "/repos/sameerlinger/other/contents")).status, 403);
    assert.equal((await call("GET", `${REPO}/%2e%2e/%2e%2e/other/contents`)).status, 403);
    assert.equal((await call("GET", "/orgs/foo")).status, 403);
    assert.equal((await call("POST", `${REPO}/pulls`, {})).status, 403);
  } finally {
    t.close();
  }
});

test("an author can save a page, a blog post and photos, credited to them", async () => {
  const t = await start();
  try {
    const call = api(t.base, session("author"));
    const res = await save(call, [
      file("src/content/new-page.md"),
      file("src/content/blog/a-post.md"),
      file("src/images/uploads/photo.jpg"),
      file("src/images/balur/cover.webp"),
    ]);
    assert.equal(res.status, 200);
    const commit = t.state.commits[t.state.head];
    assert.equal(commit.author.name, "Asha K");
    assert.equal(commit.author.email, "asha@linger.in");
    // force is always dropped, whatever the client asked for
    assert.equal(t.state.lastForce, false);
  } finally {
    t.close();
  }
});

test("an author can't touch settings, categories, code, site images, or delete", async () => {
  const t = await start();
  try {
    const call = api(t.base, session("author"));
    for (const path of [
      "src/content/categories/coffee.md",
      "src/_data/banner.json",
      "src/_data/heroImages.json",
      "admin/config.yml",
      ".eleventy.js",
      "src/images/site/logo.png",
      "src/images/uploads/evil.svg",
      "src/images/uploads/../../../.eleventy.js",
    ]) {
      const res = await save(call, [file(path)]);
      assert.equal(res.status, 403, path);
    }
    assert.equal((await save(call, [file("src/content/balur.md", null)])).status, 403);
    assert.equal(t.state.head, "c0");
  } finally {
    t.close();
  }
});

test("a full-access admin can change settings and delete", async () => {
  const t = await start();
  try {
    const call = api(t.base, session("full"));
    assert.equal((await save(call, [file("src/_data/banner.json")])).status, 200);
    assert.equal((await save(call, [file("src/content/balur.md", null)])).status, 200);
    assert.equal((await save(call, [{ path: "x", mode: "040000", type: "tree", sha: "t9" }])).status, 403);
  } finally {
    t.close();
  }
});

test("only a tree/commit made through the proxy, on the current head, can land", async () => {
  const t = await start();
  try {
    const call = api(t.base, session("author"));
    // stale base (e.g. an old version of the site with different code)
    assert.equal((await call("POST", `${REPO}/git/trees`, { base_tree: "old", tree: [file("src/content/a.md")] })).status, 409);
    // commit of a tree the proxy never checked
    assert.equal((await call("POST", `${REPO}/git/commits`, { message: "x", tree: "t0", parents: ["c0"] })).status, 403);
    // moving main to a commit the proxy never made
    assert.equal((await call("PATCH", `${REPO}/git/refs/heads/main`, { sha: "c0" })).status, 403);
    // someone else's checked tree
    const tree = await call("POST", `${REPO}/git/trees`, { base_tree: "c0", tree: [file("src/content/a.md")] });
    const other = api(t.base, session("author", "u2"));
    assert.equal((await other("POST", `${REPO}/git/commits`, { message: "x", tree: tree.json.sha, parents: ["c0"] })).status, 403);
    // right tree, wrong parent
    assert.equal((await call("POST", `${REPO}/git/commits`, { message: "x", tree: tree.json.sha, parents: ["zzz"] })).status, 403);
  } finally {
    t.close();
  }
});

test("sign-in callback only accepts a fresh Folio ticket for a state it issued", async () => {
  const t = await start();
  try {
    const chooser = await (await fetch(`${t.base}/folio-auth`)).text();
    assert.match(chooser, /href="\/folio-auth\?via=folio"/);
    assert.match(chooser, /href="\/auth"/);

    const auth = await fetch(`${t.base}/folio-auth?via=folio`, { redirect: "manual" });
    const state = new URL(auth.headers.get("location")).searchParams.get("state");
    assert.match(auth.headers.get("location"), /^https:\/\/folio\.example\/api\/cms\/authorize\?state=[a-f0-9]{32}$/);

    const ticket = (extra) => signToken({ sub: "u1", name: "Asha K", email: "asha@linger.in", level: "author", state, exp: Date.now() / 1000 + 60, ...extra }, SECRET);
    assert.equal((await fetch(`${t.base}/folio-callback?ticket=${encodeURIComponent(ticket({ state: "f".repeat(32) }))}`)).status, 400);
    assert.equal((await fetch(`${t.base}/folio-callback?ticket=${encodeURIComponent(ticket({ level: "none" }))}`)).status, 400);

    const ok = await fetch(`${t.base}/folio-callback?ticket=${encodeURIComponent(ticket())}`);
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /authorization:github:success:/);
    // single use
    assert.equal((await fetch(`${t.base}/folio-callback?ticket=${encodeURIComponent(ticket())}`)).status, 400);

    // and the token it hands Decap works against the proxy
    const token = JSON.parse(JSON.parse(html.match(/success:' \+ ("(?:[^"\\]|\\.)*")/)[1])).token;
    assert.equal((await api(t.base, token)("GET", "/user")).json.level, "author");
  } finally {
    t.close();
  }
});

test("an admin's own GitHub login works as full access, using their token", async () => {
  const t = await start();
  try {
    const call = api(t.base, "gho_admin");
    assert.equal((await call("GET", "/user")).json.login, "sameerlinger");
    t.state.auths.clear();
    assert.equal((await save(call, [file("src/_data/banner.json")])).status, 200);
    assert.equal((await save(call, [file("src/content/balur.md", null)])).status, 200);
    // committed as them (no author override), and only ever with their token
    assert.equal(t.state.commits[t.state.head].author, undefined);
    assert.deepEqual([...t.state.auths], ["Bearer gho_admin"]);
  } finally {
    t.close();
  }
});

test("a GitHub login without push access to the repo is refused", async () => {
  const t = await start();
  try {
    assert.equal((await api(t.base, "gho_stranger")("GET", "/user")).status, 401);
  } finally {
    t.close();
  }
});
