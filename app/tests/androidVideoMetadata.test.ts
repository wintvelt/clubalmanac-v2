import { afterEach, describe, expect, it } from "vitest";
import { locationFromISO6709, takenAtFromQuickTime, takenAtFromUtc, videoMetadataHeaders } from "../src/lib/videos";

// WP42b — datum en plaats van een filmpje op Android.
//   B11 + A17: Android geeft het moment van opnemen in UTC
//   (MediaMetadataRetriever, METADATA_KEY_DATE, "20261126T174453.000Z").
//   De app rekent dat om naar de kloktijd van de tijdzone van de telefoon,
//   met de regels van die zone op het moment van opnemen (zomertijd), en
//   stuurt die als `X-Taken-At` (zoals de EXIF-tijd van een foto, WP37
//   A-inv. 14). Geen datum (mvhd 0 = "19040101T000000.000Z"): geen datum.
//   A18: de plaats zoals Android hem geeft. MediaMuxer (de camera)
//   schrijft "+52.3676+004.9041/", Media3 "+52.3676+4.9041/" (gemeten,
//   emulator API 35). 0/0 is geen plaats (42a A5), ook bij een filmpje.
// De vormen hieronder zijn gemeten op de emulator (meetapp, zie
// tests/fixtures/wp42b/README.md), niet bedacht.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42b.

// De tijdzone van de "telefoon": Node volgt een wijziging van TZ tijdens het draaien.
const ORIGINAL_TZ = process.env.TZ;
function inZone<T>(zone: string, run: () => T): T {
  process.env.TZ = zone;
  return run();
}
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("takenAtFromUtc: de UTC-tijd van Android als kloktijd van de telefoon (B11)", () => {
  it("gemeten: 17:44:53 UTC op een emulator in Amsterdam (november) is 18:44:53", () => {
    expect(inZone("Europe/Amsterdam", () => takenAtFromUtc("20261126T174453.000Z"))).toBe("2026:11:26 18:44:53");
  });

  it("zomertijd volgt het moment van opnemen, niet het moment van kiezen: juli in Amsterdam is +2", () => {
    // Gekozen in november (wintertijd, +1), opgenomen in juli (+2): 15:32, niet 14:32.
    expect(inZone("Europe/Amsterdam", () => takenAtFromUtc("20260714T133210.000Z"))).toBe("2026:07:14 15:32:10");
  });

  it("over middernacht en de jaargrens heen", () => {
    expect(inZone("Europe/Amsterdam", () => takenAtFromUtc("20261231T233000.000Z"))).toBe("2027:01:01 00:30:00");
  });

  it("andere zones: New York in de zomer -4, India +5:30, UTC ongewijzigd", () => {
    expect(inZone("America/New_York", () => takenAtFromUtc("20260714T133210.000Z"))).toBe("2026:07:14 09:32:10");
    expect(inZone("Asia/Kolkata", () => takenAtFromUtc("20260714T133210.000Z"))).toBe("2026:07:14 19:02:10");
    expect(inZone("UTC", () => takenAtFromUtc("20260714T133210.000Z"))).toBe("2026:07:14 13:32:10");
  });

  it("ook in de gewone ISO-vorm met Z (als de module hem zo doorgeeft)", () => {
    expect(inZone("Europe/Amsterdam", () => takenAtFromUtc("2026-07-14T13:32:10Z"))).toBe("2026:07:14 15:32:10");
    expect(inZone("Europe/Amsterdam", () => takenAtFromUtc("2026-07-14T13:32:10.000Z"))).toBe("2026:07:14 15:32:10");
  });

  it.each([
    ["gemeten: mvhd 0 (geen datum in het bestand)", "19040101T000000.000Z"],
    ["Unix 0", "19700101T000000.000Z"],
    ["leeg", ""],
    ["geen datum", "geen datum"],
    ["maand 13", "20261340T120000.000Z"],
    ["31 februari", "20260231T120000.000Z"],
    ["uur 24", "20260714T240000.000Z"],
    ["null", null],
    ["undefined", undefined],
  ])("%s: geen datum, nooit vandaag", (_label, value) => {
    expect(inZone("Europe/Amsterdam", () => takenAtFromUtc(value as string | null | undefined))).toBeNull();
  });
});

