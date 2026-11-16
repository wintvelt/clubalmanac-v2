import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import { formaten } from "../../scripts/migrate/formaten";
import { runQuery } from "../../scripts/migrate/convexAdmin.ts";
import { registerUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { captureConsole } from "../migration/_harness";

// WP31 fix-ronde audit (A, 2026-11-16) — `formaten` op prod-volume (spec
// §Blokkers B1, audit N1).
//
// Op dev brak de afsluitende telling bij 1001 foto's af op de limiet voor
// systeemoperaties (WP19a, `wp19a-b-formaten.log`); prod heeft er ~1544. Het
// runbook eist exit 0, anders blijft de app dicht. `convex-test` kent die
// limiet niet. De nep-verbinding hieronder bootst hem na zoals hij op dev
// gezien is: een query die in één keer de formaten van meer dan 1000 foto's
// telt, valt om. Welke query dat is, maakt niet uit.
//
// Gedrag dat hier vastligt: op meer foto's dan in één telling passen klopt de
// telling vóór en na (opgeteld over alle foto's), eindigt een volledige run
// met exit 0, en eindigt een run met één foto zonder formaten achteraan met
// exit 1.

const LIMIT_PHOTOS = 1000;
const N = 1001;

const h = vi.hoisted(() => ({
  t: null as unknown as ReturnType<typeof import("convex-test").convexTest>,
  crashed: false,
  limitHits: [] as string[],
}));

vi.mock("../../convex/lib/photoFormats", () => ({
  HEIC_MAX_PIXELS: 13_000_000,
  makeFormatImages: async (bytes: Uint8Array) => {
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

/** Een telling (object met een getal `photos`) over meer dan 1000 foto's valt om. */
function enforceLimit(name: string, result: unknown): void {
  const photos = (result as { photos?: unknown } | null)?.photos;
  if (typeof photos === "number" && photos > LIMIT_PHOTOS) {
    h.limitHits.push(name);
    throw new Error(`[Request ID: x] Server Error: Too many system operations (${name}, ${photos} foto's)`);
  }
}

vi.mock("../../scripts/migrate/convexAdmin.ts", () => ({
  makeAdminClient: (target: string) => ({ target, url: "https://fake-prod-deployment.convex.cloud", client: {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runQuery: async (_admin: unknown, ref: any, args: any) => {
    const result = await h.t.query(ref, args);
    enforceLimit(getFunctionName(ref), result);
    return result;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMutation: async (_admin: unknown, ref: any, args: any) => await h.t.mutation(ref, args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runAction: async (_admin: unknown, ref: any, args: any) => {
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
  h.limitHits = [];
});

/**
 * `count` foto's in één transactie. De eerste `withFormats` hebben al een set,
 * `exif` ervan een exifOrientation; `last` is het origineel van de laatste.
 */
async function seedMany(opts: { count: number; withFormats: number; exif: number; last?: string }): Promise<Id<"photos">[]> {
  const owner = await registerUser(h.t, "user_owen", "owen@x.com", "Owen");
  return await h.t.run(async (ctx) => {
    const ids: Id<"photos">[] = [];
    for (let i = 0; i < opts.count; i++) {
      const original = i === opts.count - 1 && opts.last !== undefined ? opts.last : `foto-${i}`;
      const storageId = await ctx.storage.store(new Blob([original], { type: "image/jpeg" }));
      const formats =
        i < opts.withFormats
          ? {
              klein: await ctx.storage.store(new Blob([`klein van ${original}`], { type: "image/jpeg" })),
              groot: await ctx.storage.store(new Blob([`groot van ${original}`], { type: "image/jpeg" })),
            }
          : undefined;
      const doc = {
        ownerId: owner,
        storageId,
        createdAt: 1_700_000_000_000 + i,
        ...(i < opts.exif ? { exifOrientation: 6 } : {}),
        ...(formats ? { formats } : {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ids.push(await ctx.db.insert("photos", doc as any));
    }
    return ids;
  });
}

const line = (text: string, prefix: string): string => {
  const found = text.split("\n").find((l) => l.startsWith(prefix));
  expect(found, `regel '${prefix}'`).toBeDefined();
  return found!;
};

describe("de nagebootste limiet", () => {
  it("een telling over alle foto's in één query valt om (zo brak het op dev)", async () => {
    await seedMany({ count: N, withFormats: 0, exif: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(runQuery({} as any, internal.photos.formatStatus, {})).rejects.toThrow(/system operations/);
  });
});

describe("WP31 B1: formaten telt over meer foto's dan in één telling passen", () => {
  it(`${N} foto's: vóór en na kloppen opgeteld, exit 0, geen telling valt om`, async () => {
    await seedMany({ count: N, withFormats: 950, exif: 7 });
    const out = captureConsole();

    const code = await formaten("prod", 50);

    expect(h.limitHits, "een telling over alle foto's in één query").toEqual([]);
    expect(code).toBe(0);
    const text = out.log();
    expect(line(text, "[formaten] vóór:")).toBe(
      `[formaten] vóór: ${N} foto's, 950 met formaten, 51 zonder (0 afgetekend), 7 met exifOrientation`,
    );
    expect(line(text, "[formaten] na:")).toBe(
      `[formaten] na: ${N} foto's, ${N} met formaten, 0 zonder (0 afgetekend), 7 met exifOrientation`,
    );
  }, 120_000);

  it("één foto zonder formaten helemaal achteraan: de telling ziet hem, exit 1", async () => {
    const ids = await seedMany({ count: N, withFormats: N - 1, exif: 0, last: "crash" });
    const out = captureConsole();

    const code = await formaten("prod", 50);

    expect(h.limitHits).toEqual([]);
    expect(code).toBe(1);
    expect(line(out.log(), "[formaten] na:")).toBe(
      `[formaten] na: ${N} foto's, ${N - 1} met formaten, 1 zonder (0 afgetekend), 0 met exifOrientation`,
    );
    expect(`${out.log()}\n${out.error()}`).toContain(ids[N - 1]!);
  }, 120_000);
});
