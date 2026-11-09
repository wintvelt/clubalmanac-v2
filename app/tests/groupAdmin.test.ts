import { ConvexError } from "convex/values";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changedFields,
  dayFromPicker,
  dayOf,
  formatDay,
  groupRights,
  memberActions,
  newGroupArgs,
  pickerDate,
  refusalOf,
  sortDateOf,
  type AdminAction,
  type Day,
  type MemberAction,
} from "../src/lib/groupAdmin";
import { displayYear, yearOf } from "../src/lib/groups";

// WP28b, pure logica achter het groeps- en albumbeheer in de app.
// Spec: docs/work-packages/WP28-groepsbeheer.md §WP28b (A-invarianten 18–21).
// De schermen zelf toetst de gate. Of het menu klopt met de backend, pint
// tests/groups/adminMenuMatchesBackend.test.ts (root).

// --- A-invariant 18: wat het menu en de knoppen tonen, per rol ----------------------
//
// Orakel met de hand, uit WP28a (besluit 1–5, A-invariant 1, A-keuze 3):
//   groep wijzigen, album maken en wijzigen   admin
//   groep en album verwijderen                oprichter
//   rol van een ander                         admin, niet bij de oprichter, alleen een echte wijziging
//   uit de groep halen                        admin, niet bij de oprichter
//   oprichter maken                           de oprichter, bij een ander lid
//   verlaten                                  jezelf, niet de oprichter
// De oprichter is altijd admin.

const FOUNDER = "u_olga";
const ADMIN = "u_anna";
const ADMIN2 = "u_bram";
const MEMBER = "u_mia";
const MEMBER2 = "u_max";

const viewer = {
  founder: { me: FOUNDER, role: "admin", founderId: FOUNDER },
  admin: { me: ADMIN, role: "admin", founderId: FOUNDER },
  member: { me: MEMBER, role: "member", founderId: FOUNDER },
} as const;

const target = {
  founder: { userId: FOUNDER, role: "admin" },
  admin: { userId: ADMIN, role: "admin" },
  admin2: { userId: ADMIN2, role: "admin" },
  member: { userId: MEMBER, role: "member" },
  member2: { userId: MEMBER2, role: "member" },
} as const;

describe("groupRights: knoppen voor groep en album", () => {
  it("een lid: niets", () => {
    expect(groupRights(viewer.member)).toEqual({
      editGroup: false,
      deleteGroup: false,
      createAlbum: false,
      editAlbum: false,
      deleteAlbum: false,
    });
  });

  it("een admin: wijzigen en album maken, niets verwijderen", () => {
    expect(groupRights(viewer.admin)).toEqual({
      editGroup: true,
      deleteGroup: false,
      createAlbum: true,
      editAlbum: true,
      deleteAlbum: false,
    });
  });

  it("de oprichter: alles", () => {
    expect(groupRights(viewer.founder)).toEqual({
      editGroup: true,
      deleteGroup: true,
      createAlbum: true,
      editAlbum: true,
      deleteAlbum: true,
    });
  });
});

