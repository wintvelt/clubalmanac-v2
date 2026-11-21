import { describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { withUser } from "../_helpers/auth";
import { concat, gpsAnywhere, GPS_JPEG, isJpeg } from "../_helpers/jpeg";
import { movie } from "./_boxes";
import {
  as,
  DAY_MS,
  ENV,
  expectUploadRefusal,
  expectValidR2Signature,
  FINAL_PREFIX,
  finish,
  FIXED_NOW,
  fixture,
  fullUpload,
  leftovers,
  MAX_VIDEO_BYTES_ORACLE,
  newT,
  outcome,
  parseR2Link,
  PLAIN,
  POSTER,
  putAsApp,
  r2SignatureProblem,
  seedWorld,
  start,
  TMP_PREFIX,
  useVideosEnv,
  videosApi,
  type R,
  type T,
} from "./_videos";

// WP37 — een filmpje toevoegen: aanvragen (`videos.startUpload`), de PUT naar
// R2 door de app, en afronden met de poster (`POST /upload/video`).
//   Invariant 1, 4, 5, 7; A-invariant 11, 12, 14, 15, 20, 24, 25, 30, 32.
// De tijdelijke sleutel en wat een oude link nog kan: tempKey.test.ts. Wat er
// na de index mag staan: afterIndex.test.ts.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §Testcontract.

/** A-invariant 30: de duur van plain.mp4 is de langste in het bestand (mdhd van het geluid, 91136/44100 s). */
const PLAIN_MS = 2067;

const env = useVideosEnv();
const r2 = () => env.r2;

async function rowOf(t: T, photoId: string): Promise<R | null> {
  return (await t.run(async (ctx) => ctx.db.get(photoId as Id<"photos">))) as R | null;
}

// --- aanvragen ------------------------------------------------------------------

describe("startUpload: een link voor precies één nieuwe sleutel (A-invariant 11)", () => {
  it("geeft een ondertekende PUT op een tijdelijke sleutel onder uploads/, hooguit een uur geldig", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const res = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    expect(res.kind).toBe("upload");
    expect(Object.keys(res).sort()).toEqual(["expiresAt", "kind", "url"]);
    const link = parseR2Link(res.url);
    expect(link.bucket).toBe(ENV.R2_BUCKET);
    expect(link.key.startsWith(TMP_PREFIX), link.key).toBe(true);
    await expectValidR2Signature(link, "PUT", PLAIN.byteLength);
    expect(link.expiresS).toBeGreaterThan(0);
    expect(link.expiresS).toBeLessThanOrEqual(3600);
    expect(link.dateMs).toBe(FIXED_NOW);
    expect(res.expiresAt).toBe(link.dateMs + link.expiresS * 1000);
  });

  it("de handtekening legt content-length vast op de opgegeven grootte (A-invariant 11)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const res = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie, bytes: 4_000_000 })) as R;
    const link = parseR2Link(res.url);
    expect(link.params["X-Amz-SignedHeaders"]).toBe("content-length;host");
    expect(await r2SignatureProblem(link, "PUT", 4_000_000)).toBeNull();
    expect(await r2SignatureProblem(link, "PUT", 4_000_001)).not.toBeNull();
    expect(await r2SignatureProblem(link, "PUT", 5 * 1024 ** 3)).not.toBeNull();
    expect(await r2SignatureProblem(link, "PUT")).not.toBeNull();
  });

  it("de link geldt niet voor GET (de handtekening dekt de methode)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const res = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    await expect(expectValidR2Signature(parseR2Link(res.url), "GET")).rejects.toThrow();
  });

  it("de sleutel komt van de backend: niet de upload-id, niet het user-id, per upload anders", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = parseR2Link(((await start(as.alice(t), { uploadId: "mijn-id-123", albumId: w.albums.georgie })) as R).url).key;
    const b = parseR2Link(((await start(as.alice(t), { uploadId: "mijn-id-456", albumId: w.albums.georgie })) as R).url).key;
    expect(a).not.toBe(b);
    for (const key of [a, b]) {
      expect(key).not.toContain("mijn-id");
      expect(key).not.toContain(w.users.alice);
      expect(key).not.toContain(w.albums.georgie);
      expect(key.length).toBeGreaterThanOrEqual(16);
    }
  });

  it("start schrijft niets in R2 en maakt geen rij (A-invariant 12)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie });
    expect(r2().objects.size).toBe(0);
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photos).toBe(0);
    expect(left.reservations).toBe(1);
  });
});

