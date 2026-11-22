import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { withUser } from "../_helpers/auth";
import {
  as,
  ENV,
  expectPlayRefusal,
  expectValidR2Signature,
  FIXED_NOW,
  newT,
  outcome,
  parseR2Link,
  seedPhoto,
  seedVideo,
  seedWorld,
  useVideosEnv,
  videosApi,
  type R,
  type T,
} from "./_videos";

// WP37 — afspelen: `videos.playUrl({ photoId })`.
//   Invariant 1 en 2 (WP21-patroon): een kortlevende ondertekende GET, alleen
//   voor wie het beeld van die rij mag zien.
//   A-invariant 17: dezelfde regel als het beeldpad, ook de uitzondering voor
//   de webmaster bij een gemeld filmpje. Per verzoek opnieuw bepaald.
//   A-invariant 18: één weigering. A-invariant 24: toegang vóór config.
//   Besluit B5: 1 uur. Fixronde 1: `response-content-type=video/mp4`.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §Testcontract.

const env = useVideosEnv();
const play = (client: ReturnType<typeof withUser>, photoId: Id<"photos">) => client.action(videosApi.playUrl, { photoId });

async function world(t: T) {
  const w = await seedWorld(t);
  const video = await seedVideo(t, env.r2, { ownerId: w.users.alice, albumId: w.albums.georgie, key: "videos/abc/def.mp4" });
  return { ...w, video };
}

describe("playUrl: de link (B5, A-invariant 11)", () => {
  it("een ondertekende GET op precies de sleutel van dat filmpje, 1 uur", async () => {
    const t = newT();
    const w = await world(t);
    const res = (await play(as.bob(t), w.video.photoId)) as R;
    expect(Object.keys(res).sort()).toEqual(["expiresAt", "url"]);
    const link = parseR2Link(res.url);
    expect(link.bucket).toBe(ENV.R2_BUCKET);
    expect(link.key).toBe("videos/abc/def.mp4");
    await expectValidR2Signature(link, "GET");
    expect(link.expiresS).toBe(3600);
    expect(link.dateMs).toBe(FIXED_NOW);
    expect(res.expiresAt).toBe(FIXED_NOW + 3600 * 1000);
  });

  it("de link zegt R2 het filmpje als video/mp4 te sturen, in de handtekening (fixronde 1)", async () => {
    const t = newT();
    const w = await world(t);
    const link = parseR2Link(((await play(as.bob(t), w.video.photoId)) as R).url);
    expect(link.params["response-content-type"]).toBe("video/mp4");
    // expectValidR2Signature rekent elke query-parameter mee: zonder handtekening erover klopt hij niet.
    await expectValidR2Signature(link, "GET");
    const changed = { ...link, params: { ...link.params, "response-content-type": "text/html" } };
    await expect(expectValidR2Signature(changed, "GET")).rejects.toThrow();
  });

  it("de link is niet bruikbaar voor PUT of een andere sleutel", async () => {
    const t = newT();
    const w = await world(t);
    const link = parseR2Link(((await play(as.bob(t), w.video.photoId)) as R).url);
    await expect(expectValidR2Signature(link, "PUT")).rejects.toThrow();
    const other = { ...link, url: new URL(link.url.href.replace("def.mp4", "xyz.mp4")) };
    await expect(expectValidR2Signature(other, "GET")).rejects.toThrow();
  });

  it("elke aanvraag een verse link", async () => {
    const t = newT();
    const w = await world(t);
    const a = (await play(as.bob(t), w.video.photoId)) as R;
    vi.setSystemTime(FIXED_NOW + 10 * 60 * 1000);
    const b = (await play(as.bob(t), w.video.photoId)) as R;
    expect(b.expiresAt).toBe(a.expiresAt + 10 * 60 * 1000);
  });

  it("geen verzoek naar R2 nodig om te tekenen", async () => {
    const t = newT();
    const w = await world(t);
    await play(as.bob(t), w.video.photoId);
    expect(env.r2.calls).toEqual([]);
  });
});