describe("memberActions: het menu bij een lid", () => {
  it.each<[string, (typeof viewer)[keyof typeof viewer], (typeof target)[keyof typeof target], MemberAction[]]>([
    // Bij jezelf.
    ["lid bij zichzelf: verlaten", viewer.member, target.member, ["leave"]],
    ["admin bij zichzelf: verlaten, geen eigen rol (A-keuze 3)", viewer.admin, target.admin, ["leave"]],
    ["oprichter bij zichzelf: niets (eerst overdragen)", viewer.founder, target.founder, []],
    // Een lid kijkt naar een ander.
    ["lid bij een ander lid: niets", viewer.member, target.member2, []],
    ["lid bij een admin: niets", viewer.member, target.admin, []],
    ["lid bij de oprichter: niets", viewer.member, target.founder, []],
    // Een admin kijkt naar een ander.
    ["admin bij een lid: admin maken, uit de groep halen", viewer.admin, target.member, ["makeAdmin", "removeMember"]],
    ["admin bij een admin: lid maken, uit de groep halen", viewer.admin, target.admin2, ["makeMember", "removeMember"]],
    ["admin bij de oprichter: niets (besluit 3)", viewer.admin, target.founder, []],
    // De oprichter kijkt naar een ander.
    [
      "oprichter bij een lid: admin maken, oprichter maken, uit de groep halen",
      viewer.founder,
      target.member,
      ["makeAdmin", "transferFounder", "removeMember"],
    ],
    [
      "oprichter bij een admin: lid maken, oprichter maken, uit de groep halen",
      viewer.founder,
      target.admin,
      ["makeMember", "transferFounder", "removeMember"],
    ],
  ])("%s", (_label, v, t, expected) => {
    expect(memberActions(v, t)).toEqual(expected);
  });
});

// --- A-invariant 19: de datum is een dag --------------------------------------------
//
// sortDate is UTC-middernacht van de dag (WP28a A-keuze 5, de migratie);
// createdAt is een echt tijdstip, dus de dag in Nederlandse tijd (zoals
// formatPhotoDate in WP17a). De kiezer werkt met de klok van het toestel. Alles
// hieronder draait in drie tijdzones voor het toestel: de getoonde dag mag er
// niet van afhangen, de gekozen dag is die op het toestel.

const at = (iso: string) => Date.parse(iso);
const d = (year: number, month: number, day: number): Day => ({ year, month, day });

const ZONES = ["Europe/Amsterdam", "Pacific/Kiritimati", "America/Los_Angeles"];

