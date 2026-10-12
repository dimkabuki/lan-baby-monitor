import { createServer } from "./server.js";
let app;
let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => process.exit(code), 3000);
  force.unref();
  await app?.close();
  process.exit(code);
}
try {
  app = await createServer({
    port: Number(process.env.BABYCAM_PORT ?? 8765),
    instance: process.env.BABYCAM_INSTANCE ?? null,
    onLifecycle: (action) => close(action === "restart" ? 75 : 0),
  });
  console.log(`Server ready on port ${app.port}`);
} catch (e) {
  console.error(`Startup failed: ${e.code ?? e.message}`);
  process.exit(1);
}
process.on("SIGTERM", () => close(0));
process.on("SIGINT", () => close(0));
