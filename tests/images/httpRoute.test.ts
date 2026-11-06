import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import http from "../../convex/http";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP17a besluit 1 (vorm B), besluit 2 (formaat-contract) en besluit 8
// (profielfoto openbaar). De toegangsregel zelf staat in
// tests/images/access.test.ts; hier het http-pad eromheen.
//
//   GET /beeld/foto/<photoId>[?formaat=klein|groot]
//     Bytes van de foto als de caller foto-toegang heeft. Uitgelogd: 401.
//     Geen toegang, onbekend, misvormd id, gewist: precies hetzelfde
//     404-antwoord (invariant 13), nooit een 500 en nooit bytes.
//     `Cache-Control` bevat `private`: een proxy of CDN mag een beeld achter
//     een login niet bewaren.
//   GET /beeld/profiel/<userId>[?formaat=klein|groot]
//     Openbaar, ook uitgelogd (besluit 8): de bytes van de actuele
//     profielfoto. Geen profielfoto, onbekend of misvormd id: één 404.
//     Als profielfoto alleen een eigen beeld (besluit 10, invariant 16).
//
// Formaat (besluit 2): `klein` en `groot` zijn geldig; zonder `formaat` het
// origineel. Zolang een formaat er niet is (WP25 maakt ze), geeft het pad het
// origineel. Een onbekende waarde: 400, voor iedereen gelijk, dus zonder
// orakel. Het formaat verandert niets aan de toegang.
//
// convex-test valideert geen JWT: `withIdentity(...).fetch` zet de identity
// direct (zie tests/http/upload.test.ts). De echte JWT-check doet Convex vóór
// de handler.

type T = ReturnType<typeof convexTest>;

const PHOTO_BYTES = "foto-bytes-P";
const PROFILE_BYTES = "profiel-bytes-owen";

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  await registerUser(t, "user_xena", "xena@x.com", "Xena");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await withUser(t, "user_owen").mutation(api.groups.addMember, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  const { photoId, profile } = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([PHOTO_BYTES], { type: "image/jpeg" }));
    const photoId = await ctx.db.insert("photos", {
      ownerId: owen,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
    });
    const profile = await ctx.storage.store(new Blob([PROFILE_BYTES], { type: "image/jpeg" }));
    await ctx.db.patch(owen, { profilePhotoStorageId: profile });
    return { photoId, profile };
  });
  await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: A, photoId });
  return { owen, mia, G, A, photoId, profile };
}

const photoPath = (id: string) => `/beeld/foto/${id}`;
const profilePath = (id: string) => `/beeld/profiel/${id}`;

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text() };
}

describe("routes (inventaris http-paden)", () => {
  it("de bestaande routes blijven, plus alleen de twee beeldpaden", () => {
    const routes = http.getRoutes().map(([path, method]) => `${method} ${path}`);
    const others = routes.filter((r) => !r.includes("/beeld/")).sort();
    expect(others).toEqual(
      [
        "GET /_test/whoami",
        "POST /clerk-webhook",
        "POST /email-event",
        "POST /upload",
      ].sort(),
    );
    expect(http.lookup(photoPath("abc"), "GET")).not.toBeNull();
    expect(http.lookup(profilePath("abc"), "GET")).not.toBeNull();
    // Alleen lezen: geen andere methode op de beeldpaden.
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(http.lookup(photoPath("abc"), method)).toBeNull();
      expect(http.lookup(profilePath("abc"), method)).toBeNull();
    }
  });
});

