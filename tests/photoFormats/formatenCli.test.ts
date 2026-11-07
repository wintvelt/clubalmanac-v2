import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { formaten } from "../../scripts/migrate/formaten";
import { registerUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { captureConsole } from "../migration/_harness";
import { formatsOf, seedPhoto } from "./_helpers";

// WP25 fix-cyclus 1 — het commando `formaten` (A-invariant 21, 23, 24;
// kernvondst 8, 10, 11).
//
// De Convex-verbinding is vervangen door een convex-test-deployment: de echte
// `backfill`, `formatBatch`, `makeFormats` en `selfTest` draaien, alleen de
// beeldbibliotheek is nep. Een origineel met "crash" erin laat de action
// omvallen, zoals een HEIC die het geheugen opblaast: vanaf die foto doet de
// action niets meer, en de CLI krijgt een fout in plaats van een uitkomst. Wat
// eerder in die action klaar was, blijft klaar (elke foto legt zich in een
// eigen mutation vast).

const h = vi.hoisted(() => ({
  t: null as unknown as ReturnType<typeof import("convex-test").convexTest>,
  crashed: false,
  calls: [] as string[],
  selfTestBroken: false,
  selfTestError: null as string | null,
}));

vi.mock("../../convex/lib/photoFormats", () => ({
  HEIC_MAX_PIXELS: 13_000_000,
  makeFormatImages: async (bytes: Uint8Array) => {
    if (h.crashed) throw new Error("de action is al omgevallen");
    const text = new TextDecoder().decode(bytes);
    if (text.includes("crash")) {
      h.crashed = true;
      throw new Error("out of memory");
    }
    return {
      klein: new TextEncoder().encode(`klein:${text}`),
      groot: new TextEncoder().encode(`groot:${text}`),
      width: 4000,
      height: 3000,
    };
  },
}));

vi.mock("../../scripts/migrate/convexAdmin.ts", () => ({
  makeAdminClient: (target: string) => ({ target, url: "https://fake-dev-deployment.convex.cloud", client: {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runQuery: async (_admin: unknown, ref: any, args: any) => {
    h.calls.push(getFunctionName(ref));
    return await h.t.query(ref, args);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMutation: async (_admin: unknown, ref: any, args: any) => {
    h.calls.push(getFunctionName(ref));
    return await h.t.mutation(ref, args);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runAction: async (_admin: unknown, ref: any, args: any) => {
    const name = getFunctionName(ref);
    h.calls.push(name);
    if (name.endsWith("selfTest") && h.selfTestBroken) {
      throw new Error("Cannot find module 'sharp'");
    }
    if (name.endsWith("selfTest") && h.selfTestError !== null) {
      throw new Error(h.selfTestError);
    }
    h.crashed = false;
    const result = await h.t.action(ref, args);
    if (h.crashed) {
      h.crashed = false;
      throw new Error("[Request ID: x] Server Error: Your function ran out of memory");
    }
    return result;
  },
}));

beforeEach(() => {
  h.t = convexTest(schema, modules);
  h.crashed = false;
  h.calls = [];
  h.selfTestBroken = false;
  h.selfTestError = null;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Wat de CLI zelf afdrukte. De regels van de action (`[photoFormats] …`) gaan
 * in convex-test naar dezelfde console, maar staan in het echt in de
 * Convex-log, niet in de terminal van de operator.
 */
function cliText(out: ReturnType<typeof captureConsole>): string {
  return `${out.log()}\n${out.error()}`
    .split("\n")
    .filter((l) => !l.includes("[photoFormats]"))
    .join("\n");
}

async function seed(originals: string[]): Promise<Id<"photos">[]> {
  const owner = await registerUser(h.t, "user_owen", "owen@x.com", "Owen");
  const ids: Id<"photos">[] = [];
  for (const original of originals) ids.push((await seedPhoto(h.t, owner, { original })).photoId);
  return ids;
}

describe("een action die omvalt, blokkeert de backfill niet (invariant 21)", () => {
  it("crash midden in een batch: die batch één voor één, de crash telt als mislukt, alle andere foto's krijgen formaten", async () => {
    const ids = await seed(["a", "b", "crash", "d", "e", "f", "g"]);
    const out = captureConsole();

    const code = await formaten("dev", 3);

    expect(code).toBe(1);
    for (const [i, id] of ids.entries()) {
      if (i === 2) expect(await formatsOf(h.t, id), "de crash-foto").toBeUndefined();
      else expect(await formatsOf(h.t, id), `foto ${i}`).toBeDefined();
    }
    const text = cliText(out);
    expect(text).toMatch(new RegExp(`${ids[2]}.*action brak af|action brak af.*${ids[2]}`));
  });

  it("de foto na de crash in dezelfde batch krijgt zijn formaten in een eigen action", async () => {
    const ids = await seed(["a", "crash", "c"]);
    captureConsole();

    await formaten("dev", 3);

    expect(await formatsOf(h.t, ids[2]!)).toBeDefined();
    expect(h.calls.filter((c) => c.endsWith("makeFormats")).length).toBeGreaterThanOrEqual(2);
  });

  it("run 2 eindigt ook (exit 1), met alleen dezelfde foto als mislukt", async () => {
    const ids = await seed(["a", "crash", "c", "d"]);
    captureConsole();
    await formaten("dev", 2);

    const out = captureConsole();
    const code = await formaten("dev", 2);

    expect(code).toBe(1);
    const text = cliText(out);
    expect(text).toContain(ids[1]);
    for (const id of [ids[0], ids[2], ids[3]]) expect(text).not.toContain(`- ${id}`);
  });

  it("zonder crash: exit 0, en geen foto één voor één", async () => {
    await seed(["a", "b", "c"]);
    captureConsole();

    expect(await formaten("dev", 2)).toBe(0);
    expect(h.calls.filter((c) => c.endsWith("makeFormats"))).toEqual([]);
  });
});

describe("--batch-size (invariant 23)", () => {
  it("50 mag, 51 en 0 niet", async () => {
    captureConsole();
    expect(await formaten("dev", 50)).toBe(0);
    await expect(formaten("dev", 51)).rejects.toThrow(/batch-size/);
    await expect(formaten("dev", 0)).rejects.toThrow(/batch-size/);
  });
});

describe("de beeldbibliotheek eerst (invariant 24)", () => {
  it("selfTest draait vóór de eerste batch, ook op een lege deployment", async () => {
    captureConsole();

    expect(await formaten("dev", 20)).toBe(0);

    const self = h.calls.findIndex((c) => c === "photoFormats:selfTest");
    const first = h.calls.findIndex((c) => c === "photoFormats:backfill");
    expect(self, "selfTest aangeroepen").toBeGreaterThanOrEqual(0);
    expect(first, "daarna de backfill").toBeGreaterThan(self);
  });

  it("selfTest faalt: exit 1, geen batch", async () => {
    await seed(["a"]);
    h.selfTestBroken = true;
    const out = captureConsole();

    expect(await formaten("dev", 20)).toBe(1);

    expect(h.calls).toContain("photoFormats:selfTest");
    expect(h.calls).not.toContain("photoFormats:backfill");
    expect(cliText(out)).toMatch(/sharp/);
    expect(cliText(out), "het advies over de bibliotheek").toMatch(/package\.json/);
  });
});

// ── fix-cyclus 2 ─────────────────────────────────────────────────────

const LIBRARY_ADVICE = /package\.json|convex\.json/;

// De derde parameter (de af te tekenen foto's) bestaat pas na de impl.
const formatenAccept = formaten as unknown as (
  target: "dev" | "prod",
  batchSize: number,
  acceptNoFormats?: Id<"photos">[],
) => Promise<number>;

describe("selfTest faalt: het advies past bij de oorzaak (invariant 27)", () => {
  it.each([
    "[Request ID: x] Server Error: OperationNotPermitted: this key cannot runInternalActions",
    "[migrate] https://fake-dev-deployment.convex.cloud wees de admin-key af.\n401 Unauthorized",
  ])("de key mag geen internal actions draaien (%s): het key-advies, niet dat van de bibliotheek", async (error) => {
    await seed(["a"]);
    h.selfTestError = error;
    const out = captureConsole();

    expect(await formaten("dev", 20)).toBe(1);

    expect(h.calls).not.toContain("photoFormats:backfill");
    const text = cliText(out);
    expect(text).toMatch(/key/i);
    expect(text).toMatch(/internal action/i);
    expect(text).not.toMatch(LIBRARY_ADVICE);
  });

  it.each(["fetch failed", "connect ECONNREFUSED 127.0.0.1:443", "getaddrinfo ENOTFOUND x.convex.cloud", "connect ETIMEDOUT"])(
    "de verbinding viel weg (%s): het netwerk-advies, niet dat van de bibliotheek",
    async (error) => {
      await seed(["a"]);
      h.selfTestError = error;
      const out = captureConsole();

      expect(await formaten("dev", 20)).toBe(1);

      expect(h.calls).not.toContain("photoFormats:backfill");
      const text = cliText(out);
      expect(text).toMatch(/verbinding|netwerk/i);
      expect(text).not.toMatch(LIBRARY_ADVICE);
    },
  );
});

describe("--accept-no-formats: een foto die blijft mislukken bewust aftekenen (invariant 25)", () => {
  it("run 1 mislukt op één foto; run 2 tekent hem af: exit 0, en hij wordt niet meer geprobeerd", async () => {
    const ids = await seed(["a", "crash", "c"]);
    captureConsole();
    expect(await formaten("dev", 20)).toBe(1);

    h.calls = [];
    const out = captureConsole();
    const code = await formatenAccept("dev", 20, [ids[1]!]);

    expect(code).toBe(0);
    expect(h.calls.filter((c) => c.endsWith("makeFormats")), "geen herkansing voor de afgetekende foto").toEqual([]);
    expect(await formatsOf(h.t, ids[1]!)).toBeUndefined();
    const text = cliText(out);
    expect(text).toMatch(new RegExp(`afgetekend zonder formaten[\\s\\S]*${ids[1]}`));
  });

  it("aftekenen gebeurt na selfTest en vóór de eerste batch", async () => {
    const ids = await seed(["crash", "b"]);
    captureConsole();

    expect(await formatenAccept("dev", 20, [ids[0]!])).toBe(0);

    const self = h.calls.indexOf("photoFormats:selfTest");
    const accept = h.calls.indexOf("photos:acceptNoFormats");
    const batch = h.calls.indexOf("photoFormats:backfill");
    expect(self).toBeGreaterThanOrEqual(0);
    expect(accept).toBeGreaterThan(self);
    expect(batch).toBeGreaterThan(accept);
  });

  it("een volgende run zonder de vlag: nog steeds exit 0, en de afgetekende foto staat in de uitvoer", async () => {
    const ids = await seed(["a", "crash"]);
    captureConsole();
    await formatenAccept("dev", 20, [ids[1]!]);

    const out = captureConsole();
    expect(await formaten("dev", 20)).toBe(0);
    expect(cliText(out)).toMatch(new RegExp(`afgetekend zonder formaten[\\s\\S]*${ids[1]}`));
  });

  it("een id met een formaat-veld: exit 1, geen batch, niets afgetekend", async () => {
    const ids = await seed(["a", "b"]);
    captureConsole();
    await formaten("dev", 20);
    h.calls = [];

    const out = captureConsole();
    expect(await formatenAccept("dev", 20, [ids[0]!])).toBe(1);

    expect(h.calls).not.toContain("photoFormats:backfill");
    expect(cliText(out)).toContain(ids[0]!);
    const photo = (await h.t.run((ctx) => ctx.db.get(ids[0]!))) as { noFormatsAcceptedAt?: number } | null;
    expect(photo?.noFormatsAcceptedAt).toBeUndefined();
  });

  it("afgetekend, maar een andere foto mislukt nog: exit 1", async () => {
    const ids = await seed(["crash", "b", "crash ook"]);
    captureConsole();

    expect(await formatenAccept("dev", 20, [ids[0]!])).toBe(1);
  });
});
