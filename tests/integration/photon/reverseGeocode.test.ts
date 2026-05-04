import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Photon reverse-geocoding — live integration tests
//
// Pin de aannames van convex/photos.ts:509-563 (reverseGeocode action) tegen
// de echte photon.komoot.io API. Bij rood: gat tussen onze aanname en de
// service. Niet zomaar fixen — eerst rapporteren (zie A-prompt discipline).
//
// Productie-keuzes (zie ook docs/conventions/external-services.md):
//   - URL: https://photon.komoot.io/reverse?lat=<lat>&lon=<lon>&lang=en
//   - Header: User-Agent: Clubalmanac/2.0 (Photon fair-use vereiste)
//   - lang=en levert Latijns schrift voor non-Latin regio's
//
// Niet in CI. `npm run test:integration` runt deze handmatig.
// ---------------------------------------------------------------------------

const PHOTON_BASE = "https://photon.komoot.io/reverse";
const USER_AGENT = "Clubalmanac/2.0";

function photonUrl(
  lat: number,
  lon: number,
  opts: { lang?: "en" } = {},
): string {
  const langPart = opts.lang ? `&lang=${opts.lang}` : "";
  return `${PHOTON_BASE}?lat=${lat}&lon=${lon}${langPart}`;
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
    const res = await fetch(photonUrl(52.3676, 4.9041, { lang: "en" }), {
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

  it("Kathmandu A/B: zonder lang→Devanagari, met lang=en→Latijn (causaliteit van lang=en)", async () => {
    // 27.7172° N, 85.3240° E. A/B-call met dezelfde coord pint causaliteit:
    // het Latijnse schrift komt door onze `lang=en` keuze, niet door
    // toevallig Photon-default of OSM-data die in Latijn staat. Twee calls
    // per run is binnen fair-use voor 16-user app.
    const KATHMANDU = { lat: 27.7172, lon: 85.324 };

    const [resWithout, resWith] = await Promise.all([
      fetch(photonUrl(KATHMANDU.lat, KATHMANDU.lon), {
        headers: { "User-Agent": USER_AGENT },
      }),
      fetch(photonUrl(KATHMANDU.lat, KATHMANDU.lon, { lang: "en" }), {
        headers: { "User-Agent": USER_AGENT },
      }),
    ]);

    expect(resWithout.status).toBe(200);
    expect(resWith.status).toBe(200);

    const bodyWithout = (await resWithout.json()) as PhotonResponse;
    const bodyWith = (await resWith.json()) as PhotonResponse;

    const propsWithout = bodyWithout.features?.[0]?.properties ?? {};
    const propsWith = bodyWith.features?.[0]?.properties ?? {};

    // A: zonder lang-param. Native script (Devanagari) verwacht in country
    // of city. Tenminste één van beide bevat non-Latijnse tekens.
    const aHasNonLatin =
      (typeof propsWithout.country === "string" &&
        !LATIN_ONLY.test(propsWithout.country)) ||
      (typeof propsWithout.city === "string" &&
        !LATIN_ONLY.test(propsWithout.city));
    expect(aHasNonLatin).toBe(true);

    // B: met lang=en. Latijns schrift, geen Devanagari.
    expect(typeof propsWith.country).toBe("string");
    expect(propsWith.country).toMatch(LATIN_ONLY);
    if (typeof propsWith.city === "string" && propsWith.city.length > 0) {
      expect(propsWith.city).toMatch(LATIN_ONLY);
    }
  });

  it("Rijksmuseum POI → street is undefined (wild-case voor productie-fallback in convex/photos.ts:543-546)", async () => {
    // Probe (mei 2026) toonde 7 POI-coords; geen enkele leverde literal
    // `street: ""`. Wel: Rijksmuseum (52.3600, 4.8852) levert response
    // ZONDER `street`-veld, mét `name: "Museumstraat"`. Dat is de
    // wild-trigger voor de fallback-tak in `convex/photos.ts:543-546`:
    //
    //   const streetLabel =
    //     typeof props.street === "string" && props.street.length > 0
    //       ? props.street
    //       : props.name;
    //
    // De length-check dekt zowel `undefined` als `""` met dezelfde tak.
    // Het exacte `""`-pad uit audit-13 §1 wordt mock-based gedekt door
    // `tests/photos/extractMetadata.test.ts:691`. Deze integration-test
    // pin't dat de undefined-variant daadwerkelijk in de wild voorkomt
    // en dezelfde fallback bereikt.
    const res = await fetch(photonUrl(52.36, 4.8852, { lang: "en" }), {
      headers: { "User-Agent": USER_AGENT },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PhotonResponse;

    expect(body.features?.length ?? 0).toBeGreaterThan(0);
    const props = body.features?.[0]?.properties ?? {};

    expect(props.street).toBeUndefined();
    expect(typeof props.name).toBe("string");
    expect((props.name ?? "").length).toBeGreaterThan(0);
  });
});
