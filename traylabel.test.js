const assert = require("assert");
const { trayLabel } = require("./traylabel");

assert.strictEqual(trayLabel("Casa-5G", ["Casa-2.4G", "Casa-5G"]), "5G");
assert.strictEqual(trayLabel("Casa-2.4G", ["Casa-2.4G", "Casa-5G"]), "2.4G");
assert.strictEqual(trayLabel("Home 5GHz", ["Home 2,4 GHz", "Home 5GHz"]), "5G");
assert.strictEqual(trayLabel("Home 2,4 GHz", ["Home 2,4 GHz", "Home 5GHz"]), "2.4G");
assert.strictEqual(trayLabel("Vivo-5g", ["Vivo", "Vivo-5g"]), "5G");
// only one name says the band: the other network gets the opposite band
assert.strictEqual(trayLabel("Vivo", ["Vivo", "Vivo-5g"]), "2.4G");
assert.strictEqual(trayLabel("Vivo-5g", ["Vivo", "Vivo-5g"]), "5G");
assert.strictEqual(trayLabel("Casa", ["Casa 2.4", "Casa"]), "5G");
assert.strictEqual(trayLabel("Casa 2.4", ["Casa 2.4", "Casa"]), "2.4G");
assert.strictEqual(trayLabel("Alpha", ["Alpha", "Beta"]), "A");
assert.strictEqual(trayLabel("Beta", ["Alpha", "Beta"]), "B");
// both names say 5G: fall back to A and B
assert.strictEqual(trayLabel("Home5G", ["Home5G", "Office5G"]), "A");
assert.strictEqual(trayLabel("Office5G", ["Home5G", "Office5G"]), "B");
// unknown or missing
assert.strictEqual(trayLabel(null, ["a", "b"]), "");
assert.strictEqual(trayLabel("zzz", ["a", "b"]), "");
assert.strictEqual(trayLabel("a", null), "");
console.log("traylabel tests passed");
