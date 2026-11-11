# Production-Readiness Audit — Multi-Provider LLM Gateway

## Summary

The gateway is a well-structured TypeScript full-stack app (Vite + React client, Express + tRPC server) with a clean adapter/routing/circuit-breaker architecture. Its **tRPC layer is solid**: every procedure validates input with zod, and auth/admin middleware is in place. The serious production gaps are all on the **Express/infra side**: no security headers, no CORS config, no rate limiting, no global error handler, no structured/request logging, no `.env.example`, and no env-var validation at startup. The four raw REST gateway endpoints (`/api/gateway/*` in `server/_core/index.ts`) bypass tRPC entirely and accept unvalidated `req.body`. Client error/loading states are only partially handled — mutations surface errors via toast, but the main data queries conflate "loading" with "empty" and have no explicit error UI.

### Scorecard

| # | Area | Verdict |
|---|------|---------|
| 1 | Input validation | PARTIAL |
| 2 | Error handling | PARTIAL |
| 3 | Security headers | MISSING |
| 4 | Rate limiting | MISSING |
| 5 | Logging | PARTIAL |
| 6 | Environment configuration | MISSING |
| 7 | Health check endpoint | PARTIAL |
| 8 | TypeScript strictness | PASS |
| 9 | Accessibility | PARTIAL |
| 10 | Empty/loading/error states | PARTIAL |
| 11 | Secrets safety | PARTIAL |
| 12 | CORS configuration | MISSING |
| 13 | Docker/deployment | PARTIAL |
| 14 | Dependency audit | PARTIAL (could not execute `pnpm audit`) |

---

## Evidence

### 1. Input validation — PARTIAL

**tRPC procedures: fully validated.** `server/routers.ts` validates every mutation/query input with zod: `gateway.updateConfig` (lines 30-35), `gateway.chat` (lines 38-45), `gateway.addLog` (lines 48-56). `server/_core/systemRouter.ts` validates `system.health` (timestamp) and `system.notifyOwner` (title/content). `publicProcedure`/`adminProcedure` middleware in `server/_core/trpc.ts` enforces auth.

**Express REST endpoints: unvalidated.** `server/_core/index.ts` `registerGatewayRoutes` (lines 24-46) reads `req.body` raw and passes it straight to the service:

```ts
app.post("/api/gateway/chat", async (req, res) => {
  const response = await gatewayService.chat(req.body);       // no validation
  res.json(response);
});
app.put("/api/gateway/routing-config", async (req, res) => {
  gatewayService.setConfig(req.body);                         // no validation
  res.json(gatewayService.getConfig());
});
```

`gatewayService.setConfig` (`server/gateway/service.ts:51`) clamps some bounds but trusts the shape; a malformed `req.body` (missing `weights`, non-numeric fields) will throw or silently misbehave. The `chat` route forwards arbitrary `messages`/`model` to adapters.

**Gap:** the four REST routes (`POST /api/gateway/chat`, `GET /api/gateway/providers/health`, `GET /api/gateway/snapshot`, `PUT /api/gateway/routing-config`) need the same zod schemas the tRPC procedures already define, applied as Express middleware before calling the service. The tRPC `gateway.chat`/`gateway.updateConfig` schemas in `routers.ts` can be reused.

### 2. Error handling — PARTIAL

**No global Express error handler.** `server/_core/index.ts` has no error-handling middleware (`app.use((err, req, res, next) => ...)`). The `registerGatewayRoutes` `chat` handler has a local try/catch returning 502 (line 26-28), but `routing-config` (line 42-44), `providers/health`, and `snapshot` have no try/catch — an async rejection becomes an unhandled promise rejection / hanging request. The Vite/SPA catch-all in `vite.ts:30` calls `next(e)` but nothing catches it.

