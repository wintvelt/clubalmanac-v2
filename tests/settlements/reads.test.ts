import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { assertReactive } from "../_helpers/reactive";
import {
  as,
  asRead,
  del,
  expectNotMember,
  newT,
  postOk,
  request,
  rows,
  seedWorld,
  settlementsApi,
  useFinanceEnv,
  type R,
  type T,
} from "./_settlements";

// WP41 §A6 — de twee reads.
//   Invariant 1: alleen een lid leest; geen lid, een onbekende groep of een
//   gewiste afrekening geeft dezelfde NOT_MEMBER (geen bestaans-orakel). Ook
//   de webmaster niet buiten zijn groepen (WP23).
//   Veld-whitelist (WP23): listByGroup en get geven precies hun velden; geen
//   key, groupId of receivedAt.
//   Draft §Edge cases: wie uit de groep gaat, verliest meteen de toegang; een
//   afrekening die opnieuw binnenkomt, ververst onder hetzelfde id.

useFinanceEnv();

// WP41c besluit 4: `hasImage` en `imageVersion` erbij (spec §WP41c C4).
const LIST_FIELDS = [
  "_id",
  "hasImage",
  "imageVersion",
  "name",
  "openCount",
  "participantCount",
  "period",
  "startDate",
];
const GET_FIELDS = [
  "_id",
  "costPerPerson",
  "hasImage",
  "imageVersion",
  "lustrum",
  "name",
  "parts",
  "period",
  "publishedOn",
  "rows",
  "settledOn",
  "startDate",
  "totals",
];

async function world(t: T) {
  const w = await seedWorld(t);
  await postOk(t, request("lustrum"));
  await postOk(t, request("weekend"));
  const byKey = Object.fromEntries((await rows(t)).map((r) => [r.key as string, r._id as string]));
  return { ...w, ids: { lustrum: byKey["17"]!, weekend: byKey["9"]! } };
}

describe("listByGroup: de tijdlijn", () => {
  it("een lid krijgt per afrekening precies de whitelist-velden", async () => {
    const t = newT();
    const w = await world(t);
    const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    expect(list).toHaveLength(2);
    for (const item of list) expect(Object.keys(item).sort()).toEqual(LIST_FIELDS);
  });

  it("de samenvatting: aantal deelnemers en aantal nog open (open > 0, beide kanten)", async () => {
    const t = newT();
    const w = await world(t);
    const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    expect(list).toEqual([
      {
        _id: w.ids.lustrum,
        name: "Lustrum Nepal",
        period: "12 t/m 26 oktober 2026",
        startDate: "2026-10-12",
        participantCount: 8,
        openCount: 3,
        hasImage: false,
        imageVersion: null,
      },
      {
        _id: w.ids.weekend,
        name: "Clubweekend Ardennen",
        period: "12 t/m 14 juni 2026",
        startDate: "2026-06-12",
        participantCount: 6,
        // Daan en Ruud krijgen nog terug, Gijs en Thijs betalen nog.
        openCount: 4,
        hasImage: false,
        imageVersion: null,
      },
    ]);
  });

  it("volgorde: nieuwste startdatum eerst, bij gelijke datum op naam (A-keuze 4)", async () => {
    const t = newT();
    const w = await world(t);
    await postOk(t, { ...request("weekend"), key: "5", name: "Najaarsdiner", startDate: "2025-09-20" });
    await postOk(t, { ...request("weekend"), key: "6", name: "Barbecue", startDate: "2026-06-12" });
    await postOk(t, { ...request("weekend"), key: "7", name: "Voorjaarsdiner", startDate: "2027-03-01" });
    const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    expect(list.map((x) => x.name)).toEqual([
      "Voorjaarsdiner",
      "Lustrum Nepal",
      "Barbecue",
      "Clubweekend Ardennen",
      "Najaarsdiner",
    ]);
  });

  it("alleen de afrekeningen van die groep", async () => {
    const t = newT();
    const w = await world(t);
    expect(await as.dave(t).query(settlementsApi.listByGroup, { groupId: w.groups.other })).toEqual([]);
  });

  it("geen lid, de webmaster, een andere groep: NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    await expectNotMember(as.carol(t).query(settlementsApi.listByGroup, { groupId: w.groups.club }));
    await expectNotMember(as.wm(t).query(settlementsApi.listByGroup, { groupId: w.groups.club }));
    await expectNotMember(as.dave(t).query(settlementsApi.listByGroup, { groupId: w.groups.club }));
  });

  it("een groep die niet meer bestaat: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("groups", { name: "Weg", createdBy: w.users.alice, createdAt: Date.now() });
      await ctx.db.delete(id);
      return id;
    });
    await expectNotMember(as.alice(t).query(settlementsApi.listByGroup, { groupId: gone }));
  });

  it("uitgelogd: geen gegevens", async () => {
    const t = newT();
    const w = await world(t);
    await expect(t.query(settlementsApi.listByGroup, { groupId: w.groups.club })).rejects.toBeDefined();
  });
});

