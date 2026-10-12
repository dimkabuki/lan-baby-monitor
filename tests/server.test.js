import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";

import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { createServer, managementAllowed } from "../src/server.js";
async function connect(base) {
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", {
    origin: base,
  });
  const queue = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    const at = waiters.findIndex((w) => w.type === m.type);
    if (at >= 0) {
      const w = waiters.splice(at, 1)[0];
      clearTimeout(w.timer);
      w.resolve(m);
    } else queue.push(m);
  });
  await once(ws, "open");
  return {
    ws,
    send: (value) => ws.send(JSON.stringify(value)),
    next(type) {
      const at = queue.findIndex((m) => m.type === type);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = {
          type,
          resolve,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(w), 1);
            reject(new Error(`Missing ${type}`));
          }, 4000),
        };
        waiters.push(w);
      });
    },
  };
}
test("HTTP, signaling, capacity, ownership, reconnection and malformed messages", async (t) => {
  const app = await createServer({ port: 0 });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;
  assert.equal((await fetch(base + "/camera")).status, 200);
  assert.equal((await fetch(base + "/monitor")).status, 200);
  assert.equal((await fetch(base + "/nonexistent")).status, 404);
  const c = await connect(base);
  c.send({ type: "register", role: "camera" });
  await c.next("registered");
  c.send({ type: "ready", ready: true });
  const a = await connect(base);
  a.send({ type: "register", role: "monitor" });
  const reg = await a.next("registered");
  a.send({ type: "request" });
  assert.equal((await c.next("join")).peer, reg.id);
  const generation = randomUUID();
  c.send({
    type: "signal",
    peer: reg.id,
    generation,
    description: { type: "offer", sdp: "test-offer" },
  });
  assert.equal((await a.next("signal")).description.sdp, "test-offer");
  a.send({
    type: "signal",
    peer: reg.id,
    generation,
    description: { type: "answer", sdp: "test-answer" },
  });
  assert.equal((await c.next("signal")).description.sdp, "test-answer");
  c.send({
    type: "signal",
    peer: reg.id,
    generation,
    candidate: { candidate: "candidate:test", sdpMid: "0", sdpMLineIndex: 0 },
  });
  assert.equal((await a.next("signal")).candidate.candidate, "candidate:test");
  const b = await connect(base);
  b.send({ type: "register", role: "monitor" });
  const rb = await b.next("registered");
  const third = await connect(base);
  third.send({ type: "register", role: "monitor" });
  assert.equal((await third.next("error")).code, "capacity");
  assert.equal(app.sessions.monitors.size, 2);
  assert.ok(app.sessions.monitors.has(rb.id));
  a.ws.close();
  await c.next("leave");
  assert.ok(app.sessions.monitors.has(rb.id));
  const again = await connect(base);
  again.send({ type: "register", role: "monitor" });
  await again.next("registered");
  again.send({
    type: "signal",
    peer: rb.id,
    generation,
    description: { type: "answer", sdp: "intrusion" },
  });
  assert.equal((await again.next("error")).code, "invalid");
  b.send({ type: "nonsense" });
  assert.equal((await b.next("error")).code, "invalid");
  c.ws.close();
});
test("loopback, Host, Origin and CSRF enforcement; forwarded headers ignored", async (t) => {
  const actions = [];
  const app = await createServer({
    port: 0,
    onLifecycle: (action) => actions.push(action),
  });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;
  const token = (await (await fetch(base + "/api/camera")).json()).csrf;
  assert.equal(
    (await fetch(base + "/api/stop", { method: "POST" })).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/stop", {
        method: "POST",
        headers: {
          Origin: "http://evil.example",
          "X-Babycam-CSRF": token,
          "Content-Type": "application/json",
        },
      })
    ).status,
    403,
  );
  const request = {
    socket: { remoteAddress: "192.168.1.4" },
    headers: {
      host: `127.0.0.1:${app.port}`,
      origin: base,
      "x-babycam-csrf": token,
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
  };
  assert.equal(
    managementAllowed(request, app.port, app.status().network, token),
    false,
  );
  let address = process.env.BABYCAM_TEST_LAN_IP;
  if (!address) {
    try {
      address = Object.values(os.networkInterfaces())
        .flat()
        .find((n) => !n.internal && n.family === "IPv4")?.address;
    } catch {
      t.diagnostic(
        "Physical LAN management rejection unavailable in this restricted environment; socket-address unit policy still checked.",
      );
    }
  }
  if (address) {
    const lan = `http://${address}:${app.port}`;
    assert.equal((await fetch(lan + "/camera")).status, 403);
    assert.equal((await fetch(lan + "/api/camera")).status, 403);
    assert.equal(
      (
        await fetch(lan + "/api/stop", {
          method: "POST",
          headers: {
            Origin: lan,
            "X-Babycam-CSRF": token,
            "Content-Type": "application/json",
            "X-Forwarded-For": "127.0.0.1",
          },
        })
      ).status,
      403,
    );
  }
  const r = await fetch(base + "/api/restart", {
    method: "POST",
    headers: {
      Origin: base,
      "X-Babycam-CSRF": token,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 202);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(actions, ["restart"]);
});
test("network status updates without internet services", async (t) => {
  let addresses = ["192.168.10.2"];
  const app = await createServer({
    port: 0,
    networkProvider: () => ({ addresses, available: addresses.length > 0 }),
  });
  t.after(() => app.close());
  assert.match(app.status().monitorUrl, /192.168.10.2/);
  addresses = [];
  await new Promise((r) => setTimeout(r, 5100));
  assert.equal(app.status().state, "DEGRADED");
  addresses = ["192.168.10.3"];
  await new Promise((r) => setTimeout(r, 5100));
  assert.match(app.status().monitorUrl, /192.168.10.3/);
});
