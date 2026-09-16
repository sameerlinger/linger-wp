const contentSlugs = require("../../lib/contentSlugs");
const dormantSlugs = require("../../lib/dormantSlugs");
const raw = require("./source/mainpages.json");

module.exports = async () => {
  const slugs = contentSlugs();
  const dormant = await dormantSlugs();
  // "blog" is a real nav destination but isn't backed by a src/content/*.md
  // file (it's generated from src/blog/index.njk), so it's always kept.
  return raw.filter((p) => p.slug === "blog" || (slugs.has(p.slug) && !dormant.has(p.slug)));
};
