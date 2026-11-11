import { beforeEach, describe, expect, it } from "vitest";
import { gatewayService } from "./service";

describe("gateway routing service", () => {
  beforeEach(() => {
    gatewayService.setConfig({
      strategy: "fallback-on-failure",
      fallbackEnabled: true,
      failureThreshold: 3,
      recoverySeconds: 30,
      weights: { groq: 60, gemini: 40 },
    });
  });

  it("returns the unified demo response when provider keys are absent", async () => {
    const response = await gatewayService.chat({ messages: [{ role: "user", content: "hello gateway" }] });
    expect(response.provider).toBe("demo");
    expect(response.message.role).toBe("assistant");
    expect(response.strategy).toBe("fallback-on-failure");
    expect(response.id).toBeTruthy();
  });

  it("records a simulated provider failure and still returns a response through fallback", async () => {
    const response = await gatewayService.chat({
      messages: [{ role: "user", content: "test fallback" }],
      strategy: "fallback-on-failure",
      simulateFailureProvider: "groq",
    });
    expect(response.provider).toBe("demo");
    expect(response.fallbackUsed).toBe(true);
    expect(response.message.content).toContain("simulated rate-limit");
    const health = await gatewayService.providerHealth();
    expect(health.find(provider => provider.id === "groq")?.failures).toBeGreaterThan(0);
  });

  it("supports cost-aware and latency-aware strategies", async () => {
    const cheapest = await gatewayService.chat({ messages: [{ role: "user", content: "cost" }], strategy: "cheapest-first" });
    const fastest = await gatewayService.chat({ messages: [{ role: "user", content: "speed" }], strategy: "fastest-first" });
    expect(["demo", "groq", "gemini"]).toContain(cheapest.provider);
    expect(["demo", "groq", "gemini"]).toContain(fastest.provider);
  });
});
