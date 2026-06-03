import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser } from "../_helpers/auth";

// ---------------------------------------------------------------------------
// WP8 — internal.photoRotation.rotateAction (Node-runtime, "use node").
// Sessie A, RED-phase.
//
// Spec: docs/work-packages/WP8-photo-rotation.md
//
// Test-aanpak (A7): sharp is gemockt op CHAINABLE-niveau via een Proxy die
// elke methode slikt en alleen op `toBuffer()` + `metadata()` terminaliseert.
// Daardoor pinnen de tests GEDRAG OP HET PHOTO-RECORD (storageId-swap,
// exifOrientation=1, dims uit output-metadata, cleanup-schedule) i.p.v. sharp's
// method-namen. B kan sharp óf jimp kiezen zonder dat deze units breken; de
// pixel-waarheid (rotatie-richting, flip-richting, EXIF-bake-in A2) zit in de
// integration-gate (`rotateRoundtrip`) + empirische Gate 1 — unit-tests vangen
// Buffer-runtime/pixel-issues bewust niet (convex-runtimes.md).
//
// Gepind hier:
//   - storageId-swap naar nieuwe blob; oude blob via cleanupStorage opgeruimd
//   - exifOrientation → 1 (neutraliseert client-CSS) ongeacht prior waarde
//   - width/height = WERKELIJKE output-dims (A4): swap bij 90/270, gelijk bij
//     0/180, én gezet wanneer bron-dims undefined waren
//   - mimeType behouden
//   - rotatie-waarde + flip bereiken sharp (lichte contract-assert)
//   - HEIC-bron → typed throw, GEEN partial patch, oude blob intact
//   - bewerking faalt vóór de patch → GEEN partial patch (no-partial-write)
//   - cascade-safe: ratings/albumPhotos/flagging ongemoeid
//   - cleanup-race: photo weg → no-op
//
// rotateAction bestaat nog niet → RED tot B `convex/photoRotation.ts` landt.
// ---------------------------------------------------------------------------

// Mutable sharp-mock state — alleen GELEZEN binnen method-bodies (call-time),
// nooit op factory-top-level (zelfde hoisting-discipline als extractMetadata).
type SharpState = {
  metadata: { width?: number; height?: number; format?: string };
  outBytes: Uint8Array;
  failAt: null | "toBuffer" | "metadata";
};
let sharpState: SharpState = {
  metadata: { width: 100, height: 100, format: "jpeg" },
  outBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  failAt: null,
};
let sharpCalls: { method: string; args: unknown[] }[] = [];

vi.mock("sharp", () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      const name = String(prop);
      if (name === "toBuffer") {
        return async () => {
          if (sharpState.failAt === "toBuffer") {
            throw new Error("sharp toBuffer fail (simulated)");
          }
          return sharpState.outBytes;
        };
      }
      if (name === "metadata") {
        return async () => {
          if (sharpState.failAt === "metadata") {
            throw new Error("sharp metadata fail (simulated)");
          }
          return sharpState.metadata;
        };
      }
      // Niet-thenable houden: anders zou `await sharp(x)` de proxy als promise
      // behandelen.
      if (name === "then" || name === "catch" || name === "finally") {
        return undefined;
      }
      // Elke andere methode is chainable: registreer + return de chain.
      return (...args: unknown[]) => {
        sharpCalls.push({ method: name, args });
        return chain;
      };
    },
  };
  const chain: Record<string, unknown> = new Proxy({}, handler);
  const sharpFn = (..._args: unknown[]) => chain;
  return { default: sharpFn };
});

const HEADER_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

// HEIC magic bytes: "....ftypheic" (ISO-BMFF brand).
const HEADER_HEIC = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
]);

beforeEach(() => {
  sharpState = {
    metadata: { width: 100, height: 100, format: "jpeg" },
    outBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    failAt: null,
  };
  sharpCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedPhotoWithBytes(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
  headerBytes: Uint8Array,
  opts: {
    mimeType?: string;
    width?: number;
    height?: number;
    exifOrientation?: number;
  } = {},
): Promise<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> {
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob([headerBytes])),
  );
  const photoId = await t.run(async (ctx) =>
    ctx.db.insert("photos", {
      ownerId,
      storageId,
      mimeType: opts.mimeType,
      width: opts.width,
      height: opts.height,
      exifOrientation: opts.exifOrientation,
      ratingCount: 0,
      createdAt: Date.now(),
    }),
  );
  return { photoId, storageId };
}

async function cleanupScheduled(t: ReturnType<typeof convexTest>) {
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return scheduled.filter((s) => String(s.name).includes("cleanupStorage"));
}

