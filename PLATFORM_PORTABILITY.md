# Platform portability

The `relayops` dashboard is implemented as a standard Vite + React + TypeScript application. The visual system is self-contained in:

- `client/src/pages/Home.tsx` — dashboard layout and UI markup.
- `client/src/index.css` — complete color palette, typography, responsive breakpoints, charts, controls, and component styling.
- `client/index.html` — document metadata and Inter/DM Mono font loading.
- `client/src/App.tsx` — root route and theme setup.

## Run in Kiro or another platform

Requirements: Node.js 22+, pnpm 10+, and internet access for the Google Fonts import and optional provider APIs.

```bash
pnpm install
pnpm check
pnpm dev
```

Open the local URL printed by Vite, normally `http://localhost:3000`.

For a production build:

```bash
pnpm build
pnpm start
```

## Why the UI remains the same

The UI does not depend on the Manus management interface, browser extensions, or a platform-specific component renderer. It uses React, standard HTML controls, Lucide icons, CSS, Tailwind utilities, and the included Vite configuration. The dashboard's responsive behavior is defined in `client/src/index.css`, including the sidebar-to-mobile layout transition below 800px.

The app can run with the existing server API, or the UI can be previewed independently if the backend is replaced with mocked `/api/trpc` responses. Provider API keys remain server-side and are never bundled into browser assets.

## Environment notes

For the full backend, configure:

```bash
DATABASE_URL=mysql://...
JWT_SECRET=...
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
```

If provider keys are omitted, the gateway intentionally uses its demo fallback adapter; this does not change the dashboard layout or styling.

The ZIP intentionally excludes `.env`, `node_modules`, `dist`, runtime logs, and platform session metadata. This keeps the package safe to share and reproducible on another machine.
