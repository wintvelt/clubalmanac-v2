import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { deleteMessage } from "../src/lib/photoActions";
import { filmProjectPath, newFilmProjectPath } from "../src/lib/groupRoutes";
import { originalPosterUrl } from "../src/lib/imageUrls";
import { PUBLIC_PATHS, routeAccess } from "../src/lib/routeAccess";
import { listFiles, parse } from "./support/sourceScan";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (rel: string) => (existsSync(SRC + rel) ? readFileSync(SRC + rel, "utf8") : "");

// WP38c — de routes en de randen van het filmproject buiten de eigen module.
//   - 38c-19: de projectpagina onder de groep, starten modaal naast "Nieuw
//     album", met een web-variant ("Alleen in de app", WP35 W5). Beide
//     afgeschermd (geen publiek pad).
//   - De poster van een inzending via het eigen beeldpad van 38a
//     (`/beeld/inzending/<id>`), nooit via `/beeld/foto/`.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38c.

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));
const files = existsSync(APP_DIR) ? listFiles(APP_DIR, new Set()) : [];
const HOME = "(tabs)/(home)/";

function homeRoutes(webOnly: boolean): string[] {
  return files
    .filter((f) => f.startsWith(HOME) && /\.[jt]sx?$/.test(f) && !/(^|\/)_layout\.[jt]sx?$/.test(f))
    .filter((f) => /\.web\.[jt]sx?$/.test(f) === webOnly)
    .map((f) => "/" + f.slice(HOME.length).replace(/(\.web)?\.[jt]sx?$/, "").replace(/(^|\/)index$/, ""))
    .map((p) => (p === "/" ? "/" : p.replace(/\/$/, "")));
}

describe("paden (38c-19)", () => {
  it("filmProjectPath", () => {
    expect(filmProjectPath("g1", "p1")).toBe("/groep/g1/filmproject/p1");
    expect(filmProjectPath("g 1", "p/1")).toBe("/groep/g%201/filmproject/p%2F1");
  });

  it("newFilmProjectPath", () => {
    expect(newFilmProjectPath("g1")).toBe("/groep/g1/nieuw-filmproject");
  });

  it.each([
    ["de projectpagina", () => filmProjectPath("g1", "p1")],
    ["starten", () => newFilmProjectPath("g1")],
  ] as const)("%s is niet publiek", (_name, pathOf) => {
    const path = pathOf();
    expect(PUBLIC_PATHS.has(path)).toBe(false);
    expect(routeAccess(path, "ready")).toBe("show");
    expect(routeAccess(path, "signedOut")).toBe("login");
  });
});

describe("routebestanden (38c-19)", () => {
  it("de projectpagina: /groep/[groupId]/filmproject/[projectId]", () => {
    expect(homeRoutes(false)).toContain("/groep/[groupId]/filmproject/[projectId]");
  });

  it("starten: /groep/[groupId]/nieuw-filmproject, met een web-variant (alleen in de app)", () => {
    expect(homeRoutes(false)).toContain("/groep/[groupId]/nieuw-filmproject");
    expect(homeRoutes(true)).toContain("/groep/[groupId]/nieuw-filmproject");
  });
});

describe("de poster van een inzending", () => {
  it("via /beeld/inzending/<id>, met het formaat", () => {
    const site = "https://example-123.eu-west-1.convex.site";
    expect(originalPosterUrl(site, "o1", "klein")).toBe(`${site}/beeld/inzending/o1?formaat=klein`);
    expect(originalPosterUrl(site, "o/1", "groot")).toBe(`${site}/beeld/inzending/o%2F1?formaat=groot`);
  });
});


describe("de knop 'Filmproject starten' in de schermen (besluit 1 na A)", () => {
  it("Icon kent 'key'", () => {
    expect(read("components/Icon.tsx")).toMatch(/\bkey:\s*"key"/);
  });

  it.each(["film", "download", "trash"])("Icon kent '%s' (iconen links op de knoppen van de oprichter)", (name) => {
    expect(read("components/Icon.tsx")).toMatch(new RegExp(`\\b${name}:\\s*"`));
  });
});

