// Shrinks oversized photos in src/images in place, so full-size camera/phone
// uploads (e.g. from the CMS) don't bloat the repo or slow down pages.
// Run by .github/workflows/shrink-images.yml on every push to main; can also be
// run locally: npm install --no-save sharp && node scripts/shrink-images.js
//
// Rules (chosen so re-running on already-shrunk files is a no-op):
//  - anything wider/taller than MAX px is resized down to MAX on its long side
//  - JPEGs over BIG_BYTES are re-encoded at QUALITY, kept only if >20% smaller
// Files keep their name and format, so markdown links never need changing.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..", "src", "images");
const MAX = 1600;
const BIG_BYTES = 1024 * 1024;
const QUALITY = 82;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(jpe?g|png)$/i.test(entry.name)) yield p;
  }
}

async function shrink(file) {
  const before = fs.statSync(file).size;
  const meta = await sharp(file).metadata();
  const tooBig = Math.max(meta.width, meta.height) > MAX;
  const isJpeg = meta.format === "jpeg";
  if (!tooBig && !(isJpeg && before > BIG_BYTES)) return null;

  let img = sharp(file).rotate(); // bake in EXIF orientation before metadata is stripped
  if (tooBig) img = img.resize(MAX, MAX, { fit: "inside", withoutEnlargement: true });
  img = isJpeg
    ? img.jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
    : img.png({ compressionLevel: 9 });
  const out = await img.toBuffer();

  const worthIt = tooBig ? out.length < before : out.length < before * 0.8;
  if (!worthIt) return null;
  fs.writeFileSync(file, out);
  return { file: path.relative(process.cwd(), file), before, after: out.length };
}

(async () => {
  let saved = 0;
  for (const file of walk(ROOT)) {
    const r = await shrink(file);
    if (!r) continue;
    saved += r.before - r.after;
    console.log(`${(r.before / 1048576).toFixed(1)}MB -> ${(r.after / 1048576).toFixed(1)}MB  ${r.file}`);
  }
  console.log(`Saved ${(saved / 1048576).toFixed(1)}MB`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
