import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id, TableNames } from "../../convex/_generated/dataModel";
import { collectDriftLines } from "../../convex/monitoring";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { upload } from "../http/_upload";

// WP29 — account verwijderen. Spec: docs/work-packages/WP29-account-verwijderen.md
// §Spec-criticus aanvullingen (A-invarianten 1–7 en 9; 8 staat in
// deleteAccountScale.test.ts).
//
// Het verwijderen loopt in stappen via de scheduler en verwijdert ook de
// Clerk-user (Backend API). De tests pinnen wat er direct na `deleteSelf` geldt
// (nog niets gepland gedraaid, fake timers) en wat er geldt als alle geplande
// stappen klaar zijn (`finishAllScheduledFunctions`). Hoe de stappen heten of
// hoe groot ze zijn, pinnen ze niet.
//
// Alle tests draaien met de echte Convex-limieten (`transactionLimits`).
//
// Wereld: Rex verwijdert zijn account.
// - G: oprichter Rex; Olga (admin, eerst), Anna (admin), Lex (lid). Album AG
//   van Rex. Rex' foto pr1 (cover van G en AG, gerated door Anna), Olga's foto
//   po1 (gerated door Rex en Anna, gemeld door Rex).
// - K: oprichter Rex, enige admin; Mia en Lex lid → M2-c.
// - S: alleen Rex → M2-e. Album AS met pr1.
// - H: oprichter Olga, Rex lid. Album AH van Rex, met pr2 (Rex, met formaten)
//   en po1, door Rex toegevoegd (gemigreerd).
// - Rex: losse profielfoto (geen foto-rij), reserveringen, bezoek,
//   albumLastSeen, features, upvotes, uitnodigingen van en aan hem. Zijn adres
//   staat met hoofdletters in de users-rij (gemigreerd), de uitnodigingen
//   genormaliseerd.

const KEY = "sk_test_wp29";
const WEBMASTER = "webmaster@x.test";
const INFO_SENDER = "info@clubalmanac.com";
const CLERK_URL = "https://api.clerk.com/v1/users/user_rex";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const REX_EMAIL_RAW = "Rex@X.test";
const REX_EMAIL = "rex@x.test";

const retryRef = (
  internal as unknown as {
    users: {
      retryAccountDeletion: FunctionReference<"mutation", "internal", { userId: Id<"users"> }>;
    };
  }
).users.retryAccountDeletion;

const newT = () => convexTest({ schema, modules, transactionLimits: true });
type T = ReturnType<typeof newT>;
const rex = (t: T) => withUser(t, "user_rex");

// ── fetch: Clerk en Mailjet ──────────────────────────────────────────

type ClerkCall = { url: string; method: string; auth: string | null; at: number };
type Net = { clerk: ClerkCall[]; mails: Array<{ to: string[]; text: string }> };

/** `clerkStatus(n)` geeft de status voor de n-de Clerk-aanroep (0-based). */
function stubNet(clerkStatus: (n: number) => number = () => 200): Net {
  const net: Net = { clerk: [], mails: [] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (url.startsWith("https://api.clerk.com/")) {
      const status = clerkStatus(net.clerk.length);
      net.clerk.push({ url, method: (init?.method ?? "GET").toUpperCase(), auth: headers.get("authorization"), at: Date.now() });
      const body = status === 200 ? { id: "user_rex", object: "user", deleted: true } : { errors: [{ code: "x" }] };
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("api.mailjet.com")) {
      const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        Messages?: Array<{ To?: Array<{ Email?: string }>; Subject?: string; TextPart?: string; HTMLPart?: string }>;
      };
      for (const m of payload.Messages ?? []) {
        net.mails.push({
          to: (m.To ?? []).map((x) => (x.Email ?? "").toLowerCase()),
          text: `${m.Subject ?? ""}\n${m.TextPart ?? ""}\n${m.HTMLPart ?? ""}`,
        });
      }
      return new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), { status: 200 });
    }
    throw new Error(`onverwachte fetch: ${url}`);
  });
  return net;
}