// Feedback Wouter na besluit 27, punt 1: de knoppen alleen voor de oprichter
// komen uit FOUNDER_BUTTONS (tekst, icoon links, label), en een knop zet de
// gele sleutel (`key`, getekend als `key-outline`, kleur `founderKey`) achter
// de tekst.
describe("de knoppen van de oprichter in de schermen (feedback na besluit 27, punt 1)", () => {
  const screens = () => listFiles(SRC + "screens", new Set()).filter((f) => /\.tsx?$/.test(f)).map((f) => read("screens/" + f)).join("\n");

  it.each(["start", "close", "changeTitle", "changeEnd", "download", "downloadAll", "removeAll"])("een scherm gebruikt FOUNDER_BUTTONS.%s", (action) => {
    const src = screens();
    expect(src.includes(`FOUNDER_BUTTONS.${action}`) || src.includes(`FOUNDER_BUTTONS["${action}"]`)).toBe(true);
  });

  it("geen START_BUTTON meer", () => {
    expect(screens()).not.toContain("START_BUTTON");
  });

  it("een knop in src/components tekent de sleutel achter de tekst: Icon 'key' in de kleur founderKey", () => {
    const components = listFiles(SRC + "components", new Set()).filter((f) => /\.tsx$/.test(f)).map((f) => read("components/" + f));
    expect(components.some((src) => src.includes("founderKey") && /name=\{?["']key["']\}?/.test(src))).toBe(true);
  });
});

// Feedback Wouter na besluit 27, punt 3: "feature-film" in plaats van
// "clubfilm" in de teksten van het filmproject. Alleen strings in de code,
// geen commentaar (de clubfilms van WP21 heten in commentaar nog zo).
describe("geen 'clubfilm' in de teksten van het filmproject (feedback na besluit 27, punt 3)", () => {
  function strings(rel: string): string[] {
    const sf = parse(read(rel), rel.split("/").pop());
    const out: string[] = [];
    const walk = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
      else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((x) => x.literal.text));
      else if (ts.isJsxText(n) && n.text.trim() !== "") out.push(n.text.trim());
      ts.forEachChild(n, walk);
    };
    walk(sf);
    return out;
  }

  it.each(["lib/filmProject.ts", "screens/FilmProjectScreens.tsx", "screens/FilmProjectParts.tsx", "screens/AddPhotosScreen.tsx", "screens/AddPhotosParts.tsx"])(
    "%s",
    (rel) => {
      expect(read(rel).length, `sanity: ${rel}`).toBeGreaterThan(0);
      expect(strings(rel).filter((x) => /clubfilm/i.test(x))).toEqual([]);
    },
  );
});

// Feedback Wouter na besluit 27, punt 2: een lege stand heeft geen icoon in een
// cirkel met verloop meer, maar het icoon zelf in de kleuren van het verloop
// (of één effen kleur daaruit). Hier alleen dat de cirkel weg is en het icoon
// niet meer wit-op-verloop is; hoe het eruitziet, toetst de gate.
describe("lege standen zonder cirkel met verloop (feedback na besluit 27, punt 2)", () => {
  it("EmptyState tekent geen Gradient als cirkel en het icoon niet in onGradient", () => {
    const sf = parse(read("components/States.tsx"), "States.tsx");
    let body = "";
    const find = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "EmptyState" && n.body) body = n.body.getText(sf);
      ts.forEachChild(n, find);
    };
    find(sf);
    expect(body.length, "sanity: function EmptyState").toBeGreaterThan(0);
    expect(body).not.toMatch(/<Gradient[^>]*radius/);
    expect(body).not.toContain("onGradient");
  });
});

describe("filmpje verwijderen noemt het origineel (besluit 16, besluit 7 na A)", () => {
  it("de bevestiging in het menu heeft de zin over het origineel", () => {
    const text = read("screens/PhotoMenu.tsx") + read("lib/photoActions.ts");
    expect(text).toContain("Is het ingestuurd voor een filmproject, dan gaat het origineel ook weg.");
  });
});

