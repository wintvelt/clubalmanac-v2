import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { bytesOf, containsBytes, sameBytes, SCHOON } from "../_helpers/jpeg";
import { seedMember } from "../_helpers/membership";
import { modules } from "../_helpers/modules";
import { seedCover, seedInvite, world } from "../invites/_wp19b";

// WP35 A-invariant W1, W2 en W3: de webapp haalt een foto of uitnodigingscover
// op met `fetch` en het Clerk-token in de `Authorization`-header (vraag 1,
// route A). Die header maakt elk verzoek "niet eenvoudig": de browser vraagt
// eerst `OPTIONS`. Spec: docs/work-packages/WP35-webapp-bekijken.md
// §Spec-criticus aanvullingen.
//
// - CORS alleen op `/beeld/foto/*` en `/beeld/uitnodiging/*`, alleen voor de
//   origins in `CLUBALMANAC_WEB_ORIGINS` (exacte origins, komma-gescheiden).
//   Op prod tellen alleen `https://`-origins.
// - Een toegestane origin krijgt de header bij élk antwoord (ook 400, 401 en
//   404), zodat de app een 401 ziet en een vers token haalt. De toegang zelf
//   verandert niet: één 404 voor geen toegang, ex-lid, onbekend en misvormd.
// - Elke andere origin: geen `Access-Control-Allow-Origin`, preflight 403.
// - Zonder `Origin` (de iPhone-app): precies zoals nu, zonder CORS-header.
// - Ontbreekt de env-var of is een waarde geen exacte origin: die waarde telt
//   niet, en een verzoek uit de browser logt een fout met de naam (fail-loud),
//   zonder de iPhone te raken.
// - Geen token in een URL: een token in de query telt niet.

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
  "https://www.clubalmanac.com",
  "https://app.clubalmanac.com:8443",
  "null",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved[ENV] = process.env[ENV];
  saved[STAGE] = process.env[STAGE];
  process.env[ENV] = `${PROD_ORIGIN},${DEV_ORIGIN}`;
  process.env[STAGE] = "dev";
});

afterEach(() => {
  for (const key of [ENV, STAGE]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

async function setup(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  await registerUser(t, "user_xena", "xena@x.com", "Xena");
  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A" });
  const photoId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([SCHOON as BlobPart], { type: "image/jpeg" }));
    return await ctx.db.insert("photos", { ownerId: owen, storageId, createdAt: Date.now() });
  });
  await withUser(t, "user_owen").mutation(api.albums.addPhoto, { albumId: A, photoId });
  return { owen, mia, G, A, photoId };
}

async function inviteSetup(t: T) {
  const w = await world(t);
  await seedCover(t, w, { bytes: SCHOON });
  const inviteId = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
  return { inviteId };
}

const photoPath = (id: string, formaat?: string) => `/beeld/foto/${id}${formaat ? `?formaat=${formaat}` : ""}`;
const invitePath = (id: string, formaat?: string) =>
  `/beeld/uitnodiging/${id}${formaat ? `?formaat=${formaat}` : ""}`;

function preflight(t: T, path: string, origin: string, method = "GET") {
  return t.fetch(path, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "authorization",
    },
  });
}

function get(t: T, subject: string | null, path: string, origin?: string) {
  const headers: Record<string, string> = origin === undefined ? {} : { Origin: origin };
  const init: RequestInit = { method: "GET", headers };
  return subject === null ? t.fetch(path, init) : withUser(t, subject).fetch(path, init);
}

const ACAO = "Access-Control-Allow-Origin";

