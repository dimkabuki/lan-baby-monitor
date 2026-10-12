#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  openSync,
  closeSync,
  renameSync,
  existsSync,
  statSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { home, loadConfig } from "./config.js";
import { detectNetwork } from "./network.js";
import { repository, selectRelease, verifyDownload } from "./release.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(import.meta.url);
const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const lock = path.join(home, "run.lock");
const log = path.join(home, "server.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readLock() {
  try {
    return JSON.parse(readFileSync(lock, "utf8"));
  } catch {
    return null;
  }
}
function alive(record) {
  if (!record || !Number.isInteger(record.pid) || record.pid < 2) return false;
  try {
    process.kill(record.pid, 0);
    const args = readFileSync(`/proc/${record.pid}/cmdline`, "utf8").split(
      "\0",
    );
    return (
      args.includes("--supervise") &&
      args.includes(record.cli) &&
      record.home === home
    );
  } catch {
    return false;
  }
}
function rotate() {
  if (existsSync(log) && statSync(log).size > 1048576) {
    rmSync(log + ".1", { force: true });
    renameSync(log, log + ".1");
  }
}
function wake(action) {
  spawnSync(action === "lock" ? "termux-wake-lock" : "termux-wake-unlock", [], {
    stdio: "ignore",
    timeout: 5000,
  });
}
async function health(config, record) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const data = await response.json();
    return data.instance === record?.instance ? data : null;
  } catch {
    return null;
  }
}
async function stop() {
  const record = readLock();
  const owned = record
    ? await health({ port: record.port ?? loadConfig().port }, record)
    : null;
  if (owned) {
    const base = `http://127.0.0.1:${record.port ?? loadConfig().port}`;
    const token = (
      await (
        await fetch(base + "/api/camera", { signal: AbortSignal.timeout(1500) })
      ).json()
    ).csrf;
    const response = await fetch(base + "/api/stop", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Babycam-CSRF": token,
      },
      body: "{}",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw new Error("Server stop rejected");
    for (let i = 0; i < 60; i++) {
      if (readLock()?.instance !== record.instance) {
        console.log("Server stopped");
        return;
      }
      await sleep(100);
    }
    throw new Error("Server stop timed out");
  }
  if (!alive(record)) {
    rmSync(lock, { force: true });
    console.log("Server stopped");
    return;
  }
  process.kill(record.pid, "SIGTERM");
  for (let i = 0; i < 60 && alive(record); i++) await sleep(100);
  if (alive(record))
    throw new Error(
      "Server did not stop; inspect server.log. No unrelated process was killed.",
    );
  console.log("Server stopped");
}
async function start(config) {
  const current = readLock();
  const currentHealth = current
    ? await health({ port: current.port ?? config.port }, current)
    : null;
  if (currentHealth || alive(current)) {
    const h = currentHealth;
    if (!h)
      throw new Error(
        "Supervisor is running but HTTP is unavailable. Run babycam doctor.",
      );
    console.log("Server already running");
    printStatus(config, h);
    return;
  }
  if (current && Date.now() - current.created < 15000)
    throw new Error("Another startup is in progress. Retry in a few seconds.");
  rmSync(lock, { force: true });
  const instance = randomUUID();
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(
    fd,
    JSON.stringify({
      pid: process.pid,
      cli,
      home,
      instance,
      created: Date.now(),
      port: config.port,
    }),
  );
  closeSync(fd);
  rotate();
  const logFd = openSync(log, "a", 0o600);
  const child = spawn(process.execPath, [cli, "--supervise", instance], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      BABYCAM_HOME: home,
      BABYCAM_PORT: String(config.port),
      BABYCAM_LAN_IP: config.lanIp ?? "",
    },
  });
  closeSync(logFd);
  child.unref();
  for (let i = 0; i < 100; i++) {
    const record = readLock();
    const h = await health(config, record);
    if (h && record?.instance === instance) {
      console.log("Server started in background");
      printStatus(config, h);
      return;
    }
    if (i > 5 && !alive(record)) break;
    await sleep(100);
  }
  if (child.exitCode === null) child.kill("SIGTERM");
  throw new Error(
    `Startup failed. Check ${log} (possible port conflict or runtime failure).`,
  );
}
function printStatus(config, h) {
  console.log(
    `Server: ${h?.state ?? "STOPPED"} · version ${version}\nCamera: http://127.0.0.1:${config.port}/camera\nMonitor: ${h?.monitorUrl ?? "LAN address unavailable; check Wi-Fi settings and set lanIp in config.json"}\nNetwork: ${h?.network.available ? "LAN address detected (reachability not guaranteed)" : "Unavailable or restricted"}`,
  );
}
async function supervise(config, instance) {
  const record = readLock();
  if (record?.instance !== instance)
    throw new Error("Startup lock does not match");
  writeFileSync(
    lock,
    JSON.stringify({ ...record, pid: process.pid, cli, home }),
    { mode: 0o600 },
  );
  wake("lock");
  let child = null;
  let stopping = false;
  let crashes = 0;
  let retry = null;
  let force = null;
  function finish() {
    clearTimeout(retry);
    clearTimeout(force);
    if (readLock()?.instance === instance) rmSync(lock, { force: true });
    wake("unlock");
    process.exit(0);
  }
  function shutdown() {
    if (stopping) return;
    stopping = true;
    clearTimeout(retry);
    if (child) {
      child.kill("SIGTERM");
      force = setTimeout(() => child?.kill("SIGKILL"), 4000);
    } else finish();
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  function launch() {
    rotate();
    const fd = openSync(log, "a", 0o600);
    const began = Date.now();
    child = spawn(process.execPath, [path.join(root, "src/worker.js")], {
      stdio: ["ignore", fd, fd],
      env: {
        ...process.env,
        BABYCAM_INSTANCE: instance,
        BABYCAM_PORT: String(config.port),
        BABYCAM_LAN_IP: config.lanIp ?? "",
      },
    });
    closeSync(fd);
    const record = readLock();
    if (record?.instance === instance)
      writeFileSync(lock, JSON.stringify({ ...record, worker: child.pid }), {
        mode: 0o600,
      });
    child.on("error", (e) => {
      console.error(`Worker spawn failed: ${e.code}`);
    });
    child.on("exit", (code) => {
      child = null;
      if (stopping || code === 0) {
        finish();
        return;
      }
      if (Date.now() - began > 60000) crashes = 0;
      if (code !== 75 && ++crashes > 5) {
        console.error("Repeated server failures. Run babycam doctor.");
        finish();
        return;
      }
      retry = setTimeout(
        launch,
        code === 75 ? 300 : Math.min(15000, 500 * 2 ** crashes),
      );
    });
  }
  launch();
}
async function update() {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases?per_page=20`,
    {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/vnd.github+json" },
    },
  );
  if (!response.ok)
    throw new Error(`Release lookup failed (${response.status})`);
  const release = selectRelease(await response.json(), version);
  if (!release) {
    console.log(`Already current (${version})`);
    return;
  }
  const { version: next, name, installer, checksums } = release;
  const stage = path.join(home, `update-${randomUUID()}`);
  mkdirSync(stage, { mode: 0o700 });
  try {
    const sumsResponse = await fetch(checksums.browser_download_url, {
      signal: AbortSignal.timeout(20000),
    });
    if (!sumsResponse.ok) throw new Error("Checksum download failed");
    const sums = await sumsResponse.text();
    const downloaded = await fetch(installer.browser_download_url, {
      signal: AbortSignal.timeout(30000),
    });
    if (!downloaded.ok) throw new Error("Installer download failed");
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    verifyDownload(bytes, sums, name);
    const filename = path.join(stage, name);
    writeFileSync(filename, bytes, { mode: 0o600 });
    console.log(
      `Installing requested update ${version} → ${next}. The server will stop; restart it manually after installation.`,
    );
    const result = spawnSync("bash", [filename], {
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0)
      throw new Error(
        "Update failed; previous installation retained where possible",
      );
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
try {
  const command = process.argv[2] ?? "help";
  if (command === "version") console.log(version);
  else {
    const config = loadConfig();
    if (command === "--supervise") await supervise(config, process.argv[3]);
    else if (command === "start") await start(config);
    else if (command === "stop") await stop();
    else if (command === "restart") {
      await stop();
      await start(config);
    } else if (command === "status") {
      const record = readLock();
      const h = record ? await health(config, record) : null;
      printStatus(config, h);
      if (!h) process.exitCode = 1;
    } else if (command === "doctor") {
      const record = readLock();
      const h = record ? await health(config, record) : null;
      console.log(
        `Termux: ${process.env.PREFIX?.startsWith("/data/data/com.termux/") || process.env.PREFIX?.startsWith("/data/user/0/com.termux/") ? "detected" : "not detected (development only)"}\nNode: ${process.version}\nApplication: ${version}\nConfiguration: valid (${config.port})\nSupervisor: ${h || alive(record) ? "running" : "stopped"}\nHTTP/listening port: ${h ? "reachable and owned" : "not reachable or not owned"}\nNetwork: ${JSON.stringify(detectNetwork())}\nLog: ${log}\nConfig: ${path.join(home, "config.json")}`,
      );
      try {
        await import("ws");
        console.log("Dependency ws: installed");
      } catch {
        throw new Error("ws missing: reinstall the release artifact");
      }
      if (!h)
        console.log(
          "Action: run babycam start; inspect server.log for port conflicts.",
        );
    } else if (command === "update") await update();
    else if (command === "uninstall") {
      if (!process.argv.includes("--yes"))
        throw new Error(
          "Run babycam uninstall --yes to remove application files. Configuration and logs remain.",
        );
      if (
        path.resolve(home, "current") !== root &&
        !root.startsWith(path.join(home, "versions") + path.sep)
      )
        throw new Error("Uninstall is available only for an installed release");
      await stop();
      rmSync(path.join(home, "current"), { force: true });
      rmSync(path.join(home, "versions"), { recursive: true, force: true });
      const launcher = path.join(process.env.PREFIX ?? "", "bin/babycam");
      if (
        existsSync(launcher) &&
        readFileSync(launcher, "utf8").includes("LAN_BABY_MONITOR_LAUNCHER")
      )
        rmSync(launcher);
      console.log("Application removed. Configuration and logs preserved.");
    } else
      console.log(
        "Usage: babycam start|stop|restart|status|doctor|update|version|uninstall --yes",
      );
  }
} catch (e) {
  console.error(`babycam: ${e.message}`);
  process.exitCode = 1;
}
