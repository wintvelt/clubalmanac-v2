import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  albumsByYear,
  decodeLastGroup,
  encodeLastGroup,
  groupErrorKind,
  homeTarget,
  memberSections,
  sortMyGroups,
  unreadBadge,
  yearOf,
} from "../src/lib/groups";

// WP16, pure logica achter Mijn groepen, Groep (Albums, Leden) en Home.
// Spec: docs/work-packages/WP16-groepen.md §Spec-criticus aanvullingen.
// De schermen zelf test de gate; hier staat wat er getoond wordt en in welke
// volgorde, niet hoe.

// Momenten in UTC; de app rekent in Nederlandse tijd (invariant 11).
const at = (iso: string) => Date.parse(iso);

// --- yearOf (invariant 11) ---------------------------------------------------

describe("yearOf: kalenderjaar in Nederlandse tijd", () => {
  it("1 januari 00:30 in NL is al het nieuwe jaar, ook al is het in UTC nog oud", () => {
    expect(yearOf(at("2023-12-31T23:30:00Z"))).toBe(2024);
  });

  it("31 december 23:30 in NL is nog het oude jaar", () => {
    expect(yearOf(at("2023-12-31T22:30:00Z"))).toBe(2023);
  });

  it("een gemigreerde datum (UTC-middernacht) blijft in zijn eigen jaar", () => {
    expect(yearOf(at("2020-01-01T00:00:00Z"))).toBe(2020);
    expect(yearOf(at("2019-12-31T00:00:00Z"))).toBe(2019);
  });

  it("midden in de zomer (zomertijd)", () => {
    expect(yearOf(at("2022-07-01T12:00:00Z"))).toBe(2022);
  });
});

// --- albumsByYear (Groep → Albums) ------------------------------------------

type Album = { _id: string; name: string; createdAt: number };
const album = (_id: string, name: string, iso: string): Album => ({ _id, name, createdAt: at(iso) });

describe("albumsByYear", () => {
  it("geen albums: geen jaren", () => {
    expect(albumsByYear([])).toEqual([]);
  });

  it("jaren nieuwste eerst, binnen een jaar nieuwste eerst", () => {
    const list = [
      album("a", "Kamp", "2019-08-01T10:00:00Z"),
      album("b", "Weekend", "2021-03-01T10:00:00Z"),
      album("c", "Etentje", "2021-11-01T10:00:00Z"),
      album("d", "Feest", "2020-06-01T10:00:00Z"),
    ];
    const years = albumsByYear(list);
    expect(years.map((y) => y.year)).toEqual([2021, 2020, 2019]);
    expect(years[0]!.albums.map((a) => a._id)).toEqual(["c", "b"]);
    expect(years[1]!.albums.map((a) => a._id)).toEqual(["d"]);
    expect(years[2]!.albums.map((a) => a._id)).toEqual(["a"]);
  });

  it("zelfde moment: op naam, zonder onderscheid tussen hoofd- en kleine letters", () => {
    const iso = "2021-05-05T10:00:00Z";
    const years = albumsByYear([album("1", "zomer", iso), album("2", "Bruiloft", iso), album("3", "appel", iso)]);
    expect(years[0]!.albums.map((a) => a.name)).toEqual(["appel", "Bruiloft", "zomer"]);
  });

  it("zelfde moment en zelfde naam: toch een vaste volgorde", () => {
    const iso = "2021-05-05T10:00:00Z";
    const one = albumsByYear([album("x2", "Kamp", iso), album("x1", "Kamp", iso)]);
    const two = albumsByYear([album("x1", "Kamp", iso), album("x2", "Kamp", iso)]);
    expect(one[0]!.albums.map((a) => a._id)).toEqual(two[0]!.albums.map((a) => a._id));
  });

  it("een album van 1 januari 00:30 (NL) staat onder het nieuwe jaar", () => {
    const years = albumsByYear([album("n", "Nieuwjaar", "2023-12-31T23:30:00Z")]);
    expect(years.map((y) => y.year)).toEqual([2024]);
  });

  it("de albums blijven zoals ze binnenkomen, met hun eigen velden (zoals de teller)", () => {
    const withCount = { ...album("a", "Kamp", "2019-08-01T10:00:00Z"), unreadCount: 4 };
    const input = [withCount];
    const years = albumsByYear(input);
    expect(years[0]!.albums[0]).toEqual(withCount);
    expect(input).toEqual([withCount]);
  });
});

