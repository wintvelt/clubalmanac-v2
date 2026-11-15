import { describe, expect, it } from "vitest";
import {
  as,
  expectRefusal,
  filmsApi,
  filmsInternal,
  KEYS,
  newT,
  outcome,
  seedFilmsWorld,
  useFilmsEnv,
  type R,
  type T,
} from "./_films";

// WP21 — wie de films ziet en een link krijgt.
//   Invariant 1 (toegang in de backend), besluit 1 (leden van de groep van de
//   film, trailers en films; geen webmaster-uitzondering), invariant 8 en
//   A-invariant 17 (per verzoek), A-invariant 11 (één weigering, lijst leeg).
// Spec: docs/work-packages/WP21-videos.md §Testcontract.

useFilmsEnv();

const LIST_SHAPE = ["_id", "groupId", "hasCover", "kind", "title", "year"];

function keysOf(x: unknown): string[] {
  return Object.entries(x as R)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
}

const videoUrl = (client: ReturnType<typeof as.alice>, filmId: string) =>
  client.action(filmsApi.videoUrl, { filmId });
const coverUrl = (client: ReturnType<typeof as.alice>, filmId: string) =>
  client.action(filmsApi.coverUrl, { filmId });

describe("films.list (invariant 1, besluit 1)", () => {
  it("een lid ziet de films van zijn groep, trailers en films, in de volgorde van de lijst", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const list = (await as.alice(t).query(filmsApi.list, {})) as R[];
    expect(list.map((f) => f.title)).toEqual(["Proef trailer A", "Proef film B", "Proef film C"]);
    expect(list.map((f) => f.kind)).toEqual(["trailer", "film", "film"]);
    expect(list.map((f) => f.year)).toEqual([2022, 2020, 1999]);
    expect(list.every((f) => f.groupId === w.groups.blob)).toBe(true);
  });

  it("vorm: precies _id, groupId, kind, title, year, hasCover", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    const list = (await as.alice(t).query(filmsApi.list, {})) as R[];
    for (const f of list) expect(keysOf(f)).toEqual(LIST_SHAPE);
  });

  it("invariant 7: hasCover is false voor de film zonder cover, true voor de rest", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    const list = (await as.alice(t).query(filmsApi.list, {})) as R[];
    expect(list.map((f) => f.hasCover)).toEqual([true, true, false]);
  });

  it("A-invariant 9 en 10: de lijst bevat geen sleutel van een bestand", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    const json = JSON.stringify(await as.alice(t).query(filmsApi.list, {}));
    for (const key of Object.values(KEYS)) expect(json).not.toContain(key);
    expect(json).not.toMatch(/\.(mp4|m4v|mov|png)/i);
  });

  it("alleen de films van je eigen groepen: dave ziet alleen de film van zijn groep", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    const list = (await as.dave(t).query(filmsApi.list, {})) as R[];
    expect(list.map((f) => f.title)).toEqual(["Andere film D"]);
  });

  it("A-invariant 11: geen lid → leeg", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    expect(await as.carol(t).query(filmsApi.list, {})).toEqual([]);
  });

  it("besluit 1: de webmaster zonder lidmaatschap ziet niets", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    process.env.WEBMASTER_EMAILS = "wm@x.com";
    try {
      expect(await as.wm(t).query(filmsApi.list, {})).toEqual([]);
    } finally {
      delete process.env.WEBMASTER_EMAILS;
    }
  });

  it("A-invariant 11: niet ingelogd → leeg", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    expect(await t.query(filmsApi.list, {})).toEqual([]);
  });

  it("A-invariant 11: account in verwijdering → leeg", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.alice, { deletion: { startedAt: Date.now() } }));
    expect(await as.alice(t).query(filmsApi.list, {})).toEqual([]);
  });

  it("invariant 8: na het verlaten van de groep is de lijst meteen leeg", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    expect(((await as.alice(t).query(filmsApi.list, {})) as R[]).length).toBe(3);
    await removeMembership(t, w.users.alice, w.groups.blob);
    expect(await as.alice(t).query(filmsApi.list, {})).toEqual([]);
  });
});

describe("films.replaceAll (testcontract: de lijst is daarna precies deze items)", () => {
  it("een tweede replaceAll vervangt de lijst, oude films zijn weg", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    await t.mutation(filmsInternal.replaceAll, { items: [w.items[1]!] });
    const list = (await as.alice(t).query(filmsApi.list, {})) as R[];
    expect(list.map((f) => f.title)).toEqual(["Proef film B"]);
  });
});

