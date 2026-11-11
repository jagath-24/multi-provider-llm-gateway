import { randomUUID } from "node:crypto";
import type {
  ChatRequest,
  ChatMessage,
  ProviderId,
  UnifiedChatResponse,
  Usage,
} from "@shared/gateway";

export type ProviderAdapter = {
  id: ProviderId;
  isConfigured: () => boolean;
  chat: (request: ChatRequest) => Promise<UnifiedChatResponse>;
};

class ProviderRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

function readTextContent(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nowResponse(
  provider: ProviderId | "demo",
  model: string,
  content: string,
  usage: Usage,
  startedAt: number,
  strategy: ChatRequest["strategy"],
  fallbackUsed = false,
): UnifiedChatResponse {
  return {
    id: randomUUID(),
    provider,
    model,
    message: { role: "assistant", content },
    usage,
    latencyMs: Date.now() - startedAt,
    fallbackUsed,
    strategy: strategy ?? "fallback-on-failure",
    createdAt: new Date().toISOString(),
  };
}

function toGroqMessages(messages: ChatMessage[]) {
  return messages.map(message => ({ role: message.role, content: message.content }));
}

export class GroqAdapter implements ProviderAdapter {
  id: ProviderId = "groq";
  private readonly apiKey = process.env.GROQ_API_KEY;

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async chat(request: ChatRequest) {
    const startedAt = Date.now();
    if (!this.apiKey) throw new ProviderRequestError("GROQ_API_KEY is not configured");
    const model = request.model?.startsWith("llama") ? request.model : "llama-3.3-70b-versatile";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        messages: toGroqMessages(request.messages),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 1024,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      throw new ProviderRequestError(body?.error?.message ?? `Groq request failed (${response.status})`, response.status);
    }
    const content = readTextContent(body?.choices?.[0]?.message?.content);
    if (!content) throw new ProviderRequestError("Groq returned an empty response");
    return nowResponse(
      "groq",
      body?.model ?? model,
      content,
      {
        promptTokens: body?.usage?.prompt_tokens,
        completionTokens: body?.usage?.completion_tokens,
        totalTokens: body?.usage?.total_tokens,
      },
      startedAt,
      request.strategy,
    );
  }
}

export class GeminiAdapter implements ProviderAdapter {
  id: ProviderId = "gemini";
  private readonly apiKey = process.env.GEMINI_API_KEY;

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async chat(request: ChatRequest) {
    const startedAt = Date.now();
    if (!this.apiKey) throw new ProviderRequestError("GEMINI_API_KEY is not configured");
    const model = request.model?.startsWith("gemini") ? request.model : "gemini-2.0-flash";
    const system = request.messages.filter(message => message.role === "system").map(message => message.content).join("\n");
    const contents = request.messages
      .filter(message => message.role !== "system")
      .map(message => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxTokens ?? 1024,
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      throw new ProviderRequestError(body?.error?.message ?? `Gemini request failed (${response.status})`, response.status);
    }
    const content = readTextContent(body?.candidates?.[0]?.content?.parts?.[0]?.text);
    if (!content) throw new ProviderRequestError("Gemini returned an empty response");
    return nowResponse(
      "gemini",
      model,
      content,
      {
        promptTokens: body?.usageMetadata?.promptTokenCount,
        completionTokens: body?.usageMetadata?.candidatesTokenCount,
        totalTokens: body?.usageMetadata?.totalTokenCount,
      },
      startedAt,
      request.strategy,
    );
  }
}

export class DemoAdapter {
  async chat(request: ChatRequest): Promise<UnifiedChatResponse> {
    const startedAt = Date.now();
    const lastUserMessage = [...request.messages].reverse().find(message => message.role === "user")?.content ?? "your prompt";
    return nowResponse(
      "demo",
      "gateway-demo",
      `Demo response ready. I received: “${lastUserMessage.slice(0, 180)}”\n\nAdd GROQ_API_KEY or GEMINI_API_KEY to exercise a live provider. The dashboard still records routing, fallback, latency, and circuit-breaker behavior locally.`,
      { promptTokens: Math.ceil(lastUserMessage.length / 4), completionTokens: 48, totalTokens: Math.ceil(lastUserMessage.length / 4) + 48 },
      startedAt,
      request.strategy,
    );
  }
}

export function createDefaultAdapters(): Record<ProviderId, ProviderAdapter> {
  return { groq: new GroqAdapter(), gemini: new GeminiAdapter() };
}
