import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_UPLOAD_BYTES } from "../../convex/lib/constants";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";
import { modules } from "../_helpers/modules";
import { JPEG, leftovers } from "./_upload";

// WP36 A-invariant U1 en U2: de webapp uploadt met `fetch` naar `POST /upload`,
// met het Clerk-token in `Authorization` en de headers van de iPhone-app
// (`X-Upload-Id`, `X-Album-Id`, `X-Taken-At`, `X-Latitude`, `X-Longitude`) en
// `Content-Type: image/jpeg`. Die maken het verzoek "niet eenvoudig": de
// browser vraagt eerst `OPTIONS /upload`.
//
// - Dezelfde origins als de beeldpaden (`CLUBALMANAC_WEB_ORIGINS`, WP35 W1/W2).
// - De preflight staat `POST` toe en precies de headers die de app stuurt; geen
//   `*`, geen `Allow-Credentials`. `X-Filename` hoort er niet bij: de iPhone
//   stuurt hem niet, en een bestandsnaam van een telefoon kan iets verraden.
// - Elk antwoord van `/upload` op een toegestane origin draagt de header, ook
//   400, 401, 403, 404, 409, 413 en 415: de app leest de status en kiest de
//   reden en het opnieuw proberen (zoals op de iPhone).
// - De toegang en het gedrag veranderen niet: CORS is geen toegangscontrole.
//   Een andere origin of geen `Origin` (de iPhone) geeft hetzelfde antwoord,
//   zonder header.
// - De beeldpaden blijven alleen `GET` met `Authorization` (WP35).
//
// Spec: docs/work-packages/WP36-webapp-uploaden.md §Spec-criticus aanvullingen.

type T = ReturnType<typeof convexTest>;

const ENV = "CLUBALMANAC_WEB_ORIGINS";
const STAGE = "CLUBALMANAC_STAGE";
const PROD_ORIGIN = "https://app.clubalmanac.com";
const DEV_ORIGIN = "http://localhost:8081";
const OTHER_ORIGINS = [
  "https://evil.example",
  "http://app.clubalmanac.com",
  "https://app.clubalmanac.com.evil.example",
  "https://clubalmanac.com",
  "https://app.clubalmanac.com:8443",
  "null",
];
const APP_HEADERS = [
  "authorization",
  "content-type",
  "x-upload-id",
  "x-album-id",
  "x-taken-at",
  "x-latitude",
  "x-longitude",
];
const ACAO = "Access-Control-Allow-Origin";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved[ENV] = process.env[ENV];
  saved[STAGE] = process.env[STAGE];
  process.env[ENV] = `${PROD_ORIGIN},${DEV_ORIGIN}`;
  process.env[STAGE] = "dev";
  // Geen echte Photon-aanroep vanuit de geplande extractMetadata.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ type: "FeatureCollection", features: [] })),
  );
});

afterEach(() => {
  for (const key of [ENV, STAGE]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function tokens(res: Response, header: string): string[] {
  return (res.headers.get(header) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
}

function preflight(t: T, path: string, origin: string, requestHeaders = APP_HEADERS.join(", ")) {
  return t.fetch(path, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": requestHeaders,
    },
  });
}

type PostOpts = {
  subject?: string | null;
  origin?: string;
  uploadId?: string | null;
  body?: Uint8Array;
  headers?: Record<string, string>;
};

function post(t: T, opts: PostOpts = {}) {
  const headers: Record<string, string> = { "Content-Type": "image/jpeg", ...(opts.headers ?? {}) };
  if (opts.origin !== undefined) headers.Origin = opts.origin;
  if (opts.uploadId !== null) headers["X-Upload-Id"] = opts.uploadId ?? "web-1";
  const init: RequestInit = { method: "POST", headers, body: (opts.body ?? JPEG) as BodyInit };
  const subject = opts.subject === undefined ? "user_owen" : opts.subject;
  return subject === null ? t.fetch("/upload", init) : withUser(t, subject).fetch("/upload", init);
}

function expectAllowed(res: Response, origin: string) {
  expect(res.headers.get(ACAO)).toBe(origin);
  expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  expect(tokens(res, "Vary")).toContain("origin");
}

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const xena = await registerUser(t, "user_xena", "xena@x.com", "Xena");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  // Een groep waar Owen geen lid van is.
  const H = await withUser(t, "user_xena").mutation(api.groups.create, { name: "H" });
  const B = await withUser(t, "user_xena").mutation(api.albums.create, { groupId: H, name: "B" });
  return { owen, xena, G, A, H, B };
}

describe("U1 — preflight op /upload van een toegestane origin", () => {
  for (const origin of [PROD_ORIGIN, DEV_ORIGIN]) {
    it(`${origin}: 204 met de origin, POST, de headers van de app, Max-Age en Vary: Origin`, async () => {
      const t = convexTest(schema, modules);
      const res = await preflight(t, "/upload", origin);
      expect(res.status).toBe(204);
      expectAllowed(res, origin);
      const methods = tokens(res, "Access-Control-Allow-Methods");
      expect(methods).toContain("post");
      for (const m of ["put", "patch", "delete", "*"]) expect(methods).not.toContain(m);
      const allowed = tokens(res, "Access-Control-Allow-Headers");
      for (const h of APP_HEADERS) expect(allowed, h).toContain(h);
      const maxAge = Number(res.headers.get("Access-Control-Max-Age"));
      expect(Number.isInteger(maxAge) && maxAge > 0).toBe(true);
    });
  }

  it("nooit `*`: niet als origin, niet als header", async () => {
    const t = convexTest(schema, modules);
    const res = await preflight(t, "/upload", PROD_ORIGIN);
    expect(res.headers.get(ACAO)).not.toBe("*");
    expect(tokens(res, "Access-Control-Allow-Headers")).not.toContain("*");
  });

  it("geen `X-Filename`: de webapp stuurt geen bestandsnaam", async () => {
    const t = convexTest(schema, modules);
    const res = await preflight(t, "/upload", PROD_ORIGIN, "authorization, content-type, x-upload-id, x-filename");
    expect(tokens(res, "Access-Control-Allow-Headers")).not.toContain("x-filename");
  });

  it("de preflight vraagt geen login (een browser stuurt er geen token bij)", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/upload", {
      method: "OPTIONS",
      headers: { Origin: PROD_ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get(ACAO)).toBe(PROD_ORIGIN);
  });
});

