import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import http from "../../convex/http";
import { registerUser, withUser } from "../_helpers/auth";
import { bytesOf, containsBytes, sameBytes, SCHOON, SCHOON_B } from "../_helpers/jpeg";
import { modules } from "../_helpers/modules";
import { seedMember } from "../_helpers/membership";

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
// origineel. WP17d besluit 4: een origineel gaat alleen zonder metadata mee
// (tests/location/cleanOriginal.test.ts). De beelden hier zijn echte JPEG's
// zonder metadata: die gaan ongewijzigd mee. Een onbekende waarde: 400, voor iedereen gelijk, dus zonder
// orakel. Het formaat verandert niets aan de toegang.
//
// convex-test valideert geen JWT: `withIdentity(...).fetch` zet de identity
// direct (zie tests/http/upload.test.ts). De echte JWT-check doet Convex vóór
// de handler.

type T = ReturnType<typeof convexTest>;

const PHOTO_BYTES = SCHOON;
const PROFILE_BYTES = SCHOON_B;

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  await registerUser(t, "user_xena", "xena@x.com", "Xena");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
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

// De body als getallenreeks: zo vergelijkt `toEqual` twee antwoorden, en zoekt
// `holds` de bytes van een beeld erin.
async function snapshot(res: Response) {
  return { status: res.status, body: Array.from(await bytesOf(res)).join(",") };
}

const holds = (body: string, bytes: Uint8Array) => body.includes(Array.from(bytes).join(","));

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
    expect(sameBytes(await bytesOf(res), PHOTO_BYTES)).toBe(true);
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
    expect(containsBytes(await bytesOf(res), PHOTO_BYTES)).toBe(false);
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
    expect(holds(noAccess.body, PHOTO_BYTES)).toBe(false);
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
    expect(containsBytes(await bytesOf(res), PHOTO_BYTES)).toBe(false);
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
    expect(sameBytes(await bytesOf(res), PHOTO_BYTES)).toBe(true);
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
    expect(holds(member.body, PHOTO_BYTES)).toBe(false);
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
    expect(sameBytes(await bytesOf(res), PROFILE_BYTES)).toBe(true);
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
    expect(sameBytes(await bytesOf(await t.fetch(profilePath(s.owen), { method: "GET" })), PROFILE_BYTES)).toBe(true);
    // Owen kiest het beeld van zijn foto P als profielfoto (WP24 invariant 8).
    const photoStorage = await t.run(async (ctx) => (await ctx.db.get(s.photoId))!.storageId);
    await withUser(t, "user_owen").mutation(api.users.updateProfile, {
      profilePhotoStorageId: photoStorage,
    });
    const res = await t.fetch(profilePath(s.owen), { method: "GET" });
    expect(res.status).toBe(200);
    const body = await bytesOf(res);
    expect(sameBytes(body, PHOTO_BYTES)).toBe(true);
    expect(containsBytes(body, PROFILE_BYTES)).toBe(false);
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
      expect(holds(anon.body, PHOTO_BYTES), url).toBe(false);
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
    expect(sameBytes(await bytesOf(res), PROFILE_BYTES)).toBe(true);
  });

  it("onbekend formaat: 400", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await t.fetch(`${profilePath(s.owen)}?formaat=reuze`, { method: "GET" });
    expect(res.status).toBe(400);
    expect(containsBytes(await bytesOf(res), PROFILE_BYTES)).toBe(false);
  });
});

// --- Content-Type (invariant 17, fix-cyclus 3, N-S2; WP17d besluit 4) ---------------
//
// Veel gemigreerde beelden staan in storage als `application/octet-stream`
// (regie op dev: 444 van 1002). Dan bepalen de eerste bytes het type. Beide
// beeldpaden sturen altijd `nosniff`. Het type van een JPEG:
//   - opgeslagen als een rasterbeeld (image/jpeg, …): dat type;
//   - anders (octet-stream, leeg, of een ander type): uit de eerste bytes.
// Nooit een ander opgeslagen type: een HTML- of SVG-bestand als profielfoto
// zou anders op het openbare profielpad in een browser draaien.
//
// WP17d besluit 4 (A-invariant 10): een origineel dat geen JPEG is, gaat
// zonder formaten niet ongewijzigd mee (PNG, WebP en HEIC kunnen GPS dragen).
// Daarvoor geldt hier alleen: nooit dat bestand, en nooit als HTML of SVG.

const rawOf = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