describe("startUpload: dezelfde upload-id (invariant 4, A-invariant 20)", () => {
  it("nog open: dezelfde sleutel, een verse link", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const first = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    vi.setSystemTime(FIXED_NOW + 20 * 60 * 1000);
    const second = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    expect(second.kind).toBe("upload");
    expect(parseR2Link(second.url).key).toBe(parseR2Link(first.url).key);
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt);
    expect((await leftovers(t, r2(), w.users.alice)).reservations).toBe(1);
  });

  it("een ander lid met dezelfde upload-id krijgt een eigen sleutel", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const a = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const b = (await start(as.bob(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    expect(parseR2Link(b.url).key).not.toBe(parseR2Link(a.url).key);
  });

  it("al afgerond: dezelfde rij terug, geen nieuwe link", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res } = await fullUpload(as.alice(t), r2(), { uploadId: "v1", albumId: w.albums.georgie });
    const { photoId } = (await res.json()) as R;
    const again = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    expect(again).toEqual({ kind: "done", photoId });
    expect((await leftovers(t, r2(), w.users.alice)).photos).toBe(1);
  });

  it("al afgerond maar uit het album gehaald: weer in het album (zoals WP18 A-invariant 24)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res } = await fullUpload(as.alice(t), r2(), { uploadId: "v1", albumId: w.albums.georgie });
    const { photoId } = (await res.json()) as R;
    await t.run(async (ctx) => {
      for (const ap of await ctx.db.query("albumPhotos").collect()) await ctx.db.delete(ap._id);
    });
    await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie });
    const placed = await t.run(async (ctx) => ctx.db.query("albumPhotos").collect());
    expect(placed.map((p) => [p.albumId, p.photoId])).toEqual([[w.albums.georgie, photoId]]);
  });

  it("hooguit 3 open video-uploads per user; de vierde is 'bezig'", async () => {
    const t = newT();
    const w = await seedWorld(t);
    for (const id of ["a", "b", "c"]) await start(as.alice(t), { uploadId: id, albumId: w.albums.georgie });
    expectUploadRefusal(await outcome(() => start(as.alice(t), { uploadId: "d", albumId: w.albums.georgie })), "bezig");
    // Een herhaling van een open upload telt niet als nieuwe.
    const again = (await start(as.alice(t), { uploadId: "a", albumId: w.albums.georgie })) as R;
    expect(again.kind).toBe("upload");
    // Een ander lid heeft zijn eigen ruimte.
    expect(((await start(as.bob(t), { uploadId: "d", albumId: w.albums.georgie })) as R).kind).toBe("upload");
    expect((await leftovers(t, r2(), w.users.alice)).reservations).toBe(4);
  });
});