describe("U1 — preflight op /upload van een andere origin", () => {
  for (const origin of OTHER_ORIGINS) {
    it(`${origin}: 403 zonder Access-Control-Allow-Origin`, async () => {
      const t = convexTest(schema, modules);
      const res = await preflight(t, "/upload", origin);
      expect(res.status).toBe(403);
      expect(res.headers.get(ACAO)).toBeNull();
    });
  }
});

describe("U1 — elk antwoord van /upload op een toegestane origin draagt de header", () => {
  it("200: een nieuwe foto, met de origin", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await post(t, { origin: PROD_ORIGIN });
    expect(res.status).toBe(200);
    expectAllowed(res, PROD_ORIGIN);
    const { photoId } = (await res.json()) as { photoId: string };
    expect(typeof photoId).toBe("string");
  });

  it("200 met album: de foto staat in het album, met de origin", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await post(t, { origin: PROD_ORIGIN, headers: { "X-Album-Id": s.A } });
    expect(res.status).toBe(200);
    expectAllowed(res, PROD_ORIGIN);
    expect((await leftovers(t, s.owen)).albumPhotos).toBe(1);
  });

  it("400 zonder upload-id", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await post(t, { origin: PROD_ORIGIN, uploadId: null });
    expect(res.status).toBe(400);
    expectAllowed(res, PROD_ORIGIN);
  });

  it("401 uitgelogd: met de header, zodat de app een vers token kan halen", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await post(t, { origin: PROD_ORIGIN, subject: null });
    expect(res.status).toBe(401);
    expectAllowed(res, PROD_ORIGIN);
  });

  it("401 voor een login zonder users-rij", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await post(t, { origin: PROD_ORIGIN, subject: "user_niemand" });
    expect(res.status).toBe(401);
    expectAllowed(res, PROD_ORIGIN);
  });

  it("403 op de limiet", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.run((ctx) => ctx.db.patch(s.owen, { photoLimit: 0 }));
    const res = await post(t, { origin: PROD_ORIGIN });
    expect(res.status).toBe(403);
    expectAllowed(res, PROD_ORIGIN);
  });

  it("404 voor een album van een groep waar hij geen lid van is, en er blijft niets achter", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await post(t, { origin: PROD_ORIGIN, headers: { "X-Album-Id": s.B } });
    expect(res.status).toBe(404);
    expectAllowed(res, PROD_ORIGIN);
    expect(await leftovers(t, s.owen)).toEqual({
      photos: 0,
      reservations: 0,
      storage: 0,
      albumPhotos: 0,
      photoCount: 0,
    });
  });

  it("409 terwijl dezelfde upload-id nog loopt", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.run((ctx) =>
      ctx.db.insert("uploadIdempotency", {
        ownerId: s.owen,
        clientUploadId: "web-1",
        status: "in_progress",
        createdAt: Date.now(),
      }),
    );
    const res = await post(t, { origin: PROD_ORIGIN });
    expect(res.status).toBe(409);
    expectAllowed(res, PROD_ORIGIN);
  });

  it("413 boven de grens", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(JPEG);
    const res = await post(t, { origin: PROD_ORIGIN, body: big });
    expect(res.status).toBe(413);
    expectAllowed(res, PROD_ORIGIN);
  });

  it("415 voor iets dat geen foto is", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await post(t, { origin: PROD_ORIGIN, body: new TextEncoder().encode("<svg></svg>") });
    expect(res.status).toBe(415);
    expectAllowed(res, PROD_ORIGIN);
  });
});

