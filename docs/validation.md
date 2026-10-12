# Validation and delivery status

## Verified automatically in the execution environment

- Node 24.19.0, production `ws` 8.22.0, Playwright 1.61.1, Linux Chromium 153.0.8010.0.
- ESLint and Prettier checks.
- 13 unit/integration/lifecycle tests: schemas, peer ownership, SDP/ICE exchange, two-monitor capacity and cleanup, HTTP, loopback management/Origin/CSRF, network transitions, backoff, media health including silence, motion/noise/exposure/smoothing/cooldown, update version/source/checksum rules, duplicate start, forced worker-crash recovery, browser/CLI restart and stop, port conflict, invalid configuration.
- 3 simulated installer tests: full payload/checksum/path/version validation, unsupported host rejection, repeat installation, upgrade of a running installation with preserved configuration and old version retained, corruption rejection, startup from extracted package, and dependency-install failure handling.
- One real WebRTC E2E scenario using fake camera and an actual silent WAV microphone: decoded video plus audio packets to two independent monitors, activated AudioContext and unmuted playback, rejected third monitor with persistent capacity feedback, independent persisted sensitivities, real frame motion analysis, one monitor closing/reloading, signaling transport loss/recovery, preserved camera capture across that signaling failure, interrupted real video track hiding the last frame, and camera stop/restart recovery.
- Self-contained release installer built and independently verified with SHA-256, payload manifest, syntax, version, safe paths and bundled `ws`.

## Important test environment distinction

This environment blocks network interface enumeration and non-loopback local connections. Browser media tests therefore used `BABYCAM_E2E_LOOPBACK=1`, localhost HTTP, a test-only loopback ICE flag and disabled mDNS IP masking. Real RTP/DTLS/WebRTC was used; media was not mocked or relayed. This proves the application's browser media path on loopback. It does **not** prove insecure LAN-origin behavior, default mDNS ICE or physical Wi-Fi recovery. The default CI browser suite uses an actual Linux LAN IPv4 HTTP origin with no loopback/mDNS overrides and asserts the monitor origin is insecure. That default run remains pending until GitHub CI can execute.

The ordinary Playwright Chromium download returned an invalid archive in this environment. A separately obtained Chromium executable was used for local tests via `BABYCAM_CHROMIUM`; this test-only binary is not an application dependency or release asset.

## External delivery blocked

The connected GitHub integration verified the account `dimkabuki` and repository inventory, but exposes no operation to create repositories, administer branch protection/settings or publish release assets. No authenticated GitHub CLI was available. The target repository did not exist in the accessible inventory. No repository, remote PR, GitHub CI run, protection or Release was created or claimed. Local git contains an initial `main` bootstrap and implementation feature branches; they have not been merged into remote main.

Prepared GitHub Actions workflows enforce `quality`, `browser`, `installer`, and re-run checks before publishing a tag/version-matched main-ancestor release. A repository configuration script sets and reads back the requested protections when administrative CLI access becomes available. No main protection or CI pass is claimed until externally verified.

The source snapshot and candidate installer are supplied so work can resume without recreating the implementation. Publication remains blocked; no download URL is fabricated. The candidate must not be published as a tested release until the default CI browser check passes.

## Not verified

All real Android checks in `android-acceptance.md`, including Termux installation/dependency behavior, Chrome insecure LAN HTTP APIs, multicast/mDNS, Wi-Fi recovery with unchanged/changed IP, permissions, charging, heat, screen/wake-lock behavior, process kills and four-hour endurance. Successful `babycam update` against an actual published GitHub Release is pending. Update selection, source restrictions and hash failure handling are tested locally. Installer tests simulate Termux; they are not real Android tests. Actual speaker output is not verified by headless AudioContext tests.
