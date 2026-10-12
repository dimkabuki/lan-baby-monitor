import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Sessions, validateMessage } from "./session.js";
import { detectNetwork } from "./network.js";

export const version = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url)),
).version;
export const loopback = (ip) =>
  ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
export function allowedHost(host, port, network) {
  return new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
    ...network.addresses.map((a) => `${a}:${port}`),
  ]).has(host);
}
export function managementAllowed(req, port, network, token) {
  return (
    loopback(req.socket.remoteAddress) &&
    allowedHost(req.headers.host, port, network) &&
    req.headers.origin === `http://${req.headers.host}` &&
    req.headers["x-babycam-csrf"] === token &&
    req.headers["content-type"] === "application/json"
  );
}

export async function createServer({
  port = 8765,
  host = "0.0.0.0",
  onLifecycle = () => {},
  networkProvider = detectNetwork,
  instance = null,
} = {}) {
  const sessions = new Sessions();
  const started = Date.now();
  const csrf = randomBytes(32).toString("hex");
  let network = networkProvider();
  let stopping = false;
  let lastError = null;
  const clients = new Set();
  const files = new Map();
  for (const name of [
    "camera.html",
    "monitor.html",
    "style.css",
    "camera.js",
    "monitor.js",
    "common.js",
    "domain.js",
  ])
    files.set(
      name,
      await readFile(new URL(`../public/${name}`, import.meta.url)),
    );
  const status = () => ({
    state: stopping ? "STOPPED" : network.available ? "READY" : "DEGRADED",
    version,
    uptime: Math.round((Date.now() - started) / 1000),
    instance,
    network,
    monitorUrl: network.addresses[0]
      ? `http://${network.addresses[0]}:${port}/monitor`
      : null,
    ...sessions.status(),
    lastError,
  });
  const send = (client, value) => {
    if (client?.ws.readyState === WebSocket.OPEN)
      client.ws.send(JSON.stringify(value));
  };
  const broadcast = () => {
    const value = { type: "status", ...status() };
    for (const c of clients) if (c.role) send(c, value);
  };
  const json = (res, code, value) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws:; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (!allowedHost(req.headers.host, port, network))
      return json(res, 403, { error: "Unrecognized Host" });
    const path = req.url?.split("?")[0];
    if (req.method === "GET" && path === "/api/health")
      return json(res, 200, status());
    if (req.method === "GET" && path === "/api/camera") {
      if (!loopback(req.socket.remoteAddress))
        return json(res, 403, { error: "Loopback only" });
      return json(res, 200, { csrf });
    }
    if (req.method === "POST" && ["/api/restart", "/api/stop"].includes(path)) {
      if (!managementAllowed(req, port, network, csrf))
        return json(res, 403, {
          error: "Loopback same-origin request required",
        });
      if (stopping)
        return json(res, 409, { error: "Lifecycle operation already pending" });
      stopping = true;
      json(res, 202, {
        state: path === "/api/restart" ? "RECONNECTING" : "STOPPED",
      });
      res.on("finish", () => {
        broadcast();
        setTimeout(
          () => onLifecycle(path === "/api/restart" ? "restart" : "stop"),
          100,
        );
      });
      req.resume();
      return;
    }
    if (req.method !== "GET")
      return json(res, 405, { error: "Method not allowed" });
    if (path === "/") {
      res.writeHead(302, {
        location: loopback(req.socket.remoteAddress) ? "/camera" : "/monitor",
      });
      res.end();
      return;
    }
    if (path === "/camera" && !loopback(req.socket.remoteAddress))
      return json(res, 403, {
        error: "Open camera at http://127.0.0.1 on this phone",
      });
    const name =
      path === "/camera"
        ? "camera.html"
        : path === "/monitor"
          ? "monitor.html"
          : path?.slice(1);
    if (!files.has(name)) return json(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "content-type": name.endsWith(".html")
        ? "text/html; charset=utf-8"
        : name.endsWith(".css")
          ? "text/css"
          : "text/javascript",
    });
    res.end(files.get(name));
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      stopping ||
      req.url !== "/ws" ||
      clients.size >= 4 ||
      !allowedHost(req.headers.host, port, network) ||
      req.headers.origin !== `http://${req.headers.host}`
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws, req) => {
    const c = {
      ws,
      loopback: loopback(req.socket.remoteAddress),
      alive: true,
      lastActivity: Date.now(),
      rateStart: Date.now(),
      messages: 0,
    };
    clients.add(c);
    const deadline = setTimeout(() => {
      if (!c.role) ws.close(1008, "Registration timeout");
    }, 5000);
    ws.on("error", () => {
      lastError = "Signaling socket error";
    });
    ws.on("pong", () => {
      c.alive = true;
    });
    ws.on("message", (raw, binary) => {
      try {
        if (binary) throw new Error("Binary messages unsupported");
        if (Date.now() - c.rateStart >= 1000) {
          c.rateStart = Date.now();
          c.messages = 0;
        }
        if (++c.messages > 100) throw new Error("Rate limit");
        const m = validateMessage(JSON.parse(raw.toString()));
        c.lastActivity = Date.now();
        if (m.type === "register") {
          sessions.register(c, m.role);
          clearTimeout(deadline);
          send(c, { type: "registered", id: c.id, role: c.role });
          broadcast();
          return;
        }
        if (!c.role) throw new Error("Register first");
        if (m.type === "ping") {
          send(c, { type: "pong" });
          return;
        }
        if (m.type === "health") {
          c.health = m;
          return;
        }
        if (m.type === "ready") {
          if (c.role !== "camera") throw new Error("Camera only");
          c.ready = m.ready;
          for (const monitor of sessions.monitors.values()) {
            send(monitor, { type: "camera", ready: c.ready });
            if (c.ready) send(c, { type: "join", peer: monitor.id });
          }
          broadcast();
          return;
        }
        if (m.type === "request") {
          if (c.role !== "monitor") throw new Error("Monitor only");
          send(c, { type: "camera", ready: !!sessions.camera?.ready });
          if (sessions.camera?.ready)
            send(sessions.camera, { type: "join", peer: c.id });
          return;
        }
        if (m.type === "signal") {
          const destination =
            c.role === "camera"
              ? sessions.monitors.get(m.peer)
              : sessions.camera;
          if (
            !destination ||
            !sessions.camera?.ready ||
            (c.role === "monitor" && m.peer !== c.id)
          )
            throw new Error("Unknown peer");
          if (
            m.description?.type &&
            m.description.type !== (c.role === "camera" ? "offer" : "answer")
          )
            throw new Error("Invalid SDP direction");
          if (c.role === "camera" && m.description?.type === "offer")
            destination.generation = m.generation;
          const monitor = c.role === "camera" ? destination : c;
          if (monitor.generation !== m.generation) return; // obsolete ICE/answers
          send(destination, m);
          return;
        }
      } catch (e) {
        const capacity = e.message === "capacity";
        send(c, {
          type: "error",
          code: capacity ? "capacity" : "invalid",
          message: capacity
            ? "Two monitors are already connected. Close one and reconnect."
            : "Invalid signaling message",
        });
        ws.close(1008, capacity ? "capacity" : "Invalid message");
      }
    });
    ws.on("close", () => {
      clearTimeout(deadline);
      clients.delete(c);
      sessions.remove(c);
      if (c.role === "camera")
        for (const monitor of sessions.monitors.values())
          send(monitor, { type: "camera", ready: false });
      if (c.role === "monitor")
        send(sessions.camera, { type: "leave", peer: c.id });
      broadcast();
    });
  });
  const timer = setInterval(() => {
    network = networkProvider();
    for (const c of clients) {
      if (!c.alive) c.ws.terminate();
      else {
        c.alive = false;
        c.ws.ping();
      }
    }
    broadcast();
  }, 5000);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (e) {
    clearInterval(timer);
    wss.close();
    throw e;
  }
  port = server.address().port;
  return {
    server,
    wss,
    sessions,
    status,
    port,
    csrf,
    async close() {
      clearInterval(timer);
      stopping = true;
      for (const c of clients) c.ws.terminate();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      });
    },
  };
}

export const serverPath = fileURLToPath(import.meta.url);
