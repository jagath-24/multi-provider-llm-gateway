import "dotenv/config";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { z } from "zod";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter, chatInputSchema, routingConfigSchema } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { gatewayService } from "../gateway/service";
import { ENV, validateRequiredEnv } from "./env";
import { logger } from "./logger";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Rate limiter applied to the chat-bearing surfaces: the REST gateway
 * (`/api/gateway/*`) and the tRPC chat mutation (`/api/trpc/gateway.chat`).
 * These endpoints drive upstream provider calls, so they are the ones worth
 * throttling; the tRPC snapshot/health queries the SPA polls are left
 * unthrottled so auto-refresh keeps working.
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many chat requests from this IP, please try again later." },
});

/**
 * Validates an Express request body against a zod schema. On success the
 * parsed (and coerced) value replaces `req.body`; on failure it responds 400
 * with the validation issues. This is the same schema the matching tRPC
 * procedure uses, so REST and tRPC enforce identical input shapes.
 */
function validateBody(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid request body", issues: result.error.issues });
      return;
    }
    req.body = result.data;
    next();
  };
}

function registerGatewayRoutes(app: express.Express) {
  app.post("/api/gateway/chat", chatLimiter, validateBody(chatInputSchema), async (req, res) => {
    try {
      const response = await gatewayService.chat(req.body);
      res.json(response);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Gateway request failed" });
    }
  });

  app.get("/api/gateway/providers/health", chatLimiter, async (_req, res) => {
    try {
      res.json(await gatewayService.providerHealth());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Provider health check failed" });
    }
  });

  app.get("/api/gateway/snapshot", chatLimiter, async (_req, res) => {
    try {
      res.json(await gatewayService.snapshot());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Snapshot failed" });
    }
  });

  app.put("/api/gateway/routing-config", chatLimiter, validateBody(routingConfigSchema), (req, res) => {
    try {
      gatewayService.setConfig(req.body);
      res.json(gatewayService.getConfig());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Config update failed" });
    }
  });
}

/**
 * Express global error handler. Must be registered after all routes and have
 * exactly four parameters so Express treats it as the error handler. Logs the
 * error with the per-request pino logger when available, then returns a generic
 * 500 to avoid leaking internals.
 */
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const log = (req as Request & { log?: typeof logger }).log ?? logger;
  log.error({ err }, "unhandled server error");
  if (res.headersSent) {
    _next(err);
    return;
  }
  res.status(500).json({ error: "Internal server error" });
};

function registerSecurityMiddleware(app: express.Express) {
  // Security headers via helmet. CSP is tuned for this app:
  //   - style-src allows 'unsafe-inline' because the React client sets styles
  //     via inline `style={{}}` props, which render as `style="..."` attributes.
  //     A strict style-src would break rendering, so inline styles are accepted.
  //     This is a deliberate, documented tradeoff: inline styles are lower-risk
  //     than inline scripts, and refactoring the UI to external stylesheets is
  //     out of scope here.
  //   - script-src allows 'unsafe-inline' only in development, where Vite injects
  //     inline HMR / React-refresh scripts. Production serves only same-origin
  //     bundles, so 'unsafe-inline' is dropped there.
  //   - connect-src allows websockets in development for Vite HMR.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ENV.isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ENV.isProduction ? ["'self'"] : ["'self'", "ws:", "wss:"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // COEP require-corp can break loading cross-origin resources (e.g. signed
      // storage URLs), so it is disabled here.
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Explicit CORS allowlist driven by CORS_ORIGIN. When CORS_ORIGIN is unset the
  // app defaults to same-origin only (origin: false sends no ACAO header), which
  // is correct for the SPA served from this host. A comma-separated CORS_ORIGIN
  // enables the listed origins. Never falls back to a wildcard ("*").
  const corsOriginEnv = process.env.CORS_ORIGIN;
  const corsOrigin = corsOriginEnv
    ? corsOriginEnv.split(",").map(origin => origin.trim()).filter(Boolean)
    : false;
  app.use(cors({ origin: corsOrigin, credentials: true }));
}

async function startServer() {
  // Fail fast if required environment variables are missing. In production a
  // missing variable (notably JWT_SECRET, which used to silently default to "")
  // aborts boot; in development the missing vars are logged as warnings so
  // local/demo workflows (e.g. running without provider keys) still start.
  validateRequiredEnv();

  const app = express();
  const server = createServer(app);

  registerSecurityMiddleware(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Structured request logging via pino-http; placed after the body parsers.
  app.use(pinoHttp({ logger }));

  // Lightweight liveness/readiness probe with no dependencies.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerGatewayRoutes(app);

  // Rate-limit the tRPC chat mutation before mounting the tRPC adapter. The
  // SPA polls gateway.snapshot through tRPC, which is intentionally not limited
  // here so auto-refresh keeps working.
  app.use("/api/trpc/gateway.chat", chatLimiter);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext, onError: ({ error, path }) => logger.error({ err: error, path }, "tRPC handler error") }));

  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  // Global error handler — must be the last middleware before listen.
  app.use(errorHandler);

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) logger.info({ preferredPort, port }, `Port ${preferredPort} is busy, using port ${port} instead`);
  server.listen(port, () => logger.info({ port }, `Server running on http://localhost:${port}/`));
}

startServer().catch(error => logger.error({ err: error }, "Server failed to start"));
