import { describe, expect, it } from "vitest";
import { groupPath, albumPath, photoPath, editGroupPath, invitePath, newAlbumPath, filmPath, newGroupPath } from "../src/lib/groupRoutes";
import { homeButton, homeGroupOf, type HomeGroup } from "../src/lib/homeGroup";

// WP32: de thuisgroep en de Home-knop. Pure logica; de schermen en de stack
// toetst B in de simulator en Wouter op een toestel.
// Spec: docs/work-packages/WP32-thuisgroep-ui-fixes.md, invarianten 1, 4–6 en 8,
// A-aanvullingen A2, A4 en A7.

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

// --- homeButton (invariant 6; A4, A7) --------------------------------------------------

const HOME: HomeGroup = { kind: "group", groupId: "g1", name: "De Zeilclub" };
const NONE: HomeGroup = { kind: "none" };
const UNKNOWN: HomeGroup = { kind: "unknown" };

describe("homeButton: icoon, bestemming en label van de Home-knop", () => {
  describe("op Mijn groepen", () => {
    it.each([HOME, NONE, UNKNOWN])("huisje, en tikken doet niets (%o)", (homeGroup) => {
      const button = homeButton({ pathname: "/", homeGroup });
      expect(button.icon).toBe("home");
      expect(button.target).toEqual({ kind: "none" });
      expect(button.accessibilityLabel).toContain("Home");
      expect(button.accessibilityLabel).toContain("Mijn groepen");
    });
  });

  describe("op de groepspagina van de thuisgroep", () => {
    it("groepen-icoon, naar Mijn groepen", () => {
      const button = homeButton({ pathname: groupPath("g1"), homeGroup: HOME });
      expect(button.icon).toBe("groups");
      expect(button.target).toEqual({ kind: "myGroups" });
      expect(button.accessibilityLabel).toContain("Home");
      expect(button.accessibilityLabel).toContain("Mijn groepen");
      expect(button.accessibilityLabel).not.toContain("De Zeilclub");
    });
  });

  describe("elders onder Home: huisje, naar de thuisgroep", () => {
    it.each([
      ["album van de thuisgroep", albumPath("g1", "a1")],
      ["foto in de thuisgroep", photoPath("g1", "a1", "p1")],
      ["film in de thuisgroep", filmPath("g1", "f1")],
      ["Bewerk groep", editGroupPath("g1")],
      ["Uitnodigen", invitePath("g1")],
      ["Nieuw album", newAlbumPath("g1")],
      ["Nieuwe groep", newGroupPath()],
      ["een andere groep", groupPath("g2")],
      ["album in een andere groep", albumPath("g2", "a7")],
    ])("%s", (_where, pathname) => {
      const button = homeButton({ pathname, homeGroup: HOME });
      expect(button.icon).toBe("home");
      expect(button.target).toEqual({ kind: "group", groupId: "g1" });
      expect(button.accessibilityLabel).toContain("Home");
      expect(button.accessibilityLabel).toContain("De Zeilclub");
    });

    it("een groep waarvan het id met dat van de thuisgroep begint, is een andere groep", () => {
      const button = homeButton({ pathname: groupPath("g1x"), homeGroup: HOME });
      expect(button.icon).toBe("home");
      expect(button.target).toEqual({ kind: "group", groupId: "g1" });
    });
  });

  describe("zonder thuisgroep: huisje, naar Mijn groepen", () => {
    it.each([NONE, UNKNOWN])("elders onder Home (%o)", (homeGroup) => {
      for (const pathname of [groupPath("g1"), albumPath("g1", "a1"), photoPath("g2", "a7", "p3"), newGroupPath()]) {
        const button = homeButton({ pathname, homeGroup });
        expect(button.icon).toBe("home");
        expect(button.target).toEqual({ kind: "myGroups" });
        expect(button.accessibilityLabel).toContain("Home");
        expect(button.accessibilityLabel).toContain("Mijn groepen");
      }
    });
  });

  // Open vraag 1 in de spec (advies a): vanaf een andere tab gaat Home naar de
  // thuisgroep, zoals de rij "elders" en de oude app. Kiest Wouter (b), dan
  // past A deze test aan.
  describe("vanaf een andere tab (open vraag 1, advies a)", () => {
    it.each(["/mijn-fotos", "/mijn-fotos/foto/p1", "/profiel", "/profiel/uitnodigingen", "/instellingen"])(
      "%s: huisje, naar de thuisgroep",
      (pathname) => {
        const button = homeButton({ pathname, homeGroup: HOME });
        expect(button.icon).toBe("home");
        expect(button.target).toEqual({ kind: "group", groupId: "g1" });
        expect(button.accessibilityLabel).toContain("De Zeilclub");
      },
    );

    it("zonder thuisgroep: naar Mijn groepen", () => {
      const button = homeButton({ pathname: "/profiel", homeGroup: NONE });
      expect(button.target).toEqual({ kind: "myGroups" });
    });
  });

  it("nooit naar een groep zolang de thuisgroep onbekend is (A4)", () => {
    for (const pathname of ["/", groupPath("g1"), albumPath("g1", "a1"), "/profiel", "/mijn-fotos"]) {
      expect(homeButton({ pathname, homeGroup: UNKNOWN }).target.kind).not.toBe("group");
    }
  });
});