// --- sortMyGroups (Mijn groepen) --------------------------------------------

type Group = { _id: string; name: string; createdAt: number };
const group = (_id: string, name: string, iso: string): Group => ({ _id, name, createdAt: at(iso) });

describe("sortMyGroups", () => {
  it("nieuwste groep eerst", () => {
    const sorted = sortMyGroups([
      group("old", "Oud", "2015-01-01T00:00:00Z"),
      group("new", "Nieuw", "2022-01-01T00:00:00Z"),
      group("mid", "Midden", "2018-01-01T00:00:00Z"),
    ]);
    expect(sorted.map((g) => g._id)).toEqual(["new", "mid", "old"]);
  });

  it("zelfde datum: op naam", () => {
    const iso = "2020-01-01T00:00:00Z";
    const sorted = sortMyGroups([group("1", "zeilen", iso), group("2", "Atletiek", iso)]);
    expect(sorted.map((g) => g.name)).toEqual(["Atletiek", "zeilen"]);
  });

  it("verandert de invoer niet", () => {
    const input = [group("a", "A", "2015-01-01T00:00:00Z"), group("b", "B", "2022-01-01T00:00:00Z")];
    const copy = [...input];
    sortMyGroups(input);
    expect(input).toEqual(copy);
  });
});

// --- memberSections (Groep → Leden) ------------------------------------------

type Member = {
  membership: { _id: string; userId: string; groupId: string; role: "admin" | "member"; joinedAt: number };
  user: { _id: string; name?: string } | null;
};
let seq = 0;
function member(userId: string, role: "admin" | "member", name?: string, withUser = true): Member {
  seq += 1;
  return {
    membership: { _id: `m${seq}`, userId, groupId: "g", role, joinedAt: at("2020-01-01T00:00:00Z") },
    user: withUser ? { _id: userId, ...(name !== undefined ? { name } : {}) } : null,
  };
}

const ids = (s: { members: Member[] }) => s.members.map((m) => m.membership.userId);

describe("memberSections", () => {
  it("eerst de admins, dan de leden", () => {
    const sections = memberSections([member("u1", "member", "Anna"), member("u2", "admin", "Bert")], {
      meId: "u1",
      founderId: "u2",
    });
    expect(sections.map((s) => s.role)).toEqual(["admin", "member"]);
    expect(ids(sections[0]!)).toEqual(["u2"]);
    expect(ids(sections[1]!)).toEqual(["u1"]);
  });

  it("een lege sectie valt weg", () => {
    const sections = memberSections([member("u1", "admin", "Anna")], { meId: "u1", founderId: "u1" });
    expect(sections.map((s) => s.role)).toEqual(["admin"]);
  });

  it("binnen een sectie op naam: hoofdletters en accenten tellen niet", () => {
    const sections = memberSections(
      [
        member("f", "member", "frank"),
        member("e", "member", "Émile"),
        member("d", "member", "Daan"),
        member("a", "member", "anna"),
      ],
      { meId: "a", founderId: "x" },
    );
    expect(ids(sections[0]!)).toEqual(["a", "d", "e", "f"]);
  });

  it("zonder naam, of zonder user-rij: onderaan de sectie", () => {
    const sections = memberSections(
      [member("n", "member"), member("z", "member", "Zoë"), member("gone", "member", undefined, false), member("b", "member", "Bas")],
      { meId: "b", founderId: "x" },
    );
    expect(ids(sections[0]!).slice(0, 2)).toEqual(["b", "z"]);
    expect(ids(sections[0]!).slice(2).sort()).toEqual(["gone", "n"]);
  });

  it("een naam van alleen spaties telt als geen naam", () => {
    const sections = memberSections([member("s", "member", "   "), member("a", "member", "Anna")], {
      meId: "a",
      founderId: "x",
    });
    expect(ids(sections[0]!)).toEqual(["a", "s"]);
  });

  it("markeert jou en de oprichter, los van de rol", () => {
    const sections = memberSections(
      [member("me", "member", "Ik"), member("founder", "member", "Oprichter"), member("x", "admin", "Ander")],
      { meId: "me", founderId: "founder" },
    );
    const all = sections.flatMap((s) => s.members);
    const by = (id: string) => all.find((m) => m.membership.userId === id)!;
    expect(by("me").isMe).toBe(true);
    expect(by("me").isFounder).toBe(false);
    expect(by("founder").isFounder).toBe(true);
    expect(by("founder").isMe).toBe(false);
    expect(by("x").isMe).toBe(false);
    expect(by("x").isFounder).toBe(false);
  });

  it("geeft de leden met hun eigen velden terug", () => {
    const input = member("u1", "admin", "Anna");
    const [section] = memberSections([input], { meId: "u1", founderId: "u1" });
    expect(section!.members[0]).toMatchObject(input);
  });
});

