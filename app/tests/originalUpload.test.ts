import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  MAX_ORIGINAL_BYTES,
  MIN_ORIGINAL_BYTES,
  ORIGINAL_PART_BYTES,
} from "../../convex/lib/constants";
import {
  ORIGINAL_FREE_MARGIN_BYTES,
  ORIGINAL_MAX_BYTES,
  ORIGINAL_MIN_BYTES,
  PART_ATTEMPTS,
  originalPlan,
  originalRefusal,
  originalAfterVideo,
  originalAtRoundEnd,
  partFailure,
  partsToSend,
  planParts,
  waitsForWifi,
  wifiOnlyAtStart,
  wifiOnlyFromStore,
  wifiOnlyToStore,
  type NetworkView,
  type PlannedPart,
} from "../src/lib/originalUpload";
import { videoRetryable, type VideoFailReason } from "../src/lib/videos";

// WP38b — de pure beslissingen van de uploader voor originelen.
//   - Gaat het origineel mee (A-invariant 38b-1): alleen met de uploader in
//     deze build, alleen in een groep met een open project, tussen de
//     ondergrens en de grens van de backend, en met genoeg vrije ruimte voor
//     het origineel nog een keer (besluit 21: alle delen tegelijk op schijf).
//   - De delen (A-invariant 4 van 38a): alle even groot behalve het laatste;
//     de grootte komt uit het antwoord van `startOriginal`. Alleen de delen
//     met een link gaan; de rest staat al in R2.
//   - Een mislukt deel (38b-6): na 403 of `NoSuchUpload` opnieuw aanmelden,
//     anders dezelfde link opnieuw, hooguit PART_ATTEMPTS keer, dan later.
//   - Weigeringen van de backend: `ORIGINAL_REFUSED` met een reden; al het
//     andere is een fout zonder reden (netwerk, server).
//   - "Alleen via wifi" (besluit 6, A-invariant 21): standaard aan, per
//     toestel onthouden; aan betekent geen mobiel internet en geen
//     persoonlijke hotspot (een duur netwerk).
//   Fix-cyclus 2, punt 5: het verplaatste bestand van een filmpje in de ronde
//   van het toevoegscherm. Staat het origineel in de wachtrij, dan zegt het
//   scherm de wachtrij of het filmpje in het album staat of een vaste reden
//   kreeg (A-invariant 18). Nam de wachtrij het niet aan, dan gaat het
//   bestand pas weg bij een eindstand: in het album, een vaste reden, of het
//   einde van de ronde. Na een uitkomst die het lid opnieuw kan proberen,
//   blijft het staan: "Opnieuw proberen" verkleint weer uit dat bestand.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b.

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

describe("grenzen gelijk aan de backend", () => {
  it("ondergrens 1 MiB en grens 2 GiB, dezelfde getallen als convex/lib/constants", () => {
    expect(ORIGINAL_MIN_BYTES).toBe(MIN_ORIGINAL_BYTES);
    expect(ORIGINAL_MAX_BYTES).toBe(MAX_ORIGINAL_BYTES);
  });

  it("de marge voor vrije ruimte is 1 GiB (A-keuze)", () => {
    expect(ORIGINAL_FREE_MARGIN_BYTES).toBe(GiB);
  });
});

