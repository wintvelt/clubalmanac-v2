import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// WP29 A-invariant 1 en 2: een account dat wordt verwijderd, is voor elke
// publieke functie niet meer ingelogd. Eén plek voor de lookup op Clerk-subject,
// zodat geen gate de markering kan missen. Apart van convex/users.ts zodat
// lib/auth.ts hem kan gebruiken zonder circulaire import.

/** De users-rij bij een Clerk-subject, ook als het account wordt verwijderd. */
export async function userBySubject(
  db: QueryCtx["db"],
  subject: string,
): Promise<Doc<"users"> | null> {
  return await db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", subject))
    .unique();
}

export function isBeingDeleted(user: Doc<"users">): boolean {
  return user.deletion !== undefined;
}

/** De users-rij bij een Clerk-subject; `null` als hij er niet is of wordt verwijderd. */
export async function activeUserBySubject(
  db: QueryCtx["db"],
  subject: string,
): Promise<Doc<"users"> | null> {
  const user = await userBySubject(db, subject);
  return user && !isBeingDeleted(user) ? user : null;
}

/** WP29 fix 1b: SHA-256 (hex) van een Clerk-subject, voor `deletedClerkSubjects`. */
export async function clerkSubjectHash(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Is het account van deze Clerk-user ooit verwijderd (fix 1b)? */
export async function isDeletedClerkSubject(
  db: QueryCtx["db"],
  subject: string,
): Promise<boolean> {
  const subjectHash = await clerkSubjectHash(subject);
  const marker = await db
    .query("deletedClerkSubjects")
    .withIndex("by_subjectHash", (q) => q.eq("subjectHash", subjectHash))
    .first();
  return marker !== null;
}

/**
 * WP29 fix 8: hoort dit (genormaliseerde) adres bij een account dat wordt
 * verwijderd? Het adres is bij het afsluiten genormaliseerd.
 */
export async function isEmailBeingDeleted(
  db: QueryCtx["db"],
  normalizedEmail: string,
): Promise<boolean> {
  const users = await db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
    .collect();
  return users.some(isBeingDeleted);
}
