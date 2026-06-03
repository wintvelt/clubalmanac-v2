import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";

// ---------------------------------------------------------------------------
// WP8 — photos.rotate MUTATION (isolate-runtime). Sessie A, RED-phase.
//
// Deze suite pint het synchrone deel van photo-rotation: auth-boundary,
// argument-validation, en het schedulen van de Node-action. De zware
// pixel-bewerking (sharp) zit in `internal.photoRotation.rotateAction` en
// wordt apart gepind in `rotateAction.test.ts` (sharp gemockt).
//
// Spec: docs/work-packages/WP8-photo-rotation.md
//   - Invariant "Geen frontend-blocking": mutation geeft snel terug + queue't
//     de action; geen storageId-swap in de mutation zelf.
//   - Invariant "Auth-boundary": owner OF group-admin van een publicatie-group
//     (albumPhotos). NIET member-zonder-admin, NIET webmaster, NIET vreemde.
//     A3: dit verstrakt v1 (oude code liet elk lid-met-toegang toe) — bewust.
//   - Arg "rotation": v.union(0|90|180|270) — vrije hoeken geweigerd door
//     de validator.
//   - A5 (should): HEIC-bron → mutation fast-fail (typed error), geen action.
//
// De mutation + action bestaan nog niet → RED tot B landt
// (`api.photos.rotate` / `internal.photoRotation.rotateAction` niet
// geregistreerd).
// ---------------------------------------------------------------------------

const WEBMASTER_EMAIL = "wm@x.com";

beforeEach(() => {
  // Webmaster bestaat als rol, maar mag GEEN rotate-backdoor krijgen (A: spec
  // zegt expliciet "niet door webmaster"). We zetten de env zodat een
  // eventuele requireWebmaster-leak zou slagen — de test bewijst dat rotate
  // wm tóch weigert.
  vi.stubEnv("WEBMASTER_EMAILS", WEBMASTER_EMAIL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Seed een photo direct (bypass upload-pipeline). dims + mimeType optioneel.
async function seedPhoto(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
  opts: { mimeType?: string; width?: number; height?: number } = {},
): Promise<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> {
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["fake-jpeg-bytes"])),
  );
  const photoId = await t.run(async (ctx) =>
    ctx.db.insert("photos", {
      ownerId,
      storageId,
      mimeType: opts.mimeType,
      width: opts.width,
      height: opts.height,
      ratingCount: 0,
      createdAt: Date.now(),
    }),
  );
  return { photoId, storageId };
}

// Publiceer een photo in een group via een album. role bepaalt de seed-rol
// van `memberSubject` in die group.
async function publishInGroupWithMember(
  t: ReturnType<typeof convexTest>,
  photoId: Id<"photos">,
  creatorId: Id<"users">,
  memberId: Id<"users">,
  memberRole: "admin" | "member",
): Promise<Id<"groups">> {
  return await t.run(async (ctx) => {
    const groupId = await ctx.db.insert("groups", {
      name: "G",
      createdBy: creatorId,
      createdAt: Date.now(),
    });
    const albumId = await ctx.db.insert("albums", {
      groupId,
      name: "A",
      createdBy: creatorId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      userId: memberId,
      groupId,
      role: memberRole,
      joinedAt: Date.now(),
    });
    await ctx.db.insert("albumPhotos", {
      albumId,
      photoId,
      groupId,
      addedAt: Date.now(),
      addedBy: creatorId,
    });
    return groupId;
  });
}

// RED-discipline voor negatieve tests: een test die `.rejects` verwacht wordt
// trivially groen zolang `api.photos.rotate` nog niet bestaat (de call rejected
// dan met "could not find function"). Deze helper eist dat de rejection een
// ECHTE auth/validation/HEIC-fout is — niet het function-missing-artefact —
// zodat de test nu RED is en pas groen wordt als B de juiste afwijzing bouwt.
async function expectRealRejection(p: Promise<unknown>): Promise<void> {
  let err: unknown;
  let threw = false;
  try {
    await p;
  } catch (e) {
    threw = true;
    err = e;
  }
  expect(threw, "verwachtte een rejection").toBe(true);
  const msg = String((err as { message?: unknown })?.message ?? err);
  expect(msg).not.toMatch(
    /could not find|no such export|exported from module|no function named|not a function|not registered/i,
  );
}

async function scheduledRotateActions(t: ReturnType<typeof convexTest>) {
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return scheduled.filter((s) => String(s.name).includes("rotateAction"));
}

// ---------------------------------------------------------------------------
// Happy path + scheduling + atomic-swap (geen premature storageId-swap)
// ---------------------------------------------------------------------------

