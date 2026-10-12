export const STATES = Object.freeze([
  "STOPPED",
  "STARTING",
  "READY",
  "CONNECTING",
  "STREAMING",
  "DEGRADED",
  "RECONNECTING",
  "FAILED",
]);

export function backoff(attempt, random = Math.random()) {
  return Math.min(
    15000,
    Math.round(500 * 2 ** Math.min(attempt, 5) * (0.75 + random * 0.5)),
  );
}

// Packet/frame progress measures health, not room loudness or scene changes.
export function mediaHealth(previous, current, now, started, kind) {
  const count = kind === "video" ? current?.frames : current?.packets;
  const oldCount = previous?.count;
  const progressed = Number.isFinite(count) && count > (oldCount ?? 0);
  const last = progressed ? now : (previous?.last ?? started);
  const state = current?.ended
    ? "ended"
    : now - last > 10000
      ? "stale"
      : progressed || previous?.confirmed
        ? "live"
        : "waiting";
  return {
    count: count ?? oldCount ?? 0,
    last,
    confirmed: progressed || !!previous?.confirmed,
    state,
  };
}

export function motionScore(previous, current, sensitivity = 50) {
  if (!previous || previous.length !== current.length) return 0;
  // Remove uniform exposure drift and reject small codec/sensor differences.
  let drift = 0;
  for (let i = 0; i < current.length; i++) drift += current[i] - previous[i];
  drift /= current.length;
  const threshold = 24 - Math.max(1, Math.min(100, sensitivity)) * 0.16;
  let changed = 0;
  for (let i = 0; i < current.length; i++)
    if (Math.abs(current[i] - previous[i] - drift) > threshold) changed++;
  return changed / current.length;
}

export function motionStep(state, score, sensitivity, now, cooldown = 8000) {
  const smoothed = (state?.smoothed ?? 0) * 0.5 + score * 0.5;
  const threshold = 0.12 - Math.max(1, Math.min(100, sensitivity)) * 0.0009;
  const hits = smoothed > threshold ? (state?.hits ?? 0) + 1 : 0;
  const active = hits >= 2;
  const alert = active && now - (state?.lastAlert ?? -Infinity) >= cooldown;
  return {
    smoothed,
    hits,
    active,
    alert,
    lastAlert: alert ? now : (state?.lastAlert ?? -Infinity),
  };
}

export function networkState(addresses, error = null) {
  return {
    state: addresses.length ? "READY" : "DEGRADED",
    available: addresses.length > 0,
    addresses,
    error,
  };
}
