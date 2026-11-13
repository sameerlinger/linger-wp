module.exports = {
  layout: "post.njk",
  eleventyComputed: {
    // Drafts (the CMS's "Draft" switch) are not built and are left out of
    // every collection. Eleventy 2.x has no built-in draft support.
    eleventyExcludeFromCollections: (data) => (data.draft ? true : data.eleventyExcludeFromCollections),
    permalink: (data) => (data.draft ? false : data.permalink),
  },
};
