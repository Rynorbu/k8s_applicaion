# syntax=docker/dockerfile:1.7
# Build context: repository root (npm workspaces share one lockfile).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
RUN npm ci --workspace=frontend --include-workspace-root=false --no-audit --no-fund
COPY frontend frontend
RUN npm run build --workspace=frontend

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ENV GATEWAY_UPSTREAM=api-gateway:8080
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
