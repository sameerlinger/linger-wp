const fs = require("fs");
const path = require("path");

// Slugs of pages that currently exist in src/content (top-level only, not
// blog posts) - used to drop dangling references from nav/grid data after a
// page is deleted via the CMS, so deleting a page can't leave a dead link.
module.exports = function contentSlugs() {
  const dir = path.join(__dirname, "..", "src", "content");
  return new Set(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
};
