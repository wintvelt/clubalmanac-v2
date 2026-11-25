import { describe, expect, it } from "vitest";
import { segmentedTabsLayout, SEG_TAB_PADDING } from "../src/lib/segmentedTabs";
import { typography } from "../src/theme/tokens";

// WP41b — de groepstabs met vier (Albums · Films · Leden · Geld) passen op één
// regel op een smalle iPhone: kleinere marge en een iets kleinere letter. Met
// drie tabs blijft het zoals het was; bij grote tekst twee rijen van twee (WP41).

describe("indeling van de groepstabs", () => {
  it("twee of drie tabs: gewoon, ook bij grote tekst", () => {
    for (const count of [2, 3]) {
      expect(segmentedTabsLayout(count, 1)).toBe("row");
      expect(segmentedTabsLayout(count, 1.5)).toBe("row");
    }
  });

  it("vier tabs bij gewone tekst: compact op één regel", () => {
    expect(segmentedTabsLayout(4, 1)).toBe("compact");
    expect(segmentedTabsLayout(4, 1.19)).toBe("compact");
  });

  it("vier tabs bij grote tekst: twee rijen van twee", () => {
    expect(segmentedTabsLayout(4, 1.2)).toBe("grid");
    expect(segmentedTabsLayout(4, 2)).toBe("grid");
  });
});

describe("compact: kleinere marge en letter", () => {
  it("de marge is kleiner dan gewoon", () => {
    expect(SEG_TAB_PADDING.compact).toBeLessThan(SEG_TAB_PADDING.row);
  });

  it("de letter is iets kleiner dan body, in dezelfde gewichten", () => {
    expect(typography.segTabCompact.fontSize).toBeLessThan(typography.body.fontSize);
    expect(typography.segTabCompactActive.fontSize).toBe(typography.segTabCompact.fontSize);
    expect(typography.segTabCompact.fontWeight).toBe(typography.body.fontWeight);
    expect(typography.segTabCompactActive.fontWeight).toBe(typography.bodyStrong.fontWeight);
  });

  it("vier titels passen op een iPhone van 375 pt breed", () => {
    // Grove maat: een letter is hoogstens 0,62 × de lettergrootte breed (vet).
    const width = 375 - 2 * 16; // schermmarge
    const bar = width - 2 * 4 - 3 * 4; // padding en gaten van de balk
    const perTab = bar / 4 - 2 * SEG_TAB_PADDING.compact;
    const longest = Math.max(..."Albums Films Leden Geld".split(" ").map((t) => t.length));
    expect(longest * 0.62 * typography.segTabCompactActive.fontSize).toBeLessThanOrEqual(perTab);
  });
});