describe("videoMetadataHeaders met de metadata van Android (B11, A17, A18)", () => {
  it("UTC-datum en plaats van een Android-camera: kloktijd van de telefoon en de plaats", () => {
    const headers = inZone("Europe/Amsterdam", () =>
      videoMetadataHeaders({ creationDate: null, utcDate: "20260714T133210.000Z", location: "+52.3676+004.9041/" }),
    );
    expect(headers).toEqual({ "X-Taken-At": "2026:07:14 15:32:10", "X-Latitude": "52.3676", "X-Longitude": "4.9041" });
  });

  it("zonder datum en zonder plaats: geen headers (invariant 3)", () => {
    const headers = inZone("Europe/Amsterdam", () =>
      videoMetadataHeaders({ creationDate: null, utcDate: "19040101T000000.000Z", location: null }),
    );
    expect(headers).toEqual({});
  });

  it("iOS blijft gelijk: de kloktijd uit com.apple.quicktime.creationdate, de tijdzone van de telefoon telt niet", () => {
    const headers = inZone("America/New_York", () =>
      videoMetadataHeaders({ creationDate: "2026-07-14T15:32:10+0200", location: "+52.3676+004.9041+000.000/" }),
    );
    expect(headers).toEqual({ "X-Taken-At": "2026:07:14 15:32:10", "X-Latitude": "52.3676", "X-Longitude": "4.9041" });
    expect(takenAtFromQuickTime("2026-07-14T15:32:10+0200")).toBe("2026:07:14 15:32:10");
  });
});

describe("locationFromISO6709: de vormen van Android (A18)", () => {
  it.each([
    ["MediaMuxer, noord/oost", "+52.3676+004.9041/", { latitude: 52.3676, longitude: 4.9041 }],
    ["MediaMuxer, zuid/oost", "-33.8688+151.2093/", { latitude: -33.8688, longitude: 151.2093 }],
    ["MediaMuxer, noord/west", "+40.7128-074.0060/", { latitude: 40.7128, longitude: -74.006 }],
    ["MediaMuxer, net onder 0", "-00.5000-000.2500/", { latitude: -0.5, longitude: -0.25 }],
  ])("gemeten %s: %s", (_label, value, spot) => {
    expect(locationFromISO6709(value)).toEqual(spot);
  });

  it.each([
    ["Media3, noord/oost", "+52.3676+4.9041/", { latitude: 52.3676, longitude: 4.9041 }],
    ["Media3, noord/west", "+40.7128-74.0060/", { latitude: 40.7128, longitude: -74.006 }],
    ["Media3, zuid/west", "-22.9519-43.2105/", { latitude: -22.9519, longitude: -43.2105 }],
  ])("gemeten vorm van %s (lengte zonder voorloopnullen): %s", (_label, value, spot) => {
    expect(locationFromISO6709(value)).toEqual(spot);
  });

  it.each([
    ["0/0 van MediaMuxer", "+00.0000+000.0000/"],
    ["0/0 van Media3", "+0.0000+0.0000/"],
    ["-0/-0", "-00.0000-000.0000/"],
    ["0/0 met hoogte", "+00.0000+000.0000+000.000/"],
  ])("%s is geen plaats (42a A5): %s", (_label, value) => {
    expect(locationFromISO6709(value)).toBeNull();
  });

  it("alleen de breedte of alleen de lengte 0 is wel een plaats", () => {
    expect(locationFromISO6709("+00.0000+004.9041/")).toEqual({ latitude: 0, longitude: 4.9041 });
    expect(locationFromISO6709("+52.3676+000.0000/")).toEqual({ latitude: 52.3676, longitude: 0 });
  });

  it.each([
    ["leeg (weggepoetst door de kiezer)", ""],
    ["nullen (weggepoetst door de kiezer)", "\u0000\u0000\u0000\u0000\u0000\u0000"],
    ["buiten bereik", "+95.0000+004.9041/"],
    ["null", null],
  ])("%s: geen plaats", (_label, value) => {
    expect(locationFromISO6709(value as string | null)).toBeNull();
  });

  it("0/0 als plaats van een filmpje geeft geen plaats-headers, de datum blijft", () => {
    const headers = inZone("Europe/Amsterdam", () =>
      videoMetadataHeaders({ creationDate: null, utcDate: "20260714T133210.000Z", location: "+00.0000+000.0000/" }),
    );
    expect(headers).toEqual({ "X-Taken-At": "2026:07:14 15:32:10" });
  });
});
