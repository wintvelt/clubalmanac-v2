import { describe, expect, it } from "vitest";
import { metadataHeaders } from "../src/lib/upload";

// WP42 A5: datum en plaats uit de EXIF die `expo-image-picker` op Android
// teruggeeft. Android geeft de graden met teken (uit ExifInterface.getLatLong)
// en de richting als tekst erbij; de fotokiezer veegt de plaats weg, wat 0/0
// kan achterlaten. 0/0 is geen plaats, op elk platform. De datum blijft
// `DateTimeOriginal`, zoals de iPhone-app.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus 42a, A5.

const TAKEN = "2024:07:14 15:30:00";

describe("WP42 A5: EXIF van de Android-kiezer", () => {
  it("graden met teken en richting: de plaats en de datum gaan mee", () => {
    expect(
      metadataHeaders({
        DateTimeOriginal: TAKEN,
        GPSLatitude: 52.0907,
        GPSLongitude: 5.1214,
        GPSLatitudeRef: "N",
        GPSLongitudeRef: "E",
        GPSAltitude: 0,
      }),
    ).toEqual({ "X-Taken-At": TAKEN, "X-Latitude": "52.0907", "X-Longitude": "5.1214" });
  });

  it("zuid en west: al negatief, de richting draait het teken niet nog eens om", () => {
    expect(
      metadataHeaders({ GPSLatitude: -22.9519, GPSLongitude: -43.2105, GPSLatitudeRef: "S", GPSLongitudeRef: "W" }),
    ).toEqual({ "X-Latitude": "-22.9519", "X-Longitude": "-43.2105" });
  });

  it.each([
    ["met richting", { GPSLatitude: 0, GPSLongitude: 0, GPSLatitudeRef: "N", GPSLongitudeRef: "E" }],
    ["zonder richting", { GPSLatitude: 0, GPSLongitude: 0 }],
    ["min nul", { GPSLatitude: -0, GPSLongitude: 0, GPSLatitudeRef: "S", GPSLongitudeRef: "E" }],
    ["als tekst", { GPSLatitude: "0", GPSLongitude: "0.0" }],
  ])("weggeveegde plaats (0/0, %s): geen plaats, wel de datum", (_label, gps) => {
    expect(metadataHeaders({ DateTimeOriginal: TAKEN, ...gps })).toEqual({ "X-Taken-At": TAKEN });
  });

  it("NaN uit kapotte GPS-velden: geen plaats", () => {
    expect(
      metadataHeaders({ DateTimeOriginal: TAKEN, GPSLatitude: Number.NaN, GPSLongitude: Number.NaN, GPSLatitudeRef: "N" }),
    ).toEqual({ "X-Taken-At": TAKEN });
  });

  it.each([
    ["op de evenaar", { GPSLatitude: 0, GPSLongitude: 32.5825 }, { "X-Latitude": "0", "X-Longitude": "32.5825" }],
    ["op de nulmeridiaan", { GPSLatitude: 51.4779, GPSLongitude: 0 }, { "X-Latitude": "51.4779", "X-Longitude": "0" }],
  ])("alleen breedte of alleen lengte 0 (%s) is wel een plaats", (_label, gps, expected) => {
    expect(metadataHeaders(gps)).toEqual(expected);
  });
});