describe("GET /beeld/foto/<photoId>", () => {
  it("lid: 200 met precies de bytes, en Cache-Control bevat private", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_mia").fetch(photoPath(s.photoId), { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bprivate\b/);
    expect(res.headers.get("Cache-Control") ?? "").not.toMatch(/\bpublic\b/);
    expect(await res.text()).toBe(PHOTO_BYTES);
  });

  it("eigenaar: 200", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_owen").fetch(photoPath(s.photoId), { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("uitgelogd: 401, geen bytes", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await t.fetch(photoPath(s.photoId), { method: "GET" });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(PHOTO_BYTES);
  });

  it("invariant 13: geen toegang, onbekend, misvormd en gewist geven exact hetzelfde 404-antwoord", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const xena = withUser(t, "user_xena");
    const noAccess = await snapshot(await xena.fetch(photoPath(s.photoId), { method: "GET" }));
    const garbage = await snapshot(await xena.fetch(photoPath("geen-id"), { method: "GET" }));
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("photos", {
        ownerId: s.owen,
        storageId: await ctx.storage.store(new Blob(["weg"])),
        ratingCount: 0,
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    const unknown = await snapshot(await xena.fetch(photoPath(gone), { method: "GET" }));
    expect(noAccess.status).toBe(404);
    expect(noAccess.body).not.toContain(PHOTO_BYTES);
    expect(garbage).toEqual(noAccess);
    expect(unknown).toEqual(noAccess);
  });

  it("invariant 2: ex-lid krijgt 404 met dezelfde URL die eerder werkte", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const mia = withUser(t, "user_mia");
    expect((await mia.fetch(photoPath(s.photoId), { method: "GET" })).status).toBe(200);
    await mia.mutation(api.groups.removeMember, { groupId: s.G, userId: s.mia });
    const res = await mia.fetch(photoPath(s.photoId), { method: "GET" });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(PHOTO_BYTES);
  });

  it("de foto is gewist, het beeld in storage nog niet (cleanup is async): 404", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.run((ctx) => ctx.db.delete(s.photoId as Id<"photos">));
    const res = await withUser(t, "user_owen").fetch(photoPath(s.photoId), { method: "GET" });
    expect(res.status).toBe(404);
  });
});

describe("GET /beeld/foto/<photoId> — formaat (besluit 2)", () => {
  it.each(["klein", "groot"])("?formaat=%s: zolang het formaat er niet is, het origineel", async (formaat) => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_mia").fetch(`${photoPath(s.photoId)}?formaat=${formaat}`, {
      method: "GET",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bprivate\b/);
    expect(await res.text()).toBe(PHOTO_BYTES);
  });

  it("een formaat opent niets: geen toegang blijft 404, uitgelogd blijft 401", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const plain = await snapshot(
      await withUser(t, "user_xena").fetch(photoPath(s.photoId), { method: "GET" }),
    );
    const small = await snapshot(
      await withUser(t, "user_xena").fetch(`${photoPath(s.photoId)}?formaat=klein`, { method: "GET" }),
    );
    expect(small).toEqual(plain);
    expect(small.status).toBe(404);
    const anon = await t.fetch(`${photoPath(s.photoId)}?formaat=klein`, { method: "GET" });
    expect(anon.status).toBe(401);
  });

  it("onbekend formaat: 400, gelijk voor wie wel en wie geen toegang heeft", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const member = await snapshot(
      await withUser(t, "user_mia").fetch(`${photoPath(s.photoId)}?formaat=reuze`, { method: "GET" }),
    );
    const outsider = await snapshot(
      await withUser(t, "user_xena").fetch(`${photoPath(s.photoId)}?formaat=reuze`, { method: "GET" }),
    );
    expect(member.status).toBe(400);
    expect(member.body).not.toContain(PHOTO_BYTES);
    expect(outsider).toEqual(member);
  });
});

