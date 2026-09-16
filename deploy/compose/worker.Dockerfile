# SEC-02/SEC-03: non-root, separate image from the API, no database credentials
# baked in (they arrive via env_file at runtime, same as the API container).
FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
# `pnpm deploy`, not a manual node_modules copy -- see api.Dockerfile's
# comment for why a plain COPY of node_modules produces ERR_MODULE_NOT_FOUND
# under pnpm's strict linking. Worker has no runtime npm dependency yet
# (Step 4 adds BullMQ etc.), but deploying it the same way now means this
# doesn't silently break the moment one is added.
RUN pnpm --filter @xenitex/worker... build && \
    pnpm --filter @xenitex/worker deploy --prod /out

FROM node:20-alpine AS runtime
# P2-04's network-discovery adapter is a pure-Node TCP-connect + banner-grab
# implementation (packages/scanner-adapters/src/tcp-connect-adapter.ts), not
# a wrapped Nmap binary — docs/licence-review.md Finding 1 (LEG-02) is
# explicit that Nmap/NPSL bundling is blocked on an OEM licence decision
# that hasn't been made, and its own recommendation is "do not default to
# bundling Nmap in the reference build until path 1 is actually resolved".
# This is licence-review.md's option 3 (component substitution): no new
# binary, no new licence question, and LEG-03's adapter boundary means
# swapping in a real Nmap adapter later (once/if the OEM licence is
# purchased) touches only this package, never the pipeline above it.
# Fixed uid/gid, matching api.Dockerfile -- see its comment. Both share the
# `blobstore` volume, which blobstore-init chowns to this id ahead of time.
RUN addgroup -g 10001 -S xenitex && adduser -u 10001 -S xenitex -G xenitex \
  && mkdir -p /var/run/xenitex-job && chown xenitex:xenitex /var/run/xenitex-job
WORKDIR /app
COPY --from=build /out .
USER xenitex
CMD ["node", "dist/main.js"]
