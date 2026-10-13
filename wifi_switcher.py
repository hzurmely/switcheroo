"""
Wifi Switcher for Windows 11 (tray edition)

Pick two saved Wifi networks (for example your 5G and your 2.4G one).
The program lives in the system tray, keeps measuring the connection you are on,
periodically tries the other one, and stays on whichever performs better.

Tray menu: Open, Pause or resume, Start with Windows, Exit.
Closing the window only hides it to the tray.

Run from source:  pip install pystray pillow   then   pythonw wifi_switcher.py
Or build the exe:  double click build.bat
"""

import json
import os
import queue
import re
import socket
import statistics
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
from collections import deque
from operator import sub
from tkinter import ttk

try:
    import pystray
    from PIL import Image, ImageDraw
    HAVE_TRAY = True
except Exception:
    HAVE_TRAY = False

try:
    import winreg
except Exception:
    winreg = None

APP_NAME = "WifiSwitcher"
CREATE_NO_WINDOW = 0x08000000
SETTINGS_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), APP_NAME)
SETTINGS_FILE = os.path.join(SETTINGS_DIR, "settings.json")
LOCK_PORT = 47653
PING_HOSTS = [("1.1.1.1", 443), ("8.8.8.8", 443)]
SPEED_URL = "https://speed.cloudflare.com/__down?bytes=2000000"

CHECK_INTERVAL = 30      # seconds between quality checks of the active network
TRIAL_INTERVAL = 240     # seconds between trial visits to the other network
TRIAL_COOLDOWN = 90      # minimum seconds between trials, even when degraded
STAY_MARGIN = 1.25       # the other network must be 25 percent better to win
DEGRADE_RATIO = 0.6      # a check below 60 percent of the recent average triggers a trial


# ---------------------------------------------------------------- netsh helpers

def run(args, timeout=25):
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
        )
        return result.stdout or ""
    except Exception:
        return ""


def list_profiles():
    """Saved Wifi profiles. Works on any Windows display language."""
    names = []
    for line in run(["netsh", "wlan", "show", "profiles"]).splitlines():
        if line[:1] in (" ", "\t") and ":" in line:
            value = line.split(":", 1)[1].strip()
            if value and value not in names:
                names.append(value)
    return names


def current_connection():
    """Returns (ssid, signal_percent) or (None, None) when not connected."""
    ssid = None
    signal = None
    for line in run(["netsh", "wlan", "show", "interfaces"]).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key == "SSID":
            ssid = value
        elif signal is None:
            match = re.fullmatch(r"(\d+)%", value)
            if match:
                signal = int(match.group(1))
    return ssid, signal


def internet_ok():
    for host, port in PING_HOSTS:
        try:
            with socket.create_connection((host, port), timeout=2):
                return True
        except OSError:
            continue
    return False


def connect(profile, stop_event, timeout=20):
    """Connect to a profile and wait until the internet works. Returns True on success."""
    run(["netsh", "wlan", "connect", "name=" + profile])
    started = time.time()
    while sub(time.time(), started) < timeout:
        if stop_event.is_set():
            return False
        ssid, _ = current_connection()
        if ssid and ssid.lower() == profile.lower() and internet_ok():
            return True
        time.sleep(1)
    return False


# ---------------------------------------------------------------- measurement

def measure():
    """Returns a dict with latency (ms), loss (0..1), mbps and a single score."""
    times = []
    lost = 0
    samples = 6
    for i in range(samples):
        host, port = PING_HOSTS[i % len(PING_HOSTS)]
        t0 = time.perf_counter()
        try:
            with socket.create_connection((host, port), timeout=2):
                pass
            times.append(sub(time.perf_counter(), t0) * 1000.0)
        except OSError:
            lost += 1
    latency = statistics.median(times) if times else None
    loss = lost / samples

    mbps = 0.0
    if times:
        try:
            started = time.perf_counter()
            received = 0
            with urllib.request.urlopen(SPEED_URL, timeout=8) as response:
                while sub(time.perf_counter(), started) < 3.0:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    received += len(chunk)
            elapsed = sub(time.perf_counter(), started)
            if elapsed > 0:
                mbps = received * 8 / elapsed / 1e6
        except Exception:
            mbps = 0.0

    if latency is None or mbps <= 0:
        score = 0.0
    else:
        keep = sub(1.0, loss)
        score = mbps * keep / (1.0 + latency / 150.0)
    return {"latency": latency, "loss": loss, "mbps": mbps, "score": score}