function tokens(res: Response, header: string): string[] {
  return (res.headers.get(header) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
}

async function snapshot(res: Response) {
  return { status: res.status, body: Array.from(await bytesOf(res)).join(",") };
}

function errorSpy() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

function logged(spy: ReturnType<typeof errorSpy>, needle: string): boolean {
  return spy.mock.calls.some((args) => args.map(String).join(" ").includes(needle));
}

function expectAllowed(res: Response, origin: string) {
  expect(res.headers.get(ACAO)).toBe(origin);
  expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  expect(tokens(res, "Vary")).toContain("origin");
}

describe("W1 — preflight van een toegestane origin", () => {
  for (const origin of [PROD_ORIGIN, DEV_ORIGIN]) {
    it(`${origin}: 204 met de origin, GET, Authorization, Max-Age en Vary: Origin (foto en uitnodiging)`, async () => {
      const t = convexTest(schema, modules);
      const s = await setup(t);
      for (const path of [photoPath(s.photoId, "klein"), invitePath("abc", "klein")]) {
        const res = await preflight(t, path, origin);
        expect(res.status, path).toBe(204);
        expectAllowed(res, origin);
        const methods = tokens(res, "Access-Control-Allow-Methods");
        expect(methods).toContain("get");
        for (const m of ["post", "put", "patch", "delete"]) expect(methods).not.toContain(m);
        expect(tokens(res, "Access-Control-Allow-Headers")).toContain("authorization");
        const maxAge = Number(res.headers.get("Access-Control-Max-Age"));
        expect(Number.isInteger(maxAge) && maxAge > 0).toBe(true);
      }
    });
  }

  it("de preflight verraadt niets: een bestaand en een onbekend id geven hetzelfde antwoord", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const real = await preflight(t, photoPath(s.photoId), PROD_ORIGIN);
    const garbage = await preflight(t, photoPath("geen-id"), PROD_ORIGIN);
    expect(real.status).toBe(204);
    expect(garbage.status).toBe(real.status);
    expect(garbage.headers.get(ACAO)).toBe(real.headers.get(ACAO));
  });

  it("nooit `*` als origin", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await preflight(t, photoPath(s.photoId), PROD_ORIGIN);
    expect(res.headers.get(ACAO)).not.toBe("*");
  });
});

describe("W1 — preflight van een andere origin", () => {
  for (const origin of OTHER_ORIGINS) {
    it(`${origin}: 403 zonder Access-Control-Allow-Origin`, async () => {
      const t = convexTest(schema, modules);
      const s = await setup(t);
      for (const path of [photoPath(s.photoId), invitePath("abc")]) {
        const res = await preflight(t, path, origin);
        expect(res.status, path).toBe(403);
        expect(res.headers.get(ACAO)).toBeNull();
      }
    });
  }
});

describe("W1 — GET van een toegestane origin: de header bij elk antwoord, de toegang gelijk", () => {
  it("lid: 200 met precies de bytes, de origin, en Vary met Origin en Authorization", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await get(t, "user_mia", photoPath(s.photoId, "klein"), PROD_ORIGIN);
    expect(res.status).toBe(200);
    expectAllowed(res, PROD_ORIGIN);
    expect(tokens(res, "Vary")).toContain("authorization");
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bprivate\b/);
    expect(sameBytes(await bytesOf(res), SCHOON)).toBe(true);
  });

  it("uitgelogd: 401 met de origin, zonder bytes", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await get(t, null, photoPath(s.photoId, "klein"), PROD_ORIGIN);
    expect(res.status).toBe(401);
    expectAllowed(res, PROD_ORIGIN);
    expect(containsBytes(await bytesOf(res), SCHOON)).toBe(false);
  });

  it("onbekend formaat: 400 met de origin", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await get(t, "user_mia", photoPath(s.photoId, "reuze"), PROD_ORIGIN);
    expect(res.status).toBe(400);
    expectAllowed(res, PROD_ORIGIN);
  });

  it("geen toegang, ex-lid, onbekend en misvormd: één en hetzelfde 404, elk met de origin", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const noAccessRes = await get(t, "user_xena", photoPath(s.photoId, "klein"), PROD_ORIGIN);
    expectAllowed(noAccessRes, PROD_ORIGIN);
    const noAccess = await snapshot(noAccessRes);
    expect(noAccess.status).toBe(404);

    const garbageRes = await get(t, "user_xena", photoPath("geen-id", "klein"), PROD_ORIGIN);
    expectAllowed(garbageRes, PROD_ORIGIN);
    expect(await snapshot(garbageRes)).toEqual(noAccess);

    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("photos", {
        ownerId: s.owen,
        storageId: await ctx.storage.store(new Blob(["weg"])),
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    const goneRes = await get(t, "user_xena", photoPath(gone, "klein"), PROD_ORIGIN);
    expectAllowed(goneRes, PROD_ORIGIN);
    expect(await snapshot(goneRes)).toEqual(noAccess);

    // Ex-lid: dezelfde URL die net nog werkte.
    expect((await get(t, "user_mia", photoPath(s.photoId, "klein"), PROD_ORIGIN)).status).toBe(200);
    await withUser(t, "user_mia").mutation(api.groups.removeMember, { groupId: s.G, userId: s.mia });
    const exRes = await get(t, "user_mia", photoPath(s.photoId, "klein"), PROD_ORIGIN);
    expectAllowed(exRes, PROD_ORIGIN);
    expect(await snapshot(exRes)).toEqual(noAccess);
  });

  it("uitnodigingscover: 200 voor de genodigde, 401 uitgelogd, 404 voor een ander; elk met de origin", async () => {
    const t = convexTest(schema, modules);
    const { inviteId } = await inviteSetup(t);
    const ok = await get(t, "user_bob", invitePath(inviteId, "klein"), PROD_ORIGIN);
    expect(ok.status).toBe(200);
    expectAllowed(ok, PROD_ORIGIN);
    const anon = await get(t, null, invitePath(inviteId, "klein"), PROD_ORIGIN);
    expect(anon.status).toBe(401);
    expectAllowed(anon, PROD_ORIGIN);
    const other = await get(t, "user_eve", invitePath(inviteId, "klein"), PROD_ORIGIN);
    expect(other.status).toBe(404);
    expectAllowed(other, PROD_ORIGIN);
  });
});

