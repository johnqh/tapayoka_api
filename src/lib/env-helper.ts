import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

let envCache: Record<string, string> | null = null;

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;

  const content = readFileSync(filePath, "utf-8");
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
    result[key] = value;
  }
  return result;
}

function loadEnvFiles(): Record<string, string> {
  if (envCache) return envCache;

  const cwd = process.cwd();
  const base = parseEnvFile(resolve(cwd, ".env"));
  const local = parseEnvFile(resolve(cwd, ".env.local"));
  const mode = process.env.NODE_ENV;
  const modeFile = mode ? parseEnvFile(resolve(cwd, `.env.${mode}`)) : {};
  const modeLocal = mode ? parseEnvFile(resolve(cwd, `.env.${mode}.local`)) : {};
  // Priority: .env.{mode}.local > .env.{mode} > .env.local > .env
  envCache = { ...base, ...local, ...modeFile, ...modeLocal };

  return envCache;
}

/** Get environment variable with .env.local > .env > process.env priority */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  const env = loadEnvFiles();
  return env[key] ?? process.env[key] ?? defaultValue;
}

/** Get required environment variable, throws if missing */
export function getRequiredEnv(key: string): string {
  const value = getEnv(key);
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}
