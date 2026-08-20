import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const workspaceRoot = join(projectRoot, "..", "..");
const sourceRoot = join(projectRoot, "src");
const outputRoot = join(projectRoot, "dist");
const sharedTokens = join(projectRoot, "packages", "shared", "src", "design-tokens.css");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const builds = await Promise.all([
  Bun.build({
    entrypoints: [join(sourceRoot, "main.ts")],
    outdir: outputRoot,
    naming: "main.cjs",
    target: "node",
    format: "cjs",
    external: ["electron"],
  }),
  Bun.build({
    entrypoints: [join(sourceRoot, "preload.ts")],
    outdir: outputRoot,
    naming: "preload.cjs",
    target: "node",
    format: "cjs",
    external: ["electron"],
  }),
  Bun.build({
    entrypoints: [join(sourceRoot, "renderer.tsx")],
    outdir: outputRoot,
    naming: "renderer.js",
    target: "browser",
    format: "esm",
  }),
]);

for (const result of builds) {
  if (!result.success) {
    throw new AggregateError(result.logs, "JARVIS desktop bundle failed");
  }
}

await copyFile(join(sourceRoot, "index.html"), join(outputRoot, "index.html"));

// Copy icon assets so the running app (app.getAppPath()/icons/...) can resolve them.
const iconSrcDir = join(projectRoot, "icons");
const iconOutDir = join(outputRoot, "icons");
await mkdir(iconOutDir, { recursive: true });
for (const iconFile of ["icon.png", "icon.ico", "icon.svg", "icon.icns"]) {
  const from = join(iconSrcDir, iconFile);
  try {
    await copyFile(from, join(iconOutDir, iconFile));
  } catch {
    // optional asset — ignore if absent
  }
}
const [tokens, rendererCss] = await Promise.all([
  readFile(sharedTokens, "utf8"),
  readFile(join(sourceRoot, "renderer.css"), "utf8"),
]);
await writeFile(join(outputRoot, "renderer.css"), `${tokens}\n${rendererCss}`, "utf8");

console.log(`JARVIS desktop preview built at ${outputRoot}`);