const successfulDeletes = (net: Net) => net.clerk.filter((c) => c.method === "DELETE");

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CLERK_SECRET_KEY = KEY;
  process.env.WEBMASTER_EMAILS = WEBMASTER;
  process.env.MAILJET_VERIFIED_SENDERS = INFO_SENDER;
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  process.env.CLUBALMANAC_STAGE = "dev";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of ["CLERK_SECRET_KEY", "WEBMASTER_EMAILS", "MAILJET_VERIFIED_SENDERS", "MAILJET_API_KEY", "MAILJET_API_SECRET", "CLUBALMANAC_STAGE"]) {
    delete process.env[k];
  }
});

const finish = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

// ── wereld ───────────────────────────────────────────────────────────

async function world(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const blob = (s: string) => ctx.storage.store(new Blob([s], { type: "image/jpeg" }));
    const user = (key: string, email = `${key}@x.test`, extra: object = {}) =>
      ctx.db.insert("users", { subject: `user_${key}`, email, name: key, photoCount: 0, photoLimit: 1000, createdAt: now, ...extra });

    const looseProfile = await blob("losse profielfoto");
    const rexId = await user("rex", REX_EMAIL_RAW, { profilePhotoStorageId: looseProfile, photoCount: 2 });
    const olga = await user("olga", "olga@x.test", { photoCount: 1 });
    const anna = await user("anna");
    const lex = await user("lex");
    const mia = await user("mia");

    const member = (userId: Id<"users">, groupId: Id<"groups">, role: "admin" | "member", joinedAt: number) =>
      ctx.db.insert("memberships", { userId, groupId, role, joinedAt });

    const G = await ctx.db.insert("groups", { name: "G", createdBy: rexId, createdAt: now });
    await member(rexId, G, "admin", now);
    await member(olga, G, "admin", now + 1);
    await member(anna, G, "admin", now + 2);
    await member(lex, G, "member", now + 3);

    const K = await ctx.db.insert("groups", { name: "K", createdBy: rexId, createdAt: now });
    await member(rexId, K, "admin", now);
    await member(mia, K, "member", now + 1);
    await member(lex, K, "member", now + 2);

    const S = await ctx.db.insert("groups", { name: "S", createdBy: rexId, createdAt: now });
    await member(rexId, S, "admin", now);

    const H = await ctx.db.insert("groups", { name: "H", createdBy: olga, createdAt: now });
    await member(olga, H, "admin", now);
    await member(rexId, H, "member", now + 1);

    const AG = await ctx.db.insert("albums", { groupId: G, name: "AG", createdBy: rexId, createdAt: now });
    const AS = await ctx.db.insert("albums", { groupId: S, name: "AS", createdBy: rexId, createdAt: now });
    const AH = await ctx.db.insert("albums", { groupId: H, name: "AH", createdBy: rexId, createdAt: now });

    const pr1Blob = await blob("pr1");
    const pr1 = await ctx.db.insert("photos", { ownerId: rexId, storageId: pr1Blob, ratingCount: 1, ratingAverage: 4, createdAt: now });
    const pr2Blob = await blob("pr2");
    const klein = await blob("pr2 klein");
    const groot = await blob("pr2 groot");
    const pr2 = await ctx.db.insert("photos", { ownerId: rexId, storageId: pr2Blob, formats: { klein, groot }, ratingCount: 0, createdAt: now });
    const po1Blob = await blob("po1");
    const po1 = await ctx.db.insert("photos", {
      ownerId: olga,
      storageId: po1Blob,
      noFormatsAcceptedAt: now,
      ratingCount: 2,
      ratingAverage: 3,
      flaggedAt: now,
      flaggedBy: rexId,
      flagReason: "x",
      flaggedDeleteDate: now + 14 * DAY,
      createdAt: now,
    });

    const pub = (albumId: Id<"albums">, photoId: Id<"photos">, groupId: Id<"groups">, addedBy: Id<"users">) =>
      ctx.db.insert("albumPhotos", { albumId, photoId, groupId, addedAt: now, addedBy });
    await pub(AG, pr1, G, rexId);
    await pub(AG, po1, G, olga);
    await pub(AS, pr1, S, rexId);
    await pub(AH, pr2, H, rexId);
    const po1InH = await pub(AH, po1, H, rexId);
    await ctx.db.patch(G, { coverPhotoId: pr1 });
    await ctx.db.patch(AG, { coverPhotoId: pr1 });

    const rate = (photoId: Id<"photos">, userId: Id<"users">, value: number) =>
      ctx.db.insert("ratings", { photoId, userId, value, createdAt: now, updatedAt: now });
    await rate(pr1, anna, 4);
    await rate(po1, rexId, 2);
    await rate(po1, anna, 4);

    await ctx.db.insert("uploadIdempotency", { ownerId: rexId, clientUploadId: "r1", status: "completed", photoId: pr1, createdAt: now, completedAt: now });
    await ctx.db.insert("uploadIdempotency", { ownerId: rexId, clientUploadId: "r2", status: "in_progress", createdAt: now });
    await ctx.db.insert("userVisits", { userId: rexId, lastVisitAt: now });
    await ctx.db.insert("albumLastSeen", { userId: rexId, albumId: AG, lastSeenAt: now });
    await ctx.db.insert("albumLastSeen", { userId: rexId, albumId: AH, lastSeenAt: now });
    await ctx.db.insert("albumLastSeen", { userId: anna, albumId: AG, lastSeenAt: now });

    const feature = (submittedBy: Id<"users">, type: "feature" | "problem", upvoteCount: number) =>
      ctx.db.insert("features", { type, title: "t", description: "d", submittedBy, status: "open", upvoteCount, createdAt: now });
    const rexFeature = await feature(rexId, "feature", 1);
    await feature(rexId, "problem", 0);
    const olgaFeature = await feature(olga, "feature", 2);
    await ctx.db.insert("featureUpvotes", { featureId: rexFeature, userId: olga, createdAt: now });
    await ctx.db.insert("featureUpvotes", { featureId: olgaFeature, userId: rexId, createdAt: now });
    await ctx.db.insert("featureUpvotes", { featureId: olgaFeature, userId: anna, createdAt: now });

    const invite = (
      email: string,
      invitedBy: Id<"users">,
      status: "pending" | "accepted" | "declined" | "expired",
      groupId?: Id<"groups">,
    ) =>
      ctx.db.insert("invites", {
        email,
        invitedBy,
        ...(groupId ? { groupId, role: "member" as const } : {}),
        token: crypto.randomUUID(),
        status,
        expiresAt: now + 14 * DAY,
        createdAt: now,
      });
    await invite("nieuw@x.test", rexId, "pending", G);
    await invite("nieuw2@x.test", rexId, "pending");
    await invite("anna@x.test", rexId, "accepted", G);
    await invite("weg@x.test", rexId, "declined", K);
    await invite(REX_EMAIL, olga, "accepted", H);
    await invite(REX_EMAIL, olga, "pending");
    await invite(REX_EMAIL, anna, "expired", G);
    const olgaToLex = await invite("lex@x.test", olga, "pending", H);

    return {
      rex: rexId, olga, anna, lex, mia, G, K, S, H, AG, AS, AH, pr1, pr2, po1, po1InH,
      blobs: { looseProfile, pr1Blob, pr2Blob, klein, groot, po1Blob },
      rexFeature, olgaFeature, olgaToLex,
    };
  });
}
type W = Awaited<ReturnType<typeof world>>;

