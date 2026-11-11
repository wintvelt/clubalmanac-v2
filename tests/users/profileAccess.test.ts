/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { deleteAccount } from "../_helpers/deleteAccount";
import { modules } from "../_helpers/modules";
import { seedMember } from "../_helpers/membership";

// WP27: een profielfoto uit elke foto met toegang, en weg als die toegang weg
// is (besluit 2, 3 en 4; invariant 1, 3, 4, 5 en 7; A-invariant 1 t/m 7;
// A-keuze 1 en 2). Spec: docs/work-packages/WP27-profiel.md §Spec-criticus
// aanvullingen.
//
// De regel hoort in de backend (invariant 3): het openbare profielpad (ook
// met een formaat, ook over http) en de avatar-velden in de user-vormen.
// "Verborgen" is niet te onderscheiden van "geen profielfoto" (A-invariant 2):
// elke vergelijking hieronder legt alice naast nora, die nooit een
// profielfoto had.
//
// De tests pinnen gedrag, niet de vorm: of de koppeling blijft staan en de
// backend bij het lezen kijkt (advies vraag 1), toetst "toegang terug, beeld
// terug" (invariant 3 van A).

type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const MISSING_FUNCTION =
  /could not find|no such export|exported from module|no function named|not a function|not registered/i;

/** Bytes die het profielpad als JPEG herkent (magische bytes), met een label. */
function jpeg(label: string): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), label], { type: "image/jpeg" });
}

async function insertPhoto(
  t: T,
  ownerId: Id<"users">,
  label: string,
  opts: { exifOrientation?: number; withFormats?: boolean } = {},
): Promise<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(jpeg(label));
    const formats = opts.withFormats
      ? {
          klein: await ctx.storage.store(jpeg(`klein van ${label}`)),
          groot: await ctx.storage.store(jpeg(`groot van ${label}`)),
        }
      : undefined;
    const photoId = await ctx.db.insert("photos", {
      ownerId,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
      ...(opts.exifOrientation !== undefined ? { exifOrientation: opts.exifOrientation } : {}),
      ...(formats ? { formats } : {}),
    });
    return { photoId, storageId };
  });
}

/**
 * Wereld:
 *   G1 — bob (oprichter, admin), alice (lid). Album A1 (van bob) met pBob.
 *   pBob — van bob, stand 6, met formaten.
 *   pBob2 — van bob, ook in A1.
 *   pBobPrivate — van bob, in geen album.
 *   pAlice — van alice, in geen album.
 *   carol — buiten elke groep. nora — buiten elke groep, nooit een profielfoto.
 */
async function setup(t: T) {
  const bob = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const alice = await registerUser(t, "user_alice", "alice@x.com", "Alice");
  const carol = await registerUser(t, "user_carol", "carol@x.com", "Carol");
  const nora = await registerUser(t, "user_nora", "nora@x.com", "Nora");
  const asBob = withUser(t, "user_bob");
  const G1 = await asBob.mutation(api.groups.create, { name: "G1" });
  await seedMember(t, { groupId: G1, userId: alice });
  const A1 = await asBob.mutation(api.albums.create, { groupId: G1, name: "A1" });
  const pBob = await insertPhoto(t, bob, "BOB", { exifOrientation: 6, withFormats: true });
  const pBob2 = await insertPhoto(t, bob, "BOB2");
  const pBobPrivate = await insertPhoto(t, bob, "BOB-PRIVE");
  const pAlice = await insertPhoto(t, alice, "ALICE", { exifOrientation: 3 });
  await asBob.mutation(api.albums.addPhoto, { albumId: A1, photoId: pBob.photoId });
  await asBob.mutation(api.albums.addPhoto, { albumId: A1, photoId: pBob2.photoId });
  return { bob, alice, carol, nora, G1, A1, pBob, pBob2, pBobPrivate, pAlice };
}

type S = Awaited<ReturnType<typeof setup>>;

const asAlice = (t: T) => withUser(t, "user_alice");
const asBob = (t: T) => withUser(t, "user_bob");

