import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { deleteAccount } from "../_helpers/deleteAccount";
import { newT, parseR2Link } from "../videos/_videos";
import {
  advance,
  albumsOf,
  announce,
  asFilm,
  expectCode,
  expectOriginalRefusal,
  failWhen,
  filmApi,
  filmInternal,
  flush,
  mailsTo,
  newVideoInX,
  openProject,
  ORIGINAL,
  ORIGINALS_BUCKET,
  outcome,
  seedFilmWorld,
  sendOriginal,
  settle,
  useFilmEnv,
  YEAR_MS,
  type FilmWorld,
} from "./_film";

// WP38a — weg is weg, ook in R2 (besluit 5, 9; invariant 6; A-invariant 10,
// 11, 12). Terugtrekken (de inzender), verwijderen (de oprichter: één of
// alles), een jaar na binnenkomst, groep verwijderen en account verwijderen
// halen de inzending weg, met het object in R2 en een open upload. Het
// filmpje in het album blijft. "Uit album" raakt de inzending niet.
// Na de besluiten ook: vertrek uit de groep (12), het filmpje in het album
// verwijderen (16), het filmalbum verwijderen (17), na sluiten nog
// binnenkomen (18) en de herinnering (15).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

const env = useFilmEnv();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function binnen(t: ReturnType<typeof newT>, w: FilmWorld, owner: "bob" | "alice") {
  const photoId = await newVideoInX(t, env.r2, w, w.users[owner]);
  const originalId = await sendOriginal(asFilm[owner](t), env.orig, photoId);
  return { photoId, originalId };
}

async function onderweg(t: ReturnType<typeof newT>, w: FilmWorld, owner: "bob" | "alice") {
  const photoId = await newVideoInX(t, env.r2, w, w.users[owner]);
  const s = await announce(asFilm[owner](t), photoId, ORIGINAL.byteLength * 2 + 64 * 1024 * 1024);
  return { photoId, originalId: s.originalId };
}

async function idsIn(t: ReturnType<typeof newT>, projectId: string): Promise<string[]> {
  return (await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.originalId).sort();
}

describe("terugtrekken (besluit 5)", () => {
  it("de inzender trekt een origineel terug dat binnen is: weg uit de lijst en uit R2; het filmpje blijft in X", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    expect(env.orig.keys()).toHaveLength(1);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: b.originalId });
    expect(await idsIn(t, projectId)).toEqual([]);
    await settle(t);
    expect(env.orig.keys()).toEqual([]);
    expect(await albumsOf(t, b.photoId)).toEqual([w.albums.georgie]);
  });

  it("terugtrekken terwijl hij onderweg is: de upload in R2 wordt afgebroken", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const o = await onderweg(t, w, "bob");
    expect(env.orig.uploads.size).toBe(1);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: o.originalId });
    await settle(t);
    expect(env.orig.uploads.size).toBe(0);
    expect(env.orig.keys()).toEqual([]);
    expect(await idsIn(t, projectId)).toEqual([]);
  });

  it("een ander (ook de oprichter) kan niet terugtrekken: ORIGINAL_NOT_FOUND, alles blijft", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    for (const who of [asFilm.alice, asFilm.erik, asFilm.carol]) {
      expectCode(await outcome(() => who(t).mutation(filmApi.withdraw, { originalId: b.originalId })), "ORIGINAL_NOT_FOUND");
    }
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([b.originalId]);
    expect(env.orig.keys()).toHaveLength(1);
  });

  it("'Uit album' op het filmpje in X raakt de inzending niet (besluit 4)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    await asFilm.bob(t).mutation(api.albums.removePhoto, { albumId: w.albums.georgie, photoId: b.photoId });
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([b.originalId]);
    expect(env.orig.keys()).toHaveLength(1);
  });
});

