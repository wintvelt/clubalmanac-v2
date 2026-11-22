import { describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import {
  as,
  DAY_MS,
  ENV,
  FINAL_PREFIX,
  finish,
  FIXED_NOW,
  fixture,
  HOUR_MS,
  leftovers,
  newT,
  parseR2Link,
  PLAIN,
  putAsApp,
  seedWorld,
  start,
  TMP_PREFIX,
  useVideosEnv,
  videoKeyOf,
  videosApi,
  type R,
  type T,
} from "./_videos";

// WP37 fixronde 1, punt 1 (audit en red-team, hoog): TOCTOU en wees-objecten.
//   Vroeger bleef de PUT-link een uur geldig op de sleutel die in de rij kwam.
//   Na de 200 kon een lid daarmee een ander bestand op het filmpje zetten (met
//   GPS, langer dan 3 minuten, tot 5 GB), en na een weigering steeds opnieuw een
//   wees van 5 GB.
//   A-invariant 11: de app PUT naar `uploads/…`, met `content-length` in de
//   handtekening. A-invariant 12: na de controle een CopyObject naar een
//   eindsleutel (`videos/…`) waarvoor nooit een PUT is getekend, alleen als het
//   object nog hetzelfde is (if-match op de ETag), en dan de tijdelijke weg.
//   A-invariant 20: de lifecycle-regel op `uploads/` (runbook) ruimt de rest op.
// De nep-R2 (`_videos.ts`) doet CopyObject zoals S3, weigert een niet
// ondertekende `x-amz-*`-header, en `putViaLink` toetst een PUT met een oude
// link zoals R2: handtekening met precies deze grootte, niet verlopen.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten 11, 12, 20.

const env = useVideosEnv();
const r2 = () => env.r2;

/** Een ander bestand van precies dezelfde grootte als PLAIN (de handtekening laat alleen die grootte toe). */
function sameSizeOther(): Uint8Array {
  const other = fixture("location-loci.mp4");
  const out = new Uint8Array(PLAIN.byteLength);
  out.set(other.subarray(0, Math.min(other.byteLength, out.byteLength)));
  return out;
}

async function uploaded(t: T) {
  const w = await seedWorld(t);
  const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
  const tmp = await putAsApp(r2(), s.url, PLAIN);
  const res = await finish(as.alice(t), { uploadId: "v1" });
  expect(res.status).toBe(200);
  const { photoId } = (await res.json()) as R;
  return { w, url: s.url as string, tmp, photoId: photoId as string };
}

describe("de eindsleutel (A-invariant 11, 12)", () => {
  it("na de 200: het filmpje staat onder videos/, de tijdelijke sleutel is weg", async () => {
    const t = newT();
    const { tmp, photoId } = await uploaded(t);
    expect(tmp.startsWith(TMP_PREFIX)).toBe(true);
    const final = await videoKeyOf(t, photoId);
    expect(final.startsWith(FINAL_PREFIX)).toBe(true);
    expect(r2().keys()).toEqual([final]);
    expect(r2().bytesOf(final)).toEqual(PLAIN);
    expect(r2().deletes()).toContain(tmp);
  });

  it("de kopie is een CopyObject van de tijdelijke sleutel, met if-match op de ETag van wat de backend bekeek", async () => {
    const t = newT();
    const { tmp, photoId } = await uploaded(t);
    const final = await videoKeyOf(t, photoId);
    const copies = r2().copies();
    expect(copies).toHaveLength(1);
    const c = copies[0]!;
    expect(c.key).toBe(final);
    expect(decodeURIComponent(c.copySource!).replace(/^\//, "")).toBe(`${ENV.R2_BUCKET}/${tmp}`);
    expect(c.copyIfMatch, "zonder if-match kan het object tussen controle en kopie wisselen").toBeTruthy();
    expect(c.signed).toBe(true);
  });

  it("de eindsleutel staat in geen enkele link die de app krijgt; elke herhaling geeft weer de tijdelijke", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const links: string[] = [];
    for (const id of ["a", "b"]) {
      const s = (await start(as.alice(t), { uploadId: id, albumId: w.albums.georgie })) as R;
      links.push(s.url);
      await putAsApp(r2(), s.url, PLAIN);
      expect((await finish(as.alice(t), { uploadId: id })).status).toBe(200);
    }
    const finals = await t.run(async (ctx) => (await ctx.db.query("photos").collect()).map((p) => (p as R).video.key as string));
    for (const url of links) {
      const key = parseR2Link(url).key;
      expect(key.startsWith(TMP_PREFIX)).toBe(true);
      expect(finals).not.toContain(key);
    }
  });
});

describe("een oude PUT-link na afronden (TOCTOU)", () => {
  it("een tweede PUT met de oude link na de 200 verandert het afgespeelde object niet", async () => {
    const t = newT();
    const { url, tmp, photoId } = await uploaded(t);
    const other = sameSizeOther();
    // Binnen het uur, met precies de ondertekende grootte: R2 neemt hem aan, maar op de tijdelijke sleutel.
    vi.setSystemTime(FIXED_NOW + 10 * 60 * 1000);
    expect(await r2().putViaLink(url, other)).toBe(200);
    expect(r2().bytesOf(tmp)).toEqual(other);

    const play = (await as.bob(t).action(videosApi.playUrl, { photoId: photoId as never })) as R;
    const played = parseR2Link(play.url).key;
    expect(played).toBe(await videoKeyOf(t, photoId));
    expect(played).not.toBe(tmp);
    expect(r2().bytesOf(played)).toEqual(PLAIN);
  });

  it("een groter bestand met de oude link weigert R2 al (content-length in de handtekening)", async () => {
    const t = newT();
    const { url, tmp } = await uploaded(t);
    const bigger = new Uint8Array(PLAIN.byteLength + 1);
    expect(await r2().putViaLink(url, bigger)).toBe(403);
    expect(r2().objects.has(tmp)).toBe(false);
  });

  it("de link verloopt na 15 minuten (fixronde 2)", async () => {
    const t = newT();
    const { url } = await uploaded(t);
    vi.setSystemTime(FIXED_NOW + 15 * 60 * 1000 + 1000);
    expect(await r2().putViaLink(url, PLAIN)).toBe(403);
    vi.setSystemTime(FIXED_NOW + HOUR_MS);
    expect(await r2().putViaLink(url, PLAIN)).toBe(403);
  });
});

describe("een oude PUT-link na een weigering (wees-objecten)", () => {
  it("na een 422 levert een PUT met de oude link hooguit een object onder uploads/ op, geen rij", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const file = fixture("location-loci.mp4");
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie, bytes: file.byteLength })) as R;
    await putAsApp(r2(), s.url, file);
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(res.status).toBe(422);
    expect(r2().objects.size).toBe(0);

    // De link is nog geldig: iemand zet opnieuw hetzelfde aantal bytes neer.
    expect(await r2().putViaLink(s.url, new Uint8Array(file.byteLength))).toBe(200);
    expect(r2().keys()).toHaveLength(1);
    for (const k of r2().keys()) expect(k.startsWith(TMP_PREFIX), k).toBe(true);
    expect((await leftovers(t, r2(), w.users.alice)).photos).toBe(0);
    // Afronden met dezelfde id kan niet meer: de reservering is weg.
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(404);
    expect(r2().copies()).toEqual([]);
  });

  it("een veel groter bestand met de oude link na een weigering: R2 weigert (de grootte staat in de handtekening)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    await putAsApp(r2(), s.url, fixture("hevc.mp4").subarray(0, PLAIN.byteLength));
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(422);
    expect(await r2().putViaLink(s.url, new Uint8Array(PLAIN.byteLength * 4))).toBe(403);
    expect(r2().objects.size).toBe(0);
  });
});

