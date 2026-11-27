import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  as,
  clearClaimsEnv,
  claimsOk,
  configureClaims,
  decide,
  FINANCE_SECRET,
  FORBIDDEN_BODY,
  getClaims,
  newSubmitted,
  newT,
  processClaim,
  purge,
  PURGE_SECRET,
  PURGE_SECRET_OLD,
  read,
  READ_SECRET,
  READ_SECRET_OLD,
  revisionOf,
  SECRET_HEADER,
  seedWorld,
  snapshot,
  useClaimsEnv,
  type Access,
  type T,
  type World,
} from "./_claims";

// WP45 §A5 — toegang tot de drie routes.
//   Draft-invariant 9: schrijven vanuit het clubboek alleen met een geheim.
//   Draft-invariant 11: eerst het geheim, vóór de body; één weigering voor
//     elke oorzaak; constante tijd; het geheim nooit in antwoord, fout of log;
//     tijdens rotatie twee geheimen per soort.
//   Afwijkingen 1–4: 403 (niet 401), alleen X-Clubboek-Secret, minstens 32
//     tekens, de groep op de deployment.
//   A-keuze 1: _PREVIOUS optioneel; zonder huidig geheim telt hij niet.
//   A-keuze 2: een purge-geheim gelijk aan een lees-geheim weigert purge.
//   Fix-cyclus 1, F4: een geheim gelijk aan FINANCE_SECRET sluit de route van
//   die soort.

useClaimsEnv();

type RouteName = "GET /claims" | "POST /claims/decision" | "POST /claims/purge";
type Kind = "read" | "purge";

const ROUTES: Array<{ name: RouteName; kind: Kind; call: (t: T, a: Access, body?: unknown) => Promise<Response> }> = [
  { name: "GET /claims", kind: "read", call: (t, a) => getClaims(t, a) },
  {
    name: "POST /claims/decision",
    kind: "read",
    call: (t, a, body) => decide(t, body ?? { id: "x", status: "rejected", processedCents: null, note: null, revision: 1 }, a),
  },
  { name: "POST /claims/purge", kind: "purge", call: (t, a, body) => purge(t, body ?? { claims: [] }, a) },
];

const right = (kind: Kind) => (kind === "read" ? READ_SECRET : PURGE_SECRET);
const otherKind = (kind: Kind) => (kind === "read" ? PURGE_SECRET : READ_SECRET);
const current = (kind: Kind) => (kind === "read" ? "CLAIMS_SECRET" : "CLAIMS_PURGE_SECRET");
const previous = (kind: Kind) => (kind === "read" ? "CLAIMS_SECRET_PREVIOUS" : "CLAIMS_PURGE_SECRET_PREVIOUS");

type Refusal = { label: string; only?: Kind; setup: (t: T, w: World, kind: Kind) => Promise<Access> | Access };

function flip(s: string): string {
  return `${s.slice(0, -1)}${s.endsWith("0") ? "1" : "0"}`;
}

