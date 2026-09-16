// The booking engine (Folio, linger-booking-engine.onrender.com) is the
// single source of truth for which properties are dormant - there is no
// CMS field for it any more (there used to be, but toggling it in Folio's
// admin had no way to reach back into this repo's git history, so the two
// silently drifted apart). This fetches Folio's own public list at build
// time instead. Memoized per build (module-level cache) since this gets
// called from several independent Eleventy data files.
const DORMANT_ENDPOINT = "https://linger-booking-engine.onrender.com/api/public/dormant-properties";
// Generous timeout - Folio is on Render's free plan, which spins down an
// idle instance and can take 30s+ to wake back up on the next request.
const FETCH_TIMEOUT_MS = 45000;

let cached = null;

module.exports = async function dormantSlugs() {
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(DORMANT_ENDPOINT, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    cached = new Set(Array.isArray(data.slugs) ? data.slugs : []);
  } catch (err) {
    // Fail open rather than fail the whole site build - worst case a
    // dormant property is briefly visible again until the next successful
    // build, which is far better than the homepage refusing to build at
    // all because Folio happened to be unreachable.
    console.warn(`[dormantSlugs] could not reach Folio (${err.message}) - building with nothing marked dormant`);
    cached = new Set();
  }
  return cached;
};
