import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";

// ---------------------------------------------------------------------------
// WP8 (EXIF-only) — photos.rotate MUTATION. Sessie A cyclus-2, RED-phase.
//
// Spec: docs/work-packages/WP8-photo-rotation.md (revisie 2026-05-19).
// Geen pixel-rotatie, geen sharp, geen action: een pure isolate-mutation die
// `photos.exifOrientation` herberekent via de 8-staat EXIF-arithmetiek-tabel
// en `width`/`height` swapt bij 90°/270°.
//
// Wat gepind wordt (user-truth, niet impl-vorm):
//   - EXIF-arithmetiek: (huidig 1..8, rotation, flipY) → nieuwe orientation,
//     volgens de canonieke tabel (zie A-revisie in de spec). undefined → 1.
//   - Delta (90×2 = 180) + inverse (90 dan 270 = terug).
//   - width/height-swap UITSLUITEND bij rotation ∈ {90,270}; undefined blijft
//     undefined.
//   - Auth: owner OR group-admin van een publicatie-group; member-zonder-admin
//     / webmaster / niet-ingelogd → reject (A3-verstrakking t.o.v. v1).
//   - Cascade-safe: storageId + alle niet-oriëntatie-velden ongemoeid.
//   - rotation literal-union weigert vrije hoeken.
//
// `api.photos.rotate` bestaat nog niet → RED tot B landt. Negatieve cases
// gebruiken `expectRealRejection` zodat ze niet groen-om-de-verkeerde-reden
// (function-missing) zijn.
// ---------------------------------------------------------------------------

// ──────────────────────────────────────────────────────────────────────────
// Canonieke EXIF-Orientation transitie-tabellen.
//
// WP8-audit bug #10 (5↔7 transpose/transverse-verwisseling): de eerste cyclus
// kopieerde de spec-tabel 1:1 in zowel test als impl → circulaire validatie,
// een group-structuur-behoudende swap overleefde alle delta/inverse-pins.
// Deze tabellen zijn nu ONAFHANKELIJK herleid via de pixel-array-oracle
// hieronder (`oracleOrientation`), NIET uit de spec gekopieerd. De
// `describe("EXIF-tabel vs onafhankelijke array-oracle")` meta-test pint élke
// cel tegen die oracle; de mutation-tests op gespiegelde starts pinnen
// bovendien direct tegen de oracle (audit-track-record §gedeelde-lookup-tabel).
//
// 8 D4-symmetrieën (canonieke EXIF): 1=normaal 2=mirror-H 3=180 4=mirror-V
// 5=transpose 6=90°CW 7=transverse 8=90°CCW. rotation = clockwise; flipY =
// horizontale mirror; combinatie = flip eerst, dan rotatie (matcht oude AWS).
// ──────────────────────────────────────────────────────────────────────────
const ROT0: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
const ROT90: Record<number, number> = { 1: 6, 2: 7, 3: 8, 4: 5, 5: 2, 6: 3, 7: 4, 8: 1 };
const ROT180: Record<number, number> = { 1: 3, 2: 4, 3: 1, 4: 2, 5: 7, 6: 8, 7: 5, 8: 6 };
const ROT270: Record<number, number> = { 1: 8, 2: 5, 3: 6, 4: 7, 5: 4, 6: 1, 7: 2, 8: 3 };
// flip-only (rotation 0, flipY=true)
const FLIP: Record<number, number> = { 1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5, 7: 8, 8: 7 };

const STARTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// ──────────────────────────────────────────────────────────────────────────
// Onafhankelijke pixel-array-oracle (geen spec-tabel, geen impl-import).
//
// We transformeren een volledig-asymmetrisch 2×3 raster en lezen de canonieke
// EXIF-betekenis af. Per orientation O is de "correctie-transform" T_O wat een
// viewer op de OPGESLAGEN pixels toepast om rechtop te tonen:
//   1=identity 2=flipH 3=rot180 4=flipV 5=transpose 6=rot90CW 7=transverse
//   8=rot90CCW
// Een user-actie U op het GETOONDE beeld geeft nieuwe orientation O' met
//   T_{O'} = U ∘ T_O   (flip eerst, dán rotatie — zelfde conventie als impl).
// O' = de orientation waarvan T_{O'}(S) gelijk is aan U(T_O(S)). Omdat S
// volledig asymmetrisch is, is die match uniek. Dit leidt elke cel af uit
// pure array-manipulatie — onafhankelijk van zowel spec als impl-tabel.
// ──────────────────────────────────────────────────────────────────────────
type Grid = number[][];
const ORACLE_S: Grid = [
  [1, 2, 3],
  [4, 5, 6],
];

