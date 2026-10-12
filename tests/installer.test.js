import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readlinkSync,
  cpSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const root = process.cwd();
const version = JSON.parse(readFileSync("package.json")).version;
const artifact = path.join(root, `dist/lan-baby-monitor-v${version}-termux.sh`);
const temp = () => mkdtempSync(path.join(os.tmpdir(), "babycam-install-"));
test("release artifact passes complete packaging validation and unsupported host is rejected", () => {
  execFileSync(process.execPath, ["scripts/verify.js"]);
  const result = spawnSync("bash", [artifact], {
    env: { ...process.env, PREFIX: "/tmp/not-termux" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Termux only/);
});
test(
  "simulated Termux: install, reinstallation, running-server upgrade, preservation and corruption rejection",
  { timeout: 30000 },
  async (t) => {
    const dir = temp();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const prefix = path.join(dir, "prefix");
    const home = path.join(dir, "home");
    const base = path.join(home, ".local/share/lan-baby-monitor");
    mkdirSync(prefix + "/bin", { recursive: true });
    mkdirSync(home);
    // Simulation changes only the environment gate and launcher interpreter, never application behavior.
    let content = readFileSync(artifact, "utf8").replace(
      'case "${PREFIX:-}" in /data/data/com.termux/files/usr|/data/user/0/com.termux/files/usr)',
      `case "\${PREFIX:-}" in ${prefix})`,
    );
    const installer = path.join(dir, "installer.sh");
    writeFileSync(installer, content);
    writeFileSync(prefix + "/bin/pkg", "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const env = {
      ...process.env,
      HOME: home,
      PREFIX: prefix,
      BABYCAM_HOME: base,
      PATH: prefix + "/bin:" + process.env.PATH,
    };
    const install = () =>
      spawnSync("bash", [installer], { env, encoding: "utf8", timeout: 15000 });
    let result = install();
    assert.equal(result.status, 0, result.stderr);
    const initial = readlinkSync(base + "/current");
    const custom = { port: 18876, lanIp: null };
    writeFileSync(base + "/config.json", JSON.stringify(custom));
    result = install();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readlinkSync(base + "/current"), initial);
    assert.deepEqual(JSON.parse(readFileSync(base + "/config.json")), custom);
    assert.equal(
      readdirSync(base + "/versions").filter((name) => !name.startsWith("."))
        .length,
      1,
    );
    const cli = (command) =>
      spawnSync(process.execPath, [base + "/current/src/cli.js", command], {
        env,
        encoding: "utf8",
        timeout: 15000,
      });
    assert.equal(cli("version").stdout.trim(), version);
    assert.equal(cli("start").status, 0);
    assert.equal(cli("status").status, 0);
    assert.equal(cli("stop").status, 0);
    // Build a distinct next-version payload and upgrade a running installation.
    const snapshot = path.join(dir, "snapshot");
    mkdirSync(snapshot);
    for (const name of [
      "src",
      "public",
      "docs",
      "scripts",
      "LICENSE",
      "README.md",
      "package.json",
      "package-lock.json",
    ])
      cpSync(path.join(root, name), path.join(snapshot, name), {
        recursive: true,
      });
    const nextVersion = "0.1.0-rc.2";
    const metadata = JSON.parse(
      readFileSync(path.join(snapshot, "package.json")),
    );
    metadata.version = nextVersion;
    writeFileSync(
      path.join(snapshot, "package.json"),
      JSON.stringify(metadata),
    );
    const nextLock = JSON.parse(
      readFileSync(path.join(snapshot, "package-lock.json")),
    );
    nextLock.version = nextVersion;
    nextLock.packages[""].version = nextVersion;
    writeFileSync(
      path.join(snapshot, "package-lock.json"),
      JSON.stringify(nextLock),
    );
    execFileSync(process.execPath, ["scripts/build.js"], { cwd: snapshot });
    content = readFileSync(
      path.join(snapshot, `dist/lan-baby-monitor-v${nextVersion}-termux.sh`),
      "utf8",
    ).replace(
      'case "${PREFIX:-}" in /data/data/com.termux/files/usr|/data/user/0/com.termux/files/usr)',
      `case "\${PREFIX:-}" in ${prefix})`,
    );
    writeFileSync(installer, content);
    assert.equal(cli("start").status, 0);
    result = install();
    assert.equal(result.status, 0, result.stderr);
    const upgraded = readlinkSync(base + "/current");
    assert.notEqual(upgraded, initial);
    assert.equal(cli("version").stdout.trim(), nextVersion);
    assert.equal(cli("status").status, 1);
    assert.deepEqual(JSON.parse(readFileSync(base + "/config.json")), custom);
    assert.equal(cli("start").status, 0);
    assert.equal(cli("stop").status, 0);
    content = content.replace(
      /PAYLOAD_SHA256='[a-f0-9]{64}'/,
      `PAYLOAD_SHA256='${"0".repeat(64)}'`,
    );
    writeFileSync(installer, content);
    result = install();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /checksum mismatch/);
    assert.equal(readlinkSync(base + "/current"), upgraded);
    assert.deepEqual(JSON.parse(readFileSync(base + "/config.json")), custom);
  },
);
test("dependency detection failure leaves no partial installation", (t) => {
  const dir = temp();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const header = readFileSync(artifact, "utf8").split(
    "__BABYCAM_PAYLOAD_BELOW__\n",
  )[0];
  const simulated = header
    .replace(
      'case "${PREFIX:-}" in /data/data/com.termux/files/usr|/data/user/0/com.termux/files/usr)',
      'case "${PREFIX:-}" in /simulation)',
    )
    .replace(
      "command -v node >/dev/null || missing+=(nodejs-lts)",
      "missing+=(nodejs-lts)",
    )
    .replace(
      "command -v pkg >/dev/null || fail",
      "command -v false >/dev/null || fail",
    )
    .replace('pkg install -y "${missing[@]}"', "false");
  const result = spawnSync("bash", [], {
    input: simulated,
    env: {
      ...process.env,
      PREFIX: "/simulation",
      BABYCAM_HOME: path.join(dir, "app"),
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pkg failed/);
  assert.equal(readdirSync(dir).length, 0);
});
