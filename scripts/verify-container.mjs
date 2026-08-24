import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { readFile } from "node:fs/promises";

const [dockerfile, dockerignore, compose] = await Promise.all([
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
  readFile(new URL("../docker-compose.production.yml", import.meta.url), "utf8"),
]);

assert.match(dockerfile, /FROM node:24\.15\.0-alpine AS runtime/);
assert.match(dockerfile, /USER node/);
assert.match(dockerfile, /HEALTHCHECK/);
assert.match(dockerfile, /CMD \["node", "\.\/scripts\/start-production\.mjs"\]/);
assert.doesNotMatch(dockerfile, /COPY \.env/);
assert.match(dockerignore, /^\.env\.\*$/m);
assert.match(compose, /condition: service_completed_successfully/);
assert.match(compose, /no-new-privileges:true/);
assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
assert.match(compose, /read_only: true/);

const port = 4391;
const child = fork("scripts/start-production.mjs", [], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    AUTH_ENV: "development",
    HOST: "127.0.0.1",
    PORT: String(port),
    ASTRO_NODE_LOGGING: "disabled",
    AUTHCORE_SHUTDOWN_TEST: "1",
  },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

async function waitForReady() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready\n${logs}`);
}

await waitForReady();
child.send("SIGTERM");
const result = await Promise.race([
  new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
  new Promise((_, reject) => setTimeout(() => reject(new Error("SIGTERM timeout")), 12_000)),
]);
assert.deepEqual(result, { code: 0, signal: null });
assert.match(logs, /received SIGTERM; draining HTTP connections/);
assert.match(logs, /HTTP server stopped cleanly/);

console.log("[authcore] container contract and graceful shutdown verified.");
