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
      const liP = { tagName: "p", children: li.children };
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
    .map((i) => `<img src="${i.src}" alt="${i.alt}" loading="lazy">`)
    .join("");
  return `<div class="carousel"><div class="carousel-track">${imgTags}</div><button type="button" class="carousel-btn carousel-prev" aria-label="Previous photo">&#8249;</button><button type="button" class="carousel-btn carousel-next" aria-label="Next photo">&#8250;</button></div>`;
}

function singleImageHtml(image) {
  return `<div class="content-image"><img src="${image.src}" alt="${image.alt}" loading="lazy"></div>`;
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

module.exports = function (eleventyConfig) {
  eleventyConfig.setLibrary("md", markdownIt({ html: true, breaks: false, linkify: true }));

  eleventyConfig.addPassthroughCopy({ "src/images": "images" });
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "admin": "admin" });

  eleventyConfig.addCollection("blogposts", (api) =>
    api.getFilteredByGlob("src/content/blog/*.md").sort((a, b) => b.date - a.date)
  );

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
    const found = (properties || []).find((p) => p.slug === slug);
    return found ? found.title : slug;
  });

  eleventyConfig.addFilter("isProperty", (slug, properties) =>
    (properties || []).some((p) => p.slug === slug)
  );

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

  const imageCache = new Map();
  eleventyConfig.addFilter("coverImage", (slug) => {
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

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};