/** Elk document in elke tabel waarin Rex' id, subject of adres voorkomt. */
async function tracesOfRex(t: T, w: W): Promise<string[]> {
  const needles = [w.rex as string, "user_rex", REX_EMAIL];
  const out: string[] = [];
  for (const table of Object.keys(schema.tables) as TableNames[]) {
    const docs = await t.run(async (ctx) => ctx.db.query(table).collect());
    for (const doc of docs) {
      const json = JSON.stringify(doc).toLowerCase();
      if (needles.some((n) => json.includes(n.toLowerCase()))) out.push(`${table}/${doc._id}`);
    }
  }
  return out;
}

const drift = (t: T) => t.run(async (ctx) => await collectDriftLines(ctx));
const get = <Tb extends TableNames>(t: T, id: Id<Tb>) => t.run(async (ctx) => await ctx.db.get(id));
const storageGone = async (t: T, id: Id<"_storage">) => (await t.run((ctx) => ctx.storage.getUrl(id))) === null;
const usersWithSubject = (t: T, subject: string) =>
  t.run(async (ctx) => ctx.db.query("users").withIndex("by_subject", (q) => q.eq("subject", subject)).collect());

async function membershipsOf(t: T, groupId: Id<"groups">) {
  return await t.run(async (ctx) =>
    ctx.db.query("memberships").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect(),
  );
}

