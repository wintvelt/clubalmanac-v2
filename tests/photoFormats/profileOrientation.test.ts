import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { expectShape, SHAPE } from "../readWhitelist/_world";
import { seedPhoto } from "./_helpers";

// WP25 fix-cyclus 1 — een avatar staat rechtop (A-invariant 19, kernvondst 7).
//
// Na de backfill geeft `/beeld/profiel/<userId>?formaat=klein` ruwe pixels
// zonder tag. De app kan hem alleen rechtop zetten als de user-response de
// stand meegeeft: `profileOrientation`, de `exifOrientation` van dezelfde
// foto-rij waarvan het profielpad de bytes geeft. Twee rijen met hetzelfde
// beeld kunnen verschillend gedraaid zijn (WP8), dus de tests leggen de
// geserveerde bytes naast de stand: elke rij heeft eigen formaat-bytes, en de
// stand moet bij de rij van die bytes horen.

type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const DAY = 24 * 60 * 60 * 1000;

/** Een extra foto-rij op een bestaand beeld, met eigen formaten (bytes "klein van <label>"). */
async function addRow(
  t: T,
  ownerId: Id<"users">,
  storageId: Id<"_storage">,
  opts: { label: string; withFormats: boolean; exifOrientation?: number },
): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
    const formats = opts.withFormats
      ? {
          klein: await ctx.storage.store(new Blob([`klein van ${opts.label}`], { type: "image/jpeg" })),
          groot: await ctx.storage.store(new Blob([`groot van ${opts.label}`], { type: "image/jpeg" })),
        }
      : undefined;
    const doc = {
      ownerId,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
      ...(opts.exifOrientation !== undefined ? { exifOrientation: opts.exifOrientation } : {}),
      ...(formats ? { formats } : {}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await ctx.db.insert("photos", doc as any);
  });
}

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const bob = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await withUser(t, "user_owen").mutation(api.groups.addMember, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  return { owen, mia, bob, G, A };
}

const profileUrl = (id: string, formaat = "klein") => `/beeld/profiel/${id}?formaat=${formaat}`;

async function servedText(t: T, userId: string): Promise<string> {
  const res = await t.fetch(profileUrl(userId), { method: "GET" });
  expect(res.status).toBe(200);
  return await res.text();
}

/** De stand die Mia (medelid) voor Owen ziet, via `users.getById`. */
async function standOf(t: T, userId: Id<"users">): Promise<unknown> {
  const u = (await withUser(t, "user_mia").query(api.users.getById, { userId })) as R;
  return u.profileOrientation;
}

describe("de stand komt mee in elke user-vorm met een avatar", () => {
  it("eigen foto met formaten en stand 6: profileOrientation 6 in alle zeven responses, verder dezelfde velden", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { original: "OWEN", withFormats: true, exifOrientation: 6 });
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: s.A, photoId: p.photoId });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: p.storageId }));
    await t.run((ctx) =>
      ctx.db.insert("invites", {
        email: "nieuw@x.com",
        invitedBy: s.owen,
        groupId: s.G,
        role: "member",
        token: "tok-owen",
        status: "pending",
        expiresAt: Date.now() + DAY,
        createdAt: Date.now(),
      }),
    );
    const mia = withUser(t, "user_mia");
    const owen = withUser(t, "user_owen");
    const publicKeys = [...SHAPE.publicProfile, "profileOrientation"];

    const withOwner = (await mia.query(api.photos.getWithOwner, { photoId: p.photoId })) as R;
    const listed = ((await mia.query(api.albums.listPhotos, { albumId: s.A })) as R[]).find(
      (i) => i.photo?._id === p.photoId,
    )!;
    const member = ((await mia.query(api.groups.listMembers, { groupId: s.G })) as R[]).find(
      (m) => m.user?._id === s.owen,
    )!;
    const byId = (await mia.query(api.users.getById, { userId: s.owen })) as R;
    const current = (await owen.query(api.users.current, {})) as R;
    const profile = (await owen.query(api.users.profile, {})) as R;
    const landing = (await t.query(api.invites.getByToken, { token: "tok-owen" })) as R;

    const cases: [string, R, readonly string[]][] = [
      ["photos.getWithOwner", withOwner.owner, publicKeys],
      ["albums.listPhotos", listed.owner, publicKeys],
      ["groups.listMembers", member.user, publicKeys],
      ["users.getById", byId, publicKeys],
      ["users.current", current, [...SHAPE.ownProfile, "profileOrientation"]],
      ["users.profile", profile, [...SHAPE.ownProfile, "profileOrientation"]],
      ["invites.getByToken", landing.inviter, [...SHAPE.landingInviter, "profileOrientation"]],
    ];
    for (const [name, value, keys] of cases) {
      expect(value?.profileOrientation, name).toBe(6);
      expectShape(value, keys);
    }
  });

  it("alleen het getal: geen foto-id of beeld-id in de response (WP17a invariant 10)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { original: "OWEN", withFormats: true, exifOrientation: 8 });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: p.storageId }));
    const u = (await withUser(t, "user_mia").query(api.users.getById, { userId: s.owen })) as R;
    expect(u.profileOrientation).toBe(8);
    const json = JSON.stringify(u);
    for (const id of [p.photoId, p.storageId, p.klein!, p.groot!]) expect(json).not.toContain(id);
  });
});

