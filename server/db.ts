import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { gatewayRequestLogs, InsertUser, routingConfigs, users } from "../drizzle/schema";
import { DEFAULT_ROUTING_CONFIG, type RequestLog, type RoutingConfig } from "@shared/gateway";
import { ENV } from "./_core/env";
import { fileReadConfig, fileReadLogs, fileWriteConfig, fileWriteLog } from "./fileStore";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  updateSet.lastSignedIn ??= new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getRoutingConfig(): Promise<RoutingConfig | undefined> {
  const db = await getDb();
  if (!db) return fileReadConfig();
  const row = (await db.select().from(routingConfigs).where(eq(routingConfigs.id, 1)).limit(1))[0];
  if (!row) return undefined;
  return {
    strategy: row.strategy,
    fallbackEnabled: row.fallbackEnabled === 1,
    failureThreshold: row.failureThreshold,
    recoverySeconds: row.recoverySeconds,
    weights: { groq: row.groqWeight, gemini: row.geminiWeight },
  };
}

export async function saveRoutingConfig(config: RoutingConfig) {
  const db = await getDb();
  if (!db) { fileWriteConfig(config); return; }
  await db.insert(routingConfigs).values({
    id: 1,
    strategy: config.strategy,
    fallbackEnabled: config.fallbackEnabled ? 1 : 0,
    failureThreshold: config.failureThreshold,
    recoverySeconds: config.recoverySeconds,
    groqWeight: config.weights.groq,
    geminiWeight: config.weights.gemini,
  }).onDuplicateKeyUpdate({
    set: {
      strategy: config.strategy,
      fallbackEnabled: config.fallbackEnabled ? 1 : 0,
      failureThreshold: config.failureThreshold,
      recoverySeconds: config.recoverySeconds,
      groqWeight: config.weights.groq,
      geminiWeight: config.weights.gemini,
      updatedAt: new Date(),
    },
  });
}

export async function saveGatewayLog(log: RequestLog) {
  const db = await getDb();
  if (!db) { fileWriteLog(log); return; }
  await db.insert(gatewayRequestLogs).values({
    requestId: log.requestId,
    provider: log.provider,
    model: log.model,
    strategy: log.strategy,
    latencyMs: log.latencyMs,
    success: log.success ? 1 : 0,
    error: log.error,
    fallbackUsed: log.fallbackUsed ? 1 : 0,
    createdAt: new Date(log.createdAt),
  });
}

export async function getGatewayLogs(limit = 50): Promise<RequestLog[]> {
  const db = await getDb();
  if (!db) return fileReadLogs(limit);
  const rows = await db.select().from(gatewayRequestLogs).orderBy(desc(gatewayRequestLogs.createdAt)).limit(limit);
  return rows.map(row => ({
    requestId: row.requestId,
    provider: row.provider as RequestLog["provider"],
    model: row.model,
    strategy: row.strategy as RequestLog["strategy"],
    latencyMs: row.latencyMs,
    success: row.success === 1,
    error: row.error ?? undefined,
    fallbackUsed: row.fallbackUsed === 1,
    createdAt: row.createdAt.toISOString(),
  }));
}

export { DEFAULT_ROUTING_CONFIG };
