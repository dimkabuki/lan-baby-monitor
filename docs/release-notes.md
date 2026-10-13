# v0.1.0-rc.1 — initial candidate

## Install from Android Downloads

Install Termux from its official GitHub releases or F-Droid first. Download **lan-baby-monitor-v0.1.0-rc.1-termux.sh** from Assets below.

1. Open the downloaded file and select **Termux** in **Open with**, or **Share** the actual file to **Termux**.
2. Keep the original filename in **Save file in ~/downloads/** and tap **Open directory**.
3. In the terminal that opens, run:

```sh
bash ~/downloads/lan-baby-monitor-v0.1.0-rc.1-termux.sh
```

Termux imports the file into its private downloads folder; shared-storage permission is not needed for this path. Android chooses which apps it offers based on the installed Termux/file manager and defaults. Opening the file does not run the installer automatically. The **Edit** button needs an optional hook and is not the installation action. If neither Open with nor Share offers Termux, use the direct terminal method in the [README](https://github.com/dimkabuki/lan-baby-monitor#install).

This behavior was checked in [Termux v0.118.3 source](https://github.com/termux/termux-app/blob/v0.118.3/app/src/main/java/com/termux/filepicker/TermuxFileReceiverActivity.java); the Android interaction remains pending real-device verification. Download **SHA256SUMS** alongside the installer for independent verification. Published installer bytes, checksums and the version tag remain unchanged; this is an installation-guide update.

## Application and validation

Implemented local HTTP/WebSocket signaling, user-started camera/microphone capture, two isolated direct WebRTC monitors, health and recovery, per-monitor motion detection and alerts, mobile dashboards, loopback-only server controls, background lifecycle CLI, bundled self-extracting Termux installer, checksums, staging/rollback, update and uninstall, and required CI/release workflows.

This is a prerelease candidate. Real Android/Termux installation, LAN browser compatibility and four-hour endurance remain pending. Automated results and execution-environment limitations are recorded in `docs/validation.md`. Release publication must be blocked until required CI (including real WebRTC E2E) succeeds.

No cloud, relay/STUN/TURN, recording or authentication. Trusted private network only. Keep browsers foregrounded and screens active; browser/Android suspension can stop media and alerts. Changing LAN IP can require opening a new monitor URL. Network enumeration can be restricted by Android; a configured address is a fallback, not a connectivity guarantee.