describe.each(ZONES)("datum als dag, toestel in %s", (zone) => {
  const before = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });

  describe("dayOf", () => {
    it("met sortDate: de UTC-kalenderdag", () => {
      expect(dayOf({ sortDate: Date.UTC(2019, 5, 1), createdAt: at("2026-11-09T12:00:00Z") })).toEqual(d(2019, 6, 1));
      expect(dayOf({ sortDate: Date.UTC(2019, 11, 31), createdAt: 0 })).toEqual(d(2019, 12, 31));
      expect(dayOf({ sortDate: Date.UTC(1965, 0, 1), createdAt: 0 })).toEqual(d(1965, 1, 1));
    });

    it.each<[string, string, Day]>([
      ["winter, 23:30 UTC is in NL al de volgende dag", "2024-01-15T23:30:00Z", d(2024, 1, 16)],
      ["winter, 22:59 UTC is in NL nog dezelfde dag", "2024-01-15T22:59:00Z", d(2024, 1, 15)],
      ["zomer, 22:00 UTC is in NL al de volgende dag", "2024-07-15T22:00:00Z", d(2024, 7, 16)],
      ["zomer, 21:59 UTC is in NL nog dezelfde dag", "2024-07-15T21:59:00Z", d(2024, 7, 15)],
      ["zomertijd begint om 01:00 UTC; om 00:30 UTC nog wintertijd", "2024-03-31T00:30:00Z", d(2024, 3, 31)],
      ["de avond waarop de zomertijd begon", "2024-03-31T22:30:00Z", d(2024, 4, 1)],
      ["oud en nieuw: 23:30 UTC is in NL al het nieuwe jaar", "2023-12-31T23:30:00Z", d(2024, 1, 1)],
    ])("zonder sortDate, createdAt in NL-tijd: %s", (_label, iso, expected) => {
      expect(dayOf({ createdAt: at(iso) })).toEqual(expected);
    });

    it("zonder sortDate valt de dag in hetzelfde jaar als in de lijsten", () => {
      const createdAt = at("2023-12-31T23:30:00Z");
      expect(dayOf({ createdAt }).year).toBe(displayYear({ createdAt }));
    });
  });

  describe("sortDateOf", () => {
    it("UTC-middernacht van de dag", () => {
      expect(sortDateOf(d(2024, 2, 29))).toBe(Date.UTC(2024, 1, 29));
      expect(sortDateOf(d(2019, 12, 31))).toBe(Date.UTC(2019, 11, 31));
      expect(sortDateOf(d(1965, 1, 1))).toBe(Date.UTC(1965, 0, 1));
    });

    it.each([
      d(2024, 1, 1),
      d(2023, 12, 31),
      d(2024, 3, 31),
      d(2024, 10, 27),
      d(2024, 2, 29),
      d(1999, 12, 31),
      d(2000, 1, 1),
      d(1965, 6, 15),
    ])("terug naar dezelfde dag en hetzelfde jaar in de lijsten: %o", (day) => {
      const sortDate = sortDateOf(day);
      expect(dayOf({ sortDate, createdAt: at("2026-11-09T12:00:00Z") })).toEqual(day);
      expect(yearOf(sortDate)).toBe(day.year);
      expect(displayYear({ sortDate, createdAt: 0 })).toBe(day.year);
    });
  });

  describe("de kiezer", () => {
    // De Date pas in de test maken: dan geldt de tijdzone van dit blok.
    it.each<[string, () => Date, Day]>([
      ["middernacht op het toestel", () => new Date(2024, 0, 1), d(2024, 1, 1)],
      ["vlak voor middernacht op het toestel", () => new Date(2024, 11, 31, 23, 59), d(2024, 12, 31)],
      ["midden op de dag", () => new Date(2024, 6, 1, 12, 0), d(2024, 7, 1)],
      ["de dag dat de zomertijd begint", () => new Date(2024, 2, 31, 0, 0), d(2024, 3, 31)],
    ])("dayFromPicker: de dag op het toestel (%s)", (_label, date, expected) => {
      expect(dayFromPicker(date())).toEqual(expected);
    });

    it.each([d(2024, 1, 1), d(2023, 12, 31), d(2024, 3, 31), d(2024, 10, 27), d(1965, 6, 15)])(
      "pickerDate toont op het toestel dezelfde dag: %o",
      (day) => {
        const date = pickerDate(day);
        expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([day.year, day.month, day.day]);
        expect(dayFromPicker(date)).toEqual(day);
      },
    );

    it("een gemigreerde datum, via de kiezer en terug, blijft dezelfde sortDate", () => {
      const sortDate = Date.UTC(2015, 8, 12);
      const shown = pickerDate(dayOf({ sortDate, createdAt: 0 }));
      expect(sortDateOf(dayFromPicker(shown))).toBe(sortDate);
    });
  });

  it("formatDay: dag, maand voluit, jaar", () => {
    expect(formatDay(d(2023, 3, 12))).toBe("12 maart 2023");
    expect(formatDay(d(2024, 1, 1))).toBe("1 januari 2024");
    expect(formatDay(d(1999, 12, 31))).toBe("31 december 1999");
  });
});

// --- A-invariant 20: opslaan stuurt alleen wat wijzigde (F4) -------------------------

const CREATED = at("2021-05-04T10:00:00Z");
const CREATED_DAY = d(2021, 5, 4);
const LONG = "Een naam van de oude app die langer is dan vijftig tekens is"; // 60 tekens

