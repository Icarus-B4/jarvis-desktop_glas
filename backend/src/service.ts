import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_JARVIS_HOSTNAME,
  DEFAULT_JARVIS_PORT,
  assertLoopbackHostname,
  assertPort,
} from "./config";
import { createJarvisRequestHandler } from "./handler";

type BunServer = {
  hostname: string;
  port: number;
  stop(closeActiveConnections?: boolean): void;
};

type BunRuntime = {
  serve(options: {
    hostname: string;
    port: number;
    idleTimeout?: number;
    fetch(request: Request): Response | Promise<Response>;
    error(error: Error): Response;
  }): BunServer;
};

export type JarvisServiceOptions = {
  hostname?: string;
  port?: number;
  allowedOrigins?: readonly string[];
};

export type RunningJarvisService = {
  baseUrl: string;
  hostname: string;
  port: number;
  stop(): void;
};

function formatBaseUrl(hostname: string, port: number): string {
  const urlHostname = hostname.includes(":") ? `[${hostname.replace(/^\[|\]$/g, "")}]` : hostname;
  return `http://${urlHostname}:${port}`;
}

export function startJarvisService(options: JarvisServiceOptions = {}): RunningJarvisService {
  const hostname = options.hostname ?? DEFAULT_JARVIS_HOSTNAME;
  const initialPort = options.port ?? DEFAULT_JARVIS_PORT;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const allowFallback = options.port === undefined;

  assertLoopbackHostname(hostname);
  assertPort(initialPort);

  const handler = createJarvisRequestHandler({ allowedOrigins });
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  if (runtime === undefined) {
    throw new Error("@jarvis/local-service requires the Bun runtime.");
  }

  const maxAttempts = allowFallback ? 10 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidatePort = initialPort === 0 ? 0 : initialPort + attempt;
    try {
      const server = runtime.serve({
        hostname,
        port: candidatePort,
        idleTimeout: 30,
        fetch: handler,
        error: () => new Response(
          JSON.stringify({ error: { code: "internal_error", message: "The Jarvis local service encountered an internal error." } }),
          { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
        ),
      });

      const boundHostname = server.hostname;
      const boundPort = server.port;
      if (typeof boundHostname !== "string" || typeof boundPort !== "number") {
        server.stop(true);
        throw new Error("Bun did not report the Jarvis local-service listener address.");
      }

      let stopped = false;
      return {
        baseUrl: formatBaseUrl(boundHostname, boundPort),
        hostname: boundHostname,
        port: boundPort,
        stop(): void {
          if (stopped) return;
          stopped = true;
          server.stop(true);
        },
      };
    } catch (error) {
      lastError = error;
      const isEaddrInUse = error instanceof Error && (error.message.includes("EADDRINUSE") || error.message.includes("in use"));
      if (!allowFallback || !isEaddrInUse) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to bind Jarvis local service on ports ${initialPort} through ${initialPort + maxAttempts - 1}.`);
}

