import { backoff } from "./domain.js";
export const $ = (id) => document.getElementById(id);
export const text = (id, value) => {
  $(id).textContent = value;
};
export function fullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  return document.documentElement.requestFullscreen?.();
}
export class Signaling {
  constructor(role, onMessage, onState) {
    this.role = role;
    this.onMessage = onMessage;
    this.onState = onState;
    this.attempt = 0;
    this.timer = null;
    this.stopped = false;
    this.ws = null;
    this.heartbeat = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastPong > 16000) this.ws.close();
        else this.send({ type: "ping" });
      }
    }, 5000);
    this.connect();
  }
  connect() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.onState("CONNECTING");
    const ws = new WebSocket(`ws://${location.host}/ws`);
    this.ws = ws;
    this.lastPong = Date.now();
    let chain = Promise.resolve();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.send({ type: "register", role: this.role });
    };
    ws.onmessage = (event) => {
      chain = chain
        .then(async () => {
          if (this.ws !== ws) return;
          const m = JSON.parse(event.data);
          this.lastPong = Date.now();
          if (m.type === "registered") {
            this.attempt = 0;
            this.id = m.id;
            this.onState("READY");
          }
          if (m.type === "error" && m.code === "capacity") {
            this.stopped = true;
            this.failure = m.message;
            this.onState("FAILED", m.message);
          }
          if (m.type !== "pong") await this.onMessage(m);
        })
        .catch((e) => {
          this.onState("DEGRADED", e.message);
        });
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.onState(this.stopped ? "FAILED" : "RECONNECTING", this.failure);
      if (!this.stopped)
        this.timer = setTimeout(() => this.connect(), backoff(this.attempt++));
    };
  }
  send(value) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(value));
      return true;
    }
    return false;
  }
  reconnect() {
    this.stopped = false;
    this.failure = null;
    clearTimeout(this.timer);
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.connect();
  }
  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    const old = this.ws;
    this.ws = null;
    old?.close();
  }
}
export function createPeer(send, peer, generation) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const item = {
    pc,
    generation,
    candidates: [],
    localCandidates: [],
    descriptionSent: false,
    created: Date.now(),
  };
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const message = {
      type: "signal",
      peer,
      generation,
      candidate: event.candidate.toJSON(),
    };
    if (item.descriptionSent) send(message);
    else item.localCandidates.push(message);
  };
  return item;
}
export function sendDescription(item, send, peer) {
  send({
    type: "signal",
    peer,
    generation: item.generation,
    description: item.pc.localDescription.toJSON(),
  });
  item.descriptionSent = true;
  for (const message of item.localCandidates.splice(0)) send(message);
}
export async function receiveSignal(item, message) {
  if (!item || item.generation !== message.generation) return;
  if (message.description) {
    await item.pc.setRemoteDescription(message.description);
    for (const c of item.candidates.splice(0)) await item.pc.addIceCandidate(c);
  } else if (item.pc.remoteDescription)
    await item.pc.addIceCandidate(message.candidate);
  else item.candidates.push(message.candidate);
}
export function dispose(item) {
  if (!item) return;
  for (const receiver of item.pc.getReceivers())
    if (receiver.track) receiver.track.onended = null;
  item.pc.onicecandidate = null;
  item.pc.ontrack = null;
  item.pc.onconnectionstatechange = null;
  item.pc.close();
}
export function safePreferences() {
  try {
    return JSON.parse(localStorage.getItem("babycam.preferences") ?? "{}");
  } catch {
    return {};
  }
}
export function savePreferences(value) {
  try {
    localStorage.setItem("babycam.preferences", JSON.stringify(value));
  } catch {
    /* Optional storage. */
  }
}
export class Alerts {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.lastFailure = -Infinity;
  }
  async enable() {
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio) throw new Error("Browser audio alerts unavailable");
    this.context ??= new Audio();
    await this.context.resume();
    this.enabled = this.context.state === "running";
    if (!this.enabled)
      throw new Error("Audio suspended. Tap Enable Audio & Alerts again.");
  }
  beep(failure = false) {
    if (!this.enabled || this.context?.state !== "running") return false;
    if (failure && Date.now() - this.lastFailure < 15000) return false;
    if (failure) this.lastFailure = Date.now();
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = failure ? 440 : 880;
    gain.gain.setValueAtTime(0.12, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      this.context.currentTime + 0.35,
    );
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.35);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    return true;
  }
}