const REFUSALS: Refusal[] = [
  {
    label: "geen huidig geheim op de deployment",
    setup: (_t, _w, k) => {
      delete process.env[current(k)];
      return { secret: right(k) };
    },
  },
  {
    label: "een leeg huidig geheim, en een lege header",
    setup: (_t, _w, k) => {
      process.env[current(k)] = "";
      return { secret: "" };
    },
  },
  {
    label: "een huidig geheim korter dan 32 tekens, ook met precies dat geheim",
    setup: (_t, _w, k) => {
      const short = right(k).slice(0, 31);
      process.env[current(k)] = short;
      return { secret: short };
    },
  },
  {
    label: "A-keuze 1: geen huidig geheim, wel een vorige, en die vorige gestuurd",
    setup: (_t, _w, k) => {
      configureClaims(process.env.CLAIMS_GROUP_ID!, { previous: true });
      delete process.env[current(k)];
      return { secret: process.env[previous(k)]! };
    },
  },
  {
    label: "een vorige korter dan 32 tekens, met precies die vorige",
    setup: (_t, _w, k) => {
      const short = (k === "read" ? READ_SECRET_OLD : PURGE_SECRET_OLD).slice(0, 31);
      process.env[previous(k)] = short;
      return { secret: short };
    },
  },
  {
    label: "geen CLAIMS_GROUP_ID",
    setup: (_t, _w, k) => {
      delete process.env.CLAIMS_GROUP_ID;
      return { secret: right(k) };
    },
  },
  {
    label: "CLAIMS_GROUP_ID is geen id",
    setup: (_t, _w, k) => {
      process.env.CLAIMS_GROUP_ID = "geen-groep";
      return { secret: right(k) };
    },
  },
  {
    label: "CLAIMS_GROUP_ID is het id van een user",
    setup: (_t, w, k) => {
      process.env.CLAIMS_GROUP_ID = w.users.alice;
      return { secret: right(k) };
    },
  },
  {
    label: "CLAIMS_GROUP_ID wijst naar een groep die niet meer bestaat",
    setup: async (t, w, k) => {
      const gone = await t.run(async (ctx) => {
        const id = await ctx.db.insert("groups", { name: "Weg", createdBy: w.users.bob, createdAt: Date.now() });
        await ctx.db.delete(id);
        return id;
      });
      process.env.CLAIMS_GROUP_ID = gone;
      return { secret: right(k) };
    },
  },
  { label: "geen X-Clubboek-Secret", setup: () => ({ secret: null }) },
  { label: "lege X-Clubboek-Secret", setup: () => ({ secret: "" }) },
  {
    label: "WP41 F1: het juiste geheim alleen in Authorization: Bearer",
    setup: (_t, _w, k) => ({ secret: null, headers: { Authorization: `Bearer ${right(k)}` } }),
  },
  {
    label: "WP41 F1: het juiste geheim alleen in Authorization, zonder schema",
    setup: (_t, _w, k) => ({ secret: null, headers: { Authorization: right(k) } }),
  },
  { label: "'Bearer ' voor het geheim in de header", setup: (_t, _w, k) => ({ secret: `Bearer ${right(k)}` }) },
  { label: "een fout geheim van dezelfde lengte", setup: (_t, _w, k) => ({ secret: flip(right(k)) }) },
  { label: "alleen het begin van het geheim", setup: (_t, _w, k) => ({ secret: right(k).slice(0, 63) }) },
  { label: "het geheim met iets erachter", setup: (_t, _w, k) => ({ secret: `${right(k)}0` }) },
  // Een spatie aan begin of eind komt niet over de lijn (HTTP haalt hem van de
  // headerwaarde af); een spatie midden in het geheim wel.
  {
    label: "het geheim met een spatie in het midden",
    setup: (_t, _w, k) => ({ secret: `${right(k).slice(0, 32)} ${right(k).slice(32)}` }),
  },
  { label: "het geheim van de andere soort", setup: (_t, _w, k) => ({ secret: otherKind(k) }) },
  {
    label: "de vorige van de andere soort",
    setup: (_t, _w, k) => {
      configureClaims(process.env.CLAIMS_GROUP_ID!, { previous: true });
      return { secret: k === "read" ? PURGE_SECRET_OLD : READ_SECRET_OLD };
    },
  },
  {
    label: "het geheim van de afrekeningen (FINANCE_SECRET, WP41)",
    setup: (_t, w) => {
      process.env.FINANCE_SECRET = FINANCE_SECRET;
      process.env.FINANCE_GROUP_ID = w.groups.club;
      return { secret: FINANCE_SECRET };
    },
  },
  {
    label: "een vorige die is weggehaald (rotatie afgerond)",
    setup: (_t, _w, k) => ({ secret: k === "read" ? READ_SECRET_OLD : PURGE_SECRET_OLD }),
  },
  {
    label: "F4: het huidige geheim van deze soort is gelijk aan FINANCE_SECRET, met dat geheim",
    setup: (_t, w, k) => {
      process.env.FINANCE_SECRET = right(k);
      process.env.FINANCE_GROUP_ID = w.groups.club;
      return { secret: right(k) };
    },
  },
  {
    label: "F4: de vorige van deze soort is gelijk aan FINANCE_SECRET, met het (andere) huidige geheim",
    setup: (_t, w, k) => {
      configureClaims(process.env.CLAIMS_GROUP_ID!, { previous: true });
      process.env.FINANCE_SECRET = process.env[previous(k)]!;
      process.env.FINANCE_GROUP_ID = w.groups.club;
      return { secret: right(k) };
    },
  },
  {
    label: "A-keuze 2: CLAIMS_PURGE_SECRET gelijk aan CLAIMS_SECRET",
    only: "purge",
    setup: () => {
      process.env.CLAIMS_PURGE_SECRET = READ_SECRET;
      return { secret: READ_SECRET };
    },
  },
  {
    label: "A-keuze 2: CLAIMS_PURGE_SECRET_PREVIOUS gelijk aan CLAIMS_SECRET, met die waarde",
    only: "purge",
    setup: () => {
      process.env.CLAIMS_PURGE_SECRET_PREVIOUS = READ_SECRET;
      return { secret: READ_SECRET };
    },
  },
  {
    label: "A-keuze 2: CLAIMS_PURGE_SECRET gelijk aan CLAIMS_SECRET_PREVIOUS, met die waarde",
    only: "purge",
    setup: () => {
      process.env.CLAIMS_SECRET_PREVIOUS = READ_SECRET_OLD;
      process.env.CLAIMS_PURGE_SECRET = READ_SECRET_OLD;
      return { secret: READ_SECRET_OLD };
    },
  },
];

