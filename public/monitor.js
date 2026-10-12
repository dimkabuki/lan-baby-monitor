import {
  $,
  text,
  fullscreen,
  Signaling,
  createPeer,
  sendDescription,
  receiveSignal,
  dispose,
  safePreferences,
  savePreferences,
  Alerts,
} from "./common.js";
import { backoff, mediaHealth, motionScore, motionStep } from "./domain.js";
const video = $("video");
const alerts = new Alerts();
const canvas = document.createElement("canvas");
canvas.width = 96;
canvas.height = 72;
const context = canvas.getContext("2d", { willReadFrequently: true });
let signaling;
let item = null;
let retry = null;
let attempt = 0;
let registered = false;
let cameraReady = false;
let state = "CONNECTING";
let health = {};
let previousFrame = null;
let motion = null;
let healthBusy = false;
let notificationTimer = null;
const prefs = safePreferences();
for (const id of ["motion", "notification", "sound"])
  if (typeof prefs[id] === "boolean") $(id).checked = prefs[id];
for (const id of ["sensitivity", "volume"])
  if (Number.isFinite(prefs[id]))
    $(id).value = String(
      Math.max(id === "sensitivity" ? 1 : 0, Math.min(100, prefs[id])),
    );
function preferences() {
  const value = {
    motion: $("motion").checked,
    notification: $("notification").checked,
    sound: $("sound").checked,
    sensitivity: Number($("sensitivity").value),
    volume: Number($("volume").value),
  };
  video.volume = value.volume / 100;
  text("sensitivityValue", value.sensitivity);
  return value;
}
for (const id of ["motion", "notification", "sound", "sensitivity", "volume"])
  $(id).oninput = () => {
    savePreferences(preferences());
    previousFrame = null;
    motion = null;
  };
