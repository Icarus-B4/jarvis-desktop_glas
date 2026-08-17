import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type BarehandsConfig = {
  name: string;
  port: number;
  orbs: Array<{ title: string; path: string; kind: "notes" | "media" }>;
};

export type BarehandsServerOptions = {
  root: string;
  configPath?: string;
  port?: number;
  onCommand?: (action: string, payload: Record<string, unknown>) => void;
};

export type BarehandsServerHandle = {
  config: BarehandsConfig;
  handleRequest: (request: Request) => Response | Promise<Response>;
  pushJarvisEvent: (type: string, payload?: Record<string, unknown>) => void;
  get port(): number;
  get root(): string;
};

const DEFAULT_CONFIG: BarehandsConfig = {
  name: "Assistant",
  port: 8794,
  orbs: [
    { title: "Notes", path: "sample-notes", kind: "notes" },
    { title: "Props", path: "media", kind: "media" },
  ],
};

function loadConfig(options: BarehandsServerOptions): BarehandsConfig {
  const cfg = { ...DEFAULT_CONFIG };
  try {
    const configPath = options.configPath ?? join(options.root, "barehands.json");
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, "utf-8"));
      Object.assign(cfg, data);
    }
  } catch {
    // ignore config load errors
  }
  for (const orb of cfg.orbs) {
    orb.path = resolve(options.root, orb.path);
  }
  return cfg;
}