// ── A-invariant 1 en 2: direct afgesloten ────────────────────────────

describe("WP29 A-invariant 1 — direct na deleteSelf is het account afgesloten", () => {
  it("users.current en users.profile geven null", async () => {
    const t = newT();
    await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    expect(await rex(t).query(api.users.current, {})).toBeNull();
    expect(await rex(t).query(api.users.profile, {})).toBeNull();
  });

  it("mutations weigeren, en er verandert niets", async () => {
    const t = newT();
    const w = await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});

    await expect(rex(t).mutation(api.groups.create, { name: "Nieuw" })).rejects.toThrow();
    await expect(rex(t).mutation(api.ratings.upsert, { photoId: w.po1, value: 5 })).rejects.toThrow();
    await expect(rex(t).mutation(api.users.updateProfile, { name: "Ander" })).rejects.toThrow();
    await expect(rex(t).mutation(api.users.recordVisit, {})).rejects.toThrow();

    const groups = await t.run(async (ctx) => ctx.db.query("groups").collect());
    expect(groups.map((g) => g.name)).not.toContain("Nieuw");
    const rating = await t.run(async (ctx) =>
      ctx.db.query("ratings").withIndex("by_photo_and_user", (q) => q.eq("photoId", w.po1).eq("userId", w.rex)).unique(),
    );
    expect(rating?.value ?? null).not.toBe(5);
  });

  it("een upload weigert en maakt geen foto", async () => {
    const t = newT();
    const w = await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    const before = await t.run(async (ctx) => (await ctx.db.query("photos").collect()).length);

    const res = await upload(t, "user_rex", { uploadId: "na-afsluiten", headers: { "X-Album-Id": w.AH } });

    expect(res.status).not.toBe(200);
    const after = await t.run(async (ctx) => (await ctx.db.query("photos").collect()).length);
    expect(after).toBeLessThanOrEqual(before);
    await finish(t);
    expect(await tracesOfRex(t, w)).toEqual([]);
  });

  it("nog een keer deleteSelf geeft geen fout en verwijdert de Clerk-user één keer", async () => {
    const t = newT();
    await world(t);
    const net = stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);
    expect(successfulDeletes(net)).toHaveLength(1);
  });

  it("de integriteitscheck meldt een account dat net wordt verwijderd niet", async () => {
    const t = newT();
    const w = await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    expect((await drift(t)).filter((l) => l.startsWith(`users/${w.rex}`))).toEqual([]);
  });

  it("zonder login weigert deleteSelf", async () => {
    const t = newT();
    await world(t);
    stubNet();
    await expect(t.mutation(api.users.deleteSelf, {})).rejects.toThrow();
  });
});

describe("WP29 A-invariant 2 — geen nieuwe rij voor dezelfde Clerk-user", () => {
  it("de webhook maakt tijdens het verwijderen geen users-rij", async () => {
    const t = newT();
    await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});

    try {
      await t.mutation(internal.users.registerFromSession, { subject: "user_rex", email: REX_EMAIL });
    } catch {
      // Weigeren mag; een nieuwe rij niet.
    }
    expect((await usersWithSubject(t, "user_rex")).length).toBeLessThanOrEqual(1);
    expect(await rex(t).query(api.users.current, {})).toBeNull();
  });

  it("na afloop begint dat adres met een nieuwe Clerk-user als nieuw", async () => {
    const t = newT();
    await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    const fresh = await t.mutation(internal.users.registerFromSession, { subject: "user_rex_nieuw", email: REX_EMAIL });
    const row = await get(t, fresh);
    expect(row?.photoCount).toBe(0);
    expect(row?.profilePhotoStorageId).toBeUndefined();
    const ms = await t.run(async (ctx) =>
      ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", fresh)).collect(),
    );
    expect(ms).toEqual([]);
  });
});

// ── A-invariant 3, 4, 6, 9: alles weg, anderen kloppen ───────────────

