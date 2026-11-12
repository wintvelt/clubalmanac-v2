import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";
import { modules } from "../_helpers/modules";
import { seedPhoto } from "../photoFormats/_helpers";

// WP17d kernvondst 2 en 3: een gemigreerd origineel draagt EXIF met GPS (v1
// zette de bytes ongewijzigd in S3). Een formaat niet (WP25 invariant 18).
// De app vraagt het origineel nooit op; het beeldpad gaf het zonder `formaat`.
//
// A-invariant 8: het openbare profielpad geeft zonder formaat het formaat
// *groot* als er een is (met de bestaande terugval), nooit het origineel naast
// een formaat.
// A-keuze 1: het foto-pad geeft zonder formaat aan een niet-eigenaar *groot*
// (met de bestaande terugval); de eigenaar krijgt het origineel.

type T = ReturnType<typeof convexTest>;

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  const withF = await seedPhoto(t, owen, { original: "ORIGINEEL-MET-GPS", withFormats: true });
  const without = await seedPhoto(t, owen, { original: "ORIGINEEL-Z" });
  for (const p of [withF, without]) {
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: A, photoId: p.photoId });
  }
  return { owen, mia, withF, without };
}

const photoUrl = (id: string) => `/beeld/foto/${id}`;
const profileUrl = (id: string) => `/beeld/profiel/${id}`;

describe("A-invariant 8: het openbare profielpad geeft nooit het origineel naast een formaat", () => {
  it.each([
    ["uitgelogd", null],
    ["een medelid", "user_mia"],
    ["zichzelf", "user_owen"],
  ] as const)("%s, zonder formaat: de bytes van groot", async (_label, subject) => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: s.withF.storageId }));
    const client = subject === null ? t : withUser(t, subject);
    const res = await client.fetch(profileUrl(s.owen), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("groot van ORIGINEEL-MET-GPS");
  });

  it("een profielfoto zonder formaten: nog steeds het origineel (terugval, zoals WP25)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: s.without.storageId }));
    const res = await t.fetch(profileUrl(s.owen), { method: "GET" });
    expect(await res.text()).toBe("ORIGINEEL-Z");
  });
});

describe("A-keuze 1: het foto-pad zonder formaat geeft een niet-eigenaar geen origineel", () => {
  it("een lid krijgt zonder formaat de bytes van groot", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_mia").fetch(photoUrl(s.withF.photoId), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("groot van ORIGINEEL-MET-GPS");
  });

  it("de eigenaar krijgt zonder formaat het origineel", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_owen").fetch(photoUrl(s.withF.photoId), { method: "GET" });
    expect(await res.text()).toBe("ORIGINEEL-MET-GPS");
  });

  it("een foto zonder formaten: een lid krijgt nog het origineel (terugval, geaccepteerd)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await withUser(t, "user_mia").fetch(photoUrl(s.without.photoId), { method: "GET" });
    expect(await res.text()).toBe("ORIGINEEL-Z");
  });
});
