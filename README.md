# Multi-Provider LLM Gateway

**Distributed API Gateway v2 — now routing LLM providers, not just internal services.**

This project provides one normalized chat API over **Groq** and **Gemini**, with configurable routing, automatic fallback, provider health metrics, per-provider circuit breakers, and an operator console. It is implemented in the managed full-stack template so it runs immediately in preview while keeping the same adapter-and-routing architecture you would use in a Spring Boot service.

## What is included

| Capability | Implementation |
| --- | --- |
| Unified request/response schema | `shared/gateway.ts` |
| Provider adapter pattern | `server/gateway/adapters.ts` |
| Routing strategies | round-robin, cheapest-first, fastest-first, fallback-on-failure |
| Circuit breaking | per-provider CLOSED / OPEN / HALF_OPEN breaker with failure threshold and cooldown |
| Persistence | MySQL/Drizzle tables for routing config and request logs |
| Admin console | Provider health, routing controls, traffic summary, and recent request log |
| Fallback testing | `simulateFailureProvider` request field and UI test action |
| Container setup | `docker-compose.yml` for MySQL and app environment |

The breaker follows the same operational pattern as Resilience4j: failures increment a threshold, the provider opens, requests are rejected during the cooldown, and one half-open probe is allowed after recovery. If you port this service to Spring Boot, replace `CircuitBreaker` with a Resilience4j instance per provider without changing the adapter or router contracts.

## Quick start

1. Add provider keys to the project environment:

```bash
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
```

2. Run the app with the managed project workflow or locally:

```bash
pnpm install
pnpm db:push
pnpm dev
```

When no provider key is present, the dashboard uses a safe demo adapter so the UI, routing controls, request logs, and fallback simulation remain usable.

## API

### `POST /api/gateway/chat`

```json
{
  "messages": [{ "role": "user", "content": "Explain circuit breakers in one paragraph" }],
  "strategy": "fallback-on-failure",
  "temperature": 0.2,
  "maxTokens": 512
}
```

The response is normalized across providers:

```json
{
  "id": "uuid",
  "provider": "groq",
  "model": "llama-3.3-70b-versatile",
  "message": { "role": "assistant", "content": "..." },
  "usage": { "promptTokens": 31, "completionTokens": 92, "totalTokens": 123 },
  "latencyMs": 482,
  "fallbackUsed": false,
  "strategy": "fallback-on-failure",
  "createdAt": "2026-09-18T...Z"
}
```

Additional endpoints:

- `GET /api/gateway/providers/health` — provider configuration, circuit state, request counts, success rate, and average latency.
- `PUT /api/gateway/routing-config` — update strategy, fallback flag, failure threshold, recovery time, and provider weights.
- `GET /api/gateway/snapshot` — dashboard-friendly combined snapshot.

The UI uses typed tRPC procedures under `/api/trpc`, while the REST endpoints above provide the portfolio-facing gateway contract.

## Routing strategies

- **Round-robin:** cycles through configured providers to spread traffic.
- **Cheapest-first:** prioritizes the provider with the lowest configured cost per 1K tokens.
- **Fastest-first:** prioritizes the provider with the best observed latency, with cold-start defaults.
- **Fallback-on-failure:** follows configured weights and moves to the next healthy provider after a provider error or rate limit.

Provider keys are never sent to the browser. All calls happen in server-side adapters.

## Docker Compose

`docker-compose.yml` starts MySQL and the Node gateway. Add secrets through your shell or a local `.env` file; do not commit them.

```bash
docker compose up --build
```

## Portfolio narrative

> **Distributed API Gateway v2:** extended the original internal-service gateway into a multi-provider LLM control plane with normalized contracts, adapter isolation, cost/latency-aware routing, Resilience4j-style circuit breaking, fallback testing, MySQL observability, and a React operator dashboard.
