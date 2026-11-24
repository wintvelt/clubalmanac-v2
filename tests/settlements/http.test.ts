import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  as,
  asRead,
  configure,
  del,
  newT,
  post,
  postOk,
  request,
  rows,
  SECRET,
  SECRET_HEADER,
  seedWorld,
  settlementsApi,
  snapshot,
  useFinanceEnv,
  withTotals,
  type R,
  type T,
} from "./_settlements";

// WP41 §A4 en §A5 — de twee routes van het clubboek.
//   Invariant 2, 3, 4: alleen met het geheim, het geheim hoort bij één groep
//   (FINANCE_GROUP_ID), één weigering voor elke oorzaak, het geheim lekt niet.
//   Invariant 5 en A-invariant 4: opnieuw sturen vervangt, met behoud van id.
//   A-invariant 5: zonder toegang wordt de body niet beoordeeld.
//   A-invariant 7: ten hoogste 40 afrekeningen per groep.
//   Geen CORS (draft §Schrijven).
//   Fix-cyclus 1, F1: het geheim staat in X-Clubboek-Secret; Authorization
//   (ook met het juiste geheim) is een weigering.

useFinanceEnv();

// --- toegang: één weigering ---------------------------------------------------

type Access = { secret: string | null; headers?: Record<string, string> };

type RefusalCase = {
  label: string;
  /** Zet de deployment en geeft wat het verzoek meestuurt. */
  setup: (t: T, w: Awaited<ReturnType<typeof seedWorld>>) => Promise<Access>;
};

const OTHER = `${SECRET.slice(0, -1)}${SECRET.endsWith("0") ? "1" : "0"}`;

const REFUSALS: RefusalCase[] = [
  {
    label: "geen FINANCE_SECRET op de deployment",
    setup: async () => {
      delete process.env.FINANCE_SECRET;
      return { secret: SECRET };
    },
  },
  {
    label: "lege FINANCE_SECRET op de deployment",
    setup: async () => {
      process.env.FINANCE_SECRET = "";
      return { secret: "" };
    },
  },
  {
    label: "FINANCE_SECRET korter dan 32 tekens, ook met precies dat geheim (A-keuze 3)",
    setup: async (_t, w) => {
      const short = SECRET.slice(0, 31);
      configure(w.groups.club, short);
      return { secret: short };
    },
  },
  {
    label: "geen FINANCE_GROUP_ID op de deployment",
    setup: async () => {
      delete process.env.FINANCE_GROUP_ID;
      return { secret: SECRET };
    },
  },
  {
    label: "FINANCE_GROUP_ID is geen id",
    setup: async () => {
      process.env.FINANCE_GROUP_ID = "geen-groep";
      return { secret: SECRET };
    },
  },
  {
    label: "FINANCE_GROUP_ID is een id uit een andere tabel (een user)",
    setup: async (_t, w) => {
      process.env.FINANCE_GROUP_ID = w.users.alice;
      return { secret: SECRET };
    },
  },
  {
    label: "FINANCE_GROUP_ID wijst naar een groep die niet meer bestaat",
    setup: async (t) => {
      const gone = await t.run(async (ctx) => {
        const owner = (await ctx.db.query("users").first())!._id;
        const id = await ctx.db.insert("groups", { name: "Weg", createdBy: owner, createdAt: Date.now() });
        await ctx.db.delete(id);
        return id;
      });
      process.env.FINANCE_GROUP_ID = gone;
      return { secret: SECRET };
    },
  },
  { label: "geen X-Clubboek-Secret", setup: async () => ({ secret: null }) },
  { label: "lege X-Clubboek-Secret", setup: async () => ({ secret: "" }) },
  {
    label: "F1: het juiste geheim alleen in Authorization: Bearer",
    setup: async () => ({ secret: null, headers: { Authorization: `Bearer ${SECRET}` } }),
  },
  {
    label: "F1: het juiste geheim alleen in Authorization, zonder schema",
    setup: async () => ({ secret: null, headers: { Authorization: SECRET } }),
  },
  { label: "F1: 'Bearer ' voor het geheim in X-Clubboek-Secret", setup: async () => ({ secret: `Bearer ${SECRET}` }) },
  { label: "een fout geheim van dezelfde lengte", setup: async () => ({ secret: OTHER }) },
  { label: "alleen het begin van het geheim", setup: async () => ({ secret: SECRET.slice(0, 63) }) },
  { label: "het geheim met iets erachter", setup: async () => ({ secret: `${SECRET}0` }) },
];