describe("originalPlan: gaat het origineel mee? (38b-1)", () => {
  const projects = [
    { groupId: "g1", projectId: "p1" },
    { groupId: "g2", projectId: "p2" },
  ];
  const base = { uploaderAvailable: true, groupId: "g1", openProjects: projects, bytes: 300 * MiB, freeBytes: 20 * GiB };

  it("een nieuw filmpje in een groep met een open project: mee, met dat project", () => {
    expect(originalPlan(base)).toEqual({ kind: "mee", projectId: "p1" });
    expect(originalPlan({ ...base, groupId: "g2" })).toEqual({ kind: "mee", projectId: "p2" });
  });

  it("zonder uploader in deze build (webapp, oude build): niet, wat er ook open staat", () => {
    expect(originalPlan({ ...base, uploaderAvailable: false })).toEqual({ kind: "niet", reason: "geen_uploader" });
  });

  it("een groep zonder open project: niet", () => {
    expect(originalPlan({ ...base, groupId: "g3" })).toEqual({ kind: "niet", reason: "geen_project" });
    expect(originalPlan({ ...base, openProjects: [] })).toEqual({ kind: "niet", reason: "geen_project" });
  });

  it("geen project gaat vóór de grootte: geen melding over grootte of ruimte buiten een project", () => {
    expect(originalPlan({ ...base, groupId: "g3", bytes: 10, freeBytes: 0 })).toEqual({
      kind: "niet",
      reason: "geen_project",
    });
  });

  it("onder 1 MiB: niet (te_klein); precies 1 MiB: mee", () => {
    expect(originalPlan({ ...base, bytes: MiB - 1 })).toEqual({ kind: "niet", reason: "te_klein" });
    expect(originalPlan({ ...base, bytes: MiB })).toEqual({ kind: "mee", projectId: "p1" });
  });

  it("boven 2 GiB: niet (te_groot); precies 2 GiB: mee", () => {
    expect(originalPlan({ ...base, bytes: 2 * GiB + 1 })).toEqual({ kind: "niet", reason: "te_groot" });
    expect(originalPlan({ ...base, bytes: 2 * GiB, freeBytes: 10 * GiB })).toEqual({ kind: "mee", projectId: "p1" });
  });

  it("vrije ruimte minder dan het origineel plus 1 GiB: niet (geen_ruimte); precies genoeg: mee", () => {
    const bytes = 1500 * MiB;
    expect(originalPlan({ ...base, bytes, freeBytes: bytes + GiB - 1 })).toEqual({ kind: "niet", reason: "geen_ruimte" });
    expect(originalPlan({ ...base, bytes, freeBytes: bytes + GiB })).toEqual({ kind: "mee", projectId: "p1" });
  });

  it("vrije ruimte onbekend (de module kan het niet zeggen): niet tegenhouden", () => {
    expect(originalPlan({ ...base, freeBytes: null })).toEqual({ kind: "mee", projectId: "p1" });
  });

  it("geen geldige grootte (0, negatief, geen getal): niet mee", () => {
    for (const bytes of [0, -1, Number.NaN]) {
      expect(originalPlan({ ...base, bytes }).kind).toBe("niet");
    }
  });
});

describe("planParts: de delen van een origineel", () => {
  it("291 MiB in delen van 32 MiB: 10 delen, het laatste de rest", () => {
    const parts = planParts(291 * MiB, 32 * MiB);
    expect(parts).toHaveLength(10);
    expect(parts[0]).toEqual({ partNumber: 1, offset: 0, size: 32 * MiB });
    expect(parts[8]).toEqual({ partNumber: 9, offset: 8 * 32 * MiB, size: 32 * MiB });
    expect(parts[9]).toEqual({ partNumber: 10, offset: 9 * 32 * MiB, size: 3 * MiB });
  });

  it("een veelvoud van de deelgrootte: geen leeg laatste deel", () => {
    expect(planParts(64 * MiB, 32 * MiB)).toEqual([
      { partNumber: 1, offset: 0, size: 32 * MiB },
      { partNumber: 2, offset: 32 * MiB, size: 32 * MiB },
    ]);
  });

  it("kleiner dan één deel: één deel met de hele grootte", () => {
    expect(planParts(MiB, 32 * MiB)).toEqual([{ partNumber: 1, offset: 0, size: MiB }]);
  });

  it.each([MiB, 5 * MiB + 1, 291 * MiB, 304_848_345, 1500 * MiB, 2 * GiB])(
    "%i bytes: aansluitend, alle delen even groot behalve het laatste, samen precies het bestand, zoveel als de backend telt",
    (bytes) => {
      const parts = planParts(bytes, ORIGINAL_PART_BYTES);
      expect(parts).toHaveLength(Math.max(1, Math.ceil(bytes / ORIGINAL_PART_BYTES)));
      let offset = 0;
      parts.forEach((p: PlannedPart, i: number) => {
        expect(p.partNumber).toBe(i + 1);
        expect(p.offset).toBe(offset);
        if (i < parts.length - 1) expect(p.size).toBe(ORIGINAL_PART_BYTES);
        expect(p.size).toBeGreaterThan(0);
        offset += p.size;
      });
      expect(offset).toBe(bytes);
    },
  );

  it("geen geldige grootte of deelgrootte: geen delen", () => {
    expect(planParts(0, 32 * MiB)).toEqual([]);
    expect(planParts(-5, 32 * MiB)).toEqual([]);
    expect(planParts(1.5, 32 * MiB)).toEqual([]);
    expect(planParts(10 * MiB, 0)).toEqual([]);
    expect(planParts(10 * MiB, Number.NaN)).toEqual([]);
  });
});

