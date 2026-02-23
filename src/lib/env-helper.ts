import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

let envLocalCache: Record<string, string> | null = null;

function loadEnvLocal(): Record<string, string> {
  if (envLocalCache) return envLocalCache;

  const envLocalPath = resolve(process.cwd(), ".env.local");
  envLocalCache = {};

  if (existsSync(envLocalPath)) {
    const content = readFileSync(envLocalPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      envLocalCache[key] = value;
    }
  }

  return envLocalCache;
}

/** Get environment variable with .env.local priority */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  const local = loadEnvLocal();
  return local[key] ?? process.env[key] ?? defaultValue;
}

/** Get required environment variable, throws if missing */
export function getRequiredEnv(key: string): string {
  const value = getEnv(key);
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}
