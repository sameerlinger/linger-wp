const contentSlugs = require("../../lib/contentSlugs");
const raw = require("./source/properties.json");

module.exports = () => {
  const slugs = contentSlugs();
  return raw.filter((p) => slugs.has(p.slug));
};
