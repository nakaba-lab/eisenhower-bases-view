import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AC5（疎結合の構造保証）— Bases API 接触は src/bases に集約され、
 * src/ui・src/logic は Bases（obsidian）型に直接依存しない。
 * obsidian を value import すると vitest でロード不能になる実害もあるため、
 * 構造テストで「src/ui・src/logic に obsidian import が無い」ことを固定する。
 */

function sourceFiles(dir: string): string[] {
  // ディレクトリが無い場合に readdirSync が ENOENT で落ちないようガードする。
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      return [full];
    }
    return [];
  });
}

const OBSIDIAN_IMPORT = /\bfrom\s+["']obsidian["']/;

describe("AC5 疎結合（src/ui・src/logic は obsidian 非依存）", () => {
  it.each(["src/ui", "src/logic"])(
    "%s 配下の実装ファイルは obsidian を import しない",
    (dir) => {
      const offenders = sourceFiles(dir).filter((file) =>
        OBSIDIAN_IMPORT.test(readFileSync(file, "utf8")),
      );
      expect(offenders).toEqual([]);
    },
  );
});