describe("startUpload: weigeringen (invariant 1, 5, 7)", () => {
  async function expectNothingLeft(t: T, ownerId: Id<"users">) {
    const left = await leftovers(t, r2(), ownerId);
    expect(left.reservations).toBe(0);
    expect(left.photos).toBe(0);
    expect(left.r2).toBe(0);
  }

  it("niet ingelogd: uitgelogd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // Geen users-rij bij deze identiteit, en helemaal geen identiteit.
    expectUploadRefusal(await outcome(() => start(withUser(t, "user_onbekend"), { uploadId: "v1", albumId: w.albums.georgie })), "uitgelogd");
    expectUploadRefusal(
      await outcome(() =>
        t.action(videosApi.startUpload, { uploadId: "v1", albumId: w.albums.georgie, durationMs: 2000, bytes: PLAIN.byteLength }),
      ),
      "uitgelogd",
    );
    expect((await t.run(async (ctx) => ctx.db.query("uploadIdempotency").collect())).length).toBe(0);
  });

  it("een album van een groep waar de caller geen lid van is: geen_album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expectUploadRefusal(await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.elders })), "geen_album");
    expectUploadRefusal(await outcome(() => start(as.carol(t), { uploadId: "v1", albumId: w.albums.georgie })), "geen_album");
    await expectNothingLeft(t, w.users.alice);
    await expectNothingLeft(t, w.users.carol);
  });

  it("een gewist album: geen_album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => ctx.db.delete(w.albums.georgie));
    expectUploadRefusal(await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })), "geen_album");
    await expectNothingLeft(t, w.users.alice);
  });

  it("langer dan 3:00 (afgerond): te_lang; 3:00,499 mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expectUploadRefusal(
      await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie, durationMs: 180_500 })),
      "te_lang",
    );
    await expectNothingLeft(t, w.users.alice);
    const ok = (await start(as.alice(t), { uploadId: "v2", albumId: w.albums.georgie, durationMs: 180_499 })) as R;
    expect(ok.kind).toBe("upload");
  });

  it("groter dan 120 MiB: te_groot; precies 120 MiB mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expectUploadRefusal(
      await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie, bytes: MAX_VIDEO_BYTES_ORACLE + 1 })),
      "te_groot",
    );
    await expectNothingLeft(t, w.users.alice);
    const ok = (await start(as.alice(t), { uploadId: "v2", albumId: w.albums.georgie, bytes: MAX_VIDEO_BYTES_ORACLE })) as R;
    expect(ok.kind).toBe("upload");
  });

  it.each([0, -1, Number.NaN])("een onzinnige duur (%s) of grootte wordt geweigerd", async (n) => {
    const t = newT();
    const w = await seedWorld(t);
    const a = await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie, durationMs: n }));
    const b = await outcome(() => start(as.alice(t), { uploadId: "v2", albumId: w.albums.georgie, bytes: n }));
    for (const o of [a, b]) {
      expect("err" in o && (o.err.data as R | undefined)?.code, JSON.stringify(o)).toBe("VIDEO_UPLOAD_REFUSED");
    }
    await expectNothingLeft(t, w.users.alice);
  });

  it("op de limiet: limiet (een filmpje telt als één, besluit B7)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.alice, { photoCount: 1000, photoLimit: 1000 }));
    expectUploadRefusal(await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })), "limiet");
    await expectNothingLeft(t, w.users.alice);
  });

  it("account in verwijdering: uitgelogd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => ctx.db.patch(w.users.alice, { deletion: { startedAt: Date.now() } }));
    expectUploadRefusal(await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })), "uitgelogd");
    await expectNothingLeft(t, w.users.alice);
  });

  it("R2-config ontbreekt: een lid krijgt R2_CONFIG_MISSING met alleen de namen; een niet-lid de gewone weigering (A-invariant 24)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    delete process.env.R2_SECRET_ACCESS_KEY;
    const member = await outcome(() => start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie }));
    expect("err" in member && member.err.message).toMatch(/R2_CONFIG_MISSING:.*R2_SECRET_ACCESS_KEY/);
    const stranger = await outcome(() => start(as.carol(t), { uploadId: "v1", albumId: w.albums.georgie }));
    expectUploadRefusal(stranger, "geen_album");
    const all = JSON.stringify([member, stranger]);
    expect(all).not.toContain(ENV.R2_ACCESS_KEY_ID);
  });
});

// --- afronden ------------------------------------------------------------------------

