/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { modules } from "../_helpers/modules";

// WP24 audit R1: tests draaien altijd tegen de `convex/`-map naast deze
// tests, niet tegen die naast de (mogelijk gesymlinkte) node_modules.
// Een kopie met een gesymlinkte node_modules gaf anders een vals-groene
// mutatie-check. Elke convexTest-aanroep krijgt daarom de modules uit
// tests/_helpers/modules.ts mee.

const sources = import.meta.glob<string>(["../**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const SELF = "./modulesRoot.test.ts";

describe("R1 — convexTest krijgt de modules van deze checkout", () => {
  it("de helper vindt de convex/-map naast de tests", () => {
    const keys = Object.keys(modules);
    expect(keys).toContain("../../convex/schema.ts");
    expect(keys).toContain("../../convex/photos.ts");
    expect(keys.some((k) => k.startsWith("../../convex/_generated/"))).toBe(true);
  });

  it("testbestanden zijn gevonden (sanity: de glob werkt)", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
  });

  it("geen testbestand roept convexTest aan zonder modules", () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (path === SELF) continue;
      // convexTest() of convexTest(x): één argument of geen, dan zoekt
      // convex-test zelf naar een convex/-map.
      const re = /convexTest\(\s*(?:[A-Za-z_$][\w$]*)?\s*\)/g;
      for (const m of src.matchAll(re)) offenders.push(`${path}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
