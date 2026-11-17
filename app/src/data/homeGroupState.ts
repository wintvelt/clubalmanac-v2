import { useAuth } from "@clerk/expo";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../convexApi";
import { groupIdOfPath, homeGroupOf, type HomeGroup } from "../lib/homeGroup";
import { lastGroupNow, loadLastGroup, saveLastGroup, subscribeLastGroup } from "./lastGroup";
import { useLiveQuery } from "./useLiveQuery";

// WP32: wat de Home-knop en de keuze na inloggen nodig hebben, zonder eigen
// query (invariant 3: geen extra serververkeer; WP15a invariant 6: de tabbalk
// heeft geen focus en mag geen live query hebben). De schermen die
// groups.listMine toch al ophalen, geven de lijst hier door. De tabbalk leest
// de laatst bekende lijst; een scherm in de groep houdt hem vers, dus
// verlaten of eruit gezet worden telt meteen (invariant 8).

export type MyGroup = FunctionReturnType<typeof api.groups.listMine>[number];

type Listener = () => void;

let known: { userId: string; groups: MyGroup[] } | null = null;
const listeners = new Set<Listener>();

function publishMyGroups(userId: string, groups: MyGroup[]): void {
  if (known?.userId === userId && known.groups === groups) return;
  known = { userId, groups };
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// groups.listMine voor het scherm in beeld, en doorgeven aan de Home-knop.
export function useMyGroups(): MyGroup[] | undefined {
  const { userId } = useAuth();
  const groups = useLiveQuery(api.groups.listMine, {});
  useEffect(() => {
    if (userId && groups) publishMyGroups(userId, groups);
  }, [userId, groups]);
  return groups;
}

// De laatst bekende lijst van deze user; undefined zolang er geen is (A4).
export function useKnownMyGroups(userId: string | null | undefined): MyGroup[] | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (userId && known?.userId === userId ? known.groups : undefined),
  );
}

// De opgeslagen thuisgroep van deze user: undefined tot gelezen (A2).
export function useStoredLastGroup(userId: string | null | undefined): string | null | undefined {
  const stored = useSyncExternalStore(subscribeLastGroup, () => (userId ? lastGroupNow(userId) : null));
  useEffect(() => {
    if (userId && lastGroupNow(userId) === undefined) void loadLastGroup(userId);
  }, [userId]);
  return stored;
}

// `visiting`: de groep die nu bezocht wordt (useGroupVisit). Die is meteen
// de thuisgroep, nog voor het geheugen bijgewerkt is (A10).
export function useHomeGroup(groups?: readonly MyGroup[], visiting?: string | null): HomeGroup {
  const { userId } = useAuth();
  const stored = useStoredLastGroup(userId);
  const knownGroups = useKnownMyGroups(userId);
  if (!userId) return { kind: "none" };
  return homeGroupOf({ storedGroupId: visiting ?? stored, myGroups: groups ?? knownGroups });
}

// Besluit 2 en A1: een scherm onder een groep in de Home-stack is een bezoek,
// als de user lid is van die groep (de groepenlijst). Een groep zonder
// lidmaatschap, of zolang de lijst er niet is, telt niet en overschrijft
// niets. Geeft de bezochte groep terug, of null.
export function useGroupVisit(pathname: string | null): string | null {
  const { userId } = useAuth();
  const knownGroups = useKnownMyGroups(userId);
  const groupId = pathname ? groupIdOfPath(pathname) : null;
  const visiting = groupId && knownGroups?.some((g) => g._id === groupId) ? groupId : null;
  useEffect(() => {
    if (userId && visiting && lastGroupNow(userId) !== visiting) void saveLastGroup(userId, visiting);
  }, [userId, visiting]);
  return visiting;
}