function gDims(g: Grid): { h: number; w: number } {
  return { h: g.length, w: g[0]!.length };
}
function gIdentity(g: Grid): Grid {
  return g.map((r) => [...r]);
}
function gFlipH(g: Grid): Grid {
  return g.map((r) => [...r].reverse());
}
function gFlipV(g: Grid): Grid {
  return [...g].reverse().map((r) => [...r]);
}
function gRot180(g: Grid): Grid {
  return [...g].reverse().map((r) => [...r].reverse());
}
function gRot90CW(g: Grid): Grid {
  const { h, w } = gDims(g);
  const out: Grid = [];
  for (let i = 0; i < w; i++) {
    const row: number[] = [];
    for (let j = 0; j < h; j++) row.push(g[h - 1 - j]![i]!);
    out.push(row);
  }
  return out;
}
function gRot90CCW(g: Grid): Grid {
  const { h, w } = gDims(g);
  const out: Grid = [];
  for (let i = 0; i < w; i++) {
    const row: number[] = [];
    for (let j = 0; j < h; j++) row.push(g[j]![w - 1 - i]!);
    out.push(row);
  }
  return out;
}
function gTranspose(g: Grid): Grid {
  const { h, w } = gDims(g);
  const out: Grid = [];
  for (let i = 0; i < w; i++) {
    const row: number[] = [];
    for (let j = 0; j < h; j++) row.push(g[j]![i]!);
    out.push(row);
  }
  return out;
}
function gTransverse(g: Grid): Grid {
  const { h, w } = gDims(g);
  const out: Grid = [];
  for (let i = 0; i < w; i++) {
    const row: number[] = [];
    for (let j = 0; j < h; j++) row.push(g[h - 1 - j]![w - 1 - i]!);
    out.push(row);
  }
  return out;
}

// Canonieke correctie-transforms per EXIF-orientation (toegepast op opgeslagen).
const ORACLE_T: Record<number, (g: Grid) => Grid> = {
  1: gIdentity,
  2: gFlipH,
  3: gRot180,
  4: gFlipV,
  5: gTranspose,
  6: gRot90CW,
  7: gTransverse,
  8: gRot90CCW,
};

function gridEqual(a: Grid, b: Grid): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Leid de nieuwe orientation af uit pure pixel-manipulatie.
function oracleOrientation(
  start: number,
  rotation: 0 | 90 | 180 | 270,
  flipY: boolean,
): number {
  let g = ORACLE_T[start]!(ORACLE_S); // huidig getoond beeld
  if (flipY) g = gFlipH(g); // user flipt eerst (horizontale mirror)
  if (rotation === 90) g = gRot90CW(g);
  else if (rotation === 180) g = gRot180(g);
  else if (rotation === 270) g = gRot90CCW(g);
  // rotation 0 = no-op
  for (let o = 1; o <= 8; o++) {
    if (gridEqual(ORACLE_T[o]!(ORACLE_S), g)) return o;
  }
  throw new Error(`oracle: geen matchende orientation voor (${start},${rotation},${flipY})`);
}

// RED-discipline: zolang `api.photos.rotate` ontbreekt rejected elke call met
// "no such export" — een `.rejects.toThrow()` zou dan trivially groen zijn.
// Deze helper eist een ECHTE auth/validation-fout, niet het function-missing-
// artefact.
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

async function seedPhoto(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
  opts: {
    exifOrientation?: number;
    width?: number;
    height?: number;
    mimeType?: string;
  } = {},
): Promise<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> {
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["fake-bytes"])),
  );
  const photoId = await t.run(async (ctx) =>
    ctx.db.insert("photos", {
      ownerId,
      storageId,
      exifOrientation: opts.exifOrientation,
      width: opts.width,
      height: opts.height,
      mimeType: opts.mimeType,
      ratingCount: 0,
      createdAt: Date.now(),
    }),
  );
  return { photoId, storageId };
}

// Publiceer een photo in een group via een album; seed `memberId` met `role`.
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

async function getOrientation(
  t: ReturnType<typeof convexTest>,
  photoId: Id<"photos">,
): Promise<number | undefined> {
  const photo = await t.run((ctx) => ctx.db.get(photoId));
  return photo?.exifOrientation;
}