describe("links: wie mag (invariant 1, besluit 1)", () => {
  it("een lid krijgt een film-link en een cover-link", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const v = (await videoUrl(as.alice(t), w.films.filmB)) as R;
    const c = (await coverUrl(as.alice(t), w.films.filmB)) as R;
    expect(typeof v.url).toBe("string");
    expect(typeof c.url).toBe("string");
  });

  it("de trailer werkt voor een lid net zo", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    expect(typeof ((await videoUrl(as.bob(t), w.films.trailerA)) as R).url).toBe("string");
  });
});

describe("links: één weigering (A-invariant 11, WP24)", () => {
  it("geen lid van de groep van de film", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    expectRefusal(await outcome(() => videoUrl(as.carol(t), w.films.filmB)));
    expectRefusal(await outcome(() => coverUrl(as.carol(t), w.films.filmB)));
  });

  it("lid van een andere groep met films", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    expectRefusal(await outcome(() => videoUrl(as.dave(t), w.films.filmB)));
    expectRefusal(await outcome(() => videoUrl(as.alice(t), w.films.filmD)));
  });

  it("de webmaster zonder lidmaatschap", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    process.env.WEBMASTER_EMAILS = "wm@x.com";
    try {
      expectRefusal(await outcome(() => videoUrl(as.wm(t), w.films.filmB)));
    } finally {
      delete process.env.WEBMASTER_EMAILS;
    }
  });

  it("niet ingelogd", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    expectRefusal(await outcome(() => t.action(filmsApi.videoUrl, { filmId: w.films.filmB })));
    expectRefusal(await outcome(() => t.action(filmsApi.coverUrl, { filmId: w.films.filmB })));
  });

  it("onbekende film (weg na replaceAll)", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    await t.mutation(filmsInternal.replaceAll, { items: [w.items[0]!] });
    expectRefusal(await outcome(() => videoUrl(as.alice(t), w.films.filmB)));
    expectRefusal(await outcome(() => coverUrl(as.alice(t), w.films.filmB)));
  });

  it("cover-link voor een film zonder cover", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    expectRefusal(await outcome(() => coverUrl(as.alice(t), w.films.filmC)));
  });

  it("onbekend, geen toegang en geen cover zijn niet te onderscheiden", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const noAccess = await outcome(() => videoUrl(as.carol(t), w.films.filmB));
    const noCover = await outcome(() => coverUrl(as.alice(t), w.films.filmC));
    await t.mutation(filmsInternal.replaceAll, { items: [w.items[0]!] });
    const unknown = await outcome(() => videoUrl(as.alice(t), w.films.filmB));
    expect(unknown).toEqual(noAccess);
    expect(noCover).toEqual(noAccess);
  });
});

describe("links: per verzoek (invariant 8, A-invariant 17)", () => {
  it("ex-lid: eerst een link, na het verlaten meteen de weigering", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    expect(typeof ((await videoUrl(as.alice(t), w.films.filmB)) as R).url).toBe("string");
    await removeMembership(t, w.users.alice, w.groups.blob);
    expectRefusal(await outcome(() => videoUrl(as.alice(t), w.films.filmB)));
    expectRefusal(await outcome(() => coverUrl(as.alice(t), w.films.filmB)));
  });

  it("account in verwijdering: de weigering", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.alice, { deletion: { startedAt: Date.now() } }));
    expectRefusal(await outcome(() => videoUrl(as.alice(t), w.films.filmB)));
  });

  it("verwijderd account (geen users-rij meer): de weigering", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    await removeMembership(t, w.users.alice, w.groups.blob);
    await t.run(async (ctx) => ctx.db.delete(w.users.alice));
    expectRefusal(await outcome(() => videoUrl(as.alice(t), w.films.filmB)));
  });

  it("verwijderd account met een achtergebleven lidmaatschap: ook de weigering", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    await t.run(async (ctx) => ctx.db.delete(w.users.alice));
    expectRefusal(await outcome(() => videoUrl(as.alice(t), w.films.filmB)));
  });
});

async function removeMembership(t: T, userId: string, groupId: string): Promise<void> {
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("memberships").collect();
    for (const m of rows) if (m.userId === userId && m.groupId === groupId) await ctx.db.delete(m._id);
  });
}