describe("verwijderen door de oprichter (besluit 9)", () => {
  it("één origineel: weg uit lijst en R2; een admin mag het niet", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.removeOriginal, { originalId: b.originalId })), "ORIGINAL_NOT_FOUND");
    await asFilm.alice(t).mutation(filmApi.removeOriginal, { originalId: b.originalId });
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([]);
    expect(env.orig.keys()).toEqual([]);
    expect(await albumsOf(t, b.photoId)).toEqual([w.albums.georgie]);
  });

  it("alles van een project, binnen en onderweg; daarna is het gesloten project weg uit de groep", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await binnen(t, w, "alice");
    await onderweg(t, w, "bob");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    // Gesloten met originelen: nog zichtbaar (UI: na sluiten).
    expect((await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).map((r) => [r.projectId, r.open])).toEqual([
      [projectId, false],
    ]);
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.removeAll, { projectId })), "NOT_ALLOWED");
    await asFilm.alice(t).mutation(filmApi.removeAll, { projectId });
    await settle(t);
    expect(env.orig.keys()).toEqual([]);
    expect(env.orig.uploads.size).toBe(0);
    expect(await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
  });
});

describe("een jaar (besluit 9, A-invariant 11)", () => {
  it("een origineel gaat een jaar na binnenkomst weg, rij en object; niet eerder", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    advance(YEAR_MS - HOUR);
    await t.mutation(filmInternal.expireOriginals, {});
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([b.originalId]);
    expect(env.orig.keys()).toHaveLength(1);

    advance(2 * HOUR);
    await t.mutation(filmInternal.expireOriginals, {});
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([]);
    expect(env.orig.keys()).toEqual([]);
    // Het filmpje in het album staat er nog.
    expect(await albumsOf(t, b.photoId)).toEqual([w.albums.georgie]);
  });
});

describe("cascades (A-invariant 12)", () => {
  it("groep verwijderen: projecten en originelen weg, ook in R2 (object en open upload)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    await binnen(t, w, "bob");
    await onderweg(t, w, "alice");
    await asFilm.alice(t).mutation(api.groups.remove, { groupId: w.groups.reis });
    await settle(t);
    expect(env.orig.keys()).toEqual([]);
    expect(env.orig.uploads.size).toBe(0);
    expect(await asFilm.bob(t).query(filmApi.listOpenForMe, {})).toEqual([]);
  });

  it("account verwijderen: zijn originelen weg, ook in R2; die van anderen blijven", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const mine = await binnen(t, w, "bob");
    const theirs = await binnen(t, w, "alice");
    await onderweg(t, w, "bob");
    expect(env.orig.keys()).toHaveLength(2);
    await deleteAccount(t, asFilm.bob(t));
    await settle(t);
    expect(await idsIn(t, projectId)).toEqual([theirs.originalId]);
    expect(env.orig.keys()).toHaveLength(1);
    expect(env.orig.uploads.size).toBe(0);
    expect(mine.originalId).not.toBe(theirs.originalId);
  });
});

// Besluit 12 (Wouter: ja): vertrekt een lid of wordt hij uit de groep gezet,
// dan gaan zijn originelen in de projecten van die groep weg, ook in R2
// (object en open upload), zoals zijn filmpjes uit de albums van die groep.
describe("vertrek uit de groep (besluit 12)", () => {
  it("zelf vertrekken: zijn originelen weg, ook in R2; die van anderen blijven", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await onderweg(t, w, "bob");
    const theirs = await binnen(t, w, "alice");
    await asFilm.bob(t).mutation(api.groups.removeMember, { groupId: w.groups.reis, userId: w.users.bob });
    expect(await idsIn(t, projectId)).toEqual([theirs.originalId]);
    await flush(t);
    expect(env.orig.keys()).toHaveLength(1);
    expect(env.orig.uploads.size).toBe(0);
  });

  it("uit de groep gezet door een admin: hetzelfde", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await asFilm.erik(t).mutation(api.groups.removeMember, { groupId: w.groups.reis, userId: w.users.bob });
    expect(await idsIn(t, projectId)).toEqual([]);
    await flush(t);
    expect(env.orig.keys()).toEqual([]);
  });
});