describe("photos.rotate — schedule + atomic-swap", () => {
  it("owner rotate(90) → schedult precies één rotateAction, storageId nog ongewijzigd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId, storageId } = await seedPhoto(t, aliceId, {
      mimeType: "image/jpeg",
      width: 4000,
      height: 3000,
    });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    // Action gequeued, exact 1.
    const rotateCalls = await scheduledRotateActions(t);
    expect(rotateCalls).toHaveLength(1);

    // Atomic-swap-invariant: de mutation zelf swapt storageId NIET. De
    // file-vervanging gebeurt pas in de action.
    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.storageId).toBe(storageId);
    // exifOrientation/dims ook nog niet aangeraakt door de mutation.
    expect(photo?.exifOrientation).toBeUndefined();
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);
  });

  it("flip-only (rotation 0, flipY true) → action gescheduled", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { mimeType: "image/jpeg" });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 0,
      flipY: true,
    });

    expect(await scheduledRotateActions(t)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Argument-validation
// ---------------------------------------------------------------------------

describe("photos.rotate — argument-validation", () => {
  it("rotation buiten {0,90,180,270} (45) → afgewezen door validator, geen action", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId);

    await expectRealRejection(
      withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        // Bewust ongeldige hoek — de literal-union moet 'm weigeren.
        rotation: 45 as unknown as 0,
        flipY: false,
      }),
    );

    expect(await scheduledRotateActions(t)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bestaan + cleanup-race
// ---------------------------------------------------------------------------

describe("photos.rotate — photo bestaat niet", () => {
  it("onbekende photoId → throw, geen action", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId);
    // Verwijder de photo zodat de id geldig-getypeerd maar weg is.
    await t.run((ctx) => ctx.db.delete(photoId));

    await expectRealRejection(
      withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );

    expect(await scheduledRotateActions(t)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Auth-boundary: owner OR group-admin
// ---------------------------------------------------------------------------

describe("photos.rotate — auth-boundary", () => {
  it("owner mag eigen foto roteren", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId);

    await expect(
      withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    ).resolves.not.toThrow();
    expect(await scheduledRotateActions(t)).toHaveLength(1);
  });

  it("group-admin van een publicatie-group mag andermans foto roteren", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const { photoId } = await seedPhoto(t, aliceId);
    // Bob is admin van de group waarin alice's foto gepubliceerd staat.
    await publishInGroupWithMember(t, photoId, bobId, bobId, "admin");

    await expect(
      withUser(t, "user_bob").mutation(api.photos.rotate, {
        photoId,
        rotation: 180,
        flipY: false,
      }),
    ).resolves.not.toThrow();
    expect(await scheduledRotateActions(t)).toHaveLength(1);
  });

  it("member-zonder-admin in de publicatie-group → geweigerd (verstrakking t.o.v. v1, A3)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");
    const { photoId } = await seedPhoto(t, aliceId);
    // Bob maakt de group (admin); carol is gewone member.
    const groupId = await publishInGroupWithMember(
      t,
      photoId,
      bobId,
      bobId,
      "admin",
    );
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        userId: carolId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
      }),
    );

    await expectRealRejection(
      withUser(t, "user_carol").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
    expect(await scheduledRotateActions(t)).toHaveLength(0);
  });

  it("admin van een group waar de foto NIET gepubliceerd staat → geweigerd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const daveId = await registerUser(t, "user_dave", "d@x.com");
    const { photoId } = await seedPhoto(t, aliceId);

    // Dave is admin van een EIGEN group H, maar alice's foto staat daar niet
    // gepubliceerd (geen albumPhotos-link).
    await t.run(async (ctx) => {
      const groupH = await ctx.db.insert("groups", {
        name: "H",
        createdBy: daveId,
        createdAt: Date.now(),
      });
      await ctx.db.insert("memberships", {
        userId: daveId,
        groupId: groupH,
        role: "admin",
        joinedAt: Date.now(),
      });
    });

    await expectRealRejection(
      withUser(t, "user_dave").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
    expect(await scheduledRotateActions(t)).toHaveLength(0);
  });

  it("webmaster (geen owner, geen group-admin) → geweigerd (per spec, geen backdoor)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);
    const { photoId } = await seedPhoto(t, aliceId);

    await expectRealRejection(
      withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
    expect(await scheduledRotateActions(t)).toHaveLength(0);
  });

  it("vreemde user zonder enige relatie → geweigerd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_eve", "e@x.com");
    const { photoId } = await seedPhoto(t, aliceId);

    await expectRealRejection(
      withUser(t, "user_eve").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
    expect(await scheduledRotateActions(t)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A5 (should) — HEIC fast-fail in de mutation (synchroon, user-zichtbaar)
// ---------------------------------------------------------------------------

describe("photos.rotate — HEIC fast-fail (A5, should)", () => {
  // Spec A5: de action is autoritatief (magic-bytes), maar de mutation kan op
  // mimeType een snelle, user-zichtbare typed error geven. Async action-throw
  // is voor de user onzichtbaar. RED tot B de fast-fail toevoegt — als regie
  // de fast-fail NIET wil (open-vraag A6.3), wordt deze test geschrapt/herzien.
  it("mimeType image/heic → mutation throwt, geen action gescheduled", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { mimeType: "image/heic" });

    await expectRealRejection(
      withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
    expect(await scheduledRotateActions(t)).toHaveLength(0);
  });
});
