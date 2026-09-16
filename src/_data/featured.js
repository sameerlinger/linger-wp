const contentSlugs = require("../../lib/contentSlugs");
const dormantSlugs = require("../../lib/dormantSlugs");
const raw = require("./source/featured.json");

module.exports = () => {
  const slugs = contentSlugs();
  const dormant = dormantSlugs();
  return raw.filter((slug) => slugs.has(slug) && !dormant.has(slug));
};