describe("de stand hoort bij de rij waarvan het profielpad de bytes geeft", () => {
  it("een andere rij (ouder, stand 3) en een eigen rij (stand 6), beide met formaten: eigen bytes, stand 6", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["BEELD"], { type: "image/jpeg" })));
    // De rij van Bob is ouder, maar een eigen rij gaat voor.
    await addRow(t, s.bob, storageId, { label: "BOB", withFormats: true, exifOrientation: 3 });
    await addRow(t, s.owen, storageId, { label: "OWEN", withFormats: true, exifOrientation: 6 });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: storageId }));

    expect(await servedText(t, s.owen)).toBe("klein van OWEN");
    expect(await standOf(t, s.owen)).toBe(6);
  });

  it("de eigen rij heeft geen formaten (stand 8), een andere wel (stand 3): de bytes van die andere, stand 3", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const own = await seedPhoto(t, s.owen, { original: "BEELD", exifOrientation: 8 });
    await addRow(t, s.bob, own.storageId, { label: "BOB", withFormats: true, exifOrientation: 3 });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: own.storageId }));

    expect(await servedText(t, s.owen)).toBe("klein van BOB");
    expect(await standOf(t, s.owen)).toBe(3);
  });

  it("twee andere rijen met formaten (stand 3 en 6): de stand van de rij waarvan de bytes komen", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["BEELD"], { type: "image/jpeg" })));
    await addRow(t, s.bob, storageId, { label: "EERSTE", withFormats: true, exifOrientation: 3 });
    await addRow(t, s.mia, storageId, { label: "TWEEDE", withFormats: true, exifOrientation: 6 });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: storageId }));

    const served = await servedText(t, s.owen);
    const expected: Record<string, number> = { "klein van EERSTE": 3, "klein van TWEEDE": 6 };
    expect(Object.keys(expected)).toContain(served);
    expect(await standOf(t, s.owen)).toBe(expected[served]);
  });

  it("geen rij met formaten: het origineel, met de stand van de eigen rij (WP8, zoals Photo)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const own = await seedPhoto(t, s.owen, { original: "OWEN-ORIGINEEL", exifOrientation: 6 });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: own.storageId }));

    expect(await servedText(t, s.owen)).toBe("OWEN-ORIGINEEL");
    expect(await standOf(t, s.owen)).toBe(6);
  });

  it("na een wissel van profielfoto: de stand van de nieuwe foto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const first = await seedPhoto(t, s.owen, { original: "EEN", withFormats: true, exifOrientation: 6 });
    const second = await seedPhoto(t, s.owen, { original: "TWEE", withFormats: true, exifOrientation: 3 });
    await withUser(t, "user_owen").mutation(api.users.updateProfile, { profilePhotoStorageId: first.storageId });
    expect(await standOf(t, s.owen)).toBe(6);

    await withUser(t, "user_owen").mutation(api.users.updateProfile, { profilePhotoStorageId: second.storageId });
    expect(await servedText(t, s.owen)).toBe("klein van TWEE");
    expect(await standOf(t, s.owen)).toBe(3);
  });
});

describe("geen stand: het veld ontbreekt", () => {
  it("geen profielfoto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const u = (await withUser(t, "user_mia").query(api.users.getById, { userId: s.owen })) as R;
    expectShape(u, SHAPE.publicProfile);
  });

  it("een los gemigreerd beeld zonder foto-rij", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const loose = await t.run((ctx) => ctx.storage.store(new Blob(["LOS"], { type: "image/jpeg" })));
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: loose }));
    const u = (await withUser(t, "user_mia").query(api.users.getById, { userId: s.owen })) as R;
    expectShape(u, SHAPE.publicProfile);
  });

  it("een foto met formaten maar zonder stand (geen tag, of HEIC)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await seedPhoto(t, s.owen, { original: "OWEN", withFormats: true });
    await t.run((ctx) => ctx.db.patch(s.owen, { profilePhotoStorageId: p.storageId }));
    const me = (await withUser(t, "user_owen").query(api.users.current, {})) as R;
    expectShape(me, SHAPE.ownProfile);
  });
});
