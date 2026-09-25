import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package root: the nearest directory above this module that has `config/`.
 * This module runs from `server/` in development and from a chunk in `dist/server/` once built.
 */
export const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "config", "pricing.json"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`mitllmproxy: cannot find config/ above ${fileURLToPath(import.meta.url)}`);
    dir = up;
  }
  return dir;
})();

export const configPath = (name: string) => resolve(ROOT, "config", name);
