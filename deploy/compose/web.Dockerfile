# Static build served by a minimal, non-root nginx. No CDN, no external fonts —
# everything the panel needs ships in this image (P1-26).
FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @xenitex/web... build

FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY deploy/compose/web-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
