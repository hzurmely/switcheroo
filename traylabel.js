// Short label for the active network, shown next to the menu bar icon on Mac and as a badge on the Windows tray icon.
// "5G" or "2.4G" when the network name says so; if only the other name says it, this one gets the opposite band.
// With no band in either name, "A" or "B" (the first or second network of the pair).
const FIVE = /(^|\D)5\s*-?\s*g(hz)?/i;
const TWO_FOUR = /(^|\D)2[.,]4/;

function band(name) {
  const n = String(name || "");
  if (TWO_FOUR.test(n)) return "2.4G";
  if (FIVE.test(n)) return "5G";
  return null;
}

function trayLabel(active, pair) {
  if (!active || !Array.isArray(pair)) return "";
  const i = pair.findIndex((n) => String(n).toLowerCase() === String(active).toLowerCase());
  if (i < 0) return "";
  const mine = band(pair[i]);
  const other = band(pair[1 - i]);
  // both names claim the same band: the band cannot tell them apart
  if (mine && mine === other) return i === 0 ? "A" : "B";
  if (mine) return mine;
  // only the other name says 5G or 2.4G, so this one is the opposite band
  if (other) return other === "5G" ? "2.4G" : "5G";
  return i === 0 ? "A" : "B";
}

module.exports = { trayLabel, band };
