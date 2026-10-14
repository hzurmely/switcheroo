// Finds the 5G / 2.4G pair of a network from the names of the networks saved in Windows.
// "APTO_301_5G" and "APTO_301" belong together, so do "Casa-5GHz" and "Casa-2.4GHz".
const SUFFIX = /[\s_\-.]*(5|2[.,]?4)\s?(g|ghz)$/i;
const low = (s) => String(s || "").trim().toLowerCase();
const baseOf = (s) => low(s).replace(SUFFIX, "").replace(/[\s_\-.]+$/, "");
const is5 = (s) => /(^|[\s_\-.])5\s?(g|ghz)$/i.test(String(s || "").trim());

// Returns { name, a, b } when the connected network has exactly one obvious partner, else null.
// a is the 5G one when that can be told from the names.
function detectPair(ssid, profiles) {
  if (!ssid || !Array.isArray(profiles)) return null;
  const base = baseOf(ssid);
  if (!base) return null;
  const mates = profiles.filter((p) => low(p) !== low(ssid) && baseOf(p) === base);
  if (!mates.length) return null;
  // Prefer the partner that is on the other band.
  let other = mates.find((p) => is5(p) !== is5(ssid)) || mates[0];
  const pair = is5(other) && !is5(ssid) ? [other, ssid] : [ssid, other];
  const name = String(ssid).replace(SUFFIX, "").replace(/[\s_\-.]+$/, "").trim() || "Home";
  return { name: name.slice(0, 24), a: pair[0], b: pair[1] };
}

module.exports = { detectPair };
