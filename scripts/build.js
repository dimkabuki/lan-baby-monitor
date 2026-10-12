import {
  mkdirSync,
  mkdtempSync,
  cpSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const root = process.cwd();
const version = JSON.parse(readFileSync("package.json")).version;
if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version))
  throw new Error("Invalid semantic version");
const stage = mkdtempSync(path.join(os.tmpdir(), "babycam-build-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function walk(dir, base = dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      return statSync(file).isDirectory()
        ? walk(file, base)
        : [path.relative(base, file)];
    });
}
try {
  for (const name of [
    "src",
    "public",
    "docs",
    "LICENSE",
    "README.md",
    "package.json",
    "package-lock.json",
  ])
    cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
  // npm verifies ws against the lockfile integrity value; no lifecycle scripts.
  execFileSync(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: stage, stdio: "pipe" },
  );
  rmSync(path.join(stage, "node_modules/.package-lock.json"), { force: true });
  const files = walk(stage);
  writeFileSync(
    path.join(stage, "MANIFEST.sha256"),
    files
      .map((file) => `${digest(readFileSync(path.join(stage, file)))}  ${file}`)
      .join("\n") + "\n",
  );
  const payload = execFileSync(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      "-",
      "-C",
      stage,
      ...readdirSync(stage).sort(),
    ],
    { maxBuffer: 5 * 1024 * 1024 },
  );
  const template = readFileSync("scripts/install-header.sh", "utf8")
    .replaceAll("__VERSION__", version)
    .replaceAll("__PAYLOAD_SHA256__", digest(payload));
  const name = `lan-baby-monitor-v${version}-termux.sh`;
  const installer = Buffer.from(
    template +
      payload
        .toString("base64")
        .match(/.{1,76}/g)
        .join("\n") +
      "\n",
  );
  mkdirSync("dist", { recursive: true });
  writeFileSync(`dist/${name}`, installer, { mode: 0o700 });
  writeFileSync("dist/SHA256SUMS", `${digest(installer)}  ${name}\n`);
  console.log(
    `Built ${name} (${installer.length} bytes); bundled ws only; no runtime npm download`,
  );
} finally {
  rmSync(stage, { recursive: true, force: true });
}
