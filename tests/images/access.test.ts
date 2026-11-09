import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { seedMember } from "../_helpers/membership";

// WP17a invarianten 1, 2, 3, 13 en 14, besluiten 1, 2 en 8 (spec §Besluiten
// Wouter 2026-11-06). De toegangsregel voor beeldbytes, los van hoe het beeld
// de client bereikt. Het beeldpad (vorm B, tests/images/httpRoute.test.ts)
// vraagt per verzoek: "welk beeld krijgt deze caller nu voor deze foto / dit
// profiel?". Antwoord: het beeld, of `null`.
//
// Twee interne queries in een nieuwe module `convex/images.ts`:
//   images.photoImage({ photoId })  → Id<"_storage"> | null
//   images.profileImage({ userId }) → Id<"_storage"> | null
// Intern: de client roept ze nooit rechtstreeks aan, het beeldpad wel (met de
// identity van het verzoek).
//
// Foto: het beeld volgt `canAccessPhoto` (WP23): eigenaar, of lid van een
// groep waarin de foto in een album staat. Geen webmaster-bypass. Geen
// toegang, onbekend id en gewist beeld geven hetzelfde: `null` (invariant
// 13). Uitgelogd ook `null` (het beeldpad geeft dan eerst 401).
//
// Profiel (besluit 8, invariant 3): openbaar, ook uitgelogd, zonder gedeelde
// groep en zonder toegang tot een foto met hetzelfde beeld. Maar alleen het
// beeld dat nú de profielfoto is: nooit een vorige profielfoto of een ander
// beeld van die user. Geen profielfoto, een gewist beeld en een onbekend
// user-id geven hetzelfde: `null` (invariant 14). Wat een profielfoto mag
// zijn, alleen een eigen beeld (besluit 10, invariant 16), pint
// tests/writeGates/storageReuse.test.ts; hier het gevolg voor het profielpad.
//
// De tests pinnen het originele `storageId`. De formaten (klein, groot) komen
// met WP25 (besluit 2); WP25 pint de keuze van het formaat.

type T = ReturnType<typeof convexTest>;

const photoImage = makeFunctionReference<
  "query",
  { photoId: Id<"photos"> },
  Id<"_storage"> | null
>("images:photoImage");

const profileImage = makeFunctionReference<
  "query",
  { userId: Id<"users"> },
  Id<"_storage"> | null
>("images:profileImage");

const WM_EMAIL = "wm@x.com";

function newT(): T {
  return convexTest(schema, modules);
}

async function blob(t: T, label: string): Promise<Id<"_storage">> {
  return await t.run((ctx) => ctx.storage.store(new Blob([label])));
}

async function insertPhoto(
  t: T,
  ownerId: Id<"users">,
  storageId?: Id<"_storage">,
): Promise<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> {
  const sid = storageId ?? (await blob(t, `foto-${Math.random()}`));
  const photoId = await t.run((ctx) =>
    ctx.db.insert("photos", {
      ownerId,
      storageId: sid,
      ratingCount: 0,
      createdAt: Date.now(),
    }),
  );
  return { photoId, storageId: sid };
}

async function setProfileBlob(t: T, userId: Id<"users">, storageId: Id<"_storage">) {
  await t.run((ctx) => ctx.db.patch(userId, { profilePhotoStorageId: storageId }));
}

/**
 * Owen (eigenaar) en Mia (lid) in groep G, album A met foto P van Owen.
 * Q is een foto van Owen in geen enkel album. Xena is lid van niets met hen.
 * Owen's profielfoto is een los beeld (geen foto-rij), zoals een gemigreerde
 * of (WP18) geüploade profielfoto.
 */
async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const xena = await registerUser(t, "user_xena", "xena@x.com", "Xena");
  await registerUser(t, "user_wm", WM_EMAIL, "Webmaster");

  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });

  const P = await insertPhoto(t, owen);
  await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: A, photoId: P.photoId });
  const Q = await insertPhoto(t, owen);

  const owenProfile = await blob(t, "profiel-owen");
  await setProfileBlob(t, owen, owenProfile);

  return { owen, mia, xena, G, A, P, Q, owenProfile };
}

