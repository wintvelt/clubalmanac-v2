/// <reference types="vite/client" />
import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import crons from "../../convex/crons";
import http from "../../convex/http";
import { filmInternal } from "./_film";

// WP38a A-invariant 16 (conventie §Toegangsdefinities): de publieke paden die
// een project, inzending, filmpje of groep aannemen, liggen vast. Een nieuw
// publiek pad in convex/filmProjects.ts faalt hier tot iemand deze lijst
// bewust bijwerkt (en dus een gate kiest). Er is geen afspeelpad voor een
// origineel (besluit 7). Plus de drie crons (A-invariant 9, 11, 14).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §A-invarianten.

type Registered = { isPublic?: boolean; isQuery?: boolean; isMutation?: boolean; isAction?: boolean; exportArgs?: () => string };

const modules = import.meta.glob<Record<string, unknown>>("../../convex/filmProjects.ts", { eager: true });

function publicFunctions(): Map<string, Registered> {
  const found = new Map<string, Registered>();
  for (const mod of Object.values(modules)) {
    for (const [name, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (fn && fn.isPublic === true && (fn.isQuery || fn.isMutation || fn.isAction)) found.set(name, fn);
    }
  }
  return found;
}

function kindOf(fn: Registered): string {
  return fn.isQuery ? "query" : fn.isMutation ? "mutation" : "action";
}

function argNames(fn: Registered): string[] {
  const raw = JSON.parse(fn.exportArgs?.() ?? "null") as { type: string; value?: Record<string, unknown> } | null;
  expect(raw?.type, "args moeten een object-validator zijn").toBe("object");
  return Object.keys(raw!.value ?? {}).sort();
}

const EXPECTED: Record<string, { kind: string; args: string[] }> = {
  // Besluit 27: een titel in plaats van een album.
  open: { kind: "mutation", args: ["endsAt", "groupId", "title"] },
  close: { kind: "mutation", args: ["projectId"] },
  // Besluit 13: de einddatum verschuiven (oprichter, alleen open project).
  setEndsAt: { kind: "mutation", args: ["endsAt", "projectId"] },
  // Besluit 27 (Wouter: ja): de titel wijzigen (oprichter, ook na sluiten).
  setTitle: { kind: "mutation", args: ["projectId", "title"] },
  listForGroup: { kind: "query", args: ["groupId"] },
  listOpenForMe: { kind: "query", args: [] },
  get: { kind: "query", args: ["projectId"] },
  startOriginal: { kind: "action", args: ["bytes", "photoId"] },
  finishOriginal: { kind: "action", args: ["originalId"] },
  withdraw: { kind: "mutation", args: ["originalId"] },
  downloadUrl: { kind: "action", args: ["originalId"] },
  removeOriginal: { kind: "mutation", args: ["originalId"] },
  removeAll: { kind: "mutation", args: ["projectId"] },
};

describe("WP38 inventaris publieke paden (A-invariant 16)", () => {
  it("convex/filmProjects.ts bestaat", () => {
    expect(Object.keys(modules)).toHaveLength(1);
  });

  it("precies deze publieke functies, met dit soort en deze argumenten (geen sleutel, pad of bucket uit het verzoek)", () => {
    const fns = publicFunctions();
    expect([...fns.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [name, want] of Object.entries(EXPECTED)) {
      const fn = fns.get(name)!;
      expect(kindOf(fn), name).toBe(want.kind);
      expect(argNames(fn), name).toEqual(want.args);
    }
  });

  it("het beeldpad van een inzending (GET en OPTIONS) is de enige nieuwe route; geen pad naar een origineel", () => {
    const routes = http.getRoutes().map(([path, method]) => `${method} ${path}`);
    expect(routes).toContain("GET /beeld/inzending/*");
    const film = routes.filter((r) => /inzending|origin|filmproject/i.test(r));
    expect(film.sort()).toEqual(["GET /beeld/inzending/*", "OPTIONS /beeld/inzending/*"]);
  });

  it("crons: elk uur afronden, dagelijks het jaar en de R2-check", () => {
    const complete = crons.crons["film originals complete"];
    const expiry = crons.crons["film originals expiry"];
    const check = crons.crons["film originals check"];
    if (!complete || !expiry || !check) {
      throw new Error("crons 'film originals complete', 'film originals expiry' en 'film originals check' niet geregistreerd");
    }
    expect(check.schedule.type).toBe("daily");
    expect(check.name).toBe(getFunctionName(filmInternal.checkStorage));
    expect(complete.schedule.type).toBe("hourly");
    expect(complete.name).toBe(getFunctionName(filmInternal.completeUploaded));
    expect(expiry.schedule.type).toBe("daily");
    expect(expiry.name).toBe(getFunctionName(filmInternal.expireOriginals));
  });
});