/** Een wereld met een verwerkte declaratie, zodat purge en besluit iets te doen hebben. */
async function world(t: T) {
  const w = await seedWorld(t);
  const id = await newSubmitted(as.alice(t), w.groups.club);
  await processClaim(t, id);
  return { w, id };
}

/** Een body die zonder weigering iets zou veranderen. */
async function liveBody(t: T, name: RouteName, id: string): Promise<unknown> {
  const revision = await revisionOf(t, id);
  if (name === "POST /claims/decision") return { id, status: "rejected", processedCents: null, note: null, revision };
  if (name === "POST /claims/purge") return { claims: [{ id, revision }] };
  return undefined;
}

describe("§A5: zonder geldige toegang één weigering, en er verandert niets", () => {
  for (const route of ROUTES) {
    for (const c of REFUSALS) {
      if (c.only && c.only !== route.kind) continue;
      it(`${route.name}: ${c.label}`, async () => {
        const t = newT();
        const { w, id } = await world(t);
        const before = await snapshot(t);
        const access = await c.setup(t, w, route.kind);
        const res = await route.call(t, access, await liveBody(t, route.name, id));
        const { status, body } = await read(res);
        expect(status).toBe(403);
        expect(body).toEqual(FORBIDDEN_BODY);
        expect(await snapshot(t)).toEqual(before);
      });
    }
  }

  it("elke oorzaak op elke route: byte voor byte hetzelfde antwoord, dezelfde content-type", async () => {
    const bodies = new Set<string>();
    const types = new Set<string>();
    for (const route of ROUTES) {
      for (const c of REFUSALS) {
        if (c.only && c.only !== route.kind) continue;
        // Eén it voor alle gevallen: beforeEach zet de env-vars hier niet terug.
        clearClaimsEnv();
        const t = newT();
        const { w, id } = await world(t);
        const access = await c.setup(t, w, route.kind);
        const res = await route.call(t, access, await liveBody(t, route.name, id));
        bodies.add(`${res.status} ${await res.text()}`);
        types.add(res.headers.get("content-type") ?? "");
      }
    }
    expect([...bodies]).toHaveLength(1);
    expect([...bodies][0]).toMatch(/^403 /);
    expect([...types]).toHaveLength(1);
    expect([...types][0]).toMatch(/application\/json/);
  });
});

describe("draft-invariant 11: zonder toegang wordt de body niet beoordeeld", () => {
  for (const route of ROUTES.filter((r) => r.name !== "GET /claims")) {
    it(`${route.name}: fout geheim en kapotte JSON geeft 403`, async () => {
      const t = newT();
      await world(t);
      const res = await route.call(t, { secret: flip(right(route.kind)) }, "{ dit is geen json");
      expect(res.status).toBe(403);
    });

    it(`${route.name}: fout geheim en een te grote body geeft 403`, async () => {
      const t = newT();
      await world(t);
      const res = await route.call(t, { secret: null }, " ".repeat(64 * 1024));
      expect(res.status).toBe(403);
    });
  }
});

// --- rotatie ------------------------------------------------------------------------

