import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isIP } from "node:net";
export const home =
  process.env.BABYCAM_HOME ??
  path.join(os.homedir(), ".local/share/lan-baby-monitor");
export const configPath = path.join(home, "config.json");
export function loadConfig() {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  let input = {};
  try {
    input = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT")
      throw new Error("Invalid config.json: fix or remove the file");
  }
  const port = Number(process.env.BABYCAM_PORT ?? input.port ?? 8765);
  const lanIp = process.env.BABYCAM_LAN_IP || input.lanIp || null;
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Port must be an integer from 1024 to 65535");
  if (
    lanIp !== null &&
    (isIP(lanIp) !== 4 || lanIp.startsWith("127.") || lanIp === "0.0.0.0")
  )
    throw new Error("lanIp must be a non-loopback IPv4 address");
  if (!Object.keys(input).length)
    writeFileSync(configPath, JSON.stringify({ port, lanIp }, null, 2) + "\n", {
      mode: 0o600,
    });
  return { port, lanIp };
}
