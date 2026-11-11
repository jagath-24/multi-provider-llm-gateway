# Investigation: Non-functional buttons & controls in the relayops dashboard

## Summary answer

The live dashboard is a **single file, `client/src/pages/Home.tsx`**, mounted at the only real route (`/`). Every control the user can see lives there. Of the ~15 interactive controls, **most are fully wired to a working tRPC API**: the Refresh button, the four strategy radios, the failure-threshold / cooldown inputs, the auto-fallback toggle, Save routing policy, the Send request button, and the Simulate-failure button all call real backend procedures in `server/gateway/service.ts` that persist to the DB.

The genuinely broken / stubbed controls are:

1. **Sidebar `user-chip` (the "Alex Rivera" account chip with a ChevronDown)** — looks like a dropdown trigger but has **no `onClick` handler at all**. Clicking does nothing. (`Home.tsx:92`)
2. **Chart panel period `<select>` ("Last 24 hours" / "Last 7 days")** — has **no `onChange`**; the bars are a hardcoded static array, so picking "7d" changes nothing. (`Home.tsx:105`)
3. **Header "Settings" button** — only `toast.info(...)`; no settings panel/dialog exists. (`Home.tsx:97`)
4. **"Manage adapters" button** (Providers panel) — only `toast.info(...)`; no adapter management UI exists. (`Home.tsx:104`)
5. **"View all logs" button** (Observability) — just calls `snapshotQuery.refetch()` (a duplicate of Refresh); it does not open a full-logs view. The server returns up to 50 logs but the client only ever renders the first 5 (`slice(0, 5)`). (`Home.tsx:111`, server `service.ts` returns `.slice(0, 50)`)

Additionally, two whole components are **dead code in the running app** and should not be confused with the visible UI:
- `client/src/components/DashboardLayout.tsx` (placeholder nav "Page 1"/"Page 2" → `/some-path`, which has no route and would 404) is **never rendered** — `App.tsx` mounts `<Home>` directly.
- `client/src/components/AIChatBox.tsx` is only used in `pages/ComponentShowcase.tsx`, which has **no route** in `App.tsx` (only `/` and `/404`), so it is unreachable.

The sidebar nav items (Overview / Providers / Routing rules / Request logs) are **not wouter routes** — they are plain `<a href="#id">` in-page scroll anchors, and the panels with matching `id`s exist, so scrolling works. Their only defect is that the "active" highlight is hardcoded onto Overview and never updates when another item is clicked (cosmetic, not broken).

## Architecture context (where things actually live)

- **Routing** — `client/src/App.tsx:10`: `<Switch>` with `Route path="/"` → `Home`, `Route path="/404"` → `NotFound`, and a catch-all `Route` → `NotFound`. There are exactly two destinations: `/` and `/404`. There are **no routes** for Providers / Routing / Logs.
- **The dashboard UI** is entirely `client/src/pages/Home.tsx` (a self-contained single-page layout with its own inline sidebar, topbar, panels). It is **not** wrapped in `DashboardLayout`.
- **Data layer** — `client/src/lib/trpc.ts` builds the typed client from `AppRouter` (`server/routers.ts`). `Home.tsx` uses three procedures:
  - `trpc.gateway.snapshot` (query, `refetchInterval: 10000`)
  - `trpc.gateway.updateConfig` (mutation)
  - `trpc.gateway.chat` (mutation)
- **Server backing** — `server/routers.ts` defines `gateway.snapshot`, `gateway.health`, `gateway.config`, `gateway.updateConfig`, `gateway.chat`, all delegating to `gatewayService` (`server/gateway/service.ts`). `service.ts` persists config via `saveRoutingConfig` and logs via `saveGatewayLog` (`server/db.ts`). `server/_core/index.ts` also exposes equivalent REST endpoints (`POST /api/gateway/chat`, `GET /api/gateway/snapshot`, `GET /api/gateway/providers/health`, `PUT /api/gateway/routing-config`) — the client uses tRPC, not these.
- **Types** — `shared/gateway.ts`: `ProviderId = "groq" | "gemini"`, `RoutingStrategy` union, `RoutingConfig`, `GatewaySnapshot`, etc. These match what `Home.tsx` imports and what the zod input schemas in `routers.ts` validate.

