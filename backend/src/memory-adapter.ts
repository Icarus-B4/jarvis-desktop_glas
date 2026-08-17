import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  JarvisMemoryAddRequest,
  JarvisMemoryItem,
  JarvisMemoryQuery,
} from "@jarvis/shared";

export type JarvisMemoryAdapter = {
  listMemory(query?: JarvisMemoryQuery): Promise<JarvisMemoryItem[]>;
  addMemoryItem(request: JarvisMemoryAddRequest): Promise<JarvisMemoryItem>;
  deleteMemoryItem(id: string): Promise<boolean>;
  clearMemory(): Promise<void>;
  getStoragePath(): string;
};

/** Formatierte Repräsentation gespeicherter Erinnerungen für den KI-System-Prompt */
export function formatMemoryContext(items: JarvisMemoryItem[]): string {
  if (items.length === 0) return "";
  const lines: string[] = ["### GESPEICHERTES OPERATOR-GEDÄCHTNIS (PERSÖNLICHER KONTEXT):"];
  for (const item of items) {
    const categoryLabel =
      item.category === "operator_preference"
        ? "Präferenz"
        : item.category === "structured_fact"
        ? "Fakt"
        : "Dokument";
    lines.push(`- [${categoryLabel}] ${item.key}: ${item.value}`);
  }
  lines.push("Verwende dieses Wissen natürlich und präzise in deiner Antwort.");
  return lines.join("\n");
}

const DEFAULT_INITIAL_MEMORIES: Array<Omit<JarvisMemoryItem, "id" | "createdAt" | "updatedAt">> = [
  {
    category: "operator_preference",
    key: "Operator Name",
    value: "Ed",
    provenance: "system_default",
  },
  {
    category: "operator_preference",
    key: "Sprache",
    value: "Deutsch",
    provenance: "system_default",
  },
  {
    category: "structured_fact",
    key: "Betriebssystem",
    value: "Windows",
    provenance: "system_default",
  },
  {
    category: "operator_preference",
    key: "Entwicklungs-Fokus",
    value: "Python KI, Webdesign (Rich Aesthetics), Android & ESP32 Microcontroller",
    provenance: "system_default",
  },
  {
    category: "operator_preference",
    key: "Code-Stil",
    value: "Clean Code, modular, Vanilla CSS, Deutsch in Kommentaren",
    provenance: "system_default",
  },
];

export class FileJarvisMemoryAdapter implements JarvisMemoryAdapter {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = resolve(filePath ?? process.env.JARVIS_MEMORY_FILE_PATH ?? ".jarvis-memory.json");
  }

  getStoragePath(): string {
    return this.filePath;
  }

  private async readAll(): Promise<JarvisMemoryItem[]> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Ignorieren falls Datei fehlt oder ungültig
    }

    // Wenn leer oder neu → Standard-Initialwerte speichern
    const now = new Date().toISOString();
    const defaults: JarvisMemoryItem[] = DEFAULT_INITIAL_MEMORIES.map((def, idx) => ({
      id: `mem-default-${idx + 1}`,
      createdAt: now,
      updatedAt: now,
      ...def,
    }));
    await this.writeAll(defaults);
    return defaults;
  }

  private async writeAll(items: JarvisMemoryItem[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf-8");
  }

  async listMemory(query?: JarvisMemoryQuery): Promise<JarvisMemoryItem[]> {
    let items = await this.readAll();
    if (query?.category) {
      items = items.filter((item) => item.category === query.category);
    }
    if (query?.search) {
      const term = query.search.toLowerCase();
      items = items.filter(
        (item) =>
          item.key.toLowerCase().includes(term) ||
          item.value.toLowerCase().includes(term) ||
          item.provenance.toLowerCase().includes(term),
      );
    }
    return items;
  }

  async addMemoryItem(request: JarvisMemoryAddRequest): Promise<JarvisMemoryItem> {
    const items = await this.readAll();
    const now = new Date().toISOString();
    const newItem: JarvisMemoryItem = {
      id: `mem-${crypto.randomUUID()}`,
      category: request.category,
      key: request.key,
      value: request.value,
      provenance: request.provenance ?? "manual_entry",
      createdAt: now,
      updatedAt: now,
    };
    items.unshift(newItem);
    await this.writeAll(items);
    return newItem;
  }

  async deleteMemoryItem(id: string): Promise<boolean> {
    const items = await this.readAll();
    const initialLen = items.length;
    const filtered = items.filter((item) => item.id !== id);
    if (filtered.length === initialLen) return false;
    await this.writeAll(filtered);
    return true;
  }

  async clearMemory(): Promise<void> {
    await this.writeAll([]);
  }
}
