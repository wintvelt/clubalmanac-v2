import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { seedPhoto } from "./_helpers";
import { seedMember } from "../_helpers/membership";

// WP25 — het beeldpad geeft het formaat (invariant 1, 3, 4, 5; A-invariant 13).
// Het contract van WP17a (besluit 2) blijft: zonder `formaat` het origineel,
// een onbekende waarde 400, en het formaat verandert niets aan de toegang.
// tests/images/httpRoute.test.ts pint dat voor een foto zónder formaten; hier
// de foto mét formaten, en de terugval.
//
// A-invariant 13: een formaat dat er niet is, geeft het origineel met
// `Cache-Control: no-store`. Anders bewaart de app (expo-image, per URL) een
// origineel van megabytes als *klein*, en bij een foto met een EXIF-tag ook
// nog scheef (A-kernvondst 2).

type T = ReturnType<typeof convexTest>;

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  await registerUser(t, "user_xena", "xena@x.com", "Xena");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  const withF = await seedPhoto(t, owen, { original: "ORIGINEEL-F", withFormats: true });
  const without = await seedPhoto(t, owen, { original: "ORIGINEEL-Z" });
  for (const p of [withF, without]) {
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: A, photoId: p.photoId });
  }
  // De profielfoto van Owen is het beeld van zijn foto met formaten.
  await t.run((ctx) => ctx.db.patch(owen, { profilePhotoStorageId: withF.storageId }));
  return { owen, mia, G, A, withF, without };
}

const photoUrl = (id: string, formaat?: string) =>
  `/beeld/foto/${id}${formaat ? `?formaat=${formaat}` : ""}`;
const profileUrl = (id: string, formaat?: string) =>
  `/beeld/profiel/${id}${formaat ? `?formaat=${formaat}` : ""}`;

describe("GET /beeld/foto — een foto met formaten", () => {
  it.each([
    ["klein", "klein van ORIGINEEL-F"],
    ["groot", "groot van ORIGINEEL-F"],
  ])("?formaat=%s: de bytes van dat formaat, image/jpeg, nosniff, private", async (formaat, bytes) => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_mia").fetch(photoUrl(s.withF.photoId, formaat), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(bytes);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toMatch(/\bprivate\b/);
    expect(cc).not.toMatch(/\bno-store\b/);
  });

  // WP17d A-keuze 1: alleen voor de eigenaar; een ander lid krijgt groot
  // (tests/location/originalImage.test.ts).
  it("zonder formaat: de eigenaar krijgt nog steeds het origineel (WP17a besluit 2)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_owen").fetch(photoUrl(s.withF.photoId), { method: "GET" });
    expect(await res.text()).toBe("ORIGINEEL-F");
  });

  it("invariant 4: geen toegang tot de foto, dan ook geen formaat; zelfde antwoord als een onbekend id", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const xena = withUser(t, "user_xena");
    const denied = await xena.fetch(photoUrl(s.withF.photoId, "klein"), { method: "GET" });
    const unknown = await xena.fetch(photoUrl("onbekend-id", "klein"), { method: "GET" });
    expect(denied.status).toBe(404);
    const deniedBody = await denied.text();
    expect(deniedBody).toBe(await unknown.text());
    expect(deniedBody).not.toContain("klein van");
  });

  it("invariant 4: uitgelogd 401, nooit de bytes van een formaat", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await t.fetch(photoUrl(s.withF.photoId, "groot"), { method: "GET" });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("groot van");
  });

  it("invariant 4 (WP17a inv. 2): een ex-lid krijgt met dezelfde URL geen formaat meer", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const url = photoUrl(s.withF.photoId, "klein");
    expect((await withUser(t, "user_mia").fetch(url, { method: "GET" })).status).toBe(200);
    await withUser(t, "user_mia").mutation(api.groups.removeMember, { groupId: s.G, userId: s.mia });
    expect((await withUser(t, "user_mia").fetch(url, { method: "GET" })).status).toBe(404);
  });

  it("invariant 5: geen storage-id van een formaat in de headers", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_mia").fetch(photoUrl(s.withF.photoId, "klein"), { method: "GET" });
    const headers = JSON.stringify([...res.headers.entries()]);
    for (const id of [s.withF.klein!, s.withF.groot!, s.withF.storageId]) {
      expect(headers).not.toContain(id);
    }
  });
});

describe("GET /beeld/foto — terugval (invariant 3, A-invariant 13)", () => {
  it.each(["klein", "groot"])(
    "?formaat=%s zonder formaten: het origineel, 200, met Cache-Control no-store",
    async (formaat) => {
      const t = convexTest(schema, modules);
      const s = await setup(t);
      const res = await withUser(t, "user_mia").fetch(photoUrl(s.without.photoId, formaat), { method: "GET" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ORIGINEEL-Z");
      expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bno-store\b/);
    },
  );

  it("een formaat-veld dat naar een gewist object wijst: het origineel (no-store), geen 404 en geen 500", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.run((ctx) => ctx.storage.delete(s.withF.klein!));
    const res = await withUser(t, "user_mia").fetch(photoUrl(s.withF.photoId, "klein"), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ORIGINEEL-F");
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bno-store\b/);
  });

  it("de terugval verandert niets aan de toegang: geen toegang blijft 404", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_xena").fetch(photoUrl(s.without.photoId, "klein"), { method: "GET" });
    expect(res.status).toBe(404);
  });
});

describe("GET /beeld/profiel — het formaat van een profielfoto (invariant 4, A-kernvondst 5)", () => {
  it.each([
    ["klein", "klein van ORIGINEEL-F"],
    ["groot", "groot van ORIGINEEL-F"],
  ])("?formaat=%s: het formaat van de foto met hetzelfde beeld, openbaar, public no-cache", async (formaat, bytes) => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await t.fetch(profileUrl(s.owen, formaat), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(bytes);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toMatch(/\bno-cache\b/);
    expect(cc).not.toMatch(/\bno-store\b/);
  });

  it("na een wissel naar een beeld zonder formaten: het nieuwe origineel (no-store), nooit het oude formaat", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await withUser(t, "user_owen").mutation(api.users.updateProfile, {
      profilePhotoStorageId: s.without.storageId,
    });
    const res = await t.fetch(profileUrl(s.owen, "klein"), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ORIGINEEL-Z");
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bno-store\b/);
  });

  it("een los gemigreerd beeld zonder foto-rij: het origineel (no-store)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const loose = await t.run((ctx) => ctx.storage.store(new Blob(["LOS-BEELD"], { type: "image/jpeg" })));
    await t.run((ctx) => ctx.db.patch(s.mia, { profilePhotoStorageId: loose }));
    const res = await t.fetch(profileUrl(s.mia, "klein"), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("LOS-BEELD");
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bno-store\b/);
  });

  it("de formaten van een foto worden geen profielfoto van een ander: Mia's profielpad toont nooit Owens formaat", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    // Mia heeft toegang tot Owens foto, maar mag hem niet als profielfoto zetten (WP17a inv. 16).
    await withUser(t, "user_mia")
      .mutation(api.users.updateProfile, { profilePhotoStorageId: s.withF.storageId })
      .catch(() => undefined);
    for (const formaat of ["klein", "groot"]) {
      const res = await t.fetch(profileUrl(s.mia, formaat), { method: "GET" });
      expect(await res.text()).not.toContain("van ORIGINEEL-F");
    }
  });
});
