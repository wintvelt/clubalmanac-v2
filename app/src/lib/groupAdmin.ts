import { ConvexError } from "convex/values";
import { MONTHS, dutchOffset } from "./photos";

// WP28b: pure logica achter het groeps- en albumbeheer. Spec:
// docs/work-packages/WP28-groepsbeheer.md §WP28b (A-invarianten 18–21). Wie
// wat mag, de datum als dag, wat Bewaar meestuurt en de melding bij een code.
// De schermen tonen het. Deelt geen code met de backend: de regels staan er
// los, tests/groups/adminMenuMatchesBackend.test.ts vergelijkt ze.

export type Role = "admin" | "member";

export type Viewer = { me: string; role: Role; founderId: string };
export type MemberTarget = { userId: string; role: Role };

// --- Wie mag wat (A-invariant 18) ---------------------------------------------------
//
//   groep wijzigen, album maken en wijzigen   admin
//   groep en album verwijderen                oprichter
//   rol van een ander                         admin, niet bij de oprichter, alleen een echte wijziging
//   uit de groep halen                        admin, niet bij de oprichter
//   oprichter maken                           de oprichter, bij een ander lid
//   verlaten                                  jezelf, niet de oprichter

export type GroupRights = {
  editGroup: boolean;
  deleteGroup: boolean;
  createAlbum: boolean;
  editAlbum: boolean;
  deleteAlbum: boolean;
};

function isFounder(v: Viewer): boolean {
  return v.me === v.founderId;
}

function isAdmin(v: Viewer): boolean {
  return v.role === "admin" || isFounder(v);
}

export function groupRights(viewer: Viewer): GroupRights {
  const admin = isAdmin(viewer);
  const founder = isFounder(viewer);
  return {
    editGroup: admin,
    deleteGroup: founder,
    createAlbum: admin,
    editAlbum: admin,
    deleteAlbum: founder,
  };
}

export type MemberAction = "makeAdmin" | "makeMember" | "transferFounder" | "removeMember" | "leave";

// Volgorde in het menu: rol, oprichter, uit de groep halen onderaan.
export function memberActions(viewer: Viewer, target: MemberTarget): MemberAction[] {
  if (target.userId === viewer.me) return isFounder(viewer) ? [] : ["leave"];
  if (!isAdmin(viewer) || target.userId === viewer.founderId) return [];
  const out: MemberAction[] = [target.role === "member" ? "makeAdmin" : "makeMember"];
  if (isFounder(viewer)) out.push("transferFounder");
  out.push("removeMember");
  return out;
}

export function memberActionLabel(action: MemberAction): string {
  switch (action) {
    case "makeAdmin":
      return "Maak admin";
    case "makeMember":
      return "Maak lid";
    case "transferFounder":
      return "Maak oprichter";
    case "removeMember":
      return "Uit de groep halen";
    case "leave":
      return "Groep verlaten";
  }
}

// --- De datum als dag (A-invariant 19) ----------------------------------------------
//
// `sortDate` is UTC-middernacht van de dag (WP28a A-keuze 5, de migratie).
// `createdAt` is een echt tijdstip, dus de dag in Nederlandse tijd, zoals
// formatPhotoDate. De kiezer werkt met de klok van het toestel.

export type Day = { year: number; month: number; day: number };

type Dated = { createdAt: number; sortDate?: number };