describe("WP29 A-invariant 3 — alles van hem weg", () => {
  it("geen document noemt nog zijn id, subject of adres; de integriteitscheck is schoon", async () => {
    const t = newT();
    const w = await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    expect(await tracesOfRex(t, w)).toEqual([]);
    expect(await drift(t)).toEqual([]);
  });

  it("zijn beelden zijn uit storage: originelen, formaten en de losse profielfoto; die van Olga blijft", async () => {
    const t = newT();
    const w = await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    for (const id of [w.blobs.pr1Blob, w.blobs.pr2Blob, w.blobs.klein, w.blobs.groot, w.blobs.looseProfile]) {
      expect(await storageGone(t, id), id).toBe(true);
    }
    expect(await storageGone(t, w.blobs.po1Blob)).toBe(false);
  });

  it("er blijft niets gepland staan", async () => {
    const t = newT();
    await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);
    const pending = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (f) => f.state.kind === "pending" || f.state.kind === "inProgress",
      ),
    );
    expect(pending).toEqual([]);
  });
});

describe("WP29 A-invariant 4 — wat van anderen is, blijft en klopt", () => {
  async function done() {
    const t = newT();
    const w = await world(t);
    const net = stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);
    return { t, w, net };
  }

  it("G: Olga (vroegste admin) wordt oprichter; rollen blijven; zijn album krijgt Olga als maker; de cover is weg", async () => {
    const { t, w } = await done();
    const G = await get(t, w.G);
    expect(G?.createdBy).toBe(w.olga);
    expect(G?.coverPhotoId).toBeUndefined();
    const roles = new Map((await membershipsOf(t, w.G)).map((m) => [m.userId, m.role]));
    expect(roles).toEqual(new Map([[w.olga, "admin"], [w.anna, "admin"], [w.lex, "member"]]));
    const AG = await get(t, w.AG);
    expect(AG?.createdBy).toBe(w.olga);
    expect(AG?.coverPhotoId).toBeUndefined();
  });

  it("K: hij was de enige admin → Mia en Lex admin, Mia (vroegste) oprichter (M2-c, M2-d)", async () => {
    const { t, w } = await done();
    expect((await get(t, w.K))?.createdBy).toBe(w.mia);
    const roles = new Map((await membershipsOf(t, w.K)).map((m) => [m.userId, m.role]));
    expect(roles).toEqual(new Map([[w.mia, "admin"], [w.lex, "admin"]]));
  });

  it("S: hij was het laatste lid → groep, album en publicaties weg (M2-e)", async () => {
    const { t, w } = await done();
    expect(await get(t, w.S)).toBeNull();
    expect(await get(t, w.AS)).toBeNull();
    const pubs = await t.run(async (ctx) =>
      ctx.db.query("albumPhotos").withIndex("by_group", (q) => q.eq("groupId", w.S)).collect(),
    );
    expect(pubs).toEqual([]);
  });

  it("H: Olga blijft oprichter; album AH krijgt Olga als maker; po1 blijft in AH, toegevoegd door Olga; pr2 is weg", async () => {
    const { t, w } = await done();
    expect((await get(t, w.H))?.createdBy).toBe(w.olga);
    expect((await get(t, w.AH))?.createdBy).toBe(w.olga);
    const pubs = await t.run(async (ctx) =>
      ctx.db.query("albumPhotos").withIndex("by_album", (q) => q.eq("albumId", w.AH)).collect(),
    );
    expect(pubs.map((p) => p.photoId)).toEqual([w.po1]);
    expect(pubs[0]?.addedBy).toBe(w.olga);
  });

  it("po1: zijn rating weg, aantal en gemiddelde kloppen; de melding blijft zonder melder", async () => {
    const { t, w } = await done();
    const po1 = await get(t, w.po1);
    expect(po1?.ratingCount).toBe(1);
    expect(po1?.ratingAverage).toBeCloseTo(4, 9);
    expect(po1?.flaggedBy).toBeUndefined();
    expect(po1?.flaggedAt).toBeDefined();
    expect(po1?.flaggedDeleteDate).toBeDefined();
    const ratings = await t.run(async (ctx) =>
      ctx.db.query("ratings").withIndex("by_photo", (q) => q.eq("photoId", w.po1)).collect(),
    );
    expect(ratings.map((r) => r.userId)).toEqual([w.anna]);
  });

  it("features: de zijne weg met hun upvotes; zijn upvote op die van Olga weg en de teller klopt", async () => {
    const { t, w } = await done();
    expect(await get(t, w.rexFeature)).toBeNull();
    const olgaFeature = await get(t, w.olgaFeature);
    expect(olgaFeature?.upvoteCount).toBe(1);
    const upvotes = await t.run(async (ctx) => ctx.db.query("featureUpvotes").collect());
    expect(upvotes.map((u) => [u.featureId, u.userId])).toEqual([[w.olgaFeature, w.anna]]);
  });

  it("uitnodigingen: alleen die van Olga aan Lex blijft", async () => {
    const { t, w } = await done();
    const invites = await t.run(async (ctx) => ctx.db.query("invites").collect());
    expect(invites.map((i) => i._id)).toEqual([w.olgaToLex]);
  });

  it("anderen houden hun rij, foto's, bezoek en albumLastSeen", async () => {
    const { t, w } = await done();
    for (const id of [w.olga, w.anna, w.lex, w.mia]) expect(await get(t, id)).not.toBeNull();
    expect(await get(t, w.po1)).not.toBeNull();
    expect((await get(t, w.olga))?.photoCount).toBe(1);
    const seen = await t.run(async (ctx) => ctx.db.query("albumLastSeen").collect());
    expect(seen.map((s) => s.userId)).toEqual([w.anna]);
  });
});

