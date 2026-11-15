import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { activeUserBySubject } from "./lib/accountState";
import { getWebmasterEmails } from "./lib/auth";
import { filmLinkCheckFailedTemplate } from "./lib/emailTemplates";
import { INFO_SENDER, sendMailjetMessage } from "./lib/mailjet";
import { filmListItem } from "./lib/shapes";
import { presignS3Get, type PresignedLink, type S3Credentials } from "./lib/s3Presign";

// WP21 — de clubfilms. De bestanden blijven in S3 (WP12 §Video's); Convex
// kent alleen de lijst (`films`) en tekent korte links na een toegangscheck.
// Spec: docs/work-packages/WP21-videos.md §Testcontract.
//
// - Toegang = lid van de groep van de film (besluit 1), per verzoek opnieuw
//   bepaald (invariant 8, A-invariant 17). Geen webmaster-uitzondering.
// - Eén weigering (A-invariant 11, zoals WP24): onbekende film, geen lid, niet
//   ingelogd, account in verwijdering of weg, en een cover-link voor een film
//   zonder cover geven allemaal `FILM_NOT_FOUND`. De lijst is dan leeg.
// - Alleen bekende films (A-invariant 10): de link-actions nemen alleen een
//   film-id aan en tekenen de sleutel uit de eigen tabel.
// - De toegangscheck gaat vóór de config: wie niet mag, krijgt altijd de
//   weigering, ook als de S3-config ontbreekt (die verraadt dan niets).
// - Het geheim en de ondertekende link komen nooit in een log of fout
//   (invariant 3). Deze module logt geen link en geen sleutel.

export const FILM_NOT_FOUND = { code: "FILM_NOT_FOUND" } as const;

/** Besluit 2: een film-link overleeft de langste film (89 min) plus pauze. */
export const FILM_LINK_SECONDS = 3 * 60 * 60;
/** Een cover wordt meteen geladen en daarna uit de cache van de app getoond. */
export const COVER_LINK_SECONDS = 15 * 60;
/** De bewakings-check gebruikt zijn link meteen. */
const CHECK_LINK_SECONDS = 60;

const KIND = v.union(v.literal("trailer"), v.literal("film"));

const ENV_NAMES = {
  accessKeyId: "FILMS_S3_ACCESS_KEY_ID",
  secretAccessKey: "FILMS_S3_SECRET_ACCESS_KEY",
  region: "FILMS_S3_REGION",
  bucket: "FILMS_S3_BUCKET",
} as const;

/**
 * De S3-config uit de env. Fail-loud: ontbreekt er één of is hij leeg, dan een
 * fout met `FILMS_S3_CONFIG_MISSING:` en de namen (nooit de waarden).
 */
function filmsS3Config(): S3Credentials {
  const missing: string[] = [];
  const read = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") missing.push(name);
    return value?.trim() ?? "";
  };
  const creds: S3Credentials = {
    accessKeyId: read(ENV_NAMES.accessKeyId),
    secretAccessKey: read(ENV_NAMES.secretAccessKey),
    region: read(ENV_NAMES.region),
    bucket: read(ENV_NAMES.bucket),
  };
  if (missing.length > 0) throw new Error(`FILMS_S3_CONFIG_MISSING: ${missing.join(", ")} niet gezet`);
  return creds;
}

// --- lijst -------------------------------------------------------------------

/**
 * De films van de groepen waarvan de caller lid is, in de volgorde van de
 * lijst. Leeg voor niet ingelogd, een account in verwijdering en geen lid.
 */
export const list = query({
  args: {},
  returns: v.array(filmListItem),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await activeUserBySubject(ctx.db, identity.subject);
    if (!user) return [];
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const groups = new Set<string>(memberships.map((m) => m.groupId));
    if (groups.size === 0) return [];
    const films = await ctx.db.query("films").withIndex("by_order").collect();
    return films
      .filter((f) => groups.has(f.groupId))
      .map((f) => ({
        _id: f._id,
        groupId: f.groupId,
        kind: f.kind,
        title: f.title,
        year: f.year,
        hasCover: f.coverKey !== undefined,
      }));
  },
});

/**
 * Vervang de hele lijst (seed op dev, T0-stap op prod). Intern: er is geen
 * publiek pad dat de lijst of de toegang wijzigt (A-invariant 12). Een
 * onbekende groep faalt luid, zodat een tikfout bij het vullen niet stil een
 * film onzichtbaar maakt.
 */
