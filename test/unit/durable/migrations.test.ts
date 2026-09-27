import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../src/durable/migrations";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../migrations/do");

describe("DO migrations", () => {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("registers every file in migrations/do, in order, with its contents", () => {
    expect(MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files);
    for (const m of MIGRATIONS) {
      expect(m.sql).toBe(readFileSync(join(DIR, `${m.name}.sql`), "utf8"));
    }
  });

  it("numbers versions 1, 2, 3, … to match each file's prefix", () => {
    MIGRATIONS.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.name.startsWith(`${String(m.version).padStart(4, "0")}_`)).toBe(true);
    });
  });
});
