import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parse } from "./support/sourceScan";

// WP39 besluit 1: het toevoegscherm zegt foto's én filmpjes.
//   De kop "Toevoegen", ook als naam van de + in de tabbalk en van de knop in
//   het album (die staat alleen op het web). Lege stand "Kies foto's of
//   filmpjes" (iOS). "Meer foto's" na een ronde wordt "Meer toevoegen". De
//   uploadknop heet altijd "Toevoegen aan album", met een upload-icoon in
//   plaats van de +. "Andere foto's kiezen" is weg op iOS (besluit 3).
//   Web (A-antwoord 5, B-besluiten 1 en 2): kop en knoptitel gelijk; de lege
//   stand en "Andere foto's kiezen" blijven daar, dat legt deze test niet vast.
// Een bronscan (de TypeScript-parser): alleen strings in de code, geen
// commentaar. De teksten staan letterlijk in deze bestanden.
// Spec: docs/work-packages/WP39-toevoegscherm.md §Testcontract.

function source(rel: string): ts.SourceFile {
  const file = fileURLToPath(new URL(`../src/${rel}`, import.meta.url));
  return parse(readFileSync(file, "utf8"), rel.split("/").pop());
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

/** Alle strings in het bestand: letterlijke strings, templates zonder ${} en JSX-tekst. */
function strings(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    } else if (ts.isJsxText(n) && n.text.trim() !== "") out.push(n.text.trim());
  });
  return out;
}

type JsxEl = ts.JsxSelfClosingElement | ts.JsxOpeningElement;

function jsx(sf: ts.SourceFile, tag: string): JsxEl[] {
  const out: JsxEl[] = [];
  walk(sf, (n) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === tag) out.push(n);
  });
  return out;
}

function attrText(sf: ts.SourceFile, el: JsxEl, name: string): string | undefined {
  const a = el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
  const init = a?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    return e.getText(sf);
  }
  return undefined;
}

const IOS = source("screens/AddPhotosScreen.tsx");
const WEB = source("screens/AddPhotosScreen.web.tsx");
const PARTS = source("screens/AddPhotosParts.tsx");

describe("de kop en de ingangen heten Toevoegen (besluit 1)", () => {
  it("de kop van de modaal toevoegen is 'Toevoegen'", () => {
    const sf = source("app/_layout.tsx");
    const screens = jsx(sf, "Stack.Screen").filter((el) => attrText(sf, el, "name") === "toevoegen");
    expect(screens.length, "sanity: <Stack.Screen name=\"toevoegen\"> in src/app/_layout.tsx").toBe(1);
    const titles: string[] = [];
    walk(screens[0]!, (n) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "title" && ts.isStringLiteral(n.initializer)) {
        titles.push(n.initializer.text);
      }
    });
    expect(titles).toEqual(["Toevoegen"]);
  });

  it("de + in de tabbalk heet 'Toevoegen' voor VoiceOver", () => {
    const s = strings(source("navigation/TabBar.tsx"));
    expect(s).not.toContain("Foto's toevoegen");
    expect(s).toContain("Toevoegen");
  });

  it("de knop in het album (web) heet 'Toevoegen'", () => {
    const s = strings(source("screens/AlbumScreen.tsx"));
    expect(s).not.toContain("Foto's toevoegen");
    expect(s).toContain("Toevoegen");
  });
});

describe("het scherm op iOS zegt foto's én filmpjes (besluit 1 en 3)", () => {
  const both = [...strings(IOS), ...strings(PARTS)];

  it.each(["Andere foto's kiezen", "Foto's uploaden", "Filmpjes uploaden", "Uploaden", "Meer foto's", "Meer kiezen", "Kies foto's", "Foto's kiezen"])(
    "geen '%s' meer",
    (old) => {
      expect(strings(IOS), `AddPhotosScreen.tsx`).not.toContain(old);
      expect(strings(PARTS), `AddPhotosParts.tsx`).not.toContain(old);
    },
  );

  it.each(["Kies foto's of filmpjes", "Meer toevoegen", "Toevoegen aan album"])("wel '%s'", (text) => {
    expect(both).toContain(text);
  });
});

describe("de uploadknop: 'Toevoegen aan album' met een upload-icoon (besluit 1)", () => {
  it.each([
    ["iOS", IOS],
    ["web", WEB],
  ] as const)("%s: de knop met onPress naar startUpload", (_name, sf) => {
    const buttons = jsx(sf, "Button").filter((el) => (attrText(sf, el, "onPress") ?? "").includes("startUpload"));
    expect(buttons.length, "sanity: een <Button onPress={startUpload}>").toBeGreaterThan(0);
    for (const el of buttons) {
      expect(attrText(sf, el, "title")).toBe("Toevoegen aan album");
      expect(attrText(sf, el, "icon")).toBe("upload");
    }
  });

  it("web: geen 'Foto's uploaden' meer", () => {
    expect(strings(WEB)).not.toContain("Foto's uploaden");
  });

  it("Icon kent een icoon 'upload'", () => {
    const sf = source("components/Icon.tsx");
    const keys: string[] = [];
    walk(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        n.name.getText(sf) === "IONICONS" &&
        n.initializer !== undefined
      ) {
        walk(n.initializer, (m) => {
          if (ts.isPropertyAssignment(m)) keys.push(m.name.getText(sf).replace(/^["']|["']$/g, ""));
        });
      }
    });
    expect(keys.length, "sanity: IONICONS in Icon.tsx").toBeGreaterThan(0);
    expect(keys).toContain("upload");
  });
});