// 38c fix-cyclus 1, punt 4: bij een filmpje begint de tekst met "Het filmpje
// verdwijnt…", en de zin over het origineel staat erbij; ook bij het
// verwijderen van een gemeld filmpje (FlagScreens.tsx).
const ORIGINAL_SENTENCE = "Is het ingestuurd voor een filmproject, dan gaat het origineel ook weg.";

describe("deleteMessage: wat er weggaat bij verwijderen (fix-cyclus 1, punt 4)", () => {
  it("één filmpje: 'Het filmpje verdwijnt…', met de zin over het origineel", () => {
    const m = deleteMessage({ count: 1, videos: 1 });
    expect(m.startsWith("Het filmpje verdwijnt")).toBe(true);
    expect(m).not.toContain("De foto");
    expect(m).toContain(ORIGINAL_SENTENCE);
  });

  it("één foto: zoals nu, zonder de zin over het origineel", () => {
    const m = deleteMessage({ count: 1, videos: 0 });
    expect(m.startsWith("De foto verdwijnt")).toBe(true);
    expect(m).not.toContain("origineel");
  });

  it("meerdere: de zin alleen als er een filmpje bij is", () => {
    expect(deleteMessage({ count: 3, videos: 1 })).toContain(ORIGINAL_SENTENCE);
    expect(deleteMessage({ count: 3, videos: 0 })).not.toContain("origineel");
    expect(deleteMessage({ count: 3, videos: 0 })).toContain("3 foto's");
  });

  it("alleen filmpjes: 'De 3 filmpjes verdwijnen…'", () => {
    expect(deleteMessage({ count: 3, videos: 3 }).startsWith("De 3 filmpjes verdwijnen")).toBe(true);
  });
});

describe("gemeld filmpje verwijderen (FlagScreens, fix-cyclus 1, punt 4)", () => {
  it("de bevestigingen kennen een filmpje: 'Het filmpje verdwijnt' en de zin over het origineel (letterlijk, of via deleteMessage)", () => {
    const src = read("screens/FlagScreens.tsx");
    expect(src.length, "sanity: FlagScreens.tsx").toBeGreaterThan(0);
    const viaShared = src.includes("deleteMessage(");
    const literal = src.includes("Het filmpje verdwijnt") && src.includes(ORIGINAL_SENTENCE);
    expect(viaShared || literal).toBe(true);
  });

  it("niet meer alleen 'Foto overal verwijderen?' en 'Foto nu verwijderen?' als vaste titel: er is een titel voor een filmpje", () => {
    const src = read("screens/FlagScreens.tsx");
    expect(src).toMatch(/Filmpje (overal|nu) verwijderen\?/);
  });
});

// 38c fix-cyclus 1, punt 5: het toevoegscherm zelf doet geen eigen live query
// buiten een QueryBoundary. Een fout zou anders het hele scherm (met een
// lopende ronde) neerhalen. De groepsnamen komen uit `useKnownMyGroups`, of
// uit een deel onder een QueryBoundary.
describe("het toevoegscherm: geen ongegrensde query (fix-cyclus 1, punt 5)", () => {
  it("in de body van AddPhotosScreen zelf geen useMyGroups of useLiveQuery", () => {
    const sf = parse(read("screens/AddPhotosScreen.tsx"), "AddPhotosScreen.tsx");
    let body: ts.Block | undefined;
    const find = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "AddPhotosScreen" && n.body) body = n.body;
      ts.forEachChild(n, find);
    };
    find(sf);
    expect(body, "sanity: function AddPhotosScreen").toBeDefined();
    const direct: string[] = [];
    const visit = (n: ts.Node) => {
      // Een geneste functie (callback, effect) is geen hook-aanroep van het scherm.
      if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ["useMyGroups", "useLiveQuery"].includes(n.expression.text)) {
        direct.push(n.expression.text);
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(body!, visit);
    expect(direct).toEqual([]);
  });
});
