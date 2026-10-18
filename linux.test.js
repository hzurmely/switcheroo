// Linux pieces that need no Linux: nmcli output parsing and the ps program list.
const assert = require("assert");
const { terse, parseProfiles, parseDevices, parseLink } = require("./netlinux");
const { parsePs, matchGame } = require("./games");

assert.deepStrictEqual(terse("a\\:b:c\\\\d:"), ["a:b", "c\\d", ""], "escaped colons and backslashes");

const conns = "Home_5G:802-11-wireless\nHome_2G:802-11-wireless\nWired connection 1:802-3-ethernet\nlo:loopback\nCafe\\: Free:802-11-wireless\nHome_5G:802-11-wireless\n";
assert.deepStrictEqual(parseProfiles(conns), ["Home_5G", "Home_2G", "Cafe: Free"], "only Wi-Fi connections, no duplicates");

assert.deepStrictEqual(parseDevices("eth0:ethernet:connected:Wired connection 1\nwlp2s0:wifi:connected:Home_5G\nlo:loopback:unmanaged:\n"), { iface: "wlp2s0", connected: true, name: "Home_5G" });
assert.deepStrictEqual(parseDevices("wlan0:wifi:disconnected:\n"), { iface: "wlan0", connected: false, name: null });
assert.strictEqual(parseDevices("eth0:ethernet:connected:x\n"), null, "no Wi-Fi adapter");

const list = " :Other:1:2412 MHz:130 Mbit/s:40\n*:Home_5G:36:5180 MHz:540 Mbit/s:78\n :Home_2G:6:2437 MHz:130 Mbit/s:90\n";
assert.deepStrictEqual(parseLink(list), { signal: 78, channel: 36, radio: null, band: "5 GHz", rx: 540, tx: 540 });
assert.strictEqual(parseLink(" :Other:1:2412 MHz:130 Mbit/s:40\n").signal, null, "not connected to any listed network");
assert.strictEqual(parseLink("*:X:1:2412 MHz:72 Mbit/s:55\n").band, "2.4 GHz");

const ps = [
  "systemd /sbin/init splash",
  "bash -bash",
  "cs2 /home/u/.steam/steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2 -dedicated",
  "VALORANT-Win64- Z:\\home\\u\\Games\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe -x",
  "firefox /usr/lib/firefox/firefox",
].join("\n");
const procs = parsePs(ps);
assert(procs.some((p) => p.name === "VALORANT-Win64-Shipping"), "Wine program takes its name from the .exe");
assert.strictEqual(matchGame(procs), "cs2", "native game found through its Steam path");
assert.strictEqual(matchGame(parsePs("firefox /usr/lib/firefox/firefox\nbash -bash")), null, "no false positive");
console.log("linux ok");
