import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  coverSource,
  filmErrorMessage,
  filmSections,
  filmVideoSource,
  groupHasFilms,
  initialPlayback,
  playbackReducer,
  type FilmListItem,
} from "../src/lib/films";
import { filmPath } from "../src/lib/groupRoutes";
import { PUBLIC_PATHS, routeAccess } from "../src/lib/routeAccess";
import { listFiles } from "./support/sourceScan";

// WP21 — de pure logica van de films in de app.
//   Pariteit (A-keuzes): kopjes "Trailers" en "Blockbusters", volgorde van de
//   backend, tab Films alleen in een groep met films.
//   Invariant 7: zonder cover een nette tegel (hasCover false → geen bron).
//   Invariant 5 en A-invariant 14: een fout geeft een NL-melding met opnieuw
//   proberen; opnieuw proberen haalt een verse link en gaat verder waar de
//   kijker was.
//   Invariant 6 en A-invariant 15: geen film op schijf; covers wel in de
//   cache, met een vaste sleutel (de ondertekende link wisselt per verzoek).
// Spec: docs/work-packages/WP21-videos.md §Testcontract.

const BLOB = "g_blob";
const OTHER = "g_other";

const film = (over: Partial<FilmListItem>): FilmListItem => ({
  _id: "f1",
  groupId: BLOB,
  kind: "film",
  title: "Film",
  year: 2000,
  hasCover: true,
  ...over,
});

const LIST: FilmListItem[] = [
  film({ _id: "t1", kind: "trailer", title: "Trailer A", year: 2022 }),
  film({ _id: "t2", kind: "trailer", title: "Trailer B", year: 2016 }),
  film({ _id: "f1", title: "Film A", year: 2022 }),
  film({ _id: "f2", title: "Film B", year: 2016, hasCover: false }),
  film({ _id: "f3", groupId: OTHER, title: "Film C", year: 1991 }),
];

describe("filmSections (pariteit)", () => {
  it("trailers eerst, dan Blockbusters, in de volgorde van de backend", () => {
    const sections = filmSections(LIST.filter((f) => f.groupId === BLOB));
    expect(sections.map((s) => s.title)).toEqual(["Trailers", "Blockbusters"]);
    expect(sections[0]!.films.map((f) => f._id)).toEqual(["t1", "t2"]);
    expect(sections[1]!.films.map((f) => f._id)).toEqual(["f1", "f2"]);
  });

  it("een lege soort krijgt geen kopje", () => {
    expect(filmSections([film({ _id: "f1" })]).map((s) => s.title)).toEqual(["Blockbusters"]);
    expect(filmSections([film({ _id: "t1", kind: "trailer" })]).map((s) => s.title)).toEqual(["Trailers"]);
    expect(filmSections([])).toEqual([]);
  });

  it("de volgorde binnen een soort blijft die van de backend (niet op jaar of titel)", () => {
    const list = [film({ _id: "a", year: 1990, title: "Z" }), film({ _id: "b", year: 2020, title: "A" })];
    expect(filmSections(list)[0]!.films.map((f) => f._id)).toEqual(["a", "b"]);
  });
});

describe("groupHasFilms (tab Films alleen waar films zijn)", () => {
  it("true voor een groep met films in de lijst", () => {
    expect(groupHasFilms(LIST, BLOB)).toBe(true);
    expect(groupHasFilms(LIST, OTHER)).toBe(true);
  });

  it("false voor een groep zonder films, een lege lijst en een lijst die nog laadt", () => {
    expect(groupHasFilms(LIST, "g_none")).toBe(false);
    expect(groupHasFilms([], BLOB)).toBe(false);
    expect(groupHasFilms(undefined, BLOB)).toBe(false);
  });
});

describe("coverSource (A-invariant 15, invariant 7)", () => {
  const signedA = "https://bucket.s3.eu-central-1.amazonaws.com/c.png?X-Amz-Date=20261115T120000Z&X-Amz-Signature=aaaa";
  const signedB = "https://bucket.s3.eu-central-1.amazonaws.com/c.png?X-Amz-Date=20261115T130000Z&X-Amz-Signature=bbbb";

  it("de bron is de ondertekende link", () => {
    expect(coverSource("f1", signedA).uri).toBe(signedA);
  });

  it("de cache-sleutel is vast per film: twee links voor dezelfde cover, één sleutel", () => {
    expect(coverSource("f1", signedA).cacheKey).toBe(coverSource("f1", signedB).cacheKey);
  });

  it("de cache-sleutel verschilt per film", () => {
    expect(coverSource("f1", signedA).cacheKey).not.toBe(coverSource("f2", signedA).cacheKey);
  });

  it("de cache-sleutel bevat de link en de handtekening niet", () => {
    const key = coverSource("f1", signedA).cacheKey;
    expect(key).not.toContain("X-Amz");
    expect(key).not.toContain("amazonaws");
    expect(key).not.toContain("aaaa");
  });
});

describe("filmVideoSource (invariant 6, A-invariant 15)", () => {
  const url = "https://bucket.s3.eu-central-1.amazonaws.com/f.mp4?X-Amz-Signature=cccc";

  it("speelt de ondertekende link af, nooit uit een schijfcache", () => {
    const source = filmVideoSource(url, "Blob in Proef");
    expect(source.uri).toBe(url);
    expect(source.useCaching).toBe(false);
  });

  it("de titel staat in de metadata (voor het bedieningsscherm en AirPlay)", () => {
    expect(filmVideoSource(url, "Blob in Proef").metadata?.title).toBe("Blob in Proef");
  });
});

