// Detects running games the way Discord does: by the program that is running, not by a window.
// tasklist cuts long names at 25 characters ("VALORANT-Win64-Shipping.exe" became "VALORANT-Win64-Shipping.e"),
// so the process list comes from PowerShell, which gives full names and install paths.
const { execFile } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");

// Discord's own list of detectable games: every game with the program names it looks for.
// Downloaded once a week and cached, so new games work without updating Switcheroo.
const DB_URL = "https://discord.com/api/v9/applications/detectable";
let db = { byName: new Map(), count: 0 };

function buildDb(list) {
  const byName = new Map();
  let count = 0;
  for (const g of Array.isArray(list) ? list : []) {
    let used = false;
    for (const e of g.executables || []) {
      if (e.os !== "win32" || e.is_launcher || !e.name) continue;
      const full = String(e.name).toLowerCase().replace(/\\/g, "/");
      const base = full.split("/").pop().replace(/\.exe$/, "");
      if (!base) continue;
      if (!byName.has(base)) byName.set(base, []);
      byName.get(base).push({ game: g.name, suffix: full.includes("/") ? full : "" });
      used = true;
    }
    if (used) count++;
  }
  return { byName, count };
}

function setDb(list) {
  db = buildDb(list);
  return db.count;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000, headers: { "User-Agent": "Switcheroo" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(e); } });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// Loads the cached copy right away, then refreshes it when it is older than a week.
async function init(dir) {
  const file = path.join(dir, "discord-games.json");
  let age = Infinity;
  try {
    setDb(JSON.parse(fs.readFileSync(file, "utf8")));
    age = Date.now() - fs.statSync(file).mtimeMs;
  } catch {}
  if (age < 7 * 86400000) return db.count;
  try {
    const list = await fetchJson(DB_URL);
    if (Array.isArray(list) && list.length > 100) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(list.map((g) => ({ name: g.name, executables: g.executables }))));
      setDb(list);
    }
  } catch {}
  return db.count;
}

function discordMatch(name, procPath) {
  const hits = db.byName.get(name);
  if (!hits) return null;
  const p = String(procPath || "").toLowerCase().replace(/\\/g, "/");
  for (const h of hits) {
    if (!h.suffix) return h.game;
    if (p && p.endsWith("/" + h.suffix)) return h.game;
  }
  return null;
}

// Minecraft Java Edition runs inside javaw.exe (java on Linux and macOS), which says nothing on its own,
// so it is recognised by its window title or by the launcher folder its Java runtime lives in.
const MC_TITLE = /^(minecraft|lunar client|badlion)/i;
const MC_PATH = /minecraft|4297127d64ec6|lunarclient|prismlauncher|multimc|curseforge|modrinth|tlauncher|badlion/i;

function minecraftMatch(name, procPath, title) {
  if (!/^javaw?$/.test(name)) return null;
  if (MC_TITLE.test(String(title || "").trim()) || MC_PATH.test(String(procPath || ""))) return "Minecraft";
  return null;
}

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
  "newworld", "throneandliberty", "dayz_x64", "minecraft.windows",
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
// Linux and macOS: ps lists the programs. Windows games run through Wine or Proton show up as .exe paths in the arguments.
function parsePs(text) {
  const procs = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    let name = m[1];
    let p = "";
    const exe = /^(.*?([^\/\\]+)\.exe)\b/i.exec(m[2]);
    if (exe) {
      name = exe[2];
      p = exe[1];
    } else if (m[2].startsWith("/")) {
      p = m[2].split(/\s--?\w/)[0].trim();
    }
    procs.push({ name, path: p.replace(/\//g, "\\"), mb: 0 });
  }
  return procs;
}

function processList() {
  if (process.platform !== "win32") {
    return new Promise((resolve) => {
      execFile("ps", ["-eo", "comm=,args="], { timeout: 10000, maxBuffer: 16 << 20 }, (err, out) => {
        const procs = parsePs(out);
        resolve({ procs, error: procs.length ? null : (err && err.message) || "No programs were listed" });
      });
    });
  }
  const ps = "Get-Process | Select-Object ProcessName,Path,WorkingSet64,MainWindowTitle | ConvertTo-Csv -NoTypeInformation";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 20000, maxBuffer: 16 << 20 }, (err, out, errOut) => {
      const procs = [];
      for (const line of (out || "").split(/\r?\n/).slice(1)) {
        if (!line.trim()) continue;
        const [name, path, ws, title] = csvRow(line);
        if (name) procs.push({ name, path: path || "", title: title || "", mb: Math.round((Number(ws) || 0) / 1048576) });
      }
      resolve({ procs, error: procs.length ? null : (err && err.message) || String(errOut || "No programs were listed").slice(0, 200) });
    });
  });
}

// procs: [{ name, path, title }] or plain names. Returns the name of the first game found, or null.
function matchGame(procs, extra = []) {
  const list = new Set([...KNOWN, ...extra.map(norm).filter(Boolean)]);
  for (const p of procs) {
    const name = norm(typeof p === "string" ? p : p.name);
    const path = typeof p === "string" ? "" : p.path || "";
    const viaDiscord = discordMatch(name, path);
    if (viaDiscord) return viaDiscord;
    const mc = minecraftMatch(name, path, typeof p === "string" ? "" : p.title);
    if (mc) return mc;
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
  return { count: procs.length, found: matchGame(procs, extra), top, error, db: db.count };
}

module.exports = { detect, scan, matchGame, parsePs, KNOWN, init, setDb, dbSize: () => db.count };