async function deletedPhotoId(t: T, ownerId: Id<"users">): Promise<Id<"photos">> {
  const { photoId } = await insertPhoto(t, ownerId);
  await t.run((ctx) => ctx.db.delete(photoId));
  return photoId;
}

async function deletedUserId(t: T): Promise<Id<"users">> {
  const id = await registerUser(t, "user_weg", "weg@x.com", "Weg");
  await t.run((ctx) => ctx.db.delete(id));
  return id;
}

// ---------------------------------------------------------------------------
// Foto's
// ---------------------------------------------------------------------------

describe("images.photoImage — wie het beeld van een foto krijgt", () => {
  it("de eigenaar: het beeld van zijn foto, ook als die in geen album staat", async () => {
    const t = newT();
    const s = await setup(t);
    const owen = withUser(t, "user_owen");
    expect(await owen.query(photoImage, { photoId: s.P.photoId })).toBe(s.P.storageId);
    expect(await owen.query(photoImage, { photoId: s.Q.photoId })).toBe(s.Q.storageId);
  });

  it("een lid van een groep met de foto in een album: het beeld", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.P.photoId })).toBe(
      s.P.storageId,
    );
  });

  it("een lid, voor een foto van een ander die in geen album staat: null", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.Q.photoId })).toBeNull();
  });

  it("geen lid: null", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await withUser(t, "user_xena").query(photoImage, { photoId: s.P.photoId })).toBeNull();
  });

  it("de webmaster zonder lidmaatschap: null (geen bypass, WP23)", async () => {
    const t = newT();
    const s = await setup(t);
    process.env.WEBMASTER_EMAILS = WM_EMAIL;
    try {
      expect(
        await withUser(t, "user_wm", WM_EMAIL).query(photoImage, { photoId: s.P.photoId }),
      ).toBeNull();
    } finally {
      delete process.env.WEBMASTER_EMAILS;
    }
  });

  it("uitgelogd, of een identity zonder users-rij: null", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await t.query(photoImage, { photoId: s.P.photoId })).toBeNull();
    expect(await withUser(t, "user_spook").query(photoImage, { photoId: s.P.photoId })).toBeNull();
  });

  it("invariant 13: een onbekend foto-id geeft hetzelfde als geen toegang", async () => {
    const t = newT();
    const s = await setup(t);
    const gone = await deletedPhotoId(t, s.owen);
    const xena = withUser(t, "user_xena");
    const unknown = await xena.query(photoImage, { photoId: gone });
    const noAccess = await xena.query(photoImage, { photoId: s.P.photoId });
    expect(unknown).toBeNull();
    expect(unknown).toEqual(noAccess);
    // Ook voor de eigenaar zelf: een gewiste foto heeft geen beeld meer.
    expect(await withUser(t, "user_owen").query(photoImage, { photoId: gone })).toBeNull();
  });

  it("een gemelde foto blijft voor leden zichtbaar (vraag 4: v1-pariteit)", async () => {
    const t = newT();
    const s = await setup(t);
    await withUser(t, "user_mia").mutation(api.photos.flag, { photoId: s.P.photoId });
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.P.photoId })).toBe(
      s.P.storageId,
    );
  });
});

