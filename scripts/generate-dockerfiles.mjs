#!/usr/bin/env node
/**
 * (Re)generates services/<name>/Dockerfile from one hardened template so all 17
 * images follow the same conventions. Each service still owns an independent
 * Dockerfile (and can diverge if it needs to).
 */
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORTS = {
  'api-gateway': 8080, 'auth-service': 4001, 'user-service': 4002, 'expense-service': 4003, 'income-service': 4004,
  'category-service': 4005, 'budget-service': 4006, 'recurring-service': 4007, 'goal-service': 4008,
  'analytics-service': 4009, 'notification-service': 4010, 'report-service': 4011, 'search-service': 4012,
  'currency-service': 4013, 'audit-service': 4014, 'ai-service': 4015, 'file-service': 4016,
};
const NATIVE = new Set(); // argon2 ships prebuilt musl binaries (node-gyp-build); add a service here if it needs a toolchain
const DATA_DIRS = { 'report-service': '/data/reports', 'file-service': '/data/files' };

for (const name of readdirSync('services')) {
  const port = PORTS[name];
  if (!port) continue;
  const dataDir = DATA_DIRS[name];
  const dockerfile = `# syntax=docker/dockerfile:1.7
# ${name} - build context is the repository root:
#   docker build -f services/${name}/Dockerfile -t spendwise/${name} .

# 1) Collect only package manifests so the dependency layer is cached until they change.
FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out && find . -name package.json -not -path '*/node_modules/*' | tar -cf - -T - package-lock.json | tar -xf - -C /out

# 2) Install production dependencies for this workspace only.
FROM node:22-alpine AS deps
WORKDIR /app
${NATIVE.has(name) ? 'RUN apk add --no-cache python3 make g++\n' : ''}COPY --from=manifests /out ./
RUN npm ci --omit=dev --workspace=services/${name} --include-workspace-root=false --no-audit --no-fund \\
 && npm cache clean --force \\
 && mkdir -p services/${name}/node_modules shared/common/node_modules

# 3) Minimal runtime: non-root user, tini as PID 1 for correct signal handling.
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini && apk upgrade --no-cache
ENV NODE_ENV=production \\
    SERVICE_NAME=${name} \\
    PORT=${port} \\
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/services/${name}/node_modules ./services/${name}/node_modules
COPY --chown=node:node shared/common ./shared/common
COPY --chown=node:node services/${name}/package.json ./services/${name}/package.json
COPY --chown=node:node services/${name}/src ./services/${name}/src
${name === 'api-gateway' ? '' : `COPY --chown=node:node services/${name}/migrations ./services/${name}/migrations\n`}${dataDir ? `RUN mkdir -p ${dataDir} && chown -R node:node ${dataDir}\nVOLUME ${dataDir}\n` : ''}USER node
WORKDIR /app/services/${name}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \\
  CMD wget -qO- http://127.0.0.1:${port}/health/live >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "@spendwise/common/tracing", "src/index.js"]
`;
  writeFileSync(path.join('services', name, 'Dockerfile'), dockerfile);
  console.log(`wrote services/${name}/Dockerfile`);
}