**tRPC error formatting: defaults only.** `server/_core/trpc.ts` creates the instance with just `transformer: superjson` — no `errorFormatter`, no `onError`. Errors serialize with tRPC's default shape. Auth/admin middleware (`trpc.ts:11-25`, `trpc.ts:30-40`) throws typed `TRPCError`s, which is consistent. `notification.ts` throws `TRPCError` for validation/config failures and returns `false` for upstream failures — consistent within itself.

**Client error handling: mutations only.** `client/src/pages/Home.tsx`: `chat` and `updateConfig` mutations use `onError: error => toast.error(error.message)` (lines ~58, ~52). `client/src/pages/Logs.tsx`: `addLog` mutation uses `onError: e => toast.error(e.message)`. But the snapshot queries (`trpc.gateway.snapshot.useQuery`) have no `onError` and no error UI — a failed query renders as empty data (see §10). The `App.tsx` wraps everything in `ErrorBoundary` (`client/src/components/ErrorBoundary.tsx`) which catches render crashes but not data-fetch failures.

**Gap:** add a global Express error handler in `index.ts` before `server.listen`; add `onError`/`errorFormatter` to the tRPC instance; add query-level error UI in the pages.

### 3. Security headers — MISSING

`server/_core/index.ts` sets no security headers. `package.json` has no `helmet` dependency (confirmed: full dependency list read, no `helmet`). No manual `res.set` for `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Referrer-Policy`, or Content-Security-Policy anywhere in `server/` (grep for `helmet|x-content-type|referrer-policy|x-frame|hsts` returned no matches). The only headers set are `Cache-Control: no-store` in `storageProxy.ts:40` and `Content-Type` in the Vite catch-all.

**Gap:** add `helmet` (or equivalent manual headers) to `index.ts` before the route registrations. A CSP must allow the inline styles the client uses (the codebase uses inline `style={{}}` props heavily, so a strict CSP needs `'unsafe-inline'` for styles or refactoring).

### 4. Rate limiting — MISSING

No rate-limiting middleware anywhere. `package.json` has no `express-rate-limit` or similar. The tRPC and REST chat endpoints (`/api/trpc/gateway.chat`, `POST /api/gateway/chat`) are unbounded — a client can flood provider calls, spending quota and risking upstream 429s. The circuit breaker (`server/gateway/circuitBreaker.ts`) protects providers from being called while open, but does not limit inbound request volume.

**Gap:** add `express-rate-limit` on `/api/gateway/*` and `/api/trpc/gateway.chat` (IP-based, with sensible per-window caps). Admin/protection middleware already distinguishes users in `trpc.ts`.

### 5. Logging — PARTIAL

Only ad-hoc `console.*` calls scattered through the server:
- `index.ts:6,47-49` — `console.log` startup/port messages; `console.error` on startup failure.
- `service.ts:57,69` — `console.warn` for persistence skips.
- `oauth.ts:52,55` — `console.error`/`console.warn` for OAuth callback failures.
- `sdk.ts:24-27,171` — `console.log`/`console.error` for OAuth init and auth failures.
- `notification.ts:76,90` — `console.warn` for notification failures.
- `storageProxy.ts:30,36` — `console.error` for storage proxy errors.

No structured logging library (no `pino`, `winston`, or `morgan` in `package.json`). No request-logging middleware that records method, path, status, and latency for each request. Latency is measured per-provider inside `gatewayService.chat` (`service.ts` `startedAt`/`latencyMs`) but never logged at the HTTP boundary.

**Gap:** add a request-logging middleware (e.g. `morgan` with a JSON formatter, or `pino-http`) in `index.ts` after the body parsers; adopt a structured logger and replace the raw `console.*` calls.

### 6. Environment configuration — MISSING