describe("GET /beeld/profiel/<userId> — openbaar (besluit 8)", () => {
  it.each([
    ["uitgelogd", null],
    ["iemand zonder gedeelde groep", "user_xena"],
    ["een medelid", "user_mia"],
    ["zichzelf", "user_owen"],
  ] as const)("%s: 200 met de bytes van de profielfoto", async (_label, subject) => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const client = subject === null ? t : withUser(t, subject);
    const res = await client.fetch(profilePath(s.owen), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PROFILE_BYTES);
  });

  // Fix-cyclus 1, S6: dezelfde URL geeft na een wissel een ander beeld, dus
  // geen cache mag het antwoord hergebruiken zonder het opnieuw te vragen.
  it("Cache-Control: no-cache of no-store, nooit immutable of een max-age zonder hervalidatie", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    for (const url of [profilePath(s.owen), `${profilePath(s.owen)}?formaat=klein`]) {
      const res = await t.fetch(url, { method: "GET" });
      expect(res.status).toBe(200);
      const cc = res.headers.get("Cache-Control") ?? "";
      expect(cc, url).toMatch(/\b(no-cache|no-store)\b/);
      expect(cc, url).not.toMatch(/\bimmutable\b/);
      expect(cc, url).not.toMatch(/\bmax-age=[1-9]/);
    }
  });

  it("alleen de actuele profielfoto: na een wissel geeft dezelfde URL het nieuwe beeld", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    expect(await (await t.fetch(profilePath(s.owen), { method: "GET" })).text()).toBe(PROFILE_BYTES);
    // Owen kiest het beeld van zijn foto P als profielfoto (WP24 invariant 8).
    const photoStorage = await t.run(async (ctx) => (await ctx.db.get(s.photoId))!.storageId);
    await withUser(t, "user_owen").mutation(api.users.updateProfile, {
      profilePhotoStorageId: photoStorage,
    });
    const res = await t.fetch(profilePath(s.owen), { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(PHOTO_BYTES);
    expect(body).not.toContain(PROFILE_BYTES);
  });

  it("invariant 16 (besluit 10): de foto van een ander wordt via het profielpad niet openbaar", async () => {
    // Red-team R1: Mia (lid, ziet P) probeert het beeld van Owens foto P als
    // profielfoto te zetten. Geweigerd; haar profielpad blijft het 404 van
    // "geen profielfoto", voor iedereen, en geeft nooit de bytes van P.
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const before = await snapshot(await t.fetch(profilePath(s.mia), { method: "GET" }));
    expect(before.status).toBe(404);
    const photoStorage = await t.run(async (ctx) => (await ctx.db.get(s.photoId))!.storageId);
    await expect(
      withUser(t, "user_mia").mutation(api.users.updateProfile, {
        profilePhotoStorageId: photoStorage,
      }),
    ).rejects.toThrow();
    for (const url of [profilePath(s.mia), `${profilePath(s.mia)}?formaat=groot`]) {
      const anon = await snapshot(await t.fetch(url, { method: "GET" }));
      expect(anon, url).toEqual(before);
      expect(anon.body, url).not.toContain(PHOTO_BYTES);
    }
  });

  it("invariant 14: geen profielfoto, onbekend en misvormd id geven hetzelfde 404-antwoord", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const gone = await registerUser(t, "user_weg", "weg@x.com", "Weg");
    await t.run((ctx) => ctx.db.delete(gone));
    const none = await snapshot(await t.fetch(profilePath(s.mia), { method: "GET" }));
    const unknown = await snapshot(await t.fetch(profilePath(gone), { method: "GET" }));
    const garbage = await snapshot(await t.fetch(profilePath("geen-id"), { method: "GET" }));
    expect(none.status).toBe(404);
    expect(unknown).toEqual(none);
    expect(garbage).toEqual(none);
  });

  it("gewist beeld: 404, zelfde antwoord als geen profielfoto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const none = await snapshot(await t.fetch(profilePath(s.mia), { method: "GET" }));
    await t.run((ctx) => ctx.storage.delete(s.profile));
    const wiped = await snapshot(await t.fetch(profilePath(s.owen), { method: "GET" }));
    expect(wiped).toEqual(none);
  });

  it.each(["klein", "groot"])("?formaat=%s: zolang het formaat er niet is, het origineel", async (formaat) => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await t.fetch(`${profilePath(s.owen)}?formaat=${formaat}`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PROFILE_BYTES);
  });

  it("onbekend formaat: 400", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await t.fetch(`${profilePath(s.owen)}?formaat=reuze`, { method: "GET" });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(PROFILE_BYTES);
  });
});