describe("wisselen tussen controle en kopie", () => {
  it("wordt het object na het lezen vervangen, dan komt het niet in het album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const tmp = await putAsApp(r2(), s.url, PLAIN);
    const other = sameSizeOther();
    let swapped = false;
    r2().onGet = (key) => {
      if (key === tmp && !swapped) {
        swapped = true;
        r2().put(tmp, other);
      }
    };
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(swapped, "sanity: de backend las het object").toBe(true);
    const rows = await t.run(async (ctx) => ctx.db.query("photos").collect());
    if (res.status === 200) {
      // Alleen goed als wat in het album staat precies is wat de backend bekeek.
      const final = (rows[0] as R).video.key as string;
      expect(r2().bytesOf(final)).toEqual(PLAIN);
    } else {
      expect(rows).toHaveLength(0);
      for (const k of r2().keys()) expect(k.startsWith(TMP_PREFIX), k).toBe(true);
    }
  });
});

describe("opruimen onder uploads/", () => {
  it("de opruimronde wist het tijdelijke object van een verlopen upload", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
    const tmp = await putAsApp(r2(), s.url, PLAIN);
    vi.setSystemTime(FIXED_NOW + DAY_MS + 60_000);
    await t.mutation(internal.uploads.cleanupOld, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(r2().objects.has(tmp)).toBe(false);
  });
});

// --- fixronde 2: de kopie en het opruimen (A-invariant 12) ---------------------

/** De ondertekende headers van een verzoek: uit de query, of uit de Authorization-header. */
function signedHeadersOf(c: { url: string; headers: Record<string, string> }): string[] {
  const fromQuery = new URL(c.url).searchParams.get("X-Amz-SignedHeaders");
  const fromAuth = /SignedHeaders=([^,\s]+)/.exec(c.headers["authorization"] ?? "")?.[1];
  return (fromQuery ?? fromAuth ?? "").toLowerCase().split(";").filter(Boolean);
}

