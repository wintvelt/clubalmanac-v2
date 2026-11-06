import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  imageFailed,
  imageLoadView,
  initialImageLoad,
  retryByUser,
  tokenArrived,
  tokenRequest,
  type ImageLoad,
} from "../src/lib/imageRetry";
import { isScanned, listFiles, moduleUses, parse } from "./support/sourceScan";

// WP17a invariant 18 (fix-cyclus 3, N-S1). Een beeld uit het foto-pad stuurt
// het Clerk-token mee; een verlopen token geeft 401. Na een fout probeert het
// beeld het precies één keer opnieuw, en die poging gebruikt een vers token
// (Clerk `skipCache`). Er gaat geen verzoek meer uit met het oude token: tot
// het verse token er is, wacht het beeld. Lukt ook de tweede poging niet, dan
// valt het terug (de fout-tegel, of de letter op een cover).
//
// De heraudit vond dat de bron na een fout meteen opnieuw laadde met het token
// dat al in de toestand stond, het verlopen token. Dat gaf opnieuw 401, en de
// ene herhaling was op.
//
// Pure toestand, zonder React: `src/lib/imageRetry.ts`.
//   tokenRequest(s)   welk token de bron nu moet ophalen, of null
//   tokenArrived(s, poging, token)  het token voor die poging is er (null: geen)
//   imageFailed(s, poging)          het beeld van die poging laadde niet
//   retryByUser(s)                  tik op "Opnieuw" op de fout-tegel
//   imageLoadView(s)  wait (geen verzoek), load (met dit token) of failed
// Meldingen van een oudere poging veranderen niets: een laat token, of een
// late fout van een beeld dat al vervangen is.

type View = ReturnType<typeof imageLoadView>;

function loadOf(v: View): { token: string; attempt: number } {
  if (v.kind !== "load") throw new Error(`verwacht load, kreeg ${v.kind}`);
  return { token: v.token, attempt: v.attempt };
}

// Een server die elk verzoek weigert, en een Clerk die bij elke ophaal een
// nieuw token geeft. Geeft alle verzoeken die uitgaan, tot het beeld terugvalt.
function runAgainstRefusingServer(start: ImageLoad, maxSteps = 20) {
  let s = start;
  let minted = 0;
  const requests: { token: string; attempt: number }[] = [];
  const fetches: { attempt: number; skipCache: boolean }[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const v = imageLoadView(s);
    if (v.kind === "failed") return { s, requests, fetches };
    if (v.kind === "load") {
      requests.push(loadOf(v));
      s = imageFailed(s, v.attempt);
      continue;
    }
    const req = tokenRequest(s);
    if (req === null) throw new Error("wacht op een token, maar vraagt er geen");
    fetches.push(req);
    minted += 1;
    s = tokenArrived(s, req.attempt, `t${minted}`);
  }
  throw new Error("valt niet terug");
}

function withFirstToken(token = "oud") {
  const req = tokenRequest(initialImageLoad);
  if (req === null) throw new Error("begin zonder tokenverzoek");
  return tokenArrived(initialImageLoad, req.attempt, token);
}

describe("imageRetry — het begin", () => {
  it("wacht op een token en vraagt er een, uit de cache", () => {
    expect(imageLoadView(initialImageLoad).kind).toBe("wait");
    const req = tokenRequest(initialImageLoad);
    expect(req).not.toBeNull();
    expect(req!.skipCache).toBe(false);
  });

  it("met het token: laadt met precies dat token, en vraagt geen nieuw", () => {
    const s = withFirstToken("t0");
    expect(loadOf(imageLoadView(s)).token).toBe("t0");
    expect(tokenRequest(s)).toBeNull();
  });

  it("geen token (uitgelogd, of ophalen mislukt): valt terug, zonder verzoek", () => {
    const req = tokenRequest(initialImageLoad)!;
    const s = tokenArrived(initialImageLoad, req.attempt, null);
    expect(imageLoadView(s).kind).toBe("failed");
    expect(tokenRequest(s)).toBeNull();
  });
});

