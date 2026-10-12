import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const version = JSON.parse(readFileSync("package.json")).version;
const filename = `lan-baby-monitor-v${version}-termux.sh`;
const bytes = readFileSync(`dist/${filename}`);
const expected = readFileSync("dist/SHA256SUMS", "utf8").trim().split(/\s+/)[0];
if (createHash("sha256").update(bytes).digest("hex") !== expected)
  throw new Error("Installer checksum mismatch");
const content = bytes.toString();
const parts = content.split("__BABYCAM_PAYLOAD_BELOW__\n");
if (parts.length !== 2) throw new Error("Invalid payload boundary");
// The marker also appears in the awk pattern but only this exact standalone line separates payload.
const payload = Buffer.from(parts[1], "base64");
const hash = /PAYLOAD_SHA256='([a-f0-9]{64})'/.exec(parts[0])?.[1];
if (createHash("sha256").update(payload).digest("hex") !== hash)
  throw new Error("Payload checksum mismatch");
const dir = mkdtempSync(path.join(os.tmpdir(), "babycam-verify-"));
try {
  const listing = execFileSync("tar", ["-tzf", "-"], { input: payload })
    .toString()
    .trim()
    .split("\n");
  if (
    listing.some(
      (name) =>
        name.startsWith("/") ||
        name.split("/").includes("..") ||
        /node_modules\/(?!ws\/|$)/.test(name),
    )
  )
    throw new Error("Unsafe or unexpected package entry");
  execFileSync("tar", ["-xzf", "-", "-C", dir], { input: payload });
  execFileSync("sha256sum", ["-c", "MANIFEST.sha256"], { cwd: dir });
  execFileSync("bash", ["-n"], {
    input: parts[0].replace("__BABYCAM_PAYLOAD_BELOW__", ""),
  });
  if (
    JSON.parse(readFileSync(path.join(dir, "package.json"))).version !== version
  )
    throw new Error("Version mismatch");
  console.log(
    "Verified installer syntax, SHA-256, payload manifest, paths, version and bundled dependencies",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
