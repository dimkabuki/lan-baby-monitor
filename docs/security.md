# Security and privacy

Trusted private LAN only. There is no authentication: any device that can reach the port may view media or consume the two monitor slots. Do not use untrusted, guest/shared, hotel or public networks. Do not forward the port, enable UPnP, or expose a reverse proxy. HTTP pages and WS signaling are unencrypted and unauthenticated; a LAN attacker could alter application code or signaling. WebRTC DTLS/SRTP encryption protects media transport but is not access control.

Runtime code makes no cloud requests. Initial installation may use Termux repositories. Explicit `babycam update` accesses one hard-coded GitHub release source. Release checksums detect corruption but do not protect against a compromised GitHub maintainer account; verify the installer/checksum through a trusted release page. No media is recorded, saved or logged. Motion canvases are ephemeral.

The server validates actual socket peer addresses for camera registration and management. Forwarding headers are ignored. Management requires loopback, an allowed Host, exact same-origin Origin and a random server-local CSRF header. LAN peers cannot retrieve the CSRF token. WebSocket upgrades require exact Origin and allowed Host. No CORS headers are provided. DNS rebinding to an unexpected hostname is rejected. CSP forbids third-party scripts and framing.

Signaling is capped at 64 KiB, SDP at 60,000 characters, ICE at 2,048 characters, two monitors, one camera, four temporary sockets, registration timeout and 100 messages/second per connection. Peer ownership and SDP direction are checked; negotiation generations isolate old traffic. Pings remove abandoned sockets. HTTP timeouts bound slow headers. Logs contain server startup/error messages only; SDP and media are not logged.

The tiny supervisor verifies HTTP instance ownership before normal stop. A signal fallback only targets a matching supervisor command line from `/proc`; stale PIDs never authorize killing arbitrary processes. Configuration and update staging are private to the Termux user. Installers refuse to overwrite an unrelated `babycam` executable.

Uninstall requires `babycam uninstall --yes`, removes application versions and its own launcher, and preserves configuration/logs. Termux runtime packages remain; they may be used by other applications.