def describe(m):
    lat = "n/a" if m["latency"] is None else "%.0f ms" % m["latency"]
    return "%.1f Mbps, %s, loss %.0f%%, score %.1f" % (m["mbps"], lat, m["loss"] * 100, m["score"])


# ---------------------------------------------------------------- start with Windows

def autostart_command():
    if getattr(sys, "frozen", False):
        return '"%s" minimized' % sys.executable
    pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if not os.path.exists(pythonw):
        pythonw = sys.executable
    return '"%s" "%s" minimized' % (pythonw, os.path.abspath(__file__))


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def autostart_enabled():
    if winreg is None:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, APP_NAME)
            return True
    except OSError:
        return False


def set_autostart(enabled):
    if winreg is None:
        return
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, autostart_command())
            else:
                try:
                    winreg.DeleteValue(key, APP_NAME)
                except OSError:
                    pass
    except OSError:
        pass


# ---------------------------------------------------------------- engine

class Engine(threading.Thread):
    def __init__(self, net_a, net_b, events):
        super().__init__(daemon=True)
        self.nets = [net_a, net_b]
        self.events = events
        self.stop_event = threading.Event()
        self.history = {net_a: deque(maxlen=6), net_b: deque(maxlen=6)}

    def log(self, text):
        self.events.put(("log", text))

    def update(self, net, m, signal, active):
        self.events.put(("status", net, m, signal, active))

    def other(self, net):
        return self.nets[1] if net == self.nets[0] else self.nets[0]

    def baseline(self, net):
        values = list(self.history[net])
        return statistics.mean(values) if values else 0.0

    def wait(self, seconds):
        self.stop_event.wait(seconds)

    def run(self):
        ssid, _ = current_connection()
        active = None
        for net in self.nets:
            if ssid and ssid.lower() == net.lower():
                active = net
        if active is None:
            active = self.nets[0]
            self.log("Not on a selected network. Connecting to " + active)
            if not connect(active, self.stop_event):
                self.log("Could not connect to " + active + ", will keep trying.")
        else:
            self.log("Starting on " + active)

        last_trial = time.time()
        while not self.stop_event.is_set():
            ssid, signal = current_connection()
            if not ssid or not internet_ok():
                self.log("Lost connection on " + active + ", trying the other network.")
                alt = self.other(active)
                if connect(alt, self.stop_event):
                    active = alt
                    self.log("Now on " + active)
                else:
                    connect(active, self.stop_event)
                self.wait(5)
                continue

            m = measure()
            previous = self.baseline(active)
            self.history[active].append(m["score"])
            self.update(active, m, signal, True)

            degraded = previous > 0 and m["score"] < previous * DEGRADE_RATIO
            since_trial = sub(time.time(), last_trial)
            due = since_trial >= TRIAL_INTERVAL
            if (degraded and since_trial >= TRIAL_COOLDOWN) or due:
                reason = "quality dropped" if degraded else "scheduled comparison"
                active = self.trial(active, m, reason)
                last_trial = time.time()

            self.wait(CHECK_INTERVAL)

    def trial(self, active, current, reason):
        alt = self.other(active)
        self.log("Testing %s (%s)" % (alt, reason))
        if not connect(alt, self.stop_event):
            self.log(alt + " did not come up. Going back to " + active)
            connect(active, self.stop_event)
            return active
        alt_m = measure()
        _, alt_signal = current_connection()
        self.history[alt].append(alt_m["score"])
        self.update(alt, alt_m, alt_signal, True)

        reference = max(current["score"], self.baseline(active))
        if alt_m["score"] > reference * STAY_MARGIN or (current["score"] == 0 and alt_m["score"] > 0):
            self.log("Switched to %s (%s)" % (alt, describe(alt_m)))
            return alt
        self.log("%s is not clearly better (%s). Returning to %s" % (alt, describe(alt_m), active))
        if not connect(active, self.stop_event):
            self.log("Could not return to " + active + ", staying on " + alt)
            return alt
        return active