async function setAliceProfile(t: T, photoId: Id<"photos">) {
  await asAlice(t).mutation(api.users.setProfilePhoto, { photoId });
}

/** Een tweede groep G2 (van bob) met alice als lid en pBob ook in album A2. */
async function secondGroupWithPBob(t: T, s: S) {
  const G2 = await asBob(t).mutation(api.groups.create, { name: "G2" });
  await seedMember(t, { groupId: G2, userId: s.alice });
  const A2 = await asBob(t).mutation(api.albums.create, { groupId: G2, name: "A2" });
  await asBob(t).mutation(api.albums.addPhoto, { albumId: A2, photoId: s.pBob.photoId });
  return { G2, A2 };
}

/** Alles wat een buitenstaander en de app over de avatar van `userId` te zien krijgen. */
async function avatarOf(t: T, userId: Id<"users">, subject: string) {
  const image = await t.query(internal.images.profileImage, { userId });
  const klein = await t.query(internal.images.profileImageInFormat, { userId, formaat: "klein" });
  const res = await t.fetch(`/beeld/profiel/${userId}?formaat=klein`, { method: "GET" });
  const http = { status: res.status, body: await res.text() };
  const own = (await withUser(t, subject).query(api.users.profile, {})) as R;
  const fields = {
    profileVersion: own.profileVersion,
    profileHasFormats: own.profileHasFormats,
    profileOrientation: own.profileOrientation,
  };
  return { image, klein, http, fields };
}

/** Wat het profielpad en de vorm zeggen voor een user zonder profielfoto (nora). */
async function noneBaseline(t: T, s: S) {
  const nora = await avatarOf(t, s.nora, "user_nora");
  expect(nora.image).toBeNull();
  expect(nora.fields.profileVersion).toBe("0");
  return nora;
}

/** A-invariant 2: alice is niet te onderscheiden van een user zonder profielfoto. */
async function expectHidden(t: T, s: S, label: string) {
  const none = await noneBaseline(t, s);
  const alice = await avatarOf(t, s.alice, "user_alice");
  expect(alice.image, `${label}: profielpad`).toBeNull();
  expect(alice.klein, `${label}: profielpad met formaat`).toBeNull();
  expect(alice.http, `${label}: http`).toEqual(none.http);
  expect(alice.fields, `${label}: avatar-velden`).toEqual(none.fields);
}

/** Alice toont het beeld van `photo`. */
async function expectShows(
  t: T,
  s: S,
  photo: { storageId: Id<"_storage"> },
  label: string,
) {
  const alice = await avatarOf(t, s.alice, "user_alice");
  expect(alice.image, `${label}: profielpad`).toBe(photo.storageId);
  expect(alice.http.status, `${label}: http`).toBe(200);
  expect(alice.fields.profileVersion, `${label}: versie`).not.toBe("0");
  return alice;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("besluit 2: de foto van een ander met toegang wordt de profielfoto", () => {
  it("alice kiest pBob: het profielpad geeft pBob, voor iedereen gelijk", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);

    const shown = await expectShows(t, s, s.pBob, "na kiezen");
    expect(shown.http.body).toContain("klein van BOB");
    expect(shown.fields.profileHasFormats).toBe(true);
    expect(shown.fields.profileOrientation).toBe(6);
    // Besluit 3: openbaar, ook uitgelogd en buiten de groep. Het pad hangt
    // niet af van wie kijkt (A-invariant 1).
    const viewers = [withUser(t, "user_carol"), withUser(t, "user_bob"), asAlice(t)];
    expect(await t.query(internal.images.profileImage, { userId: s.alice })).toBe(s.pBob.storageId);
    for (const client of viewers) {
      expect(await client.query(internal.images.profileImage, { userId: s.alice })).toBe(
        s.pBob.storageId,
      );
    }
  });

  it("de avatar-velden zijn in elke vorm gelijk: zelf, een medelid en de ledenlijst", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    const own = (await asAlice(t).query(api.users.profile, {})) as R;
    const byBob = (await asBob(t).query(api.users.getById, { userId: s.alice })) as R;
    const members = (await asBob(t).query(api.groups.listMembers, { groupId: s.G1 })) as R[];
    const inList = members.find((m) => m.user?._id === s.alice)!.user;
    for (const shape of [byBob, inList]) {
      expect(shape.profileVersion).toBe(own.profileVersion);
      expect(shape.profileHasFormats).toBe(own.profileHasFormats);
      expect(shape.profileOrientation).toBe(own.profileOrientation);
    }
  });
});

