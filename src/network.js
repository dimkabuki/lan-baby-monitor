import os from "node:os";
import { isIP } from "node:net";
import { networkState } from "../public/domain.js";

export function detectNetwork() {
  const override = process.env.BABYCAM_LAN_IP;
  if (override && isIP(override) === 4)
    return {
      ...networkState([override]),
      available: false,
      state: "DEGRADED",
      verified: false,
      interface: "configured (not independently verified)",
    };
  try {
    const entries = Object.entries(os.networkInterfaces()).flatMap(
      ([name, list]) =>
        (list ?? [])
          .filter(
            (n) =>
              !n.internal &&
              n.family === "IPv4" &&
              !n.address.startsWith("169.254."),
          )
          .map((n) => ({ name, ip: n.address })),
    );
    entries.sort(
      (a, b) =>
        Number(/^wlan|^wifi/.test(b.name)) - Number(/^wlan|^wifi/.test(a.name)),
    );
    return {
      ...networkState(entries.map((n) => n.ip)),
      interface: entries[0]?.name ?? null,
    };
  } catch {
    // Android may restrict interface enumeration. Never invent a reachable address.
    return networkState(
      [],
      "Android restricted network interface inspection. Check Wi-Fi settings for the phone IP.",
    );
  }
}