preferences();
function showState(next, message = "") {
  const before = state;
  state = next;
  const label =
    {
      CONNECTING: "Connecting",
      STREAMING: "Live",
      DEGRADED: "Connection degraded",
      RECONNECTING: "Reconnecting",
      STOPPED: "Camera offline",
      FAILED: "Server unreachable",
      READY: "Waiting for camera",
    }[next] ?? next;
  text("connection", label);
  $("connection").dataset.state = next;
  if (message) text("error", message);
  if (next !== "STREAMING" && next !== "DEGRADED") {
    $("placeholder").hidden = false;
    text("placeholder", message || label);
  }
  if (
    ["DEGRADED", "FAILED", "RECONNECTING", "STOPPED"].includes(next) &&
    before !== next
  )
    alerts.beep(true);
}
function clearPeer() {
  dispose(item);
  item = null;
  video.srcObject = null;
  health = {};
  previousFrame = null;
  motion = null;
  $("placeholder").hidden = false;
  text("videoHealth", "Unavailable");
  text("audioHealth", "Unavailable");
}
function request() {
  clearTimeout(retry);
  retry = null;
  if (!registered || !cameraReady) return;
  clearPeer();
  showState("CONNECTING");
  signaling.send({ type: "request" });
  // Negotiation timeout also covers missing offers and abandoned browser operations.
  retry = setTimeout(() => recover("Media connection timed out"), 20000);
}
function recover(message) {
  if (retry && state === "RECONNECTING") return;
  clearTimeout(retry);
  clearPeer();
  showState("RECONNECTING", message);
  if (registered && cameraReady)
    retry = setTimeout(request, backoff(attempt++));
}
signaling = new Signaling(
  "monitor",
  async (m) => {
    if (m.type === "registered") {
      registered = true;
      signaling.send({ type: "request" });
    }
    if (m.type === "camera") {
      cameraReady = m.ready;
      if (!m.ready) {
        clearTimeout(retry);
        retry = null;
        clearPeer();
        showState(
          "STOPPED",
          "Camera offline. Start or restart capture on the camera phone.",
        );
      } else if (!item && !retry) {
        showState("CONNECTING");
        retry = setTimeout(() => recover("Waiting for camera offer"), 20000);
      }
    }
    if (m.type === "status") {
      cameraReady = m.capture;
      text(
        "diagnostics",
        JSON.stringify(
          {
            server: m,
            media: health,
            transport: item?.pc.connectionState ?? "closed",
          },
          null,
          2,
        ),
      );
      if (!m.camera || !m.capture) {
        clearTimeout(retry);
        retry = null;
        clearPeer();
        showState(
          "STOPPED",
          "Camera offline. Start capture on the camera phone.",
        );
      }
    }
    if (m.type === "error") {
      clearTimeout(retry);
      retry = null;
      clearPeer();
      showState("FAILED", m.message);
    }
    if (m.type === "signal") {
      if (m.description?.type === "offer") {
        clearPeer();
        clearTimeout(retry);
        retry = setTimeout(() => recover("Negotiation timed out"), 20000);
        const current = createPeer(
          (value) => signaling.send(value),
          signaling.id,
          m.generation,
        );
        item = current;
        current.pc.ontrack = (event) => {
          if (item !== current) return;
          const media = video.srcObject ?? new MediaStream();
          if (!media.getTracks().some((t) => t.id === event.track.id))
            media.addTrack(event.track);
          video.srcObject = media;
          event.track.onended = () => {
            if (item === current) recover(`${event.track.kind} track ended`);
          };
          video.play().catch(() => {
            text("playback", "Tap Enable Audio & Alerts to start playback");
          });
        };
        current.pc.onconnectionstatechange = () => {
          if (item !== current) return;
          if (["failed", "disconnected"].includes(current.pc.connectionState))
            recover("WebRTC transport interrupted");
        };
        await receiveSignal(current, m);
        await current.pc.setLocalDescription(await current.pc.createAnswer());
        sendDescription(
          current,
          (value) => signaling.send(value),
          signaling.id,
        );
      } else await receiveSignal(item, m);
    }
  },
  (next, error) => {
    if (next === "READY") return;
    if (["RECONNECTING", "FAILED"].includes(next)) {
      registered = false;
      cameraReady = false;
      clearTimeout(retry);
      retry = null;
      clearPeer();
      showState(
        next,
        error || "Server unreachable. Waiting for local connection.",
      );
    } else showState(next);
    if (error && next !== "FAILED") recover(error);
  },
);
setInterval(async () => {
  if (!item || healthBusy) return;
  healthBusy = true;
  const current = item;
  try {
    const stats = await current.pc.getStats();
    if (item !== current) return;
    const counts = { video: { frames: 0, packets: 0 }, audio: { packets: 0 } };
    for (const s of stats.values())
      if (s.type === "inbound-rtp" && !s.isRemote) {
        const kind = s.kind ?? s.mediaType;
        if (counts[kind]) {
          counts[kind].packets += s.packetsReceived ?? 0;
          if (kind === "video") counts.video.frames += s.framesDecoded ?? 0;
        }
      }
    const now = Date.now();
    for (const kind of ["video", "audio"]) {
      const track = video.srcObject?.getTracks().find((t) => t.kind === kind);
      counts[kind].ended = track?.readyState === "ended";
      health[kind] = mediaHealth(
        health[kind],
        counts[kind],
        now,
        current.created,
        kind,
      );
      text(
        `${kind}Health`,
        health[kind].state === "live"
          ? kind === "audio"
            ? "Receiving audio packets (silence is normal)"
            : "Receiving decoded frames"
          : health[kind].state === "stale"
            ? kind === "video"
              ? "No new decoded frames — frozen or unavailable"
              : "No incoming audio packets"
            : health[kind].state,
      );
    }
    const videoLive = health.video.state === "live";
    const audioLive = health.audio.state === "live";
    $("placeholder").hidden = videoLive;
    if (!videoLive)
      text(
        "placeholder",
        "Video unavailable — waiting for fresh decoded frames",
      );
    if (videoLive && audioLive) {
      clearTimeout(retry);
      retry = null;
      attempt = 0;
      showState("STREAMING");
      text("error", "");
    } else if (
      ["stale", "ended"].includes(health.video.state) ||
      ["stale", "ended"].includes(health.audio.state)
    ) {
      showState("DEGRADED", "Media stopped progressing. Reconnecting.");
      recover("Media unavailable. Reconnecting.");
      return;
    }
    text(
      "lastMedia",
      [health.video, health.audio].some((h) => h.confirmed)
        ? new Date(
            Math.max(
              health.video.confirmed ? health.video.last : 0,
              health.audio.confirmed ? health.audio.last : 0,
            ),
          ).toLocaleTimeString()
        : "Not yet confirmed",
    );
    signaling.send({
      type: "health",
      state,
      video: health.video?.state ?? "unavailable",
      audio: health.audio?.state ?? "unavailable",
      lastMedia: Math.max(health.video?.last ?? 0, health.audio?.last ?? 0),
    });
  } catch {
    if (item === current) recover("Media statistics unavailable");
  } finally {
    healthBusy = false;
  }
}, 2000);
setInterval(() => {
  const p = preferences();
  if (
    !p.motion ||
    state !== "STREAMING" ||
    video.readyState < 2 ||
    document.visibilityState !== "visible"
  ) {
    previousFrame = null;
    motion = null;
    return;
  }
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const frame = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < frame.length; i++)
      frame[i] = (rgba[i * 4] * 3 + rgba[i * 4 + 1] * 6 + rgba[i * 4 + 2]) / 10;
    motion = motionStep(
      motion,
      motionScore(previousFrame, frame, p.sensitivity),
      p.sensitivity,
      Date.now(),
    );
    previousFrame = frame;
    if (motion.active) text("lastMotion", new Date().toLocaleTimeString());
    if (motion.alert) {
      if (p.notification) {
        $("motionEvent").hidden = false;
        clearTimeout(notificationTimer);
        notificationTimer = setTimeout(() => {
          $("motionEvent").hidden = true;
        }, 3000);
      }
      if (p.sound) alerts.beep();
    }
  } catch {
    text("error", "Motion analysis unavailable in this browser");
  }
}, 250);
$("enable").onclick = async () => {
  try {
    // Both calls originate in the click; audio activation also works before tracks arrive.
    const enable = alerts.enable();
    video.muted = false;
    const play = video.srcObject ? video.play() : Promise.resolve();
    await Promise.all([enable, play]);
    text("playback", "Audio enabled · alerts enabled");
    $("enable").textContent = "Audio & Alerts Enabled";
  } catch (e) {
    text("playback", e.message);
  }
};
$("testAlert").onclick = () => {
  if (!alerts.beep()) text("error", "Tap Enable Audio & Alerts first");
};
$("fullscreen").onclick = () =>
  fullscreen()?.catch((e) => text("error", e.message));
$("reconnect").onclick = () => {
  clearTimeout(retry);
  retry = null;
  attempt = 0;
  clearPeer();
  registered = false;
  signaling.reconnect();
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    showState(
      "DEGRADED",
      "Tab hidden — monitoring and alerts may be suspended.",
    );
    text(
      "warning",
      "Return to this tab. Background monitoring is not guaranteed.",
    );
  } else {
    text(
      "warning",
      "Keep this tab visible. Use Android display settings to keep the screen on.",
    );
    if (item) recover("Checking media after returning to foreground");
  }
});
window.addEventListener("pagehide", () => {
  clearTimeout(retry);
  clearPeer();
  signaling.close();
});
