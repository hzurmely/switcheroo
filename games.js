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

function csvRow(line) {
  const out = [];
  const re = /"((?:[^"]|"")*)"|([^,]*)/g;
  let m;
  while ((m = re.exec(line)) !== null && out.length < 6) {
    out.push(m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]);
    if (re.lastIndex >= line.length) break;
    re.lastIndex++; // skip the comma
  }
  return out;
}

// Resolves { procs, error }. error is set when PowerShell could not list the programs.
function processList() {
  const ps = "Get-Process | Select-Object ProcessName,Path,WorkingSet64 | ConvertTo-Csv -NoTypeInformation";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 20000, maxBuffer: 16 << 20 }, (err, out, errOut) => {
      const procs = [];
      for (const line of (out || "").split(/\r?\n/).slice(1)) {
        if (!line.trim()) continue;
        const [name, path, ws] = csvRow(line);
        if (name) procs.push({ name, path: path || "", mb: Math.round((Number(ws) || 0) / 1048576) });
      }
      resolve({ procs, error: procs.length ? null : (err && err.message) || String(errOut || "No programs were listed").slice(0, 200) });
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
  const { procs } = await processList();
  return matchGame(procs, extra);
}

// For the Settings screen: what was seen, what matched, and the biggest programs so the user can add one.
async function scan(extra) {
  const { procs, error } = await processList();
  const top = [...procs]
    .filter((p) => !/^(system|idle|registry|memcompression|dwm|explorer|svchost|searchhost|startmenuexperiencehost|msedgewebview2|chrome|msedge|firefox|code|claude|switcheroo|electron)$/i.test(p.name))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 8)
    .map((p) => ({ name: p.name, mb: p.mb }));
  return { count: procs.length, found: matchGame(procs, extra), top, error };
}

module.exports = { detect, scan, matchGame, KNOWN };
