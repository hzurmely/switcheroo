// A private Python for the Python tab: downloaded once into the app's data folder (Windows: the official
// embeddable build, Mac: a venv made from the system python3), plus the kernel process that runs notebook cells.
const fs = require("fs");
const path = require("path");
const https = require("https");
const cp = require("child_process");

const VERSION = "3.12.8";
const PACKAGES = ["pandas", "numpy", "matplotlib"];
const unpacked = (p) => p.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);

function download(url, dest, onPct, hops = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Switcheroo" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).toString(), dest, onPct, hops + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed (${res.statusCode}) for ${url}`));
        }
        const total = Number(res.headers["content-length"] || 0);
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on("data", (c) => {
          got += c.length;
          if (total && onPct) onPct(Math.round((got / total) * 100));
        });
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

// Runs a command and streams its output lines to onLine. Resolves with the exit code and all output.
function run(cmd, args, { cwd, onLine, timeout = 20 * 60 * 1000, env } = {}) {
  return new Promise((resolve) => {
    let all = "";
    let child;
    try {
      child = cp.spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", ...env } });
    } catch (e) {
      return resolve({ code: -1, out: String(e.message || e) });
    }
    const timer = setTimeout(() => child.kill(), timeout);
    const feed = (b) => {
      const s = b.toString("utf8");
      all += s;
      if (onLine) s.split(/\r?\n/).filter(Boolean).forEach(onLine);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: all + String(e.message || e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out: all });
    });
  });
}

