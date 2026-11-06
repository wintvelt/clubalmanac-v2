import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isScanned, listFiles, parse } from "./support/sourceScan";

// WP17a fix-cyclus 1, S6 (audit).
//
// 1. Besluit 3: de beeldcache op het toestel gaat weg bij uitloggen. De
//    cache-sleutel is de URL, niet de user; zonder wissen ziet de volgende
//    user op hetzelfde toestel de beelden van de vorige. Gepind op het effect:
//    het lokale wissen (`wipeClerkStorage`, het pad dat uitloggen en "Opnieuw
//    inloggen" nemen) leegt het geheugen én de schijf van expo-image, en een
//    mislukte beeldwis houdt het wissen van Clerk niet tegen.
// 2. Invariant 3: het profielpad geeft alleen de actuele profielfoto. Dezelfde
//    URL geeft na een wissel een ander beeld, dus de app bewaart een
//    profielfoto niet in een cache: elk beeld met een profielbron heeft
//    `cachePolicy="none"`. (De backend stuurt `no-cache`; dat pint
//    tests/images/httpRoute.test.ts.)

const cleared = vi.hoisted(() => ({ memory: 0, disk: 0, failDisk: false }));
const secure = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-image", () => ({
  Image: {
    clearMemoryCache: async () => {
      cleared.memory += 1;
      return true;
    },
    clearDiskCache: async () => {
      cleared.disk += 1;
      if (cleared.failDisk) throw new Error("schijf");
      return true;
    },
  },
}));

vi.mock("@clerk/expo", () => ({ useAuth: () => ({}) }));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 0,
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
  },
}));

const PK = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

describe("besluit 3: lokaal wissen leegt de beeldcache", () => {
  beforeEach(() => {
    cleared.memory = 0;
    cleared.disk = 0;
    cleared.failDisk = false;
    secure.clear();
  });

  it("wipeClerkStorage wist het geheugen en de schijf van expo-image", async () => {
    const { deviceClerkStorage, wipeClerkStorage } = await import("../src/auth/deviceClerkStorage");
    deviceClerkStorage(PK);
    await wipeClerkStorage();
    expect(cleared.memory).toBeGreaterThanOrEqual(1);
    expect(cleared.disk).toBeGreaterThanOrEqual(1);
  });

  it("een mislukte beeldwis houdt het wissen van Clerk niet tegen", async () => {
    const { deviceClerkStorage, wipeClerkStorage } = await import("../src/auth/deviceClerkStorage");
    const storage = deviceClerkStorage(PK);
    await storage.resume();
    await storage.tokenCache.saveToken("__clerk_client_jwt", "geheim");
    expect([...secure.values()].join(), "sanity: het token staat er").toContain("geheim");
    cleared.failDisk = true;
    expect(await wipeClerkStorage()).toBe(true);
    expect([...secure.values()].join()).not.toContain("geheim");
  });
});

// --- Invariant 3: geen cache op een profielfoto ------------------------------------

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP_ROOT, "src");

type Found = { file: string; component: string; cachePolicy: string | null };

function attr(el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

function literal(a: ts.JsxAttribute | undefined): string | null {
  const init = a?.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) {
    return init.expression.text;
  }
  return null;
}

/** Elk `<Image>` in een functie die `useProfileSource` aanroept. */
function profileImages(): Found[] {
  const out: Found[] = [];
  for (const rel of listFiles(SRC, new Set())) {
    if (!isScanned(rel)) continue;
    const text = readFileSync(join(SRC, rel), "utf8");
    if (!text.includes("useProfileSource")) continue;
    const sf = parse(text, rel);
    const visitFn = (fn: ts.FunctionLikeDeclaration, name: string) => {
      let usesProfile = false;
      const images: ts.JsxOpeningLikeElement[] = [];
      const walk = (n: ts.Node) => {
        if (ts.isCallExpression(n) && n.expression.getText() === "useProfileSource") usesProfile = true;
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "Image") {
          images.push(n);
        }
        ts.forEachChild(n, walk);
      };
      if (fn.body) walk(fn.body);
      if (usesProfile) {
        for (const img of images) out.push({ file: rel, component: name, cachePolicy: literal(attr(img, "cachePolicy")) });
      }
    };
    const top = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name) visitFn(n, n.name.text);
      else if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            visitFn(d.initializer, d.name.getText());
          }
        }
      }
      ts.forEachChild(n, top);
    };
    top(sf);
  }
  return out;
}

describe("invariant 3: de app bewaart een profielfoto niet in een cache", () => {
  it("sanity: er is minstens één beeld met een profielbron", () => {
    expect(profileImages().length).toBeGreaterThan(0);
  });

  it('elk beeld met een profielbron heeft cachePolicy="none"', () => {
    const wrong = profileImages().filter((f) => f.cachePolicy !== "none");
    expect(wrong).toEqual([]);
  });
});
