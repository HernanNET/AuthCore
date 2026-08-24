import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("1 — Docker dependency installation is pinned and frozen", async () => {
  const dockerfile = await source("Dockerfile");
  const packageJson = JSON.parse(await source("package.json"));
  expect(packageJson.packageManager).toBe("pnpm@11.6.0");
  expect(dockerfile).toContain("FROM node:24.15.0-alpine AS base");
  expect(dockerfile).toContain("pnpm install --frozen-lockfile");
});

test("2 — the image uses separate build, migration, and runtime stages", async () => {
  const dockerfile = await source("Dockerfile");
  expect(dockerfile).toContain("AS build");
  expect(dockerfile).toContain("AS migration");
  expect(dockerfile).toContain("AS runtime");
  expect(dockerfile).toContain("COPY --from=build --chown=node:node /app/dist ./dist");
});

test("3 — build-only values are disposable and checked out of the bundle", async () => {
  const dockerfile = await source("Dockerfile");
  expect(dockerfile).toContain("authcore-docker-build-only-not-a-secret");
  expect(dockerfile).toContain('! grep -R "authcore-docker-build-only-not-a-secret" dist');
  expect(dockerfile).not.toMatch(/COPY\s+\.env/);
});

test("4 — runtime is non-root and receives termination directly", async () => {
  const dockerfile = await source("Dockerfile");
  expect(dockerfile).toContain("USER node");
  expect(dockerfile).toContain("STOPSIGNAL SIGTERM");
  expect(dockerfile).toContain('CMD ["node", "./scripts/start-production.mjs"]');

  const launcher = await source("scripts/start-production.mjs");
  expect(launcher).toContain('process.once("SIGTERM"');
  expect(launcher).toContain("closeIdleConnections");
  expect(launcher).toContain("10_000");
});

test("5 — container healthcheck uses the safe readiness endpoint", async () => {
  const dockerfile = await source("Dockerfile");
  expect(dockerfile).toContain("HEALTHCHECK --interval=30s");
  expect(dockerfile).toContain("http://127.0.0.1:4321/api/health");
});

test("6 — Docker context excludes secrets, tests, VCS, and local output", async () => {
  const ignored = await source(".dockerignore");
  for (const entry of [".env", ".env.*", ".git", "dist", "node_modules", "tests"]) {
    expect(ignored.split(/\r?\n/)).toContain(entry);
  }
});

test("7 — Compose gates startup on migrations and drops runtime privileges", async () => {
  const compose = await source("docker-compose.production.yml");
  expect(compose).toContain("condition: service_completed_successfully");
  expect(compose).toContain("read_only: true");
  expect(compose).toContain("no-new-privileges:true");
  expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/);
  expect(compose).toContain('127.0.0.1:${AUTHCORE_HOST_PORT:-4321}:4321');
  expect(compose).toContain("${AUTHCORE_PROD_BETTER_AUTH_SECRET:?");
});

test("8 — production example contains no usable secret or database credential", async () => {
  const example = await source(".env.production.example");
  expect(example).toMatch(/^AUTHCORE_PROD_BETTER_AUTH_SECRET=$/m);
  expect(example).toMatch(/^AUTHCORE_PROD_DATABASE_URL=$/m);
  expect(await source(".gitignore")).toMatch(/^\.env\.production$/m);
});
