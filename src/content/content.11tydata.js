module.exports = {
  layout: "page.njk",
  // From the file name, not the "slug" frontmatter: the CMS names a new
  // page's file from its title and never renames it, so the address can't
  // be broken by typing something else into a field.
  permalink: "/{{ page.fileSlug }}/index.html",
};