describe("A4.1: zonder geldige toegang één weigering, en niets geschreven", () => {
  for (const c of REFUSALS) {
    it(c.label, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const access = await c.setup(t, w);
      const res = await post(t, request("lustrum"), access);
      expect(res.status).toBe(403);
      expect(await rows(t)).toEqual([]);
    });
  }

  it("elke oorzaak geeft byte voor byte hetzelfde antwoord", async () => {
    const bodies = new Set<string>();
    const types = new Set<string>();
    for (const c of REFUSALS) {
      const t = newT();
      const w = await seedWorld(t);
      const access = await c.setup(t, w);
      const res = await post(t, request("lustrum"), access);
      bodies.add(`${res.status} ${await res.text()}`);
      types.add(res.headers.get("content-type") ?? "");
    }
    expect([...bodies]).toHaveLength(1);
    expect([...bodies][0]).toMatch(/^403 /);
    expect([...types]).toHaveLength(1);
  });

  it("DELETE geeft dezelfde weigering als POST", async () => {
    const t = newT();
    await seedWorld(t);
    const a = await post(t, request("lustrum"), { secret: OTHER });
    const b = await del(t, "17", OTHER);
    expect(b.status).toBe(403);
    expect(await b.text()).toBe(await a.text());
  });

  it("de weigering noemt geen geheim, geen env-var en geen groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const res = await post(t, request("lustrum"), { secret: SECRET.slice(0, 63) });
    expect(res.status).toBe(403);
    const text = await res.text();
    const headers = JSON.stringify([...res.headers.entries()]);
    for (const s of [text, headers]) {
      expect(s).not.toContain(SECRET.slice(0, 16));
      expect(s).not.toMatch(/FINANCE/i);
      expect(s).not.toContain(w.groups.club);
    }
  });
});

describe("A-invariant 5: zonder toegang wordt de body niet beoordeeld", () => {
  it("fout geheim en kapotte JSON: 403, niet 400", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await post(t, "{ dit is geen json", { secret: OTHER });
    expect(res.status).toBe(403);
  });

  it("fout geheim en een te grote body: 403, niet 413", async () => {
    const t = newT();
    await seedWorld(t);
    const big = JSON.stringify(request("lustrum")).padEnd(200 * 1024, " ");
    const res = await post(t, big, { secret: OTHER });
    expect(res.status).toBe(403);
  });

  it("fout geheim en een geldige body met een andere vorm: 403", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await post(t, { key: "17" }, { secret: null });
    expect(res.status).toBe(403);
  });
});

describe("invariant 4: het geheim komt niet in een log", () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    }
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it("weigering, vormfout, schrijven en weghalen: nergens het geheim of de header", async () => {
    const t = newT();
    await seedWorld(t);
    await post(t, request("lustrum"), { secret: SECRET.slice(0, 63) });
    expect((await post(t, { ...request("lustrum"), name: "" })).status).toBe(400);
    await postOk(t, request("lustrum"));
    expect((await del(t, "17")).status).toBe(200);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(SECRET.slice(0, 16));
    expect(logged).not.toContain(SECRET.slice(-16));
    expect(logged).not.toContain(SECRET_HEADER);
  });
});

// --- schrijven -----------------------------------------------------------------

