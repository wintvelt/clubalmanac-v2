import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crons from "../../convex/crons";
import {
  ENV,
  filmsInternal,
  KEYS,
  newT,
  parseS3Link,
  seedFilmsWorld,
  useFilmsEnv,
  type T,
} from "./_films";

// WP21 besluit 7 en A-invariant 16: de backend merkt een ingetrokken of
// verlopen sleutel niet bij het tekenen. Een dagelijkse check leest één cover
// via een ondertekende link (nooit een film: invariant 6, kosten) en mailt de
// webmaster bij een fout. Zonder link of geheim in de mail.
// Spec: docs/work-packages/WP21-videos.md §Testcontract.

useFilmsEnv();

const WEBMASTER = "webmaster@x.com";

beforeEach(() => {
  process.env.MAILJET_VERIFIED_SENDERS = "info@clubalmanac.com";
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  process.env.WEBMASTER_EMAILS = WEBMASTER;
});
afterEach(() => {
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  delete process.env.WEBMASTER_EMAILS;
});

type S3Behaviour = { status: number } | "network-error";
type Calls = { s3: Array<{ url: string; method: string }>; mail: Array<Record<string, unknown>> };

function stubFetch(s3: S3Behaviour): Calls {
  const calls: Calls = { s3: [], mail: [] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (/amazonaws\.com/.test(new URL(url).host)) {
      calls.s3.push({ url, method });
      if (s3 === "network-error") throw new TypeError("fetch failed");
      return new Response(s3.status < 300 ? "x" : "<Error/>", { status: s3.status });
    }
    if (/mailjet/.test(url)) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        Messages?: Array<Record<string, unknown>>;
      };
      for (const m of body.Messages ?? []) calls.mail.push(m);
      return new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), { status: 200 });
    }
    throw new Error(`onverwachte fetch naar ${url}`);
  });
  return calls;
}

async function runCheck(t: T): Promise<void> {
  await t.action(filmsInternal.checkLinks, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

function recipients(m: Record<string, unknown>): string[] {
  return ((m.To as Array<{ Email?: string }>) ?? []).map((x) => (x.Email ?? "").toLowerCase());
}

describe("checkLinks: goed", () => {
  for (const status of [200, 206]) {
    it(`S3 geeft ${status} → geen mail`, async () => {
      const t = newT();
      await seedFilmsWorld(t);
      const calls = stubFetch({ status });
      await runCheck(t);
      expect(calls.mail).toHaveLength(0);
      expect(calls.s3.length).toBeGreaterThan(0);
    });
  }

  it("leest een cover van de lijst, nooit een film, met een ondertekende link uit de bucket", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    const calls = stubFetch({ status: 200 });
    await runCheck(t);
    const coverKeys: string[] = [KEYS.trailerCover, KEYS.filmCover, KEYS.otherCover];
    for (const c of calls.s3) {
      const link = parseS3Link(c.url);
      expect(link.bucket).toBe(ENV.FILMS_S3_BUCKET);
      expect(coverKeys).toContain(link.key);
      expect(link.params["X-Amz-Signature"]).toMatch(/^[0-9a-f]{64}$/);
      expect(["GET", "HEAD"]).toContain(c.method);
    }
  });
});

describe("checkLinks: fout → één mail aan de webmaster", () => {
  const cases: Array<[string, S3Behaviour]> = [
    ["403 (sleutel ingetrokken of zonder recht)", { status: 403 }],
    ["404 (cover weg)", { status: 404 }],
    ["500 (S3-storing)", { status: 500 }],
    ["netwerkfout", "network-error"],
  ];
  for (const [label, behaviour] of cases) {
    it(label, async () => {
      const t = newT();
      await seedFilmsWorld(t);
      const calls = stubFetch(behaviour);
      await runCheck(t);
      expect(calls.mail).toHaveLength(1);
      expect(recipients(calls.mail[0]!)).toContain(WEBMASTER);
    });
  }

  it("ontbrekende config → mail, zonder te crashen", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    delete process.env.FILMS_S3_SECRET_ACCESS_KEY;
    const calls = stubFetch({ status: 200 });
    await runCheck(t);
    expect(calls.mail).toHaveLength(1);
    expect(calls.s3).toHaveLength(0);
  });

  it("geen film met een cover in de lijst → mail (de lijst is leeg of kwijt)", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    await t.mutation(filmsInternal.replaceAll, { items: [w.items[2]!] });
    const calls = stubFetch({ status: 200 });
    await runCheck(t);
    expect(calls.mail).toHaveLength(1);
    expect(calls.s3).toHaveLength(0);
  });

  it("de mail bevat geen link, geen geheim en geen bestandsnaam", async () => {
    const t = newT();
    await seedFilmsWorld(t);
    const calls = stubFetch({ status: 403 });
    await runCheck(t);
    const json = JSON.stringify(calls.mail);
    expect(json).not.toContain(ENV.FILMS_S3_SECRET_ACCESS_KEY);
    expect(json).not.toMatch(/X-Amz-Signature/i);
    expect(json).not.toMatch(/amazonaws\.com/);
    for (const key of Object.values(KEYS)) expect(json).not.toContain(key);
  });
});

describe("cron (besluit 7)", () => {
  it("'film link check' draait dagelijks 05:00 UTC en roept internal.films.checkLinks aan", () => {
    const job = crons.crons["film link check"];
    if (!job) throw new Error("cron 'film link check' niet geregistreerd");
    expect(job.schedule).toEqual({ type: "daily", hourUTC: 5, minuteUTC: 0 });
    expect(job.name).toBe(getFunctionName(filmsInternal.checkLinks));
  });
});