describe("U2 — de toegang en het gedrag veranderen niet", () => {
  it("opnieuw proberen met dezelfde upload-id vanuit de browser: dezelfde foto, één foto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const first = await post(t, { origin: PROD_ORIGIN, headers: { "X-Album-Id": s.A } });
    const again = await post(t, { origin: PROD_ORIGIN, headers: { "X-Album-Id": s.A } });
    expect(again.status).toBe(200);
    expectAllowed(again, PROD_ORIGIN);
    const a = (await first.json()) as { photoId: string };
    const b = (await again.json()) as { photoId: string };
    expect(b.photoId).toBe(a.photoId);
    const left = await leftovers(t, s.owen);
    expect(left.photos).toBe(1);
    expect(left.albumPhotos).toBe(1);
  });

  it("datum en plaats als headers uit de browser komen bij de foto", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await post(t, {
      origin: PROD_ORIGIN,
      headers: { "X-Taken-At": "2024:07:14 15:30:00", "X-Latitude": "-33.8568", "X-Longitude": "151.2153" },
    });
    expect(res.status).toBe(200);
    const { photoId } = (await res.json()) as { photoId: Id<"photos"> };
    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo!.takenAt).toBe(Date.UTC(2024, 6, 14, 15, 30, 0));
    expect(photo!.latitude).toBeCloseTo(-33.8568, 6);
    expect(photo!.longitude).toBeCloseTo(151.2153, 6);
  });

  for (const origin of OTHER_ORIGINS) {
    it(`${origin}: zelfde antwoord, zonder Access-Control-Allow-Origin`, async () => {
      const t = convexTest(schema, modules);
      const s = await setup(t);
      const res = await post(t, { origin, headers: { "X-Album-Id": s.B } });
      expect(res.status).toBe(404);
      expect(res.headers.get(ACAO)).toBeNull();
    });
  }

  it("de iPhone-app (geen Origin): geen CORS-header, gewoon 200", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await post(t, { headers: { "X-Album-Id": s.A } });
    expect(res.status).toBe(200);
    expect(res.headers.get(ACAO)).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("een lid van de groep van Xena mag wel in haar album, ook vanuit de browser", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await seedMember(t, { groupId: s.H, userId: s.owen });
    const res = await post(t, { origin: DEV_ORIGIN, headers: { "X-Album-Id": s.B } });
    expect(res.status).toBe(200);
    expectAllowed(res, DEV_ORIGIN);
  });
});

describe("U2 — fail-loud zonder de iPhone te raken", () => {
  it("env-var ontbreekt: preflight 403 zonder header, een fout met de naam in de log", async () => {
    delete process.env[ENV];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const res = await preflight(t, "/upload", PROD_ORIGIN);
    expect(res.status).toBe(403);
    expect(res.headers.get(ACAO)).toBeNull();
    expect(spy.mock.calls.some((args) => args.map(String).join(" ").includes(ENV))).toBe(true);
  });

  it("env-var ontbreekt: de iPhone-app uploadt gewoon", async () => {
    delete process.env[ENV];
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await post(t);
    expect(res.status).toBe(200);
    expect(res.headers.get(ACAO)).toBeNull();
  });

  it("op prod telt een http-origin niet, ook niet op /upload", async () => {
    process.env[STAGE] = "prod";
    process.env[ENV] = `${PROD_ORIGIN},${DEV_ORIGIN}`;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    expect((await preflight(t, "/upload", DEV_ORIGIN)).status).toBe(403);
    expect((await preflight(t, "/upload", PROD_ORIGIN)).status).toBe(204);
  });
});

describe("U1 — de beeldpaden veranderen niet", () => {
  it("preflight op /beeld/foto en /beeld/uitnodiging: alleen GET en alleen Authorization", async () => {
    const t = convexTest(schema, modules);
    for (const path of ["/beeld/foto/abc", "/beeld/uitnodiging/abc"]) {
      const res = await t.fetch(path, {
        method: "OPTIONS",
        headers: {
          Origin: PROD_ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      });
      expect(res.status, path).toBe(204);
      const methods = tokens(res, "Access-Control-Allow-Methods");
      expect(methods, path).toContain("get");
      expect(methods, path).not.toContain("post");
      expect(tokens(res, "Access-Control-Allow-Headers"), path).toEqual(["authorization"]);
    }
  });

  it("het profielpad (openbaar) krijgt nog steeds geen preflight", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/beeld/profiel/abc", {
      method: "OPTIONS",
      headers: { Origin: PROD_ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers.get(ACAO)).toBeNull();
  });
});