describe("rotatie: twee geheimen per soort", () => {
  it("lezen en besluiten werken met CLAIMS_SECRET en met CLAIMS_SECRET_PREVIOUS", async () => {
    const t = newT();
    const w = await seedWorld(t);
    configureClaims(w.groups.club, { previous: true });
    const id = await newSubmitted(as.alice(t), w.groups.club);
    expect((await getClaims(t, { secret: READ_SECRET })).status).toBe(200);
    expect((await getClaims(t, { secret: READ_SECRET_OLD })).status).toBe(200);
    const body = { id, status: "processed", processedCents: 4250, note: null, revision: 2 };
    expect((await decide(t, body, { secret: READ_SECRET_OLD })).status).toBe(200);
    expect((await decide(t, { ...body, status: "rejected", processedCents: null, revision: 3 }, { secret: READ_SECRET })).status).toBe(200);
  });

  it("opruimen werkt met CLAIMS_PURGE_SECRET en met CLAIMS_PURGE_SECRET_PREVIOUS", async () => {
    const t = newT();
    const w = await seedWorld(t);
    configureClaims(w.groups.club, { previous: true });
    const a = await newSubmitted(as.alice(t), w.groups.club, { title: "A" });
    const b = await newSubmitted(as.alice(t), w.groups.club, { title: "B" });
    const ra = await processClaim(t, a);
    const rb = await processClaim(t, b);
    const one = await read(await purge(t, { claims: [{ id: a, revision: ra }] }, { secret: PURGE_SECRET }));
    const two = await read(await purge(t, { claims: [{ id: b, revision: rb }] }, { secret: PURGE_SECRET_OLD }));
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body.deleted).toEqual([a]);
    expect(two.body.deleted).toEqual([b]);
  });

  it("zonder _PREVIOUS werkt het huidige geheim gewoon (A-keuze 1)", async () => {
    const t = newT();
    await seedWorld(t);
    expect(process.env.CLAIMS_SECRET_PREVIOUS).toBeUndefined();
    expect((await getClaims(t)).status).toBe(200);
    expect((await purge(t, { claims: [] })).status).toBe(200);
  });

  it("een te korte _PREVIOUS telt niet, maar het huidige geheim werkt", async () => {
    const t = newT();
    await seedWorld(t);
    process.env.CLAIMS_SECRET_PREVIOUS = "kort";
    process.env.CLAIMS_PURGE_SECRET_PREVIOUS = "kort";
    expect((await getClaims(t)).status).toBe(200);
    expect((await purge(t, { claims: [] })).status).toBe(200);
    expect((await getClaims(t, { secret: "kort" })).status).toBe(403);
  });

  it("A-keuze 2: bij een purge-geheim gelijk aan het lees-geheim werkt lezen nog wel", async () => {
    const t = newT();
    await seedWorld(t);
    process.env.CLAIMS_PURGE_SECRET = READ_SECRET;
    expect((await getClaims(t)).status).toBe(200);
  });
});

describe("F4: geen gedeeld geheim met de afrekeningen; de andere soort werkt gewoon", () => {
  for (const [label, envName, closed] of [
    ["CLAIMS_SECRET", "CLAIMS_SECRET", "read"],
    ["CLAIMS_SECRET_PREVIOUS", "CLAIMS_SECRET_PREVIOUS", "read"],
    ["CLAIMS_PURGE_SECRET", "CLAIMS_PURGE_SECRET", "purge"],
    ["CLAIMS_PURGE_SECRET_PREVIOUS", "CLAIMS_PURGE_SECRET_PREVIOUS", "purge"],
  ] as const) {
    it(`${label} gelijk aan FINANCE_SECRET: ${closed === "read" ? "lezen en besluiten" : "opruimen"} dicht, de rest open`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      configureClaims(w.groups.club, { previous: true });
      process.env.FINANCE_SECRET = process.env[envName]!;
      process.env.FINANCE_GROUP_ID = w.groups.club;
      const id = await newSubmitted(as.alice(t), w.groups.club);
      const decision = { id, status: "rejected", processedCents: null, note: null, revision: 2 };
      const readStatuses = [
        (await getClaims(t, { secret: READ_SECRET })).status,
        (await getClaims(t, { secret: READ_SECRET_OLD })).status,
        (await decide(t, decision, { secret: READ_SECRET })).status,
      ];
      const purgeStatuses = [
        (await purge(t, { claims: [] }, { secret: PURGE_SECRET })).status,
        (await purge(t, { claims: [] }, { secret: PURGE_SECRET_OLD })).status,
      ];
      if (closed === "read") {
        expect(readStatuses).toEqual([403, 403, 403]);
        expect(purgeStatuses).toEqual([200, 200]);
      } else {
        expect(readStatuses).toEqual([200, 200, 200]);
        expect(purgeStatuses).toEqual([403, 403]);
      }
    });
  }

  it("de afrekeningen zelf werken nog met FINANCE_SECRET (WP41 blijft gelijk)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    process.env.FINANCE_SECRET = READ_SECRET;
    process.env.FINANCE_GROUP_ID = w.groups.club;
    const res = await t.fetch("/settlements?key=17", { method: "DELETE", headers: { [SECRET_HEADER]: READ_SECRET } });
    expect(res.status).toBe(200);
  });
});