// RED-discipline: zolang `convex/photoRotation.ts` ontbreekt rejected elke
// action-call met "could not find module" — een `.rejects.toThrow()` zou dan
// trivially groen zijn. Deze helper eist een ECHTE fout (HEIC-reject /
// bewerkings-fout), niet het module-missing-artefact.
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

// ---------------------------------------------------------------------------
// Happy path — storage-swap + exifOrientation neutralisatie + cleanup
// ---------------------------------------------------------------------------

describe("rotateAction — storage-swap + exifOrientation + cleanup", () => {
  it("rotate(90) → nieuwe storageId, exifOrientation=1, oude blob opgeruimd", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      // Bron stond op exifOrientation=6 (CSS-gecorrigeerd) — moet naar 1.
      const { photoId, storageId } = await seedPhotoWithBytes(
        t,
        aliceId,
        HEADER_JPEG,
        { mimeType: "image/jpeg", width: 4000, height: 3000, exifOrientation: 6 },
      );
      // 90° → output-dims geswapt.
      sharpState.metadata = { width: 3000, height: 4000, format: "jpeg" };

      await t.action(internal.photoRotation.rotateAction, {
        photoId,
        rotation: 90,
        flipY: false,
      });

      const photo = await t.run((ctx) => ctx.db.get(photoId));
      // Atomic-swap: storageId wijst nu naar een NIEUWE blob.
      expect(photo?.storageId).toBeDefined();
      expect(photo?.storageId).not.toBe(storageId);
      // EXIF-neutralisatie: client past geen CSS-transform meer toe.
      expect(photo?.exifOrientation).toBe(1);
      // mimeType behouden.
      expect(photo?.mimeType).toBe("image/jpeg");

      // Cleanup van de OUDE blob is gescheduled (na de patch, niet ervoor).
      expect((await cleanupScheduled(t)).length).toBeGreaterThan(0);

      // Nieuwe blob is geldig referentieerbaar; oude wordt opgeruimd.
      const newUrl = await t.run((ctx) =>
        ctx.storage.getUrl(photo!.storageId),
      );
      expect(newUrl).not.toBeNull();

      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const oldUrl = await t.run((ctx) => ctx.storage.getUrl(storageId));
      expect(oldUrl).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rotatie-waarde + flip bereiken de image-lib (contract-assert, lib-agnostisch)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
    });
    sharpState.metadata = { width: 100, height: 100, format: "jpeg" };

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 270,
      flipY: true,
    });

    // De gevraagde rotatie-hoek moet ergens als argument bij de lib aankomen
    // (B mag niet stilletjes de rotation negeren).
    const rotationReached = sharpCalls.some((c) => c.args.includes(270));
    expect(rotationReached).toBe(true);

    // flipY=true → een mirror-operatie is aangeroepen (flip/flop/mirror-familie).
    const mirrorCalled = sharpCalls.some((c) =>
      /^(flip|flop|mirror)$/i.test(c.method),
    );
    expect(mirrorCalled).toBe(true);
  });

  it("flipY=false → geen mirror-operatie aangeroepen", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
    });

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    const mirrorCalled = sharpCalls.some((c) =>
      /^(flip|flop|mirror)$/i.test(c.method),
    );
    expect(mirrorCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// width/height = werkelijke output-dims (A4)
// ---------------------------------------------------------------------------

describe("rotateAction — width/height uit output-dims (A4)", () => {
  it("90° → dims geswapt", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
      width: 4000,
      height: 3000,
    });
    sharpState.metadata = { width: 3000, height: 4000, format: "jpeg" };

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(3000);
    expect(photo?.height).toBe(4000);
  });

  it("270° → dims geswapt", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
      width: 4000,
      height: 3000,
    });
    sharpState.metadata = { width: 3000, height: 4000, format: "jpeg" };

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 270,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(3000);
    expect(photo?.height).toBe(4000);
  });

  it("180° → dims gelijk", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
      width: 4000,
      height: 3000,
    });
    sharpState.metadata = { width: 4000, height: 3000, format: "jpeg" };

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 180,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);
  });

  it("flip-only (rotation 0) → dims gelijk", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
      width: 4000,
      height: 3000,
    });
    sharpState.metadata = { width: 4000, height: 3000, format: "jpeg" };

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 0,
      flipY: true,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);
  });

  // Discriminerend (A4): bron-dims ontbreken → blind swappen levert undefined;
  // dims MOETEN uit de werkelijke output-metadata komen.
  it("bron-dims undefined → dims gezet op werkelijke output-dims (niet undefined)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
      // width/height bewust ongezet (foto nog niet door extractMetadata).
    });
    sharpState.metadata = { width: 3024, height: 4032, format: "jpeg" };

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(3024);
    expect(photo?.height).toBe(4032);
  });
});