// ---------------------------------------------------------------------------
// META: literal-tabel vs onafhankelijke array-oracle (geen DB, geen impl).
// Pin't dat de in dit bestand gebruikte tabellen canoniek-EXIF zijn — vangt
// een 5↔7-achtige tabel-typo door A af vóór de mutation-tests erop bouwen.
// ---------------------------------------------------------------------------

describe("EXIF-tabel vs onafhankelijke array-oracle", () => {
  it.each(STARTS)(
    "alle delta's + flip vanaf orientation %i matchen de pixel-oracle",
    (start) => {
      expect(ROT0[start]).toBe(oracleOrientation(start, 0, false));
      expect(ROT90[start]).toBe(oracleOrientation(start, 90, false));
      expect(ROT180[start]).toBe(oracleOrientation(start, 180, false));
      expect(ROT270[start]).toBe(oracleOrientation(start, 270, false));
      expect(FLIP[start]).toBe(oracleOrientation(start, 0, true));
      // combinatie flip+rot90 (volgorde: flip eerst)
      expect(ROT90[FLIP[start]!]).toBe(oracleOrientation(start, 90, true));
    },
  );

  it("oracle bevestigt canonieke 5=transpose / 7=transverse (audit #10 cel-check)", () => {
    // De swap zat hier: rotate(90) op een gespiegelde start moet via transverse,
    // niet transpose. Hard-gepinde canonieke uitkomsten (geen tabel-ref).
    expect(oracleOrientation(2, 90, false)).toBe(7); // mirror-H + 90CW = transverse
    expect(oracleOrientation(4, 90, false)).toBe(5); // mirror-V + 90CW = transpose
    expect(oracleOrientation(5, 90, false)).toBe(2);
    expect(oracleOrientation(7, 90, false)).toBe(4);
    expect(oracleOrientation(1, 0, true)).toBe(2); // flipH op normaal = mirror-H
    expect(oracleOrientation(5, 0, true)).toBe(6); // transpose + flipH = 90CW
  });
});

// ---------------------------------------------------------------------------
// MUTATION × onafhankelijke oracle — gespiegelde starts (audit #10)
//
// Pin de ECHTE mutation tegen de pixel-array-oracle, NIET tegen de lokale
// tabel. Gespiegelde starts (2,4,5,7) zijn waar de 5↔7-swap zat; dit is de
// niet-circulaire vangst die de eerste cyclus miste.
// ---------------------------------------------------------------------------

describe("photos.rotate × pixel-oracle (gespiegelde starts, audit #10)", () => {
  const MIRRORED = [2, 4, 5, 7] as const;

  it.each(MIRRORED)(
    "rotate(90) vanaf gespiegelde orientation %i = oracle-uitkomst",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      });

      expect(await getOrientation(t, photoId)).toBe(
        oracleOrientation(start, 90, false),
      );
    },
  );

  it("flipY + rotate(90) vanaf 1 = oracle (flipY-feature trap uit audit)", async () => {
    // 1 → flipH → 2 → rotate 90 CW. Canoniek = 7 (transverse). De buggy impl
    // gaf 5 (transpose). Tegen de oracle, niet de tabel.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: true,
    });

    expect(await getOrientation(t, photoId)).toBe(oracleOrientation(1, 90, true));
  });

  it("front-camera upload (orientation 2 binnen) overleeft rotate canoniek", async () => {
    // Audit: extractMetadata leest tags.Orientation 1:1; gespiegelde/front-camera
    // bestanden komen als 2 binnen. Twee rotate(90)-calls = 180-equivalent en
    // moeten via de oracle kloppen, niet via een self-consistente foute tabel.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 2 });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });
    expect(await getOrientation(t, photoId)).toBe(oracleOrientation(2, 90, false));

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });
    expect(await getOrientation(t, photoId)).toBe(oracleOrientation(2, 180, false));
  });
});

// ---------------------------------------------------------------------------
// EXIF-arithmetiek — alle 8 startwaarden per delta
// ---------------------------------------------------------------------------

