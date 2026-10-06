// Grouped views for the Properties and Pages lists in the CMS.
//
// Decap's own list is flat, so on #/collections/properties and
// #/collections/pages this draws a full-screen panel over it instead:
// Properties bucketed by category (a property in several categories is listed
// under each - it's the same entry, so every row opens the same editor),
// Pages bucketed by the top menu they sit under. Editing, adding and
// renaming categories / menu headers is done with Decap's own editors; this
// panel only lists and links to them, so it can't change anything itself.
//
// Like the sync button in index.html it lives outside Decap's own app (an
// overlay, not a widget) and reads the repo through the same linger-wp-oauth
// proxy with the signed-in user's token. The pure parsing/grouping half has
// no browser dependencies so it can be checked from Node (module.exports at
// the bottom).
(function (root) {
  // "---\nyaml\n---\nbody" -> the yaml parsed, or {} if there's none.
  function parseFrontmatter(text, yaml) {
    var m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
    if (!m) return {};
    try {
      var data = yaml.load(m[1]);
      return data && typeof data === "object" ? data : {};
    } catch (e) {
      return {};
    }
  }

  function byTitle(a, b) {
    return String(a.title).localeCompare(String(b.title));
  }

  function num(v, fallback) {
    var n = Number(v);
    return v !== "" && v != null && isFinite(n) ? n : fallback;
  }

  // entries: [{file, data}] for src/content/*.md; categories: same for
  // src/content/categories; menuOrder: src/_data/menu.json's items.
  function groupProperties(entries, categories, menuOrder) {
    var position = {};
    (menuOrder || []).forEach(function (item, n) {
      if (item && item.type === "category" && !(item.category in position)) position[item.category] = n;
    });
    var cats = categories
      .filter(function (c) { return c.data.slug && c.data.title; })
      .map(function (c) {
        return { file: c.file, slug: String(c.data.slug), title: c.data.title, order: num(c.data.order, 999), properties: [] };
      })
      .sort(function (a, b) {
        var pa = a.slug in position ? position[a.slug] : Infinity;
        var pb = b.slug in position ? position[b.slug] : Infinity;
        return (pa === pb ? 0 : pa < pb ? -1 : 1) || a.order - b.order || byTitle(a, b);
      });
    var bySlug = {};
    cats.forEach(function (c) { bySlug[c.slug] = c; });
    var uncategorised = [];
    entries
      .filter(function (e) { return e.data.type === "property"; })
      .map(function (e) {
        var list = Array.isArray(e.data.categories) ? e.data.categories.map(String) : [];
        return {
          file: e.file,
          title: e.data.title || e.file,
          location: e.data.location || "",
          categories: list.filter(function (s) { return bySlug[s]; }),
        };
      })
      .sort(byTitle)
      .forEach(function (p) {
        if (!p.categories.length) uncategorised.push(p);
        p.categories.forEach(function (s) { bySlug[s].properties.push(p); });
      });
    return { categories: cats, uncategorised: uncategorised, titles: bySlug };
  }

  // menus: src/content/menus files. A menu is keyed by its file name (that's
  // what a page's navMenu holds), and shown in Menu order's position.
  function groupPages(entries, menus, menuOrder) {
    var position = {};
    (menuOrder || []).forEach(function (item, n) {
      if (item && item.type === "menu" && !(item.menu in position)) position[item.menu] = n;
    });
    var list = menus
      .filter(function (m) { return m.data.title; })
      .map(function (m) {
        var links = (Array.isArray(m.data.links) ? m.data.links : []).filter(function (l) { return l && l.label; });
        return { file: m.file, slug: m.file, title: m.data.title, links: links, pages: [] };
      })
      .sort(function (a, b) {
        var pa = a.slug in position ? position[a.slug] : Infinity;
        var pb = b.slug in position ? position[b.slug] : Infinity;
        return (pa === pb ? 0 : pa < pb ? -1 : 1) || byTitle(a, b);
      });
    var bySlug = {};
    list.forEach(function (m) { bySlug[m.slug] = m; });
    var unplaced = [];
    entries
      .filter(function (e) { return e.data.type === "page"; })
      .map(function (e) {
        return {
          file: e.file,
          title: e.data.title || e.file,
          label: e.data.menuLabel || "",
          order: num(e.data.menuOrder, 1000),
          menu: e.data.navMenu,
        };
      })
      .sort(function (a, b) { return a.order - b.order || byTitle(a, b); })
      .forEach(function (p) {
        (bySlug[p.menu] ? bySlug[p.menu].pages : unplaced).push(p);
      });
    return { menus: list, unplaced: unplaced };
  }

  // Front-matter text edits. Only the one key is touched, so the rest of the
  // file stays byte-for-byte as it was (no re-serialising through a YAML lib).
  function yamlScalar(v) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) ? v : JSON.stringify(v);
  }

  // Replace (or drop, if lines is empty) the top-level `key` and its value in
  // the front matter; if it isn't there yet, add it at the end.
  function setKey(text, key, lines) {
    var m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
    if (!m) throw new Error("No front matter");
    var re = new RegExp("^" + key + ":[^\\n]*(?:\\r?\\n[ \\t]*-[^\\n]*)*", "m");
    var yaml = m[2];
    if (re.test(yaml)) {
      yaml = lines.length
        ? yaml.replace(re, function () { return lines.join("\n"); })
        : yaml.replace(re, "").replace(/\n{2,}/g, "\n").replace(/^\n|\n$/g, "");
    } else if (lines.length) {
      yaml = yaml + "\n" + lines.join("\n");
    }
    return m[1] + yaml + m[3] + text.slice(m[0].length);
  }

  function setCategories(text, slugs) {
    return setKey(text, "categories", slugs.length ? ["categories:"].concat(slugs.map(function (s) { return "  - " + yamlScalar(s); })) : []);
  }

  function setNavMenu(text, slug) {
    return setKey(text, "navMenu", slug ? ["navMenu: " + yamlScalar(slug)] : []);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseFrontmatter: parseFrontmatter, groupProperties: groupProperties, groupPages: groupPages, setCategories: setCategories, setNavMenu: setNavMenu };
  }
  if (typeof document === "undefined") return;

  // ---------------------------------------------------------------- browser

  var REPO_API = "https://linger-wp-oauth.onrender.com/github/repos/sameerlinger/linger-wp";
  var LIST_ROUTE = /^#\/collections\/(properties|pages)\/?(\?.*)?$/;
  var blobCache = {}; // blob sha -> text; a file's sha changes whenever it does
  var host = null; // our container inside Decap's <main>
  var hostKind = null;
  var model = null; // last loaded repo data
  var plain = false; // "Plain list" chosen: leave Decap's own list showing
  var saving = Promise.resolve(); // saves run one at a time

  function token() {
    try { return JSON.parse(localStorage.getItem("decap-cms-user") || "null").token; } catch (e) { return null; }
  }

  function canEditStructure() {
    var t = token();
    if (!t) return false;
    if (t.indexOf(".") === -1) return true; // an admin's own GitHub sign-in
    try {
      var body = t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(body)).level === "full";
    } catch (e) {
      return false;
    }
  }

  function api(method, path, opts) {
    opts = opts || {};
    var headers = { Authorization: "token " + token(), Accept: opts.accept || "application/vnd.github+json" };
    if (opts.body) headers["Content-Type"] = "application/json";
    // no-store: these are the same URLs Decap itself reads (blobs) but in a
    // different format (raw text vs its JSON). Letting the browser cache ours
    // makes Decap get our copy back, and its entries load empty / garbled.
    return fetch(REPO_API + path, { method: method, headers: headers, cache: "no-store", body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            throw new Error(j.message || j.error || "GitHub " + res.status);
          });
        }
        return opts.accept ? res.text() : res.json();
      });
  }

  function loadAll() {
    return api("GET", "/git/trees/main?recursive=1").then(function (tree) {
      var files = tree.tree.filter(function (f) {
        return f.type === "blob" && (/^src\/content\/(categories\/|menus\/)?[^/]+\.md$/.test(f.path) || f.path === "src/_data/menu.json");
      });
      return Promise.all(files.map(function (f) {
        if (blobCache[f.sha] != null) return { path: f.path, text: blobCache[f.sha] };
        return api("GET", "/git/blobs/" + f.sha, { accept: "application/vnd.github.raw" }).then(function (text) {
          blobCache[f.sha] = text;
          return { path: f.path, text: text };
        });
      }));
    }).then(function (docs) {
      var out = { content: [], categories: [], menus: [], menuOrder: [] };
      docs.forEach(function (d) {
        if (d.path === "src/_data/menu.json") {
          try { out.menuOrder = JSON.parse(d.text).items || []; } catch (e) {}
          return;
        }
        var m = /^src\/content\/(?:(categories|menus)\/)?([^/]+)\.md$/.exec(d.path);
        var item = { file: m[2], data: parseFrontmatter(d.text, window.jsyaml) };
        (m[1] === "categories" ? out.categories : m[1] === "menus" ? out.menus : out.content).push(item);
      });
      return out;
    });
  }

  // The same calls Decap makes to save: blob, tree, commit, move main. The
  // file is re-read from main's current head right before editing, so a
  // change made elsewhere meanwhile isn't overwritten.
  function commitEdit(file, edit, message) {
    var path = "src/content/" + file + ".md";
    return api("GET", "/branches/main").then(function (branch) {
      var head = branch.commit.sha;
      return api("GET", "/contents/" + path + "?ref=" + head, { accept: "application/vnd.github.raw" }).then(function (text) {
        return api("POST", "/git/blobs", { body: { content: edit(text), encoding: "utf-8" } });
      }).then(function (blob) {
        return api("POST", "/git/trees", { body: { base_tree: head, tree: [{ path: path, mode: "100644", type: "blob", sha: blob.sha }] } });
      }).then(function (tree) {
        return api("POST", "/git/commits", { body: { message: message, tree: tree.sha, parents: [head] } });
      }).then(function (commit) {
        return api("PATCH", "/git/refs/heads/main", { body: { sha: commit.sha } });
      });
    });
  }

  // ------------------------------------------------------------------ view

  var COLOR = { text: "#313d3e", muted: "#798291", link: "#3a69c7" };
  var SHADOW = "rgba(68, 74, 87, 0.05) 0px 2px 6px 0px, rgba(68, 74, 87, 0.1) 0px 1px 3px 0px";
  var STYLE_ID = "grouped-lists-css";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      'html[data-grouped-view="on"] main[class*="CollectionMain"] > :not(:first-child):not([data-grouped-host]) { display: none !important; }' +
      '[data-grouped-host] a:hover { text-decoration: underline; }' +
      '[data-grouped-host] .gl-drop { outline: 2px dashed ' + COLOR.link + '; outline-offset: 2px; }' +
      '[data-grouped-host] li[draggable="true"] { cursor: grab; }';
    document.head.appendChild(st);
  }

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "style") Object.assign(e.style, attrs[k]);
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function textLink(text, hash) {
    return h("a", { href: hash, text: text, style: { color: COLOR.link, fontSize: "14px", fontWeight: "500", textDecoration: "none" } });
  }

  function textButton(text, onClick, active) {
    var b = h("button", { type: "button", text: text, style: {
      background: "none", border: "none", padding: "0", margin: "0 4px", cursor: "pointer",
      color: active ? COLOR.link : COLOR.muted, fontSize: "14px", fontWeight: "500",
    } });
    b.addEventListener("click", onClick);
    return b;
  }

  var lastStatus = { text: "", bad: false }; // survives the list re-rendering after a save
  function status(text, bad) {
    lastStatus = { text: text, bad: !!bad };
    var s = host && host.querySelector("[data-gl-status]");
    if (s) { s.textContent = text; s.style.color = bad ? "#d0021b" : COLOR.muted; }
  }

  // targets: [{slug, title}] the row can go to; here: the section it's in.
  function rowEl(item, entryHash, note, here, targets, onMove) {
    var li = h("li", { draggable: "true", style: {
      background: "#fff", borderRadius: "5px", boxShadow: SHADOW, margin: "0 0 10px", listStyle: "none",
      display: "flex", alignItems: "center", gap: "12px", padding: "0 12px 0 0",
    } });
    li.appendChild(h("a", { href: entryHash, style: { flex: "1", padding: "16px 20px", textDecoration: "none", minWidth: "0" } }, [
      h("span", { text: item.title, style: { color: COLOR.text, fontSize: "14px", fontWeight: "500" } }),
      note ? h("span", { text: "  " + note, style: { color: COLOR.muted, fontSize: "13px" } }) : null,
    ]));
    var sel = h("select", { "aria-label": "Move " + item.title, style: { font: "13px system-ui, sans-serif", color: COLOR.muted, border: "1px solid #dfdfe3", borderRadius: "5px", padding: "4px 6px", background: "#fff", maxWidth: "130px" } });
    sel.appendChild(h("option", { value: "", text: "Move…" }));
    var move = h("optgroup", { label: "Move to" });
    var add = h("optgroup", { label: "Also add to" });
    targets.forEach(function (t) {
      if (t.slug === here) return;
      move.appendChild(h("option", { value: "move:" + t.slug, text: t.title }));
      if (item.categories && item.categories.indexOf(t.slug) === -1) add.appendChild(h("option", { value: "add:" + t.slug, text: t.title }));
    });
    sel.appendChild(move);
    if (add.children.length) sel.appendChild(add);
    if (here) sel.appendChild(h("option", { value: "remove:", text: item.categories ? "Remove from this category" : "Take out of this menu" }));
    sel.addEventListener("change", function () {
      var v = sel.value.split(":");
      sel.value = "";
      if (v[0]) onMove(item, here, v[0], v[1]);
    });
    li.appendChild(sel);
    li.addEventListener("dragstart", function (ev) {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ file: item.file, from: here || "" }));
      ev.dataTransfer.effectAllowed = "copyMove";
    });
    return li;
  }

  // A custom link (email, phone, Blog...) kept in the menu itself - not a page,
  // so it isn't draggable; it's edited from the menu's own form.
  function linkRowEl(l, editHash, structural) {
    var inner = [
      h("span", { text: l.label, style: { color: COLOR.text, fontSize: "14px", fontWeight: "500" } }),
      h("span", { text: "  link · " + (l.url || ""), style: { color: COLOR.muted, fontSize: "13px" } }),
    ];
    var li = h("li", { style: { background: "#fff", borderRadius: "5px", boxShadow: SHADOW, margin: "0 0 10px", listStyle: "none" } });
    li.appendChild(structural ? h("a", { href: editHash, style: { display: "block", padding: "16px 20px", textDecoration: "none" } }, inner)
      : h("div", { style: { padding: "16px 20px" } }, inner));
    return li;
  }

  function sectionEl(title, here, buttons, rows, emptyText, onDropItem) {
    var head = h("div", { style: { display: "flex", alignItems: "baseline", gap: "14px", margin: "26px 0 10px" } }, [
      h("h2", { text: title, style: { margin: "0", color: COLOR.text, fontSize: "18px", fontWeight: "600" } }),
    ].concat(buttons));
    var list = rows.length ? h("ul", { style: { margin: "0", padding: "0" } }, rows)
      : h("p", { text: emptyText, style: { margin: "0 0 10px", color: COLOR.muted, fontSize: "14px" } });
    var sec = h("section", { "data-gl-section": here || "" }, [head, list]);
    sec.addEventListener("dragover", function (ev) { ev.preventDefault(); sec.classList.add("gl-drop"); });
    sec.addEventListener("dragleave", function (ev) { if (!sec.contains(ev.relatedTarget)) sec.classList.remove("gl-drop"); });
    sec.addEventListener("drop", function (ev) {
      ev.preventDefault();
      sec.classList.remove("gl-drop");
      var d;
      try { d = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (e) { return; }
      onDropItem(d, here, ev.altKey || ev.ctrlKey);
    });
    return sec;
  }

  function onMoveProperty(p, from, action, to) {
    var next = (p.categories || []).filter(function (s) { return s !== (action === "add" ? "" : from); });
    if (action === "move" || action === "add") { if (next.indexOf(to) === -1) next.push(to); }
    var titles = model && model.titleOf || {};
    var msg = action === "remove" ? "Remove “" + p.title + "” from " + (titles[from] || from)
      : (action === "add" ? "Add “" + p.title + "” to " : "Move “" + p.title + "” to ") + (titles[to] || to);
    save(p.file, function (t) { return setCategories(t, next); }, msg);
  }

  function onMovePage(pg, from, action, to) {
    var dest = action === "remove" ? "" : to;
    var titles = model && model.titleOf || {};
    save(pg.file, function (t) { return setNavMenu(t, dest); }, dest ? "Move “" + pg.title + "” to " + (titles[dest] || dest) : "Take “" + pg.title + "” out of its menu");
  }

  function save(file, edit, message) {
    status("Saving…");
    saving = saving.then(function () { return commitEdit(file, edit, message); }).then(function () {
      status("Saved: " + message + ". The site updates in about a minute.");
      return refresh(true);
    }).catch(function (err) {
      status("Couldn't save (" + err.message + "). Reload and try again.", true);
    });
  }

  function build(kind, data, structural) {
    var isProps = kind === "properties";
    var wrap = h("div", {});
    var bar = h("div", { style: { display: "flex", alignItems: "center", gap: "8px", margin: "0 0 4px", minHeight: "27px", flexWrap: "wrap" } }, [
      h("span", { text: "View:", style: { color: COLOR.muted, fontSize: "14px" } }),
      textButton(isProps ? "By category" : "By menu", function () { plain = false; refresh(); }, true),
      textButton("Plain list", function () { plain = true; applyMode(); }, false),
      h("span", { style: { flex: "1" } }),
      structural ? textLink(isProps ? "+ Add category" : "+ Add menu", isProps ? "#/collections/categories/new" : "#/collections/menus/new") : null,
    ]);
    wrap.appendChild(bar);
    var hint = h("p", { "data-gl-status": "", text: "Drag a row onto another section to move it" + (isProps ? " (hold Alt to keep it in both)" : "") + ", or use the row's Move menu.", style: { margin: "6px 0 0", color: COLOR.muted, fontSize: "13px" } });
    if (lastStatus.text) { hint.textContent = lastStatus.text; hint.style.color = lastStatus.bad ? "#d0021b" : COLOR.muted; }
    wrap.appendChild(hint);

    if (isProps) {
      var g = groupProperties(data.content, data.categories, data.menuOrder);
      var titleOf = {};
      g.categories.forEach(function (c) { titleOf[c.slug] = c.title; });
      model = { titleOf: titleOf };
      var targets = g.categories.map(function (c) { return { slug: c.slug, title: c.title }; });
      var rowFor = function (p, here) {
        var others = p.categories.filter(function (s) { return s !== here; }).map(function (s) { return titleOf[s]; });
        var note = [p.location, others.length ? "also in " + others.join(", ") : ""].filter(Boolean).join(" · ");
        return rowEl(p, "#/collections/properties/entries/" + encodeURIComponent(p.file), note, here, targets, onMoveProperty);
      };
      var byFile = {};
      g.categories.forEach(function (c) { c.properties.forEach(function (p) { byFile[p.file] = p; }); });
      g.uncategorised.forEach(function (p) { byFile[p.file] = p; });
      var drop = function (d, to, keep) {
        var p = byFile[d.file];
        if (!p || (d.from || "") === (to || "")) return;
        if (!to) return onMoveProperty(p, d.from, "remove");
        onMoveProperty(p, d.from, keep || !d.from ? "add" : "move", to);
      };
      g.categories.forEach(function (c) {
        wrap.appendChild(sectionEl(c.title, c.slug, structural ? [textLink("Edit", "#/collections/categories/entries/" + encodeURIComponent(c.file))] : [],
          c.properties.map(function (p) { return rowFor(p, c.slug); }), "No properties in this category yet.", drop));
      });
      if (g.uncategorised.length) {
        wrap.appendChild(sectionEl("No category", "", [], g.uncategorised.map(function (p) { return rowFor(p, ""); }), "", drop));
      }
    } else {
      var gp = groupPages(data.content, data.menus, data.menuOrder);
      var titleOfM = {};
      gp.menus.forEach(function (m) { titleOfM[m.slug] = m.title; });
      model = { titleOf: titleOfM };
      var targetsM = gp.menus.map(function (m) { return { slug: m.slug, title: m.title }; });
      var pageByFile = {};
      var pageRow = function (p, here) {
        pageByFile[p.file] = p;
        return rowEl(p, "#/collections/pages/entries/" + encodeURIComponent(p.file), p.label && p.label !== p.title ? "shown as “" + p.label + "”" : "", here, targetsM, onMovePage);
      };
      var dropP = function (d, to) {
        var pg = pageByFile[d.file];
        if (!pg || (d.from || "") === (to || "")) return;
        onMovePage(pg, d.from, to ? "move" : "remove", to);
      };
      gp.menus.forEach(function (m) {
        var editHash = "#/collections/menus/entries/" + encodeURIComponent(m.file);
        var linkRows = m.links.map(function (l) { return linkRowEl(l, editHash, structural); });
        wrap.appendChild(sectionEl(m.title, m.slug, structural ? [textLink("Edit title & links", editHash)] : [],
          linkRows.concat(m.pages.map(function (p) { return pageRow(p, m.slug); })), "No pages or links in this menu yet.", dropP));
      });
      wrap.appendChild(sectionEl("Not in a menu", "", [], gp.unplaced.map(function (p) { return pageRow(p, ""); }), "Every page is in a menu.", dropP));
    }
    return wrap;
  }

  // ----------------------------------------------------------------- mount

  function applyMode() {
    var on = !!host && !plain;
    if (on) document.documentElement.setAttribute("data-grouped-view", "on");
    else document.documentElement.removeAttribute("data-grouped-view");
    if (host) host.style.display = plain ? "none" : "";
    if (plain) showPlainToggle(); else hidePlainToggle();
  }

  // In plain mode the panel is hidden, so give a way back in the same place.
  var toggle = null;
  function showPlainToggle() {
    var main = document.querySelector('main[class*="CollectionMain"]');
    if (!main || toggle) return;
    toggle = h("div", { "data-grouped-host": "toggle", style: { margin: "0 0 4px" } }, [
      h("span", { text: "View: ", style: { color: COLOR.muted, fontSize: "14px" } }),
      textButton(hostKind === "properties" ? "By category" : "By menu", function () { plain = false; refresh(); }, false),
      textButton("Plain list", function () {}, true),
    ]);
    main.insertBefore(toggle, main.children[1] || null);
  }
  function hidePlainToggle() {
    if (toggle && toggle.parentNode) toggle.parentNode.removeChild(toggle);
    toggle = null;
  }

  function unmount() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    hidePlainToggle();
    host = null;
    hostKind = null;
    document.documentElement.removeAttribute("data-grouped-view");
  }

  function refresh(keepScroll) {
    var m = LIST_ROUTE.exec(location.hash);
    var main = document.querySelector('main[class*="CollectionMain"]');
    if (!m || !main || !token()) { if (host || toggle) unmount(); plain = m ? plain : false; return Promise.resolve(); }
    ensureStyle();
    var kind = m[1];
    if (host && (hostKind !== kind || host.parentNode !== main)) unmount();
    if (!host) {
      host = h("div", { "data-grouped-host": "panel" }, [h("p", { text: "Loading…", style: { color: COLOR.muted, fontSize: "14px" } })]);
      hostKind = kind;
      // Same width as Decap's own cards (the page header above it).
      host.style.maxWidth = main.children[0].getBoundingClientRect().width + "px";
      main.insertBefore(host, main.children[1] || null);
    }
    applyMode();
    if (plain) return Promise.resolve();
    var y = window.scrollY;
    var current = host;
    return loadAll().then(function (data) {
      if (host !== current) return;
      host.textContent = "";
      host.appendChild(build(kind, data, canEditStructure()));
      if (keepScroll) window.scrollTo(0, y);
    }).catch(function (err) {
      if (host !== current) return;
      host.textContent = "";
      host.appendChild(h("p", { text: "Couldn't load the grouped view (" + err.message + ").", style: { color: "#d0021b", fontSize: "14px" } }));
      host.appendChild(textButton("Show plain list", function () { plain = true; applyMode(); }, true));
    });
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      var m = LIST_ROUTE.exec(location.hash);
      var main = document.querySelector('main[class*="CollectionMain"]');
      var mounted = host && host.parentNode === main && hostKind === (m && m[1]);
      if ((m && main && !mounted && !(plain && toggle && toggle.parentNode === main)) || (!m && (host || toggle))) refresh();
    });
  }

  window.addEventListener("hashchange", schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})(typeof window !== "undefined" ? window : this);
