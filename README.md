# LAN Baby Monitor

Turn an older Android phone into an offline baby monitor. Termux hosts local pages and signaling; Android Chrome captures camera/microphone and sends WebRTC media directly to up to two other foreground browser tabs. No cloud, internet at runtime, STUN/TURN, recording, accounts or analytics.

**Prerelease candidate. Real Android acceptance is pending. This is an informational monitor, not a certified child-safety system.** Publication and automated validation status: [validation](docs/validation.md).

## Install

Install **Termux from a trusted official source**, preferably [F-Droid](https://f-droid.org/packages/com.termux/) or [official GitHub releases](https://github.com/termux/termux-app/releases). No Termux:API/Boot or native camera app is needed. Initial dependency installation needs internet access.

When a verified GitHub Release is published, download `lan-baby-monitor-v0.1.0-rc.1-termux.sh` and `SHA256SUMS` from that release. Source ZIPs are not installation packages. Place the installer in Termux's home directory, then run:

```sh
bash lan-baby-monitor-v0.1.0-rc.1-termux.sh
```

The one-file installer installs missing Termux runtime packages, includes the pinned `ws` dependency, verifies its payload and files, stages a version directory, and atomically switches the current symlink. It preserves configuration during repeated installs/upgrades and refuses unrelated command conflicts. You do not run npm or pip yourself. If downloaded to Android Downloads instead, grant shared-storage access with Termux's built-in `termux-setup-storage`, then run `bash ~/storage/downloads/lan-baby-monitor-v0.1.0-rc.1-termux.sh`.

Independent verification (when `sha256sum` is already present):

```sh
sha256sum -c SHA256SUMS
```

Inspect the checksum on the trusted release page. Embedded hashes detect corruption; they do not authenticate a malicious replacement installer.

## Use

```sh
babycam start
```

This returns to the terminal, prints URLs, and never launches the browser or captures media. Open `http://127.0.0.1:8765/camera` on the camera phone. Press **Start Camera**, grant camera and microphone permissions, and keep Chrome foregrounded. Share/copy the displayed monitor URL.

Open `http://CAMERA_PHONE_LAN_IP:8765/monitor` on each monitor. Press **Enable Audio & Alerts**. Keep both monitor screens on using Android display settings. Use volume, fullscreen, motion/sensitivity/notification/sound controls independently. A third monitor gets a capacity message.

Camera capture and outgoing transmission have separate indicators. A monitor is Live only after video frames and audio packets progress. Silence is normal. A stalled video is covered with an unavailable placeholder after detection, and peers reconnect. Alerts require user activation and an executing foreground browser.

```sh
babycam status
babycam doctor
babycam restart
babycam stop
babycam update
babycam version
babycam uninstall --yes
```

`stop` stops the server, not Android Wi-Fi. Camera **Stop Camera** releases capture while the server stays running. **Restart Camera** reacquires capture. Browser **Restart Server** restarts the HTTP worker and reconnects signaling; **Stop Server** stops capture and intentionally stops the supervisor. Monitors cannot invoke lifecycle controls.

`babycam update` explicitly checks `dimkabuki/lan-baby-monitor` releases, verifies the downloaded installer checksum, and installs through the same staged path. It can select a newer release candidate. It stops an active server; run `babycam start` after upgrading. It fails cleanly if no release/source is available. Successful network updates cannot be verified before a release exists. Uninstall preserves config/logs and Termux runtime packages.

## Android and network setup

Use a trusted private home Wi-Fi router, with client isolation disabled. No WAN is necessary after install. Keep the camera powered, its screen on, and Chrome active. Camera wake lock is optional and its result is shown; Termux CPU wake lock is requested by the supervisor. Android battery optimization or process termination can still interrupt service. Device reboot requires manually restarting Termux and capture. Avoid overheating.

Default capture requests 640 × 480 at 15 fps, capped at 20; actual settings depend on the camera. Two monitors increase encoding, CPU and Wi-Fi usage. Check four-hour behavior on your exact phones.

Configuration lives at `~/.local/share/lan-baby-monitor/config.json`:

```json
{ "port": 8765, "lanIp": null }
```

The server normally detects IPv4 LAN interfaces. If Android restricts interface inspection, read the camera phone's Wi-Fi IP in Android settings and set `lanIp` to that address; restart the server. This is an unverified address override, not proof that Wi-Fi is connected. If the address changes, update it and reopen monitor URLs. The application cannot reconnect Android to an access point or discover a changed IP from an old monitor URL. Host ICE/mDNS must work; isolated Wi-Fi, blocked local UDP, multicast problems and VPNs may prevent media.

Log: `~/.local/share/lan-baby-monitor/server.log` (rotated at worker launch over 1 MiB; one previous file). No media/SDP logging. `doctor` reports runtime, version, config, process, listening/HTTP ownership and network detection.

## Security

Anyone on the reachable LAN can attempt to view or consume capacity. HTTP/WS signaling is unencrypted; WebRTC media encryption does not provide authentication. Never expose this service to the internet or an untrusted network. No automatic router configuration. Management and camera registration use actual loopback peers, same-origin checks, CSRF and bounded messages. See [security](docs/security.md).

## Development

Node 22+, one production dependency, no frontend build. See [architecture](docs/architecture.md), [maintenance/release process](docs/maintaining.md), [Android acceptance checklist](docs/android-acceptance.md), and [engineering contract](AGENTS.md). MIT licensed.
