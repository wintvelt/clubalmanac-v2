import { ConvexError } from "convex/values";

// WP16: pure logica achter Mijn groepen, Groep (Albums, Leden) en Home.
// Spec: docs/work-packages/WP16-groepen.md §Spec-criticus aanvullingen en
// §sortDate. Wat er getoond wordt en in welke volgorde; de schermen tonen het.

// --- Jaar en datum (invariant 11, besluit 3) ----------------------------------

const HOUR = 3_600_000;

// Het kalenderjaar in Nederlandse tijd. Rond de jaarwisseling geldt in
// Nederland altijd wintertijd (UTC+1), en verder kan het verschil tussen UTC
// en zomertijd het jaar niet veranderen. Eén uur erbij is dus genoeg, zonder
// tijdzone-database op het toestel.
export function yearOf(ms: number): number {
  return new Date(ms + HOUR).getUTCFullYear();
}

type Dated = { createdAt: number; sortDate?: number };

// De gekozen datum van een groep of album, anders de aanmaakdatum.
export function displayDate(item: Dated): number {
  return item.sortDate ?? item.createdAt;
}

export function displayYear(item: Dated): number {
  return yearOf(displayDate(item));
}

// --- Volgorde ------------------------------------------------------------------

// Nederlandse sortering: hoofdletters en accenten tellen niet.
let collator: Intl.Collator | null = null;
function compareNames(a: string, b: string): number {
  collator ??= new Intl.Collator("nl", { sensitivity: "base" });
  return collator.compare(a, b);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type Named = Dated & { _id: string; name: string };

// Nieuwste datum eerst, dan naam, dan id: altijd een vaste volgorde.
function newestFirst(a: Named, b: Named): number {
  return displayDate(b) - displayDate(a) || compareNames(a.name, b.name) || compareIds(a._id, b._id);
}

export function sortMyGroups<G extends Named>(groups: readonly G[]): G[] {
  return [...groups].sort(newestFirst);
}

export type AlbumYear<A> = { year: number; albums: A[] };

// Groep → Albums: per jaar, jaren nieuwste eerst, binnen een jaar nieuwste
// eerst. De albums blijven zoals ze binnenkomen (met hun teller).
export function albumsByYear<A extends Named>(albums: readonly A[]): AlbumYear<A>[] {
  const years: AlbumYear<A>[] = [];
  for (const album of [...albums].sort(newestFirst)) {
    const year = displayYear(album);
    const last = years[years.length - 1];
    if (last && last.year === year) last.albums.push(album);
    else years.push({ year, albums: [album] });
  }
  return years;
}

// --- Leden ---------------------------------------------------------------------

type Role = "admin" | "member";

type MemberInput = {
  membership: { userId: string; role: Role };
  user: { name?: string } | null;
};

export type MemberSection<M> = {
  role: Role;
  members: (M & { isMe: boolean; isFounder: boolean })[];
};

// Een naam van alleen spaties, of geen user-rij: geen naam.
export function memberName(m: MemberInput): string | null {
  const name = m.user?.name?.trim();
  return name ? name : null;
}

// Groep → Leden: eerst Admins, dan Leden; een lege sectie valt weg. Binnen een
// sectie op naam, leden zonder naam onderaan.
export function memberSections<M extends MemberInput>(
  members: readonly M[],
  who: { meId: string | null; founderId: string | null },
): MemberSection<M>[] {
  const byName = (a: M, b: M) => {
    const na = memberName(a);
    const nb = memberName(b);
    if (na === null || nb === null) {
      if (na !== nb) return na === null ? 1 : -1;
    } else {
      const c = compareNames(na, nb);
      if (c !== 0) return c;
    }
    return compareIds(a.membership.userId, b.membership.userId);
  };
  const roles: Role[] = ["admin", "member"];
  return roles
    .map((role) => ({
      role,
      members: members
        .filter((m) => m.membership.role === role)
        .sort(byName)
        .map((m) => ({
          ...m,
          isMe: m.membership.userId === who.meId,
          isFounder: m.membership.userId === who.founderId,
        })),
    }))
    .filter((s) => s.members.length > 0);
}

// --- Teller --------------------------------------------------------------------

export type UnreadBadge = { text: string; accessibilityLabel: string };

// Het getal van de backend, volledig (invariant 1). 0 of minder: geen teller.
export function unreadBadge(count: number): UnreadBadge | null {
  if (!(count > 0)) return null;
  const text = String(count);
  return { text, accessibilityLabel: count === 1 ? "1 nieuwe foto" : `${text} nieuwe foto's` };
}

// --- Fout bij de groep-reads (invariant 9) ---------------------------------------

export type GroupErrorKind = "notMember" | "other";

// Alleen de code van een ConvexError telt, nooit de tekst.
export function groupErrorKind(error: unknown): GroupErrorKind {
  if (!(error instanceof ConvexError)) return "other";
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return "other";
  return (data as { code?: unknown }).code === "NOT_MEMBER" ? "notMember" : "other";
}

// --- Home (invarianten 6 en 12) ----------------------------------------------------

export type HomeTarget =
  | { kind: "wait" }
  | { kind: "group"; groupId: string }
  | { kind: "myGroups"; forget: boolean };

// Tot bekend is welke groepen je hebt: wachten, geen flits van een oude groep.
export function homeTarget(input: {
  lastGroupId: string | null;
  myGroups: readonly { _id: string }[] | undefined;
}): HomeTarget {
  const { lastGroupId, myGroups } = input;
  if (lastGroupId === null) return { kind: "myGroups", forget: false };
  if (myGroups === undefined) return { kind: "wait" };
  if (myGroups.some((g) => g._id === lastGroupId)) return { kind: "group", groupId: lastGroupId };
  return { kind: "myGroups", forget: true };
}

// --- Geheugen voor de laatst bezochte groep (invariant 6) ---------------------------

export function encodeLastGroup(userId: string, groupId: string): string {
  return JSON.stringify({ userId, groupId });
}

// Een groep van een andere user, of iets onleesbaars: niets.
export function decodeLastGroup(raw: string | null, userId: string): string | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { userId: owner, groupId } = value as { userId?: unknown; groupId?: unknown };
  if (owner !== userId || typeof groupId !== "string" || groupId.length === 0) return null;
  return groupId;
}

// --- Teksten -----------------------------------------------------------------------

export function roleLabel(role: Role): string {
  return role === "admin" ? "Admin" : "Lid";
}

export function sectionTitle(role: Role): string {
  return role === "admin" ? "Admins" : "Leden";
}

// De eerste letter voor het vlak in het verloop (besluit 2: nog geen beeld).
export function initialOf(name: string | null | undefined): string {
  const first = name?.trim()[0];
  return first ? first.toLocaleUpperCase("nl") : "?";
}
