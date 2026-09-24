// Photo sets in the CMS as a grid of previews, each with its own move /
// replace / remove buttons, plus an "Add photos" tile.
//
// Used in two places:
// - Homepage Hero Photos: the "photogrid" widget on a plain list of paths
//   (admin/config.yml).
// - Page and blog bodies: replaces Decap's built-in "image" block, so any
//   run of plain images (one per line, blank lines or "* " bullets allowed)
//   opens as one grid. Written back one image per line, which the site
//   build (groupInlineGalleries in .eleventy.js) turns into the same
//   carousel as before. Linked images ([![..](..)](..)) and images with a
//   title are left alone as ordinary text.
//
// The markdown parsing half has no browser dependencies so it can be
// checked against every page from Node (module.exports at the bottom).
(function (root) {
  var IMG = "!\\[[^\\]\\n]*\\]\\([^)\\s]+\\)";
  var LINE = "[ \\t]*(?:[*+-][ \\t]+)?" + IMG + "(?:[ \\t]*" + IMG + ")*[ \\t]*";
  // Decap anchors this at the start of a block itself; no "m" flag allowed.
  var BLOCK_PATTERN = new RegExp("^" + LINE + "(?:\\n(?:[ \\t]*\\n)*" + LINE + ")*(?=\\n|$)");

  function parseBlock(text) {
    var re = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
    var photos = [];
    var m;
    while ((m = re.exec(text))) photos.push({ src: m[2], alt: m[1] });
    return photos;
  }

  function serializeBlock(photos) {
    return photos
      .filter(function (p) { return p && p.src; })
      .map(function (p) { return "![" + (p.alt || "").replace(/[\]\n]/g, " ") + "](" + p.src + ")"; })
      .join("\n");
  }

  var api = { BLOCK_PATTERN: BLOCK_PATTERN, parseBlock: parseBlock, serializeBlock: serializeBlock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.CMS) return;

  var CMS = root.CMS;
  var h = root.h;

  function toJS(v) { return v && typeof v.toJS === "function" ? v.toJS() : v; }
  function srcOf(item) { return typeof item === "string" ? item : (item && item.src) || ""; }
  function fileName(path) { return decodeURIComponent(String(path).split("/").pop() || ""); }

  // Photos already on the site load from their own address. One uploaded
  // in this editing session isn't on the site until it's published and
  // rebuilt, so when that fails, ask Decap for its copy - which it only
  // loads in the background, hence the few retries.
  function thumbProps(src, getAsset, field) {
    return {
      src: src,
      onError: function (e) {
        var img = e.target;
        var tries = Number(img.getAttribute("data-tries") || 0);
        if (!getAsset || tries >= 8) return;
        img.setAttribute("data-tries", tries + 1);
        setTimeout(function () {
          var url = String(getAsset(src, field) || "");
          img.src = url && url !== src ? url : src + "#" + (tries + 1);
        }, 300 * (tries + 1));
      },
    };
  }

  var css = [
    ".pg-count{font-size:13px;color:#798291;margin:0 0 8px}",
    ".pg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}",
    ".pg-tile{position:relative;border:1px solid #dfdfe3;border-radius:6px;overflow:hidden;background:#fff}",
    ".pg-thumb{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#eff0f4}",
    ".pg-num{position:absolute;top:5px;left:5px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:1px 6px;border-radius:9px}",
    ".pg-name{font-size:11px;color:#798291;padding:4px 6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pg-actions{display:flex;gap:2px;padding:4px}",
    ".pg-actions button{flex:1;min-width:0;border:0;border-radius:4px;background:#eff0f4;color:#313d3e;font-size:13px;line-height:1;padding:6px 0;cursor:pointer}",
    ".pg-actions button:hover:not(:disabled){background:#e8f5fe;color:#3a69c7}",
    ".pg-actions button.pg-remove:hover{background:#fcefea;color:#d60032}",
    ".pg-actions button:disabled{opacity:.35;cursor:default}",
    ".pg-add{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:132px;border:2px dashed #cdcfd6;border-radius:6px;background:#fafafb;color:#3a69c7;font-size:13px;cursor:pointer}",
    ".pg-add:hover{border-color:#3a69c7;background:#e8f5fe}",
    ".pg-add span{font-size:26px;line-height:1}",
  ].join("\n");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // Grid of photos. Value: a list of paths, or with `alt: true` on the
  // field, a list of {src, alt} (used by the body block, to keep alt text).
  var PhotoGridControl = root.createClass({
    componentDidMount: function () { this.controlID = "photogrid-" + Math.random().toString(36).slice(2); },

    // Decap's field wrapper only re-renders a custom field when its value
    // changes, unless the field has its own check - without this, photos
    // picked in the media library never arrive.
    shouldComponentUpdate: function (next) {
      return next.value !== this.props.value ||
        next.getAsset !== this.props.getAsset ||
        next.classNameWrapper !== this.props.classNameWrapper ||
        !!(this.pending && next.mediaPaths && next.mediaPaths.get(this.controlID));
    },

    componentDidUpdate: function () {
      var pending = this.pending;
      var mediaPaths = this.props.mediaPaths;
      if (!pending || !mediaPaths) return;
      var picked = mediaPaths.get(this.controlID);
      if (!picked) return;
      picked = toJS(picked);
      var paths = (Array.isArray(picked) ? picked : [picked]).filter(Boolean);
      this.pending = null;
      if (this.props.onRemoveInsertedMedia) this.props.onRemoveInsertedMedia(this.controlID);
      if (!paths.length) return;
      var items = this.items();
      var withAlt = this.withAlt();
      var make = function (p) { return withAlt ? { src: p, alt: "" } : p; };
      if (pending.type === "replace") items[pending.index] = make(paths[0]);
      else items = items.concat(paths.map(make));
      this.props.onChange(items);
    },

    componentWillUnmount: function () {
      if (this.controlID && this.props.onRemoveMediaControl) this.props.onRemoveMediaControl(this.controlID);
    },

    withAlt: function () { return !!(this.props.field && this.props.field.get("alt")); },

    items: function () { return (toJS(this.props.value) || []).slice(); },

    openLibrary: function (pending) {
      var field = this.props.field;
      this.pending = pending;
      this.props.onOpenMediaLibrary({
        controlID: this.controlID,
        forImage: true,
        privateUpload: field.get("private"),
        value: "",
        allowMultiple: pending.type === "add",
        config: field.getIn(["media_library", "config"]),
        field: field,
      });
    },

    move: function (index, delta) {
      var items = this.items();
      var to = index + delta;
      if (to < 0 || to >= items.length) return;
      var moved = items.splice(index, 1)[0];
      items.splice(to, 0, moved);
      this.props.onChange(items);
    },

    remove: function (index) {
      var items = this.items();
      items.splice(index, 1);
      this.props.onChange(items);
    },

    button: function (label, title, onClick, disabled, className) {
      return h("button", {
        type: "button", title: title, "aria-label": title, disabled: disabled, className: className,
        onClick: function (e) { e.preventDefault(); e.stopPropagation(); onClick(); },
      }, label);
    },

    render: function () {
      var self = this;
      var items = this.items();
      var last = items.length - 1;
      var tiles = items.map(function (item, i) {
        var src = srcOf(item);
        return h("div", { className: "pg-tile", key: i + ":" + src },
          h("img", Object.assign(thumbProps(src, self.props.getAsset, self.props.field), { className: "pg-thumb", alt: "", loading: "lazy" })),
          h("span", { className: "pg-num" }, i + 1),
          h("div", { className: "pg-name", title: src }, fileName(src)),
          h("div", { className: "pg-actions" },
            self.button("◀", "Move earlier", function () { self.move(i, -1); }, i === 0),
            self.button("▶", "Move later", function () { self.move(i, 1); }, i === last),
            self.button("↻", "Replace photo", function () { self.openLibrary({ type: "replace", index: i }); }),
            self.button("✕", "Remove photo", function () { self.remove(i); }, false, "pg-remove")));
      });
      tiles.push(h("button", {
        type: "button", key: "add", className: "pg-add",
        onClick: function (e) { e.preventDefault(); e.stopPropagation(); self.openLibrary({ type: "add" }); },
      }, h("span", null, "+"), "Add photos"));
      return h("div", { id: this.props.forID, className: this.props.classNameWrapper },
        h("p", { className: "pg-count" }, items.length === 1 ? "1 photo" : items.length + " photos"),
        h("div", { className: "pg-grid" }, tiles));
    },
  });

  var PhotoGridPreview = root.createClass({
    render: function () {
      var getAsset = this.props.getAsset;
      var field = this.props.field;
      var items = toJS(this.props.value) || [];
      return h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } }, items.map(function (item, i) {
        return h("img", Object.assign(thumbProps(srcOf(item), getAsset, field), { key: i, style: { width: "120px", height: "90px", objectFit: "cover" } }));
      }));
    },
  });

  CMS.registerWidget("photogrid", PhotoGridControl, PhotoGridPreview);

  // Same id as Decap's own image block, so this one is used instead of it
  // (Decap tries blocks in registration order and "image" comes first).
  CMS.registerEditorComponent({
    id: "image",
    label: "Photos",
    fields: [{ label: "Photos", name: "photos", widget: "photogrid", alt: true }],
    pattern: BLOCK_PATTERN,
    fromBlock: function (match) { return { photos: parseBlock(match[0]) }; },
    toBlock: function (data) { return serializeBlock(toJS(data.photos) || []); },
    toPreview: function (data, getAsset, fields) {
      var photos = toJS(data.photos) || [];
      return h("div", null, photos.map(function (p, i) {
        return h("img", Object.assign(thumbProps(p.src, getAsset), { key: i, alt: p.alt || "" }));
      }));
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