describe("changedFields: wat Bewaar meestuurt", () => {
  const group = { name: "Club", description: "Hockey op zondag", createdAt: CREATED };

  it("de lange naam in de test is echt langer dan 50 tekens", () => {
    expect([...LONG].length).toBeGreaterThan(50);
  });

  it("niets gewijzigd: null (geen Bewaar)", () => {
    expect(changedFields(group, { name: "Club", description: "Hockey op zondag", day: CREATED_DAY })).toBeNull();
  });

  it("F4: alleen de omschrijving gewijzigd bij een gemigreerde naam boven 50 tekens: geen naam mee", () => {
    const stored = { name: LONG, description: "Oud", createdAt: CREATED };
    expect(changedFields(stored, { name: LONG, description: "Nieuw", day: CREATED_DAY })).toEqual({
      description: "Nieuw",
    });
  });

  it("F4: alleen de dag gewijzigd bij een gemigreerde naam boven 50 tekens: geen naam mee", () => {
    const stored = { name: LONG, createdAt: CREATED };
    expect(changedFields(stored, { name: LONG, description: "", day: d(2015, 9, 12) })).toEqual({
      sortDate: Date.UTC(2015, 8, 12),
    });
  });

  it("de naam gewijzigd: getrimd mee", () => {
    expect(changedFields(group, { name: "  Club Nieuw ", description: "Hockey op zondag", day: CREATED_DAY })).toEqual({
      name: "Club Nieuw",
    });
  });

  it("de naam alleen met spaties aan de rand anders: niet gewijzigd", () => {
    expect(changedFields(group, { name: " Club  ", description: "Hockey op zondag", day: CREATED_DAY })).toBeNull();
  });

  it("een gemigreerde naam met een spatie aan de rand, onaangeraakt: niet mee", () => {
    const stored = { name: `${LONG} `, createdAt: CREATED };
    expect(changedFields(stored, { name: `${LONG} `, day: CREATED_DAY })).toBeNull();
  });

  it("de naam leeggemaakt: mee, zodat de backend NAME_REQUIRED geeft", () => {
    expect(changedFields(group, { name: "   ", description: "Hockey op zondag", day: CREATED_DAY })).toEqual({
      name: "",
    });
  });

  it("geen omschrijving en een leeg veld: niet gewijzigd", () => {
    const stored = { name: "Club", createdAt: CREATED };
    expect(changedFields(stored, { name: "Club", description: "", day: CREATED_DAY })).toBeNull();
    expect(changedFields(stored, { name: "Club", description: "  ", day: CREATED_DAY })).toBeNull();
  });

  it("de omschrijving leeggemaakt: een lege omschrijving mee", () => {
    expect(changedFields(group, { name: "Club", description: " ", day: CREATED_DAY })).toEqual({ description: "" });
  });

  it("de omschrijving gewijzigd: getrimd mee", () => {
    expect(changedFields(group, { name: "Club", description: " Hockey op zaterdag ", day: CREATED_DAY })).toEqual({
      description: "Hockey op zaterdag",
    });
  });

  it("een album (geen omschrijving in het formulier): nooit een omschrijving mee", () => {
    const album = { name: "Toernooi", description: "van de oude app", createdAt: CREATED };
    expect(changedFields(album, { name: "Toernooi", day: CREATED_DAY })).toBeNull();
    expect(changedFields(album, { name: "Toernooi 2", day: CREATED_DAY })).toEqual({ name: "Toernooi 2" });
  });

  it("zonder sortDate, de dag van createdAt onaangeraakt: geen sortDate mee (niet zoals v1)", () => {
    // 23:30 UTC in de winter is in NL al de volgende dag: dat is de dag die het formulier toont.
    const stored = { name: "Club", createdAt: at("2024-01-15T23:30:00Z") };
    expect(changedFields(stored, { name: "Club", day: dayOf(stored) })).toBeNull();
    expect(changedFields(stored, { name: "Club", day: d(2024, 1, 16) })).toBeNull();
  });

  it("met sortDate, dezelfde dag: geen sortDate mee", () => {
    const stored = { name: "Club", sortDate: Date.UTC(2019, 5, 1), createdAt: CREATED };
    expect(changedFields(stored, { name: "Club", day: d(2019, 6, 1) })).toBeNull();
  });

  it("een andere dag: sortDate is UTC-middernacht van die dag", () => {
    const stored = { name: "Club", sortDate: Date.UTC(2019, 5, 1), createdAt: CREATED };
    expect(changedFields(stored, { name: "Club", day: d(2019, 6, 2) })).toEqual({ sortDate: Date.UTC(2019, 5, 2) });
  });

  it("alles gewijzigd: alles mee", () => {
    expect(changedFields(group, { name: "Club 2", description: "Ook op woensdag", day: d(2020, 1, 1) })).toEqual({
      name: "Club 2",
      description: "Ook op woensdag",
      sortDate: Date.UTC(2020, 0, 1),
    });
  });
});