## Control-by-control inventory

Legend: ✅ fully working · 🟡 partially working / stub (gives feedback but no real feature) · ❌ broken / no-op · ➖ non-interactive (display only).

### Sidebar

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 1 | Overview nav item | `Home.tsx:84` | `<a className="nav-item active" href="#overview">` (anchor, no onClick) | ✅ Scrolls to `#overview` (exists). "active" is hardcoded; never updates on click. Not a wouter route. |
| 2 | Providers nav item | `Home.tsx:85` | `<a href="#providers">` | ✅ Scrolls to `#providers` (panel exists, `Home.tsx:104`). No active tracking. |
| 3 | Routing rules nav item | `Home.tsx:86` | `<a href="#routing">` | ✅ Scrolls to `#routing` (panel exists, `Home.tsx:108`). No active tracking. |
| 4 | Request logs nav item | `Home.tsx:87` | `<a href="#logs">` | ✅ Scrolls to `#logs` (panel exists, `Home.tsx:111`). No active tracking. |
| 5 | Account `user-chip` ("Alex Rivera" + ChevronDown) | `Home.tsx:92` | **none** | ❌ No `onClick`. The ChevronDown icon implies an account menu/dropdown, but the chip is a plain `<div>` with no handler. Nothing happens on click. |

Note on nav: the brief asks whether "wouter routes exist for each nav item destination." They do **not** — only `/` and `/404` exist (`App.tsx:10`). The nav intentionally uses in-page hash anchors, so the destinations are sections on the same page, not separate routes. Scrolling works; the only defect is the static active highlight.

### Header / topbar

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 6 | "All systems nominal" live-status | `Home.tsx:97` | none (static `<span>`) | ➖ Hardcoded label, not driven by provider health. |
| 7 | Refresh button (cycle icon) | `Home.tsx:97` | `onClick={() => void snapshotQuery.refetch()}` | ✅ Re-runs the tRPC snapshot query; spinner shows via `snapshotQuery.isFetching`. |
| 8 | Settings button | `Home.tsx:97` | `onClick={() => toast.info("API keys are managed as server-side project secrets.")}` | 🟡 **Stub.** Shows an info toast only. No settings dialog/panel/route exists anywhere in `Home.tsx`. |

### Metric grid

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 9 | Metric cards (Requests / Success / Latency / Fallback) | `Home.tsx:101` | none (display) | ➖ Values come from `metrics` (derived from snapshot). The `delta` strings (`"+18.4%"`, `"+2.1%"`, `"−8.6%"`, `"−12.3%"`) and the `up` flag are **hardcoded literals**, not computed from data. Not buttons; noted as a data-fidelity gap. |

### Providers panel

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 10 | Provider rows (Groq / Gemini) | `Home.tsx:104`, rendered by `ProviderRow` `Home.tsx:122-124` | `onClick={() => setActiveProvider(provider.id)}` | ✅ Sets local `activeProvider` state; that selection drives the "Simulate {activeProvider} failure" button label and target. Purely local state (no API call), which is correct here. |
| 11 | "Manage adapters" button | `Home.tsx:104` | `onClick={() => toast.info("Provider adapters are isolated server-side. Add keys in project secrets.")}` | 🟡 **Stub.** Toast only; no adapter management UI. |

### Chart panel

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 12 | Period `<select>` (24h / 7d) | `Home.tsx:105` | **none** — uses `defaultValue="24h"` only, no `onChange` | ❌ Selecting "7d" has no effect. The bar heights are a hardcoded array `[44, 58, 47, 72, 63, 86, 78, 91, 68, 82, 76, 96]` and the legend ("Groq 64% / Gemini 36%", "2,847 total") is static. The control is decorative. |

