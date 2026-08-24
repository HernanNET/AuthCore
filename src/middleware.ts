import { defineMiddleware } from "astro:middleware";
import { env } from "./lib/env";
import { applySecurityHeaders, isSensitivePath } from "./lib/security-headers";

const configuredOriginUsesHttps =
  new URL(env.BETTER_AUTH_URL).protocol === "https:";

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

  applySecurityHeaders(response.headers, {
    secureTransport: configuredOriginUsesHttps,
    sensitive: isSensitivePath(context.url.pathname),
  });

  return response;
});
