import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  groupRights,
  memberActions,
  type MemberAction,
} from "../../app/src/lib/groupAdmin";
import { as, groupRow, membership, newT, seedAlbum, seedGroup, type Role, type T } from "./_beheer";

// WP28b, A-invariant 18: het menu is de backend. Elke knop en menuregel staat
// er precies als de backend de actie toestaat en hij iets verandert, voor elke
// kijker en elk doel. Het orakel is de backend zelf (WP28a), los geschreven en
// los getest; het menu (app/src/lib/groupAdmin.ts) deelt er geen code mee.
// Spec: docs/work-packages/WP28-groepsbeheer.md §WP28b.
//
// Wereld: oprichter Olga, admins Anna en Bram, leden Mia en Max, één album.

// Een weigering moet een echte weigering zijn, niet "functie bestaat niet".
const MISSING_FUNCTION =
  /could not find|no such export|exported from module|no function named|not a function|not registered/i;

const ROLES: Record<string, Role> = { olga: "admin", anna: "admin", bram: "admin", mia: "member", max: "member" };
const VIEWERS = ["olga", "anna", "mia"] as const;
const TARGETS = ["olga", "anna", "bram", "mia", "max"] as const;
const MEMBER_ACTIONS: MemberAction[] = ["makeAdmin", "makeMember", "transferFounder", "removeMember", "leave"];

async function world(t: T) {
  const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", bram: "admin", mia: "member", max: "member" } });
  const albumId = await seedAlbum(t, w.groupId, w.users.olga!);
  return { ...w, albumId };
}
type W = Awaited<ReturnType<typeof world>>;

/** Lukt het, zonder dat de functie ontbreekt? */
async function succeeds(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    expect(String(err), "geen echte weigering").not.toMatch(MISSING_FUNCTION);
    return false;
  }
}

/** De backend staat de actie toe én hij verandert iets. */
async function backendDoes(viewer: string, targetName: string, action: MemberAction): Promise<boolean> {
  const t = newT();
  const w = await world(t);
  const me = as(t, `user_${viewer}`);
  const target = w.users[targetName]!;
  const self = viewer === targetName;
  switch (action) {
    case "makeAdmin":
    case "makeMember": {
      const role: Role = action === "makeAdmin" ? "admin" : "member";
      const before = (await membership(t, w.groupId, target))?.role;
      const ok = await succeeds(() => me.mutation(api.groups.updateMemberRole, { groupId: w.groupId, userId: target, role }));
      const after = (await membership(t, w.groupId, target))?.role;
      return ok && before !== after;
    }
    case "transferFounder": {
      const ok = await succeeds(() => me.mutation(api.groups.transferFounder, { groupId: w.groupId, userId: target }));
      return ok && (await groupRow(t, w.groupId))?.createdBy === target;
    }
    case "removeMember":
    case "leave": {
      // Verlaten is removeMember op jezelf; uit de groep halen is op een ander.
      if (self !== (action === "leave")) return false;
      const ok = await succeeds(() => me.mutation(api.groups.removeMember, { groupId: w.groupId, userId: target }));
      return ok && (await membership(t, w.groupId, target)) === null;
    }
  }
}

function menuFor(w: W, viewer: string, targetName: string): MemberAction[] {
  return memberActions(
    { me: w.users[viewer]!, role: ROLES[viewer]!, founderId: w.users.olga! },
    { userId: w.users[targetName]!, role: ROLES[targetName]! },
  );
}

describe("A-invariant 18 — het ledenmenu is de backend", () => {
  for (const viewer of VIEWERS) {
    for (const targetName of TARGETS) {
      it(`${viewer} bij ${targetName}`, async () => {
        const t = newT();
        const w = await world(t);
        const shown = new Set(menuFor(w, viewer, targetName));
        for (const action of MEMBER_ACTIONS) {
          const allowed = await backendDoes(viewer, targetName, action);
          expect(shown.has(action), `${viewer} → ${targetName}: ${action} (backend ${allowed ? "ja" : "nee"})`).toBe(allowed);
        }
      });
    }
  }
});

type Right = keyof ReturnType<typeof groupRights>;
const RIGHTS: Right[] = ["editGroup", "deleteGroup", "createAlbum", "editAlbum", "deleteAlbum"];

async function backendAllowsRight(viewer: string, right: Right): Promise<boolean> {
  const t = newT();
  const w = await world(t);
  const me = as(t, `user_${viewer}`);
  const groupId: Id<"groups"> = w.groupId;
  switch (right) {
    case "editGroup":
      return succeeds(() => me.mutation(api.groups.update, { groupId, name: "Nieuw" }));
    case "deleteGroup":
      return succeeds(() => me.mutation(api.groups.remove, { groupId }));
    case "createAlbum":
      return succeeds(() => me.mutation(api.albums.create, { groupId, name: "Nieuw" }));
    case "editAlbum":
      return succeeds(() => me.mutation(api.albums.update, { albumId: w.albumId, name: "Nieuw" }));
    case "deleteAlbum":
      return succeeds(() => me.mutation(api.albums.remove, { albumId: w.albumId }));
  }
}

describe("A-invariant 18 — de knoppen voor groep en album zijn de backend", () => {
  for (const viewer of VIEWERS) {
    it(viewer, async () => {
      const t = newT();
      const w = await world(t);
      const rights = groupRights({ me: w.users[viewer]!, role: ROLES[viewer]!, founderId: w.users.olga! });
      for (const right of RIGHTS) {
        const allowed = await backendAllowsRight(viewer, right);
        expect(rights[right], `${viewer}: ${right} (backend ${allowed ? "ja" : "nee"})`).toBe(allowed);
      }
    });
  }
});
