export function getEnv(key: string, defaultValue: string = ""): string {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  return value.trim().replace(/^["']|["']$/g, "");
}

export function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export function getBooleanEnv(key: string, defaultValue = false): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

export function getNumberEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function getArrayEnv(key: string, separator = ","): string[] {
  const value = process.env[key];
  if (!value) return [];
  return value.split(separator).map(s => s.trim()).filter(Boolean);
}