describe("newGroupArgs: wat Groep maken meestuurt", () => {
  it("naam en omschrijving, getrimd", () => {
    expect(newGroupArgs({ name: " Club ", description: " Hockey " })).toEqual({ name: "Club", description: "Hockey" });
  });

  it("een lege omschrijving gaat niet mee", () => {
    expect(newGroupArgs({ name: "Club", description: "  " })).toEqual({ name: "Club" });
    expect(newGroupArgs({ name: "Club", description: "" })).toEqual({ name: "Club" });
  });
});

// --- A-invariant 21: de melding uit de code ------------------------------------------

const MEMBER_ACTIONS: MemberAction[] = ["makeAdmin", "makeMember", "transferFounder", "removeMember", "leave"];
const ALL_ACTIONS: AdminAction[] = [
  "createGroup",
  "editGroup",
  "removeGroupCover",
  "deleteGroup",
  "createAlbum",
  "editAlbum",
  "removeAlbumCover",
  "deleteAlbum",
  ...MEMBER_ACTIONS,
];
const NAMED: AdminAction[] = ["createGroup", "editGroup", "createAlbum", "editAlbum"];
const ADMIN_ONLY: AdminAction[] = [
  "editGroup",
  "removeGroupCover",
  "createAlbum",
  "editAlbum",
  "removeAlbumCover",
  "makeAdmin",
  "makeMember",
  "removeMember",
];
const FOUNDER_ONLY: AdminAction[] = ["deleteGroup", "deleteAlbum", "transferFounder"];
const GROUP_SCOPED: AdminAction[] = ["editGroup", "removeGroupCover", "deleteGroup", "createAlbum", "leave"];
const ALBUM_SCOPED: AdminAction[] = ["editAlbum", "removeAlbumCover", "deleteAlbum"];
const ON_A_MEMBER: AdminAction[] = ["makeAdmin", "makeMember", "transferFounder", "removeMember"];

const CODES = [
  "NAME_REQUIRED",
  "NAME_TOO_LONG",
  "NAME_INVALID",
  "DATE_INVALID",
  "NOT_ALLOWED",
  "FOUNDER_PROTECTED",
  "FOUNDER_MUST_TRANSFER",
  "NOT_MEMBER",
] as const;

const refused = (code: string) => new ConvexError({ code });
const generic = () => refusalOf(new Error("x"), "editGroup");

