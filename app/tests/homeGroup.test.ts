import { describe, expect, it } from "vitest";
import { groupPath, albumPath, photoPath, editGroupPath, invitePath, newAlbumPath, filmPath, newGroupPath } from "../src/lib/groupRoutes";
import {
  groupIdOfPath,
  homeButton,
  homeGroupOf,
  trackTabOrigin,
  type HomeGroup,
  type TabOrigin,
} from "../src/lib/homeGroup";

// WP32: de thuisgroep en de Home-knop. Pure logica; de schermen en de stack
// toetst B in de simulator en Wouter op een toestel.
// Spec: docs/work-packages/WP32-thuisgroep-ui-fixes.md, invarianten 1, 4–6 en 8,
// besluiten Wouter 2026-11-17, A-aanvullingen A1, A2, A4, A7 en A9.

const groups = [
  { _id: "g1", name: "De Zeilclub" },
  { _id: "g2", name: "Familie" },
];
const one = [{ _id: "g9", name: "Enige groep" }];

// --- homeGroupOf (invarianten 1, 4, 5, 8; A2) ---------------------------------------

describe("homeGroupOf: welke groep is de thuisgroep", () => {
  it("laatst bezocht en nog lid: die groep, met zijn naam", () => {
    expect(homeGroupOf({ storedGroupId: "g2", myGroups: groups })).toEqual({
      kind: "group",
      groupId: "g2",
      name: "Familie",
    });
  });

  it("nooit een groep bezocht, precies één groep: die groep", () => {
    expect(homeGroupOf({ storedGroupId: null, myGroups: one })).toEqual({
      kind: "group",
      groupId: "g9",
      name: "Enige groep",
    });
  });

  it("nooit een groep bezocht, meerdere groepen: geen thuisgroep", () => {
    expect(homeGroupOf({ storedGroupId: null, myGroups: groups })).toEqual({ kind: "none" });
  });

  it("geen groepen: geen thuisgroep", () => {
    expect(homeGroupOf({ storedGroupId: null, myGroups: [] })).toEqual({ kind: "none" });
    expect(homeGroupOf({ storedGroupId: "g1", myGroups: [] })).toEqual({ kind: "none" });
  });

  describe("geen lid meer van de opgeslagen groep (invarianten 4 en 8)", () => {
    it("nog in precies één andere groep: die groep", () => {
      expect(homeGroupOf({ storedGroupId: "g1", myGroups: one })).toEqual({
        kind: "group",
        groupId: "g9",
        name: "Enige groep",
      });
    });

    it("nog in meerdere andere groepen: geen thuisgroep", () => {
      expect(homeGroupOf({ storedGroupId: "weg", myGroups: groups })).toEqual({ kind: "none" });
    });

    it("de opgeslagen groep komt nooit terug als je er geen lid van bent", () => {
      for (const myGroups of [[], one, groups]) {
        const home = homeGroupOf({ storedGroupId: "weg", myGroups });
        expect(home.kind === "group" ? home.groupId : null).not.toBe("weg");
      }
    });
  });

  describe("nog niet bekend (A2: geen flits)", () => {
    it("de groepenlijst laadt nog: onbekend, ook zonder opgeslagen groep", () => {
      // Zonder lijst weet de app niet of je in precies één groep zit.
      expect(homeGroupOf({ storedGroupId: null, myGroups: undefined })).toEqual({ kind: "unknown" });
      expect(homeGroupOf({ storedGroupId: "g1", myGroups: undefined })).toEqual({ kind: "unknown" });
    });

    it("de opgeslagen waarde is nog niet gelezen: onbekend, ook met de lijst", () => {
      expect(homeGroupOf({ storedGroupId: undefined, myGroups: groups })).toEqual({ kind: "unknown" });
      expect(homeGroupOf({ storedGroupId: undefined, myGroups: one })).toEqual({ kind: "unknown" });
    });
  });
});

// --- groupIdOfPath (A1; tabel invariant 6) -----------------------------------------------