`server/_core/env.ts` reads env vars with `?? ""` fallbacks only:
```ts
cookieSecret: process.env.JWT_SECRET ?? "",
databaseUrl: process.env.DATABASE_URL ?? "",
```
No validation that required vars are present at startup. `sdk.ts:23-27` logs an error if `OAUTH_SERVER_URL` is missing but does not throw or stop boot. A missing `JWT_SECRET` silently becomes `""`, which `sdk.ts` `getSessionSecret` would use as the HMAC key — a critical security failure (anyone can forge sessions).

**No `.env.example`** — confirmed by a recursive search of the project root (`Get-ChildItem -Filter ".env*"` returned nothing). New operators have no manifest of required variables. The README "Quick start" mentions `GROQ_API_KEY`/`GEMINI_API_KEY` but not `JWT_SECRET`, `DATABASE_URL`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, or `OWNER_OPEN_ID`.

**Gap:** create `.env.example` listing every var referenced in `env.ts` plus `GROQ_API_KEY`/`GEMINI_API_KEY`/`PORT`. Add a startup validation (zod schema over `process.env`, or a manual guard) that fails fast in production when `JWT_SECRET`, `DATABASE_URL`, etc. are missing/empty.

### 7. Health check endpoint — PARTIAL

`tRPC` has `system.health` in `server/_core/systemRouter.ts:8-16`, but it requires a `timestamp` input and is served under `/api/trpc/system.health` — not a simple GET a load balancer can hit. There is **no plain REST `/health` or `/api/health`** in `index.ts` (the only `app.get` routes are `/api/gateway/providers/health` and `/api/gateway/snapshot`, which run `gatewayService.hydrate()` and return provider data — heavier than a liveness probe).

**Gap:** add `app.get("/health", (_req, res) => res.json({ status: "ok" }))` (or `/api/health`) in `index.ts` with no dependencies, suitable for liveness/readiness probes. The existing `system.health` tRPC procedure can stay for app-level checks.

### 8. TypeScript strictness — PASS

`tsconfig.json` has `"strict": true` (line in `compilerOptions`). `check` script runs `tsc --noEmit`. A handful of `any` escapes exist but are isolated:
- `server/gateway/adapters.ts:75,124` — `as any` on provider JSON responses.
- `server/_core/sdk.ts:137-138,141,248-249,252` — `as any` on OAuth user-info payloads.
- `server/storage.ts:60` — `data as any` for `Blob` constructor.
- `client/src/pages/Home.tsx:282` — `ProviderRow` props typed `{ provider: any }` (should be `ProviderHealth` from `@shared/gateway`).

These are escape hatches at external API boundaries and one client component; strict mode is otherwise enforced. The `provider: any` in `Home.tsx` is the only one worth tightening to a real type (`ProviderHealth`), since the type already exists.

### 9. Accessibility — PARTIAL

**Good:** aria-labels are present on icon buttons — `Home.tsx`: `aria-label="Account menu"` (user chip, role="button"), `aria-label="Refresh"`, `aria-label="Toggle auto fallback"`. `Logs.tsx`: `aria-label="Back to dashboard"`, `aria-label="Refresh"`, `aria-label="Clear search"`, `aria-label="Toggle fallback used"`. Both pages use Radix `Dialog` (`@/components/ui/dialog`) with `DialogTitle`/`DialogDescription`, which gives focus trapping, Escape-to-close, and `aria-labelledby`/`aria-describedby` automatically. Nav items are `<a>` tags; strategy cards, toggles, provider rows, and action buttons are `<button>` elements (keyboard-focusable).

**Gaps:**
- The filter `<select>` elements in `Logs.tsx` (provider/strategy/status filters, lines ~260-280) and the search `<input>` (`Logs.tsx`, the `logs-search` class) have no `<label>`, no `aria-label`, and no `id`-for-`htmlFor` association — only placeholders.
- The chart `<select>` (`period-select`) in `Home.tsx` and the prompt `<textarea>` likewise lack labels.
- The custom toggle switches (`<button class="toggle">` in both pages) use a visual `<i>` indicator with no `role="switch"` or `aria-checked`/`aria-pressed` — screen readers cannot convey on/off state.
- Color-only status signaling (`status-pill` tones) has no text alternative beyond the status word itself, which is present, so this is acceptable.

