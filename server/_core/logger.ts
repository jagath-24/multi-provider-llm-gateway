import pino from "pino";

/**
 * Structured logger used throughout the server.
 * In production, pino emits newline-delimited JSON.
 * In development, pino-pretty (if available) or plain JSON is used.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // pino uses NDJSON by default — fast and log-aggregator-friendly.
});
