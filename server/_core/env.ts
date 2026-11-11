/**
 * Environment configuration.
 *
 * `ENV` keeps `?? ""` fallbacks so importing this module (e.g. from tests) never
 * throws. Startup validation is performed separately by `validateRequiredEnv()`,
 * which the server calls at boot. In production a missing required variable
 * (notably `JWT_SECRET`, which previously defaulted to `""` and allowed session
 * forgery) aborts startup with a clear error.
 *
 * Optional variables (GROQ_API_KEY, GEMINI_API_KEY, PORT) are intentionally
 * absent from REQUIRED_ENV_VARS — the gateway operates in demo mode without
 * provider keys, and PORT defaults to 3000.
 */

/** Variables that must be present and non-empty at startup. */
const REQUIRED_ENV_VARS = [
  "JWT_SECRET",
  "DATABASE_URL",
  "OAUTH_SERVER_URL",
  "VITE_APP_ID",
  "BUILT_IN_FORGE_API_URL",
  "BUILT_IN_FORGE_API_KEY",
  "OWNER_OPEN_ID",
] as const;

/**
 * Validates that every required environment variable is present and non-empty.
 *
 * Behaviour:
 * - In production (`NODE_ENV === 'production'`) or when `VALIDATE_ENV=true`,
 *   throws immediately on any missing variable so the server fails fast.
 * - In development (default), logs a warning for each missing variable but
 *   does not throw, allowing local runs without all credentials present.
 */
export function validateRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(varName => {
    const value = process.env[varName];
    return value === undefined || value.trim() === "";
  });

  if (missing.length === 0) return;

  const isProduction = process.env.NODE_ENV === "production";
  const forceValidate = process.env.VALIDATE_ENV === "true";

  if (isProduction || forceValidate) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set them in your environment or .env file before starting the server.`,
    );
  }

  // Development: warn but continue
  for (const varName of missing) {
    console.warn(
      `[env] WARNING: required environment variable "${varName}" is not set. ` +
        `The server may not work correctly until it is provided.`,
    );
  }
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