// Besluit 16 (Wouter: ja): het filmpje in het album verwijderen (de eigenaar,
// of de webmaster na een melding) haalt ook het origineel weg. "Uit album"
// niet (hierboven, besluit 4).
describe("het filmpje verwijderen (besluit 16)", () => {
  it("de eigenaar verwijdert het filmpje: de inzending en het object gaan mee", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    const other = await binnen(t, w, "alice");
    await asFilm.bob(t).mutation(api.photos.remove, { photoId: b.photoId });
    expect(await idsIn(t, projectId)).toEqual([other.originalId]);
    await flush(t);
    expect(env.orig.keys()).toHaveLength(1);
  });

  it("een filmpje met een origineel dat nog onderweg is: de upload wordt afgebroken", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const o = await onderweg(t, w, "bob");
    await asFilm.bob(t).mutation(api.photos.remove, { photoId: o.photoId });
    expect(await idsIn(t, projectId)).toEqual([]);
    await flush(t);
    expect(env.orig.uploads.size).toBe(0);
  });
});

// Besluit 17 (Wouter: ja): het filmalbum verwijderen terwijl het project open
// staat, weigert de backend ("Sluit eerst het filmproject"). Na sluiten mag
// het; het project houdt de naam van het album, met zijn originelen, en wijst
// niet meer naar een album dat er niet is (`albumId: null`; WP10, zie
// tests/filmProject/integrity.test.ts).
describe("het filmalbum verwijderen (besluit 17)", () => {
  it("terwijl het project open staat: FILM_PROJECT_OPEN, het album en zijn filmpjes blijven", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    await openProject(t, w);
    const b = await binnen(t, w, "bob");
    expectCode(await outcome(() => asFilm.alice(t).mutation(api.albums.remove, { albumId: w.albums.georgie })), "FILM_PROJECT_OPEN");
    expect(await albumsOf(t, b.photoId)).toEqual([w.albums.georgie]);
    // Een ander album van de groep mag gewoon weg.
    await asFilm.alice(t).mutation(api.albums.remove, { albumId: w.albums.tbilisi });
  });

  it("na sluiten mag het; het project staat er nog met de naam en de originelen, zonder album", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const b = await binnen(t, w, "bob");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    await asFilm.alice(t).mutation(api.albums.remove, { albumId: w.albums.georgie });
    const view = await asFilm.alice(t).query(filmApi.get, { projectId });
    expect(view.project).toMatchObject({ projectId, albumId: null, albumName: "Georgië", open: false });
    expect(view.originals.map((o) => o.originalId)).toEqual([b.originalId]);
    expect(await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([
      { projectId, albumId: null, albumName: "Georgië", endsAt: view.project.endsAt, open: false },
    ]);
    // Het origineel is er nog en de oprichter kan het downloaden.
    await flush(t);
    expect(env.orig.keys()).toHaveLength(1);
    const d = await asFilm.alice(t).action(filmApi.downloadUrl, { originalId: b.originalId });
    expect(typeof d.url).toBe("string");
  });
});