describe("groupIdOfPath: bij welke groep hoort een scherm", () => {
  it.each([
    ["groepspagina", groupPath("g1")],
    ["album", albumPath("g1", "a1")],
    ["foto", photoPath("g1", "a1", "p1")],
    ["film", filmPath("g1", "f1")],
    ["Bewerk groep", editGroupPath("g1")],
    ["Uitnodigen", invitePath("g1")],
    ["Nieuw album", newAlbumPath("g1")],
    ["kaart", `${albumPath("g1", "a1")}/kaart`],
    ["draaien", `${albumPath("g1", "a1")}/draaien/p1`],
  ])("%s: die groep", (_what, pathname) => {
    expect(groupIdOfPath(pathname)).toBe("g1");
  });

  it("een gecodeerd id komt gedecodeerd terug", () => {
    expect(groupIdOfPath(groupPath("g 1/x"))).toBe("g 1/x");
  });

  it.each(["/", newGroupPath(), "/mijn-fotos", "/mijn-fotos/foto/p1", "/profiel", "/instellingen", "/toevoegen", "/groep"])(
    "%s: geen groep (Mijn foto's en Toevoegen zijn geen bezoek)",
    (pathname) => {
      expect(groupIdOfPath(pathname)).toBeNull();
    },
  );
});

// --- trackTabOrigin (besluit 1, A9) ------------------------------------------------------

// Loopt de paden af zoals de app ze ziet en geeft de herkomst op het eind.
function walk(paths: string[]): TabOrigin {
  let origin: TabOrigin = { pathname: null, cameFrom: null };
  for (const p of paths) origin = trackTabOrigin(origin, p);
  return origin;
}

describe("trackTabOrigin: vanaf waar kwam de user op deze tab", () => {
  it("koude start: onbekend", () => {
    expect(walk(["/profiel"]).cameFrom).toBeNull();
  });

  it("van Mijn groepen naar een andere tab: Mijn groepen", () => {
    expect(walk(["/", "/profiel"]).cameFrom).toBe("/");
  });

  it("binnen die tab dieper: blijft Mijn groepen", () => {
    expect(walk(["/", "/profiel", "/profiel/uitnodigingen"]).cameFrom).toBe("/");
    expect(walk(["/", "/mijn-fotos", "/mijn-fotos/foto/p1"]).cameFrom).toBe("/");
  });

  it("van een album naar een andere tab: dat album", () => {
    expect(walk(["/", groupPath("g1"), albumPath("g1", "a1"), "/mijn-fotos"]).cameFrom).toBe(albumPath("g1", "a1"));
  });

  it("nog een tab verder is niet meer rechtstreeks (A9)", () => {
    expect(walk(["/", "/profiel", "/instellingen"]).cameFrom).toBe("/profiel");
  });

  it("Toevoegen openen en sluiten is geen tab-wissel", () => {
    expect(walk(["/", "/toevoegen", "/", "/profiel"]).cameFrom).toBe("/");
    expect(walk(["/", "/profiel", "/toevoegen", "/profiel"]).cameFrom).toBe("/");
  });

  it("terug op Home en weer weg: de nieuwe plek telt", () => {
    expect(walk(["/", "/profiel", "/", groupPath("g1"), "/profiel"]).cameFrom).toBe(groupPath("g1"));
  });
});

// --- homeButton (invariant 6, besluiten 1 en 2; A4, A7) ---------------------------------

const HOME: HomeGroup = { kind: "group", groupId: "g1", name: "De Zeilclub" };
const NONE: HomeGroup = { kind: "none" };
const UNKNOWN: HomeGroup = { kind: "unknown" };

const press = (pathname: string, homeGroup: HomeGroup, cameFrom: string | null = null) =>
  homeButton({ pathname, homeGroup, cameFrom });

function expectMyGroups(button: ReturnType<typeof homeButton>) {
  expect(button.target).toEqual({ kind: "myGroups" });
  expect(button.accessibilityLabel).toContain("Home");
  expect(button.accessibilityLabel).toContain("Mijn groepen");
}

function expectHomeGroup(button: ReturnType<typeof homeButton>) {
  expect(button.target).toEqual({ kind: "group", groupId: "g1" });
  expect(button.accessibilityLabel).toContain("Home");
  expect(button.accessibilityLabel).toContain("De Zeilclub");
}

