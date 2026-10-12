import { createHash } from "node:crypto";
export const repository = "dimkabuki/lan-baby-monitor";
export function compareVersions(next, current) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
    if (!match) throw new Error("Invalid release version");
    return [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      match[4] ? Number(match[4]) : Infinity,
    ];
  };
  const a = parse(next),
    b = parse(current);
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
export function selectRelease(releases, current) {
  if (!Array.isArray(releases)) throw new Error("Invalid release response");
  const latest = releases
    .filter((r) => !r.draft && /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(r.tag_name))
    .sort(
      (a, b) => -compareVersions(a.tag_name.slice(1), b.tag_name.slice(1)),
    )[0];
  if (!latest) throw new Error("No verified release available");
  const version = latest.tag_name.slice(1);
  if (compareVersions(version, current) <= 0) return null;
  const name = `lan-baby-monitor-v${version}-termux.sh`;
  const installer = latest.assets?.find((v) => v.name === name);
  const checksums = latest.assets?.find((v) => v.name === "SHA256SUMS");
  if (!installer || !checksums || installer.size > 5 * 1024 * 1024)
    throw new Error("Release assets missing or too large");
  const prefix = `https://github.com/${repository}/releases/download/${latest.tag_name}/`;
  if (
    installer.browser_download_url !== prefix + name ||
    checksums.browser_download_url !== prefix + "SHA256SUMS"
  )
    throw new Error("Unexpected release source");
  return { version, name, installer, checksums };
}
export function verifyDownload(bytes, sums, name) {
  if (sums.length > 8192) throw new Error("Checksum manifest too large");
  const expected = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === name)?.[0];
  if (!/^[a-f0-9]{64}$/.test(expected ?? ""))
    throw new Error("Installer checksum missing");
  if (
    bytes.length > 5 * 1024 * 1024 ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  )
    throw new Error("Installer integrity check failed");
}