describe("WP29 A-invariant 6 en 9 — Clerk, en geen mail bij succes", () => {
  it("precies één DELETE op zijn Clerk-user met de geheime sleutel; geen mail", async () => {
    const t = newT();
    const w = await world(t);
    const net = stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    expect(net.clerk).toHaveLength(1);
    expect(net.clerk[0]).toMatchObject({ url: CLERK_URL, method: "DELETE", auth: `Bearer ${KEY}` });
    expect(net.mails).toEqual([]);
    expect(await get(t, w.rex)).toBeNull();
  });

  it("404 (bestaat al niet) telt als gelukt: geen herhaling, geen mail, rij weg", async () => {
    const t = newT();
    const w = await world(t);
    const net = stubNet(() => 404);
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    expect(net.clerk).toHaveLength(1);
    expect(net.mails).toEqual([]);
    expect(await get(t, w.rex)).toBeNull();
    expect(await drift(t)).toEqual([]);
  });

  it("twee keer 500, dan 200: herhaald tot het lukt; geen mail, rij weg", async () => {
    const t = newT();
    const w = await world(t);
    const net = stubNet((n) => (n < 2 ? 500 : 200));
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    expect(net.clerk).toHaveLength(3);
    expect(net.mails).toEqual([]);
    expect(await get(t, w.rex)).toBeNull();
    expect(await tracesOfRex(t, w)).toEqual([]);
  });

  it("429 (rate limit) wordt ook herhaald", async () => {
    const t = newT();
    const w = await world(t);
    const net = stubNet((n) => (n < 1 ? 429 : 200));
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    expect(net.clerk).toHaveLength(2);
    expect(await get(t, w.rex)).toBeNull();
  });
});

// ── A-invariant 5: tussendoor binnengekomen ──────────────────────────

describe("WP29 A-invariant 5 — wat na het afsluiten nog binnenkomt, gaat mee", () => {
  it("een foto, publicatie en rating van hem die tussendoor in de database kwamen, zijn aan het eind weg", async () => {
    const t = newT();
    const w = await world(t);
    stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});

    // Zoals een upload of rating die net vóór het afsluiten begon en erna
    // committe, of tussen twee opruimstappen in.
    const late = await t.run(async (ctx) => {
      const now = Date.now();
      const storageId = await ctx.storage.store(new Blob(["laat"], { type: "image/jpeg" }));
      const photoId = await ctx.db.insert("photos", { ownerId: w.rex, storageId, ratingCount: 0, createdAt: now });
      await ctx.db.insert("albumPhotos", { albumId: w.AG, photoId, groupId: w.G, addedAt: now, addedBy: w.rex });
      await ctx.db.insert("ratings", { photoId: w.po1, userId: w.rex, value: 1, createdAt: now, updatedAt: now });
      return { photoId, storageId };
    });
    await finish(t);

    expect(await get(t, late.photoId)).toBeNull();
    expect(await storageGone(t, late.storageId)).toBe(true);
    expect(await tracesOfRex(t, w)).toEqual([]);
    expect(await drift(t)).toEqual([]);
  });
});

