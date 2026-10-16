// Short label for the active network, shown next to the menu bar icon on Mac and as a badge on the Windows tray icon.
// "5G" or "2.4G" when the network name says so, otherwise "A" or "B" (the first or second network of the pair).
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
  // if both names claim the same band, the band cannot tell them apart
  if (mine && mine !== other) return mine;
  return i === 0 ? "A" : "B";
}

module.exports = { trayLabel, band };
