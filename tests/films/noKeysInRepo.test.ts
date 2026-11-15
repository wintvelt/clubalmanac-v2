// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WP21 A-invariant 9 en besluit 4: geen bestandsnaam uit blob-videos en geen
// openbare bucket-URL in de repo. De repo is publiek en de bestanden waren
// per stuk openbaar te lezen: een bestandsnaam in de repo is dan de film zelf.
//
// - Altijd: geen openbare S3-URL naar de bucket in een getrackt (of nog niet
//   genegeerd) bestand.
// - Lokaal, als scripts/.data/wp21/films.json er is (gitignored): geen van de
//   echte sleutels, in welke codering ook. In CI ontbreekt dat bestand; dan
//   wordt die test overgeslagen.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FILMS_JSON = join(ROOT, "scripts/.data/wp21/films.json");

function repoFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((f) => f.length > 0);
}

function textOf(rel: string): string | null {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null; // gewist in de werkmap
  const st = statSync(abs);
  if (!st.isFile() || st.size > 8 * 1024 * 1024) return null;
  const buf = readFileSync(abs);
  if (buf.includes(0)) return null; // binair
  return buf.toString("utf8");
}

function variants(key: string): string[] {
  const perSegment = key.split("/").map(encodeURIComponent).join("/");
  return [...new Set([key, key.replace(/ /g, "+"), perSegment, encodeURIComponent(key)])];
}

// Opgebouwd, zodat deze test zelf niet matcht.
const BUCKET = ["blob", "videos"].join("-");
const PUBLIC_URL = new RegExp(
  `${BUCKET}\\.s3[.-][a-z0-9.-]*amazonaws\\.com|s3[.-][a-z0-9.-]*amazonaws\\.com/${BUCKET}`,
  "i",
);

describe("A-invariant 9: geen bestandsnamen of bucket-URL in de repo", () => {
  it("sanity: git ls-files vindt bestanden", () => {
    expect(repoFiles().length).toBeGreaterThan(50);
  });

  it("geen openbare URL naar de film-bucket", () => {
    const hits: string[] = [];
    for (const f of repoFiles()) {
      const text = textOf(f);
      if (text && PUBLIC_URL.test(text)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it.skipIf(!existsSync(FILMS_JSON))("geen echte sleutel uit blob-videos (lokaal, uit films.json)", () => {
    const data = JSON.parse(readFileSync(FILMS_JSON, "utf8")) as {
      items: Array<{ videoKey: string; coverKey?: string | null }>;
      notInOldApp?: Array<{ videoKey: string; coverKey?: string | null }>;
    };
    const keys = [...data.items, ...(data.notInOldApp ?? [])]
      .flatMap((i) => [i.videoKey, i.coverKey])
      .filter((k): k is string => typeof k === "string" && k.length > 0);
    expect(keys.length).toBeGreaterThan(0);
    const needles = keys.flatMap(variants);
    const hits: string[] = [];
    for (const f of repoFiles()) {
      const text = textOf(f);
      if (!text) continue;
      for (const n of needles) if (text.includes(n)) hits.push(`${f}: ${n.length} tekens`);
    }
    // Het bestand en de sleutel worden niet geprint: de testuitvoer kan in CI-logs belanden.
    expect(hits, "een echte bestandsnaam uit blob-videos staat in de repo").toEqual([]);
  });
});