function looksTechnical(text: string): boolean {
  return /[A-Z]{2,}_[A-Z]|Error|error|undefined|null|\[object|Convex/.test(text);
}

describe("refusalOf: de NL-melding en waar hij staat", () => {
  it.each(CODES.flatMap((code) => ALL_ACTIONS.map((action) => [code, action] as const)))(
    "%s bij %s: een NL-tekst zonder code",
    (code, action) => {
      const { text } = refusalOf(refused(code), action);
      expect(text.trim().length).toBeGreaterThan(0);
      expect(looksTechnical(text)).toBe(false);
    },
  );

  describe("naam en datum: bij het veld", () => {
    it.each(NAMED)("%s: de drie naamcodes onder de naam, drie verschillende teksten", (action) => {
      const all = (["NAME_REQUIRED", "NAME_TOO_LONG", "NAME_INVALID"] as const).map((c) => refusalOf(refused(c), action));
      for (const r of all) expect(r.field).toBe("name");
      expect(new Set(all.map((r) => r.text)).size).toBe(3);
    });

    it.each(NAMED)("%s: NAME_TOO_LONG noemt het maximum van 50", (action) => {
      expect(refusalOf(refused("NAME_TOO_LONG"), action).text).toContain("50");
    });

    it.each(["editGroup", "editAlbum"] as AdminAction[])("%s: DATE_INVALID onder de datum", (action) => {
      expect(refusalOf(refused("DATE_INVALID"), action).field).toBe("date");
    });

    it.each(CODES.filter((c) => !c.startsWith("NAME_") && c !== "DATE_INVALID"))(
      "%s: bij de knop, niet bij een veld",
      (code) => {
        for (const action of ALL_ACTIONS) expect(refusalOf(refused(code), action).field).toBe("general");
      },
    );
  });

  describe("NOT_ALLOWED: wie het wel mag", () => {
    it.each(ADMIN_ONLY)("%s: alleen een admin", (action) => {
      const { text } = refusalOf(refused("NOT_ALLOWED"), action);
      expect(text).toMatch(/admin/i);
      expect(text).not.toMatch(/oprichter/i);
    });

    it.each(FOUNDER_ONLY)("%s: alleen de oprichter", (action) => {
      expect(refusalOf(refused("NOT_ALLOWED"), action).text).toMatch(/oprichter/i);
    });
  });

  describe("de oprichter", () => {
    it.each(["makeMember", "makeAdmin", "removeMember"] as AdminAction[])(
      "%s: FOUNDER_PROTECTED noemt de oprichter",
      (action) => {
        expect(refusalOf(refused("FOUNDER_PROTECTED"), action).text).toMatch(/oprichter/i);
      },
    );

    it("leave: FOUNDER_MUST_TRANSFER zegt eerst een ander oprichter te maken, en is een andere tekst", () => {
      const { text } = refusalOf(refused("FOUNDER_MUST_TRANSFER"), "leave");
      expect(text).toMatch(/oprichter/i);
      expect(text).not.toBe(refusalOf(refused("FOUNDER_PROTECTED"), "removeMember").text);
    });
  });

  describe("NOT_MEMBER: wat er weg kan zijn", () => {
    it.each(GROUP_SCOPED)("%s: de groep", (action) => {
      expect(refusalOf(refused("NOT_MEMBER"), action).text).toMatch(/groep/i);
    });

    it.each(ALBUM_SCOPED)("%s: het album", (action) => {
      expect(refusalOf(refused("NOT_MEMBER"), action).text).toMatch(/album/i);
    });

    it.each(ON_A_MEMBER)("%s: het lid kan weg zijn, een andere tekst dan bij de groep", (action) => {
      const { text } = refusalOf(refused("NOT_MEMBER"), action);
      expect(text).toMatch(/lid/i);
      expect(text).not.toBe(refusalOf(refused("NOT_MEMBER"), "editGroup").text);
    });
  });

  describe("al het andere: één algemene melding", () => {
    it.each<[string, unknown]>([
      ["Server Error", new Error("[Request ID: abc] Server Error")],
      ["geen netwerk", new TypeError("Network request failed")],
      ["een gewone Error met de tekst van een code", new Error("NOT_ALLOWED")],
      ["ConvexError met een onbekende code", new ConvexError({ code: "PHOTO_LIMIT_REACHED" })],
      ["ConvexError met een string", new ConvexError("NOT_ALLOWED")],
      ["ConvexError zonder code", new ConvexError({})],
      ["geen Error", "NOT_ALLOWED"],
      ["undefined", undefined],
    ])("%s", (_label, error) => {
      for (const action of ALL_ACTIONS) {
        const r = refusalOf(error, action);
        expect(r).toEqual(generic());
      }
      expect(generic().field).toBe("general");
      expect(generic().text.trim().length).toBeGreaterThan(0);
      expect(looksTechnical(generic().text)).toBe(false);
    });

    it("de algemene melding is een andere dan elke codemelding", () => {
      for (const code of CODES) {
        for (const action of ALL_ACTIONS) {
          expect(refusalOf(refused(code), action).text).not.toBe(generic().text);
        }
      }
    });
  });
});