function utcDay(ms: number): Day {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function dayOf(item: Dated): Day {
  if (item.sortDate !== undefined) return utcDay(item.sortDate);
  return utcDay(item.createdAt + dutchOffset(item.createdAt));
}

// UTC-middernacht. setUTCFullYear, zodat een jaar onder 100 niet 19xx wordt.
export function sortDateOf(day: Day): number {
  const d = new Date(0);
  d.setUTCFullYear(day.year, day.month - 1, day.day);
  return d.getTime();
}

export function dayFromPicker(date: Date): Day {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

// Midden op de dag van het toestel: een zomertijdwissel om middernacht
// verschuift de dag dan niet.
export function pickerDate(day: Day): Date {
  const d = new Date(2000, 0, 1, 12, 0, 0, 0);
  d.setFullYear(day.year, day.month - 1, day.day);
  return d;
}

export function formatDay(day: Day): string {
  return `${day.day} ${MONTHS[day.month - 1]} ${day.year}`;
}

function sameDay(a: Day, b: Day): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

// --- Wat Bewaar en maken meesturen (A-invariant 20, F4) ------------------------------

type Stored = Dated & { name: string; description?: string };

// Een album heeft geen omschrijving in het formulier: `description` ontbreekt.
export type Draft = { name: string; description?: string; day: Day };

export type Changes = { name?: string; description?: string; sortDate?: number };

export function changedFields(stored: Stored, draft: Draft): Changes | null {
  const out: Changes = {};
  const name = draft.name.trim();
  if (name !== stored.name.trim()) out.name = name;
  if (draft.description !== undefined) {
    const description = draft.description.trim();
    if (description !== (stored.description ?? "").trim()) out.description = description;
  }
  if (!sameDay(draft.day, dayOf(stored))) out.sortDate = sortDateOf(draft.day);
  return Object.keys(out).length > 0 ? out : null;
}

export function newGroupArgs(draft: { name: string; description: string }): { name: string; description?: string } {
  const description = draft.description.trim();
  return description ? { name: draft.name.trim(), description } : { name: draft.name.trim() };
}

// --- De melding bij een weigering (A-invariant 21) -----------------------------------

export type AdminAction =
  | "createGroup"
  | "editGroup"
  | "removeGroupCover"
  | "deleteGroup"
  | "createAlbum"
  | "editAlbum"
  | "removeAlbumCover"
  | "deleteAlbum"
  | MemberAction;

export type Refusal = { field: "name" | "date" | "general"; text: string };

const NAMED: ReadonlySet<AdminAction> = new Set(["createGroup", "editGroup", "createAlbum", "editAlbum"]);
const DATED: ReadonlySet<AdminAction> = new Set(["editGroup", "editAlbum"]);
const FOUNDER_ONLY: ReadonlySet<AdminAction> = new Set(["deleteGroup", "deleteAlbum", "transferFounder"]);
const ALBUM_SCOPED: ReadonlySet<AdminAction> = new Set(["editAlbum", "removeAlbumCover", "deleteAlbum"]);
const ON_A_MEMBER: ReadonlySet<AdminAction> = new Set(["makeAdmin", "makeMember", "transferFounder", "removeMember"]);

const GENERIC = "Dat lukte niet. Er is niets veranderd. Controleer je verbinding en probeer het opnieuw.";

const NAME_TEXT: Record<string, string> = {
  NAME_REQUIRED: "Vul een naam in.",
  NAME_TOO_LONG: "De naam is te lang. Gebruik hoogstens 50 tekens.",
  NAME_INVALID:
    "De naam bevat een teken dat niet mag, zoals een tab of een onzichtbaar teken. Haal dat weg en probeer het opnieuw.",
};

function codeOf(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return null;
  const code: unknown = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

// Alleen de code telt, nooit de tekst van de fout ("Server Error" in productie).
export function refusalOf(error: unknown, action: AdminAction): Refusal {
  const code = codeOf(error);
  const general = (text: string): Refusal => ({ field: "general", text });
  switch (code) {
    case "NAME_REQUIRED":
    case "NAME_TOO_LONG":
    case "NAME_INVALID":
      return { field: NAMED.has(action) ? "name" : "general", text: NAME_TEXT[code]! };
    case "DATE_INVALID":
      return { field: DATED.has(action) ? "date" : "general", text: "Deze datum kan niet. Kies een andere dag." };
    case "NOT_ALLOWED":
      return general(
        FOUNDER_ONLY.has(action)
          ? "Dat kan alleen de oprichter."
          : "Dat kan alleen een admin. Misschien ben je net lid gemaakt.",
      );
    case "FOUNDER_PROTECTED":
      return general("Bij de oprichter kan dat niet. Misschien is dit lid net oprichter geworden.");
    case "FOUNDER_MUST_TRANSFER":
      return general(
        "Je bent de oprichter. Maak eerst een ander lid oprichter, dan kun je de groep verlaten. Ben je het enige lid, verwijder dan de groep.",
      );
    case "NOT_MEMBER":
      if (ON_A_MEMBER.has(action)) return general("Dit lid zit niet meer in de groep, of je bent zelf geen lid meer.");
      if (ALBUM_SCOPED.has(action)) return general("Dit album bestaat niet meer, of je bent geen lid meer van de groep.");
      return general("Je bent geen lid meer van deze groep, of de groep bestaat niet meer.");
    default:
      return general(GENERIC);
  }
}

// --- Teksten bij bevestiging en succes (tabel §WP28b) -------------------------------

/** De naam van het lid, of "dit lid" zonder naam. */
export function memberLabel(name: string | null): string {
  return name ?? "dit lid";
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("nl") + text.slice(1);
}

export type Confirmation = { title: string; message: string; button: string; destructive: boolean };

export function memberConfirmation(action: MemberAction, name: string | null): Confirmation | null {
  const who = memberLabel(name);
  switch (action) {
    case "makeAdmin":
    case "makeMember":
      return null;
    case "transferFounder":
      return {
        title: `${capitalize(who)} oprichter maken?`,
        message: `${capitalize(who)} wordt admin en oprichter, en kan daarna de groep en albums verwijderen. Jij blijft admin.`,
        button: "Maak oprichter",
        destructive: false,
      };
    case "removeMember":
      return {
        title: `${capitalize(who)} uit de groep halen?`,
        message: `${capitalize(who)} ziet de groep daarna niet meer; de foto's van ${who} verdwijnen uit de albums van deze groep. Opnieuw uitnodigen kan; de foto's moeten dan opnieuw in de albums.`,
        button: "Uit de groep halen",
        destructive: true,
      };
    case "leave":
      return {
        title: "Groep verlaten?",
        message:
          "Je ziet de groep daarna niet meer. Je foto's verdwijnen uit de albums van deze groep en blijven in Mijn foto's. Terugkomen kan alleen met een nieuwe uitnodiging.",
        button: "Verlaten",
        destructive: true,
      };
  }
}

export function memberSuccess(action: MemberAction, name: string | null): string {
  const who = capitalize(memberLabel(name));
  switch (action) {
    case "makeAdmin":
      return `${who} is nu admin`;
    case "makeMember":
      return `${who} is nu lid`;
    case "transferFounder":
      return `${who} is nu de oprichter`;
    case "removeMember":
      return `${who} is uit de groep gehaald`;
    case "leave":
      return "Je hebt de groep verlaten";
  }
}

export const DELETE_GROUP_CONFIRMATION: Confirmation = {
  title: "Groep verwijderen?",
  message:
    "Alle albums verdwijnen, voor iedereen, en niemand is nog lid. De foto's blijven bij hun eigenaar in Mijn foto's. Niet ongedaan te maken.",
  button: "Verwijderen",
  destructive: true,
};

export const DELETE_ALBUM_CONFIRMATION: Confirmation = {
  title: "Album verwijderen?",
  message:
    "Het album verdwijnt voor alle leden. De foto's blijven bij hun eigenaar, en in andere albums waar ze in staan. Niet ongedaan te maken.",
  button: "Verwijderen",
  destructive: true,
};
