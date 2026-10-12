# v0.1.0-rc.1 — initial candidate

Implemented local HTTP/WebSocket signaling, user-started camera/microphone capture, two isolated direct WebRTC monitors, health and recovery, per-monitor motion detection and alerts, mobile dashboards, loopback-only server controls, background lifecycle CLI, bundled self-extracting Termux installer, checksums, staging/rollback, update and uninstall, and required CI/release workflows.

This is a prerelease candidate. Real Android/Termux installation, LAN browser compatibility and four-hour endurance remain pending. Automated results and execution-environment limitations are recorded in `docs/validation.md`. Release publication must be blocked until required CI (including real WebRTC E2E) succeeds.

No cloud, relay/STUN/TURN, recording or authentication. Trusted private network only. Keep browsers foregrounded and screens active; browser/Android suspension can stop media and alerts. Changing LAN IP can require opening a new monitor URL. Network enumeration can be restricted by Android; a configured address is a fallback, not a connectivity guarantee.
