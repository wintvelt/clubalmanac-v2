/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import http from "../../convex/http";

// WP37 A-invariant 26 (conventie §Toegangsdefinities): de publieke paden die
// een filmpje aannemen of maken, liggen vast. Een nieuw publiek pad in
// convex/videos.ts faalt hier tot iemand deze lijst bewust bijwerkt (en dus
// een gate kiest). Bestaande foto-paden die een filmpje anders behandelen
// (rotate, setProfilePhoto, updateProfile) staan in photoRules.test.ts.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten.

type Registered = { isPublic?: boolean; isQuery?: boolean; isMutation?: boolean; isAction?: boolean; exportArgs?: () => string };

const modules = import.meta.glob<Record<string, unknown>>("../../convex/videos.ts", { eager: true });

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

function argNames(fn: Registered): string[] {
  const raw = JSON.parse(fn.exportArgs?.() ?? "null") as { type: string; value?: Record<string, unknown> } | null;
  expect(raw?.type, "args moeten een object-validator zijn").toBe("object");
  return Object.keys(raw!.value ?? {}).sort();
}

describe("WP37 inventaris publieke video-paden (A-invariant 26)", () => {
  it("convex/videos.ts bestaat", () => {
    expect(Object.keys(modules)).toHaveLength(1);
  });

  it("precies startUpload en playUrl, allebei een action", () => {
    const fns = publicFunctions();
    expect([...fns.keys()].sort()).toEqual(["playUrl", "startUpload"]);
    for (const fn of fns.values()) expect(fn.isAction).toBe(true);
  });

  it("playUrl neemt alleen een photoId (geen sleutel of pad uit het verzoek)", () => {
    expect(argNames(publicFunctions().get("playUrl")!)).toEqual(["photoId"]);
  });

  it("startUpload neemt upload-id, album, duur en grootte, geen sleutel", () => {
    expect(argNames(publicFunctions().get("startUpload")!)).toEqual(["albumId", "bytes", "durationMs", "uploadId"]);
  });

  it("POST /upload/video is een route; er is geen GET-pad naar een filmpje", () => {
    const routes = http.getRoutes().map(([path, method]) => `${method} ${path}`);
    expect(routes).toContain("POST /upload/video");
    expect(routes.filter((r) => /video/i.test(r) && !r.startsWith("POST /upload/video") && !r.startsWith("OPTIONS "))).toEqual([]);
  });
});