describe("POST /upload/video: afronden (A-invariant 12, 14)", () => {
  it("200 met het photoId; de rij is een filmpje met de poster als beeld, in het album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await fullUpload(as.alice(t), r2(), {
      uploadId: "v1",
      albumId: w.albums.georgie,
      headers: { "X-Taken-At": "2026:07:14 15:32:10", "X-Latitude": "41.7151", "X-Longitude": "44.8271" },
    });
    expect(res.status).toBe(200);
    const { photoId } = (await res.json()) as R;
    const row = (await rowOf(t, photoId))!;
    expect(row.ownerId).toBe(w.users.alice);
    // A-invariant 11, 12: de rij heeft de eindsleutel, niet de sleutel van de PUT.
    expect(row.video.key.startsWith(FINAL_PREFIX), row.video.key).toBe(true);
    expect(row.video.key).not.toBe(key);
    expect(row.video).toEqual({ key: row.video.key, durationMs: PLAIN_MS, bytes: PLAIN.byteLength });
    expect(r2().keys()).toEqual([row.video.key]);
    expect(r2().bytesOf(row.video.key)).toEqual(PLAIN);
    // A-invariant 14: de kloktijd van de opname, gelezen als UTC (zoals foto's).
    expect(row.takenAt).toBe(Date.UTC(2026, 6, 14, 15, 32, 10));
    expect(row.latitude).toBe(41.7151);
    expect(row.longitude).toBe(44.8271);
    // convex-test kan geen Blob over de t.run-grens teruggeven: de bytes lezen binnen de closure.
    const posterStart = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(row.storageId);
      return blob ? Array.from(new Uint8Array(await blob.arrayBuffer()).subarray(0, 3)) : null;
    });
    expect(posterStart).toEqual([0xff, 0xd8, 0xff]);
    const placed = await t.run(async (ctx) => ctx.db.query("albumPhotos").collect());
    expect(placed.map((p) => [p.albumId, p.photoId, p.addedBy])).toEqual([[w.albums.georgie, photoId, w.users.alice]]);
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photoCount).toBe(1);
    expect(left.r2).toBe(1);
    const reservation = (await t.run(async (ctx) => ctx.db.query("uploadIdempotency").first())) as R;
    expect(reservation.status).toBe("completed");
    expect(reservation.photoId).toBe(photoId);
  });

  it("de duur in de rij komt uit het bestand, niet uit de aanvraag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res } = await fullUpload(as.alice(t), r2(), { uploadId: "v1", albumId: w.albums.georgie, durationMs: 9000 });
    const { photoId } = (await res.json()) as R;
    expect((await rowOf(t, photoId))!.video.durationMs).toBe(PLAIN_MS);
  });

  it("zonder datum en plaats: geen takenAt (niet 'nu') en geen plek (invariant 3)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res } = await fullUpload(as.alice(t), r2(), { uploadId: "v1", albumId: w.albums.georgie });
    const row = (await rowOf(t, ((await res.json()) as R).photoId))!;
    expect(row.takenAt).toBeUndefined();
    expect(row.latitude).toBeUndefined();
    expect(row.longitude).toBeUndefined();
  });

  it("nog een keer afronden: dezelfde rij, niets dubbel (invariant 4)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res } = await fullUpload(as.alice(t), r2(), { uploadId: "v1", albumId: w.albums.georgie });
    const first = (await res.json()) as R;
    const again = await finish(as.alice(t), { uploadId: "v1" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photos).toBe(1);
    expect(left.photoCount).toBe(1);
    expect(left.albumPhotos).toBe(1);
  });

  it("opnieuw PUT na een mislukte poging gaat naar dezelfde sleutel (één bestand)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s1 = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    // Halverwege afgebroken: R2 slaat een PUT met minder bytes dan ondertekend niet op.
    expect(await r2().putViaLink(s1.url, PLAIN.subarray(0, 500))).toBe(403);
    expect(r2().objects.size).toBe(0);
    const s2 = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    expect(parseR2Link(s2.url).key).toBe(parseR2Link(s1.url).key);
    await putAsApp(r2(), s2.url, PLAIN);
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(res.status).toBe(200);
    expect(r2().objects.size).toBe(1);
  });
});

