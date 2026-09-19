import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import cloudflare from "@astrojs/cloudflare";

/**
 * The Cloudflare adapter is selected with ASTRO_ADAPTER=cloudflare so local
 * development, migrations and the Playwright suite keep running on Node while
 * the production build targets Workers. ASTRO_ADAPTER is only consulted for
 * `astro build` (the deployment platform sets it).
 */
const adapterName = process.env.ASTRO_ADAPTER ?? "node";

export default defineConfig({
  output: "server",
  adapter: adapterName === "cloudflare" ? cloudflare() : node({ mode: "standalone" }),
  security: {
    checkOrigin: true,
    csp: {
      algorithm: "SHA-256",
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "manifest-src 'self'",
        "media-src 'self'",
        "worker-src 'self' blob:",
      ],
      // Astro adds SHA-256 hashes for every emitted inline script/style. Keeping
      // only same-origin resources here avoids weakening CSP with unsafe-inline.
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'"] },
    },
  },
  server: {
    port: 4321,
    host: true,
  },
});