describe("photos.rotate — EXIF-arithmetiek tabel", () => {
  it.each(STARTS)(
    "rotate(90) vanaf orientation %i → tabelwaarde",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      });

      expect(await getOrientation(t, photoId)).toBe(ROT90[start]);
    },
  );

  it.each(STARTS)(
    "rotate(180) vanaf orientation %i → tabelwaarde",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 180,
        flipY: false,
      });

      expect(await getOrientation(t, photoId)).toBe(ROT180[start]);
    },
  );

  it.each(STARTS)(
    "rotate(270) vanaf orientation %i → tabelwaarde",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 270,
        flipY: false,
      });

      expect(await getOrientation(t, photoId)).toBe(ROT270[start]);
    },
  );

  it.each(STARTS)(
    "rotate(0) vanaf orientation %i → ongewijzigd (no-op rotatie)",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 0,
        flipY: false,
      });

      expect(await getOrientation(t, photoId)).toBe(ROT0[start]);
    },
  );

  it.each(STARTS)(
    "flip-only (rotation 0, flipY) vanaf orientation %i → mirror-tabelwaarde",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 0,
        flipY: true,
      });

      expect(await getOrientation(t, photoId)).toBe(FLIP[start]);
    },
  );

  it.each(STARTS)(
    "combinatie flipY + rotate(90) vanaf orientation %i → flip-dan-rotatie (volgorde-pin)",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: true,
      });

      // Volgorde: flip eerst, dán rotatie (matcht oude AWS). Andersom zou een
      // andere uitkomst geven — deze test pint de volgorde.
      expect(await getOrientation(t, photoId)).toBe(ROT90[FLIP[start]!]);
    },
  );
});

// ---------------------------------------------------------------------------
// undefined exifOrientation → behandeld als 1 (normaal)
// ---------------------------------------------------------------------------

describe("photos.rotate — undefined orientation default = 1", () => {
  it("undefined + rotate(90) → 6 (= tabel vanaf 1)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId); // exifOrientation undefined

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    expect(await getOrientation(t, photoId)).toBe(ROT90[1]); // 6
  });

  it("undefined + rotate(270) → 8", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId);

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 270,
      flipY: false,
    });

    expect(await getOrientation(t, photoId)).toBe(ROT270[1]); // 8
  });

  it("undefined + flip-only → 2", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId);

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 0,
      flipY: true,
    });

    expect(await getOrientation(t, photoId)).toBe(FLIP[1]); // 2
  });
});

// ---------------------------------------------------------------------------
// Delta-semantiek + inverse
// ---------------------------------------------------------------------------

describe("photos.rotate — delta + inverse", () => {
  it.each(STARTS)(
    "rotate(90) tweemaal = rotate(180) vanaf orientation %i",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      });
      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      });

      expect(await getOrientation(t, photoId)).toBe(ROT180[start]);
    },
  );

  it.each(STARTS)(
    "rotate(90) daarna rotate(270) → terug bij orientation %i (inverse)",
    async (start) => {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId } = await seedPhoto(t, aliceId, {
        exifOrientation: start,
      });

      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      });
      await withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 270,
        flipY: false,
      });

      expect(await getOrientation(t, photoId)).toBe(start);
    },
  );

  it("flip-only tweemaal → terug bij start (mirror is eigen inverse)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 6 });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 0,
      flipY: true,
    });
    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 0,
      flipY: true,
    });

    expect(await getOrientation(t, photoId)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// width/height-swap
// ---------------------------------------------------------------------------

describe("photos.rotate — width/height swap", () => {
  it("rotate(90) → dims geswapt in DB", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, {
      exifOrientation: 1,
      width: 4000,
      height: 3000,
    });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(3000);
    expect(photo?.height).toBe(4000);
  });

  it("rotate(270) → dims geswapt", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, {
      exifOrientation: 1,
      width: 4000,
      height: 3000,
    });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 270,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(3000);
    expect(photo?.height).toBe(4000);
  });

  it("rotate(180) → dims ongewijzigd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, {
      exifOrientation: 1,
      width: 4000,
      height: 3000,
    });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 180,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);
  });

  it("rotate(0) → dims ongewijzigd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, {
      exifOrientation: 1,
      width: 4000,
      height: 3000,
    });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 0,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);
  });

  it("flip-only (rotation 0, flipY) → dims ongewijzigd (mirror swapt niet)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, {
      exifOrientation: 1,
      width: 4000,
      height: 3000,
    });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 0,
      flipY: true,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(4000);
    expect(photo?.height).toBe(3000);
  });

  it("flipY + rotate(90) → dims geswapt (rotatie bepaalt swap, niet de flip)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, {
      exifOrientation: 1,
      width: 4000,
      height: 3000,
    });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: true,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBe(3000);
    expect(photo?.height).toBe(4000);
  });

  it("dims undefined + rotate(90) → blijven undefined (geen verzonnen waarden)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.width).toBeUndefined();
    expect(photo?.height).toBeUndefined();
    // Orientation wel bijgewerkt ook al ontbreken dims.
    expect(photo?.exifOrientation).toBe(ROT90[1]);
  });
});

