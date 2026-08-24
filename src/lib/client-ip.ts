import { isIP } from "node:net";

export type ProxyMode = "direct" | "cloudflare";

const FORWARDED_HEADERS = [
  "cf-connecting-ip",
  "forwarded",
  "x-forwarded-for",
  "x-real-ip",
] as const;

function normalizeAddress(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.includes(",") || candidate.includes(";")) return null;
  const normalized = candidate.startsWith("::ffff:")
    ? candidate.slice("::ffff:".length)
    : candidate;
  return isIP(normalized) ? normalized : null;
}

/**
 * Resolve a client IP without ever forwarding an untrusted browser header to
 * Better Auth. In direct mode, the socket address is accepted only when no
 * proxy header was supplied. Cloudflare mode accepts CF-Connecting-IP and is
 * safe only when the origin server is network-restricted to Cloudflare.
 */
export function resolveClientIp(input: {
  headers: Headers;
  directAddress?: string | null;
  proxyMode: ProxyMode;
}): string | null {
  if (input.proxyMode === "cloudflare") {
    return normalizeAddress(input.headers.get("cf-connecting-ip"));
  }

  if (FORWARDED_HEADERS.some((header) => input.headers.has(header))) {
    return null;
  }
  return normalizeAddress(input.directAddress);
}

export function withTrustedClientIp(request: Request, clientIp: string | null): Request {
  const headers = new Headers(request.headers);
  // A browser-supplied value is always discarded before the request reaches
  // Better Auth. Only the value resolved above may use this internal header.
  headers.delete("x-authcore-client-ip");
  headers.delete("x-authcore-test-client-ip");
  if (clientIp) headers.set("x-authcore-client-ip", clientIp);
  return new Request(request, { headers });
}
