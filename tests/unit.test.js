import test from "node:test";
import assert from "node:assert/strict";
import {
  backoff,
  mediaHealth,
  motionScore,
  motionStep,
  networkState,
  STATES,
} from "../public/domain.js";
import { Sessions, validateMessage } from "../src/session.js";
import { randomUUID } from "node:crypto";
test("bounded backoff and jitter", () => {
  assert.equal(backoff(0, 0), 375);
  assert.equal(backoff(100, 1), 15000);
  assert.ok(backoff(3, 0) < backoff(3, 1));
});
test("media transitions use frames and packets; silence is not a failure", () => {
  let h = mediaHealth(null, { frames: 10 }, 2000, 0, "video");
  assert.equal(h.state, "live");
  h = mediaHealth(h, { frames: 10 }, 14000, 0, "video");
  assert.equal(h.state, "stale");
  h = mediaHealth(h, { frames: 11 }, 16000, 0, "video");
  assert.equal(h.state, "live");
  assert.equal(
    mediaHealth(h, { frames: 11, ended: true }, 17000, 0, "video").state,
    "ended",
  );
  let a;
  for (let i = 1; i < 50; i++)
    a = mediaHealth(
      a,
      { packets: i * 10, audioLevel: 0 },
      i * 2000,
      0,
      "audio",
    );
  assert.equal(a.state, "live");
  assert.equal(mediaHealth(null, null, 0, 0, "video").state, "waiting");
});
test("motion rejects noise and exposure drift; sensitivity changes threshold", () => {
  const a = new Uint8Array(100).fill(80);
  const bright = new Uint8Array(100).fill(110);
  assert.equal(motionScore(a, bright), 0);
  const noise = a.map((v, i) => v + (i % 3));
  assert.equal(motionScore(a, noise), 0);
  const moved = a.slice();
  moved.fill(100, 0, 10);
  assert.ok(motionScore(a, moved, 100) > motionScore(a, moved, 1));
  assert.equal(motionScore(null, a), 0);
});
test("motion smoothing, debounce and cooldown", () => {
  let s = motionStep(null, 0.5, 50, 0);
  assert.equal(s.alert, false);
  s = motionStep(s, 0.5, 50, 250);
  assert.equal(s.alert, true);
  s = motionStep(s, 0.5, 50, 500);
  assert.equal(s.alert, false);
  s = motionStep(s, 0.5, 50, 9000);
  assert.equal(s.alert, true);
});
test("network availability transitions and named states", () => {
  assert.equal(networkState([]).state, "DEGRADED");
  assert.equal(networkState(["192.168.1.2"]).state, "READY");
  assert.equal(STATES.length, 8);
});
test("session capacity, isolation, cleanup and camera privilege", () => {
  const s = new Sessions();
  const camera = { loopback: true };
  s.register(camera, "camera");
  const a = {},
    b = {};
  s.register(a, "monitor");
  s.register(b, "monitor");
  assert.throws(() => s.register({}, "monitor"), /capacity/);
  assert.equal(s.monitors.size, 2);
  s.remove(a);
  s.register({}, "monitor");
  assert.ok(s.monitors.has(b.id));
  s.remove(camera);
  assert.equal(s.camera, null);
  assert.throws(() => s.register({ loopback: false }, "camera"), /loopback/);
});
test("signaling schema rejects malformed and oversized payloads", () => {
  const valid = {
    type: "signal",
    peer: randomUUID(),
    generation: randomUUID(),
    description: { type: "offer", sdp: "v=0" },
  };
  assert.equal(validateMessage(valid), valid);
  for (const m of [
    null,
    [],
    { type: "eval" },
    { type: "ping", extra: 1 },
    { type: "ready", ready: 1 },
    { ...valid, peer: "x" },
    { ...valid, description: { type: "offer", sdp: "x".repeat(60001) } },
    { ...valid, candidate: null },
    { type: "health", state: "unknown" },
  ])
    assert.throws(() => validateMessage(m));
  assert.equal(
    validateMessage({
      type: "signal",
      peer: valid.peer,
      generation: valid.generation,
      candidate: null,
    }).candidate,
    null,
  );
});

test("update version ordering, explicit source and checksum rejection", async () => {
  const { selectRelease, compareVersions, verifyDownload } =
    await import("../src/release.js");
  const { createHash } = await import("node:crypto");
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.9"), 1);
  assert.equal(compareVersions("0.1.0-rc.2", "0.1.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.throws(() => compareVersions("evil", "1.0.0"));
  const version = "0.1.0-rc.2";
  const name = `lan-baby-monitor-v${version}-termux.sh`;
  const prefix = `https://github.com/dimkabuki/lan-baby-monitor/releases/download/v${version}/`;
  const release = {
    tag_name: "v" + version,
    draft: false,
    assets: [
      { name, size: 1, browser_download_url: prefix + name },
      { name: "SHA256SUMS", browser_download_url: prefix + "SHA256SUMS" },
    ],
  };
  assert.equal(selectRelease([release], "0.1.0-rc.1").version, version);
  assert.equal(selectRelease([release], version), null);
  assert.throws(
    () => selectRelease([{ ...release, assets: [] }], "0.1.0-rc.1"),
    /missing/,
  );
  assert.throws(
    () =>
      selectRelease(
        [
          {
            ...release,
            assets: [
              {
                ...release.assets[0],
                browser_download_url: "https://evil.example/install.sh",
              },
              release.assets[1],
            ],
          },
        ],
        "0.1.0-rc.1",
      ),
    /source/,
  );
  const bytes = Buffer.from("installer");
  const sums = `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`;
  verifyDownload(bytes, sums, name);
  assert.throws(
    () => verifyDownload(Buffer.from("tampered"), sums, name),
    /integrity/,
  );
  assert.throws(() => verifyDownload(bytes, "", name), /missing/);
});
