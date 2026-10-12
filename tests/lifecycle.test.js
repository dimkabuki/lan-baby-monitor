import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
test(
  "background start, duplicate start, browser restart/stop and intentional stop stays stopped",
  { timeout: 30000 },
  async (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "babycam-lifecycle-"));
    const port = await freePort();
    const env = {
      ...process.env,
      BABYCAM_HOME: home,
      BABYCAM_PORT: String(port),
    };
    const cli = (command) =>
      spawnSync(process.execPath, ["src/cli.js", command], {
        env,
        encoding: "utf8",
        timeout: 15000,
      });
    t.after(() => {
      cli("stop");
      rmSync(home, { recursive: true, force: true });
    });
    const start = cli("start");
    assert.equal(start.status, 0, start.stderr);
    const lock = JSON.parse(readFileSync(path.join(home, "run.lock")));
    assert.equal(cli("start").status, 0);
    assert.equal(
      JSON.parse(readFileSync(path.join(home, "run.lock"))).pid,
      lock.pid,
    );
    const base = `http://127.0.0.1:${port}`;
    const worker = JSON.parse(readFileSync(path.join(home, "run.lock"))).worker;
    assert.ok(worker > 0);
    process.kill(worker, "SIGKILL");
    let recovered = false;
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      try {
        const h = await (
          await fetch(base + "/api/health", {
            signal: AbortSignal.timeout(300),
          })
        ).json();
        if (
          h.instance === lock.instance &&
          JSON.parse(readFileSync(path.join(home, "run.lock"))).worker !==
            worker
        ) {
          recovered = true;
          break;
        }
      } catch {
        /* Worker is restarting. */
      }
    }
    assert.equal(recovered, true, "Supervisor must restart a crashed worker");
    let before = await (await fetch(base + "/api/health")).json();
    const command = async (action) => {
      const token = (await (await fetch(base + "/api/camera")).json()).csrf;
      return fetch(base + "/api/" + action, {
        method: "POST",
        headers: {
          Origin: base,
          "Content-Type": "application/json",
          "X-Babycam-CSRF": token,
        },
        body: "{}",
      });
    };
    assert.equal((await command("restart")).status, 202);
    await sleep(1200);
    const after = await (await fetch(base + "/api/health")).json();
    assert.equal(after.instance, before.instance);
    assert.ok(after.uptime <= before.uptime + 1);
    assert.equal((await command("stop")).status, 202);
    await sleep(1200);
    assert.equal(cli("status").status, 1);
    await sleep(1500);
    assert.equal(cli("status").status, 1);
    assert.equal(cli("start").status, 0);
    assert.equal(cli("restart").status, 0);
    assert.equal(cli("doctor").status, 0);
    assert.equal(cli("stop").status, 0);
  },
);
test(
  "stale PID does not kill or trust another process; port conflict and invalid config fail clearly",
  { timeout: 20000 },
  async (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "babycam-conflict-"));
    const port = await freePort();
    const env = {
      ...process.env,
      BABYCAM_HOME: home,
      BABYCAM_PORT: String(port),
    };
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
    });
    await new Promise((r) => server.listen(port, "0.0.0.0", r));
    t.after(
      () =>
        new Promise((r) => {
          for (const socket of sockets) socket.destroy();
          server.close(r);
        }),
    );
    // Synchronous CLI would block this fake server's JS response, so use child async here.
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["src/cli.js", "start"], { env });
    let output = "";
    child.stderr.on("data", (data) => {
      output += data;
    });
    const exit = await new Promise((r) => child.on("exit", r));
    assert.equal(exit, 1);
    assert.match(output, /Startup failed/);
    const bad = spawnSync(process.execPath, ["src/cli.js", "start"], {
      env: { ...env, BABYCAM_PORT: "NaN" },
      encoding: "utf8",
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Port must/);
  },
);
