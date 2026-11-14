import { expect, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { publish, seedAlbum, type T, type World } from "../groups/_beheer";
import { seedInvite, world } from "./_wp19b";
import { decodeWords, parseMime, smtp, walk, type Part } from "./_smtp";

// WP19c — gedeelde opzet voor de uitnodigingsmail met opmaak, groepsfoto en
// App Store-link. Spec: docs/work-packages/WP19c-uitnodigingsmail-opmaak.md
// (§A-invarianten). Geen sharp hier: dit bestand draait ook in edge-runtime.

export const SENDER = "invites@clubalmanac.com";
export const APP_STORE_ENV = "CLUBALMANAC_APP_STORE_ID";
/** De Apple ID van de app (besluit 3, openbaar). */
export const APPLE_APP_ID = "1663038609";
export const APP_STORE_URL = `https://apps.apple.com/app/id${APPLE_APP_ID}`;

export type Attachment = {
  ContentType?: string;
  Filename?: string;
  ContentID?: string;
  Base64Content?: string;
};

export type Msg = {
  To?: Array<{ Email?: string }>;
  Subject?: string;
  HTMLPart?: string;
  TextPart?: string;
  InlinedAttachments?: Attachment[];
  Attachments?: unknown[];
  /** Langs welke weg de mail ging (besluit 5): de Send API of SMTP. */
  transport: "api" | "smtp";
  /** Alleen bij `api`: het JSON-bericht zoals Mailjet het kreeg. */
  api?: Record<string, unknown>;
  /** Alleen bij `smtp`: de ruwe mail en de geparste boom. */
  raw?: string;
  mime?: Part;
  envelope?: { from?: string; to?: string[] };
};

export function mailEnv(appStoreId?: string): void {
  process.env.MAILJET_VERIFIED_SENDERS = SENDER;
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  delete process.env.CLUBALMANAC_APP_URL;
  if (appStoreId === undefined) delete process.env[APP_STORE_ENV];
  else process.env[APP_STORE_ENV] = appStoreId;
}

export function clearMailEnv(): void {
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  delete process.env[APP_STORE_ENV];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  smtp.reset();
}

export function stubMailjet() {
  const spy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/**
 * Draait `sendInviteEmail` en geeft het ene verstuurde bericht, langs welke weg
 * ook: de Send API (fetch) of SMTP (nodemailer, zie `_smtp.ts`). Precies één
 * verzending in totaal. Een SMTP-mail komt terug in dezelfde vorm als een
 * API-bericht, zodat de tests van A-invariant 1–11 voor beide gelden.
 * Een testbestand dat dit gebruikt, mockt nodemailer (`_smtp.ts`).
 */
export async function mailFor(
  t: T,
  inviteId: Id<"invites">,
  kind: "invite" | "accepted" | "declined" | "bounced" = "invite",
): Promise<Msg> {
  const spy = stubMailjet();
  smtp.sent = [];
  await t.action(internal.invites.sendInviteEmail, { kind, inviteId });
  expect(spy.mock.calls.length + smtp.sent.length).toBe(1);
  if (smtp.sent.length === 1) return fromSmtp(smtp.sent[0]!.raw, smtp.sent[0]!.envelope);
  const init = spy.mock.calls[0]![1] as RequestInit;
  const api = (JSON.parse(String(init.body)) as { Messages: Array<Record<string, unknown>> }).Messages[0]!;
  return { ...(api as Omit<Msg, "transport">), transport: "api", api };
}

// Op de lijn is een regeleinde CRLF; terug naar `\n` zoals in het API-bericht.
const text = (p: Part) => p.body.toString("utf8").replace(/\r\n/g, "\n");

/** Een SMTP-mail in de vorm van een API-bericht. */
export function fromSmtp(raw: string, envelope: { from?: string; to?: string[] }): Msg {
  const mime = parseMime(raw);
  const leaves = walk(mime)
    .map((x) => x.part)
    .filter((p) => !p.type.startsWith("multipart/"));
  const disposition = (p: Part) => (p.headers.get("content-disposition") ?? "").split(";")[0]!.trim().toLowerCase();
  const isFile = (p: Part) => !p.type.startsWith("text/") || disposition(p) === "attachment";
  const filename = (p: Part) => {
    const cd = /filename\*?=("?)([^";]+)\1/i.exec(p.headers.get("content-disposition") ?? "");
    return cd?.[2] ?? p.params.name;
  };
  const html = leaves.find((p) => p.type === "text/html" && !isFile(p));
  const plain = leaves.find((p) => p.type === "text/plain" && !isFile(p));
  const files = leaves.filter(isFile);
  const inline = files.filter((p) => p.headers.has("content-id") && disposition(p) !== "attachment");
  const to = (mime.headers.get("to") ?? "").match(/[^\s<>,"]+@[^\s<>,"]+/g) ?? [];
  return {
    To: to.map((Email) => ({ Email })),
    Subject: decodeWords(mime.headers.get("subject") ?? ""),
    ...(html ? { HTMLPart: text(html) } : {}),
    ...(plain ? { TextPart: text(plain) } : {}),
    InlinedAttachments: inline.map((p) => ({
      ContentType: p.type,
      Filename: filename(p),
      ContentID: (p.headers.get("content-id") ?? "").replace(/^<|>$/g, ""),
      Base64Content: p.body.toString("base64"),
    })),
    Attachments: files.filter((p) => !inline.includes(p)),
    transport: "smtp",
    raw,
    mime,
    envelope,
  };
}

/** Olga (admin) nodigt Nina uit voor "De Fotoclub". */
export async function setup(
  t: T,
  extra: { name?: string; message?: string; groupName?: string; inviterName?: string } = {},
): Promise<{ w: World; inviteId: Id<"invites"> }> {
  const w = await world(t);
  await t.run(async (ctx) => ctx.db.patch(w.users.olga!, { name: extra.inviterName ?? "Olga Oprichter" }));
  await t.run(async (ctx) => ctx.db.patch(w.groupId, { name: extra.groupName ?? "De Fotoclub" }));
  const inviteId = await seedInvite(t, {
    email: "nina@x.test",
    invitedBy: w.users.olga!,
    groupId: w.groupId,
    name: extra.name ?? "Nina",
    ...(extra.message !== undefined ? { message: extra.message } : {}),
  });
  return { w, inviteId };
}

export type CoverSeed = {
  original: Uint8Array;
  /** Zonder `klein` heeft de foto geen formaten. */
  klein?: Uint8Array;
  groot?: Uint8Array;
  exifOrientation?: number;
  /** In een album van welke groep; `null` = in geen album. Standaard de groep zelf. */
  inAlbumOf?: Id<"groups"> | null;
  /** Cover van welke groep; standaard `w.groupId`. */
  coverOf?: Id<"groups">;
};

export type SeededCover = {
  photoId: Id<"photos">;
  original: Id<"_storage">;
  klein?: Id<"_storage">;
  groot?: Id<"_storage">;
};

/** Een foto van olga als cover, met desgewenst formaten, stand en album. */
export async function seedCoverPhoto(t: T, w: World, s: CoverSeed): Promise<SeededCover> {
  const blob = (b: Uint8Array) => new Blob([b as BlobPart], { type: "image/jpeg" });
  const seeded = await t.run(async (ctx) => {
    const original = await ctx.storage.store(blob(s.original));
    let formats: { klein: Id<"_storage">; groot: Id<"_storage"> } | undefined;
    if (s.klein) {
      formats = {
        klein: await ctx.storage.store(blob(s.klein)),
        groot: await ctx.storage.store(blob(s.groot ?? s.klein)),
      };
    }
    const photoId = await ctx.db.insert("photos", {
      ownerId: w.users.olga!,
      storageId: original,
      createdAt: Date.now(),
      ...(s.exifOrientation !== undefined ? { exifOrientation: s.exifOrientation } : {}),
      ...(formats ? { formats } : {}),
    });
    return { photoId, original, ...(formats ?? {}) };
  });
  const albumGroup = s.inAlbumOf === undefined ? w.groupId : s.inAlbumOf;
  if (albumGroup !== null) {
    const albumId = await seedAlbum(t, albumGroup, w.users.olga!);
    await publish(t, albumId, seeded.photoId);
  }
  const coverOf = s.coverOf ?? w.groupId;
  await t.run(async (ctx) => ctx.db.patch(coverOf, { coverPhotoId: seeded.photoId }));
  return seeded;
}

/** Alle http(s)-URL's in een stuk tekst. */
export function urlsIn(s: string): string[] {
  return s.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
}

/** Alle `href`-waarden. */
export function hrefsIn(html: string): string[] {
  return [...html.matchAll(/href\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]!);
}

export function imgTags(html: string): string[] {
  return html.match(/<img\b[^>]*>/gi) ?? [];
}

/** Geen bijlage, geen beeld, geen `cid:` (A-invariant 1). */
export function expectNoPhoto(msg: Msg): void {
  expect(msg.InlinedAttachments ?? []).toHaveLength(0);
  expect(msg.Attachments ?? []).toHaveLength(0);
  expect(imgTags(msg.HTMLPart ?? "")).toHaveLength(0);
  expect(msg.HTMLPart ?? "").not.toMatch(/cid:/i);
  expect(msg.TextPart ?? "").not.toMatch(/cid:/i);
}