### Routing Policy panel

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 13 | Strategy radio cards (Fallback on failure / Round robin / Cheapest first / Fastest first) | `Home.tsx:108` | `onClick={() => setStrategy(option.value)}` | ✅ Updates local `strategy` state; selection visuals update. Persisted when Save is pressed. |
| 14 | Failure threshold input | `Home.tsx:108` | `onChange={event => setFailureThreshold(Number(event.target.value))}` | ✅ Local state; persisted on Save. Server clamps to 1–20 (`routers.ts` zod + `service.ts:setConfig`). |
| 15 | Recovery cooldown input | `Home.tsx:108` | `onChange={event => setRecoverySeconds(Number(event.target.value))}` | ✅ Local state; persisted on Save. Server clamps to 5–3600. |
| 16 | Auto fallback toggle | `Home.tsx:108` | `onClick={() => setFallbackEnabled(value => !value)}` | ✅ Local state; persisted on Save. |
| 17 | Save routing policy button | `Home.tsx:108` | `onClick={saveConfig}` → `Home.tsx:75` `updateConfig.mutate({strategy, fallbackEnabled, failureThreshold, recoverySeconds, weights})` | ✅ Calls tRPC `gateway.updateConfig` → `gatewayService.setConfig` (clamps + reconfigures circuit breakers) → `saveRoutingConfig` (DB). On success toasts "Routing policy saved" and invalidates snapshot. `disabled={updateConfig.isPending}` while in flight. |

### Route Playground panel

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 18 | Prompt textarea | `Home.tsx:109` | `onChange={event => setPrompt(event.target.value)}` | ✅ Local state; sent with the request. |
| 19 | Send request button | `Home.tsx:109` | `onClick={() => sendChat()}` → `Home.tsx:76` `chat.mutate({messages, strategy, simulateFailureProvider: undefined})` | ✅ Calls tRPC `gateway.chat` → `GatewayService.chat`. On success sets `demoResponse` and toasts provider + latency. `disabled={chat.isPending}`. |
| 20 | Simulate {activeProvider} failure button | `Home.tsx:109` | `onClick={() => sendChat(activeProvider)}` → `chat.mutate({..., simulateFailureProvider: activeProvider})` | ✅ Calls `chat` with `simulateFailureProvider`; server (`service.ts:chat`) records a simulated failure, trips the breaker, and demonstrates fallback to the next provider/demo. Label reflects the selected provider. `disabled={chat.isPending}`. |
| 21 | Response box (display) | `Home.tsx:109` | none | ➖ Shows `demoResponse`; chip shows `chat.data?.provider` + `latencyMs`. Works as a display. |

### Observability panel

| # | Control | Location | Handler | Verdict |
|---|---------|----------|---------|---------|
| 22 | "View all logs" button | `Home.tsx:111` | `onClick={() => void snapshotQuery.refetch()}` | 🟡 **Misleading.** Identical action to the Refresh button (just refetches the snapshot). There is no "all logs" view or route. The client renders only `(snapshot?.logs ?? []).slice(0, 5)` even though the server returns up to 50 logs (`service.ts` `logs.slice(0, 50)`). It does not show more logs or navigate anywhere. |
| 23 | Log rows (display) | `Home.tsx:111` | none | ➖ Renders the latest 5 logs from the snapshot. |

## Evidence: server actually backs the working controls

- `server/routers.ts` — `gateway` router defines `snapshot`, `health`, `config`, `updateConfig`, `chat` as `publicProcedure`s; `updateConfig` and `chat` validate input with zod schemas that match the client payloads.
- `server/gateway/service.ts`:
  - `setConfig()` clamps `failureThreshold`/`recoverySeconds`/`weights`, reconfigures both `CircuitBreaker`s, and calls `saveRoutingConfig` (DB persistence).
  - `chat()` honors `strategy`, `simulateFailureProvider`, and `fallbackEnabled`; on simulated failure it records the failure, logs it, and falls through to the next provider or the demo adapter.
  - `snapshot()` returns `{ config, providers, logs }` with `logs.slice(0, 50)`.