describe("playbackReducer (invariant 5, A-invariant 14)", () => {
  it("begint met laden, vanaf het begin, eerste poging", () => {
    expect(initialPlayback).toEqual({ phase: "loading", attempt: 0, position: 0 });
  });

  it("link klaar → spelen; voortgang onthoudt de positie", () => {
    let s = playbackReducer(initialPlayback, { type: "linkReady" });
    expect(s.phase).toBe("ready");
    s = playbackReducer(s, { type: "progress", seconds: 1234.5 });
    expect(s.position).toBe(1234.5);
  });

  it("een fout halverwege houdt de positie vast en toont de foutstand", () => {
    let s = playbackReducer(initialPlayback, { type: "linkReady" });
    s = playbackReducer(s, { type: "progress", seconds: 2400 });
    s = playbackReducer(s, { type: "failed" });
    expect(s.phase).toBe("error");
    expect(s.position).toBe(2400);
  });

  it("opnieuw proberen: verse link (nieuwe poging), verder vanaf dezelfde positie", () => {
    let s = playbackReducer(initialPlayback, { type: "linkReady" });
    s = playbackReducer(s, { type: "progress", seconds: 2400 });
    s = playbackReducer(s, { type: "failed" });
    const before = s.attempt;
    s = playbackReducer(s, { type: "retry" });
    expect(s.phase).toBe("loading");
    expect(s.attempt).toBe(before + 1);
    expect(s.position).toBe(2400);
    s = playbackReducer(s, { type: "linkReady" });
    expect(s.phase).toBe("ready");
    expect(s.position).toBe(2400);
  });

  it("een fout vóór de eerste beelden: opnieuw proberen begint bij 0", () => {
    let s = playbackReducer(initialPlayback, { type: "failed" });
    s = playbackReducer(s, { type: "retry" });
    expect(s).toEqual({ phase: "loading", attempt: 1, position: 0 });
  });

  it("voortgang tijdens laden of in de foutstand verschuift de positie niet", () => {
    let s = playbackReducer(initialPlayback, { type: "linkReady" });
    s = playbackReducer(s, { type: "progress", seconds: 600 });
    s = playbackReducer(s, { type: "failed" });
    s = playbackReducer(s, { type: "progress", seconds: 0 });
    expect(s.position).toBe(600);
    s = playbackReducer(s, { type: "retry" });
    s = playbackReducer(s, { type: "progress", seconds: 0 });
    expect(s.position).toBe(600);
  });
});

describe("filmErrorMessage (invariant 5)", () => {
  for (const kind of ["link", "playback", "cover"] as const) {
    it(`${kind}: een NL-melding met opnieuw proberen`, () => {
      const m = filmErrorMessage(kind);
      expect(m.text.length).toBeGreaterThan(10);
      expect(m.text).toMatch(/opnieuw/i);
      expect(m.retryLabel).toBe("Opnieuw proberen");
      expect(m.text).not.toMatch(/error|failed|S3|AWS|403|FILM_NOT_FOUND/i);
    });
  }
});

describe("route (pariteit: een eigen filmscherm onder de groep)", () => {
  it("filmPath", () => {
    expect(filmPath("g1", "f1")).toBe("/groep/g1/film/f1");
    expect(filmPath("g 1", "f/1")).toBe("/groep/g%201/film/f%2F1");
  });

  it("het routebestand bestaat in de Home-stack", () => {
    const appDir = fileURLToPath(new URL("../src/app", import.meta.url));
    const files = existsSync(appDir) ? listFiles(appDir, new Set()) : [];
    expect(files.some((f) => /^\(tabs\)\/\(home\)\/groep\/\[groupId\]\/film\/\[filmId\](\/index)?\.tsx$/.test(f))).toBe(
      true,
    );
  });

  it("is niet publiek: ingelogd tonen, uitgelogd naar inloggen", () => {
    const path = filmPath("g1", "f1");
    expect(PUBLIC_PATHS.has(path)).toBe(false);
    expect(routeAccess(path, "ready")).toBe("show");
    expect(routeAccess(path, "signedOut")).toBe("login");
  });
});

describe("broncode (invariant 6, A-invariant 15)", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const files = listFiles(srcDir, new Set()).filter((f) => /\.(ts|tsx)$/.test(f));
  const read = (f: string) => readFileSync(`${srcDir}/${f}`, "utf8");

  it("expo-video staat in de afhankelijkheden (native module: nieuwe dev-build)", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["expo-video"]).toBeTruthy();
  });

  it("nergens useCaching: true (geen film in de schijfcache)", () => {
    const hits = files.filter((f) => /useCaching\s*:\s*true/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("geen speler in het groepsscherm of de lijst (niet vanzelf afspelen of vooruit laden)", () => {
    expect(read("screens/GroupScreen.tsx")).not.toMatch(/from\s+["']expo-video["']/);
    const listUsers = files.filter((f) => /api\.films\.list\b/.test(read(f)));
    expect(listUsers.length, "niemand gebruikt api.films.list").toBeGreaterThan(0);
    for (const f of listUsers) expect(read(f), f).not.toMatch(/from\s+["']expo-video["']/);
  });

  it("geen download van een film (geen expo-file-system in een bestand dat een film-link haalt)", () => {
    const linkUsers = files.filter((f) => /api\.films\.videoUrl\b/.test(read(f)));
    expect(linkUsers.length, "niemand gebruikt api.films.videoUrl").toBeGreaterThan(0);
    for (const f of linkUsers) expect(read(f), f).not.toMatch(/expo-file-system|downloadAsync|downloadFileAsync/);
  });

  it("geen bucket-naam of S3-host in de app-broncode", () => {
    const hits = files.filter((f) => /amazonaws\.com|blob-videos/.test(read(f)));
    expect(hits).toEqual([]);
  });
});
