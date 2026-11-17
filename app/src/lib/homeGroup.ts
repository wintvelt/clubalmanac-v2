// WP32: de thuisgroep en de Home-knop. Pure logica; het geheugen staat in
// src/data/lastGroup.ts, de knop in src/navigation/TabBar.tsx.
// Spec: docs/work-packages/WP32-thuisgroep-ui-fixes.md, invarianten 1–8,
// besluiten Wouter 2026-11-17, A1–A10.

export type HomeGroup =
  | { kind: "group"; groupId: string; name: string }
  | { kind: "none" }
  // Opgeslagen waarde nog niet gelezen, of de groepenlijst is er (nog) niet
  // (A2, A4): de app kiest niets en de Home-knop gaat nooit naar een groep.
  | { kind: "unknown" };

// Invarianten 1, 4, 5 en 8. `storedGroupId`: undefined = nog niet gelezen,
// null = niets opgeslagen. `myGroups`: undefined = de lijst laadt nog.
export function homeGroupOf(input: {
  storedGroupId: string | null | undefined;
  myGroups: readonly { _id: string; name: string }[] | undefined;
}): HomeGroup {
  const { storedGroupId, myGroups } = input;
  if (storedGroupId === undefined || myGroups === undefined) return { kind: "unknown" };
  // Lidmaatschap is leidend: een opgeslagen groep zonder lidmaatschap telt niet.
  const stored = storedGroupId === null ? undefined : myGroups.find((g) => g._id === storedGroupId);
  const home = stored ?? (myGroups.length === 1 ? myGroups[0] : undefined);
  return home ? { kind: "group", groupId: home._id, name: home.name } : { kind: "none" };
}

// --- Paden --------------------------------------------------------------------------

const GROUP_PATH = /^\/groep\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/;

function parseGroupPath(pathname: string): { groupId: string; rest: string } | null {
  const match = GROUP_PATH.exec(pathname);
  if (!match?.[1]) return null;
  let groupId: string;
  try {
    groupId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return { groupId, rest: match[2] ?? "" };
}

// A1: de groep van een scherm onder de groep in de Home-stack, anders null.
export function groupIdOfPath(pathname: string): string | null {
  return parseGroupPath(pathname)?.groupId ?? null;
}

function isGroupPage(pathname: string, groupId: string): boolean {
  const parsed = parseGroupPath(pathname);
  return parsed !== null && parsed.groupId === groupId && (parsed.rest === "" || parsed.rest === "/");
}

type Tab = "home" | "mijn-fotos" | "profiel" | "instellingen" | "toevoegen";

function startsWithSegment(pathname: string, segment: string): boolean {
  return pathname === segment || pathname.startsWith(`${segment}/`) || pathname.startsWith(`${segment}?`);
}

// Elk pad buiten de drie andere tabs en Toevoegen hoort bij de Home-stack.
function tabOf(pathname: string): Tab {
  for (const tab of ["mijn-fotos", "profiel", "instellingen", "toevoegen"] as const) {
    if (startsWithSegment(pathname, `/${tab}`)) return tab;
  }
  return "home";
}

// --- Herkomst (besluit 1, A9) -------------------------------------------------------

// `pathname`: het laatst geziene pad. `cameFrom`: het pad waar de user stond
// toen hij naar de tab van `pathname` wisselde; null = onbekend (koude start,
// deep link).
export type TabOrigin = { pathname: string | null; cameFrom: string | null };

// Alleen een tab-wissel verandert de herkomst. Toevoegen is een modaal, geen
// tab: openen en sluiten telt niet.
export function trackTabOrigin(origin: TabOrigin, pathname: string): TabOrigin {
  if (tabOf(pathname) === "toevoegen") return origin;
  if (origin.pathname === null) return { pathname, cameFrom: null };
  if (tabOf(origin.pathname) !== tabOf(pathname)) return { pathname, cameFrom: origin.pathname };
  return { pathname, cameFrom: origin.cameFrom };
}

// --- De Home-knop (invariant 6, besluiten 1 en 2, A4, A7) --------------------------

export type HomeButtonTarget = { kind: "none" } | { kind: "myGroups" } | { kind: "group"; groupId: string };

export type HomeButton = {
  icon: "home" | "groups";
  target: HomeButtonTarget;
  accessibilityLabel: string;
};

const MY_GROUPS = "/";

export function homeButton(input: { pathname: string; homeGroup: HomeGroup; cameFrom: string | null }): HomeButton {
  const { pathname, homeGroup, cameFrom } = input;
  const toMyGroups: HomeButton = {
    icon: "home",
    target: { kind: "myGroups" },
    accessibilityLabel: "Home, naar Mijn groepen",
  };
  const toHomeGroup: HomeButton | null =
    homeGroup.kind === "group"
      ? {
          icon: "home",
          target: { kind: "group", groupId: homeGroup.groupId },
          accessibilityLabel: `Home, naar ${homeGroup.name}`,
        }
      : null;

  if (pathname === MY_GROUPS) {
    return { icon: "home", target: { kind: "none" }, accessibilityLabel: "Home, Mijn groepen" };
  }
  if (tabOf(pathname) === "home") {
    // De herkomst telt hier niet.
    if (homeGroup.kind === "group" && isGroupPage(pathname, homeGroup.groupId)) {
      return { ...toMyGroups, icon: "groups" };
    }
    return toHomeGroup ?? toMyGroups;
  }
  // Een andere tab: rechtstreeks vanaf Mijn groepen gekomen, dan daarheen terug.
  if (cameFrom === MY_GROUPS) return toMyGroups;
  return toHomeGroup ?? toMyGroups;
}
