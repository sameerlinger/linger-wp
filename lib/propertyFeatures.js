// Pet-friendly / driver-accommodation flags per property. Like dormant
// status, the booking engine (LingerApp) is the single source of truth - set
// in its Properties settings, not in this CMS. Fetched at build time and
// memoized per build. Returns { [slug]: { petFriendly, driverAccommodation } }.
const ENDPOINT = process.env.PROPERTY_FEATURES_URL || "https://linger-booking-engine.onrender.com/api/public/property-features";
// Render's free plan can take 30s+ to wake an idle instance.
const FETCH_TIMEOUT_MS = 45000;

let cached = null;

module.exports = async function propertyFeatures() {
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(ENDPOINT, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    cached = data && typeof data.properties === "object" && data.properties ? data.properties : {};
  } catch (err) {
    // Fail open, like dormantSlugs: the site still builds, the two synced
    // icons just don't show until the next successful build.
    console.warn(`[propertyFeatures] could not reach LingerApp (${err.message}) - building without pet/driver flags`);
    cached = {};
  }
  return cached;
};