describe("homeButton: icoon, bestemming en label van de Home-knop", () => {
  describe("op Mijn groepen", () => {
    it.each([HOME, NONE, UNKNOWN])("huisje, en tikken doet niets (%o)", (homeGroup) => {
      const button = press("/", homeGroup);
      expect(button.icon).toBe("home");
      expect(button.target).toEqual({ kind: "none" });
      expect(button.accessibilityLabel).toContain("Home");
      expect(button.accessibilityLabel).toContain("Mijn groepen");
    });
  });

  describe("op de groepspagina van de thuisgroep (besluit 2: elke bezochte groep)", () => {
    it("groepen-icoon, naar Mijn groepen", () => {
      const button = press(groupPath("g1"), HOME);
      expect(button.icon).toBe("groups");
      expectMyGroups(button);
      expect(button.accessibilityLabel).not.toContain("De Zeilclub");
    });
  });

  describe("binnen de thuisgroep: huisje, naar zijn groepspagina", () => {
    it.each([
      ["album", albumPath("g1", "a1")],
      ["foto", photoPath("g1", "a1", "p1")],
      ["film", filmPath("g1", "f1")],
      ["Bewerk groep", editGroupPath("g1")],
      ["Uitnodigen", invitePath("g1")],
      ["Nieuw album", newAlbumPath("g1")],
    ])("%s", (_where, pathname) => {
      const button = press(pathname, HOME);
      expect(button.icon).toBe("home");
      expectHomeGroup(button);
    });
  });

  // Komt na besluit 2 alleen voor zolang de groep nog laadt, of als de user er
  // geen lid van is: dan is hij (nog) niet bezocht.
  describe("in een groep die (nog) niet de thuisgroep is: huisje, naar de thuisgroep", () => {
    it.each([
      ["groepspagina", groupPath("g2")],
      ["album", albumPath("g2", "a7")],
      ["id dat met dat van de thuisgroep begint", groupPath("g1x")],
    ])("%s", (_where, pathname) => {
      const button = press(pathname, HOME);
      expect(button.icon).toBe("home");
      expectHomeGroup(button);
    });
  });

  it("Nieuwe groep (onder Home, buiten een groep): huisje, naar de thuisgroep", () => {
    const button = press(newGroupPath(), HOME);
    expect(button.icon).toBe("home");
    expectHomeGroup(button);
  });

  describe("zonder thuisgroep: huisje, naar Mijn groepen", () => {
    it.each([NONE, UNKNOWN])("onder Home (%o)", (homeGroup) => {
      for (const pathname of [groupPath("g1"), albumPath("g1", "a1"), photoPath("g2", "a7", "p3"), newGroupPath()]) {
        const button = press(pathname, homeGroup);
        expect(button.icon).toBe("home");
        expectMyGroups(button);
      }
    });
  });

  describe("op een andere tab (besluit 1)", () => {
    const tabs = ["/mijn-fotos", "/mijn-fotos/foto/p1", "/profiel", "/profiel/uitnodigingen", "/instellingen"];

    it.each(tabs)("%s, rechtstreeks vanaf Mijn groepen: huisje, terug naar Mijn groepen", (pathname) => {
      for (const homeGroup of [HOME, NONE, UNKNOWN]) {
        const button = press(pathname, homeGroup, "/");
        expect(button.icon).toBe("home");
        expectMyGroups(button);
      }
    });

    it.each(tabs)("%s, vanaf een groep of album: huisje, naar de thuisgroep", (pathname) => {
      for (const cameFrom of [groupPath("g1"), albumPath("g1", "a1"), photoPath("g2", "a7", "p3")]) {
        const button = press(pathname, HOME, cameFrom);
        expect(button.icon).toBe("home");
        expectHomeGroup(button);
      }
    });

    it.each(tabs)("%s, via een andere tab of herkomst onbekend: naar de thuisgroep (A9)", (pathname) => {
      for (const cameFrom of ["/profiel", "/instellingen", null]) {
        expectHomeGroup(press(pathname, HOME, cameFrom));
      }
    });

    it("zonder thuisgroep: naar Mijn groepen, waar de user ook vandaan kwam", () => {
      for (const homeGroup of [NONE, UNKNOWN]) {
        for (const cameFrom of ["/", groupPath("g1"), "/profiel", null]) {
          expectMyGroups(press("/profiel", homeGroup, cameFrom));
        }
      }
    });
  });

  it("de herkomst telt niet onder Home zelf", () => {
    expect(press("/", HOME, "/profiel").target).toEqual({ kind: "none" });
    expect(press(groupPath("g1"), HOME, "/profiel").icon).toBe("groups");
    expectHomeGroup(press(albumPath("g1", "a1"), HOME, "/"));
  });

  it("nooit naar een groep zolang de thuisgroep onbekend is (A4)", () => {
    for (const pathname of ["/", groupPath("g1"), albumPath("g1", "a1"), "/profiel", "/mijn-fotos"]) {
      for (const cameFrom of ["/", groupPath("g1"), null]) {
        expect(press(pathname, UNKNOWN, cameFrom).target.kind).not.toBe("group");
      }
    }
  });
});