// Besluit 18 (Wouter: 14 dagen): nieuwe inzendingen kunnen alleen zolang het
// project open staat. Wat al aangemeld was, mag tot 14 dagen na het sluiten
// nog binnenkomen (hervatten en afronden, ook door de backend zelf). Daarna
// ruimt de dagelijkse ronde de inzending op, met de halve upload in R2.
describe("na sluiten nog binnenkomen (besluit 18)", () => {
  it("een filmpje van tijdens het project, maar pas na sluiten aangemeld: niet_toegestaan", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: ORIGINAL.byteLength })), "niet_toegestaan");
    expect(env.orig.creates()).toHaveLength(0);
  });

  it("aangemeld vóór sluiten: binnen 14 dagen hervatten en afronden lukt", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const first = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    advance(13 * DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    const again = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(again.originalId).toBe(first.originalId);
    expect(await env.orig.putPart(again.parts[0]!.url, ORIGINAL)).toBe(200);
    expect(await asFilm.bob(t).action(filmApi.finishOriginal, { originalId: again.originalId })).toEqual({ kind: "done" });
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.status)).toEqual(["binnen"]);
  });

  it("de backend rondt binnen de 14 dagen ook zelf af", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    advance(DAY);
    await t.action(filmInternal.completeUploaded, {});
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.status)).toEqual(["binnen"]);
  });

  it("na 14 dagen: de inzending weg, de halve upload afgebroken; hervatten weigert, het filmpje blijft", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const o = await onderweg(t, w, "bob");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    advance(14 * DAY + HOUR);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(await idsIn(t, projectId)).toEqual([]);
    expect(env.orig.uploads.size).toBe(0);
    expectOriginalRefusal(
      await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId: o.photoId, bytes: ORIGINAL.byteLength * 2 + 64 * 1024 * 1024 })),
      "niet_toegestaan",
    );
    expect(env.orig.creates()).toHaveLength(1);
    expect(await albumsOf(t, o.photoId)).toEqual([w.albums.georgie]);
  });
});

// B-keuze, door A bevestigd: een gesloten project zonder originelen is meteen
// uit de groep (hierboven, en projects.test.ts). De rij zelf mag nog even
// blijven (geen originelen, geen GPS), maar uiterlijk een jaar en 14 dagen na
// sluiten is hij weg. Hier alleen die bovengrens.
describe("een gesloten project zonder originelen", () => {
  it("is uiterlijk een jaar en 14 dagen na sluiten helemaal weg", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    expect(await asFilm.bob(t).query(filmApi.listForGroup, { groupId: w.groups.reis })).toEqual([]);
    advance(YEAR_MS + 15 * DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    expect(await t.run(async (ctx) => (await ctx.db.query("filmProjects").collect()).length)).toBe(0);
  });
});

// Besluit 15 (Wouter: ja): één mail aan de oprichter (van nu), 30 dagen
// voordat de eerste originelen van een project weggaan, met het project, het
// aantal en de datum. B-keuze, door A bevestigd: één mail per project, met het
// aantal en de eerste en laatste datum. Geen mail aan de leden, geen tweede
// mail voor hetzelfde project, geen link.
describe("herinnering aan de oprichter (besluit 15)", () => {
  it("30 dagen voordat het eerste origineel weggaat: één mail aan de oprichter; niet eerder, niet nog eens", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await binnen(t, w, "alice");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });

    advance(YEAR_MS - 31 * DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(env.r2.mails).toEqual([]);

    advance(2 * DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(env.r2.mails).toHaveLength(1);
    expect(mailsTo(env.r2, "alice@x.com")).toHaveLength(1);
    const mail = env.r2.mails[0]!;
    const text = String(mail.TextPart ?? "");
    expect(text).toContain("Georgië"); // het project
    expect(text).toMatch(/\b2\b/); // het aantal
    expect(text).toContain("2027"); // de datum waarop ze weggaan
    // Geen link, geen sleutel, geen namen van inzenders.
    const all = JSON.stringify(mail);
    expect(all).not.toContain("https://");
    expect(all).not.toContain(ORIGINALS_BUCKET);
    expect(all).not.toContain("Bob");

    advance(DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(env.r2.mails).toHaveLength(1);
  });

  it("na overdragen krijgt de nieuwe oprichter de mail; een project zonder originelen geeft geen mail", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    await asFilm.dave(t).mutation(filmApi.open, { groupId: w.groups.ander, albumId: w.albums.elders, endsAt: Date.now() + DAY });
    await asFilm.alice(t).mutation(api.groups.transferFounder, { groupId: w.groups.reis, userId: w.users.erik });
    advance(YEAR_MS - 29 * DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(mailsTo(env.r2, "erik@x.com")).toHaveLength(1);
    expect(mailsTo(env.r2, "alice@x.com")).toEqual([]);
    expect(mailsTo(env.r2, "dave@x.com")).toEqual([]);
    expect(env.r2.mails).toHaveLength(1);
  });
});

