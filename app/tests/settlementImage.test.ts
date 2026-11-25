import { describe, expect, it } from "vitest";
import { settlementImageUrl } from "../src/lib/imageUrls";
import { settlementTile } from "../src/lib/settlements";

// WP41c — de foto bij een afrekening, de pure delen in de app.
// Spec: docs/work-packages/WP41-financieel.md §WP41c (besluit 4 en 5) en
// §WP41c spec-criticus C6.
//   - De URL: het beeldpad van de afrekening op de site-host, met de versie
//     erin. Een nieuwe foto (nieuwe versie) is een nieuwe URL, dus een nieuwe
//     sleutel in de beeldcache (iOS) en in het geheugen van de webapp.
//   - Welke tegel: zonder foto de lettertegel; met foto de foto; een foto die
//     niet laadde, de letter, tot er een nieuwe versie is.

const SITE = "https://happy-otter-123.eu-west-1.convex.site";

describe("settlementImageUrl", () => {
  it("het beeldpad van de afrekening, met de versie", () => {
    expect(settlementImageUrl(SITE, "k57abc", "v1x2")).toBe(`${SITE}/beeld/afrekening/k57abc?versie=v1x2`);
  });

  it("een andere versie is een andere URL; hetzelfde id en dezelfde versie dezelfde URL", () => {
    const a = settlementImageUrl(SITE, "k57abc", "v1");
    expect(settlementImageUrl(SITE, "k57abc", "v2")).not.toBe(a);
    expect(settlementImageUrl(SITE, "k57abc", "v1")).toBe(a);
  });

  it("id en versie worden URL-gecodeerd", () => {
    expect(settlementImageUrl(SITE, "a/b?c", "v 1&x=2")).toBe(
      `${SITE}/beeld/afrekening/a%2Fb%3Fc?versie=v%201%26x%3D2`,
    );
  });

  it("geen formaat en geen token in de URL", () => {
    const url = settlementImageUrl(SITE, "k57abc", "v1");
    expect(url).not.toMatch(/formaat=|token|Bearer/i);
  });
});

describe("settlementTile", () => {
  it("zonder foto: de letter", () => {
    expect(settlementTile({ hasImage: false, imageVersion: null }, null)).toEqual({ kind: "letter" });
  });

  it("met foto: de foto, met zijn versie", () => {
    expect(settlementTile({ hasImage: true, imageVersion: "v1" }, null)).toEqual({ kind: "image", version: "v1" });
  });

  it("de foto van deze versie laadde niet: de letter", () => {
    expect(settlementTile({ hasImage: true, imageVersion: "v1" }, "v1")).toEqual({ kind: "letter" });
  });

  it("een nieuwe versie na een mislukte: weer de foto", () => {
    expect(settlementTile({ hasImage: true, imageVersion: "v2" }, "v1")).toEqual({ kind: "image", version: "v2" });
  });

  it("hasImage zonder versie (kan niet, maar veilig): de letter", () => {
    expect(settlementTile({ hasImage: true, imageVersion: null }, null)).toEqual({ kind: "letter" });
  });

  it("een versie zonder hasImage: de letter", () => {
    expect(settlementTile({ hasImage: false, imageVersion: "v1" }, null)).toEqual({ kind: "letter" });
  });
});
