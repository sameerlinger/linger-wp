// Builds the <title>, meta description, Open Graph / Twitter tags and
// JSON-LD for a page. Called from base.njk as {% seo %} (a shortcode, so it
// can read the page's data via this.ctx).
const SITE = "https://linger.in";
const SITE_NAME = "Linger";
const DEFAULT_TITLE = "Linger · Homestays, farm stays & vacations in Coorg, near Bangalore and the Himalayas";
const DEFAULT_DESC =
  "Delightfully local weekends. Authentic, low-density, quiet, pet-friendly homestays and farm-stays across Coorg, near Bangalore, Bandipur and the Himalayas.";
const AUTO = "__AUTO_DESC__";
const PHONE = "+91-959-005-0001";
const EMAIL = "stay@linger.in";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s, n) => {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s;
};
const abs = (u) => (!u ? null : /^https?:/.test(u) ? u : SITE + u);

// Some "location" values are notes ("Vijaypur, 190 km from Kathgodam.")
// rather than a place name - don't put those in a title.
const cleanLocation = (loc) => {
  if (!loc) return "";
  loc = String(loc).trim().replace(/\.$/, "");
  return /\bkm\b|\bhrs?\b|^from\b/i.test(loc) || loc.length > 45 ? "" : loc;
};

module.exports = function seo(coverImage, isProperty, homeImage) {
  const ctx = this.ctx || {};
  const page = this.page || ctx.page || {};
  const url = page.url || "/";
  const slug = page.fileSlug;
  const isHome = url === "/";
  const isPost = /\/content\/blog\/[^/]+\.md$/.test(page.inputPath || "");
  const isProp = !isHome && isProperty(slug, ctx.properties);
  const loc = cleanLocation(ctx.location);

  let title;
  if (ctx.seo_title) title = ctx.seo_title;
  else if (isHome) title = DEFAULT_TITLE;
  else if (isProp) title = `${ctx.title} – Homestay${loc ? " in " + loc : ""} · ${SITE_NAME}`;
  else title = `${ctx.title} · ${SITE_NAME}`;

  // AUTO is filled from the page text by a transform in .eleventy.js
  let desc;
  if (ctx.seo_description) desc = ctx.seo_description;
  else if (isHome) desc = DEFAULT_DESC;
  else if (isProp && ctx.summary) desc = `${ctx.summary.replace(/[.!\s]+$/, "")}. ${ctx.title}${loc ? ", " + loc : ""}: a Linger homestay. Enquire for dates.`;
  else if (ctx.summary) desc = ctx.summary;
  else desc = AUTO;
  if (desc !== AUTO) desc = clip(desc, 200);

  const image = abs(ctx.cover || (slug ? coverImage(slug) : null) || (isHome ? homeImage : null) || "/images/site/logo.png");
  const canonical = SITE + url;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${isPost ? "article" : "website"}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ];

  const graph = [];
  const orgRef = { "@id": SITE + "/#org" };
  if (isHome) {
    graph.push(
      { "@type": "Organization", "@id": SITE + "/#org", name: SITE_NAME, url: SITE + "/", logo: SITE + "/images/site/logo.png", email: EMAIL, telephone: PHONE },
      { "@type": "WebSite", "@id": SITE + "/#website", url: SITE + "/", name: SITE_NAME, publisher: orgRef }
    );
  }
  if (isProp) {
    const lodging = {
      "@type": "LodgingBusiness",
      "@id": canonical + "#stay",
      name: ctx.title,
      url: canonical,
      image,
      email: EMAIL,
      telephone: PHONE,
      parentOrganization: orgRef,
      petsAllowed: true,
    };
    if (desc !== AUTO) lodging.description = desc;
    if (loc) lodging.address = { "@type": "PostalAddress", addressLocality: loc, addressCountry: "IN" };
    graph.push(lodging);
  }
  if (isPost) {
    const d = ctx.date ? new Date(ctx.date) : null;
    const ok = d && !isNaN(d);
    graph.push({
      "@type": "BlogPosting",
      headline: clip(ctx.title, 110),
      url: canonical,
      image,
      ...(ok ? { datePublished: d.toISOString() } : {}),
      author: { "@type": "Organization", name: SITE_NAME },
      publisher: orgRef,
    });
    if (ok) tags.push(`<meta property="article:published_time" content="${d.toISOString()}">`);
  }
  if (!isHome) {
    const crumbs = [{ name: "Home", url: SITE + "/" }];
    if (isPost) crumbs.push({ name: "Blog", url: SITE + "/blog/" });
    crumbs.push({ name: ctx.title, url: canonical });
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
    });
  }
  if (graph.length) {
    const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }
  return tags.join("\n");
};
module.exports.AUTO = AUTO;
module.exports.DEFAULT_DESC = DEFAULT_DESC;
