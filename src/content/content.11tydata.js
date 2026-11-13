module.exports = {
  layout: "page.njk",
  // From the file name, not the "slug" frontmatter: the CMS names a new
  // page's file from its title and never renames it, so the address can't
  // be broken by typing something else into a field.
  permalink: "/{{ page.fileSlug }}/index.html",
  eleventyComputed: {
    // Drafts (the CMS's "Draft" switch) are not built and are left out of
    // every collection, so no page, menu, sitemap or search lists them.
    // Eleventy 2.x has no built-in draft support.
    eleventyExcludeFromCollections: (data) => (data.draft ? true : data.eleventyExcludeFromCollections),
    permalink: (data) => (data.draft ? false : data.permalink),
  },
};
