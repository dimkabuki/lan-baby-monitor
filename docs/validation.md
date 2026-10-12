# Validation and delivery status

## Verified automatically in the execution environment

- Node 24.19.0, production `ws` 8.22.0, Playwright 1.61.1, Linux Chromium 153.0.8010.0.
- ESLint and Prettier checks.
- 13 unit/integration/lifecycle tests: schemas, peer ownership, SDP/ICE exchange, two-monitor capacity and cleanup, HTTP, loopback management/Origin/CSRF, network transitions, backoff, media health including silence, motion/noise/exposure/smoothing/cooldown, update version/source/checksum rules, duplicate start, forced worker-crash recovery, browser/CLI restart and stop, port conflict, invalid configuration.
- 3 simulated installer tests: full payload/checksum/path/version validation, unsupported host rejection, repeat installation, upgrade of a running installation with preserved configuration and old version retained, corruption rejection, startup from extracted package, and dependency-install failure handling.
- One real WebRTC E2E scenario using fake camera and an actual silent WAV microphone: decoded video plus audio packets to two independent monitors, activated AudioContext and unmuted playback, rejected third monitor with persistent capacity feedback, independent persisted sensitivities, real frame motion analysis, one monitor closing/reloading, signaling transport loss/recovery, preserved camera capture across that signaling failure, interrupted real video track hiding the last frame, and camera stop/restart recovery.
- Self-contained release installer built and independently verified with SHA-256, payload manifest, syntax, version, safe paths and bundled `ws`.

## Important test environment distinction

This environment blocks network interface enumeration and non-loopback local connections. Browser media tests therefore used `BABYCAM_E2E_LOOPBACK=1`, localhost HTTP, a test-only loopback ICE flag and disabled mDNS IP masking. Real RTP/DTLS/WebRTC was used; media was not mocked or relayed. This proves the application's browser media path on loopback. It does **not** prove insecure LAN-origin behavior, default mDNS ICE or physical Wi-Fi recovery. The default CI browser suite uses an actual Linux LAN IPv4 HTTP origin with no loopback/mDNS overrides and asserts the monitor origin is insecure. The default run subsequently passed on GitHub Actions, proving the same browser media and recovery scenario on an insecure LAN HTTP origin with normal host ICE. Physical Wi-Fi and Android acceptance remain pending.

The ordinary Playwright Chromium download returned an invalid archive in this environment. A separately obtained Chromium executable was used for local tests via `BABYCAM_CHROMIUM`; this test-only binary is not an application dependency or release asset.

## GitHub delivery

The public repository exists at https://github.com/dimkabuki/lan-baby-monitor. Initial bootstrap added MIT licensing, the engineering contract and minimal CI to main. The implementation is uploaded through PR #1: https://github.com/dimkabuki/lan-baby-monitor/pull/1.

All three initial GitHub Actions checks passed: quality, browser and installer. Verified run: https://github.com/dimkabuki/lan-baby-monitor/actions/runs/38310549964 (implementation commit 0e0c6979a37c28af4b31159a967b25eef88700a3). The browser job uses an insecure LAN HTTP origin with normal host ICE and no loopback/mDNS overrides. Subsequent PR-head checks must also pass before merge; see the PR for current status.

The connected GitHub integration permits file, branch and PR operations but exposes no operation to administer branch protection/settings or dispatch the release workflow. No authenticated administrative GitHub CLI is available. Protection and release publishing remain pending; implementation must not bypass those requirements.

Prepared workflows enforce quality, browser and installer checks and re-run them before publishing a tag/version-matched main-ancestor prerelease. The repository configuration script sets and reads back the requested protections when administrative CLI access is available. A manually triggered Release workflow creates the matching tag and uploads the verified installer, checksum and notes only after its checks pass.

## Not verified

All real Android checks in `android-acceptance.md`, including Termux installation/dependency behavior, Chrome insecure LAN HTTP APIs, multicast/mDNS, Wi-Fi recovery with unchanged/changed IP, permissions, charging, heat, screen/wake-lock behavior, process kills and four-hour endurance. Successful `babycam update` against an actual published GitHub Release is pending. Update selection, source restrictions and hash failure handling are tested locally. Installer tests simulate Termux; they are not real Android tests. Actual speaker output is not verified by headless AudioContext tests.
