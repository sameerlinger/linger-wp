const contentSlugs = require("../../lib/contentSlugs");
const raw = require("./source/regions.json");

module.exports = () => {
  const slugs = contentSlugs();
  return raw.map((region) => ({
    ...region,
    properties: region.properties.filter((slug) => slugs.has(slug)),
  }));
};