describe("partsToSend: de links van startOriginal bij de delen", () => {
  const bytes = 291 * MiB;
  const partSize = 32 * MiB;

  it("alleen de delen met een link, met hun plek in het bestand", () => {
    const out = partsToSend(bytes, partSize, [
      { partNumber: 10, url: "https://r2.invalid/k?partNumber=10" },
      { partNumber: 3, url: "https://r2.invalid/k?partNumber=3" },
    ]);
    expect(out).toEqual([
      { partNumber: 3, offset: 2 * partSize, size: partSize, url: "https://r2.invalid/k?partNumber=3" },
      { partNumber: 10, offset: 9 * partSize, size: 3 * MiB, url: "https://r2.invalid/k?partNumber=10" },
    ]);
  });

  it("geen links: niets te versturen (alles staat al in R2)", () => {
    expect(partsToSend(bytes, partSize, [])).toEqual([]);
  });

  it("een link voor een deel dat niet bestaat, of twee keer hetzelfde deel: ongeldig", () => {
    expect(partsToSend(bytes, partSize, [{ partNumber: 11, url: "https://r2.invalid/a" }])).toBeNull();
    expect(partsToSend(bytes, partSize, [{ partNumber: 0, url: "https://r2.invalid/a" }])).toBeNull();
    expect(
      partsToSend(bytes, partSize, [
        { partNumber: 2, url: "https://r2.invalid/a" },
        { partNumber: 2, url: "https://r2.invalid/b" },
      ]),
    ).toBeNull();
  });

  it("een ongeldige deelgrootte: ongeldig", () => {
    expect(partsToSend(bytes, 0, [{ partNumber: 1, url: "https://r2.invalid/a" }])).toBeNull();
  });
});

describe("partFailure: een deel dat mislukte (38b-6)", () => {
  it("403 (verlopen link, verkeerde grootte): opnieuw aanmelden, wat de foutcode ook is", () => {
    expect(partFailure({ status: 403, code: "SignatureDoesNotMatch", attempts: 1 })).toBe("opnieuw_aanmelden");
    expect(partFailure({ status: 403, code: "AccessDenied", attempts: 1 })).toBe("opnieuw_aanmelden");
    expect(partFailure({ status: 403, code: null, attempts: 9 })).toBe("opnieuw_aanmelden");
  });

  it("NoSuchUpload (de upload is afgebroken of afgerond): opnieuw aanmelden", () => {
    expect(partFailure({ status: 404, code: "NoSuchUpload", attempts: 1 })).toBe("opnieuw_aanmelden");
    expect(partFailure({ status: 404, code: "NoSuchUpload", attempts: 20 })).toBe("opnieuw_aanmelden");
  });

  it("geen antwoord, een serverfout of een andere status: dezelfde link opnieuw", () => {
    expect(partFailure({ status: null, code: null, attempts: 1 })).toBe("opnieuw");
    expect(partFailure({ status: 500, code: "InternalError", attempts: 1 })).toBe("opnieuw");
    expect(partFailure({ status: 503, code: null, attempts: 2 })).toBe("opnieuw");
    expect(partFailure({ status: 429, code: null, attempts: 1 })).toBe("opnieuw");
    expect(partFailure({ status: 400, code: "RequestTimeout", attempts: 1 })).toBe("opnieuw");
    expect(partFailure({ status: 404, code: "NoSuchKey", attempts: 1 })).toBe("opnieuw");
  });

  it("na PART_ATTEMPTS (5) mislukte pogingen met dezelfde link: later, niet eindeloos dezelfde link", () => {
    expect(PART_ATTEMPTS).toBe(5);
    expect(partFailure({ status: null, code: null, attempts: PART_ATTEMPTS - 1 })).toBe("opnieuw");
    expect(partFailure({ status: null, code: null, attempts: PART_ATTEMPTS })).toBe("later");
    expect(partFailure({ status: 503, code: null, attempts: PART_ATTEMPTS + 3 })).toBe("later");
  });
});

