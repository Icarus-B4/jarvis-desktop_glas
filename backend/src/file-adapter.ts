import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

export type JarvisFileInfo = {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes?: number | undefined;
};

export type JarvisRagChunk = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  score: number;
};

export type JarvisFileAdapter = {
  listDirectory(relativeDir?: string): Promise<JarvisFileInfo[]>;
  readFile(relativePath: string): Promise<string>;
  queryRag(query: string, maxResults?: number): Promise<JarvisRagChunk[]>;
  getWorkspaceRoot(): string;
};

const ALLOWED_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".html",
  ".css",
  ".py",
]);

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".vercel",
  ".gstack",
  "bun.lock",
  "package-lock.json",
]);

export class FileJarvisFileAdapter implements JarvisFileAdapter {
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = resolve(workspaceRoot ?? process.cwd());
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private resolveSafePath(targetPath: string): string {
    const resolved = resolve(this.workspaceRoot, targetPath);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error("Zugriff außerhalb des Projektverzeichnisses nicht gestattet.");
    }
    return resolved;
  }

  async listDirectory(relativeDir = ""): Promise<JarvisFileInfo[]> {
    const safePath = this.resolveSafePath(relativeDir);
    const entries = await readdir(safePath, { withFileTypes: true });

    const results: JarvisFileInfo[] = [];
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;

      const fullPath = join(safePath, entry.name);
      const relPath = relative(this.workspaceRoot, fullPath).replace(/\\/g, "/");

      let sizeBytes: number | undefined;
      if (entry.isFile()) {
        try {
          const stats = await stat(fullPath);
          sizeBytes = stats.size;
        } catch {
          // Ignorieren falls stat fehlschlägt
        }
      }

      results.push({
        path: relPath,
        name: entry.name,
        isDirectory: entry.isDirectory(),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      });
    }

    return results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(relativePath: string): Promise<string> {
    const safePath = this.resolveSafePath(relativePath);
    const ext = extname(safePath).toLowerCase();

    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`Dateityp '${ext}' ist aus Sicherheitsgründen gesperrt.`);
    }

    const content = await readFile(safePath, "utf-8");
    if (content.length > 500_000) {
      throw new Error("Datei überschreitet die maximale Größe von 500KB.");
    }

    return content;
  }

  /** Durchsucht indizierbare Projektdateien nach relevanten Chunks für RAG */
  async queryRag(query: string, maxResults = 5): Promise<JarvisRagChunk[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (terms.length === 0) return [];

    const filesToScan: string[] = [];

    const scanDir = async (dirPath: string, depth = 0) => {
      if (depth > 4) return;
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
          const fullPath = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if (ALLOWED_EXTENSIONS.has(ext)) {
              filesToScan.push(fullPath);
            }
          }
        }
      } catch {
        // Ordner ignorieren falls unlesbar
      }
    };

    await scanDir(this.workspaceRoot);

    const scoredChunks: JarvisRagChunk[] = [];

    for (const file of filesToScan) {
      try {
        const relPath = relative(this.workspaceRoot, file).replace(/\\/g, "/");
        const content = await readFile(file, "utf-8");
        const lines = content.split(/\r?\n/);

        // In Chunks von ca. 15 Zeilen teilen
        const chunkSize = 15;
        for (let i = 0; i < lines.length; i += chunkSize) {
          const chunkLines = lines.slice(i, i + chunkSize);
          const chunkText = chunkLines.join("\n").trim();
          if (!chunkText || chunkText.length < 20) continue;

          const lowerChunk = chunkText.toLowerCase();
          let score = 0;

          for (const term of terms) {
            const matches = lowerChunk.split(term).length - 1;
            if (matches > 0) {
              score += matches * 2;
            }
          }

          // Bonus wenn Pfadname einen Begriff enthält
          for (const term of terms) {
            if (relPath.toLowerCase().includes(term)) {
              score += 3;
            }
          }

          if (score > 0) {
            scoredChunks.push({
              filePath: relPath,
              lineStart: i + 1,
              lineEnd: Math.min(lines.length, i + chunkSize),
              content: chunkText.slice(0, 1000),
              score,
            });
          }
        }
      } catch {
        // Datei ignorieren
      }
    }

    scoredChunks.sort((a, b) => b.score - a.score);
    return scoredChunks.slice(0, maxResults);
  }
}