function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function create({ root, kernelScript, onProgress = () => {} }) {
  const pyDir = path.join(root, "python-runtime");
  const marker = path.join(pyDir, ".switcheroo-ready");
  const privateExe = () => (process.platform === "win32" ? path.join(pyDir, "python.exe") : path.join(pyDir, "bin", "python3"));
  const script = unpacked(kernelScript);
  let setting = false;
  let sysPy = undefined; // cached result of the system python search

  const isReady = () => fs.existsSync(marker) && fs.existsSync(privateExe());

  // The python to use: ours when set up, otherwise one on the PATH that already has the packages.
  async function find() {
    if (isReady()) return [privateExe(), []];
    if (sysPy !== undefined) return sysPy;
    for (const [cmd, pre] of [["py", ["-3"]], ["python", []], ["python3", []]]) {
      const r = await run(cmd, [...pre, "-c", "import pandas, numpy, matplotlib"], { timeout: 30000 });
      if (r.code === 0) return (sysPy = [cmd, pre]);
    }
    return (sysPy = null);
  }

  function status() {
    return { ready: isReady(), setting, dir: pyDir, platform: process.platform, version: VERSION };
  }

  async function setup() {
    if (setting) return { ok: false, error: "Already setting up." };
    setting = true;
    const say = (text, pct) => onProgress({ text, pct: pct ?? null });
    try {
      fs.rmSync(pyDir, { recursive: true, force: true });
      fs.mkdirSync(pyDir, { recursive: true });
      let exe;
      if (process.platform === "win32") {
        const arch = process.arch === "arm64" ? "arm64" : "amd64";
        const zip = path.join(root, "python-embed.zip");
        say("Downloading Python " + VERSION + "...", 0);
        await download(`https://www.python.org/ftp/python/${VERSION}/python-${VERSION}-embed-${arch}.zip`, zip, (p) => say("Downloading Python " + VERSION + "...", p));
        say("Unpacking Python...");
        const x = await run("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${pyDir}' -Force`], { timeout: 120000 });
        if (x.code !== 0) throw new Error("Could not unpack Python: " + x.out.split(/\r?\n/).filter(Boolean).slice(-1));
        try {
          fs.unlinkSync(zip);
        } catch {}
        // the embeddable build ignores site packages until this line is switched on
        for (const f of fs.readdirSync(pyDir).filter((n) => /^python\d+\._pth$/.test(n))) {
          const p = path.join(pyDir, f);
          fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/^#\s*import site/m, "import site"));
        }
        say("Downloading the package installer...", 0);
        const gp = path.join(pyDir, "get-pip.py");
        await download("https://bootstrap.pypa.io/get-pip.py", gp, (p) => say("Downloading the package installer...", p));
        say("Installing pip...");
        const g = await run(privateExe(), [gp, "--no-warn-script-location"], { cwd: pyDir });
        if (g.code !== 0) throw new Error("pip did not install: " + g.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" "));
        exe = privateExe();
      } else {
        say("Creating a Python environment...");
        const v = await run("python3", ["-m", "venv", pyDir], { timeout: 120000 });
        if (v.code !== 0) throw new Error("python3 was not found or cannot make environments. On a Mac, run xcode-select --install first. " + v.out.split(/\r?\n/).filter(Boolean).slice(-1));
        exe = privateExe();
      }
      say("Installing pandas, numpy and matplotlib. This is the big download...");
      const i = await run(exe, ["-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", ...PACKAGES], {
        cwd: pyDir,
        onLine: (l) => say(l.slice(0, 110)),
      });
      if (i.code !== 0) throw new Error("Package install failed: " + i.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" "));
      const t = await run(exe, ["-c", "import pandas, numpy, matplotlib; print('ok')"]);
      if (t.code !== 0) throw new Error("Installed, but the packages do not import: " + t.out.split(/\r?\n/).filter(Boolean).slice(-1));
      fs.writeFileSync(marker, new Date().toISOString());
      sysPy = undefined;
      say("Python is ready.", 100);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    } finally {
      setting = false;
    }
  }

  // ---- the kernel: one long running python that executes cells and keeps its variables
  let kernel = null;
  let nextId = 1;
  const pending = new Map();

  function failAll(msg) {
    for (const [, p] of pending) p({ out: "", err: msg, images: [] });
    pending.clear();
  }

  async function ensureKernel(prepareData) {
    if (kernel && kernel.proc.exitCode === null) return kernel;
    const py = await find();
    if (!py) return null;
    const folder = prepareData();
    const proc = cp.spawn(py[0], [...py[1], "-u", script, folder], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg" },
    });
    const k = { proc, buf: "", note: "" };
    kernel = k;
    proc.stdout.on("data", (b) => {
      k.buf += b.toString("utf8");
      let i;
      while ((i = k.buf.indexOf("\n")) >= 0) {
        const line = k.buf.slice(0, i);
        k.buf = k.buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.id === 0) k.note = m.out;
          else if (pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        } catch {}
      }
    });
    let errText = "";
    proc.stderr.on("data", (b) => (errText += b.toString("utf8")));
    proc.on("close", () => {
      if (kernel === k) kernel = null;
      failAll(errText ? errText.split(/\r?\n/).filter(Boolean).slice(-3).join("\n") : "The Python process stopped. Run again to restart it.");
    });
    proc.stdin.on("error", () => {});
    return k;
  }

  async function send(msg, prepareData) {
    const k = await ensureKernel(prepareData);
    if (!k) return { out: "", err: "Python is not set up yet. Press Set up Python.", images: [] };
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      k.proc.stdin.write(JSON.stringify({ id, ...msg }) + "\n");
    });
  }

  const runCell = (code, prepareData) => send({ code }, prepareData);
  const reload = (prepareData) => {
    prepareData();
    return send({ cmd: "reload" }, prepareData);
  };
  function stop() {
    if (kernel) {
      try {
        kernel.proc.kill();
      } catch {}
      kernel = null;
    }
    failAll("Restarted.");
  }

  // The small terminal. pip and python commands run as real processes, anything else is python code in the kernel.
  async function term(line, cwd, prepareData) {
    const text = String(line || "").trim();
    if (!text) return { out: "", err: "", images: [] };
    const words = splitArgs(text);
    const head = (words[0] || "").toLowerCase();
    if (head === "pip" || head === "pip3" || head === "python" || head === "python3" || head === "py") {
      const py = await find();
      if (!py) return { out: "", err: "Python is not set up yet. Press Set up Python.", images: [] };
      const rest = words.slice(1);
      const args = head.startsWith("pip") ? ["-m", "pip", ...rest] : rest;
      const r = await run(py[0], [...py[1], ...args], { cwd, timeout: 10 * 60 * 1000 });
      return { out: r.out, err: "", images: [] };
    }
    return runCell(text, prepareData);
  }

  return { status, setup, find, runCell, reload, stop, term, isReady, exe: privateExe };
}

module.exports = { create, splitArgs };