export const replaceAll = internalMutation({
  args: {
    items: v.array(
      v.object({
        groupId: v.id("groups"),
        kind: KIND,
        title: v.string(),
        year: v.number(),
        videoKey: v.string(),
        coverKey: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { items }) => {
    for (const item of items) {
      if (!(await ctx.db.get(item.groupId))) throw new Error(`FILMS_UNKNOWN_GROUP: ${item.groupId}`);
      if (item.videoKey.trim() === "") throw new Error(`FILMS_EMPTY_VIDEO_KEY: ${item.title}`);
    }
    for (const old of await ctx.db.query("films").collect()) await ctx.db.delete(old._id);
    let order = 0;
    for (const item of items) {
      const coverKey = item.coverKey?.trim() ? item.coverKey : undefined;
      await ctx.db.insert("films", { ...item, coverKey, order: order++ });
    }
    return { count: items.length };
  },
});

// --- links -------------------------------------------------------------------

/**
 * De sleutels van een film, alleen als deze Clerk-user hem mag zien (lid van
 * de groep, account actief). Anders `null`: de caller weigert dan altijd op
 * dezelfde manier.
 */
export const keysForViewer = internalQuery({
  args: { subject: v.string(), filmId: v.id("films") },
  returns: v.union(v.object({ videoKey: v.string(), coverKey: v.optional(v.string()) }), v.null()),
  handler: async (ctx, { subject, filmId }) => {
    const user = await activeUserBySubject(ctx.db, subject);
    if (!user) return null;
    const film = await ctx.db.get(filmId);
    if (!film) return null;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_group", (q) => q.eq("userId", user._id).eq("groupId", film.groupId))
      .unique();
    if (!membership) return null;
    return film.coverKey === undefined ? { videoKey: film.videoKey } : { videoKey: film.videoKey, coverKey: film.coverKey };
  },
});

async function linkFor(
  ctx: ActionCtx,
  filmId: Id<"films">,
  kind: "video" | "cover",
): Promise<PresignedLink> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError(FILM_NOT_FOUND);
  const keys = await ctx.runQuery(internal.films.keysForViewer, { subject: identity.subject, filmId });
  const key = kind === "video" ? keys?.videoKey : keys?.coverKey;
  if (key === undefined) throw new ConvexError(FILM_NOT_FOUND);
  const creds = filmsS3Config();
  return await presignS3Get(creds, key, kind === "video" ? FILM_LINK_SECONDS : COVER_LINK_SECONDS, Date.now());
}

const LINK = v.object({ url: v.string(), expiresAt: v.number() });

/** Een film-link van 3 uur (besluit 2). Elke aanroep tekent een verse link. */
export const videoUrl = action({
  args: { filmId: v.id("films") },
  returns: LINK,
  handler: async (ctx, { filmId }) => await linkFor(ctx, filmId, "video"),
});

/** Een cover-link, korter geldig dan een film-link. */
export const coverUrl = action({
  args: { filmId: v.id("films") },
  returns: LINK,
  handler: async (ctx, { filmId }) => await linkFor(ctx, filmId, "cover"),
});

// --- bewaking (besluit 7, A-invariant 16) ------------------------------------

/** De eerste cover uit de lijst, voor de dagelijkse check. */
export const firstCoverKey = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    for (const film of await ctx.db.query("films").withIndex("by_order").collect()) {
      if (film.coverKey !== undefined) return film.coverKey;
    }
    return null;
  },
});

/**
 * Het tekenen gebeurt lokaal, dus een ingetrokken of verlopen sleutel merkt
 * de backend pas als S3 hem weigert. Dagelijks: één cover lezen met een
 * ondertekende link (nooit een film: kosten, invariant 6). Lukt dat niet, dan
 * één mail aan de webmaster, met alleen de soort fout.
 */
export const checkLinks = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const problem = await findLinkProblem(ctx);
    if (problem !== null) await reportLinkProblem(problem);
    return null;
  },
});

async function findLinkProblem(ctx: ActionCtx): Promise<string | null> {
  let creds: S3Credentials;
  try {
    creds = filmsS3Config();
  } catch (e) {
    // De fout noemt alleen de namen van de env-vars.
    return e instanceof Error ? e.message : "FILMS_S3_CONFIG_MISSING";
  }
  const coverKey = await ctx.runQuery(internal.films.firstCoverKey, {});
  if (coverKey === null) return "er staat geen film met een cover in de filmlijst";
  const { url } = await presignS3Get(creds, coverKey, CHECK_LINK_SECONDS, Date.now());
  let status: number;
  try {
    // Alleen de eerste byte: de check kost zo geen verkeer.
    const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    status = res.status;
    await res.body?.cancel();
  } catch {
    return "netwerkfout naar S3";
  }
  if (status >= 200 && status < 300) return null;
  return `S3 gaf HTTP ${status}`;
}

async function reportLinkProblem(reason: string): Promise<void> {
  const webmasters = getWebmasterEmails();
  console.warn(`[films.checkLinks] een cover lezen lukt niet: ${reason}`);
  if (webmasters.length === 0) {
    console.log(`[films.checkLinks] geen WEBMASTER_EMAILS geconfigureerd, geen mail`);
    return;
  }
  const stage = process.env.CLUBALMANAC_STAGE?.trim() || "onbekende";
  const tpl = filmLinkCheckFailedTemplate({ reason, stage, timestamp: new Date().toISOString() });
  await sendMailjetMessage({
    from: { email: INFO_SENDER },
    to: webmasters.map((email) => ({ email })),
    subject: tpl.subject,
    htmlPart: tpl.htmlPart,
    textPart: tpl.textPart,
  });
}
