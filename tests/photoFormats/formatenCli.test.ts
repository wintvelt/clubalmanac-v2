import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
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
  made: [] as string[],
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
    if (name.endsWith("makeFormats")) h.made.push(args.photoId);
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
  h.made = [];
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

// De derde en vierde parameter (aftekenen, terugdraaien; fix-cyclus 2 en 3).
const formatenAccept = formaten as unknown as (
  target: "dev" | "prod",
  batchSize: number,
  acceptNoFormats?: Id<"photos">[],
  unaccept?: Id<"photos">[],
) => Promise<number>;

async function markerOf(id: Id<"photos">): Promise<number | undefined> {
  const photo = (await h.t.run((ctx) => ctx.db.get(id))) as { noFormatsAcceptedAt?: number } | null;
  return photo?.noFormatsAcceptedAt;
}

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

// Fix-cyclus 3 (kernvondst 19): de CLI tekent af ná de batches, en alleen een
// id dat in díe run mislukte (of al is afgetekend). Elk ander id weigert hij
// met dat id: niets afgetekend, exitcode 1.
describe("--accept-no-formats: alleen wat in deze run mislukte (invariant 25)", () => {
  it("de foto mislukt in deze run en wordt daarna afgetekend: exit 0", async () => {
    const ids = await seed(["a", "crash", "c"]);
    const out = captureConsole();

    expect(await formatenAccept("dev", 20, [ids[1]!])).toBe(0);

    expect(await markerOf(ids[1]!)).toBeDefined();
    expect(await formatsOf(h.t, ids[1]!)).toBeUndefined();
    expect(cliText(out)).toMatch(new RegExp(`afgetekend zonder formaten[\\s\\S]*${ids[1]}`));
  });

  it("aftekenen gebeurt na selfTest en na de laatste batch", async () => {
    const ids = await seed(["crash", "b"]);
    captureConsole();

    expect(await formatenAccept("dev", 20, [ids[0]!])).toBe(0);

    const self = h.calls.indexOf("photoFormats:selfTest");
    const accept = h.calls.indexOf("photos:acceptNoFormats");
    const lastBatch = h.calls.lastIndexOf("photoFormats:backfill");
    expect(self).toBeGreaterThanOrEqual(0);
    expect(lastBatch).toBeGreaterThan(self);
    expect(accept, "na de batches").toBeGreaterThan(lastBatch);
  });

  it("een volgende run zonder de vlag: geen herkansing, exit 0, en de foto staat in de uitvoer", async () => {
    const ids = await seed(["a", "crash"]);
    captureConsole();
    await formatenAccept("dev", 20, [ids[1]!]);
    h.calls = [];
    h.made = [];

    const out = captureConsole();
    expect(await formaten("dev", 20)).toBe(0);

    expect(h.made, "geen herkansing voor de afgetekende foto").toEqual([]);
    expect(cliText(out)).toMatch(new RegExp(`afgetekend zonder formaten[\\s\\S]*${ids[1]}`));
  });

  it("dezelfde vlag nog eens, voor een al afgetekende foto: geen fout, exit 0", async () => {
    const ids = await seed(["a", "crash"]);
    captureConsole();
    expect(await formatenAccept("dev", 20, [ids[1]!])).toBe(0);

    expect(await formatenAccept("dev", 20, [ids[1]!])).toBe(0);
  });

  it("een foto die in deze run lukte (of een typfout): exit 1, het id in de uitvoer, niets afgetekend", async () => {
    const ids = await seed(["a", "crash"]);
    const out = captureConsole();

    expect(await formatenAccept("dev", 20, [ids[1]!, ids[0]!])).toBe(1);

    expect(cliText(out)).toContain(ids[0]!);
    expect(await markerOf(ids[0]!)).toBeUndefined();
    expect(await markerOf(ids[1]!), "alles of niets: ook de mislukte niet").toBeUndefined();
  });

  it("een foto die nog nooit geprobeerd was en nu lukt: niet afgetekend, hij krijgt zijn formaten", async () => {
    const ids = await seed(["a"]);
    captureConsole();

    expect(await formatenAccept("dev", 20, [ids[0]!])).toBe(1);

    expect(await markerOf(ids[0]!)).toBeUndefined();
    expect(await formatsOf(h.t, ids[0]!)).toBeDefined();
  });

  it("een id met een formaat-veld van een eerdere run: exit 1, niets afgetekend", async () => {
    const ids = await seed(["a", "b"]);
    captureConsole();
    await formaten("dev", 20);

    const out = captureConsole();
    expect(await formatenAccept("dev", 20, [ids[0]!])).toBe(1);

    expect(cliText(out)).toContain(ids[0]!);
    expect(await markerOf(ids[0]!)).toBeUndefined();
  });

  it("afgetekend, maar een andere foto mislukt nog: exit 1", async () => {
    const ids = await seed(["crash", "b", "crash ook"]);
    captureConsole();

    expect(await formatenAccept("dev", 20, [ids[0]!])).toBe(1);
  });
});

