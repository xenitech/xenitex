# SEC-02: non-root, minimal base. Multi-stage so the final image has no build
# toolchain (smaller attack surface, smaller SBOM to review for LEG-04/PRIN-03).
FROM node:20-alpine AS build
# argon2 (SEC-07) ships as a native addon with no prebuilt binary for
# musl/Alpine, so pnpm's install falls back to compiling it from source via
# node-gyp -- which needs python3/make/g++, none of which the bare
# node:20-alpine image includes. This is exactly why the toolchain lives
# only in this `build` stage: the `runtime` stage below never copies it in,
# so the final image stays free of a C compiler (SEC-02's rationale above).
RUN apk add --no-cache python3 make g++
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
# `pnpm deploy` (not a manual node_modules copy) is required here: pnpm's
# strict, non-hoisted node_modules puts a workspace app's actual dependencies
# (fastify, zod, ...) only in that package's own node_modules, as symlinks
# with RELATIVE paths back into the workspace root's .pnpm store. Copying
# `/repo/node_modules` alone misses them entirely (ERR_MODULE_NOT_FOUND);
# copying both directories still breaks because flattening into `/app`
# changes the relative path depth the symlinks depend on. `pnpm deploy`
# materialises a self-contained package directory with real files and
# symlinks whose relative paths are valid on their own -- verified by
# actually running the deployed output with `node dist/server.js` and
# hitting /healthz before this Dockerfile was written this way.
RUN pnpm --filter @xenitex/api... build && \
    pnpm --filter @xenitex/api deploy --prod /out

FROM node:20-alpine AS runtime
# Fixed uid/gid (not addgroup/adduser's default incidental allocation): the
# blobstore-init service in docker-compose.yml chowns the shared volume to
# this exact id before api/worker start, so it must be a stable number, not
# whatever the base image happens to hand out first.
RUN addgroup -g 10001 -S xenitex && adduser -u 10001 -S xenitex -G xenitex
WORKDIR /app
COPY --from=build /out .
USER xenitex
EXPOSE 8443
CMD ["node", "dist/server.js"]
