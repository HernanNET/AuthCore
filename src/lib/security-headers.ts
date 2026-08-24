const ONE_YEAR_IN_SECONDS = 31_536_000;

const DEVELOPMENT_CSP = [
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
  // Vite transforms scripts and styles dynamically in development, so exact
  // hashes do not exist yet. Production replaces this fallback with Astro's
  // generated per-asset SHA-256 policy.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

/**
 * Browser hardening shared by every route. CSP is generated separately by
 * Astro so its runtime can attach exact hashes to the scripts and styles it
 * emits for each SSR response.
 */
export function applySecurityHeaders(
  headers: Headers,
  options: { secureTransport: boolean; sensitive: boolean },
): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", DEVELOPMENT_CSP);
  }
  headers.set(
    "Permissions-Policy",
    [
      "camera=()",
      "geolocation=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      // Preserve same-origin WebAuthn/passkey support while preventing embeds
      // from requesting credentials on AuthCore's behalf.
      "publickey-credentials-create=(self)",
      "publickey-credentials-get=(self)",
    ].join(", "),
  );

  if (options.sensitive) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  }

  // HSTS must never be emitted by localhost over HTTP: browsers would remember
  // it and make local development unexpectedly inaccessible.
  if (options.secureTransport) {
    headers.set(
      "Strict-Transport-Security",
      `max-age=${ONE_YEAR_IN_SECONDS}; includeSubDomains`,
    );
  } else {
    headers.delete("Strict-Transport-Security");
  }
}

export function isSensitivePath(pathname: string): boolean {
  return !(
    pathname.startsWith("/_astro/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}