// ── A-invariant 7: Clerk mislukt blijvend ────────────────────────────

describe("WP29 A-invariant 7 — Clerk mislukt blijvend, of de sleutel ontbreekt", () => {
  it("altijd 500: begrensd aantal pogingen over minstens een uur, één mail aan de webmaster, data toch weg, rij houdt login tegen", async () => {
    const t = newT();
    const w = await world(t);
    const net = stubNet(() => 500);
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    expect(net.clerk.length).toBeGreaterThanOrEqual(2);
    expect(net.clerk.length).toBeLessThanOrEqual(20);
    expect(net.clerk.at(-1)!.at - net.clerk[0]!.at).toBeGreaterThanOrEqual(HOUR);

    expect(net.mails).toHaveLength(1);
    expect(net.mails[0]!.to).toEqual([WEBMASTER]);
    expect(net.mails[0]!.text).toContain("user_rex");
    expect(net.mails[0]!.text.toLowerCase()).not.toContain(REX_EMAIL);

    // Alleen de users-rij is er nog.
    expect(await tracesOfRex(t, w)).toEqual([`users/${w.rex}`]);
    expect(await rex(t).query(api.users.current, {})).toBeNull();
    try {
      await t.mutation(internal.users.registerFromSession, { subject: "user_rex", email: REX_EMAIL });
    } catch {
      // Weigeren mag.
    }
    expect(await usersWithSubject(t, "user_rex")).toHaveLength(1);
  });

  it("de integriteitscheck meldt de rij na een uur, en alleen die", async () => {
    const t = newT();
    const w = await world(t);
    stubNet(() => 500);
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);
    vi.advanceTimersByTime(HOUR);

    const lines = await drift(t);
    expect(lines.some((l) => l.startsWith(`users/${w.rex}`))).toBe(true);
    expect(lines.filter((l) => !l.startsWith(`users/${w.rex}`))).toEqual([]);
  });

  it("retryAccountDeletion na herstel: de Clerk-user en de rij gaan weg, de check is schoon", async () => {
    const t = newT();
    const w = await world(t);
    const failing = stubNet(() => 500);
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);
    expect(failing.mails).toHaveLength(1);

    const net = stubNet();
    await t.mutation(retryRef, { userId: w.rex });
    await finish(t);

    expect(successfulDeletes(net)).toHaveLength(1);
    expect(net.clerk[0]).toMatchObject({ url: CLERK_URL, auth: `Bearer ${KEY}` });
    expect(await get(t, w.rex)).toBeNull();
    expect(await tracesOfRex(t, w)).toEqual([]);
    expect(await drift(t)).toEqual([]);
  });

  it("sleutel ontbreekt: geen aanroep naar Clerk, één mail aan de webmaster, data toch weg, rij blijft", async () => {
    delete process.env.CLERK_SECRET_KEY;
    const t = newT();
    const w = await world(t);
    const net = stubNet();
    await rex(t).mutation(api.users.deleteSelf, {});
    await finish(t);

    expect(net.clerk).toEqual([]);
    expect(net.mails).toHaveLength(1);
    expect(net.mails[0]!.to).toEqual([WEBMASTER]);
    expect(net.mails[0]!.text).toContain("user_rex");
    expect(await tracesOfRex(t, w)).toEqual([`users/${w.rex}`]);
  });

  it("retryAccountDeletion op een gewoon account doet niets", async () => {
    const t = newT();
    const w = await world(t);
    const net = stubNet();
    await t.mutation(retryRef, { userId: w.anna });
    await finish(t);

    expect(net.clerk).toEqual([]);
    expect(net.mails).toEqual([]);
    expect(await get(t, w.anna)).not.toBeNull();
    const annaRatings = await t.run(async (ctx) =>
      ctx.db.query("ratings").withIndex("by_user", (q) => q.eq("userId", w.anna)).collect(),
    );
    expect(annaRatings).toHaveLength(2);
    expect(await membershipsOf(t, w.G)).toHaveLength(4);
  });
});
