import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { albumRow, as, expectRefused, groupRow, newT, seedAlbum, seedGroup, type T } from "./_beheer";

// WP28 fix-cyclus 1, A-invariant 12 (red-team R5): een groeps- of albumnaam
// wordt getrimd bewaard en geweigerd als hij leeg is (NAME_REQUIRED), langer
// dan 50 tekens (NAME_TOO_LONG) of tekens bevat die WP15b in een user-naam
// verbiedt (NAME_INVALID). Alleen een meegegeven naam wordt gecheckt.
// `sortDate` is een eindig getal binnen het bereik van een JS-Date, anders
// DATE_INVALID (fix-cyclus 2, A-invariant 15).
//
// Tekens via codepunt, zodat ze zichtbaar in de test staan.

const ch = (cp: number) => String.fromCodePoint(cp);
const ZWSP = ch(0x200b); // onzichtbare spatie
const RLO = ch(0x202e); // leesrichting omdraaien
const LINE_SEP = ch(0x2028);
const BELL = ch(0x07);

async function world(t: T) {
  const w = await seedGroup(t, { founder: "olga" });
  const A = await seedAlbum(t, w.groupId, w.users.olga!, "A");
  return { ...w, A };
}

type NameCall = (t: T, w: Awaited<ReturnType<typeof world>>, name: string) => Promise<unknown>;

const NAME_PATHS: Array<[string, NameCall]> = [
  ["groups.create", (t, _w, name) => as(t, "user_olga").mutation(api.groups.create, { name })],
  ["groups.update", (t, w, name) => as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, name })],
  ["albums.create", (t, w, name) => as(t, "user_olga").mutation(api.albums.create, { groupId: w.groupId, name })],
  ["albums.update", (t, w, name) => as(t, "user_olga").mutation(api.albums.update, { albumId: w.A, name })],
];

describe.each(NAME_PATHS)("A-invariant 12 — naam via %s", (_path, call) => {
  it.each([
    ["alleen een onzichtbare spatie", ZWSP],
    ["een richting-teken", `${RLO}gnp.exe`],
    ["een regelscheiding", `Club${LINE_SEP}Nieuw`],
    ["een controleteken", `Club${BELL}`],
  ])("%s: NAME_INVALID", async (_label, name) => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NAME_INVALID", () => call(t, w, name));
  });

  it("51 tekens: NAME_TOO_LONG", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NAME_TOO_LONG", () => call(t, w, "x".repeat(51)));
  });

  it("500.000 tekens: NAME_TOO_LONG", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NAME_TOO_LONG", () => call(t, w, "x".repeat(500_000)));
  });

  it("50 tekens mag; ook een emoji telt als één teken", async () => {
    const t = newT();
    const w = await world(t);
    await call(t, w, "x".repeat(50));
    await call(t, w, `${"y".repeat(49)}${ch(0x1f3d1)}`);
  });
});

describe("A-invariant 12 — de naam wordt getrimd bewaard", () => {
  it("groep maken en hernoemen", async () => {
    const t = newT();
    const w = await world(t);
    const id = await as(t, "user_olga").mutation(api.groups.create, { name: "  Hockey  " });
    expect((await groupRow(t, id))?.name).toBe("Hockey");
    await as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, name: " Club 2 " });
    expect((await groupRow(t, w.groupId))?.name).toBe("Club 2");
  });

  it("album maken en hernoemen", async () => {
    const t = newT();
    const w = await world(t);
    const id = await as(t, "user_olga").mutation(api.albums.create, { groupId: w.groupId, name: " Zomer " });
    expect((await albumRow(t, id))?.name).toBe("Zomer");
    await as(t, "user_olga").mutation(api.albums.update, { albumId: w.A, name: " Winter " });
    expect((await albumRow(t, w.A))?.name).toBe("Winter");
  });
});

describe("A-invariant 12 — een gemigreerde naam blijft staan", () => {
  it("alleen de datum wijzigen slaagt, ook als de bestaande naam een verboden teken heeft", async () => {
    const t = newT();
    const w = await world(t);
    const legacy = `Oud${ZWSP}`;
    await t.run(async (ctx) => {
      await ctx.db.patch(w.groupId, { name: legacy });
      await ctx.db.patch(w.A, { name: legacy });
    });
    await as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, sortDate: Date.UTC(2020, 0, 1) });
    await as(t, "user_olga").mutation(api.albums.update, { albumId: w.A, sortDate: Date.UTC(2020, 0, 1) });
    expect((await groupRow(t, w.groupId))?.name).toBe(legacy);
    expect((await albumRow(t, w.A))?.name).toBe(legacy);
  });
});

describe("A-invariant 12 — sortDate is een eindig getal", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("%s: DATE_INVALID bij groep en album", async (_label, sortDate) => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "DATE_INVALID", () =>
      as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, sortDate }),
    );
    await expectRefused(t, "DATE_INVALID", () =>
      as(t, "user_olga").mutation(api.albums.update, { albumId: w.A, sortDate }),
    );
  });

  // Fix-cyclus 2, F3: het bereik van een JS-Date, ±8.64e15 ms (A-invariant 15).
  it.each([
    ["1e300", 1e300],
    ["net boven het Date-bereik", 8.64e15 + 1],
    ["net onder het Date-bereik", -8.64e15 - 1],
    ["Number.MAX_VALUE", Number.MAX_VALUE],
  ])("%s: DATE_INVALID bij groep en album", async (_label, sortDate) => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "DATE_INVALID", () =>
      as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, sortDate }),
    );
    await expectRefused(t, "DATE_INVALID", () =>
      as(t, "user_olga").mutation(api.albums.update, { albumId: w.A, sortDate }),
    );
  });

  it("de randen van het Date-bereik mogen", async () => {
    const t = newT();
    const w = await world(t);
    for (const day of [8.64e15, -8.64e15]) {
      await as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, sortDate: day });
      expect((await groupRow(t, w.groupId))?.sortDate).toBe(day);
      await as(t, "user_olga").mutation(api.albums.update, { albumId: w.A, sortDate: day });
      expect((await albumRow(t, w.A))?.sortDate).toBe(day);
    }
  });

  it("een gewone dag mag, ook een negatieve epoch (vóór 1970)", async () => {
    const t = newT();
    const w = await world(t);
    const day = Date.UTC(1965, 4, 1);
    await as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, sortDate: day });
    expect((await groupRow(t, w.groupId))?.sortDate).toBe(day);
  });
});