describe("POST /upload/video: wat er niet in mag (invariant 2, 7, A-invariant 12, 13, 25)", () => {
  async function upload(t: T, albumId: Id<"albums">, file: Uint8Array) {
    return await fullUpload(as.alice(t), r2(), { uploadId: "v1", albumId, file });
  }
  async function expectRefusedAndGone(t: T, ownerId: Id<"users">, res: Response, key: string, status: number, reason?: string) {
    expect(res.status).toBe(status);
    if (reason) expect(((await res.json()) as R).reason).toBe(reason);
    expect(r2().objects.has(key)).toBe(false);
    expect(r2().deletes()).toContain(key);
    const left = await leftovers(t, r2(), ownerId);
    expect(left.photos).toBe(0);
    expect(left.reservations).toBe(0);
    expect(left.photoCount).toBe(0);
    expect(left.albumPhotos).toBe(0);
    expect(left.storage).toBe(0);
  }

  it("met een locatie (loci): 422 locatie, object en reservering weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await upload(t, w.albums.georgie, fixture("location-loci.mp4"));
    await expectRefusedAndGone(t, w.users.alice, res, key, 422, "locatie");
  });

  it("QuickTime met ©xyz: 422", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await upload(t, w.albums.georgie, fixture("iphone-like.mov"));
    expect(res.status).toBe(422);
    expect(r2().objects.has(key)).toBe(false);
  });

  it("HEVC: 422 codec", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await upload(t, w.albums.georgie, fixture("hevc.mp4"));
    await expectRefusedAndGone(t, w.users.alice, res, key, 422, "codec");
  });

  it("index achteraan: 422 index_achteraan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await upload(t, w.albums.georgie, fixture("moov-at-end.mp4"));
    await expectRefusedAndGone(t, w.users.alice, res, key, 422, "index_achteraan");
  });

  it("geen video (een JPEG als 'filmpje'): 422 geen_mp4", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await upload(t, w.albums.georgie, POSTER);
    await expectRefusedAndGone(t, w.users.alice, res, key, 422, "geen_mp4");
  });

  it("korter opgegeven dan het is: het bestand duurt 4 minuten → 422 te_lang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const long = movie({ timescale: 1000, duration: 240_000 });
    const { res, key } = await upload(t, w.albums.georgie, long);
    await expectRefusedAndGone(t, w.users.alice, res, key, 422, "te_lang");
  });

  it("het object in R2 is groter dan 120 MiB: 413, object weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const key = await putAsApp(r2(), s.url, PLAIN);
    r2().sizes.set(key, MAX_VIDEO_BYTES_ORACLE + 1);
    const res = await finish(as.alice(t), { uploadId: "v1" });
    await expectRefusedAndGone(t, w.users.alice, res, key, 413);
  });

  it("het object staat er (nog) niet: 409 niet_binnen; de reservering blijft zodat de app opnieuw kan PUT-ten", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie });
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as R).reason).toBe("niet_binnen");
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photos).toBe(0);
    expect(left.reservations).toBe(1);
    expect(left.storage).toBe(0);
  });

  it("poster geen JPEG: 415, geen rij; het filmpje blijft voor een nieuwe poging", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const key = await putAsApp(r2(), s.url, PLAIN);
    const res = await finish(as.alice(t), { uploadId: "v1", poster: new TextEncoder().encode("<svg/>") });
    expect(res.status).toBe(415);
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photos).toBe(0);
    expect(left.storage).toBe(0);
    expect(r2().objects.has(key)).toBe(true);
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(200);
  });

  it("R2 onbereikbaar bij afronden: een serverfout, geen rij, niets gewist", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const key = await putAsApp(r2(), s.url, PLAIN);
    r2().down = true;
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(res.status).toBeGreaterThanOrEqual(500);
    r2().down = false;
    expect(r2().objects.has(key)).toBe(true);
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photos).toBe(0);
    expect(left.reservations).toBe(1);
  });
});

/** Een weigering van de route zelf, niet de 404 van de router voor een onbekend pad (A-invariant 32: met reden). */
async function expectRouteRefusal(res: Response, status: number, reason?: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type") ?? "").toMatch(/application\/json/);
  const body = (await res.json()) as R;
  expect(typeof body.error).toBe("string");
  if (reason !== undefined) expect(body.reason).toBe(reason);
}

