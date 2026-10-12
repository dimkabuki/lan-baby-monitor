import { readFileSync } from "node:fs";
const version = JSON.parse(readFileSync("package.json")).version;
if (process.argv[2] !== `v${version}`)
  throw new Error("Release tag must match package.json version");
if (
  !version.includes("-") &&
  !readFileSync("docs/android-acceptance.md", "utf8").includes("Status: PASSED")
)
  throw new Error("Stable release requires recorded real Android acceptance");
console.log(`Validated release v${version}`);
