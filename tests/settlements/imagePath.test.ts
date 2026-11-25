import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import http from "../../convex/http";
import { bytesOf, GPS_JPEG, gpsAnywhere, isJpeg, SCHOON, SCHOON_B } from "../_helpers/jpeg";
import {
  as,
  del,
  imagePath,
  newT,
  postOk,
  request,
  rows,
  seedWorld,
  settlementsApi,
  storageIds,
  useFinanceEnv,
  withImage,
  type T,
} from "./_settlements";

// WP41c besluit 4 en spec §WP41c C5 — het beeldpad van een afrekening:
//   GET /beeld/afrekening/<settlementId>[?versie=…]
// Toegangsregel: dezelfde als `settlements.get`: de caller is nu lid van de
// groep van de afrekening. Dan 200 met de foto. Al het andere geeft precies
// hetzelfde 404 (geen orakel): uitgelogd, geen lid, de webmaster buiten zijn
// groepen, een lid van een andere groep, een onbekend, misvormd of ander-tabel-
// id, een weggehaalde afrekening, een afrekening zonder foto, en wie net uit
// de groep ging. `versie` opent niets: het pad geeft altijd de huidige foto.
// Geen metadata naar buiten (A-keuze 19, zoals een origineel, WP17d).
//
// convex-test valideert geen JWT: `withIdentity(...).fetch` zet de identity
// direct (zie tests/images/httpRoute.test.ts).

useFinanceEnv();

async function world(t: T) {
  const w = await seedWorld(t);
  await postOk(t, withImage(request("lustrum"), SCHOON));
  await postOk(t, request("weekend"));
  const byKey = Object.fromEntries((await rows(t)).map((r) => [r.key as string, r._id as string]));
  const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
  const version = list.find((x) => x._id === byKey["17"])?.imageVersion ?? "v";
  return { ...w, ids: { photo: byKey["17"]!, noPhoto: byKey["9"]! }, version };
}

async function snap(res: Response) {
  return {
    status: res.status,
    body: Array.from(await bytesOf(res)).join(","),
    type: res.headers.get("Content-Type"),
  };
}

describe("routes", () => {
  it("GET en OPTIONS (preflight van de webapp, WP35) op /beeld/afrekening/; geen andere methode", () => {
    expect(http.lookup("/beeld/afrekening/abc", "GET")).not.toBeNull();
    expect(http.lookup("/beeld/afrekening/abc", "OPTIONS")).not.toBeNull();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(http.lookup("/beeld/afrekening/abc", method)).toBeNull();
    }
  });
});

