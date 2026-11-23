import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { ORIGINAL_ARRIVAL_AFTER_CLOSE_MS, ORIGINAL_PART_BYTES } from "./constants";

// WP38 — gedeelde regels voor filmprojecten en originelen, zonder publieke
// functies: de stand van een project, de delen van een origineel, het merk
// van het bestand, de bestandsnaam bij downloaden, en de cascades die elk
// wis-pad gebruikt (photos, groups, albums, accountDeletion). Hier en niet in
// convex/filmProjects.ts, zodat die modules elkaar niet in een kring
// importeren. Spec: docs/work-packages/WP38-filmproject-originelen.md.

// --- de stand van een project -------------------------------------------------

/** Open: niet gesloten en de einddatum is nog niet voorbij (besluit 13: vanzelf dicht). */
export function projectIsOpen(project: Doc<"filmProjects">, now: number): boolean {
  return project.closedAt === undefined && now < project.endsAt;
}

/** Het moment waarop het project dicht ging (of gaat): sluiten of de einddatum. */
export function projectClosedAt(project: Doc<"filmProjects">): number {
  return Math.min(project.closedAt ?? Number.POSITIVE_INFINITY, project.endsAt);
}

/**
 * Besluit 18: een aangemeld origineel mag binnenkomen zolang het project open
 * is, en tot 14 dagen na het sluiten. Nieuwe inzendingen alleen als het open is.
 */
export function projectAcceptsArrivals(project: Doc<"filmProjects">, now: number): boolean {
  return now < projectClosedAt(project) + ORIGINAL_ARRIVAL_AFTER_CLOSE_MS;
}

/** Het open project van een groep, of `null`. */
export async function openProjectOfGroup(
  ctx: QueryCtx,
  groupId: Id<"groups">,
  now: number,
): Promise<Doc<"filmProjects"> | null> {
  const projects = await ctx.db
    .query("filmProjects")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  return projects.find((p) => projectIsOpen(p, now)) ?? null;
}

/** Wie ziet een inzending in de lijst en op het beeldpad: eigen, binnen, of de oprichter (A-invariant 7). */
export function canSeeOriginal(original: Doc<"filmOriginals">, userId: Id<"users">, isFounder: boolean): boolean {
  return original.ownerId === userId || original.status === "binnen" || isFounder;
}

// --- delen ----------------------------------------------------------------------

export type PlannedPart = { partNumber: number; size: number };

/** A-keuze: delen van 32 MiB, het laatste de rest. */
export function planParts(bytes: number): PlannedPart[] {
  const parts: PlannedPart[] = [];
  const count = Math.max(1, Math.ceil(bytes / ORIGINAL_PART_BYTES));
  for (let i = 1; i <= count; i++) {
    parts.push({ partNumber: i, size: i < count ? ORIGINAL_PART_BYTES : bytes - (count - 1) * ORIGINAL_PART_BYTES });
  }
  return parts;
}

// --- het bestand ----------------------------------------------------------------

const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V "]);

/**
 * A-keuze: het bestand begint met een `ftyp` van QuickTime (`qt  `) of een
 * mp4-merk. Meer controleert de backend niet (A-invariant 6: niet ontleden).
 * `null`: geen filmpje.
 */
export function originalContainer(head: Uint8Array): "mov" | "mp4" | null {
  if (head.byteLength < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (ascii(4, 8) !== "ftyp") return null;
  const brand = ascii(8, 12);
  if (brand === "qt  ") return "mov";
  return MP4_BRANDS.has(brand) ? "mp4" : null;
}

// --- de bestandsnaam bij downloaden ---------------------------------------------

/**
 * De kloktijd in Nederland (CET, CEST van de laatste zondag van maart tot de
 * laatste zondag van oktober, om 01:00 UTC), als ms die met UTC-getters te
 * lezen is.
 */
export function amsterdamWallClock(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0));
    return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
  };
  const summer = ms >= lastSunday(2) && ms < lastSunday(9);
  return ms + (summer ? 2 : 1) * 60 * 60 * 1000;
}