describe("invariant 3: geen toegang meer, dan de letter — voor iedereen", () => {
  it("alice wordt uit de groep gehaald", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.alice });
    await expectHidden(t, s, "lid verwijderd");
  });

  it("alice verlaat de groep zelf", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await asAlice(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.alice });
    await expectHidden(t, s, "vertrokken");
  });

  it("pBob gaat uit het album", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.albums.removePhoto, { albumId: s.A1, photoId: s.pBob.photoId });
    await expectHidden(t, s, "uit album");
  });

  it("het album wordt verwijderd", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.albums.remove, { albumId: s.A1 });
    await expectHidden(t, s, "album weg");
  });

  it("de groep wordt verwijderd", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.groups.remove, { groupId: s.G1 });
    await expectHidden(t, s, "groep weg");
  });

  it("de eigenaar gaat uit de groep (M1: zijn foto's gaan uit de albums)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    // De oprichter vertrekt niet zonder overdracht (WP28 besluit 4).
    const dora = await registerUser(t, "user_dora", "dora@x.com", "Dora");
    await seedMember(t, { groupId: s.G1, userId: dora, role: "admin" });
    await asBob(t).mutation(api.groups.transferFounder, { groupId: s.G1, userId: dora });
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.bob });
    await expectHidden(t, s, "eigenaar vertrokken");
  });

  it("de foto wordt gewist", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    vi.useFakeTimers();
    await asBob(t).mutation(api.photos.remove, { photoId: s.pBob.photoId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expectHidden(t, s, "foto gewist");
  });

  it("de eigenaar verwijdert zijn account", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await deleteAccount(t, asBob(t));
    await expectHidden(t, s, "eigenaar weg");
  });

  it("de ledenlijst die een ander lid ziet, toont dan ook de letter", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.albums.removePhoto, { albumId: s.A1, photoId: s.pBob.photoId });
    const members = (await asBob(t).query(api.groups.listMembers, { groupId: s.G1 })) as R[];
    const alice = members.find((m) => m.user?._id === s.alice)!.user;
    const nora = (await withUser(t, "user_nora").query(api.users.profile, {})) as R;
    expect(alice.profileVersion).toBe("0");
    expect(alice.profileHasFormats).toBe(nora.profileHasFormats);
    expect(alice.profileOrientation).toBeUndefined();
    const byBob = (await asBob(t).query(api.users.getById, { userId: s.alice })) as R;
    expect(byBob.profileVersion).toBe("0");
  });
});

describe("invariant 5 en A-invariant 3: toegang terug, beeld terug", () => {
  it("pBob weer in het album: hetzelfde beeld, dezelfde versie", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    const before = await expectShows(t, s, s.pBob, "vooraf");
    await asBob(t).mutation(api.albums.removePhoto, { albumId: s.A1, photoId: s.pBob.photoId });
    await expectHidden(t, s, "tussendoor");
    await asBob(t).mutation(api.albums.addPhoto, { albumId: s.A1, photoId: s.pBob.photoId });
    const after = await expectShows(t, s, s.pBob, "terug");
    expect(after.fields).toEqual(before.fields);
  });

  it("alice weer lid: het beeld komt terug", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    const before = await expectShows(t, s, s.pBob, "vooraf");
    await asBob(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.alice });
    await expectHidden(t, s, "tussendoor");
    await seedMember(t, { groupId: s.G1, userId: s.alice });
    const after = await expectShows(t, s, s.pBob, "terug");
    expect(after.fields.profileVersion).toBe(before.fields.profileVersion);
  });
});

