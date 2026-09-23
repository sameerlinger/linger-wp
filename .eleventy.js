const markdownIt = require("markdown-it");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Detect a <p> or list whose only real content is one or more images
// (optionally link-wrapped), i.e. an inline "gallery" left over from the
// WordPress migration. Returns an ordered list of {src, alt}, or null.
function imagesInBlock($, el) {
  const tag = el.tagName;
  if (tag === "p") {
    const images = [];
    for (const child of el.children) {
      if (child.type === "text") {
        if (child.data.trim() !== "") return null;
        continue;
      }
      if (child.type !== "tag") return null;
      if (child.tagName === "img") {
        images.push(child);
      } else if (child.tagName === "a" && child.children.length === 1 && child.children[0].tagName === "img") {
        images.push(child.children[0]);
      } else {
        return null;
      }
    }
    if (!images.length) return null;
    return images.map((img) => ({ src: img.attribs.src, alt: img.attribs.alt || "" }));
  }
  if (tag === "ul" || tag === "ol") {
    const items = $(el).children("li").toArray();
    if (!items.length) return null;
    let all = [];
    for (const li of items) {
      // A "loose" list (blank lines between items) wraps each <li>'s
      // content in its own <p> - unwrap that before checking.
      let liChildren = li.children;
      const elementChildren = liChildren.filter((c) => c.type === "tag");
      if (elementChildren.length === 1 && elementChildren[0].tagName === "p") {
        liChildren = elementChildren[0].children;
      }
      const liP = { tagName: "p", children: liChildren };
      const imgs = imagesInBlock($, liP);
      if (!imgs) return null;
      all = all.concat(imgs);
    }
    return all;
  }
  return null;
}

function carouselHtml(images) {
  const imgTags = images
    .map((i) => `<a href="${i.src}" class="lightbox-trigger"><img src="${i.src}" alt="${i.alt}" loading="lazy"></a>`)
    .join("");
  return `<div class="carousel"><div class="carousel-track">${imgTags}</div><button type="button" class="carousel-btn carousel-prev" aria-label="Previous photo">&#8249;</button><button type="button" class="carousel-btn carousel-next" aria-label="Next photo">&#8250;</button></div>`;
}

function singleImageHtml(image) {
  return `<div class="content-image"><a href="${image.src}" class="lightbox-trigger"><img src="${image.src}" alt="${image.alt}" loading="lazy"></a></div>`;
}

function groupInlineGalleries(content) {
  const $ = cheerio.load(content, null, false);
  $(".prose, .post-body").each((_, container) => {
    const children = $(container).children().toArray();
    let i = 0;
    while (i < children.length) {
      const imgs = imagesInBlock($, children[i]);
      if (!imgs) {
        i++;
        continue;
      }
      const run = [children[i]];
      let runImages = imgs.slice();
      let j = i + 1;
      while (j < children.length) {
        const nextImgs = imagesInBlock($, children[j]);
        if (!nextImgs) break;
        run.push(children[j]);
        runImages = runImages.concat(nextImgs);
        j++;
      }
      const replacement = runImages.length > 1 ? carouselHtml(runImages) : singleImageHtml(runImages[0]);
      $(run[0]).replaceWith(replacement);
      for (let k = 1; k < run.length; k++) $(run[k]).remove();
      i = j;
    }
  });
  return $.html();
}

const properties = require("./src/_data/source/properties.json");
const propertySlugs = new Set(properties.map((p) => p.slug));
const contentSlugs = require("./lib/contentSlugs");
const dormantSlugs = require("./lib/dormantSlugs");