describe("POST /upload/video: wie mag afronden (invariant 1)", () => {
  it("zonder X-Upload-Id: 400", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await as.alice(t).fetch("/upload/video", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: POSTER as BodyInit });
    expect(res.status).toBe(400);
  });

  it("niet ingelogd: 401", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await t.fetch("/upload/video", { method: "POST", headers: { "X-Upload-Id": "v1" }, body: POSTER as BodyInit });
    expect(res.status).toBe(401);
  });

  it("een onbekende upload-id: 404 van de route zelf (JSON met een fout, geen 'route bestaat niet')", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await finish(as.alice(t), { uploadId: "bestaat-niet" });
    await expectRouteRefusal(res, 404, "verlopen");
  });

  it("de upload-id van een ander: 404, en zijn upload blijft onaangeroerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const key = await putAsApp(r2(), s.url, PLAIN);
    await expectRouteRefusal(await finish(as.bob(t), { uploadId: "v1" }), 404, "verlopen");
    expect(r2().objects.has(key)).toBe(true);
    expect((await leftovers(t, r2(), w.users.bob)).photos).toBe(0);
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(200);
  });

  it("geen lid meer van de groep tussen aanvragen en afronden: 404, object en reservering weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.bob(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const key = await putAsApp(r2(), s.url, PLAIN);
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("memberships")
        .filter((q) => q.and(q.eq(q.field("userId"), w.users.bob), q.eq(q.field("groupId"), w.groups.reis)))
        .first();
      await ctx.db.delete(m!._id);
    });
    const res = await finish(as.bob(t), { uploadId: "v1" });
    await expectRouteRefusal(res, 404, "geen_album");
    expect(r2().objects.has(key)).toBe(false);
    const left = await leftovers(t, r2(), w.users.bob);
    expect(left.photos).toBe(0);
    expect(left.reservations).toBe(0);
  });

  it("op de limiet geraakt tussen aanvragen en afronden: 403, geen rij", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    await putAsApp(r2(), s.url, PLAIN);
    await t.run(async (ctx) => ctx.db.patch(w.users.alice, { photoCount: 1000, photoLimit: 1000 }));
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(res.status).toBe(403);
    expect((await leftovers(t, r2(), w.users.alice)).photos).toBe(0);
  });

  it("een foto-reservering van /upload is geen video-upload: 404", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) =>
      ctx.db.insert("uploadIdempotency", { ownerId: w.users.alice, clientUploadId: "foto-1", status: "in_progress", createdAt: Date.now() }),
    );
    await expectRouteRefusal(await finish(as.alice(t), { uploadId: "foto-1" }), 404, "verlopen");
    expect((await leftovers(t, r2(), w.users.alice)).photos).toBe(0);
  });

  it("de backend leest alleen het begin van het filmpje, met een ondertekend verzoek", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { res, key } = await fullUpload(as.alice(t), r2(), { uploadId: "v1", albumId: w.albums.georgie });
    expect(res.status).toBe(200);
    const reads = r2().calls.filter((c) => c.key === key && c.method === "GET");
    expect(reads.length).toBeGreaterThan(0);
    // A-invariant 31: elke GET heeft een begrensde Range (ook de koppen na de index).
    for (const c of reads) expect(c.range, "een GET zonder grens leest het hele filmpje").toMatch(/^bytes=\d+-\d+$/);
    for (const c of r2().calls) expect(c.signed).toBe(true);
  });
});

