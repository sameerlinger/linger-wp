// "Photo + text" block for page and blog bodies: one photo on the left or
// right with its own text alongside (stacked on phones - see .photo-text in
// style.css). Saved into the markdown as plain HTML that markdown-it renders
// as-is, with the text in between left as markdown:
//
//   <div class="photo-text photo-left"><img src="..." alt="..."><div class="photo-text-body">
//
//   Some **markdown** text
//
//   </div></div>
//
// The markdown parsing half has no browser dependencies so it can be
// checked from Node (module.exports at the bottom).
(function (root) {
  // Decap anchors this at the start of a block itself; no "m" flag allowed.
  var BLOCK_PATTERN = /^<div class="photo-text photo-(left|right)"><img src="([^"]*)" alt="([^"]*)"><div class="photo-text-body">\n\n([\s\S]*?)\n*<\/div><\/div>/;

  function attr(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/\n/g, " ");
  }

  function unattr(s) {
    return s.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }

  function parseBlock(match) {
    return { side: match[1], photo: unattr(match[2]), alt: unattr(match[3]), text: match[4].replace(/\s+$/, "") };
  }

  function serializeBlock(data) {
    var side = data.side === "right" ? "right" : "left";
    var text = String(data.text || "").trim();
    return '<div class="photo-text photo-' + side + '"><img src="' + attr(data.photo) + '" alt="' + attr(data.alt) + '"><div class="photo-text-body">\n\n' +
      (text ? text + "\n\n" : "") + "</div></div>";
  }

  var api = { BLOCK_PATTERN: BLOCK_PATTERN, parseBlock: parseBlock, serializeBlock: serializeBlock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.CMS) return;

  var h = root.h;

  CMS.registerEditorComponent({
    id: "photo-text",
    label: "Photo + text",
    fields: [
      { label: "Photo", name: "photo", widget: "image", choose_url: false },
      { label: "Photo description (for screen readers)", name: "alt", widget: "string", required: false },
      {
        label: "Photo side", name: "side", widget: "select", default: "left",
        options: [{ label: "Left", value: "left" }, { label: "Right", value: "right" }],
      },
      { label: "Text beside the photo", name: "text", widget: "markdown", buttons: ["bold", "italic", "link", "heading-three", "bulleted-list", "numbered-list"], editor_components: [] },
    ],
    pattern: BLOCK_PATTERN,
    fromBlock: parseBlock,
    toBlock: serializeBlock,
    toPreview: function (data, getAsset) {
      var side = data.side === "right" ? "right" : "left";
      var img = data.photo ? h("img", { src: String(getAsset(data.photo) || data.photo), alt: data.alt || "", style: { width: "40%", borderRadius: "8px" } }) : null;
      var text = h("div", { style: { flex: 1, whiteSpace: "pre-wrap" } }, data.text || "");
      return h("div", { style: { display: "flex", gap: "1rem", alignItems: "flex-start", flexDirection: side === "right" ? "row-reverse" : "row" } }, img, text);
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
