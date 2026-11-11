import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { gatewayService } from "./gateway/service";

const chatMessage = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().min(1).max(20000) });
const strategy = z.enum(["round-robin", "cheapest-first", "fastest-first", "fallback-on-failure"]);

// Exported so the raw REST gateway endpoints in server/_core/index.ts validate
// against the exact same shape the tRPC procedures use. Do not change these
// without updating the corresponding tRPC input as well (and vice versa).
export const chatInputSchema = z.object({
  messages: z.array(chatMessage).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  strategy: strategy.optional(),
  simulateFailureProvider: z.enum(["groq", "gemini"]).optional(),
});

export const routingConfigSchema = z.object({
  strategy,
  fallbackEnabled: z.boolean(),
  failureThreshold: z.number().int().min(1).max(20),
  recoverySeconds: z.number().int().min(5).max(3600),
  weights: z.object({ groq: z.number().int().min(0).max(100), gemini: z.number().int().min(0).max(100) }),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  gateway: router({
    snapshot: publicProcedure.query(() => gatewayService.snapshot()),
    health: publicProcedure.query(() => gatewayService.providerHealth()),
    config: publicProcedure.query(() => gatewayService.getConfig()),
    updateConfig: publicProcedure.input(routingConfigSchema).mutation(({ input }) => {
      gatewayService.setConfig(input);
      return gatewayService.getConfig();
    }),
    chat: publicProcedure.input(chatInputSchema).mutation(({ input }) => gatewayService.chat(input)),

    addLog: publicProcedure.input(z.object({
      provider: z.enum(["groq", "gemini", "demo"]),
      model: z.string().min(1).max(100),
      strategy,
      latencyMs: z.number().int().min(0).max(60000),
      success: z.boolean(),
      error: z.string().max(500).optional(),
      fallbackUsed: z.boolean().optional(),
    })).mutation(({ input }) => gatewayService.addManualLog(input)),
  }),
});

export type AppRouter = typeof appRouter;