describe("POST /upload/video: na een dag is een open upload weg", () => {
  it("afronden na de opruimronde: 404", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    await putAsApp(r2(), s.url, PLAIN);
    vi.setSystemTime(FIXED_NOW + DAY_MS + 60_000);
    await t.mutation(internal.uploads.cleanupOld, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expectRouteRefusal(await finish(as.alice(t), { uploadId: "v1" }), 404, "verlopen");
    expect(r2().objects.size).toBe(0);
  });

  it("afronden na een dag, ook zonder opruimronde: 404 verlopen, geen rij (audit: vervalcheck in finishState)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    await putAsApp(r2(), s.url, PLAIN);
    vi.setSystemTime(FIXED_NOW + DAY_MS + 60_000);
    await expectRouteRefusal(await finish(as.alice(t), { uploadId: "v1" }), 404, "verlopen");
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photos).toBe(0);
    expect(left.storage).toBe(0);
    expect(left.albumPhotos).toBe(0);
  });

  it("net binnen de dag: afronden lukt nog", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    await putAsApp(r2(), s.url, PLAIN);
    vi.setSystemTime(FIXED_NOW + DAY_MS - 60_000);
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(200);
  });
});

// --- testgaten uit de audit (fixronde 1) ----------------------------------------

describe("foto- en video-uploads met dezelfde upload-id (A-invariant 20)", () => {
  it("een foto-upload (POST /upload) met de id van een open video-upload: 409, de video-upload blijft", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const before = (await t.run(async (ctx) => ctx.db.query("uploadIdempotency").collect())) as R[];
    const res = await as.alice(t).fetch("/upload", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Upload-Id": "v1", "X-Album-Id": w.albums.georgie },
      body: POSTER as BodyInit,
    });
    expect(res.status).toBe(409);
    const after = (await t.run(async (ctx) => ctx.db.query("uploadIdempotency").collect())) as R[];
    expect(after).toEqual(before);
    expect((await leftovers(t, r2(), w.users.alice)).photos).toBe(0);
    // En de video-upload rondt gewoon af.
    await putAsApp(r2(), s.url, PLAIN);
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(200);
  });

  it("een video-aanvraag met de id van een lopende foto-upload: bezig, de foto-reservering blijft", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) =>
      ctx.db.insert("uploadIdempotency", { ownerId: w.users.alice, clientUploadId: "foto-1", status: "in_progress", createdAt: Date.now() }),
    );
    expectUploadRefusal(await outcome(() => start(as.alice(t), { uploadId: "foto-1", albumId: w.albums.georgie })), "bezig");
    const rows = (await t.run(async (ctx) => ctx.db.query("uploadIdempotency").collect())) as R[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.videoKey).toBeUndefined();
    expect(r2().calls).toEqual([]);
  });
});

describe("de poster (A-invariant 15)", () => {
  it("een poster met GPS in de EXIF wordt zonder metadata opgeslagen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(gpsAnywhere(GPS_JPEG), "sanity: de test-JPEG heeft GPS").toBeGreaterThan(0);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    await putAsApp(r2(), s.url, PLAIN);
    const res = await finish(as.alice(t), { uploadId: "v1", poster: GPS_JPEG });
    expect(res.status).toBe(200);
    const row = (await rowOf(t, ((await res.json()) as R).photoId))!;
    // convex-test geeft geen Blob over de t.run-grens: de bytes binnen de closure lezen.
    const stored = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(row.storageId);
      return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : null;
    });
    expect(stored).not.toBeNull();
    const bytes = new Uint8Array(stored!);
    expect(isJpeg(bytes)).toBe(true);
    expect(gpsAnywhere(bytes)).toBe(0);
    expect(new TextDecoder("latin1").decode(bytes)).not.toMatch(/Exif\0\0/);
  });

  it("een poster boven 15 MiB: 400, geen rij en niets opgeslagen; het filmpje blijft voor een nieuwe poging", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const key = await putAsApp(r2(), s.url, PLAIN);
    const big = concat(POSTER, new Uint8Array(15 * 1024 * 1024 + 1 - POSTER.byteLength));
    expect(big.byteLength).toBe(15 * 1024 * 1024 + 1);
    const res = await finish(as.alice(t), { uploadId: "v1", poster: big });
    expect(res.status).toBe(400);
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.photos).toBe(0);
    expect(left.storage).toBe(0);
    expect(left.reservations).toBe(1);
    expect(r2().objects.has(key)).toBe(true);
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(200);
  });
});
