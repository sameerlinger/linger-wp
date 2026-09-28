// "Event date" block for page bodies: a small date line, meant to go right
// after an event's bold title. Saved into the markdown as one line of HTML
// (the text is the readable date, data-date the sortable one):
//
//   <p class="event-date" data-date="2026-10-10">10 Oct 2026</p>
//
// The site build (sortDatedEvents in .eleventy.js) puts dated events newest
// first and uses the date in the "Want to know more?" form.
(function (root) {
  // Decap anchors this at the start of a block itself; no "m" flag allowed.
  var BLOCK_PATTERN = /^<p class="event-date" data-date="(\d{4}-\d{2}-\d{2})">[^<\n]*<\/p>/;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function formatDate(iso) {
    var parts = iso.split("-").map(Number);
    return parts[2] + " " + MONTHS[parts[1] - 1] + " " + parts[0];
  }

  function parseBlock(match) {
    return { date: match[1] };
  }

  function serializeBlock(data) {
    var date = String(data.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    return '<p class="event-date" data-date="' + date + '">' + formatDate(date) + "</p>";
  }

  var api = { BLOCK_PATTERN: BLOCK_PATTERN, parseBlock: parseBlock, serializeBlock: serializeBlock, formatDate: formatDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.CMS) return;

  var h = root.h;

  CMS.registerEditorComponent({
    id: "event-date",
    label: "Event date",
    fields: [
      {
        label: "Event date", name: "date", widget: "datetime",
        format: "YYYY-MM-DD", date_format: "D MMM YYYY", time_format: false, picker_utc: true,
        hint: "Put this right after the event's title. Dated events are shown newest first, and in the \"Want to know more?\" form.",
      },
    ],
    pattern: BLOCK_PATTERN,
    fromBlock: parseBlock,
    toBlock: serializeBlock,
    toPreview: function (data) {
      var date = String(data.date || "");
      return h("p", { style: { fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#3a6b4a" } },
        /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDate(date) : "");
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
