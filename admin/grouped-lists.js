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
  var BUILTIN_MENU_ORDER = ["reservations", "know-us"];

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

  function groupPages(entries, menus) {
    var list = menus
      .filter(function (m) { return m.data.slug && m.data.title; })
      .map(function (m) {
        return { file: m.file, slug: String(m.data.slug), title: m.data.title, order: num(m.data.order, 999), pages: [] };
      })
      .sort(function (a, b) {
        var ia = BUILTIN_MENU_ORDER.indexOf(a.slug);
        var ib = BUILTIN_MENU_ORDER.indexOf(b.slug);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.order - b.order || byTitle(a, b);
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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseFrontmatter: parseFrontmatter, groupProperties: groupProperties, groupPages: groupPages };
  }
  if (typeof document === "undefined") return;

  // ---------------------------------------------------------------- browser

  var API = "https://linger-wp-oauth.onrender.com/github/repos/sameerlinger/linger-wp";
  var LIST_ROUTE = /^#\/collections\/(properties|pages)\/?(\?.*)?$/;
  var blobCache = {}; // blob sha -> text; a file's sha changes whenever it does
  var panel = null;
  var showing = null;
  var plain = false; // "Plain list" pressed: leave Decap's own list alone

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

  function gh(path, accept) {
    return fetch(API + path, { headers: { Authorization: "token " + token(), Accept: accept || "application/vnd.github+json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("GitHub " + res.status);
        return accept ? res.text() : res.json();
      });
  }

  function loadAll() {
    return gh("/git/trees/main?recursive=1").then(function (tree) {
      var files = tree.tree.filter(function (f) {
        return f.type === "blob" && (/^src\/content\/(categories\/|menus\/)?[^/]+\.md$/.test(f.path) || f.path === "src/_data/menu.json");
      });
      return Promise.all(files.map(function (f) {
        if (blobCache[f.sha] != null) return { path: f.path, text: blobCache[f.sha] };
        return gh("/git/blobs/" + f.sha, "application/vnd.github.raw").then(function (text) {
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

  var MUTED = { color: "#6b6b6b", fontSize: "13px" };
  var BTN = {
    display: "inline-block", padding: "4px 10px", border: "1px solid #bbb", borderRadius: "4px",
    background: "#fff", color: "#222", textDecoration: "none", font: "13px sans-serif", cursor: "pointer",
  };
  var PRIMARY = Object.assign({}, BTN, { background: "#2e6a4f", borderColor: "#2e6a4f", color: "#fff" });

  function link(text, hash, style) {
    return h("a", { href: hash, text: text, style: style || BTN });
  }

  function section(title, editHash, addHash, rows, structural, addLabel, emptyText) {
    var head = h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", margin: "28px 0 8px", borderBottom: "1px solid #ddd", paddingBottom: "6px" } }, [
      h("h2", { text: title, style: { margin: "0 8px 0 0", font: "600 18px sans-serif" } }),
      editHash && structural ? link("Edit", editHash) : null,
      addHash ? link(addLabel, addHash) : null,
    ]);
    var body = rows.length ? h("ul", { style: { listStyle: "none", margin: 0, padding: 0 } }, rows)
      : h("p", { text: emptyText, style: Object.assign({ margin: "8px 0" }, MUTED) });
    return h("section", {}, [head, body]);
  }

  function row(title, hash, note) {
    return h("li", { style: { padding: "6px 0", borderBottom: "1px solid #f0f0f0" } }, [
      h("a", { href: hash, text: title, style: { color: "#1a4d8f", textDecoration: "none", font: "15px sans-serif" } }),
      note ? h("span", { text: "  " + note, style: MUTED }) : null,
    ]);
  }

  function renderProperties(data, structural) {
    var g = groupProperties(data.content, data.categories, data.menuOrder);
    var parts = g.categories.map(function (c) {
      var rows = c.properties.map(function (p) {
        var others = p.categories.filter(function (s) { return s !== c.slug; }).map(function (s) { return g.titles[s].title; });
        var note = [p.location, others.length ? "also in " + others.join(", ") : ""].filter(Boolean).join(" · ");
        return row(p.title, "#/collections/properties/entries/" + encodeURIComponent(p.file), note);
      });
      return section(c.title, "#/collections/categories/entries/" + encodeURIComponent(c.file), "#/collections/properties/new", rows, structural, "+ Add property", "No properties in this category yet.");
    });
    if (g.uncategorised.length) {
      parts.push(section("No category", null, null, g.uncategorised.map(function (p) {
        return row(p.title, "#/collections/properties/entries/" + encodeURIComponent(p.file), p.location);
      }), structural, "", ""));
    }
    return parts;
  }

  function renderPages(data, structural) {
    var g = groupPages(data.content, data.menus);
    var pageRow = function (p) {
      return row(p.title, "#/collections/pages/entries/" + encodeURIComponent(p.file), p.label && p.label !== p.title ? "shown as “" + p.label + "”" : "");
    };
    var parts = g.menus.map(function (m) {
      return section(m.title, "#/collections/menus/entries/" + encodeURIComponent(m.file), "#/collections/pages/new", m.pages.map(pageRow), structural, "+ Add page", "No pages in this menu yet.");
    });
    parts.push(section("Not in a menu", null, "#/collections/pages/new", g.unplaced.map(pageRow), structural, "+ Add page", "Every page is in a menu."));
    return parts;
  }

  function close() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    showing = null;
  }

  function open(kind) {
    close();
    showing = kind;
    var structural = canEditStructure();
    var isProps = kind === "properties";
    var content = h("div", { style: { maxWidth: "820px", margin: "0 auto", padding: "20px 16px 80px" } }, [
      h("p", { text: "Loading…", style: MUTED }),
    ]);
    var plainBtn = h("button", { text: "Plain list", style: BTN });
    plainBtn.addEventListener("click", function () { plain = true; close(); });
    panel = h("div", { style: { position: "fixed", inset: "0", zIndex: "9990", background: "#fafafa", overflowY: "auto", font: "14px sans-serif" } }, [
      h("div", { style: { background: "#fff", borderBottom: "1px solid #ddd", padding: "10px 16px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", position: "sticky", top: "0" } }, [
        h("strong", { text: "Linger CMS", style: { marginRight: "12px" } }),
        link("Properties", "#/collections/properties", isProps ? PRIMARY : BTN),
        link("Pages", "#/collections/pages", isProps ? BTN : PRIMARY),
        structural ? link(isProps ? "+ Add category" : "+ Add menu", isProps ? "#/collections/categories/new" : "#/collections/menus/new", BTN) : null,
        link(isProps ? "+ Add property" : "+ Add page", "#/collections/" + kind + "/new", BTN),
        h("span", { style: { flex: "1" } }),
        link("Blog & more", "#/collections/posts", BTN),
        plainBtn,
      ]),
      content,
    ]);
    document.body.appendChild(panel);
    loadAll().then(function (data) {
      if (showing !== kind) return; // navigated away meanwhile
      content.textContent = "";
      (isProps ? renderProperties(data, structural) : renderPages(data, structural)).forEach(function (s) { content.appendChild(s); });
    }).catch(function (err) {
      content.textContent = "";
      content.appendChild(h("p", { text: "Couldn't load the grouped view (" + err.message + "). Use “Plain list”.", style: { color: "#a33" } }));
    });
  }

  function refresh() {
    var m = LIST_ROUTE.exec(location.hash);
    if (!m) { plain = false; close(); return; }
    if (plain || !token()) return;
    if (showing !== m[1]) open(m[1]);
  }

  window.addEventListener("hashchange", refresh);
  // Decap rewrites the hash after sign-in, so also look shortly after load.
  setTimeout(refresh, 1500);
  setTimeout(refresh, 4000);
  refresh();
})(typeof window !== "undefined" ? window : this);