export function createBarehandsServer(options: BarehandsServerOptions) {
  const root = resolve(options.root);
  const config = loadConfig(options);
  const port = options.port ?? config.port;
  const onCommand = options.onCommand;

  let state: string = "{}";
  const cmds: Array<Record<string, unknown>> = [];
  const ALLOWED = new Set([
    "add_img", "add_card", "clear", "reset", "hand", "give",
    "yank", "hover", "scroll_note", "widget", "explode", "assemble",
  ]);
  const eventQueue: Array<{ type: string; payload: Record<string, unknown>; ts: number }> = [];
  const eventWaiters: Array<(events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>) => void> = [];

  function pushJarvisEvent(type: string, payload: Record<string, unknown> = {}): void {
    const event = { type, payload, ts: Date.now() };
    eventQueue.push(event);
    if (eventQueue.length > 200) eventQueue.splice(0, eventQueue.length - 200);
    const waiters = eventWaiters.splice(0);
    for (const waiter of waiters) waiter([event]);
  }

  function drainEvents(since?: number): Array<{ type: string; payload: Record<string, unknown>; ts: number }> {
    if (typeof since === "number") {
      return eventQueue.filter((e) => Number((e.payload as Record<string, unknown>)?.ts ?? e.ts ?? 0) >= since);
    }
    return eventQueue.splice(0, eventQueue.length);
  }

  function orbRoot(index: number): string | null {
    try {
      const orb = config.orbs[index];
      if (!orb || orb.kind !== "notes") return null;
      return resolve(orb.path);
    } catch {
      return null;
    }
  }

  function jailCheck(target: string, jail: string): boolean {
    const resolved = resolve(target);
    const resolvedJail = resolve(jail);
    // Plattformunabhängig: path.sep ist `\` auf Windows, `/` auf Unix
    const sep = require("node:path").sep;
    return resolved.startsWith(resolvedJail + sep) || resolved === resolvedJail;
  }

  function mediaAirlock(src: string): string {
    const rel = src.replace(/^\/?media\//i, "");
    const mediaRoot = join(root, "media");
    const target = resolve(join(mediaRoot, rel));
    if (!jailCheck(target, mediaRoot)) {
      const name = rel.toLowerCase();
      const hits: string[] = [];
      try {
        const { readdirSync, statSync } = require("node:fs");
        function walk(dir: string) {
          for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            const stat = statSync(full);
            if (stat.isDirectory()) walk(full);
            else if (entry.toLowerCase() === name) hits.push(full);
          }
        }
        walk(mediaRoot);
      } catch {
        // ignore walk errors
      }
      if (hits.length !== 1) throw new Error("not in the media airlock");
      return "/media/" + hits[0].slice(mediaRoot.length + 1).replace(/\\/g, "/");
    }
    return "/media/" + rel.replace(/\\/g, "/");
  }

  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/barehands/health") {
      return Response.json({
        status: "ok",
        service: "barehands-integrated",
        version: "1.0.0",
        port,
      });
    }

    if (pathname === "/barehands/config") {
      return Response.json({
        name: config.name,
        orbs: config.orbs.map((o) => ({ title: o.title, kind: o.kind })),
      });
    }

    const barehandsRootPaths = ["/stage.html", "/barehands.json", "/favicon.ico"];
    if (barehandsRootPaths.includes(pathname)) {
      const rel = pathname.replace(/^\//, "");
      const full = join(root, rel);
      if (!existsSync(full) || !statSync(full).isFile()) {
        return new Response("Not found", { status: 404 });
      }
      const ext = full.split(".").pop()?.toLowerCase();
      const mime: Record<string, string> = {
        html: "text/html",
        json: "application/json",
        ico: "image/x-icon",
      };
      const contentType = mime[ext ?? ""] ?? "application/octet-stream";
      const body = readFileSync(full);
      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": ext === "html" ? "no-store" : "public, max-age=3600",
        },
      });
    }

    if (pathname === "/barehands/orb") {
      const sDir = join(root, "state");
      const out: Record<string, unknown> = {
        state: "idle",
        mood: "green",
        wave: null as unknown,
      };
      try {
        const s = readFileSync(join(sDir, "state"), "utf-8").trim().toLowerCase();
        if (["idle", "listening", "thinking", "speaking"].includes(s)) out.state = s;
      } catch {
        // no state file, idle default
      }
      try {
        const m = JSON.parse(readFileSync(join(sDir, "mood.json"), "utf-8"));
        if (Date.now() - Number(m.ts ?? 0) < 45000) out.mood = m.mood ?? "green";
      } catch {
        // no mood file
      }
      if (out.state === "speaking") {
        try {
          const w = JSON.parse(readFileSync(join(sDir, "wave.json"), "utf-8"));
          if (Date.now() - Number(w.ts ?? 0) < 600) out.wave = (w.samples ?? []).slice(0, 64);
        } catch {
          // no wave data
        }
      }
      return Response.json(out, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (pathname === "/barehands/state" && request.method === "POST") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return new Response("Expected JSON", { status: 400 });
      }
      try {
        const body = await request.text();
        state = body;
        const out = JSON.stringify(cmds.slice(0, 8));
        cmds.splice(0, 8);
        return new Response(out, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        return new Response("Invalid state payload", { status: 400 });
      }
    }

    if (pathname === "/barehands/state" && request.method === "GET") {
      return new Response(state, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    if (pathname === "/barehands/cmd" && request.method === "POST") {
      try {
        const body = await request.json();
        const action = String(body.a ?? "");
        if (!ALLOWED.has(action)) {
          return new Response("Action not allowed", { status: 400 });
        }
        if ((action === "add_img" || action === "hand" || action === "give") && body.src) {
          body.src = mediaAirlock(String(body.src));
        }
        cmds.push(body as Record<string, unknown>);
        if (onCommand) {
          onCommand(action, body as Record<string, unknown>);
        }
        return new Response(null, { status: 204 });
      } catch {
        return new Response("Invalid command", { status: 400 });
      }
    }

    if (pathname === "/jarvis/bridge" && request.method === "POST") {
      try {
        const body = await request.json();
        const type = String(body.type ?? "");
        if (!type) {
          return new Response("Missing type", { status: 400 });
        }
        pushJarvisEvent(type, body.payload ?? {});
        return new Response(null, { status: 204 });
      } catch {
        return new Response("Invalid bridge payload", { status: 400 });
      }
    }

    if (pathname === "/jarvis/bridge" && request.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? "0");
      const events = drainEvents(since);
      return Response.json(events, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (pathname === "/barehands/tree") {
      const idx = Number(url.searchParams.get("orb") ?? "0");
      const rootDir = orbRoot(idx);
      if (!rootDir || !existsSync(rootDir)) {
        return Response.json({ name: "?", notes: [], dirs: [] }, { status: 404 });
      }

      function walk(d: string): { name: string; notes: Array<{ title: string; file: string }>; dirs: Array<{ name: string; notes: Array<{ title: string; file: string }>; dirs: unknown[] }> } {
        const { readdirSync, statSync } = require("node:fs");
        const out: { name: string; notes: Array<{ title: string; file: string }>; dirs: Array<{ name: string; notes: Array<{ title: string; file: string }>; dirs: unknown[] }> } = {
          name: d.split(/[\\/]/).pop() ?? d,
          notes: [],
          dirs: [],
        };
        for (const entry of readdirSync(d)) {
          if (entry.startsWith(".")) continue;
          const full = join(d, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            const sub = walk(full);
            if (sub.notes.length > 0 || sub.dirs.length > 0) out.dirs.push(sub);
          } else if (entry.endsWith(".md") && entry !== "CLAUDE.md") {
            out.notes.push({
              title: entry.slice(0, -3),
              file: `${idx}/${full.slice(rootDir!.length + 1).replace(/\\/g, "/")}`,
            });
          }
        }
        return out;
      }

      try {
        const tree = walk(rootDir);
        tree.name = config.orbs[idx]?.title ?? tree.name;
        return Response.json(tree);
      } catch {
        return Response.json({ name: "?", notes: [], dirs: [] }, { status: 500 });
      }
    }

    if (pathname === "/barehands/props") {
      const mediaRoot = join(root, "media");
      const EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "webm", "glb", "gltf", "svg"]);

      function walk(d: string): { name: string; items: string[]; dirs: unknown[] } {
        const { readdirSync, statSync } = require("node:fs");
        const out: { name: string; items: string[]; dirs: unknown[] } = {
          name: d.split(/[\\/]/).pop() ?? d,
          items: [],
          dirs: [],
        };
        for (const entry of readdirSync(d)) {
          if (entry.startsWith(".")) continue;
          const full = join(d, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            const sub = walk(full);
            if (sub.items.length > 0 || sub.dirs.length > 0) out.dirs.push(sub);
          } else if (EXTS.has(join(".", entry).toLowerCase().split(".").pop() ?? "")) {
            out.items.push(full.slice(mediaRoot.length + 1).replace(/\\/g, "/"));
          }
        }
        return out;
      }

      try {
        const tree = walk(mediaRoot);
        tree.name = "Props";
        return Response.json(tree);
      } catch {
        return Response.json({ name: "Props", items: [], dirs: [] }, { status: 500 });
      }
    }

    if (pathname.startsWith("/barehands/note")) {
      const f = url.searchParams.get("f") ?? "";
      const idxStr = f.split("/")[0];
      const idx = Number(idxStr);
      const rel = f.slice(idxStr.length + 1);
      const rootDir = orbRoot(idx);
      if (!rootDir) return new Response("Not found", { status: 404 });
      const target = resolve(join(rootDir, rel.replace(/\\/g, "/")));
      if (!jailCheck(target, rootDir) || !target.endsWith(".md") || !existsSync(target)) {
        return new Response("Not found", { status: 404 });
      }
      const body = readFileSync(target, "utf-8");
      return new Response(body, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (pathname === "/barehands/board-state") {
      const boardItems: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(state);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === "object") boardItems.push(item as Record<string, unknown>);
          }
        }
      } catch {
        // state is not JSON array, return empty
      }
      return Response.json({ items: boardItems });
    }

    if (pathname.startsWith("/media/")) {
      const rel = pathname.slice("/media/".length).replace(/\\/g, "/");
      const full = join(root, "media", rel);
      const normalizedFull = full.replace(/\\/g, "/");
      const normalizedMediaRoot = join(root, "media").replace(/\\/g, "/");
      if (!normalizedFull.startsWith(normalizedMediaRoot + "/") && normalizedFull !== normalizedMediaRoot) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!existsSync(full) || !statSync(full).isFile()) {
        return new Response("Not found", { status: 404 });
      }
      const ext = full.split(".").pop()?.toLowerCase();
      const mime: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        webm: "video/webm",
        glb: "model/gltf-binary",
        gltf: "model/gltf+json",
        svg: "image/svg+xml",
      };
      const contentType = mime[ext ?? ""] ?? "application/octet-stream";
      const body = readFileSync(full);
      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Serve static files from barehands root
    if (pathname.startsWith("/barehands/static/")) {
      const rel = pathname.slice("/barehands/static/".length).replace(/\\/g, "/");
      const full = join(root, rel);
      const normalizedFull = full.replace(/\\/g, "/");
      const normalizedRoot = root.replace(/\\/g, "/");
      if (!normalizedFull.startsWith(normalizedRoot + "/") && normalizedFull !== normalizedRoot) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!existsSync(full)) {
        return new Response("Not found", { status: 404 });
      }
      const ext = full.split(".").pop()?.toLowerCase();
      const mime: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        glb: "model/gltf-binary",
        gltf: "model/gltf+json",
        webm: "video/webm",
      };
      const contentType = mime[ext ?? ""] ?? "application/octet-stream";
      const body = readFileSync(full);
      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": ext === "html" ? "no-store" : "public, max-age=3600",
        },
      });
    }

    const safePath = pathname.split("?")[0];
    if (!safePath.startsWith("/barehands/")) {
      const rel = safePath.replace(/^\//, "").replace(/\\/g, "/");
      const full = join(root, rel);
      if ((full.startsWith(root + "/") || full === root) && existsSync(full)) {
        const stat = statSync(full);
        if (!stat.isDirectory()) {
          const ext = full.split(".").pop()?.toLowerCase();
          const mime: Record<string, string> = {
            html: "text/html",
            js: "application/javascript",
            css: "text/css",
            json: "application/json",
            png: "image/png",
            jpg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            glb: "model/gltf-binary",
            gltf: "model/gltf+json",
            webm: "video/webm",
          };
          const contentType = mime[ext ?? ""] ?? "application/octet-stream";
          const body = readFileSync(full);
          return new Response(body, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": ext === "html" ? "no-store" : "public, max-age=3600",
            },
          });
        }
      }
    }

    return new Response("Not found", { status: 404 });
  }

  return {
    config,
    handleRequest,
    pushJarvisEvent,
    get port() {
      return port;
    },
    get root() {
      return root;
    },
  } as BarehandsServerHandle;
}