// --- unreadBadge (teller per album en per groep) ---------------------------------

describe("unreadBadge", () => {
  it.each([0, -1, Number.NaN])("%s: geen teller", (n) => {
    expect(unreadBadge(n)).toBeNull();
  });

  it("1: enkelvoud voor VoiceOver", () => {
    expect(unreadBadge(1)).toEqual({ text: "1", accessibilityLabel: "1 nieuwe foto" });
  });

  it("3: meervoud", () => {
    expect(unreadBadge(3)).toEqual({ text: "3", accessibilityLabel: "3 nieuwe foto's" });
  });

  it("een groot getal staat er volledig (invariant 1: niets verbergen)", () => {
    expect(unreadBadge(250)?.text).toBe("250");
  });
});

// --- groupErrorKind (invariant 9) ---------------------------------------------

describe("groupErrorKind", () => {
  it("ConvexError met code NOT_MEMBER: niet (meer) lid", () => {
    expect(groupErrorKind(new ConvexError({ code: "NOT_MEMBER" }))).toBe("notMember");
  });

  it("een andere code: gewone fout", () => {
    expect(groupErrorKind(new ConvexError({ code: "NAME_EMPTY" }))).toBe("other");
  });

  it("nooit op de tekst: een gewone Error met 'Geen lid' is een gewone fout", () => {
    expect(groupErrorKind(new Error("Geen lid van deze groep"))).toBe("other");
    expect(groupErrorKind(new ConvexError("NOT_MEMBER"))).toBe("other");
  });

  it.each([undefined, null, "NOT_MEMBER", { code: "NOT_MEMBER" }])("%s: gewone fout", (e) => {
    expect(groupErrorKind(e)).toBe("other");
  });
});

// --- homeTarget (invarianten 6 en 12) ---------------------------------------------

describe("homeTarget", () => {
  const groups = [{ _id: "g1" }, { _id: "g2" }];

  it("geen onthouden groep: Mijn groepen, ook als de groepen nog laden", () => {
    expect(homeTarget({ lastGroupId: null, myGroups: undefined })).toEqual({ kind: "myGroups", forget: false });
    expect(homeTarget({ lastGroupId: null, myGroups: groups })).toEqual({ kind: "myGroups", forget: false });
  });

  it("onthouden groep, groepen nog onbekend: wachten, geen flits", () => {
    expect(homeTarget({ lastGroupId: "g1", myGroups: undefined })).toEqual({ kind: "wait" });
  });

  it("onthouden groep waar je lid van bent: die groep", () => {
    expect(homeTarget({ lastGroupId: "g2", myGroups: groups })).toEqual({ kind: "group", groupId: "g2" });
  });

  it("onthouden groep waar je geen lid meer van bent: Mijn groepen en vergeten", () => {
    expect(homeTarget({ lastGroupId: "weg", myGroups: groups })).toEqual({ kind: "myGroups", forget: true });
    expect(homeTarget({ lastGroupId: "g1", myGroups: [] })).toEqual({ kind: "myGroups", forget: true });
  });
});

// --- het geheugen voor de laatst bezochte groep (invariant 6) -------------------------

describe("encodeLastGroup / decodeLastGroup", () => {
  it("dezelfde user krijgt zijn groep terug", () => {
    expect(decodeLastGroup(encodeLastGroup("user_a", "g1"), "user_a")).toBe("g1");
  });

  it("een andere user krijgt niets", () => {
    expect(decodeLastGroup(encodeLastGroup("user_a", "g1"), "user_b")).toBeNull();
  });

  it.each([null, "", "g1", "{", "{}", "[]", "null", '{"groupId":5}'])("onleesbaar (%s): niets", (raw) => {
    expect(decodeLastGroup(raw, "user_a")).toBeNull();
  });
});
