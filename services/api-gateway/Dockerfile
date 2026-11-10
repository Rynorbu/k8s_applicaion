# syntax=docker/dockerfile:1.7
# api-gateway - build context is the repository root:
#   docker build -f services/api-gateway/Dockerfile -t spendwise/api-gateway .

# 1) Collect only package manifests so the dependency layer is cached until they change.
FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out && find . -name package.json -not -path '*/node_modules/*' | tar -cf - -T - package-lock.json | tar -xf - -C /out

# 2) Install production dependencies for this workspace only.
FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=manifests /out ./
RUN npm ci --omit=dev --workspace=services/api-gateway --include-workspace-root=false --no-audit --no-fund \
 && npm cache clean --force \
 && mkdir -p services/api-gateway/node_modules shared/common/node_modules

# 3) Minimal runtime: non-root user, tini as PID 1 for correct signal handling.
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini && apk upgrade --no-cache
ENV NODE_ENV=production \
    SERVICE_NAME=api-gateway \
    PORT=8080 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/services/api-gateway/node_modules ./services/api-gateway/node_modules
COPY --chown=node:node shared/common ./shared/common
COPY --chown=node:node services/api-gateway/package.json ./services/api-gateway/package.json
COPY --chown=node:node services/api-gateway/src ./services/api-gateway/src
USER node
WORKDIR /app/services/api-gateway
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health/live >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "@spendwise/common/tracing", "src/index.js"]