describe("A4.4: schrijven", () => {
  it("een geldig verzoek: 200 met het aantal deelnemers, één rij in de groep van het geheim", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const res = await post(t, request("lustrum"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ participants: 8 });
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]!.groupId).toBe(w.groups.club);
    expect(all[0]!.key).toBe("17");
  });

  it("een lid leest precies het verzoek terug (zonder key): dezelfde bedragen, tekens en volgorde (invariant 7)", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, request("lustrum"));
    await postOk(t, request("weekend"));
    const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: (await rows(t))[0]!.groupId });
    for (const name of ["lustrum", "weekend"] as const) {
      const body = request(name);
      const item = list.find((x) => x.name === body.name)!;
      const got = await as.alice(t).query(settlementsApi.get, { settlementId: item._id });
      const { _id, ...rest } = got;
      expect(_id).toBe(item._id);
      expect(rest).toEqual(asRead(body));
    }
  });

  it("de groep komt alleen van de deployment: met een andere FINANCE_GROUP_ID landt hetzelfde verzoek daar", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    configure(w.groups.other);
    await postOk(t, request("lustrum"));
    const all = await rows(t);
    expect(all.map((r) => r.groupId).sort()).toEqual([w.groups.club, w.groups.other].sort());
    expect(await as.dave(t).query(settlementsApi.listByGroup, { groupId: w.groups.other })).toHaveLength(1);
    expect(await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club })).toHaveLength(1);
  });

  it("een groupId in de body is een onbekend veld: 400, niets in welke groep ook", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const res = await post(t, { ...request("lustrum"), groupId: w.groups.other });
    expect(res.status).toBe(400);
    expect(await rows(t)).toEqual([]);
  });
});

describe("invariant 5 en A-invariant 4: opnieuw sturen vervangt", () => {
  it("dezelfde sleutel: één rij, hetzelfde _id, alleen de nieuwe inhoud", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    const [first] = await rows(t);

    const next = request("lustrum");
    next.name = "Lustrum Nepal (herzien)";
    next.publishedOn = "2026-11-28";
    next.rows = (next.rows as R[]).filter((r) => r.name !== "Thijs");
    const res = await postOk(t, withTotals(next));
    expect(res).toMatchObject({ participants: 7 });

    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]!._id).toBe(first!._id);
    const got = await as.alice(t).query(settlementsApi.get, { settlementId: first!._id });
    expect(got.name).toBe("Lustrum Nepal (herzien)");
    expect(got.publishedOn).toBe("2026-11-28");
    expect((got.rows as R[]).map((r) => r.name)).not.toContain("Thijs");
    expect(got).toEqual({ _id: first!._id, ...asRead(withTotals(next)) });
    const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    expect(list).toHaveLength(1);
  });

  it("twee sleutels: twee afrekeningen", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, request("lustrum"));
    await postOk(t, request("weekend"));
    expect((await rows(t)).map((r) => r.key).sort()).toEqual(["17", "9"]);
  });

  it("twee keer tegelijk dezelfde sleutel: toch één rij", async () => {
    const t = newT();
    await seedWorld(t);
    const [a, b] = await Promise.all([post(t, request("lustrum")), post(t, request("lustrum"))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await rows(t)).toHaveLength(1);
  });

  it("dezelfde sleutel in een andere groep is een andere afrekening", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    configure(w.groups.other);
    const changed = { ...request("lustrum"), name: "Lustrum Ander" };
    await postOk(t, changed);
    const club = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    expect(club.map((x) => x.name)).toEqual(["Lustrum Nepal"]);
  });
});

describe("A-invariant 7: ten hoogste 40 afrekeningen per groep", () => {
  it("de 41e sleutel wordt geweigerd; een bestaande vervangen mag; een andere groep heeft eigen ruimte", async () => {
    const t = newT();
    const w = await seedWorld(t);
    for (let i = 1; i <= 40; i++) await postOk(t, { ...request("weekend"), key: `k${i}` });
    const before = await snapshot(t);

    const res = await post(t, { ...request("weekend"), key: "k41" });
    expect(res.status).toBe(400);
    expect(await snapshot(t)).toEqual(before);

    await postOk(t, { ...request("weekend"), key: "k7", name: "Vervangen" });
    expect(await rows(t)).toHaveLength(40);

    configure(w.groups.other);
    await postOk(t, { ...request("weekend"), key: "k41" });
    expect(await rows(t)).toHaveLength(41);
  });
});

