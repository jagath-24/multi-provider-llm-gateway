import { randomUUID } from "node:crypto";
import type {
  ChatRequest,
  GatewaySnapshot,
  ProviderHealth,
  ProviderId,
  RequestLog,
  ResponseProvider,
  RoutingConfig,
  UnifiedChatResponse,
} from "@shared/gateway";
import {
  DEFAULT_ROUTING_CONFIG,
  PROVIDER_CATALOG,
  type CircuitState,
} from "@shared/gateway";
import { getGatewayLogs, getRoutingConfig, saveGatewayLog, saveRoutingConfig } from "../db";
import { GeminiAdapter, GroqAdapter, type ProviderAdapter, DemoAdapter } from "./adapters";
import { CircuitBreaker } from "./circuitBreaker";
import { logger } from "../_core/logger";

type ProviderMetric = {
  requests: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  lastRequestAt?: string;
};

const sampleLogs: RequestLog[] = [
  { requestId: "req_8c3f", provider: "groq", model: "llama-3.3-70b-versatile", strategy: "fallback-on-failure", latencyMs: 482, success: true, createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(), isSample: true },
  { requestId: "req_8c2a", provider: "gemini", model: "gemini-2.0-flash", strategy: "cheapest-first", latencyMs: 731, success: true, createdAt: new Date(Date.now() - 1000 * 60 * 9).toISOString(), isSample: true },
  { requestId: "req_8b77", provider: "groq", model: "llama-3.3-70b-versatile", strategy: "round-robin", latencyMs: 298, success: true, createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(), isSample: true },
  { requestId: "req_8b52", provider: "gemini", model: "gemini-2.0-flash", strategy: "fallback-on-failure", latencyMs: 1180, success: false, error: "429: quota exceeded; circuit remains closed", createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(), isSample: true },
];

export class GatewayService {
  private config: RoutingConfig = { ...DEFAULT_ROUTING_CONFIG, weights: { ...DEFAULT_ROUTING_CONFIG.weights } };
  private roundRobinIndex = 0;
  private readonly adapters: Record<ProviderId, ProviderAdapter> = { groq: new GroqAdapter(), gemini: new GeminiAdapter() };
  private readonly demoAdapter = new DemoAdapter();
  private readonly breakers: Record<ProviderId, CircuitBreaker> = { groq: new CircuitBreaker(), gemini: new CircuitBreaker() };
  private readonly metrics: Record<ProviderId, ProviderMetric> = {
    groq: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
    gemini: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
  };
  private logs: RequestLog[] = [...sampleLogs];
  private hydrated = false;