describe("playUrl: wie mag kijken (A-invariant 17)", () => {
  it("de eigenaar en een lid van de groep", async () => {
    const t = newT();
    const w = await world(t);
    for (const who of [as.alice(t), as.bob(t)]) {
      expect(((await play(who, w.video.photoId)) as R).url).toContain("def.mp4");
    }
  });

  it("de eigenaar ook als het filmpje in geen album meer staat", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const v = await seedVideo(t, env.r2, { ownerId: w.users.alice });
    expect(((await play(as.alice(t), v.photoId)) as R).url).toBeTruthy();
    expectPlayRefusal(await outcome(() => play(as.bob(t), v.photoId)));
  });

  it("een lid van een andere groep en iemand zonder groep niet", async () => {
    const t = newT();
    const w = await world(t);
    expectPlayRefusal(await outcome(() => play(as.dave(t), w.video.photoId)));
    expectPlayRefusal(await outcome(() => play(as.carol(t), w.video.photoId)));
  });

  it("de webmaster niet, tenzij het filmpje gemeld is (zoals het beeldpad, WP20 A-invariant 9)", async () => {
    const t = newT();
    const w = await world(t);
    expectPlayRefusal(await outcome(() => play(as.wm(t), w.video.photoId)));
    await t.run(async (ctx) => ctx.db.patch(w.video.photoId, { flaggedAt: Date.now(), flagReason: "test" }));
    expect(((await play(as.wm(t), w.video.photoId)) as R).url).toContain("def.mp4");
    // Na goedkeuren vervalt de uitzondering.
    await t.run(async (ctx) => ctx.db.patch(w.video.photoId, { flaggedAt: undefined, flagReason: undefined }));
    expectPlayRefusal(await outcome(() => play(as.wm(t), w.video.photoId)));
  });

  it("per verzoek: een ex-lid krijgt meteen geen link meer", async () => {
    const t = newT();
    const w = await world(t);
    expect(((await play(as.bob(t), w.video.photoId)) as R).url).toBeTruthy();
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("memberships")
        .filter((q) => q.and(q.eq(q.field("userId"), w.users.bob), q.eq(q.field("groupId"), w.groups.reis)))
        .first();
      await ctx.db.delete(m!._id);
    });
    expectPlayRefusal(await outcome(() => play(as.bob(t), w.video.photoId)));
  });
});

describe("playUrl: één weigering (A-invariant 18)", () => {
  it("niet ingelogd, geen users-rij, account in verwijdering", async () => {
    const t = newT();
    const w = await world(t);
    expectPlayRefusal(await outcome(() => t.action(videosApi.playUrl, { photoId: w.video.photoId })));
    expectPlayRefusal(await outcome(() => play(withUser(t, "user_onbekend"), w.video.photoId)));
    await t.run(async (ctx) => ctx.db.patch(w.users.bob, { deletion: { startedAt: Date.now() } }));
    expectPlayRefusal(await outcome(() => play(as.bob(t), w.video.photoId)));
  });

  it("een foto (geen filmpje), ook voor de eigenaar", async () => {
    const t = newT();
    const w = await world(t);
    const photoId = await seedPhoto(t, w.users.alice, w.albums.georgie);
    expectPlayRefusal(await outcome(() => play(as.alice(t), photoId)));
  });

  it("een gewist filmpje", async () => {
    const t = newT();
    const w = await world(t);
    await t.run(async (ctx) => ctx.db.delete(w.video.photoId));
    expectPlayRefusal(await outcome(() => play(as.alice(t), w.video.photoId)));
  });

  it("de weigering is overal precies dezelfde fout", async () => {
    const t = newT();
    const w = await world(t);
    const photoId = await seedPhoto(t, w.users.alice, w.albums.georgie);
    const results = [
      await outcome(() => play(as.carol(t), w.video.photoId)),
      await outcome(() => play(as.alice(t), photoId)),
      await outcome(() => t.action(videosApi.playUrl, { photoId: w.video.photoId })),
    ];
    const messages = results.map((r) => ("err" in r ? JSON.stringify(r.err.data) : "ok"));
    expect(new Set(messages).size).toBe(1);
  });
});

describe("playUrl: config (A-invariant 24)", () => {
  it("ontbreekt R2_BUCKET: een lid krijgt R2_CONFIG_MISSING met alleen de naam", async () => {
    const t = newT();
    const w = await world(t);
    delete process.env.R2_BUCKET;
    const o = await outcome(() => play(as.bob(t), w.video.photoId));
    expect("err" in o && o.err.message).toMatch(/R2_CONFIG_MISSING:.*R2_BUCKET/);
    expect(JSON.stringify(o)).not.toContain(ENV.R2_SECRET_ACCESS_KEY);
  });

  it("wie geen toegang heeft, krijgt de gewone weigering, ook zonder config", async () => {
    const t = newT();
    const w = await world(t);
    for (const name of ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[name];
    expectPlayRefusal(await outcome(() => play(as.carol(t), w.video.photoId)));
  });

  it("het geheim staat nooit in de link of in een log", async () => {
    const t = newT();
    const w = await world(t);
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    const res = (await play(as.bob(t), w.video.photoId)) as R;
    expect(res.url).not.toContain(ENV.R2_SECRET_ACCESS_KEY);
    expect(res.url).not.toContain(encodeURIComponent(ENV.R2_SECRET_ACCESS_KEY));
    for (const line of logs) {
      expect(line).not.toContain(ENV.R2_SECRET_ACCESS_KEY);
      expect(line).not.toContain("X-Amz-Signature");
    }
  });
});