**Gap:** add `aria-label` (or visible `<label>`) to all filter selects and the search input; add `role="switch" aria-checked={value}` to the custom toggle buttons.

### 10. Empty / loading / error states — PARTIAL

**Mutations (well handled):** `chat` shows `chat.isPending` ("Routing..." / spinner), `updateConfig` shows `updateConfig.isPending`, `addLog` shows `addLog.isPending` ("Adding…"). All three surface errors via `toast.error`.

**Queries (partially handled):** Both pages call `trpc.gateway.snapshot.useQuery(..., { refetchInterval })`. While loading (`data === undefined`), the pages render empty arrays via `?? []`:
- `Home.tsx`: providers map renders nothing, metrics compute to `0`/`100%`/`0ms`/`0`, and the logs table shows "No requests yet — send one from the Route Playground above" (`Home.tsx`, the `allLogs.length === 0` branch). That message is shown during the initial load too, which is misleading.
- `Logs.tsx`: `allLogs: RequestLog[] = snapshotQuery.data?.logs ?? []`; when loading, `filtered.length === 0` renders "No logs yet. Add one manually..." — conflated with the genuine empty state. No spinner/skeleton distinguishes "loading" from "empty".
- Neither page uses `snapshotQuery.isLoading` / `isError` / `isPending` to branch the UI. There is no error state at all — a rejected query renders as empty data with no message (the `ErrorBoundary` only catches render crashes, not fetch rejections).

**Gap:** branch on `snapshotQuery.isLoading` (show a spinner/skeleton) and `snapshotQuery.isError` (show an error message with a retry button) in both `Home.tsx` and `Logs.tsx`; reserve the "no logs yet" copy for `!isLoading && allLogs.length === 0`.

### 11. Secrets safety — PARTIAL

**Source files: clean.** A search for `sk-|AIza|gsk_|Bearer [A-Za-z0-9]` across `server/**/*.ts` found no hardcoded keys. Provider keys are read from `process.env` at runtime (`adapters.ts:73,99`). Secrets are not echoed to the client.

**Docker Compose: weak defaults.** `docker-compose.yml` ships insecure fallbacks:
```yaml
JWT_SECRET: ${JWT_SECRET:-local-development-secret}     # weak, predictable default
GROQ_API_KEY: ${GROQ_API_KEY:-}
GEMINI_API_KEY: ${GEMINI_API_KEY:-}
```
and hardcoded MySQL credentials:
```yaml
MYSQL_USER: gateway
MYSQL_PASSWORD: gateway
MYSQL_ROOT_PASSWORD: root
```
A deploy that forgets to set `JWT_SECRET` silently boots with a public, guessable signing key — the same risk `env.ts` creates with `?? ""`. The MySQL creds are fine for local dev but must not reach production.

**Gap:** make `JWT_SECRET` required (fail boot if unset, per §6) and remove the `:-local-development-secret` fallback; externalize MySQL credentials via env vars without literal defaults for production.

### 12. CORS configuration — MISSING

No `cors` middleware is applied. `package.json` has no `cors` dependency. `index.ts` never calls `app.use(cors(...))`. This means no `Access-Control-Allow-*` headers are sent. For same-origin (production serves the SPA from the same Express host via `serveStatic`) this is workable, but the REST gateway endpoints (`/api/gateway/*`) and tRPC (`/api/trpc`) cannot be called from any other origin — and the config is "all or nothing" with no explicit policy to tighten later.

**Gap:** add `cors` with an explicit origin allowlist (env-driven, e.g. `CORS_ORIGIN`), not a wildcard, especially before exposing the REST gateway endpoints cross-origin.

### 13. Docker / deployment — PARTIAL