const JPEG = SCHOON;
const PNG = rawOf([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d], "IHDR");
const WEBP = rawOf("RIFF", [0x24, 0x00, 0x00, 0x00], "WEBPVP8 ");
const HEIC = rawOf([0x00, 0x00, 0x00, 0x18], "ftypheic", [0x00, 0x00, 0x00, 0x00]);
const UNKNOWN = rawOf("GEEN-BEELD", [0x00, 0x01, 0x02, 0x03, 0xfe, 0xfd]);
const HTML = rawOf("<!doctype html><script>alert(1)</script>");
const SVG = rawOf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// Een foto van owen in album A met dit beeld (mia heeft toegang), en hetzelfde
// beeld als profielfoto van owen.
async function storedImage(t: T, bytes: Uint8Array<ArrayBuffer>, type: string | null) {
  const s = await setup(t);
  const { photoId } = await t.run(async (ctx) => {
    const blob = type === null ? new Blob([bytes]) : new Blob([bytes], { type });
    const storageId = await ctx.storage.store(blob);
    const photoId = await ctx.db.insert("photos", {
      ownerId: s.owen,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
    });
    await ctx.db.patch(s.owen, { profilePhotoStorageId: storageId });
    return { photoId };
  });
  await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: s.A, photoId });
  return { ...s, photoId };
}

async function both(t: T, s: { photoId: Id<"photos">; owen: Id<"users"> }) {
  return {
    foto: await withUser(t, "user_mia").fetch(photoPath(s.photoId), { method: "GET" }),
    profiel: await t.fetch(profilePath(s.owen), { method: "GET" }),
  };
}

async function expectServed(res: Response, bytes: Uint8Array, type: string) {
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe(type);
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
}

describe("beeldpaden — Content-Type (invariant 17)", () => {
  it("octet-stream met JPEG-bytes: 200, dezelfde bytes, image/jpeg (foto- en profielpad)", async () => {
    const t = convexTest(schema, modules);
    const s = await storedImage(t, JPEG, "application/octet-stream");
    const { foto, profiel } = await both(t, s);
    await expectServed(foto, JPEG, "image/jpeg");
    await expectServed(profiel, JPEG, "image/jpeg");
  });

  it("zonder opgeslagen type, met JPEG-bytes: image/jpeg", async () => {
    const t = convexTest(schema, modules);
    const s = await storedImage(t, JPEG, null);
    const { foto, profiel } = await both(t, s);
    await expectServed(foto, JPEG, "image/jpeg");
    await expectServed(profiel, JPEG, "image/jpeg");
  });

  // WP17d besluit 4: zonder formaten gaat een niet-JPEG niet ongewijzigd mee.
  it.each([
    ["octet-stream met PNG-bytes", PNG, "application/octet-stream"],
    ["octet-stream met WebP-bytes", WEBP, "application/octet-stream"],
    ["octet-stream met HEIC-bytes", HEIC, "application/octet-stream"],
    ["octet-stream met onbekende bytes", UNKNOWN, "application/octet-stream"],
    ["opgeslagen als image/png", PNG, "image/png"],
    ["opgeslagen als text/html", HTML, "text/html"],
    ["opgeslagen als image/svg+xml", SVG, "image/svg+xml"],
    ["opgeslagen als text/html; charset=utf-8", HTML, "text/html; charset=utf-8"],
  ] as const)("%s, zonder formaten: nooit dat bestand ongewijzigd, nooit HTML of SVG", async (_name, bytes, stored) => {
    const t = convexTest(schema, modules);
    const s = await storedImage(t, bytes, stored);
    const { foto, profiel } = await both(t, s);
    for (const [where, res] of [["foto", foto], ["profiel", profiel]] as const) {
      expect(res.status, `${where}: geen 500`).toBeLessThan(500);
      expect(res.headers.get("Content-Type") ?? "", where).not.toMatch(/html|svg|xml/i);
      if (res.status === 200) expect(res.headers.get("X-Content-Type-Options"), where).toBe("nosniff");
      expect(sameBytes(await bytesOf(res), bytes), `${where}: het ongewijzigde bestand`).toBe(false);
    }
  });

  it("opgeslagen als text/html, maar met JPEG-bytes: image/jpeg", async () => {
    const t = convexTest(schema, modules);
    const s = await storedImage(t, JPEG, "text/html");
    const { foto, profiel } = await both(t, s);
    await expectServed(foto, JPEG, "image/jpeg");
    await expectServed(profiel, JPEG, "image/jpeg");
  });
});