describe("images.photoImage — wie de toegang verliest, verliest het beeld (invariant 2)", () => {
  it("lid verlaat de groep: daarna null", async () => {
    const t = newT();
    const s = await setup(t);
    const mia = withUser(t, "user_mia");
    expect(await mia.query(photoImage, { photoId: s.P.photoId })).toBe(s.P.storageId);
    await mia.mutation(api.groups.removeMember, { groupId: s.G, userId: s.mia });
    expect(await mia.query(photoImage, { photoId: s.P.photoId })).toBeNull();
  });

  it("lid door een admin verwijderd: daarna null", async () => {
    const t = newT();
    const s = await setup(t);
    await withUser(t, "user_owen").mutation(api.groups.removeMember, {
      groupId: s.G,
      userId: s.mia,
    });
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.P.photoId })).toBeNull();
  });

  it("foto uit het album gehaald: het lid krijgt null, de eigenaar houdt het beeld", async () => {
    const t = newT();
    const s = await setup(t);
    await withUser(t, "user_owen").mutation(api.albums.removePhoto, {
      albumId: s.A,
      photoId: s.P.photoId,
    });
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.P.photoId })).toBeNull();
    expect(await withUser(t, "user_owen").query(photoImage, { photoId: s.P.photoId })).toBe(
      s.P.storageId,
    );
  });

  it("foto gewist: null, ook voor de eigenaar", async () => {
    const t = newT();
    const s = await setup(t);
    await withUser(t, "user_owen").mutation(api.photos.remove, { photoId: s.P.photoId });
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.P.photoId })).toBeNull();
    expect(await withUser(t, "user_owen").query(photoImage, { photoId: s.P.photoId })).toBeNull();
  });

  it("album gewist: het lid krijgt null", async () => {
    const t = newT();
    const s = await setup(t);
    await withUser(t, "user_owen").mutation(api.albums.remove, { albumId: s.A });
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.P.photoId })).toBeNull();
  });

  it("foto in twee groepen: uit één groep halen laat het beeld voor de andere groep staan", async () => {
    const t = newT();
    const s = await setup(t);
    // Groep K: Owen en Xena, met P ook in een album daar.
    const K = await withUser(t, "user_owen").mutation(api.groups.create, { name: "K" });
    await seedMember(t, { groupId: K, userId: s.xena });
    const AK = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: K, name: "AK" });
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: AK, photoId: s.P.photoId });
    expect(await withUser(t, "user_xena").query(photoImage, { photoId: s.P.photoId })).toBe(
      s.P.storageId,
    );

    await withUser(t, "user_owen").mutation(api.albums.removePhoto, {
      albumId: AK,
      photoId: s.P.photoId,
    });
    expect(await withUser(t, "user_xena").query(photoImage, { photoId: s.P.photoId })).toBeNull();
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: s.P.photoId })).toBe(
      s.P.storageId,
    );
  });
});

// ---------------------------------------------------------------------------
// Profielfoto's (besluit 8)
// ---------------------------------------------------------------------------

describe("images.profileImage — een profielfoto is openbaar (invariant 3)", () => {
  it("zichzelf, een medelid, iemand zonder gedeelde groep: allemaal de profielfoto", async () => {
    const t = newT();
    const s = await setup(t);
    for (const subject of ["user_owen", "user_mia", "user_xena"]) {
      expect(await withUser(t, subject).query(profileImage, { userId: s.owen }), subject).toBe(
        s.owenProfile,
      );
    }
  });

  it("uitgelogd, of een identity zonder users-rij: ook de profielfoto", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await t.query(profileImage, { userId: s.owen })).toBe(s.owenProfile);
    expect(await withUser(t, "user_spook").query(profileImage, { userId: s.owen })).toBe(
      s.owenProfile,
    );
  });

  it("na vertrek uit de groep: nog steeds de profielfoto (WP24 N4 vervalt door besluit 8)", async () => {
    const t = newT();
    const s = await setup(t);
    const mia = withUser(t, "user_mia");
    await mia.mutation(api.groups.removeMember, { groupId: s.G, userId: s.mia });
    expect(await mia.query(profileImage, { userId: s.owen })).toBe(s.owenProfile);
  });

  it("een profielfoto die het beeld van een foto is: ook voor wie geen toegang tot die foto heeft", async () => {
    // Owen zet het beeld van zijn foto P2 (alleen in een album van groep X)
    // als profielfoto. Daarmee is dat beeld openbaar via zijn profiel; via het
    // foto-pad blijft het dicht voor wie geen foto-toegang heeft.
    const t = newT();
    const s = await setup(t);
    const zed = await registerUser(t, "user_zed", "zed@x.com", "Zed");
    const X = await withUser(t, "user_owen").mutation(api.groups.create, { name: "X" });
    await seedMember(t, { groupId: X, userId: zed });
    const AX = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: X, name: "AX" });
    const P2 = await insertPhoto(t, s.owen);
    await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: AX, photoId: P2.photoId });
    await withUser(t, "user_owen").mutation(api.users.updateProfile, {
      profilePhotoStorageId: P2.storageId,
    });

    expect(await withUser(t, "user_mia").query(profileImage, { userId: s.owen })).toBe(P2.storageId);
    expect(await t.query(profileImage, { userId: s.owen })).toBe(P2.storageId);
    // Het foto-pad volgt nog steeds de foto-toegang (invariant 1).
    expect(await withUser(t, "user_mia").query(photoImage, { photoId: P2.photoId })).toBeNull();
  });

  it("invariant 16 (besluit 10): een lid maakt de foto van een ander niet openbaar via zijn profielfoto", async () => {
    // Red-team R1: Mia ziet P (lid van G). Ze probeert het beeld van P als
    // profielfoto te zetten. Dat wordt geweigerd, dus het openbare profielpad
    // van Mia geeft P nooit, ook niet uitgelogd of na haar vertrek.
    const t = newT();
    const s = await setup(t);
    const mia = withUser(t, "user_mia");
    expect(await mia.query(photoImage, { photoId: s.P.photoId })).toBe(s.P.storageId);
    await expect(
      mia.mutation(api.users.updateProfile, { profilePhotoStorageId: s.P.storageId }),
    ).rejects.toThrow();
    for (const client of [t, withUser(t, "user_xena"), mia]) {
      expect(await client.query(profileImage, { userId: s.mia })).toBeNull();
    }
    await mia.mutation(api.groups.removeMember, { groupId: s.G, userId: s.mia });
    expect(await t.query(profileImage, { userId: s.mia })).toBeNull();
    // Het foto-pad blijft de foto-toegang volgen.
    expect(await withUser(t, "user_xena").query(photoImage, { photoId: s.P.photoId })).toBeNull();
  });

  it("de webmaster: de profielfoto (geen bypass nodig, het is openbaar)", async () => {
    const t = newT();
    const s = await setup(t);
    process.env.WEBMASTER_EMAILS = WM_EMAIL;
    try {
      expect(
        await withUser(t, "user_wm", WM_EMAIL).query(profileImage, { userId: s.owen }),
      ).toBe(s.owenProfile);
    } finally {
      delete process.env.WEBMASTER_EMAILS;
    }
  });
});