describe("lid van de groep: de foto", () => {
  it("200 met precies de bytes, image/jpeg, private, Vary: Authorization, nosniff", async () => {
    const t = newT();
    const w = await world(t);
    const res = await as.alice(t).fetch(imagePath(w.ids.photo, w.version), { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/\bprivate\b/);
    expect(res.headers.get("Vary") ?? "").toMatch(/Authorization/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Array.from(await bytesOf(res))).toEqual(Array.from(SCHOON));
  });

  it("zonder versie ook de foto (de versie is alleen voor de cache)", async () => {
    const t = newT();
    const w = await world(t);
    const res = await as.bob(t).fetch(imagePath(w.ids.photo), { method: "GET" });
    expect(res.status).toBe(200);
    expect(Array.from(await bytesOf(res))).toEqual(Array.from(SCHOON));
  });

  it("na een nieuwe foto geeft ook de oude versie-URL de nieuwe foto, nooit de oude", async () => {
    const t = newT();
    const w = await world(t);
    await postOk(t, withImage(request("lustrum"), SCHOON_B));
    for (const path of [imagePath(w.ids.photo, w.version), imagePath(w.ids.photo)]) {
      const res = await as.alice(t).fetch(path, { method: "GET" });
      expect(res.status).toBe(200);
      expect(Array.from(await bytesOf(res))).toEqual(Array.from(SCHOON_B));
    }
  });

  it("geen GPS of andere metadata naar buiten (A-keuze 19)", async () => {
    const t = newT();
    await seedWorld(t);
    expect(gpsAnywhere(GPS_JPEG)).toBeGreaterThan(0);
    await postOk(t, withImage(request("lustrum"), GPS_JPEG));
    const id = (await rows(t))[0]!._id as string;
    const res = await as.alice(t).fetch(imagePath(id), { method: "GET" });
    expect(res.status).toBe(200);
    const bytes = await bytesOf(res);
    expect(isJpeg(bytes)).toBe(true);
    expect(gpsAnywhere(bytes)).toBe(0);
  });
});

describe("al het andere: één en hetzelfde 404", () => {
  it("geen lid, webmaster, lid van een andere groep, uitgelogd, onbekend, misvormd, ander-tabel-id, zonder foto: identiek 404", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await t.run(async (ctx) => {
      const doc = await ctx.db.get(w.ids.photo as never);
      const { _id, _creationTime, ...rest } = doc as Record<string, unknown>;
      void _id;
      void _creationTime;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = await (ctx.db as any).insert("settlements", { ...rest, key: "weg" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ctx.db as any).delete(id);
      return id as string;
    });

    const cases: Array<[string, () => Promise<Response>]> = [
      ["geen lid (carol)", () => as.carol(t).fetch(imagePath(w.ids.photo, w.version), { method: "GET" })],
      ["webmaster, geen lid", () => as.wm(t).fetch(imagePath(w.ids.photo, w.version), { method: "GET" })],
      ["lid van een andere groep (dave)", () => as.dave(t).fetch(imagePath(w.ids.photo, w.version), { method: "GET" })],
      ["uitgelogd", () => t.fetch(imagePath(w.ids.photo, w.version), { method: "GET" })],
      ["onbekend id (gewist)", () => as.alice(t).fetch(imagePath(gone), { method: "GET" })],
      ["misvormd id", () => as.alice(t).fetch(imagePath("abc"), { method: "GET" })],
      ["kapotte procent-codering", () => as.alice(t).fetch("/beeld/afrekening/%E0%A4%A", { method: "GET" })],
      ["id van een andere tabel (de groep)", () => as.alice(t).fetch(imagePath(w.groups.club), { method: "GET" })],
      ["afrekening zonder foto", () => as.alice(t).fetch(imagePath(w.ids.noPhoto), { method: "GET" })],
    ];

    const results: Array<[string, Awaited<ReturnType<typeof snap>>]> = [];
    for (const [label, call] of cases) results.push([label, await snap(await call())]);
    const [, first] = results[0]!;
    expect(first.status).toBe(404);
    expect(first.body).not.toContain(Array.from(SCHOON.subarray(0, 16)).join(","));
    for (const [label, got] of results) expect(got, label).toEqual(first);
  });

  it("weggehaald via DELETE: 404 voor een lid", async () => {
    const t = newT();
    const w = await world(t);
    await del(t, "17");
    const res = await as.alice(t).fetch(imagePath(w.ids.photo, w.version), { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("opnieuw gestuurd zonder foto: 404 voor een lid", async () => {
    const t = newT();
    const w = await world(t);
    await postOk(t, request("lustrum"));
    const res = await as.alice(t).fetch(imagePath(w.ids.photo, w.version), { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("wie uit de groep gaat, krijgt bij het volgende verzoek 404", async () => {
    const t = newT();
    const w = await world(t);
    expect((await as.alice(t).fetch(imagePath(w.ids.photo), { method: "GET" })).status).toBe(200);
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    expect((await as.alice(t).fetch(imagePath(w.ids.photo), { method: "GET" })).status).toBe(404);
  });

  it("het object is buiten de wis-paden om weg: 404, geen 500", async () => {
    const t = newT();
    const w = await world(t);
    const [id] = await storageIds(t);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.storage.delete(id as any);
    });
    const res = await as.alice(t).fetch(imagePath(w.ids.photo), { method: "GET" });
    expect(res.status).toBe(404);
  });
});
