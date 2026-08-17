import {
  type JarvisPairingCodeResponse,
  type JarvisPairingExchangeResponse,
} from "@jarvis/shared";

type PendingCode = {
  code: string;
  clientName: string;
  expiresAt: Date;
};

type ActiveToken = {
  token: string;
  clientName: string;
  expiresAt: Date;
};

export class PairingManager {
  private pendingCodes = new Map<string, PendingCode>();
  private activeTokens = new Map<string, ActiveToken>();

  generateCode(clientName: string, ttlMs = 300_000): JarvisPairingCodeResponse {
    const code = Math.floor(100_000 + Math.random() * 900_000).toString();
    const expiresAt = new Date(Date.now() + ttlMs);

    this.pendingCodes.set(code, { code, clientName, expiresAt });

    return {
      code,
      expiresAt: expiresAt.toISOString(),
    };
  }

  exchangeCode(code: string, clientName: string, ttlMs = 86_400_000): JarvisPairingExchangeResponse | undefined {
    const pending = this.pendingCodes.get(code);
    if (!pending) return undefined;

    this.pendingCodes.delete(code);

    if (pending.clientName !== clientName || pending.expiresAt.getTime() < Date.now()) {
      return undefined;
    }

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + ttlMs);

    this.activeTokens.set(token, { token, clientName, expiresAt });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  verifyToken(token: string): boolean {
    const active = this.activeTokens.get(token);
    if (!active) return false;
    if (active.expiresAt.getTime() < Date.now()) {
      this.activeTokens.delete(token);
      return false;
    }
    return true;
  }

  revokeToken(token: string): void {
    this.activeTokens.delete(token);
  }
}