// ---------------------------------------------------------------------------
// Auth-boundary: owner OR group-admin
// ---------------------------------------------------------------------------

describe("photos.rotate — auth-boundary", () => {
  it("owner mag eigen foto roteren", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    expect(await getOrientation(t, photoId)).toBe(ROT90[1]);
  });

  it("group-admin van publicatie-group mag andermans foto roteren", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });
    await publishInGroupWithMember(t, photoId, bobId, bobId, "admin");

    await withUser(t, "user_bob").mutation(api.photos.rotate, {
      photoId,
      rotation: 180,
      flipY: false,
    });

    expect(await getOrientation(t, photoId)).toBe(ROT180[1]);
  });

  it("member-zonder-admin → geweigerd, orientation ongewijzigd (A3)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });
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
    expect(await getOrientation(t, photoId)).toBe(1);
  });

  it("admin van een group waar de foto NIET gepubliceerd staat → geweigerd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const daveId = await registerUser(t, "user_dave", "d@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });

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
    expect(await getOrientation(t, photoId)).toBe(1);
  });

  it("webmaster (geen owner/admin) → geweigerd (geen backdoor)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_wm", "wm@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });

    await expectRealRejection(
      withUser(t, "user_wm", "wm@x.com").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
    expect(await getOrientation(t, photoId)).toBe(1);
  });

  it("niet-ingelogd → geweigerd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });

    await expectRealRejection(
      t.mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
    expect(await getOrientation(t, photoId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bestaan + argument-validation
// ---------------------------------------------------------------------------

describe("photos.rotate — guards", () => {
  it("onbekende photoId → throw", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId);
    await t.run((ctx) => ctx.db.delete(photoId));

    await expectRealRejection(
      withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        rotation: 90,
        flipY: false,
      }),
    );
  });

  it("rotation buiten {0,90,180,270} (45) → afgewezen door validator", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const { photoId } = await seedPhoto(t, aliceId, { exifOrientation: 1 });

    await expectRealRejection(
      withUser(t, "user_alice").mutation(api.photos.rotate, {
        photoId,
        // Bewust ongeldige hoek — de literal-union moet 'm weigeren.
        rotation: 45 as unknown as 0,
        flipY: false,
      }),
    );
    expect(await getOrientation(t, photoId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cascade-safe — rotate raakt alleen orientation + dims
// ---------------------------------------------------------------------------

describe("photos.rotate — cascade-safe", () => {
  it("storageId + alle niet-oriëntatie-velden ongemoeid na rotate", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["fake-bytes"])),
    );
    const now = Date.now();
    const photoId = await t.run(async (ctx) =>
      ctx.db.insert("photos", {
        ownerId: aliceId,
        storageId,
        mimeType: "image/jpeg",
        width: 4000,
        height: 3000,
        exifOrientation: 1,
        takenAt: 1700000000000,
        latitude: 52.37,
        longitude: 4.89,
        locationLabel: "Amsterdam, Nederland",
        ratingAverage: 4,
        ratingCount: 3,
        flaggedAt: now,
        flaggedBy: bobId,
        createdAt: now,
      }),
    );

    await withUser(t, "user_alice").mutation(api.photos.rotate, {
      photoId,
      rotation: 90,
      flipY: false,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    // Gewijzigd: orientation + dims-swap.
    expect(photo?.exifOrientation).toBe(ROT90[1]);
    expect(photo?.width).toBe(3000);
    expect(photo?.height).toBe(4000);
    // Ongemoeid: bestand + alle nevenstaat.
    expect(photo?.storageId).toBe(storageId);
    expect(photo?.takenAt).toBe(1700000000000);
    expect(photo?.latitude).toBe(52.37);
    expect(photo?.longitude).toBe(4.89);
    expect(photo?.locationLabel).toBe("Amsterdam, Nederland");
    expect(photo?.ratingAverage).toBe(4);
    expect(photo?.ratingCount).toBe(3);
    expect(photo?.flaggedAt).toBe(now);
    expect(photo?.flaggedBy).toBe(bobId);
  });
});
