# ADR 0011: Frontend application stack — routing, data fetching, i18n

- Status: Accepted
- Requirements: `P1-01`–`P1-26`, `SCOPE-01`/`SCOPE-02`, `2.2`

## Context

ADR 0009 fixed React + Vite for `apps/web` but left routing, server-state
management, and internationalisation unresolved — those choices weren't
needed until Step 3 actually builds screens against them. `P1-25` (every
filter/sort/pagination position in the URL) and `P1-20` (i18n from the first
commit, full RTL) make these load-bearing rather than cosmetic, so they're
decided once, here, rather than per-screen.

## Decision

**`react-router-dom` v6** for routing. Rejected: a hand-rolled router — URL
search-param sync, nested layouts (the persistent global-stop control and
nav shell per `SAFE-07`), and code-splitting per route are all solved
problems `react-router-dom` already covers; reinventing them costs more
than the dependency.

**`@tanstack/react-query` + `openapi-react-query`** for server state.
`openapi-react-query` generates typed query/mutation hooks directly from the
same `openapi-fetch` client (`packages/contracts`) Step 2.2 already
produced — no second, hand-written data-fetching layer to keep in sync with
the contract. `react-query`'s cache also gives the `ETag`/`If-Match`
concurrency flow (ADR 0006) a natural home: a mutation's `onSuccess`
invalidates the query, the next fetch carries the fresh `ETag`.

**`i18next` + `react-i18next`** for i18n, English and Persian from the first
screen (`P1-20`). Rejected: hand-rolled key-lookup — pluralisation and
interpolation are exactly the part worth not re-implementing, and both
packages are ordinary bundled npm dependencies (no CDN, no runtime fetch of
translation files from a third party — `P1-26` is about not calling out to
external services at runtime, not about which npm packages a self-hosted
bundle is built from). Locale files live in `apps/web/src/i18n/locales/`,
loaded statically (bundled, not fetched) since the appliance is air-gapped.

**RTL mechanics**: `document.dir` toggled at the document root (already
wired in `.storybook/preview.tsx`'s direction decorator); component CSS uses
logical properties (`margin-inline-start`, not `margin-left`) throughout so
direction flips automatically rather than needing per-direction overrides.
Number and date formatting goes through `Intl.NumberFormat`/
`Intl.DateTimeFormat` with the active locale, never hand-formatted strings,
so digit shaping and date ordering follow the locale correctly.

## Consequences

- Every screen's loading/empty/error/permission-denied state (`3.1`–`3.9`)
  is a `react-query` query state (`isPending`/`isError`/`data`), not a
  hand-rolled `useEffect` + local state per screen — this is what makes
  "every screen has all four states" tractable across ~15 screens rather
  than each one drifting slightly.
- Adding a real backend in Step 4 requires no frontend change beyond
  pointing `createXenitexClient`'s `baseUrl` at it — the mock server and
  the real API are both just implementations of the same `openapi.yaml`
  contract (GATE 2).
- Bundle budget (`P1-26`) must account for these three dependencies plus
  `react-router-dom`; the CI budget check (Step 3) is set with that in mind
  rather than sized for a bare React app.

## Alternatives considered

- **Redux/Zustand for server state.** Rejected: these solve client state,
  not server-cache invalidation/ETag flows; `react-query` is the narrower,
  better-fitting tool for a screen set that is almost entirely "fetch,
  paginate, mutate, refetch."
- **next-intl or a custom Context-based i18n.** Rejected: this is a Vite
  SPA, not Next.js, and a custom Context reimplements pluralisation rules
  `i18next` already has correct for Persian's plural forms.