describe("get: de hele afrekening", () => {
  it("een lid krijgt precies de whitelist-velden, met de inhoud van het verzoek", async () => {
    const t = newT();
    const w = await world(t);
    const got = await as.alice(t).query(settlementsApi.get, { settlementId: w.ids.weekend });
    expect(Object.keys(got).sort()).toEqual(GET_FIELDS);
    expect(got).toEqual({ _id: w.ids.weekend, ...asRead(request("weekend")) });
  });

  it("geen key, groupId, receivedAt of _creationTime, ook niet genest", async () => {
    const t = newT();
    const w = await world(t);
    const got = await as.bob(t).query(settlementsApi.get, { settlementId: w.ids.lustrum });
    const json = JSON.stringify(got);
    for (const field of ["key", "groupId", "receivedAt", "_creationTime", "lid_id"]) {
      expect(json).not.toContain(`"${field}"`);
    }
    expect(json).not.toContain(w.groups.club);
  });

  it("geen lid, de webmaster, een lid van een andere groep: NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    await expectNotMember(as.carol(t).query(settlementsApi.get, { settlementId: w.ids.lustrum }));
    await expectNotMember(as.wm(t).query(settlementsApi.get, { settlementId: w.ids.lustrum }));
    await expectNotMember(as.dave(t).query(settlementsApi.get, { settlementId: w.ids.lustrum }));
  });

  it("een weggehaalde afrekening: voor een lid dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    await del(t, "17");
    await expectNotMember(as.alice(t).query(settlementsApi.get, { settlementId: w.ids.lustrum }));
  });

  it("uitgelogd: geen gegevens", async () => {
    const t = newT();
    const w = await world(t);
    await expect(t.query(settlementsApi.get, { settlementId: w.ids.lustrum })).rejects.toBeDefined();
  });
});

describe("toegang kwijt en opnieuw sturen", () => {
  it("wie uit de groep gaat, krijgt bij de volgende uitvoering NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    expect(await as.alice(t).query(settlementsApi.get, { settlementId: w.ids.lustrum })).toBeTruthy();
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    await expectNotMember(as.alice(t).query(settlementsApi.get, { settlementId: w.ids.lustrum }));
    await expectNotMember(as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club }));
  });

  it("opnieuw sturen: dezelfde query met hetzelfde id geeft de nieuwe stand (geen NOT_MEMBER tussendoor)", async () => {
    const t = newT();
    const w = await world(t);
    const next = { ...request("lustrum"), publishedOn: "2026-11-28" };
    const { before, after } = await assertReactive(
      () => as.alice(t).query(settlementsApi.get, { settlementId: w.ids.lustrum }),
      () => postOk(t, next),
    );
    expect((before as R).publishedOn).toBe("2026-11-21");
    expect((after as R).publishedOn).toBe("2026-11-28");
    expect((after as R)._id).toBe(w.ids.lustrum);
  });

  it("de laatste weghalen: de tijdlijn wordt leeg (de tab verdwijnt)", async () => {
    const t = newT();
    const w = await world(t);
    await del(t, "17");
    await del(t, "9");
    expect(await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club })).toEqual([]);
  });
});