# ---------------------------------------------------------------- tray

def tray_image(running):
    size = 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = (46, 160, 67, 255) if running else (140, 140, 140, 255)
    draw.ellipse((0, 0, 63, 63), fill=(30, 30, 30, 255))
    cx, cy = 32, 46
    for radius in (10, 19, 28):
        box = (sub(cx, radius), sub(cy, radius), cx + radius, cy + radius)
        draw.arc(box, 225, 315, fill=color, width=5)
    draw.ellipse((sub(cx, 4), sub(cy, 4), cx + 4, cy + 4), fill=color)
    return image


class Tray:
    def __init__(self, events):
        self.events = events
        self.icon = None
        if not HAVE_TRAY:
            return
        menu = pystray.Menu(
            pystray.MenuItem("Open", lambda icon, item: self.send("show"), default=True),
            pystray.MenuItem("Pause or resume", lambda icon, item: self.send("toggle")),
            pystray.MenuItem(
                "Start with Windows",
                lambda icon, item: self.send("autostart"),
                checked=lambda item: autostart_enabled(),
            ),
            pystray.MenuItem("Exit", lambda icon, item: self.send("quit")),
        )
        self.icon = pystray.Icon(APP_NAME, tray_image(False), "Wifi Switcher", menu)

    def send(self, name):
        self.events.put(("cmd", name))

    def start(self):
        if self.icon:
            self.icon.run_detached()

    def set_state(self, running, text):
        if self.icon:
            try:
                self.icon.icon = tray_image(running)
                self.icon.title = text[:120]
            except Exception:
                pass

    def stop(self):
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass


# ---------------------------------------------------------------- GUI