// ---------------------------------------------------------------------------
// HEIC-bron — typed throw, geen partial patch (spec: NIET silent skip)
// ---------------------------------------------------------------------------

describe("rotateAction — HEIC-bron rejected", () => {
  it("HEIC magic-bytes → throw + photo ongewijzigd + oude blob intact + geen cleanup", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId, storageId } = await seedPhotoWithBytes(
      t,
      aliceId,
      HEADER_HEIC,
      { mimeType: "image/heic", width: 4000, height: 3000 },
    );

    await expectRealRejection(
      t.action(internal.photoRotation.rotateAction, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );

    // Geen partial patch: alles staat nog op de oude staat.
    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.storageId).toBe(storageId);
    expect(photo?.exifOrientation).toBeUndefined();
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);

    // Oude blob niet opgeruimd; geen cleanup gescheduled.
    expect(await cleanupScheduled(t)).toHaveLength(0);
    const url = await t.run((ctx) => ctx.storage.getUrl(storageId));
    expect(url).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No-partial-write — bewerking faalt vóór de patch
// ---------------------------------------------------------------------------

describe("rotateAction — geen partial patch bij falen", () => {
  // Dekt de spec-invariant "storage-store-fail → photo blijft in oude staat":
  // elke fout vóór de atomic patch (sharp-bewerking óf store) mag GEEN
  // half-doorgevoerde staat achterlaten. We injecteren de fout in de
  // blob-productie-stap (sharp.toBuffer throwt) — zelfde code-pad vóór de patch.
  it("bewerking throwt vóór de patch → photo ongewijzigd, geen cleanup", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId, storageId } = await seedPhotoWithBytes(
      t,
      aliceId,
      HEADER_JPEG,
      { mimeType: "image/jpeg", width: 4000, height: 3000, exifOrientation: 6 },
    );
    sharpState.failAt = "toBuffer";

    await expectRealRejection(
      t.action(internal.photoRotation.rotateAction, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.storageId).toBe(storageId);
    expect(photo?.exifOrientation).toBe(6);
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);
    expect(await cleanupScheduled(t)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cascade-safe — rotate raakt geen andere entities
// ---------------------------------------------------------------------------

describe("rotateAction — cascade-safe", () => {
  it("ratings / albumPhotos / flagging-state ongemoeid na rotate", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
      width: 4000,
      height: 3000,
    });
    sharpState.metadata = { width: 3000, height: 4000, format: "jpeg" };

    // Seed nevenstaat: rating + albumPhoto + flag.
    const { ratingId, apId } = await t.run(async (ctx) => {
      const groupId = await ctx.db.insert("groups", {
        name: "G",
        createdBy: bobId,
        createdAt: Date.now(),
      });
      const albumId = await ctx.db.insert("albums", {
        groupId,
        name: "A",
        createdBy: bobId,
        createdAt: Date.now(),
      });
      const apId = await ctx.db.insert("albumPhotos", {
        albumId,
        photoId,
        groupId,
        addedAt: Date.now(),
        addedBy: bobId,
      });
      const ratingId = await ctx.db.insert("ratings", {
        photoId,
        userId: bobId,
        value: 4,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.patch(photoId, {
        ratingCount: 1,
        ratingAverage: 4,
        flaggedAt: Date.now(),
        flaggedBy: bobId,
      });
      return { ratingId, apId };
    });

    await t.action(internal.photoRotation.rotateAction, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    const rating = await t.run((ctx) => ctx.db.get(ratingId));
    const ap = await t.run((ctx) => ctx.db.get(apId));

    // Beeld-velden gewijzigd, nevenstaat intact.
    expect(photo?.exifOrientation).toBe(1);
    expect(photo?.ratingCount).toBe(1);
    expect(photo?.ratingAverage).toBe(4);
    expect(typeof photo?.flaggedAt).toBe("number");
    expect(photo?.flaggedBy).toBe(bobId);
    expect(rating?.value).toBe(4);
    expect(ap?.photoId).toBe(photoId);
  });
});

// ---------------------------------------------------------------------------
// Cleanup-race — photo verwijderd vóór de action draait
// ---------------------------------------------------------------------------

describe("rotateAction — cleanup-race", () => {
  it("photo verwijderd → no-op, geen throw", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhotoWithBytes(t, aliceId, HEADER_JPEG, {
      mimeType: "image/jpeg",
    });
    await t.run((ctx) => ctx.db.delete(photoId));

    await expect(
      t.action(internal.photoRotation.rotateAction, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    ).resolves.not.toThrow();
  });
});
