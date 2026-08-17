# `@jarvis/local-service`

A Bun-only, loopback-bound preview service for the Jarvis UI. It defaults to `http://127.0.0.1:4317` and permits browser CORS requests only from `http://localhost:3002` and `http://127.0.0.1:3002` unless another loopback origin is explicitly configured.

## Current security boundary

The current unauthenticated surface is intentionally limited to non-sensitive, read-only preview data:

- `GET /health`
- `GET /v1/dashboard`
- `GET /v1/events` (typed `501` WebSocket-streaming stub)
- CORS `OPTIONS`

There are no filesystem, browser, shell, application-control, or action endpoints. The service rejects wildcard and non-loopback bind hosts, and configured browser origins must also be loopback HTTP(S) origins.

## Pairing and authentication seam

Before any personalized or privileged route is added, a local user must explicitly approve a short-lived pairing code. Successful pairing should issue a short-lived, narrowly scoped token. Every future route must validate that token and its route-specific scopes; privileged tokens must never be accepted through query parameters or persisted by the preview API.

## Commands

```sh
bun run start
bun test
bun run typecheck
```

