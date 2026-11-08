import type { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";

// WP28 A-keuze 1: `groups.addMember` is geen publiek pad meer (een account in
// een groep zetten zonder uitnodiging of instemming). Tests die een lid als
// opzet nodig hebben, zetten het lidmaatschap direct neer. Zelfde argumenten
// als de oude mutation, zonder auth en zonder cascades.
export async function seedMember(
  t: ReturnType<typeof convexTest>,
  args: { groupId: Id<"groups">; userId: Id<"users">; role?: "admin" | "member" },
): Promise<Id<"memberships">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("memberships", {
      userId: args.userId,
      groupId: args.groupId,
      role: args.role ?? "member",
      joinedAt: Date.now(),
    }),
  );
}
