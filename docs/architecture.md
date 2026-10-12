# Architecture and decisions

## Stack

Node 22+ (Termux nodejs-lts), one pinned production dependency `ws` 8.22.0, native HTTP and browser WebRTC, vanilla JavaScript/HTML/CSS. There is no frontend compilation. Python/aiohttp is viable, but its native/transitive dependencies increase Android installation variability. `ws` works without optional native accelerators; a small payload includes its JavaScript and MIT license. Development tools are excluded from the installer.

Sources: [Termux Node LTS package](https://github.com/termux/termux-packages/tree/master/packages/nodejs-lts), [ws](https://github.com/websockets/ws), [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts), [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection), [Termux wake locks](https://github.com/termux/termux-tools/blob/master/doc/termux.1.md.in).

## Boundaries

- `public/domain.js`: pure health, backoff, motion and network rules; shared with Node tests.
- `src/session.js`: bounded registrations and strict signaling validation.
- `src/server.js`: HTTP/WebSocket adapters and loopback lifecycle authorization.
- `public/common.js`: transport, peer cleanup, local preferences and gesture-unlocked alerts.
- `public/camera.js`: a single user-started capture shared with independent PeerConnections.
- `public/monitor.js`: independent receive, media health, recovery and motion processing.
- `src/cli.js`: tiny detached supervisor and CLI. It starts one HTTP worker, waits for owned health, and returns. The worker exit code distinguishes intentional stop (0), requested restart (75), and failure. At most five consecutive crash retries, with a cap; the counter resets after a minute of uptime. Intentional stop never restarts.

The small supervisor is justified because the browser must restart the HTTP worker and unexpected worker crashes should recover. It captures no media and adds no service manager. Android killing Termux kills both; this cannot be recovered silently.

## Session sequence

The camera registers only on loopback. Capture starts only on a button press. A monitor registers and asks for an offer. The camera assigns a fresh negotiation generation, adds existing tracks, and creates an offer. Local ICE waits until the description is sent. Remote ICE waits until the remote description is applied. The server routes only within that monitor's session and ignores obsolete generations. A monitor answers; it never changes camera settings.

The camera and each monitor use separate capture, signaling, transport and media states. A connected PeerConnection is not proof of media progress. The camera displays outgoing-byte progress. The monitor measures decoded video frames and received audio packets every two seconds. No audio amplitude threshold is used. A quiet room is healthy when audio packets continue. Opus DTX can reduce packet frequency; the ten-second stall threshold must be checked on Android.

No frame progress for ten seconds hides the last frame and starts recovery. Incoming packets without decoded frames indicate unavailable/frozen decoding. Identical scene content with advancing decoded frames is normal; the application cannot identify a camera/driver that keeps encoding a stuck sensor image. The UI reports timestamps so confirmed activity is explicit.

Retries use capped exponential backoff and jitter. A single retry timer owns monitor renegotiation. Signaling heartbeat detects a stalled WebSocket independently; peers are disposed on reconnection. One monitor failure does not end capture or the other monitor.

Motion analyzes 96 × 72 grayscale frames at 4 Hz, subtracts uniform brightness drift, rejects small pixel differences, smooths temporally, requires two hits and applies an eight-second alert cooldown. There is no human recognition. Preferences are per browser origin and device; storage failure is harmless.

## Network and Android limitations

No STUN/TURN or relay. ICE host candidates (including browser mDNS hostnames) must work across the LAN. Guest-network isolation, blocked local UDP, VPNs and broken multicast can prevent media even when HTTP works. Android Chrome compatibility and these network conditions require real-device acceptance.

Camera localhost is a secure context; monitor LAN HTTP is not. Camera wake lock is feature-detected and reacquired when foregrounded. Monitor code does not require wake lock, clipboard, getUserMedia, Web Crypto or Notifications. AudioContext playback requires an explicit gesture. Screens and browsers must stay foregrounded.

Network interface enumeration may be restricted on Android. A configured `lanIp` is a fallback address and cannot prove Wi-Fi availability. After an address change, old monitor URLs do not discover the new phone address automatically. No Wi-Fi control, root, Termux:API, Boot or silent browser resurrection.

Two peers can roughly double encoding work and bandwidth; exact CPU/thermal costs depend on Chrome and hardware. Defaults request 640 × 480 at 15 fps (maximum 20); actual settings are shown. There is no bandwidth or four-hour endurance guarantee before device tests.