describe("images.profileImage — alleen de actuele profielfoto (invariant 3)", () => {
  it("na een nieuwe profielfoto geeft het pad de nieuwe, nooit meer de vorige", async () => {
    const t = newT();
    const s = await setup(t);
    // Owen kiest het beeld van zijn eigen foto Q (toegestaan door WP24 invariant 8).
    await withUser(t, "user_owen").mutation(api.users.updateProfile, {
      profilePhotoStorageId: s.Q.storageId,
    });
    for (const client of [t, withUser(t, "user_xena"), withUser(t, "user_owen")]) {
      const got = await client.query(profileImage, { userId: s.owen });
      expect(got).toBe(s.Q.storageId);
      expect(got).not.toBe(s.owenProfile);
    }
  });

  it("een user zonder profielfoto: null, ook als hij foto's heeft", async () => {
    const t = newT();
    const s = await setup(t);
    // Mia heeft geen profielfoto; geef haar een eigen foto, die blijft privé.
    await insertPhoto(t, s.mia);
    expect(await t.query(profileImage, { userId: s.mia })).toBeNull();
    expect(await withUser(t, "user_owen").query(profileImage, { userId: s.mia })).toBeNull();
  });

  it("invariant 14: geen profielfoto, onbekend user-id en gewist beeld geven hetzelfde: null", async () => {
    const t = newT();
    const s = await setup(t);
    const gone = await deletedUserId(t);
    const none = await t.query(profileImage, { userId: s.mia });
    const unknown = await t.query(profileImage, { userId: gone });
    await t.run((ctx) => ctx.storage.delete(s.owenProfile));
    const wiped = await t.query(profileImage, { userId: s.owen });
    expect(none).toBeNull();
    expect(unknown).toBeNull();
    expect(wiped).toBeNull();
  });

  it("kernvondst 6: de foto achter de profielfoto is gewist (en daarmee het beeld): null", async () => {
    const t = newT();
    const s = await setup(t);
    await withUser(t, "user_owen").mutation(api.users.updateProfile, {
      profilePhotoStorageId: s.Q.storageId,
    });
    await withUser(t, "user_owen").mutation(api.photos.remove, { photoId: s.Q.photoId });
    // De storage-cleanup loopt async; ook als het beeld al weg is: null.
    await t.run((ctx) => ctx.storage.delete(s.Q.storageId));
    expect(await t.query(profileImage, { userId: s.owen })).toBeNull();
  });
});
