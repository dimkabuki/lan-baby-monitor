import {
  $,
  text,
  fullscreen,
  Signaling,
  createPeer,
  sendDescription,
  receiveSignal,
  dispose,
} from "./common.js";
const video = $("video");
const peers = new Map();
let stream = null;
let captureState = "STOPPED";
let wake = null;
let facing = "environment";
let busy = false;
let csrf = null;
let signaling;
function updateCapture(state) {
  captureState = state;
  text("capture", state);
  $("start").disabled = busy || !!stream;
  for (const id of ["stop", "restart", "switch"])
    $(id).disabled = busy || !stream;
  $("placeholder").hidden = !!stream;
  text(
    "tracks",
    `${stream?.getVideoTracks()[0]?.readyState === "live" ? "Capturing" : "Inactive"} / ${stream?.getAudioTracks()[0]?.readyState === "live" ? "Capturing" : "Inactive"}`,
  );
}
function clearPeers() {
  for (const p of peers.values()) dispose(p);
  peers.clear();
  text("streaming", "Not streaming");
}
async function wakeLock() {
  if (!stream || document.visibilityState !== "visible" || wake) return;
  try {
    if (!navigator.wakeLock) throw new Error("Screen Wake Lock unsupported");
    const lock = await navigator.wakeLock.request("screen");
    if (!stream) {
      await lock.release();
      return;
    }
    wake = lock;
    text("wake", "Acquired");
    lock.addEventListener("release", () => {
      if (wake === lock) wake = null;
      text("wake", "Released — keep the screen on in Android settings");
    });
  } catch (e) {
    text(
      "wake",
      `Unavailable: ${e.message}. Keep screen on in Android settings.`,
    );
  }
}
async function startCapture() {
  if (busy || stream) return;
  busy = true;
  updateCapture("STARTING");
  text("error", "");
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Open the camera page at http://127.0.0.1 in modern Chrome.",
      );
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 20 },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (!stream.getVideoTracks().length || !stream.getAudioTracks().length)
      throw new Error("Both video and audio tracks are required");
    text("permission", "Camera and microphone granted");
    video.srcObject = stream;
    await video.play();
    const settings = stream.getVideoTracks()[0].getSettings();
    text(
      "resolution",
      `${settings.width ?? "?"} × ${settings.height ?? "?"} · ${settings.frameRate ?? "?"} fps`,
    );
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        text("error", `${track.kind} capture ended. Press Restart Camera.`);
        updateCapture("FAILED");
        signaling.send({ type: "ready", ready: false });
        clearPeers();
      });
      track.addEventListener("mute", () => {
        text(
          "warning",
          `${track.kind} capture interrupted. Keep Chrome foregrounded.`,
        );
      });
      track.addEventListener("unmute", () => text("warning", ""));
    }
    signaling.send({ type: "ready", ready: true });
    await wakeLock();
  } catch (e) {
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    video.srcObject = null;
    text("error", e.message);
    text(
      "permission",
      e.name === "NotAllowedError"
        ? "Permission denied — check Chrome site permissions"
        : "Capture failed",
    );
  } finally {
    busy = false;
    updateCapture(stream ? "READY" : "FAILED");
  }
}
function stopCapture() {
  signaling.send({ type: "ready", ready: false });
  clearPeers();
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  video.srcObject = null;
  wake?.release();
  wake = null;
  updateCapture("STOPPED");
}
async function offer(peer) {
  if (!stream || captureState === "FAILED") return;
  dispose(peers.get(peer));
  const item = createPeer((m) => signaling.send(m), peer, crypto.randomUUID());
  peers.set(peer, item);
  for (const track of stream.getTracks()) item.pc.addTrack(track, stream);
  item.pc.onconnectionstatechange = () => {
    if (item.pc.connectionState === "failed") {
      dispose(item);
      if (peers.get(peer) === item) peers.delete(peer);
    }
  };
  await item.pc.setLocalDescription(await item.pc.createOffer());
  sendDescription(item, (m) => signaling.send(m), peer);
}
signaling = new Signaling(
  "camera",
  async (m) => {
    if (m.type === "registered") {
      csrf = null;
      if (stream && captureState !== "FAILED")
        signaling.send({ type: "ready", ready: true });
    }
    if (m.type === "join") await offer(m.peer);
    if (m.type === "leave") {
      dispose(peers.get(m.peer));
      peers.delete(m.peer);
    }
    if (m.type === "signal") await receiveSignal(peers.get(m.peer), m);
    if (m.type === "error") text("error", m.message);
    if (m.type === "status") {
      text("count", `${m.monitors.length}/2`);
      text(
        "network",
        m.network.verified === false
          ? "Address configured — network availability unverified"
          : m.network.available
            ? `LAN available (${m.network.interface ?? "interface unknown"})`
            : `LAN unavailable. ${m.network.error ?? "Check Android Wi-Fi settings."}`,
      );
      text("ip", m.network.addresses.join(", ") || "Unavailable");
      $("share").disabled = !m.monitorUrl;
      $("copy").disabled = !m.monitorUrl;
      $("url").value =
        m.monitorUrl ??
        "LAN address unavailable — check Android Wi-Fi settings";
      text("diagnostics", JSON.stringify(m, null, 2));
    }
  },
  (state, error) => {
    text("server", state);
    if (["RECONNECTING", "FAILED"].includes(state)) {
      csrf = null;
      clearPeers();
    }
    if (error) text("error", error);
  },
);
let statsBusy = false;
setInterval(async () => {
  if (statsBusy) return;
  statsBusy = true;
  try {
    let transmitting = 0;
    let connected = 0;
    for (const item of peers.values()) {
      if (item.pc.connectionState === "connected") connected++;
      let bytes = 0;
      for (const s of (await item.pc.getStats()).values())
        if (s.type === "outbound-rtp" && !s.isRemote) bytes += s.bytesSent ?? 0;
      if (bytes > (item.bytes ?? bytes)) transmitting++;
      item.bytes = bytes;
    }
    text(
      "streaming",
      transmitting
        ? `Transmitting to ${transmitting} monitor(s)`
        : connected
          ? "Connected — no new outgoing media confirmed"
          : "Not streaming",
    );
    if (stream && captureState !== "FAILED")
      updateCapture(transmitting ? "STREAMING" : "READY");
    signaling.send({
      type: "health",
      state: captureState,
      lastMedia: transmitting ? Date.now() : undefined,
      video:
        stream?.getVideoTracks()[0]?.readyState === "live" ? "live" : "ended",
      audio:
        stream?.getAudioTracks()[0]?.readyState === "live" ? "live" : "ended",
    });
  } catch {
    text("streaming", "Media statistics unavailable");
  } finally {
    statsBusy = false;
  }
}, 2000);
$("start").onclick = startCapture;
$("stop").onclick = stopCapture;
$("restart").onclick = async () => {
  stopCapture();
  await startCapture();
};
$("switch").onclick = async () => {
  facing = facing === "environment" ? "user" : "environment";
  stopCapture();
  await startCapture();
};
$("fullscreen").onclick = () =>
  fullscreen()?.catch((e) => text("error", e.message));
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("url").value);
    text("warning", "Monitor URL copied");
  } catch {
    $("url").focus();
    $("url").select();
    text("warning", "Select and copy the monitor URL");
  }
};
$("share").onclick = async () => {
  try {
    if (!navigator.share) {
      $("copy").click();
      return;
    }
    await navigator.share({ title: "LAN Baby Monitor", url: $("url").value });
  } catch (e) {
    if (e.name !== "AbortError") text("error", e.message);
  }
};
async function lifecycle(action) {
  if (
    !confirm(
      `${action === "restart" ? "Restart" : "Stop"} the background server?`,
    )
  )
    return;
  try {
    if (!csrf) {
      const r = await fetch("/api/camera");
      if (!r.ok) throw new Error("Camera management unavailable");
      csrf = (await r.json()).csrf;
    }
    const response = await fetch(`/api/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Babycam-CSRF": csrf },
      body: "{}",
    });
    if (!response.ok) {
      csrf = null;
      throw new Error("Server command rejected. Try again.");
    }
    csrf = null;
    if (action === "stop") {
      stopCapture();
      signaling.close();
      text("server", "STOPPED — run babycam start in Termux");
    } else text("server", "RECONNECTING");
  } catch (e) {
    text("error", e.message);
  }
}
$("serverRestart").onclick = () => lifecycle("restart");
$("serverStop").onclick = () => lifecycle("stop");
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    wakeLock();
    text("warning", "");
  } else text("warning", "Camera hidden — Android may suspend capture.");
});
window.addEventListener("pagehide", () => {
  stopCapture();
  signaling.close();
});
