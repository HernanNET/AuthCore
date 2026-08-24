# syntax=docker/dockerfile:1.7
FROM node:24.15.0-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
# Astro evaluates server modules while bundling. These deliberately invalid,
# non-secret values satisfy startup validation and must never reach runtime.
ENV AUTH_ENV=development \
    BETTER_AUTH_URL=http://localhost:4321 \
    BETTER_AUTH_SECRET=authcore-docker-build-only-not-a-secret \
    DATABASE_URL=postgres://build:build@database.invalid:5432/build
RUN pnpm build \
    && ! grep -R "authcore-docker-build-only-not-a-secret" dist

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

# One-shot image target used by Compose before the runtime starts.
FROM build AS migration
ENV NODE_ENV=production AUTH_ENV=production
USER node
CMD ["pnpm", "db:migrate"]

FROM node:24.15.0-alpine AS runtime
LABEL org.opencontainers.image.title="AuthCore" \
      org.opencontainers.image.description="Standalone Better Auth service" \
      org.opencontainers.image.source="https://socialdrinking.it"

ENV NODE_ENV=production \
    AUTH_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    ASTRO_NODE_LOGGING=disabled
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node scripts/start-production.mjs ./scripts/start-production.mjs
RUN mkdir -p /app/.astro && chown node:node /app/.astro

USER node
EXPOSE 4321
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4321/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "./scripts/start-production.mjs"]
