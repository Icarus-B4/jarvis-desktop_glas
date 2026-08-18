import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_JARVIS_HOSTNAME,
  DEFAULT_JARVIS_PORT,
  assertLoopbackHostname,
  assertPort,
} from "./config";
import { createJarvisRequestHandler } from "./handler";
import { createBarehandsServer, type BarehandsConfig, type BarehandsServerHandle } from "./barehands";

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
  barehandsRoot?: string;
  barehandsPort?: number;
};

export type RunningJarvisService = {
  baseUrl: string;
  hostname: string;
  port: number;
  stop(): void;
};

export type BarehandsServiceHandle = BarehandsServerHandle & {
  baseUrl: string;
  hostname: string;
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

export async function startBarehandsService(options: { root: string; port?: number; onCommand?: (action: string, payload: Record<string, unknown>) => void }): Promise<BarehandsServiceHandle> {
  const barehands = createBarehandsServer({
    root: options.root,
    port: options.port,
    onCommand: options.onCommand,
  });

  const http = require("node:http");
  const runtimePort = barehands.port;

  const server = http.createServer(async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => resolve());
        req.on("error", reject);
      });
      const bodyBuffer = Buffer.concat(chunks);
      const request = new Request(`http://127.0.0.1:${runtimePort}${req.url ?? "/"}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: bodyBuffer.length === 0 ? null : bodyBuffer,
      });
      const response = await barehands.handleRequest(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const body = await response.arrayBuffer();
      res.end(Buffer.from(body));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { code: "internal_error", message: "The barehands service encountered an internal error." } }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onStartupError = (err: Error): void => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener("error", onStartupError);
      console.info(`[barehands] listening on 127.0.0.1:${runtimePort}`);
      resolve();
    };
    server.once("error", onStartupError);
    server.once("listening", onListening);
    server.listen(runtimePort, "127.0.0.1");
  });

  server.on("error", (err: Error) => {
    console.error("[barehands] runtime server error:", err);
  });

  return {
    baseUrl: `http://127.0.0.1:${runtimePort}`,
    hostname: "127.0.0.1",
    port: runtimePort,
    config: barehands.config,
    root: barehands.root,
    handleRequest: barehands.handleRequest,
    pushJarvisEvent: (type: string, payload?: Record<string, unknown>) => barehands.pushJarvisEvent(type, payload),
    stop(): void {
      server.close(() => {
        console.info("[barehands] server stopped");
      });
    },
  };
}


