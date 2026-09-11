const markdownIt = require("markdown-it");
const fs = require("fs");
const path = require("path");

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

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};
