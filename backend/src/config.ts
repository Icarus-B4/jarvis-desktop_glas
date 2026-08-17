export const DEFAULT_JARVIS_HOSTNAME = process.env.JARVIS_SERVICE_HOST ?? "127.0.0.1";
export const DEFAULT_JARVIS_PORT = Number.parseInt(process.env.JARVIS_SERVICE_PORT ?? process.env.PORT ?? "4317", 10);
export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3002",
  "http://127.0.0.1:3002",
] as const;

function parseIpv4(hostname: string): readonly number[] | undefined {
  const segments = hostname.split(".");
  if (segments.length !== 4) return undefined;

  const parsed = segments.map((segment) => {
    if (!/^\d{1,3}$/.test(segment)) return Number.NaN;
    return Number(segment);
  });

  return parsed.every((segment) => Number.isInteger(segment) && segment >= 0 && segment <= 255)
    ? parsed
    : undefined;
}

export function isLoopbackHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname !== hostname.trim()) return false;

  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") {
    return true;
  }

  return parseIpv4(normalized)?.[0] === 127;
}

export function assertLoopbackHostname(hostname: string): void {
  if (!isLoopbackHostname(hostname)) {
    throw new TypeError(`Jarvis local service hostname must be loopback-only; received ${JSON.stringify(hostname)}.`);
  }
}

export function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError(`Jarvis local service port must be an integer from 0 through 65535; received ${String(port)}.`);
  }
}

export function normalizeAllowedOrigins(origins: readonly string[]): ReadonlySet<string> {
  const normalized = new Set<string>();

  for (const configuredOrigin of origins) {
    let url: URL;
    try {
      url = new URL(configuredOrigin);
    } catch {
      throw new TypeError(`Invalid Jarvis browser origin: ${JSON.stringify(configuredOrigin)}.`);
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !isLoopbackHostname(url.hostname) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new TypeError(`Jarvis browser origin must be an HTTP(S) loopback origin; received ${JSON.stringify(configuredOrigin)}.`);
    }

    normalized.add(url.origin);
  }

  return normalized;
}