  async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    const persistedConfig = await getRoutingConfig().catch(() => undefined);
    if (persistedConfig) this.setConfig(persistedConfig);
    const persistedLogs = await getGatewayLogs(200).catch(() => []);
    if (persistedLogs.length) this.logs = [...persistedLogs, ...sampleLogs].slice(0, 200);
  }

  setConfig(config: RoutingConfig) {
    this.config = {
      ...config,
      failureThreshold: Math.max(1, Math.min(20, config.failureThreshold)),
      recoverySeconds: Math.max(5, Math.min(3600, config.recoverySeconds)),
      weights: { groq: Math.max(0, config.weights.groq), gemini: Math.max(0, config.weights.gemini) },
    };
    for (const breaker of Object.values(this.breakers)) breaker.configure(this.config.failureThreshold, this.config.recoverySeconds);
    void saveRoutingConfig(this.config).catch(error => logger.warn({ err: error }, "[Gateway] config persistence skipped"));
  }

  getConfig() {
    return this.config;
  }

  private configuredProviders(): ProviderId[] {
    return (Object.keys(this.adapters) as ProviderId[]).filter(id => this.adapters[id].isConfigured());
  }

  private rankProviders(strategy: RoutingConfig["strategy"]): ProviderId[] {
    const available = (Object.keys(this.adapters) as ProviderId[]).filter(id => this.breakers[id].allowRequest());
    const configured = available.filter(id => this.adapters[id].isConfigured());
    const pool = configured.length ? configured : available;
    if (strategy === "round-robin") {
      return pool.length ? pool.map((_, index) => pool[(this.roundRobinIndex + index) % pool.length]).filter(Boolean) : [];
    }
    if (strategy === "cheapest-first") return [...pool].sort((a, b) => PROVIDER_CATALOG[a].costPer1kTokens - PROVIDER_CATALOG[b].costPer1kTokens);
    if (strategy === "fastest-first") return [...pool].sort((a, b) => this.avgLatency(a) - this.avgLatency(b));
    return [...pool].sort((a, b) => (this.config.weights[b] ?? 0) - (this.config.weights[a] ?? 0));
  }

  private avgLatency(id: ProviderId) {
    const metric = this.metrics[id];
    return metric.requests ? metric.totalLatencyMs / metric.requests : id === "groq" ? 420 : 760;
  }

  private pushLog(log: RequestLog) {
    this.logs = [log, ...this.logs.filter(item => !item.isSample)].slice(0, 200);
    void saveGatewayLog(log).catch(error => logger.warn({ err: error }, "[Gateway] log persistence skipped"));
  }

  async chat(request: ChatRequest): Promise<UnifiedChatResponse> {
    await this.hydrate();
    const strategy = request.strategy ?? this.config.strategy;
    const orderedProviders = this.rankProviders(strategy);
    const failures: string[] = [];
    let fallbackUsed = false;

    if (!orderedProviders.length) {
      const response = await this.demoAdapter.chat({ ...request, strategy });
      this.pushLog({ requestId: response.id, provider: "demo", model: response.model, strategy, latencyMs: response.latencyMs, success: true, fallbackUsed: false, createdAt: response.createdAt });
      return response;
    }

    for (let index = 0; index < orderedProviders.length; index += 1) {
      const providerId = orderedProviders[index];
      const adapter = this.adapters[providerId];
      const startedAt = Date.now();
      this.metrics[providerId].requests += 1;
      if (request.simulateFailureProvider === providerId) {
        failures.push(`${providerId}: simulated rate-limit for fallback test`);
        this.metrics[providerId].failures += 1;
        this.metrics[providerId].totalLatencyMs += Date.now() - startedAt;
        this.breakers[providerId].recordFailure();
        fallbackUsed = true;
        this.pushLog({ requestId: randomUUID(), provider: providerId, model: PROVIDER_CATALOG[providerId].model, strategy, latencyMs: Date.now() - startedAt, success: false, error: failures.at(-1), fallbackUsed: true, createdAt: new Date().toISOString() });
        if (!this.config.fallbackEnabled) break;
        continue;
      }
      try {
        const response = await adapter.chat({ ...request, strategy });
        response.fallbackUsed = fallbackUsed;
        this.metrics[providerId].successes += 1;
        this.metrics[providerId].totalLatencyMs += response.latencyMs;
        this.metrics[providerId].lastRequestAt = response.createdAt;
        this.breakers[providerId].recordSuccess();
        this.pushLog({ requestId: response.id, provider: providerId, model: response.model, strategy, latencyMs: response.latencyMs, success: true, fallbackUsed, createdAt: response.createdAt });
        if (strategy === "round-robin") this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(orderedProviders.length, 1);
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider request failed";
        failures.push(`${providerId}: ${message}`);
        this.metrics[providerId].failures += 1;
        this.metrics[providerId].totalLatencyMs += Date.now() - startedAt;
        this.metrics[providerId].lastRequestAt = new Date().toISOString();
        this.breakers[providerId].recordFailure();
        fallbackUsed = true;
        this.pushLog({ requestId: randomUUID(), provider: providerId, model: PROVIDER_CATALOG[providerId].model, strategy, latencyMs: Date.now() - startedAt, success: false, error: message, fallbackUsed: true, createdAt: new Date().toISOString() });
        if (!this.config.fallbackEnabled) break;
      }
    }

    const demo = await this.demoAdapter.chat({ ...request, strategy });
    demo.fallbackUsed = true;
    demo.message.content += `\n\nFallback trace: ${failures.join(" · ")}`;
    this.pushLog({ requestId: demo.id, provider: "demo", model: demo.model, strategy, latencyMs: demo.latencyMs, success: true, fallbackUsed: true, error: failures.join("; "), createdAt: demo.createdAt });
    return demo;
  }

  addManualLog(input: {
    provider: ResponseProvider;
    model: string;
    strategy: RoutingConfig["strategy"];
    latencyMs: number;
    success: boolean;
    error?: string;
    fallbackUsed?: boolean;
  }): RequestLog {
    const log: RequestLog = {
      requestId: `manual_${randomUUID().slice(0, 8)}`,
      provider: input.provider,
      model: input.model,
      strategy: input.strategy,
      latencyMs: input.latencyMs,
      success: input.success,
      error: input.error,
      fallbackUsed: input.fallbackUsed ?? false,
      createdAt: new Date().toISOString(),
    };
    this.pushLog(log);
    return log;
  }

  async snapshot(): Promise<GatewaySnapshot> {
    await this.hydrate();
    return { config: this.config, providers: await this.providerHealth(), logs: this.logs.slice(0, 200) };
  }

  async providerHealth(): Promise<ProviderHealth[]> {
    await this.hydrate();
    return (Object.keys(this.adapters) as ProviderId[]).map(id => {
      const metric = this.metrics[id];
      const configured = this.adapters[id].isConfigured();
      const circuitState: CircuitState = this.breakers[id].getState();
      const requests = metric.requests;
      const successRate = requests ? Math.round((metric.successes / requests) * 100) : 100;
      return {
        ...PROVIDER_CATALOG[id],
        configured,
        status: !configured ? "unconfigured" : circuitState === "OPEN" ? "open" : successRate < 90 ? "degraded" : "healthy",
        circuitState,
        failureCount: this.breakers[id].getFailureCount(),
        requests,
        successes: metric.successes,
        failures: metric.failures,
        successRate,
        avgLatencyMs: Math.round(this.avgLatency(id)),
        lastRequestAt: metric.lastRequestAt,
      };
    });
  }
}

export const gatewayService = new GatewayService();
