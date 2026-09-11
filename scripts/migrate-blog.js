// One-off migration: pull all posts from the live linger.in WordPress REST API,
// convert to markdown, localize images, and write src/content/blog/<slug>.md.
// Run with: node scripts/migrate-blog.js
const fs = require("fs");
const path = require("path");
const TurndownService = require("turndown");
const he = require("he");

const SITE = "https://linger.in";
const OUT_CONTENT = path.join(__dirname, "..", "src", "content", "blog");
const OUT_IMAGES = path.join(__dirname, "..", "src", "images", "blog");

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
// Drop WP gallery/figure wrapper noise, keep the <img> itself.
turndown.addRule("figure", {
  filter: "figure",
  replacement: (content) => `\n${content}\n`,
});
turndown.addRule("stripFigcaption", {
  filter: "figcaption",
  replacement: () => "",
});

async function getAll(endpoint) {
  const perPage = 100;
  let page = 1;
  let results = [];
  while (true) {
    const res = await fetch(`${SITE}/wp-json/wp/v2/${endpoint}?per_page=${perPage}&page=${page}`);
    if (!res.ok) break;
    const batch = await res.json();
    results = results.concat(batch);
    const totalPages = parseInt(res.headers.get("x-wp-totalpages") || "1", 10);
    if (page >= totalPages) break;
    page++;
  }
  return results;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function downloadImage(url, destDir) {
  try {
    const clean = url.split("?")[0];
    const filename = decodeURIComponent(path.basename(clean));
    const dest = path.join(destDir, filename);
    if (fs.existsSync(dest)) return filename;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, buf);
    return filename;
  } catch (e) {
    console.error("  image failed:", url, e.message);
    return null;
  }
}

async function main() {
  console.log("Fetching categories...");
  const categories = await getAll("categories");
  const catById = new Map(categories.map((c) => [c.id, c]));

  console.log("Fetching posts...");
  const posts = await getAll("posts");
  console.log(`Got ${posts.length} posts.`);

  fs.mkdirSync(OUT_CONTENT, { recursive: true });

  const summary = [];

  for (const post of posts) {
    const slug = post.slug;
    const title = he.decode(post.title.rendered.replace(/<[^>]+>/g, ""));
    const date = post.date; // local ISO, no TZ suffix
    const catNames = (post.categories || [])
      .map((id) => catById.get(id))
      .filter((c) => c && c.slug !== "uncategorized")
      .map((c) => c.name);

    const imgDir = path.join(OUT_IMAGES, slug);
    let html = post.content.rendered;

    // Find every wp-content image src (skip tiny inline data URIs).
    const imgUrls = new Set();
    const imgTagRe = /<img[^>]+src="([^"]+)"[^>]*>/g;
    let m;
    while ((m = imgTagRe.exec(html))) {
      if (m[1].startsWith("http")) imgUrls.add(m[1]);
    }

    const urlToLocal = new Map();
    for (const url of imgUrls) {
      const filename = await downloadImage(url, imgDir);
      if (filename) urlToLocal.set(url, `/images/blog/${slug}/${filename}`);
    }

    // Rewrite src (and strip srcset/sizes/loading attrs which turndown ignores anyway).
    html = html.replace(/<img([^>]+)>/g, (full, attrs) => {
      const srcMatch = attrs.match(/src="([^"]+)"/);
      const altMatch = attrs.match(/alt="([^"]*)"/);
      if (!srcMatch) return "";
      const local = urlToLocal.get(srcMatch[1]);
      if (!local) return ""; // drop images we couldn't fetch
      const alt = altMatch ? altMatch[1] : "";
      return `<img src="${local}" alt="${alt}">`;
    });
    // Strip srcset attrs on <source>/other stray tags turndown might see.
    html = html.replace(/\ssrcset="[^"]*"/g, "").replace(/\ssizes="[^"]*"/g, "");

    let markdown = turndown.turndown(html).trim();
    markdown = markdown.replace(/\n{3,}/g, "\n\n");

    const frontmatter = [
      "---",
      `title: ${JSON.stringify(title)}`,
      `slug: ${JSON.stringify(slug)}`,
      `date: ${JSON.stringify(date)}`,
      `categories: ${JSON.stringify(catNames)}`,
      "---",
      "",
    ].join("\n");

    fs.writeFileSync(path.join(OUT_CONTENT, `${slug}.md`), frontmatter + markdown + "\n");
    summary.push({ slug, title, images: urlToLocal.size });
    console.log(`✓ ${slug} (${urlToLocal.size} images)`);
  }

  fs.writeFileSync(
    path.join(__dirname, "migrate-blog-summary.json"),
    JSON.stringify({ categories: categories.map((c) => ({ slug: c.slug, name: c.name, count: c.count })), posts: summary }, null, 2)
  );
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