async function startAndPut(t: T) {
  const w = await seedWorld(t);
  const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie })) as R;
  const tmp = await putAsApp(r2(), s.url, PLAIN);
  return { w, tmp };
}

async function nothingUnderVideos(t: T) {
  for (const k of r2().keys()) expect(k.startsWith(FINAL_PREFIX), `wees onder videos/: ${k}`).toBe(false);
  expect(await t.run(async (ctx) => ctx.db.query("photos").collect())).toHaveLength(0);
}

describe("de CopyObject zet het type opnieuw (fixronde 2)", () => {
  it("x-amz-metadata-directive REPLACE en content-type video/mp4, allebei ondertekend; het filmpje is video/mp4", async () => {
    const t = newT();
    const { photoId } = await uploaded(t);
    const c = r2().copies()[0]!;
    expect(c.headers["x-amz-metadata-directive"]).toBe("REPLACE");
    expect(c.headers["content-type"]).toBe("video/mp4");
    const signed = signedHeadersOf(c);
    expect(signed).toContain("x-amz-metadata-directive");
    expect(signed).toContain("content-type");
    expect(signed).toContain("x-amz-copy-source");
    expect(signed).toContain("x-amz-copy-source-if-match");
    expect(r2().contentTypeOf(await videoKeyOf(t, photoId))).toBe("video/mp4");
  });
});

describe("volgorde: eerst de rij, dan de tijdelijke sleutel wissen (fixronde 2)", () => {
  it("op het moment dat de tijdelijke sleutel gewist wordt, staat de rij er al", async () => {
    const t = newT();
    const { tmp } = await startAndPut(t);
    const rowsAtDelete: number[] = [];
    r2().beforeRequest = async (c) => {
      if (c.method === "DELETE" && c.key === tmp) {
        rowsAtDelete.push((await t.run(async (ctx) => ctx.db.query("photos").collect())).length);
      }
    };
    expect((await finish(as.alice(t), { uploadId: "v1" })).status).toBe(200);
    expect(rowsAtDelete, "de tijdelijke sleutel is niet gewist").not.toEqual([]);
    expect(rowsAtDelete.every((n) => n === 1), `rijen bij het wissen: ${rowsAtDelete.join(",")}`).toBe(true);
  });
});

describe("een fout na de CopyObject: de eindsleutel gaat weer weg (fixronde 2)", () => {
  it.each<["lost" | "noResult", string]>([
    ["lost", "het antwoord van de kopie komt niet aan"],
    ["noResult", "het antwoord bevat geen CopyObjectResult"],
  ])("%s (%s): geen rij en geen object onder videos/", async (mode) => {
    const t = newT();
    await startAndPut(t);
    r2().copyMode = mode;
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(res.status).not.toBe(200);
    const copied = r2().copies().map((c) => c.key!);
    expect(copied).toHaveLength(1);
    expect(r2().deletes(), "de eindsleutel is niet gewist").toContain(copied[0]);
    await nothingUnderVideos(t);
  });

  it.each<["limiet" | "lid", number]>([
    ["limiet", 403],
    ["lid", 404],
  ])("de rij mislukt na de kopie (%s weg tijdens het bekijken): geen sleutel onder videos/ en geen reservering (NS2)", async (what, status) => {
    const t = newT();
    const { w, tmp } = await startAndPut(t);
    let done = false;
    r2().onGet = async (key) => {
      if (key !== tmp || done) return;
      done = true;
      await t.run(async (ctx) => {
        if (what === "limiet") {
          await ctx.db.patch(w.users.alice, { photoCount: 1000, photoLimit: 1000 });
        } else {
          const m = await ctx.db
            .query("memberships")
            .filter((q) => q.and(q.eq(q.field("userId"), w.users.alice), q.eq(q.field("groupId"), w.groups.reis)))
            .first();
          await ctx.db.delete(m!._id);
        }
      });
    };
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(done, "sanity: de backend las het object").toBe(true);
    expect(res.status).toBe(status);
    expect(r2().copies().length, "sanity: de kopie gebeurde (anders test dit niets)").toBe(1);
    await nothingUnderVideos(t);
    const left = await leftovers(t, r2(), w.users.alice);
    expect(left.reservations).toBe(0);
    expect(left.storage).toBe(0);
  });
});

describe("een HEAD zonder ETag laat niets door (fixronde 2)", () => {
  it("geen 200, geen kopie, geen rij", async () => {
    const t = newT();
    await startAndPut(t);
    r2().headWithoutEtag = true;
    const res = await finish(as.alice(t), { uploadId: "v1" });
    expect(res.status).not.toBe(200);
    expect(r2().copies()).toEqual([]);
    await nothingUnderVideos(t);
  });
});