class App:
    def __init__(self, root, start_hidden):
        self.root = root
        self.engine = None
        self.events = queue.Queue()
        self.last_net = None
        root.title("Wifi Switcher")
        root.geometry("640x460")

        frame = ttk.Frame(root, padding=12)
        frame.pack(fill="both", expand=True)

        profiles = list_profiles()
        saved = self.load()

        ttk.Label(frame, text="Network A (for example your 5G)").grid(row=0, column=0, sticky="w")
        self.combo_a = ttk.Combobox(frame, values=profiles, state="readonly", width=34)
        self.combo_a.grid(row=1, column=0, sticky="w", pady=(0, 8))

        ttk.Label(frame, text="Network B (for example your 2.4G)").grid(row=0, column=1, sticky="w", padx=(12, 0))
        self.combo_b = ttk.Combobox(frame, values=profiles, state="readonly", width=34)
        self.combo_b.grid(row=1, column=1, sticky="w", padx=(12, 0), pady=(0, 8))

        if saved.get("a") in profiles:
            self.combo_a.set(saved["a"])
        if saved.get("b") in profiles:
            self.combo_b.set(saved["b"])

        self.button = ttk.Button(frame, text="Start", command=self.toggle)
        self.button.grid(row=2, column=0, sticky="w", pady=4)

        self.state_label = ttk.Label(frame, text="Stopped")
        self.state_label.grid(row=2, column=1, sticky="w", padx=(12, 0))

        self.table = ttk.Treeview(frame, columns=("net", "signal", "result"), show="headings", height=3)
        self.table.heading("net", text="Network")
        self.table.heading("signal", text="Signal")
        self.table.heading("result", text="Last measurement")
        self.table.column("net", width=150)
        self.table.column("signal", width=60)
        self.table.column("result", width=380)
        self.table.grid(row=3, column=0, columnspan=2, sticky="ew", pady=8)

        self.log_box = tk.Text(frame, height=14, state="disabled", wrap="word")
        self.log_box.grid(row=4, column=0, columnspan=2, sticky="nsew")
        frame.rowconfigure(4, weight=1)
        frame.columnconfigure(1, weight=1)

        self.tray = Tray(self.events)
        self.tray.start()
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        both_saved = saved.get("a") in profiles and saved.get("b") in profiles
        if both_saved and (saved.get("running") or start_hidden):
            self.start_engine()
        if start_hidden and HAVE_TRAY:
            root.withdraw()

        self.pump()

    # settings

    def load(self):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf8") as f:
                return json.load(f)
        except Exception:
            return {}

    def save(self, running=None):
        data = self.load()
        data["a"] = self.combo_a.get()
        data["b"] = self.combo_b.get()
        if running is not None:
            data["running"] = running
        try:
            os.makedirs(SETTINGS_DIR, exist_ok=True)
            with open(SETTINGS_FILE, "w", encoding="utf8") as f:
                json.dump(data, f)
        except Exception:
            pass

    # actions

    def write_log(self, text):
        stamp = time.strftime("%H:%M:%S")
        self.log_box.configure(state="normal")
        self.log_box.insert("end", stamp + "  " + text + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def start_engine(self):
        a, b = self.combo_a.get(), self.combo_b.get()
        if not a or not b or a == b:
            self.write_log("Choose two different networks first.")
            self.show()
            return
        for item in self.table.get_children():
            self.table.delete(item)
        self.table.insert("", "end", iid=a, values=(a, "", "waiting"))
        self.table.insert("", "end", iid=b, values=(b, "", "waiting"))
        self.engine = Engine(a, b, self.events)
        self.engine.start()
        self.button.configure(text="Stop")
        self.state_label.configure(text="Running")
        self.tray.set_state(True, "Wifi Switcher: starting")
        self.save(running=True)

    def stop_engine(self):
        if self.engine:
            self.engine.stop_event.set()
            self.engine = None
        self.button.configure(text="Start")
        self.state_label.configure(text="Stopped")
        self.tray.set_state(False, "Wifi Switcher: paused")
        self.write_log("Stopped")
        self.save(running=False)

    def toggle(self):
        if self.engine:
            self.stop_engine()
        else:
            self.start_engine()

    def show(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def on_close(self):
        if HAVE_TRAY:
            self.root.withdraw()
        else:
            self.quit()

    def quit(self):
        if self.engine:
            self.engine.stop_event.set()
        self.tray.stop()
        self.root.destroy()

    def command(self, name):
        if name == "show":
            self.show()
        elif name == "toggle":
            self.toggle()
        elif name == "autostart":
            set_autostart(not autostart_enabled())
            if self.tray.icon:
                self.tray.icon.update_menu()
            self.write_log("Start with Windows: " + ("on" if autostart_enabled() else "off"))
        elif name == "quit":
            self.quit()

    def pump(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log":
                    self.write_log(event[1])
                elif event[0] == "cmd":
                    self.command(event[1])
                    if name_is_quit(event[1]):
                        return
                elif event[0] == "status":
                    _, net, m, signal, _active = event
                    if self.table.exists(net):
                        sig = "" if signal is None else "%d%%" % signal
                        self.table.item(net, values=(net, sig, describe(m)))
                    self.last_net = net
                    self.tray.set_state(True, "Wifi Switcher: on %s, %.1f Mbps" % (net, m["mbps"]))
        except queue.Empty:
            pass
        self.root.after(500, self.pump)


def name_is_quit(name):
    return name == "quit"


def single_instance():
    lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        lock.bind(("127.0.0.1", LOCK_PORT))
    except OSError:
        return None
    return lock


if __name__ == "__main__":
    lock = single_instance()
    if lock is None:
        sys.exit(0)
    hidden = "minimized" in sys.argv[1:]
    window = tk.Tk()
    App(window, hidden)
    window.mainloop()