describe("--unaccept: de aftekening terugdraaien (invariant 25)", () => {
  it("wist het veld na selfTest en vóór de eerste batch; dezelfde run probeert de foto weer", async () => {
    const ids = await seed(["a", "crash"]);
    captureConsole();
    await formatenAccept("dev", 20, [ids[1]!]);
    h.calls = [];
    h.made = [];

    expect(await formatenAccept("dev", 20, [], [ids[1]!])).toBe(1);

    expect(await markerOf(ids[1]!)).toBeUndefined();
    expect(h.made).toContain(ids[1]!);
    const self = h.calls.indexOf("photoFormats:selfTest");
    const unaccept = h.calls.indexOf("photos:unacceptNoFormats");
    const batch = h.calls.indexOf("photoFormats:backfill");
    expect(unaccept).toBeGreaterThan(self);
    expect(batch).toBeGreaterThan(unaccept);
  });

  it("een id dat niet is afgetekend: exit 1, het id in de uitvoer, geen batch", async () => {
    const ids = await seed(["a"]);
    const out = captureConsole();

    expect(await formatenAccept("dev", 20, [], [ids[0]!])).toBe(1);

    expect(cliText(out)).toContain(ids[0]!);
    expect(h.calls).not.toContain("photoFormats:backfill");
  });

  it("een id in beide lijsten: exit 1 vóór selfTest, niets geschreven", async () => {
    const ids = await seed(["a", "crash"]);
    captureConsole();
    await formatenAccept("dev", 20, [ids[1]!]);
    h.calls = [];

    expect(await formatenAccept("dev", 20, [ids[1]!], [ids[1]!])).toBe(1);

    expect(h.calls).toEqual([]);
    expect(await markerOf(ids[1]!)).toBeDefined();
  });
});

// Mutant AC4 (kernvondst 20): `photoByPhoto` slaat een afgetekende foto over.
// Het geval: een afgetekende foto van 64 MP staat in een batch die om een
// andere foto omvalt. Probeert de CLI hem dan foto voor foto toch, dan valt
// hij weer om en eindigt elke run op 1.
describe("foto voor foto: een afgetekende foto wordt overgeslagen (invariant 25, AC4)", () => {
  it("een andere foto laat de batch omvallen: de afgetekende foto krijgt geen eigen action", async () => {
    const ids = await seed(["a", "crash afgetekend", "crash nieuw", "d"]);
    await h.t.mutation(internal.photos.acceptNoFormats, { photoIds: [ids[1]!] });
    const out = captureConsole();

    expect(await formaten("dev", 4)).toBe(1);

    expect(h.made, "geen action voor de afgetekende foto").not.toContain(ids[1]!);
    expect(h.made).toContain(ids[2]!);
    expect(await formatsOf(h.t, ids[3]!)).toBeDefined();
    const text = cliText(out);
    expect(text).toMatch(/foto voor foto klaar, mislukt 1\b/);
    expect(text).not.toMatch(new RegExp(`${ids[1]}: (action brak af|mislukt)`));
  });
});

// Kernvondst 18: een afgetekende foto met een dangling set gaf exit 0, terwijl
// `verify` "formaten dangling" bleef melden.
describe("een dangling set met het veld: de CLI herstelt hem (invariant 25)", () => {
  it("exit 0, een volledige set, het veld weg, en de scan meldt niets", async () => {
    const owner = await registerUser(h.t, "user_owen", "owen@x.com", "Owen");
    await h.t.run((ctx) => ctx.db.patch(owner, { photoCount: 1 }));
    const p = await seedPhoto(h.t, owner, { original: "a", withFormats: true, createdAt: Date.now() - 2 * 3_600_000 });
    await h.t.run(async (ctx) => {
      await ctx.storage.delete(p.groot!);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.db.patch(p.photoId, { noFormatsAcceptedAt: Date.now() } as any);
    });
    captureConsole();

    expect(await formaten("dev", 20)).toBe(0);

    expect((await formatsOf(h.t, p.photoId))?.groot).not.toBe(p.groot);
    expect(await markerOf(p.photoId)).toBeUndefined();
    expect(await h.t.query(internal.migration.integrityReport, {})).toEqual([]);
  });
});
