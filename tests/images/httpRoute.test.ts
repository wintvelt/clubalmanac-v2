import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import http from "../../convex/http";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP17a vraag 1, VOORLOPIG op A's advies (vorm B): het beeld via een
// httpAction die bij elk verzoek de identity en de toegang checkt. Kiest
// Wouter een andere vorm, dan vervalt of verandert dit bestand (A, ronde 2).
// De toegangsregel zelf staat los hiervan in tests/images/access.test.ts.
//
//   GET /beeld/foto/<photoId>    — bytes van de foto als de caller toegang heeft
//   GET /beeld/profiel/<userId>  — bytes van de profielfoto als de caller hem
//                                  mag zien (vraag 8)
//
// Uitgelogd: 401. Geen toegang, onbekend id, misvormd id, gewist beeld:
// precies hetzelfde 404-antwoord (invariant 13), nooit een 500 en nooit bytes.
// De response mag niet in een gedeelde cache belanden: `Cache-Control` bevat
// `private` (een proxy of CDN mag een geauthenticeerd beeld niet bewaren).
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

describe("GET /beeld/profiel/<userId>", () => {
  it("medelid: 200 met de bytes van de profielfoto, Cache-Control private", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_mia").fetch(profilePath(s.owen), { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bprivate\b/);
    expect(await res.text()).toBe(PROFILE_BYTES);
  });

  it("zichzelf: 200", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_owen").fetch(profilePath(s.owen), { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("uitgelogd: 401", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await t.fetch(profilePath(s.owen), { method: "GET" });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(PROFILE_BYTES);
  });

  it("invariant 14: geen gedeelde groep, geen profielfoto en misvormd id geven hetzelfde 404-antwoord", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const noAccess = await snapshot(
      await withUser(t, "user_xena").fetch(profilePath(s.owen), { method: "GET" }),
    );
    const none = await snapshot(
      await withUser(t, "user_owen").fetch(profilePath(s.mia), { method: "GET" }),
    );
    const garbage = await snapshot(
      await withUser(t, "user_xena").fetch(profilePath("geen-id"), { method: "GET" }),
    );
    expect(noAccess.status).toBe(404);
    expect(noAccess.body).not.toContain(PROFILE_BYTES);
    expect(none).toEqual(noAccess);
    expect(garbage).toEqual(noAccess);
  });

  it("WP24 N4: na vertrek uit de groep 404", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const mia = withUser(t, "user_mia");
    await mia.mutation(api.groups.removeMember, { groupId: s.G, userId: s.mia });
    expect((await mia.fetch(profilePath(s.owen), { method: "GET" })).status).toBe(404);
  });
});