describe("imageRetry — na een fout (N-S1)", () => {
  it("geen verzoek met het oude token: het beeld wacht", () => {
    const s0 = withFirstToken("oud");
    const s1 = imageFailed(s0, loadOf(imageLoadView(s0)).attempt);
    expect(imageLoadView(s1).kind).toBe("wait");
  });

  it("de herhaling vraagt een vers token (skipCache) voor een nieuwe poging", () => {
    const s0 = withFirstToken("oud");
    const first = loadOf(imageLoadView(s0));
    const s1 = imageFailed(s0, first.attempt);
    const req = tokenRequest(s1);
    expect(req).not.toBeNull();
    expect(req!.skipCache).toBe(true);
    expect(req!.attempt).not.toBe(first.attempt);
  });

  it("het verse token komt: laadt met dat token, als een nieuwe poging", () => {
    const s0 = withFirstToken("oud");
    const first = loadOf(imageLoadView(s0));
    const s1 = imageFailed(s0, first.attempt);
    const s2 = tokenArrived(s1, tokenRequest(s1)!.attempt, "vers");
    const second = loadOf(imageLoadView(s2));
    expect(second.token).toBe("vers");
    // Een nieuwe poging: het beeld wordt opnieuw opgebouwd (key) en vraagt opnieuw.
    expect(second.attempt).not.toBe(first.attempt);
    expect(tokenRequest(s2)).toBeNull();
  });

  it("een laat token van de eerste poging telt niet: geen verzoek met het oude token", () => {
    const s0 = withFirstToken("oud");
    const first = loadOf(imageLoadView(s0));
    const s1 = imageFailed(s0, first.attempt);
    const late = tokenArrived(s1, first.attempt, "oud");
    expect(imageLoadView(late).kind).toBe("wait");
    expect(tokenRequest(late)).toEqual(tokenRequest(s1));
    // En ook niet nadat het verse token er is.
    const s2 = tokenArrived(late, tokenRequest(late)!.attempt, "vers");
    expect(loadOf(imageLoadView(tokenArrived(s2, first.attempt, "oud"))).token).toBe("vers");
  });

  it("een late fout van het vervangen beeld kost de herhaling niet", () => {
    const s0 = withFirstToken("oud");
    const first = loadOf(imageLoadView(s0));
    const s1 = imageFailed(s0, first.attempt);
    const s2 = tokenArrived(s1, tokenRequest(s1)!.attempt, "vers");
    // Het oude beeld meldt zijn fout nog een keer, na de nieuwe poging.
    const s3 = imageFailed(s2, first.attempt);
    expect(loadOf(imageLoadView(s3)).token).toBe("vers");
    // Ook als die late fout komt terwijl het verse token nog onderweg is.
    const s1b = imageFailed(s1, first.attempt);
    expect(imageLoadView(s1b).kind).toBe("wait");
    expect(tokenRequest(s1b)).toEqual(tokenRequest(s1));
  });

  it("lukt ook de tweede poging niet: terugvallen, en geen verzoek meer", () => {
    const s0 = withFirstToken("oud");
    const s1 = imageFailed(s0, loadOf(imageLoadView(s0)).attempt);
    const s2 = tokenArrived(s1, tokenRequest(s1)!.attempt, "vers");
    const s3 = imageFailed(s2, loadOf(imageLoadView(s2)).attempt);
    expect(imageLoadView(s3).kind).toBe("failed");
    expect(tokenRequest(s3)).toBeNull();
  });

  it("geen vers token te krijgen: terugvallen, zonder verzoek met het oude", () => {
    const s0 = withFirstToken("oud");
    const s1 = imageFailed(s0, loadOf(imageLoadView(s0)).attempt);
    const s2 = tokenArrived(s1, tokenRequest(s1)!.attempt, null);
    expect(imageLoadView(s2).kind).toBe("failed");
    expect(tokenRequest(s2)).toBeNull();
  });

  it("tegen een server die alles weigert: precies twee verzoeken, het tweede met een vers token", () => {
    const run = runAgainstRefusingServer(initialImageLoad);
    expect(run.requests.map((r) => r.token)).toEqual(["t1", "t2"]);
    expect(run.fetches.map((f) => f.skipCache)).toEqual([false, true]);
    expect(new Set(run.requests.map((r) => r.attempt)).size).toBe(2);
  });

  it("de toestand wordt niet ter plekke gewijzigd", () => {
    const s0 = withFirstToken("oud");
    const before = JSON.stringify(s0);
    imageFailed(s0, loadOf(imageLoadView(s0)).attempt);
    tokenArrived(s0, 999, "x");
    retryByUser(s0);
    expect(JSON.stringify(s0)).toBe(before);
    expect(imageLoadView(initialImageLoad).kind).toBe("wait");
  });
});

describe("imageRetry — Opnieuw op de fout-tegel", () => {
  function failedState() {
    const run = runAgainstRefusingServer(initialImageLoad);
    expect(imageLoadView(run.s).kind).toBe("failed");
    return run;
  }

  it("vraagt een vers token voor een nieuwe poging, en wacht tot het er is", () => {
    const { s, requests } = failedState();
    const r = retryByUser(s);
    expect(imageLoadView(r).kind).toBe("wait");
    const req = tokenRequest(r);
    expect(req).not.toBeNull();
    expect(req!.skipCache).toBe(true);
    expect(requests.map((x) => x.attempt)).not.toContain(req!.attempt);
  });

  it("een laat token van een eerdere poging telt niet", () => {
    const { s, requests } = failedState();
    const r = retryByUser(s);
    for (const old of requests) {
      expect(imageLoadView(tokenArrived(r, old.attempt, old.token)).kind).toBe("wait");
    }
  });

  it("tegen een server die alles weigert: valt weer terug, na hooguit twee verzoeken met nieuwe tokens", () => {
    const { s, requests } = failedState();
    const again = runAgainstRefusingServer(retryByUser(s));
    expect(again.requests.length).toBeGreaterThanOrEqual(1);
    expect(again.requests.length).toBeLessThanOrEqual(2);
    expect(again.fetches.every((f) => f.skipCache)).toBe(true);
    const oldAttempts = new Set(requests.map((r) => r.attempt));
    expect(again.requests.some((r) => oldAttempts.has(r.attempt))).toBe(false);
  });
});

// --- De app gebruikt deze toestand ----------------------------------------------

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP_ROOT, "src");
const NAMES = ["imageLoadView", "imageFailed", "tokenArrived", "tokenRequest", "retryByUser"];

describe("invariant 18: het foto-beeld loopt via imageRetry", () => {
  it("de app importeert elke stap van imageRetry buiten src/lib", () => {
    const used = new Set<string>();
    for (const rel of listFiles(SRC, new Set())) {
      if (!isScanned(rel) || rel.startsWith("lib/")) continue;
      const text = readFileSync(join(SRC, rel), "utf8");
      for (const u of moduleUses(parse(text, rel))) {
        if (u.module.endsWith("lib/imageRetry")) u.names.forEach((n) => used.add(n));
      }
    }
    expect(NAMES.filter((n) => !used.has(n))).toEqual([]);
  });
});
