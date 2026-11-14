import { expect, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { publish, seedAlbum, type T, type World } from "../groups/_beheer";
import { seedInvite, world } from "./_wp19b";

// WP19c — gedeelde opzet voor de uitnodigingsmail met opmaak, groepsfoto en
// App Store-link. Spec: docs/work-packages/WP19c-uitnodigingsmail-opmaak.md
// (§A-invarianten). Geen sharp hier: dit bestand draait ook in edge-runtime.

export const SENDER = "invites@clubalmanac.com";
export const APP_STORE_ENV = "CLUBALMANAC_APP_STORE_ID";
/** Placeholder, geen echte Apple ID (opdracht regie). */
export const PLACEHOLDER_APP_ID = "1234567890";
export const APP_STORE_URL = `https://apps.apple.com/app/id${PLACEHOLDER_APP_ID}`;

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
}

function stubMailjet() {
  const spy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Draait `sendInviteEmail` en geeft het ene verstuurde bericht. */
export async function mailFor(
  t: T,
  inviteId: Id<"invites">,
  kind: "invite" | "accepted" | "declined" | "bounced" = "invite",
): Promise<Msg> {
  const spy = stubMailjet();
  await t.action(internal.invites.sendInviteEmail, { kind, inviteId });
  expect(spy).toHaveBeenCalledTimes(1);
  const init = spy.mock.calls[0]![1] as RequestInit;
  return (JSON.parse(String(init.body)) as { Messages: Msg[] }).Messages[0]!;
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
