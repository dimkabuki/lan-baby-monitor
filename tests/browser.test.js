import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";

import { chromium } from "playwright";
import { createServer } from "../src/server.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function live(page) {
  try {
    await page.waitForFunction(
      () => document.querySelector("#connection").textContent === "Live",
      null,
      { timeout: 35000 },
    );
  } catch (e) {
    console.error(
      await page.locator("body").innerText(),
      await page.locator("#diagnostics").textContent(),
    );
    console.error(
      await page.evaluate(() =>
        (window.__peers ?? []).map((p) => ({
          connection: p.connectionState,
          ice: p.iceConnectionState,
          gathering: p.iceGatheringState,
          localCandidates:
            p.localDescription?.sdp?.match(/a=candidate:[^\r]+/g),
          remoteCandidates:
            p.remoteDescription?.sdp?.match(/a=candidate:[^\r]+/g),
        })),
      ),
    );
    throw e;
  }
  const media = await page.evaluate(() => {
    const v = document.querySelector("video");
    return {
      width: v.videoWidth,
      tracks: v.srcObject
        .getTracks()
        .map((t) => ({ kind: t.kind, state: t.readyState })),
      frames: v.getVideoPlaybackQuality().totalVideoFrames,
      secure: isSecureContext,
    };
  });
  assert.ok(media.width > 0);
  assert.ok(media.frames > 0);
  assert.ok(media.tracks.some((t) => t.kind === "audio" && t.state === "live"));
  return media;
}
test(
  "real WebRTC: two monitors, quiet audio, motion, interruption and recovery",
  { timeout: 150000 },
  async (t) => {
    const loopbackMode = process.env.BABYCAM_E2E_LOOPBACK === "1";
    t.diagnostic(
      loopbackMode
        ? "Loopback test mode: test-only loopback/mDNS flags; LAN-origin verification remains pending"
        : "LAN HTTP mode: insecure monitor origin, normal host ICE",
    );
    const app = await createServer({ port: 0 });
    const lanIp = loopbackMode
      ? "127.0.0.1"
      : Object.values(os.networkInterfaces())
          .flat()
          .find((n) => !n.internal && n.family === "IPv4")?.address;
    assert.ok(
      lanIp,
      "An IPv4 LAN interface is required for the default E2E suite",
    );
    const audioDir = mkdtempSync(path.join(os.tmpdir(), "babycam-audio-"));
    t.after(() => rmSync(audioDir, { recursive: true, force: true }));
    const silence = Buffer.alloc(44 + 48000 * 2);
    silence.write("RIFF", 0);
    silence.writeUInt32LE(silence.length - 8, 4);
    silence.write("WAVEfmt ", 8);
    silence.writeUInt32LE(16, 16);
    silence.writeUInt16LE(1, 20);
    silence.writeUInt16LE(1, 22);
    silence.writeUInt32LE(48000, 24);
    silence.writeUInt32LE(96000, 28);
    silence.writeUInt16LE(2, 32);
    silence.writeUInt16LE(16, 34);
    silence.write("data", 36);
    silence.writeUInt32LE(silence.length - 44, 40);
    const audioFile = path.join(audioDir, "silence.wav");
    writeFileSync(audioFile, silence);
    t.after(() => app.close());
    const browser = await chromium.launch({
      executablePath: process.env.BABYCAM_CHROMIUM || undefined,
      headless: true,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        `--use-file-for-fake-audio-capture=${audioFile}`,
        ...(loopbackMode
          ? [
              "--disable-features=WebRtcHideLocalIpsWithMdns",
              "--allow-loopback-in-peer-connection",
            ]
          : []),
        "--no-proxy-server",
      ],
    });
    t.after(() => browser.close());
    const local = `http://127.0.0.1:${app.port}`;
    const lan = `http://${lanIp}:${app.port}`;
    const cameraContext = await browser.newContext({
      permissions: ["camera", "microphone"],
    });
    const camera = await cameraContext.newPage();
    const failures = [];
    camera.on("pageerror", (e) => failures.push(e.message));
    await camera.goto(local + "/camera");
    await camera.click("#start");
    await camera.waitForFunction(() =>
      ["READY", "STREAMING"].includes(
        document.querySelector("#capture").textContent,
      ),
    );
    const ca = await browser.newContext();
    const cb = await browser.newContext();
    const cc = await browser.newContext();
    for (const ctx of [cameraContext, ca, cb, cc])
      await ctx.addInitScript(() => {
        window.__peers = [];
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Native {
          constructor(...args) {
            super(...args);
            window.__peers.push(this);
          }
        };
      });
    const a = await ca.newPage();
    const b = await cb.newPage();
    const third = await cc.newPage();
    for (const p of [a, b, third])
      p.on("pageerror", (e) => failures.push(e.message));
    await a.goto(lan + "/monitor");
    const media = await live(a);
    assert.equal(media.secure, loopbackMode);
    await a.click("#enable");
    try {
      await a.waitForFunction(
        () =>
          document
            .querySelector("#playback")
            .textContent.includes("alerts enabled"),
        null,
        { timeout: 8000 },
      );
    } catch (e) {
      console.error(
        "Audio activation:",
        await a.locator("#playback").textContent(),
        await a.locator("#error").textContent(),
      );
      throw e;
    }
    await b.goto(lan + "/monitor");
    await live(b);
    assert.equal(app.sessions.monitors.size, 2);
    await third.goto(lan + "/monitor");
    await third.waitForFunction(() =>
      document.querySelector("#error").textContent.includes("Two monitors"),
    );
    await a.locator("#sensitivity").evaluate((e) => {
      e.value = "90";
      e.dispatchEvent(new Event("input"));
    });
    await b.locator("#sensitivity").evaluate((e) => {
      e.value = "10";
      e.dispatchEvent(new Event("input"));
    });
    assert.equal(await a.inputValue("#sensitivity"), "90");
    assert.equal(await b.inputValue("#sensitivity"), "10");
    // Animated Chromium fake camera supplies actual moving frames to canvas analysis.
    await a.locator("#sensitivity").evaluate((e) => {
      e.value = "100";
      e.dispatchEvent(new Event("input"));
    });
    await a.waitForFunction(
      () => document.querySelector("#lastMotion").textContent !== "None",
      null,
      { timeout: 15000 },
    );
    await a.click("#testAlert");
    assert.equal(
      await a.evaluate(() => document.querySelector("video").muted),
      false,
    );
    assert.equal(await a.locator("#error").textContent(), "");
    const preservedCapture = await camera.evaluate(
      () => document.querySelector("video").srcObject.id,
    );
    await a.close();
    await sleep(500);
    await live(b);
    assert.equal(app.sessions.monitors.size, 1);
    await b.reload();
    await live(b);
    assert.equal(await b.inputValue("#sensitivity"), "10");
    // Drop signaling transport while preserving camera capture; peer rebuild must recover.
    for (const ws of app.wss.clients) ws.terminate();
    await sleep(500);
    await live(b);
    assert.equal(
      await camera.evaluate(() => document.querySelector("video").srcObject.id),
      preservedCapture,
    );
    // Interrupt real camera output; decoded frames must stop and the last frame must be hidden.
    await camera.evaluate(() =>
      document.querySelector("video").srcObject.getVideoTracks()[0].stop(),
    );
    await b.waitForFunction(
      () =>
        !document.querySelector("#placeholder").hidden &&
        document.querySelector("#connection").textContent !== "Live",
      null,
      { timeout: 16000 },
    );
    await camera.click("#restart");
    await sleep(500);
    await live(b);
    await camera.click("#stop");
    await b.waitForFunction(
      () =>
        document.querySelector("#connection").textContent === "Camera offline",
    );
    assert.equal(await b.locator("#placeholder").isVisible(), true);
    await camera.click("#start");
    await live(b);
    assert.deepEqual(failures, []);
  },
);
