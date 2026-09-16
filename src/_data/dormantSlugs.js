const dormantSlugs = require("../../lib/dormantSlugs");

// Exposes Folio's dormant-property list as a template-accessible array
// (Nunjucks doesn't do Set membership checks) - see lib/dormantSlugs.js for
// where this actually comes from.
module.exports = async () => [...(await dormantSlugs())];
