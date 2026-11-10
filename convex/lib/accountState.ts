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