// --- weghalen ----------------------------------------------------------------

describe("A5: DELETE /settlements?key=…", () => {
  it("haalt de afrekening weg; de tijdlijn is leeg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    const res = await del(t, "17");
    expect(res.status).toBe(200);
    expect(await rows(t)).toEqual([]);
    expect(await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club })).toEqual([]);
  });

  it("een onbekende sleutel geeft hetzelfde antwoord als weghalen", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, request("lustrum"));
    const gone = await del(t, "17");
    const goneText = await gone.text();
    const never = await del(t, "999");
    expect(never.status).toBe(gone.status);
    expect(await never.text()).toBe(goneText);
    const again = await del(t, "17");
    expect(again.status).toBe(gone.status);
    expect(await again.text()).toBe(goneText);
  });

  it("alleen in de groep van het geheim: dezelfde sleutel in een andere groep blijft", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    configure(w.groups.other);
    await postOk(t, request("lustrum"));
    configure(w.groups.club);
    await del(t, "17");
    expect((await rows(t)).map((r) => r.groupId)).toEqual([w.groups.other]);
  });

  it("andere sleutels in dezelfde groep blijven", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, request("lustrum"));
    await postOk(t, request("weekend"));
    await del(t, "9");
    expect((await rows(t)).map((r) => r.key)).toEqual(["17"]);
  });

  for (const [label, key] of [
    ["zonder key", null],
    ["lege key", ""],
    ["key met een spatie", "1 7"],
    ["key met een schuine streep", "17/x"],
    ["key langer dan 64 tekens", "k".repeat(65)],
  ] as const) {
    it(`${label}: 400, niets weg`, async () => {
      const t = newT();
      await seedWorld(t);
      await postOk(t, request("lustrum"));
      const before = await snapshot(t);
      const res = await del(t, key);
      expect(res.status).toBe(400);
      expect(await snapshot(t)).toEqual(before);
    });
  }

  it("fout geheim: 403, niets weg", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, request("lustrum"));
    const res = await del(t, "17", SECRET.slice(0, 63));
    expect(res.status).toBe(403);
    expect(await rows(t)).toHaveLength(1);
  });

  it("F1: het juiste geheim alleen in Authorization: 403, niets weg", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, request("lustrum"));
    const res = await del(t, "17", null, { Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(403);
    expect(await rows(t)).toHaveLength(1);
  });

  it("groep van het geheim bestaat niet meer: dezelfde weigering", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    configure(w.groups.other);
    await t.run(async (ctx) => {
      await ctx.db.delete(w.groups.other);
    });
    const res = await del(t, "17");
    expect(res.status).toBe(403);
    expect(await rows(t)).toHaveLength(1);
  });
});

// --- geen browser-route --------------------------------------------------------

describe("geen CORS en geen andere ingang", () => {
  it("POST en DELETE antwoorden zonder Access-Control-headers", async () => {
    const t = newT();
    await seedWorld(t);
    const a = await post(t, request("lustrum"));
    const b = await del(t, "17");
    const c = await post(t, request("lustrum"), { secret: OTHER });
    expect([a.status, b.status, c.status]).toEqual([200, 200, 403]);
    for (const res of [a, b, c]) {
      expect([...res.headers.keys()].filter((h) => h.toLowerCase().startsWith("access-control-"))).toEqual([]);
    }
  });

  it("OPTIONS geeft geen preflight", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await t.fetch("/settlements", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  for (const method of ["GET", "PUT", "PATCH"] as const) {
    it(`${method} met het geheim geeft geen gegevens`, async () => {
      const t = newT();
      await seedWorld(t);
      await postOk(t, request("lustrum"));
      const res = await t.fetch("/settlements?key=17", {
        method,
        headers: { [SECRET_HEADER]: SECRET },
        ...(method === "GET" ? {} : { body: JSON.stringify(request("lustrum")) }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).not.toContain("Maarten");
    });
  }
});