describe("de groep staat op de deployment (afwijking 4)", () => {
  it("met een andere CLAIMS_GROUP_ID ziet hetzelfde geheim die andere groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await newSubmitted(as.alice(t), w.groups.club);
    expect(await claimsOk(t)).toHaveLength(1);
    configureClaims(w.groups.other);
    expect(await claimsOk(t)).toEqual([]);
  });
});

// --- geen lek ------------------------------------------------------------------------

describe("draft-invariant 11: het geheim komt niet in een antwoord, fout of log", () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    }
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it("weigering, vormfout, 404, 409, lezen, besluiten en opruimen: nergens een geheim of env-var", async () => {
    const t = newT();
    const w = await seedWorld(t);
    configureClaims(w.groups.club, { previous: true });
    const id = await newSubmitted(as.alice(t), w.groups.club);
    const responses: Response[] = [];
    responses.push(await getClaims(t, { secret: READ_SECRET.slice(0, 63) }));
    responses.push(await getClaims(t, { secret: PURGE_SECRET }));
    responses.push(await getClaims(t));
    responses.push(await getClaims(t, { secret: READ_SECRET_OLD }));
    responses.push(await decide(t, "{ kapot"));
    responses.push(await decide(t, { id: "onbekend", status: "rejected", processedCents: null, note: null, revision: 1 }));
    responses.push(await decide(t, { id, status: "processed", processedCents: 4250, note: null, revision: 2 }));
    responses.push(await decide(t, { id, status: "rejected", processedCents: null, note: null, revision: 2 }));
    responses.push(await purge(t, { claims: [{ id, revision: 3 }] }));
    responses.push(await purge(t, { claims: [{ id, revision: 3 }] }, { secret: READ_SECRET }));

    const secrets = [READ_SECRET, READ_SECRET_OLD, PURGE_SECRET, PURGE_SECRET_OLD];
    for (const res of responses) {
      const text = await res.text();
      const headers = JSON.stringify([...res.headers.entries()]);
      for (const s of [text, headers]) {
        for (const secret of secrets) {
          expect(s).not.toContain(secret.slice(0, 16));
          expect(s).not.toContain(secret.slice(-16));
        }
        expect(s).not.toMatch(/CLAIMS_|FINANCE_/);
        expect(s).not.toContain(SECRET_HEADER);
      }
    }
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const secret of secrets) {
      expect(logged).not.toContain(secret.slice(0, 16));
      expect(logged).not.toContain(secret.slice(-16));
    }
    expect(logged).not.toContain(SECRET_HEADER);
  });
});

// --- geen browser-route ---------------------------------------------------------------

describe("geen CORS en geen andere ingang", () => {
  it("geen Access-Control-headers bij 200, 400, 403, 404 en 409", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    const all = [
      await getClaims(t),
      await getClaims(t, { secret: null, headers: { Origin: "https://example.com" } }),
      await decide(t, "{ kapot", { headers: { Origin: "https://example.com" } }),
      await decide(t, { id: "onbekend", status: "rejected", processedCents: null, note: null, revision: 1 }),
      await decide(t, { id, status: "rejected", processedCents: null, note: null, revision: 9 }),
      await purge(t, { claims: [] }, { headers: { Origin: "https://example.com" } }),
    ];
    expect(all.map((r) => r.status)).toEqual([200, 403, 400, 404, 409, 200]);
    for (const res of all) {
      expect([...res.headers.keys()].filter((h) => h.toLowerCase().startsWith("access-control-"))).toEqual([]);
    }
  });

  for (const path of ["/claims", "/claims/decision", "/claims/purge"]) {
    it(`OPTIONS ${path} geeft geen preflight`, async () => {
      const t = newT();
      await seedWorld(t);
      const res = await t.fetch(path, {
        method: "OPTIONS",
        headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  }

  for (const [method, path, secret] of [
    ["POST", "/claims", READ_SECRET],
    ["DELETE", "/claims", READ_SECRET],
    ["GET", "/claims/decision", READ_SECRET],
    ["PUT", "/claims/decision", READ_SECRET],
    ["GET", "/claims/purge", PURGE_SECRET],
    ["DELETE", "/claims/purge", PURGE_SECRET],
  ] as const) {
    it(`${method} ${path} met het geheim geeft geen gegevens`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      await newSubmitted(as.alice(t), w.groups.club, { title: "Geheime borrel" });
      const res = await t.fetch(path, {
        method,
        headers: { [SECRET_HEADER]: secret },
        ...(method === "GET" ? {} : { body: JSON.stringify({ claims: [] }) }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).not.toContain("Geheime borrel");
    });
  }
});
