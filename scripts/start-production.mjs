process.env.ASTRO_NODE_AUTOSTART = "disabled";

const { startServer } = await import("../dist/server/entry.mjs");
const runtime = startServer();
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[authcore] received ${signal}; draining HTTP connections.`);

  const forceTimer = setTimeout(async () => {
    console.error("[authcore] graceful shutdown timed out; forcing close.");
    try {
      await runtime.server.stop();
    } finally {
      process.exit(1);
    }
  }, 10_000);
  forceTimer.unref();

  runtime.server.server.close((error) => {
    clearTimeout(forceTimer);
    if (error) {
      console.error("[authcore] HTTP shutdown failed.", error);
      process.exit(1);
    }
    console.log("[authcore] HTTP server stopped cleanly.");
    process.exit(0);
  });
  runtime.server.server.closeIdleConnections?.();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
if (process.env.AUTHCORE_SHUTDOWN_TEST === "1") {
  process.once("message", (message) => {
    if (message === "SIGTERM") shutdown("SIGTERM");
  });
}

await runtime.done;
