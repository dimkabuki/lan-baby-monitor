# Real Android acceptance

Status: PENDING

No real Android devices were available during this implementation. Linux simulation is not evidence of Termux compatibility, Android camera behavior, four-hour stability or thermal safety. Keep the first release a prerelease until this checklist has a dated device/browser/Termux/router record and every applicable result is recorded. A maintainer changes the status to PASSED only after actual tests.

| Check                                        | Expected result                                                           | Result  |
| -------------------------------------------- | ------------------------------------------------------------------------- | ------- |
| Release installer into trusted-source Termux | One bash command; automatic dependencies; repeat installation safe        | Pending |
| `babycam start` and duplicate start          | Background server; URLs; no duplicate server                              | Pending |
| Camera localhost Chrome                      | Camera page without certificate setup                                     | Pending |
| Camera/mic permission grant and denial       | Explicit start, clear denial, usable restart                              | Pending |
| One monitor                                  | Fresh video and continuously valid audio packets                          | Pending |
| Two monitors                                 | Both independent and healthy                                              | Pending |
| Third monitor                                | Capacity message; first two stay live                                     | Pending |
| Router internet disabled                     | Complete runtime operation without WAN                                    | Pending |
| Wi-Fi off/on on camera and monitors          | Accurate failure, bounded recovery; new IP visible if detectable          | Pending |
| Monitor reload/close                         | Other monitor unaffected; capacity released                               | Pending |
| Camera restart/switch                        | Reacquisition and peer recovery; no capture per monitor                   | Pending |
| Browser server restart                       | HTTP worker returns, media reconnects without new permission when allowed | Pending |
| Browser server stop                          | Server stays stopped; capture stops; `babycam start` restores it          | Pending |
| Server unreachable                           | Visible failure and audible warning after activation when tab active      | Pending |
| Stop decoded video progress                  | Last frame hidden after stall threshold; recovery begins                  | Pending |
| Static room and quiet audio                  | Silence and stationary content do not cause false failures                | Pending |
| Motion controls                              | Independent sensitivity; visual/sound toggles; cooldown; Test Alert       | Pending |
| Four-hour session                            | Audio/video stay healthy; no timer/peer accumulation                      | Pending |
| Resource observation                         | Record CPU/RAM/battery/temperature at 0, 30, 120 and 240 minutes          | Pending |
| Charging with screens active                 | Record heat, wake-lock behavior and any Android suspension                | Pending |

Also verify opening the downloaded `.sh` via Android **Open with → Termux** and **Share → Termux**, the **Open directory** import into private `~/downloads`, installation without shared-storage permission, and file-manager/default-app variations. This import path was inspected in Termux v0.118.3 source, not tested on a device; it must not be advertised as automatic execution.

Also verify microphone mute/ended tracks, camera browser closure and reopening, Termux notification wake-lock behavior, battery-optimization exemptions, Chrome fullscreen controls, audio gesture before a camera connects, mDNS host ICE, and network enumeration fallback. Do not leave a device charging unattended if it shows abnormal heat or a damaged battery.

Suggested record: date; phone models/Android versions; Chrome versions; Termux source/version; router; one/two monitors; real negotiated resolution; each result and observed error; four-hour metrics. Foreground alerts are never guaranteed after Android suspends a page.
