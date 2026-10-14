// Detects running games the way Discord does: by the program that is running, not by a window.
// tasklist cuts long names at 25 characters ("VALORANT-Win64-Shipping.exe" became "VALORANT-Win64-Shipping.e"),
// so the process list comes from PowerShell, which gives full names and install paths.
const { execFile } = require("child_process");

// Program names without ".exe", lower case.
const KNOWN = [
  "valorant-win64-shipping", "valorant", "cs2", "csgo", "fortniteclient-win64-shipping", "fortnitelauncher",
  "leagueoflegends", "league of legends", "dota2", "rocketleague", "overwatch", "r5apex", "r5apex_dx12",
  "gta5", "gta5_enhanced", "rainbowsix", "rainbowsix_vulkan", "eldenring", "destiny2", "tslgame", "warframe.x64",
  "cyberpunk2077", "rustclient", "hl2", "genshinimpact", "yuanshen", "wow", "wowclassic", "ffxiv_dx11", "robloxplayerbeta",
  "marvel-win64-shipping", "project8", "fc24", "fc25", "fc26", "apexlegends", "pubg", "deadbydaylight-win64-shipping",
  "helldivers2", "payday3client-win64-shipping", "starfield", "bf2042", "battlefieldv", "bf1", "cod", "modernwarfare",
  "eft", "paladins", "smite", "brawlhalla", "minecraft", "fallguys_client_game", "palworld-win64-shipping",
  "thefinals", "arc_raiders", "deadlock", "halo infinite", "haloinfinite", "starcraft ii", "diablo iv", "overwatch2",
  "wutheringwaves", "honkaiimpact3", "zenlesszonezero", "tarkov", "escapefromtarkov", "lethalcompany", "valheim",
  "terraria", "stardewvalley", "amongus", "phasmophobia", "left4dead2", "tf2", "garrysmod", "csgo", "bf4", "bf3",
  "worldofwarships", "worldoftanks", "wotblitz", "pathofexile", "pathofexile_x64", "lostark", "blackdesert64",
  "newworld", "throneandliberty", "dayz_x64",
];

// Install folders that only games use, the same trick launchers rely on.
const GAME_PATHS = [
  /\\steamapps\\common\\/i,
  /\\riot games\\(valorant|league of legends)\\/i,
  /\\epic games\\[^\\]+\\.*-win64-shipping\.exe$/i,
  /\\ubisoft game launcher\\games\\/i,
  /\\gog galaxy\\games\\/i,
  /\\xboxgames\\/i,
  /\\ea games\\/i,
  /\\battle\.net\\.*\.exe$/i,
];
// Programs inside those folders that are not games.
const NOT_GAMES = /(redist|vcredist|dxsetup|crashhandler|crashreport|unitycrashhandler|easyanticheat|beclient|eosinstaller|installer|uninstall|setup|launcher_helper|steamwebhelper|ue4prereqsetup|dotnet)/i;

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\.exe$/, "");

function processList() {
  const ps = "Get-Process | Select-Object ProcessName,Path | ConvertTo-Csv -NoTypeInformation";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 15000, maxBuffer: 8 << 20 }, (_e, out) => {
      const procs = [];
      for (const line of (out || "").split(/\r?\n/).slice(1)) {
        const m = /^"((?:[^"]|"")*)"(?:,"((?:[^"]|"")*)")?/.exec(line);
        if (m) procs.push({ name: m[1].replace(/""/g, '"'), path: (m[2] || "").replace(/""/g, '"') });
      }
      resolve(procs);
    });
  });
}

// procs: [{ name, path }] or plain names. Returns the name of the first game found, or null.
function matchGame(procs, extra = []) {
  const list = new Set([...KNOWN, ...extra.map(norm).filter(Boolean)]);
  for (const p of procs) {
    const name = norm(typeof p === "string" ? p : p.name);
    const path = typeof p === "string" ? "" : p.path || "";
    if (list.has(name)) return name;
    if (path && !NOT_GAMES.test(name) && GAME_PATHS.some((re) => re.test(path))) return name;
  }
  return null;
}

async function detect(extra) {
  return matchGame(await processList(), extra);
}

module.exports = { detect, matchGame, KNOWN };
