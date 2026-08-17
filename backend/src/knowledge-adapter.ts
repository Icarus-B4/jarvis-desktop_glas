import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type {
  JarvisKnowledgeAddRequest,
  JarvisKnowledgeItem,
  JarvisKnowledgeQuery,
} from "@jarvis/shared";

export type JarvisKnowledgeAdapter = {
  listItems(query?: JarvisKnowledgeQuery): Promise<JarvisKnowledgeItem[]>;
  addItem(request: JarvisKnowledgeAddRequest): Promise<JarvisKnowledgeItem>;
  deleteItem(id: string): Promise<boolean>;
};

export class FileJarvisKnowledgeAdapter implements JarvisKnowledgeAdapter {
  private filePath: string;
  private cache: JarvisKnowledgeItem[] | undefined;

  constructor(filePath?: string) {
    this.filePath =
      filePath ??
      join(process.cwd(), ".tmp", "knowledge-base.json");
  }

  private async ensureLoaded(): Promise<JarvisKnowledgeItem[]> {
    if (this.cache) return this.cache;

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as JarvisKnowledgeItem[];
      this.cache = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Standard-Wissen für Ed vorbelegen (z.B. ESP32, CSS Design)
      this.cache = [
        {
          id: "kb-esp32-trgb",
          title: "ESP32 T-RGB (LilyGo) Setup & Pins",
          category: "architecture",
          tags: ["esp32", "lilygo", "hardware"],
          content: "LilyGo T-RGB Display Setup:\n- Bildschirm: ST7789 SPI Display 480x480\n- LVGL 8.x Framework in PlatformIO / VS Code nutzen.\n- Debugging via Serial.printf() auf 115200 Baud.",
          updatedAt: new Date().toISOString(),
        },
        {
          id: "kb-css-design-tokens",
          title: "Vanilla CSS & Rich Aesthetics Richtlinien",
          category: "code",
          tags: ["css", "webdesign", "aesthetics"],
          content: "Design-Regeln:\n- Keine generischen Farben (plain red/blue).\n- Curated HSL Palette mit Glowing Neon Cyan (#54e6ff) & Dark Void Theme.\n- Glassmorphism, Micro-Animations & Inter Fonts.",
          updatedAt: new Date().toISOString(),
        },
      ];
      await this.save();
    }
    return this.cache;
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    try {
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch (err) {
      console.warn("Fehler beim Speichern der Knowledge Base:", err);
    }
  }

  async listItems(query?: JarvisKnowledgeQuery): Promise<JarvisKnowledgeItem[]> {
    const items = await this.ensureLoaded();
    let result = [...items];

    if (query?.category) {
      result = result.filter((item) => item.category === query.category);
    }

    if (query?.query && query.query.trim()) {
      const q = query.query.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.content.toLowerCase().includes(q) ||
          item.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    return result;
  }

  async addItem(request: JarvisKnowledgeAddRequest): Promise<JarvisKnowledgeItem> {
    const items = await this.ensureLoaded();
    const newItem: JarvisKnowledgeItem = {
      id: `kb-${crypto.randomUUID()}`,
      title: request.title.trim(),
      category: request.category,
      tags: request.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      content: request.content.trim(),
      updatedAt: new Date().toISOString(),
    };

    items.unshift(newItem);
    await this.save();
    return newItem;
  }

  async deleteItem(id: string): Promise<boolean> {
    const items = await this.ensureLoaded();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return false;

    items.splice(idx, 1);
    await this.save();
    return true;
  }
}