describe("originalRefusal: weigering of fout", () => {
  it("ORIGINAL_REFUSED met een reden: geweigerd, met die reden", () => {
    for (const reason of ["niet_toegestaan", "te_groot", "te_klein", "te_vaak", "bezig", "vol", "uitgelogd", "geen_video"]) {
      expect(originalRefusal(new ConvexError({ code: "ORIGINAL_REFUSED", reason }))).toEqual({ kind: "geweigerd", reason });
    }
  });

  it("een reden die deze app nog niet kent, blijft een weigering met die reden", () => {
    expect(originalRefusal(new ConvexError({ code: "ORIGINAL_REFUSED", reason: "nieuw_in_2027" }))).toEqual({
      kind: "geweigerd",
      reason: "nieuw_in_2027",
    });
  });

  it("ORIGINAL_REFUSED zonder reden: geweigerd met reden onbekend", () => {
    expect(originalRefusal(new ConvexError({ code: "ORIGINAL_REFUSED" }))).toEqual({ kind: "geweigerd", reason: "onbekend" });
  });

  it("verbinding weg, een serverfout, een ander ConvexError-code of iets anders: fout", () => {
    expect(originalRefusal(new Error("Connection lost while action was in flight"))).toEqual({ kind: "fout" });
    expect(originalRefusal(new Error("R2_CONFIG_MISSING: R2_ORIGINALS_BUCKET"))).toEqual({ kind: "fout" });
    expect(originalRefusal(new ConvexError({ code: "ORIGINAL_NOT_FOUND" }))).toEqual({ kind: "fout" });
    expect(originalRefusal("kapot")).toEqual({ kind: "fout" });
    expect(originalRefusal(null)).toEqual({ kind: "fout" });
  });
});

describe('"Alleen via wifi" (besluit 6, A-invariant 21)', () => {
  it("standaard aan: niets bewaard, leeg of onleesbaar", () => {
    expect(wifiOnlyFromStore(null)).toBe(true);
    expect(wifiOnlyFromStore("")).toBe(true);
    expect(wifiOnlyFromStore("kapot{")).toBe(true);
  });

  it("wat het lid koos, komt terug", () => {
    expect(wifiOnlyFromStore(wifiOnlyToStore(false))).toBe(false);
    expect(wifiOnlyFromStore(wifiOnlyToStore(true))).toBe(true);
  });

  const net = (type: NetworkView["type"], expensive = false): NetworkView => ({ type, expensive });

  it("aan: wachten op mobiel internet, een persoonlijke hotspot, geen netwerk of een onbekend netwerk", () => {
    expect(waitsForWifi(true, net("mobiel", true))).toBe(true);
    expect(waitsForWifi(true, net("wifi", true))).toBe(true);
    expect(waitsForWifi(true, net("geen"))).toBe(true);
    expect(waitsForWifi(true, net("onbekend"))).toBe(true);
    expect(waitsForWifi(true, net("anders"))).toBe(true);
  });

  it("aan: niet wachten op gewone wifi of een kabel", () => {
    expect(waitsForWifi(true, net("wifi"))).toBe(false);
    expect(waitsForWifi(true, net("kabel"))).toBe(false);
  });

  it("uit: nooit wachten op wifi, ook niet op mobiel internet of een hotspot", () => {
    expect(waitsForWifi(false, net("mobiel", true))).toBe(false);
    expect(waitsForWifi(false, net("wifi", true))).toBe(false);
    expect(waitsForWifi(false, net("geen"))).toBe(false);
  });
});

describe('"Alleen via wifi" bij twijfel aan (fix-cyclus 1, punt 6)', () => {
  // Bij de start: wat de app bewaarde naast wat de uploader zegt (`null`: de
  // uploader kon het niet zeggen). Alleen als beide uit zeggen, is het uit.
  const uit = wifiOnlyToStore(false);
  const aan = wifiOnlyToStore(true);

  it("beide uit: uit", () => {
    expect(wifiOnlyAtStart(uit, false)).toBe(false);
  });

  it("de app zegt uit, de uploader aan: aan", () => {
    expect(wifiOnlyAtStart(uit, true)).toBe(true);
  });

  it("de app zegt aan, de uploader uit: aan", () => {
    expect(wifiOnlyAtStart(aan, false)).toBe(true);
  });

  it("de app bewaarde niets of iets onleesbaars, de uploader zegt uit: aan", () => {
    expect(wifiOnlyAtStart(null, false)).toBe(true);
    expect(wifiOnlyAtStart("kapot{", false)).toBe(true);
  });

  it("de uploader kon het niet zeggen: aan, ook als de app uit bewaarde", () => {
    expect(wifiOnlyAtStart(uit, null)).toBe(true);
    expect(wifiOnlyAtStart(null, null)).toBe(true);
  });

  it("beide aan: aan", () => {
    expect(wifiOnlyAtStart(aan, true)).toBe(true);
  });
});

