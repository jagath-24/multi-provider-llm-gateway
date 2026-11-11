import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const routingConfigs = mysqlTable("routing_configs", {
  id: int("id").autoincrement().primaryKey(),
  strategy: mysqlEnum("strategy", ["round-robin", "cheapest-first", "fastest-first", "fallback-on-failure"]).default("fallback-on-failure").notNull(),
  fallbackEnabled: int("fallbackEnabled").default(1).notNull(),
  failureThreshold: int("failureThreshold").default(3).notNull(),
  recoverySeconds: int("recoverySeconds").default(30).notNull(),
  groqWeight: int("groqWeight").default(60).notNull(),
  geminiWeight: int("geminiWeight").default(40).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const gatewayRequestLogs = mysqlTable("gateway_request_logs", {
  id: int("id").autoincrement().primaryKey(),
  requestId: varchar("requestId", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  strategy: varchar("strategy", { length: 32 }).notNull(),
  latencyMs: int("latencyMs").notNull(),
  success: int("success").default(1).notNull(),
  error: text("error"),
  fallbackUsed: int("fallbackUsed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type RoutingConfigRow = typeof routingConfigs.$inferSelect;
export type GatewayRequestLogRow = typeof gatewayRequestLogs.$inferSelect;