describe("W1 — GET van een andere origin of zonder Origin", () => {
  for (const origin of OTHER_ORIGINS) {
    it(`${origin}: geen Access-Control-Allow-Origin; de toegang blijft gelijk`, async () => {
      const t = convexTest(schema, modules);
      const s = await setup(t);
      const res = await get(t, "user_mia", photoPath(s.photoId, "klein"), origin);
      expect(res.status).toBe(200);
      expect(res.headers.get(ACAO)).toBeNull();
      const anon = await get(t, null, photoPath(s.photoId, "klein"), origin);
      expect(anon.status).toBe(401);
      expect(anon.headers.get(ACAO)).toBeNull();
    });
  }

  it("de iPhone (geen Origin): geen CORS-header, verder zoals nu", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const res = await get(t, "user_mia", photoPath(s.photoId, "klein"));
    expect(res.status).toBe(200);
    expect(res.headers.get(ACAO)).toBeNull();
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bprivate\b/);
    expect(tokens(res, "Vary")).toContain("authorization");
    expect(sameBytes(await bytesOf(res), SCHOON)).toBe(true);
    const invite = await inviteSetup(t);
    const cover = await get(t, "user_bob", invitePath(invite.inviteId, "klein"));
    expect(cover.status).toBe(200);
    expect(cover.headers.get(ACAO)).toBeNull();
  });
});