// Fix-cyclus 1 (audit S2): besluit 18 geldt ook als de opruimronde nog niet
// liep. Op dag 14 na sluiten plus een uur weigeren hervatten en afronden, en
// de backend rondt ook zelf niet meer af.
describe("na 14 dagen, zonder de opruimronde (besluit 18)", () => {
  it("startOriginal en finishOriginal: niet_toegestaan; niets aangemaakt, niets afgerond", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    expect(await env.orig.putPart(s.parts[0]!.url, ORIGINAL)).toBe(200);
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    advance(14 * DAY + HOUR);
    expectOriginalRefusal(
      await outcome(() => asFilm.bob(t).action(filmApi.startOriginal, { photoId, bytes: ORIGINAL.byteLength })),
      "niet_toegestaan",
    );
    expectOriginalRefusal(await outcome(() => asFilm.bob(t).action(filmApi.finishOriginal, { originalId: s.originalId })), "niet_toegestaan");
    await t.action(filmInternal.completeUploaded, {});
    expect(env.orig.creates()).toHaveLength(1);
    expect(env.orig.keys()).toEqual([]);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.status)).not.toContain("binnen");
  });
});

// Fix-cyclus 1 (audit N4): bij het wissen in R2 worden afbreken en wissen
// los van elkaar geprobeerd. Mislukt het een, dan gebeurt het ander toch.
// De toestand "upload én object" ontstaat bij een afronding die R2 al deed
// terwijl de inzending nog onderweg stond (zie races.test.ts).
describe("wissen in R2: afbreken en wissen los van elkaar (audit N4)", () => {
  async function uploadAndObject(t: ReturnType<typeof newT>, w: FilmWorld) {
    const projectId = await openProject(t, w);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob);
    const s = await announce(asFilm.bob(t), photoId, ORIGINAL.byteLength);
    const link = parseR2Link(s.parts[0]!.url);
    env.orig.put(link.key, ORIGINAL);
    expect(env.orig.uploads.size).toBe(1);
    return { projectId, originalId: s.originalId };
  }

  it("afbreken mislukt (storing): het object gaat toch weg", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await uploadAndObject(t, w);
    failWhen(env.orig, (c) => c.method === "DELETE" && c.query.uploadId !== undefined);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: o.originalId });
    await flush(t);
    expect(env.orig.keys()).toEqual([]);
  });

  it("wissen mislukt (storing): de upload wordt toch afgebroken", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const o = await uploadAndObject(t, w);
    failWhen(env.orig, (c) => c.method === "DELETE" && c.query.uploadId === undefined);
    await asFilm.bob(t).mutation(filmApi.withdraw, { originalId: o.originalId });
    await flush(t);
    expect(env.orig.uploads.size).toBe(0);
  });
});

// Fix-cyclus 1 (red-team N7): de herinnering geldt pas als verstuurd als de
// mail weg is. Mislukt hij, dan probeert de volgende dagelijkse ronde het
// opnieuw. Nog steeds hooguit één mail per project.
describe("herinnering opnieuw proberen (red-team N7)", () => {
  it("de mail mislukt: de volgende dag gaat hij alsnog, daarna niet meer", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });

    advance(YEAR_MS - 29 * DAY);
    env.orig.mailDown = true;
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(env.r2.mails).toEqual([]);

    env.orig.mailDown = false;
    advance(DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(mailsTo(env.r2, "alice@x.com")).toHaveLength(1);

    advance(DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(env.r2.mails).toHaveLength(1);
  });

  it("twee rondes vlak na elkaar, vóór de mail weg is: één mail", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const projectId = await openProject(t, w);
    await binnen(t, w, "bob");
    await asFilm.alice(t).mutation(filmApi.close, { projectId });
    advance(YEAR_MS - 29 * DAY);
    await t.mutation(filmInternal.expireOriginals, {});
    await t.mutation(filmInternal.expireOriginals, {});
    await flush(t);
    expect(env.r2.mails).toHaveLength(1);
  });
});
