const contentSlugs = require("../../lib/contentSlugs");
const raw = require("./source/featured.json");

module.exports = () => {
  const slugs = contentSlugs();
  return raw.filter((slug) => slugs.has(slug));
};