- `server/_core/index.ts` — registers the tRPC adapter at `/api/trpc` and the REST equivalents; REST exists but the client uses tRPC.
- `shared/gateway.ts` — `RoutingStrategy`, `RoutingConfig`, `ProviderId`, `GatewaySnapshot` types match client imports and server usage.

So controls 7, 13–20 are real end-to-end features, not stubs.

## Dead / unrouted components (not part of the visible dashboard)

- `client/src/components/DashboardLayout.tsx` — a generic scaffold with `menuItems = [{label:"Page 1", path:"/"}, {label:"Page 2", path:"/some-path"}]`. Its nav uses wouter `setLocation(item.path)` (`DashboardLayout.tsx:187`); `/some-path` has no route and would fall through to `NotFound`. It is **never imported by `App.tsx`** (which renders `<Home>` directly), so none of this is visible. Treat as dead code, not a "broken button."
- `client/src/components/AIChatBox.tsx` — a reusable chat widget; the only importer is `pages/ComponentShowcase.tsx` (`:174`, `:1409`). `ComponentShowcase` has **no route** in `App.tsx`, so `AIChatBox` is unreachable in the live app.

## Conclusions

- The dashboard is functionally a single page; the user-visible "broken buttons" are concentrated in three patterns: (a) a control with no handler at all (`user-chip`), (b) a control with no `onChange` whose data is hardcoded (`period-select`), and (c) buttons that present a toast instead of a real feature ("Settings", "Manage adapters", "View all logs").
- The core operating controls (refresh, routing policy save, playground send/simulate) are fully wired and persist. The user's "make all the buttons working" request is mostly about the stubbed/decorative controls above, not the core flow.
- "Navigation" in the sidebar is in-page anchor scrolling, which works; the only nav defect is a static active highlight. There are intentionally no separate pages.

## Recommendations (implement nothing)

1. **`user-chip` (`Home.tsx:92`)** — wire the ChevronDown to an account menu (sign-out / profile) or remove the ChevronDown icon if no menu is intended. The existing pattern in `DashboardLayout.tsx` footer (Avatar trigger → `DropdownMenu` with a `logout` item) is a ready reference.
2. **`period-select` (`Home.tsx:105`)** — either add an `onChange` that actually re-slices/re-fetches logs by period (the server would need a period param), or remove the `<select>` to avoid implying interactivity that doesn't exist.
3. **"Settings" button (`Home.tsx:97`)** — if real settings are out of scope, change it to a tooltip/inline note rather than a button; if in scope, open a `Dialog`/`Sheet` for API-key/secret management guidance.
4. **"Manage adapters" button (`Home.tsx:104`)** — same as Settings: convert to an informational note or implement a provider-management surface.
5. **"View all logs" button (`Home.tsx:111`)** — make it actually expand the logs list (e.g., raise the `slice(0, 5)` cap or toggle a "show all 50" mode) instead of silently re-running the same query; or rename it to "Refresh logs" to match its behavior.
6. **Nav active state (`Home.tsx:84`)** — derive `active` from the current hash/scroll position (or a small `activeSection` state) rather than hardcoding it on Overview.
7. **Metric deltas (`Home.tsx:101`)** — the `delta`/`up` props are hardcoded; if real trend data matters, compute them from snapshot history (out of scope for "buttons" but worth flagging).
8. **Dead code** — decide whether `DashboardLayout.tsx` and `ComponentShowcase.tsx`/`AIChatBox.tsx` are scaffolding to keep or cruft to remove; they are not reachable from the live routes.
