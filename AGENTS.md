# Engineering contract

- Build and validate a small working vertical slice before extending it (Gall's Law).
- Keep domain rules pure; browser and server adapters depend on those rules.
- Use Node HTTP, the established `ws` library, native WebRTC, and vanilla browser modules.
- Keep capture, signaling, transport, media health, and lifecycle states explicit and separate.
- No cloud, recording, analytics, authentication, native Android app, database, build framework, or speculative abstractions.
- Only loopback peers may register a camera or request lifecycle operations. Validate Host, Origin, CSRF, message schemas, sizes, and peer ownership. Never trust forwarding headers.
- Test real WebRTC with fake devices; cover failures, recovery, capacity, quiet audio, lifecycle, and installation. Do not mock away media.
- English source, UI, documentation, commit and PR text. Communicate with the project owner in Russian.
- Use focused feature branches and PRs; squash merge after `quality`, `browser`, and `installer` checks pass. No approval requirement that blocks a solo maintainer. No routine protection bypass.
- Tag only tested commits reachable from protected main. Include an installer, checksums, and release notes. Use prereleases until real Android acceptance is recorded.
- Update documentation with behavior and limitations. Never claim unperformed tests or external actions succeeded.
- No agents or parallel agent delegation is required by this contract.