describe("het verplaatste bestand in de ronde van het toevoegscherm (fix-cyclus 2, punt 5)", () => {
  // Alle redenen van WP37 (src/lib/videos.ts). Opnieuw te proberen of vast
  // volgt `videoRetryable`, zoals de knop "Opnieuw proberen".
  const REASONS: VideoFailReason[] = [
    "te_lang",
    "te_groot",
    "locatie",
    "codec",
    "geen_mp4",
    "index_achteraan",
    "comprimeren",
    "netwerk",
    "niet_binnen",
    "bezig",
    "limiet",
    "geen_album",
    "uitgelogd",
    "verlopen",
    "te_vaak",
    "server",
  ];
  const retryable = REASONS.filter((r) => videoRetryable(r));
  const fixed = REASONS.filter((r) => !videoRetryable(r));

  it("beide soorten redenen komen voor", () => {
    expect(retryable).toEqual(expect.arrayContaining(["netwerk", "comprimeren", "server", "uitgelogd"]));
    expect(fixed).toEqual(expect.arrayContaining(["te_groot", "locatie", "codec"]));
  });

  describe("in de wachtrij (A-invariant 18, zoals nu)", () => {
    it("in het album: de wachtrij hoort het, met het filmpje", () => {
      expect(originalAfterVideo({ queued: true, outcome: { ok: true, photoId: "photo-1" } })).toEqual({
        kind: "album_klaar",
        photoId: "photo-1",
      });
    });

    it.each(fixed)("vaste reden %s: de wachtrij hoort dat het filmpje niet in het album komt", (reason) => {
      expect(originalAfterVideo({ queued: true, outcome: { ok: false, reason } })).toEqual({ kind: "album_mislukt" });
    });

    it.each(retryable)("%s (opnieuw te proberen): nog niets", (reason) => {
      expect(originalAfterVideo({ queued: true, outcome: { ok: false, reason } })).toEqual({ kind: "laten" });
    });
  });

  describe("niet aangenomen door de wachtrij", () => {
    it("in het album: het bestand weg", () => {
      expect(originalAfterVideo({ queued: false, outcome: { ok: true, photoId: "photo-1" } })).toEqual({ kind: "bestand_weg" });
    });

    it.each(fixed)("vaste reden %s: het bestand weg", (reason) => {
      expect(originalAfterVideo({ queued: false, outcome: { ok: false, reason } })).toEqual({ kind: "bestand_weg" });
    });

    it.each(retryable)("%s (opnieuw te proberen): het bestand blijft, opnieuw proberen leest het", (reason) => {
      expect(originalAfterVideo({ queued: false, outcome: { ok: false, reason } })).toEqual({ kind: "laten" });
    });
  });

  describe("de ronde eindigt (sluiten, of een nieuwe keuze na de ronde)", () => {
    it("in de wachtrij en niet in het album: de wachtrij hoort het (het origineel gaat weg)", () => {
      expect(originalAtRoundEnd({ queued: true, inAlbum: false })).toEqual({ kind: "album_mislukt" });
    });

    it("in de wachtrij en in het album: niets, de wachtrij heeft het", () => {
      expect(originalAtRoundEnd({ queued: true, inAlbum: true })).toEqual({ kind: "laten" });
    });

    it("niet aangenomen door de wachtrij: het bestand weg, of het filmpje nu in het album staat of niet", () => {
      expect(originalAtRoundEnd({ queued: false, inAlbum: false })).toEqual({ kind: "bestand_weg" });
      expect(originalAtRoundEnd({ queued: false, inAlbum: true })).toEqual({ kind: "bestand_weg" });
    });
  });
});