function stamp(wallClockMs: number): string {
  const d = new Date(wallClockMs);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}.${two(d.getUTCMinutes())}`;
}

/**
 * A-keuze: `<jjjj-mm-dd uu.mm> <naam inzender>.mov` (of `.mp4`). De datum is
 * de opnamedatum van het filmpje (kloktijd van de opname, zoals bij foto's),
 * of zonder die de datum van inzenden in Nederland. Geen plaats.
 */
export function originalFilename(opts: {
  takenAt: number | undefined;
  submittedAt: number;
  ownerName: string;
  container: "mov" | "mp4";
}): string {
  const when = opts.takenAt !== undefined ? stamp(opts.takenAt) : stamp(amsterdamWallClock(opts.submittedAt));
  // Geen tekens die een bestandssysteem of de header niet aankan.
  const name = opts.ownerName.replace(/[\\/:*?"<>|;\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() || "lid";
  return `${when} ${name}.${opts.container}`;
}

/** `attachment` met een ASCII-naam en de UTF-8-naam (RFC 6266). */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// --- wissen (A-invariant 10, 12) ------------------------------------------------

/**
 * Inzendingen weg: de rijen meteen (dus uit elke lijst), het object in R2 en
 * een open upload daarna, in een geplande stap (best-effort; de R2-check van
 * de originelen meldt wat blijft staan).
 */
export async function removeOriginalRows(ctx: MutationCtx, rows: Doc<"filmOriginals">[]): Promise<void> {
  if (rows.length === 0) return;
  const items: { key: string; uploadId?: string }[] = [];
  for (const r of rows) {
    items.push(r.uploadId !== undefined ? { key: r.key, uploadId: r.uploadId } : { key: r.key });
    await ctx.db.delete(r._id);
  }
  await ctx.scheduler.runAfter(0, internal.filmProjects.deleteOriginalObjects, { items });
}

/** Besluit 16: het filmpje in het album verwijderen haalt ook het origineel weg. */
export async function removeOriginalsOfPhoto(ctx: MutationCtx, photoId: Id<"photos">): Promise<void> {
  const rows = await ctx.db
    .query("filmOriginals")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  await removeOriginalRows(ctx, rows);
}

/** Besluit 12: wie uit de groep gaat (vertrek of verwijderd), verliest zijn originelen in die groep. */
export async function removeOriginalsOfMemberInGroup(
  ctx: MutationCtx,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<void> {
  const rows = await ctx.db
    .query("filmOriginals")
    .withIndex("by_group_and_owner", (q) => q.eq("groupId", groupId).eq("ownerId", userId))
    .collect();
  await removeOriginalRows(ctx, rows);
}

/** Account verwijderen (WP29): zijn originelen, begrensd per stap. Geeft of er iets was. */
export async function removeOriginalsOfOwner(ctx: MutationCtx, ownerId: Id<"users">, limit: number): Promise<boolean> {
  const rows = await ctx.db
    .query("filmOriginals")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .take(limit);
  await removeOriginalRows(ctx, rows);
  return rows.length > 0;
}

/** Groep weg (G3, G4, M2-e): de projecten met al hun inzendingen. */
export async function removeProjectsOfGroup(ctx: MutationCtx, groupId: Id<"groups">): Promise<void> {
  const projects = await ctx.db
    .query("filmProjects")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  for (const p of projects) {
    const rows = await ctx.db
      .query("filmOriginals")
      .withIndex("by_project", (q) => q.eq("projectId", p._id))
      .collect();
    await removeOriginalRows(ctx, rows);
    await ctx.db.delete(p._id);
  }
}

/**
 * Besluit 17, WP10: het filmalbum is weg (na sluiten). Het project houdt de
 * naam en zijn originelen, maar wijst niet meer naar het album.
 */
export async function detachProjectsFromAlbum(ctx: MutationCtx, albumId: Id<"albums">): Promise<void> {
  const projects = await ctx.db
    .query("filmProjects")
    .withIndex("by_album", (q) => q.eq("albumId", albumId))
    .collect();
  for (const p of projects) await ctx.db.patch(p._id, { albumId: undefined });
}

/** Besluit 17: staat er een open project op dit album? */
export async function albumHasOpenProject(ctx: QueryCtx, albumId: Id<"albums">, now: number): Promise<boolean> {
  const projects = await ctx.db
    .query("filmProjects")
    .withIndex("by_album", (q) => q.eq("albumId", albumId))
    .collect();
  return projects.some((p) => projectIsOpen(p, now));
}