describe("A-invariant 4: toegang via een andere groep telt", () => {
  it("alice uit G1, maar pBob staat ook in een album van G2: het beeld blijft", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await secondGroupWithPBob(t, s);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.alice });
    await expectShows(t, s, s.pBob, "via G2");
  });

  it("daarna ook uit G2: de letter", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const { G2 } = await secondGroupWithPBob(t, s);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.alice });
    await asBob(t).mutation(api.groups.removeMember, { groupId: G2, userId: s.alice });
    await expectHidden(t, s, "uit beide");
  });
});

describe("A-invariant 5: een eigen foto blijft altijd", () => {
  it("in geen album en zonder groep", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pAlice.photoId);
    await asAlice(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.alice });
    const shown = await expectShows(t, s, s.pAlice, "eigen");
    expect(shown.fields.profileOrientation).toBe(3);
  });
});

describe("A-invariant 6: hoe de koppeling is gezet, maakt niet uit", () => {
  it("gemigreerd (invariant 7, WP17a besluit 13): de foto van een ander, toegang weg, dan de letter", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    // Zoals de WP12-transform hem neerzet: de koppeling direct, zonder mutation.
    await t.run((ctx) => ctx.db.patch(s.alice, { profilePhotoStorageId: s.pBob.storageId }));
    await expectShows(t, s, s.pBob, "gemigreerd, met toegang");
    await asBob(t).mutation(api.albums.removePhoto, { albumId: s.A1, photoId: s.pBob.photoId });
    await expectHidden(t, s, "gemigreerd, toegang weg");
  });

  it("gemigreerd zonder toegang vanaf het begin: de letter", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.run((ctx) => ctx.db.patch(s.alice, { profilePhotoStorageId: s.pBobPrivate.storageId }));
    await expectHidden(t, s, "gemigreerd, nooit toegang");
  });
});

describe("A-invariant 7 en invariant 4: geen terugval", () => {
  it("van pBob naar pBob2, dan pBob2 uit het album: de letter, niet pBob", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    await setAliceProfile(t, s.pBob2.photoId);
    await expectShows(t, s, s.pBob2, "pBob2");
    await asBob(t).mutation(api.albums.removePhoto, { albumId: s.A1, photoId: s.pBob2.photoId });
    await expectHidden(t, s, "pBob2 weg");
  });

  it("van een eigen foto naar pBob, dan pBob weg: de letter, niet de eigen foto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pAlice.photoId);
    await setAliceProfile(t, s.pBob.photoId);
    await asBob(t).mutation(api.groups.removeMember, { groupId: s.G1, userId: s.alice });
    await expectHidden(t, s, "geen terugval naar eigen");
  });
});

describe("A-keuze 1: een los beeld (standaard-knor) blijft zichtbaar", () => {
  it("een beeld zonder foto-rij, ook zonder groep", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const knor = await t.run(async (ctx) => {
      const id = await ctx.storage.store(jpeg("KNOR"));
      await ctx.db.patch(s.carol, { profilePhotoStorageId: id });
      return id;
    });
    expect(await t.query(internal.images.profileImage, { userId: s.carol })).toBe(knor);
    const res = await t.fetch(`/beeld/profiel/${s.carol}`, { method: "GET" });
    expect(res.status).toBe(200);
    const own = (await withUser(t, "user_carol").query(api.users.profile, {})) as R;
    expect(own.profileVersion).not.toBe("0");
  });
});

describe("invariant 1: kiezen zonder toegang verandert niets aan het profielpad", () => {
  it("een geweigerde keuze laat de huidige profielfoto staan", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await setAliceProfile(t, s.pBob.photoId);
    const o = await asAlice(t)
      .mutation(api.users.setProfilePhoto, { photoId: s.pBobPrivate.photoId })
      .then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
    expect(o, "had moeten falen").not.toBeNull();
    expect(o).not.toMatch(MISSING_FUNCTION);
    await expectShows(t, s, s.pBob, "na weigering");
  });
});
