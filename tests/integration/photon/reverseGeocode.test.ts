import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Photon reverse-geocoding — live integration tests
//
// Pin de aannames van convex/photos.ts:509-563 (reverseGeocode action) tegen
// de echte photon.komoot.io API. Bij rood: gat tussen onze aanname en de
// service. Niet zomaar fixen — eerst rapporteren (zie A-prompt).
//
// Productie-keuzes (zie ook docs/conventions/external-services.md):
//   - URL: https://photon.komoot.io/reverse?lat=<lat>&lon=<lon>&lang=en
//   - Header: User-Agent: Clubalmanac/2.0 (Photon fair-use vereiste)
//   - lang=en levert Latijns schrift voor non-Latin regio's
//     (Nepal/Devanagari, Georgië/Mkhedruli, etc.)
//
// Niet in CI. `npm run test:integration` runt deze handmatig.
// ---------------------------------------------------------------------------

const PHOTON_BASE = "https://photon.komoot.io/reverse";
const USER_AGENT = "Clubalmanac/2.0";

function photonUrl(lat: number, lon: number): string {
  return `${PHOTON_BASE}?lat=${lat}&lon=${lon}&lang=en`;
}

type PhotonResponse = {
  type?: string;
  features?: Array<{
    properties?: {
      street?: string;
      name?: string;
      city?: string;
      country?: string;
      state?: string;
      postcode?: string;
    };
  }>;
};

// Latijns schrift = scripts die productie als "leesbaar voor de UI" beschouwt.
// `Common`/`Inherited` voor leestekens, cijfers, spaties.
const LATIN_ONLY = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+$/u;

describe("Photon reverseGeocode — live API roundtrip", () => {
  it("Amsterdam centrum → response shape match productie-parsing + lang=en levert Latijns NL-label", async () => {
    const res = await fetch(photonUrl(52.3676, 4.9041), {
      headers: { "User-Agent": USER_AGENT },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PhotonResponse;

    expect(body.type).toBe("FeatureCollection");
    expect(Array.isArray(body.features)).toBe(true);
    expect(body.features?.length ?? 0).toBeGreaterThan(0);

    const props = body.features?.[0]?.properties ?? {};

    // Productie verwacht street | name fallback voor het street-deel van het
    // multi-deel label. Eén van beide moet beschikbaar zijn voor centrum-coord.
    const streetLike =
      typeof props.street === "string" || typeof props.name === "string";
    expect(streetLike).toBe(true);

    expect(typeof props.city).toBe("string");
    expect(typeof props.country).toBe("string");

    // lang=en pin: NL country = "Netherlands", niet "Nederland".
    expect(props.country).toBe("Netherlands");
    expect(props.country).toMatch(LATIN_ONLY);
  });

  it("Kathmandu (Nepal) → lang=en levert Latijns schrift, geen Devanagari", async () => {
    // 27.7172° N, 85.3240° E. Zonder lang=en zou country = "नेपाल".
    const res = await fetch(photonUrl(27.7172, 85.324), {
      headers: { "User-Agent": USER_AGENT },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PhotonResponse;

    expect(body.features?.length ?? 0).toBeGreaterThan(0);
    const props = body.features?.[0]?.properties ?? {};

    expect(typeof props.country).toBe("string");
    // Hard pin: country in Latijns schrift.
    expect(props.country).toMatch(LATIN_ONLY);

    // City optioneel (afhankelijk van precieze coord), maar als aanwezig:
    // ook Latijns. Productie-label-format mag niet ineens Devanagari bevatten.
    if (typeof props.city === "string" && props.city.length > 0) {
      expect(props.city).toMatch(LATIN_ONLY);
    }
  });

  it("User-Agent: Clubalmanac/2.0 reist over de wire", async () => {
    // Photon echoot headers niet terug, dus gebruiken we httpbin.org/anything
    // als wire-level echo. Bewijst dat onze fetch-constructie de UA echt
    // meestuurt — los van of Photon de UA accepteert (dat blijkt impliciet
    // uit de twee tests hierboven: Photon 200 met onze UA).
    const res = await fetch("https://httpbin.org/anything", {
      headers: { "User-Agent": USER_AGENT },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { headers?: Record<string, string> };

    const echoed =
      body.headers?.["User-Agent"] ?? body.headers?.["user-agent"];
    expect(echoed).toBe(USER_AGENT);
  });
});
