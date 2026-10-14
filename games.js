// Detects running games by process name (Windows tasklist).
const { execFile } = require("child_process");

const KNOWN = [
  "valorant-win64-shipping.exe", "cs2.exe", "csgo.exe", "fortniteclient-win64-shipping.exe",
  "leagueoflegends.exe", "league of legends.exe", "dota2.exe", "rocketleague.exe", "overwatch.exe",
  "r5apex.exe", "gta5.exe", "rainbowsix.exe", "rainbowsix_vulkan.exe", "eldenring.exe", "destiny2.exe",
  "tslgame.exe", "warframe.x64.exe", "cyberpunk2077.exe", "rustclient.exe", "hl2.exe", "genshinimpact.exe",
  "wow.exe", "ffxiv_dx11.exe", "robloxplayerbeta.exe", "marvel-win64-shipping.exe", "project8.exe",
  "fc25.exe", "fc26.exe", "apexlegends.exe", "pubg.exe", "deadbydaylight-win64-shipping.exe",
  "helldivers2.exe", "payday3client-win64-shipping.exe", "starfield.exe", "bf2042.exe", "battlefieldv.exe",
  "cod.exe", "modernwarfare.exe", "eft.exe", "paladins.exe", "smite.exe", "brawlhalla.exe",
];

function processList() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true, timeout: 10000, maxBuffer: 4 << 20 }, (_e, out) => {
      const names = [];
      for (const line of (out || "").split(/\r?\n/)) {
        const m = /^"([^"]+)"/.exec(line);
        if (m) names.push(m[1].toLowerCase());
      }
      resolve(names);
    });
  });
}

// Returns the name of the first game found, or null.
function matchGame(names, extra = []) {
  const list = new Set([...KNOWN, ...extra.map((x) => x.trim().toLowerCase()).filter(Boolean)]);
  return names.find((n) => list.has(n)) || null;
}

async function detect(extra) {
  return matchGame(await processList(), extra);
}

module.exports = { detect, matchGame, KNOWN };
