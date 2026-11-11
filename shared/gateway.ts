export type ProviderId = "groq" | "gemini";
export type ResponseProvider = ProviderId | "demo";
export type RoutingStrategy =
  | "round-robin"
  | "cheapest-first"
  | "fastest-first"
  | "fallback-on-failure";
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
export type ProviderStatus = "healthy" | "degraded" | "open" | "unconfigured";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  strategy?: RoutingStrategy;
  simulateFailureProvider?: ProviderId;
};

export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type UnifiedChatResponse = {
  id: string;
  provider: ResponseProvider;
  model: string;
  message: ChatMessage;
  usage: Usage;
  latencyMs: number;
  fallbackUsed: boolean;
  strategy: RoutingStrategy;
  createdAt: string;
};

export type ProviderHealth = {
  id: ProviderId;
  name: string;
  model: string;
  status: ProviderStatus;
  configured: boolean;
  circuitState: CircuitState;
  failureCount: number;
  requests: number;
  successes: number;
  failures: number;
  successRate: number;
  avgLatencyMs: number;
  costPer1kTokens: number;
  lastRequestAt?: string;
};

export type RoutingConfig = {
  strategy: RoutingStrategy;
  fallbackEnabled: boolean;
  failureThreshold: number;
  recoverySeconds: number;
  weights: Record<ProviderId, number>;
};

export type RequestLog = {
  requestId: string;
  provider: ResponseProvider;
  model: string;
  strategy: RoutingStrategy;
  latencyMs: number;
  success: boolean;
  error?: string;
  fallbackUsed?: boolean;
  createdAt: string;
  isSample?: boolean;
};

export type GatewaySnapshot = {
  config: RoutingConfig;
  providers: ProviderHealth[];
  logs: RequestLog[];
};

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  strategy: "fallback-on-failure",
  fallbackEnabled: true,
  failureThreshold: 3,
  recoverySeconds: 30,
  weights: { groq: 60, gemini: 40 },
};

export const PROVIDER_CATALOG: Record<ProviderId, Omit<ProviderHealth, "status" | "configured" | "circuitState" | "failureCount" | "requests" | "successes" | "failures" | "successRate" | "avgLatencyMs" | "lastRequestAt">> = {
  groq: {
    id: "groq",
    name: "Groq",
    model: "llama-3.3-70b-versatile",
    costPer1kTokens: 0.00059,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    model: "gemini-2.0-flash",
    costPer1kTokens: 0.0001,
  },
};