describe("W2 — CLUBALMANAC_WEB_ORIGINS, fail-loud", () => {
  for (const [label, value] of [
    ["ontbreekt", undefined],
    ["leeg", ""],
  ] as const) {
    it(`env ${label}: de browser krijgt niets (preflight 403, GET zonder header), de log noemt ${ENV}`, async () => {
      if (value === undefined) delete process.env[ENV];
      else process.env[ENV] = value;
      const spy = errorSpy();
      const t = convexTest(schema, modules);
      const s = await setup(t);
      const pre = await preflight(t, photoPath(s.photoId), PROD_ORIGIN);
      expect(pre.status).toBe(403);
      expect(pre.headers.get(ACAO)).toBeNull();
      const res = await get(t, "user_mia", photoPath(s.photoId, "klein"), PROD_ORIGIN);
      expect(res.headers.get(ACAO)).toBeNull();
      expect(logged(spy, ENV)).toBe(true);
    });

    it(`env ${label}: de iPhone (geen Origin) merkt niets en logt niets`, async () => {
      if (value === undefined) delete process.env[ENV];
      else process.env[ENV] = value;
      const spy = errorSpy();
      const t = convexTest(schema, modules);
      const s = await setup(t);
      const res = await get(t, "user_mia", photoPath(s.photoId, "klein"));
      expect(res.status).toBe(200);
      expect(sameBytes(await bytesOf(res), SCHOON)).toBe(true);
      expect(logged(spy, ENV)).toBe(false);
    });
  }

  for (const bad of [
    "*",
    `${PROD_ORIGIN}/`,
    "app.clubalmanac.com",
    `${PROD_ORIGIN}/pad`,
    `${PROD_ORIGIN}?x=1`,
  ]) {
    it(`ongeldige waarde ${JSON.stringify(bad)}: telt niet, nooit \`*\`, de log noemt ${ENV}`, async () => {
      process.env[ENV] = bad;
      const spy = errorSpy();
      const t = convexTest(schema, modules);
      const s = await setup(t);
      for (const origin of [PROD_ORIGIN, "https://evil.example"]) {
        const pre = await preflight(t, photoPath(s.photoId), origin);
        expect(pre.status).toBe(403);
        expect(pre.headers.get(ACAO)).toBeNull();
        const res = await get(t, "user_mia", photoPath(s.photoId, "klein"), origin);
        expect(res.headers.get(ACAO)).toBeNull();
      }
      expect(logged(spy, ENV)).toBe(true);
    });
  }

  it("een ongeldige waarde naast een geldige: de geldige werkt, de rest niet", async () => {
    process.env[ENV] = `*,${PROD_ORIGIN}`;
    errorSpy();
    const t = convexTest(schema, modules);
    const s = await setup(t);
    expect((await preflight(t, photoPath(s.photoId), PROD_ORIGIN)).headers.get(ACAO)).toBe(PROD_ORIGIN);
    expect((await preflight(t, photoPath(s.photoId), "https://evil.example")).headers.get(ACAO)).toBeNull();
  });

  it("spaties rond de komma tellen niet mee", async () => {
    process.env[ENV] = ` ${PROD_ORIGIN} , ${DEV_ORIGIN} `;
    const t = convexTest(schema, modules);
    const s = await setup(t);
    for (const origin of [PROD_ORIGIN, DEV_ORIGIN]) {
      const res = await preflight(t, photoPath(s.photoId), origin);
      expect(res.status).toBe(204);
      expect(res.headers.get(ACAO)).toBe(origin);
    }
  });

  it("op prod telt alleen https: localhost krijgt niets, app.clubalmanac.com wel", async () => {
    process.env[STAGE] = "prod";
    errorSpy();
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const prod = await preflight(t, photoPath(s.photoId), PROD_ORIGIN);
    expect(prod.status).toBe(204);
    expect(prod.headers.get(ACAO)).toBe(PROD_ORIGIN);
    const dev = await preflight(t, photoPath(s.photoId), DEV_ORIGIN);
    expect(dev.status).toBe(403);
    expect(dev.headers.get(ACAO)).toBeNull();
    const res = await get(t, "user_mia", photoPath(s.photoId, "klein"), DEV_ORIGIN);
    expect(res.headers.get(ACAO)).toBeNull();
  });
});

describe("W3 — een token in de URL telt niet", () => {
  const queries = ["token=abc", "access_token=abc", "authorization=Bearer%20abc", "formaat=klein&token=abc"];

  it("foto: zonder header 401, wat er ook in de query staat", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    for (const q of queries) {
      const res = await t.fetch(`/beeld/foto/${s.photoId}?${q}`, { method: "GET", headers: { Origin: PROD_ORIGIN } });
      expect(res.status, q).toBe(401);
      expect(containsBytes(await bytesOf(res), SCHOON)).toBe(false);
    }
  });

  it("uitnodigingscover: zonder header 401, wat er ook in de query staat", async () => {
    const t = convexTest(schema, modules);
    const { inviteId } = await inviteSetup(t);
    for (const q of queries) {
      const res = await t.fetch(`/beeld/uitnodiging/${inviteId as Id<"invites">}?${q}`, {
        method: "GET",
        headers: { Origin: PROD_ORIGIN },
      });
      expect(res.status, q).toBe(401);
    }
  });
});
