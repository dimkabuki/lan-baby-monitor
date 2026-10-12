import { randomUUID } from "node:crypto";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validateMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  const { type } = value;
  const allowed = {
    register: ["type", "role"],
    ping: ["type"],
    ready: ["type", "ready"],
    request: ["type"],
    signal: ["type", "peer", "generation", "description", "candidate"],
    health: ["type", "state", "video", "audio", "lastMedia", "error"],
  }[type];
  if (!allowed || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Invalid message fields");
  if (type === "register" && !["camera", "monitor"].includes(value.role))
    throw new Error("Invalid role");
  if (type === "ready" && typeof value.ready !== "boolean")
    throw new Error("Invalid readiness");
  if (type === "signal") {
    if (!ID.test(value.peer) || !ID.test(value.generation))
      throw new Error("Invalid session identifier");
    if ("description" in value === "candidate" in value)
      throw new Error("Expected one signaling payload");
    if ("description" in value) {
      const d = value.description;
      if (
        !d ||
        !["offer", "answer"].includes(d.type) ||
        typeof d.sdp !== "string" ||
        d.sdp.length > 60000 ||
        Object.keys(d).some((k) => !["type", "sdp"].includes(k))
      )
        throw new Error("Invalid SDP");
    } else {
      const c = value.candidate;
      if (
        c !== null &&
        (!c ||
          typeof c !== "object" ||
          Array.isArray(c) ||
          typeof c.candidate !== "string" ||
          c.candidate.length > 2048 ||
          Object.keys(c).some(
            (k) =>
              ![
                "candidate",
                "sdpMid",
                "sdpMLineIndex",
                "usernameFragment",
              ].includes(k),
          ) ||
          (c.sdpMid != null && typeof c.sdpMid !== "string") ||
          (c.sdpMLineIndex != null &&
            (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0)) ||
          (c.usernameFragment != null &&
            typeof c.usernameFragment !== "string"))
      )
        throw new Error("Invalid ICE");
    }
  }
  if (type === "health") {
    if (
      ![
        "STOPPED",
        "STARTING",
        "READY",
        "CONNECTING",
        "STREAMING",
        "DEGRADED",
        "RECONNECTING",
        "FAILED",
      ].includes(value.state)
    )
      throw new Error("Invalid state");
    for (const key of ["video", "audio"])
      if (
        value[key] != null &&
        !["live", "waiting", "stale", "ended", "unavailable"].includes(
          value[key],
        )
      )
        throw new Error("Invalid media health");
    if (
      value.lastMedia != null &&
      (!Number.isFinite(value.lastMedia) || value.lastMedia < 0)
    )
      throw new Error("Invalid media timestamp");
    if (
      value.error != null &&
      (typeof value.error !== "string" || value.error.length > 200)
    )
      throw new Error("Invalid error");
  }
  return value;
}

export class Sessions {
  constructor() {
    this.camera = null;
    this.monitors = new Map();
  }
  register(client, role) {
    if (client.role) throw new Error("Already registered");
    if (role === "camera" && !client.loopback)
      throw new Error("Camera requires loopback");
    if (role === "camera" && this.camera)
      throw new Error("Camera already connected");
    if (role === "monitor" && this.monitors.size >= 2)
      throw new Error("capacity");
    client.role = role;
    client.id = randomUUID();
    client.ready = false;
    if (role === "camera") this.camera = client;
    else this.monitors.set(client.id, client);
    return client.id;
  }
  remove(client) {
    if (this.camera === client) this.camera = null;
    else this.monitors.delete(client.id);
  }
  status() {
    return {
      camera: !!this.camera,
      capture: !!this.camera?.ready,
      cameraMedia: this.camera
        ? {
            state: this.camera.health?.state ?? "STOPPED",
            video: this.camera.health?.video ?? "waiting",
            audio: this.camera.health?.audio ?? "waiting",
            lastMedia: this.camera.health?.lastMedia ?? null,
            lastSignaling: this.camera.lastActivity ?? null,
          }
        : null,
      monitors: [...this.monitors.values()].map((m) => ({
        id: m.id,
        state: m.health?.state ?? "CONNECTING",
        video: m.health?.video ?? "waiting",
        audio: m.health?.audio ?? "waiting",
        lastMedia: m.health?.lastMedia ?? null,
        lastSignaling: m.lastActivity ?? null,
        error: m.health?.error ?? null,
      })),
    };
  }
}
