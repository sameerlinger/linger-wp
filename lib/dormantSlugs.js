const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

// Slugs of src/content/*.md pages marked dormant (frontmatter "dormant: true"
// via the CMS) - used to drop them from nav/featured lists built off the
// static source JSON files, mirroring what the "regions" Eleventy collection
// does directly off each page's own frontmatter.
module.exports = function dormantSlugs() {
  const dir = path.join(__dirname, "..", "src", "content");
  const slugs = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const { data } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
    if (data.dormant) slugs.add(f.replace(/\.md$/, ""));
  }
  return slugs;
};