function slugifyHeading(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// On a property page: hoist the "...Pictures" gallery up to right below
// the intro (dropping its heading), then add a short jump-nav linking to
// whatever sections remain, placed right after that gallery.
function restructurePropertyPage(content) {
  const $ = cheerio.load(content, null, false);
  const prose = $(".prose").first();
  if (!prose.length) return content;

  let children = prose.children().toArray();
  const firstHeadingIdx = children.findIndex((el) => el.tagName === "h2");
  if (firstHeadingIdx === -1) return content;

  let picturesIdx = -1;
  for (let i = firstHeadingIdx; i < children.length; i++) {
    if (children[i].tagName === "h2" && /pictures/i.test($(children[i]).text())) {
      picturesIdx = i;
      break;
    }
  }

  let movedHtml = "";
  if (picturesIdx !== -1) {
    let end = children.length;
    for (let j = picturesIdx + 1; j < children.length; j++) {
      if (children[j].tagName === "h2") {
        end = j;
        break;
      }
    }
    const block = children.slice(picturesIdx, end);
    const contentNodes = block.filter((n) => n.tagName !== "h2" && n.tagName !== "hr");
    movedHtml = contentNodes.map((n) => $.html(n)).join("");
    block.forEach((n) => $(n).remove());
    children = prose.children().toArray();
  }

  const h1Text = prose.find("h1").first().text().trim();
  const h1Prefix = h1Text.split(/\s+/).slice(0, 2).join(" ").toLowerCase();

  const navLinks = [];
  children.forEach((el) => {
    if (el.tagName === "h2") {
      const text = $(el).text().trim();
      const id = slugifyHeading(text);
      $(el).attr("id", id);
      // Several pages repeat (the start of) the page title as their
      // first heading, with intro content parked under it - not worth
      // its own nav entry since it's basically the title again.
      const looksLikeTitleRepeat = h1Prefix && text.toLowerCase().startsWith(h1Prefix);
      if (!looksLikeTitleRepeat) navLinks.push({ id, text });
    }
  });
  const navHtml =
    navLinks.length > 1
      ? `<nav class="page-nav">${navLinks.map((l) => `<a href="#${l.id}">${l.text}</a>`).join("")}</nav>`
      : "";

  const insertion = movedHtml + navHtml;
  if (insertion) {
    const newFirstHeadingIdx = children.findIndex((el) => el.tagName === "h2");
    if (newFirstHeadingIdx === -1) prose.append(insertion);
    else $(children[newFirstHeadingIdx]).before(insertion);
  }

  return $.html();
}

module.exports = function (eleventyConfig) {
  eleventyConfig.setLibrary("md", markdownIt({ html: true, breaks: false, linkify: true }));

  eleventyConfig.addPassthroughCopy({ "src/images": "images" });
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "admin": "admin" });

  eleventyConfig.addCollection("blogposts", (api) =>
    api.getFilteredByGlob("src/content/blog/*.md").sort((a, b) => b.date - a.date)
  );

  // Categories ("regions" on the homepage) live as their own small CMS
  // collection (src/content/categories/*.md, excluded from page output by
  // categories.11tydata.js) so they're addable/editable/deletable, and a
  // property opts into one or more of them via its own "categories"
  // frontmatter list (a relation-widget field in admin/config.yml) rather
  // than a category owning a fixed property list - so one property can
  // belong to several sections at once.
  eleventyConfig.addCollection("regions", async (api) => {
    const dormant = await dormantSlugs();
    const categoryDocs = api
      .getFilteredByGlob("src/content/categories/*.md")
      .filter((item) => item.data.slug && item.data.title)
      .sort((a, b) => {
        const orderA = typeof a.data.order === "number" ? a.data.order : 999;
        const orderB = typeof b.data.order === "number" ? b.data.order : 999;
        return orderA - orderB || a.data.title.localeCompare(b.data.title);
      });
    const propertyDocs = api
      .getFilteredByGlob("src/content/*.md")
      .filter((item) => propertySlugs.has(item.fileSlug) && !dormant.has(item.fileSlug));
    return categoryDocs
      .map((cat) => ({
        name: cat.data.title,
        slug: cat.data.slug,
        // Only pass through a plain hex colour - it ends up in an inline style.
        color: /^#[0-9a-fA-F]{3,8}$/.test(cat.data.color || "") ? cat.data.color : null,
        properties: propertyDocs
          .filter((p) => Array.isArray(p.data.categories) && p.data.categories.includes(cat.data.slug))
          .map((p) => p.fileSlug),
      }))
      // A freshly-created category with no properties assigned to it yet
      // would otherwise show up as an empty heading with nothing under it.
      .filter((region) => region.properties.length > 0);
  });

  eleventyConfig.addCollection("blogCategories", (api) => {
    const posts = api.getFilteredByGlob("src/content/blog/*.md").sort((a, b) => b.date - a.date);
    const bySlug = new Map();
    for (const post of posts) {
      for (const name of post.data.categories || []) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        if (!bySlug.has(slug)) bySlug.set(slug, { slug, name, posts: [] });
        bySlug.get(slug).posts.push(post);
      }
    }
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  eleventyConfig.addFilter("plus1", (n) => n + 1);

  eleventyConfig.addFilter("propertyTitle", (slug, properties) => {
    if (pageTitleBySlug.has(slug)) return pageTitleBySlug.get(slug);
    const found = (properties || []).find((p) => p.slug === slug);
    return found ? found.title : slug;
  });

  eleventyConfig.addFilter("isProperty", (slug, properties) =>
    (properties || []).some((p) => p.slug === slug)
  );

  // Guards a hardcoded nav/footer link to a src/content/*.md page (as
  // opposed to one built from regions/featured/mainpages data, which is
  // already filtered - see those _data/*.js files) so deleting that page via
  // the CMS can't leave a dead link. "blog" is a real destination with no
  // matching content file (it's generated from src/blog/index.njk).
  eleventyConfig.addFilter("pageExists", (slug) => slug === "blog" || contentSlugs().has(slug));

  eleventyConfig.addFilter("dateDisplay", (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  });

  eleventyConfig.addFilter("categorySlug", (name) =>
    String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  );

  eleventyConfig.addFilter("excerpt", (content, length = 160) => {
    const text = String(content)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > length ? text.slice(0, length).trim() + "…" : text;
  });

  // Populated by the "pageFrontmatter" collection below, before any
  // template renders - lets coverImage() prefer a cover set via the CMS
  // over the folder-scan fallback.
  const pageCoverBySlug = new Map();
  const pageSummaryBySlug = new Map();
  const pageTitleBySlug = new Map();
  const pageLocationBySlug = new Map();
  eleventyConfig.addCollection("pageFrontmatter", (api) => {
    const items = api.getFilteredByGlob("src/content/*.md");
    for (const item of items) {
      if (item.data.cover) pageCoverBySlug.set(item.fileSlug, item.data.cover);
      if (item.data.summary) pageSummaryBySlug.set(item.fileSlug, item.data.summary);
      if (item.data.title) pageTitleBySlug.set(item.fileSlug, item.data.title);
      if (item.data.location) pageLocationBySlug.set(item.fileSlug, item.data.location);
    }
    return items;
  });

  eleventyConfig.addFilter("pageSummary", (slug) => pageSummaryBySlug.get(slug) || null);
  eleventyConfig.addFilter("pageLocation", (slug) => pageLocationBySlug.get(slug) || null);

  const imageCache = new Map();
  eleventyConfig.addFilter("coverImage", (slug) => {
    if (pageCoverBySlug.has(slug)) return pageCoverBySlug.get(slug);
    if (imageCache.has(slug)) return imageCache.get(slug);
    const dir = path.join(__dirname, "src", "images", slug);
    let result = null;
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
        .sort();
      if (files.length) result = `/images/${slug}/${files[0]}`;
    } catch (e) {
      result = null;
    }
    imageCache.set(slug, result);
    return result;
  });

  eleventyConfig.addFilter("galleryImages", (slug, limit = 12) => {
    const dir = path.join(__dirname, "src", "images", slug);
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
        .sort()
        .slice(0, limit)
        .map((f) => `/images/${slug}/${f}`);
    } catch (e) {
      return [];
    }
  });

  eleventyConfig.addTransform("inlineGalleries", function (content) {
    if (!this.page || !this.page.outputPath || !this.page.outputPath.endsWith(".html")) return content;
    if (!content.includes('class="prose"') && !content.includes('class="post-body"')) return content;
    return groupInlineGalleries(content);
  });

  eleventyConfig.addTransform("propertyPageLayout", function (content) {
    if (!this.page || !this.page.outputPath || !this.page.outputPath.endsWith(".html")) return content;
    if (!this.page.fileSlug || !propertySlugs.has(this.page.fileSlug)) return content;
    return restructurePropertyPage(content);
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};
