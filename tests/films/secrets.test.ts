import { describe, expect, it, vi } from "vitest";
import {
  as,
  ENV,
  ENV_NAMES,
  filmsApi,
  newT,
  outcome,
  seedFilmsWorld,
  useFilmsEnv,
  type R,
} from "./_films";

// WP21 — invariant 3 (geen geheim in antwoorden, fouten of logs) en de
// fail-loud bij ontbrekende env-vars (risico-assessment ops, §Testcontract).
// De weigering gaat vóór de config: wie geen toegang heeft, krijgt altijd
// FILM_NOT_FOUND, ook als de config ontbreekt (laatste test). Zo verraadt een
// config-fout niet dat er een film is.

useFilmsEnv();

const SECRET = ENV.FILMS_S3_SECRET_ACCESS_KEY;

function spyConsole() {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
    });
  }
  return lines;
}

describe("fail-loud bij ontbrekende of lege env-vars", () => {
  for (const name of ENV_NAMES) {
    for (const value of [undefined, ""] as const) {
      it(`${name} ${value === undefined ? "ontbreekt" : "is leeg"} → film-link faalt met FILMS_S3_CONFIG_MISSING:`, async () => {
        const t = newT();
        const w = await seedFilmsWorld(t);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
        const lines = spyConsole();
        const o = await outcome(() => as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB }));
        expect("err" in o, "verwacht een fout, kreeg een link").toBe(true);
        if ("err" in o) {
          expect(o.err.message).toMatch(/FILMS_S3_CONFIG_MISSING:/);
          expect(o.err.message).toContain(name);
          expect(o.err.message).not.toContain(SECRET);
          expect(JSON.stringify(o.err.data ?? null)).not.toContain(SECRET);
        }
        for (const l of lines) expect(l).not.toContain(SECRET);
      });
    }
  }

  it("ook de cover-link faalt luid zonder config", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    delete process.env.FILMS_S3_BUCKET;
    const o = await outcome(() => as.alice(t).action(filmsApi.coverUrl, { filmId: w.films.filmB }));
    expect("err" in o).toBe(true);
    if ("err" in o) expect(o.err.message).toMatch(/FILMS_S3_CONFIG_MISSING:/);
  });
});

describe("invariant 3: het geheim komt nergens terug", () => {
  it("geen geheim in logs bij een geslaagde link of een weigering", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    const lines = spyConsole();
    const ok = (await as.alice(t).action(filmsApi.videoUrl, { filmId: w.films.filmB })) as R;
    const refused = await outcome(() => as.carol(t).action(filmsApi.videoUrl, { filmId: w.films.filmB }));
    expect(JSON.stringify(ok)).not.toContain(SECRET);
    expect(JSON.stringify(refused)).not.toContain(SECRET);
    for (const l of lines) {
      expect(l).not.toContain(SECRET);
      // Ook geen ondertekende link in de logs: dat is een werkende sleutel tot de film.
      expect(l).not.toMatch(/X-Amz-Signature=/i);
    }
  });

  it("een niet-lid zonder config krijgt de gewone weigering, geen config-fout", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);
    delete process.env.FILMS_S3_SECRET_ACCESS_KEY;
    const o = await outcome(() => as.carol(t).action(filmsApi.videoUrl, { filmId: w.films.filmB }));
    expect("err" in o && o.err.data).toEqual({ code: "FILM_NOT_FOUND" });
  });
});