**`docker-compose.yml`: present and functional.** Defines `mysql:8.4` (with volume `gateway_mysql`) and a `gateway` service that builds from the Dockerfile, depends on mysql, and wires `PORT`, `DATABASE_URL`, and provider keys. The `gateway` service does **not** run migrations — there is no `pnpm db:push` / `drizzle-kit migrate` step in `Dockerfile` or compose, so the DB starts empty and the app falls back to file-store (`server/db.ts` `getDb` returns null without `DATABASE_URL`-backed tables; `fileStore.ts` handles logs/config). Operators must run migrations manually.

**`Dockerfile`: solid multi-stage build.** Stage 1 builds (`pnpm install --frozen-lockfile` + `pnpm build`); stage 2 installs prod deps and copies `dist` + `drizzle`. Production `CMD` is `pnpm start` (`node dist/index.js`). No `.dockerignore` was found in the file listing, so `COPY . .` may copy `node_modules`/`dist`/`.manus`/`data` into the build context unnecessarily.

**No `.env.example`** (see §6). The README documents `docker compose up --build` but not the required env vars.

**Gap:** add `.dockerignore` (exclude `node_modules`, `dist`, `.manus*`, `data`); add a migration step to the entrypoint or compose; add `.env.example`.

### 14. Dependency audit — PARTIAL (static review only)

`pnpm audit` was **not run** (read-only audit; executing `pnpm audit` would hit the network and is outside scope). Static review of `package.json`:
- Versions are recent: React `^19.2.1`, Express `^4.21.2`, tRPC `^11.6.0`, Vite `^7.1.7`, drizzle `^0.44.5`, TypeScript `5.9.3`, vitest `^2.1.4`.
- `zod` is pinned to `^4.1.12` — zod v4 is a major version with breaking changes from v3; confirm all schemas behave as expected under v4 (e.g. `.min`/`.max` messages, error formatting).
- No obviously abandoned or typosquatting-looking packages. `pnpm` is listed as a dependency (not just packageManager) via `"add": "^2.0.6"` in devDependencies — an odd leftover; harmless but unnecessary.
- `vite-plugin-manus-runtime` (`0.0.59`) and `@builder.io/vite-plugin-jsx-loc` are template/dev plugins; confirm they are excluded from the production build (they are devDependencies, so they are).

**Gap:** run `pnpm audit --prod` in a writable environment to confirm no known advisories; verify zod v4 schema behavior against the test suite (`pnpm test`).

---

## Conclusions and Recommendations

The application's **business logic** (routing, circuit breakers, adapters, persistence fallback) is production-minded and well-tested (`server/gateway/service.test.ts`, `server/auth.logout.test.ts`). The **production gaps are almost entirely in the Express shell and operational config**. Priority order:

1. **Critical — security & config:**
   - Add env-var validation at startup and make `JWT_SECRET` required (§6, §11). The current `?? ""` fallback is an exploitable session-forgery risk.
   - Add `helmet` / security headers (§3) and an explicit CORS allowlist (§12).
   - Validate the four REST gateway endpoints with zod (§1) — reuse the tRPC schemas.

2. **High — resilience & observability:**
   - Add a global Express error handler and tRPC `onError` (§2).
   - Add rate limiting on chat endpoints (§4).
   - Add a plain `/health` endpoint and request-logging middleware; adopt a structured logger (§5, §7).

3. **Medium — UX & a11y:**
   - Distinguish loading vs. empty vs. error in the snapshot queries on both pages (§10).
   - Add labels to filter selects/search input and `role="switch"`/`aria-checked` to toggles (§9).

4. **Low — deployment hygiene:**
   - Add `.env.example`, `.dockerignore`, and a migration step to the Docker flow (§6, §13).
   - Externalize MySQL credentials and remove the `JWT_SECRET` default in compose (§11).
   - Run `pnpm audit --prod` and confirm zod v4 behavior (§14).

No code was changed during this audit.
