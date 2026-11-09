import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { albumRow, as, expectRefused, groupRow, newT, seedAlbum, seedGroup, type T } from "./_beheer";

// WP28 fix-cyclus 2, A-invariant 17 (red-team F5): de gedeelde naamcheck
// (user-, groeps- en albumnaam) weigert elk onzichtbaar teken met
// NAME_INVALID. Onzichtbaar: Unicode-categorie Cf (opmaak), de eigenschap
// Default_Ignorable_Code_Point, en de lege braille-cel U+2800.
// Uitzondering (A-keuze 2), zodat emoji en schriften als het Perzisch en
// Hindi blijven werken:
// - ZWJ (U+200D) en ZWNJ (U+200C) alleen tussen twee zichtbare tekens die
//   geen Latijnse letter, geen ASCII en geen spatie zijn. Links mag ook een
//   VS16 staan (🏳️‍🌈).
// - VS15/VS16 (U+FE0E, U+FE0F) alleen direct na een emoji-teken (ook 0–9, #
//   en * voor een keycap).
//
// Tekens via codepunt, zodat ze zichtbaar in de test staan.

const ch = (cp: number) => String.fromCodePoint(cp);
const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
const ZWJ = ch(0x200d);
const ZWNJ = ch(0x200c);
const VS15 = ch(0xfe0e);
const VS16 = ch(0xfe0f);

async function world(t: T) {
  const w = await seedGroup(t, { founder: "olga" });
  const A = await seedAlbum(t, w.groupId, w.users.olga!, "A");
  return { ...w, A };
}
type W = Awaited<ReturnType<typeof world>>;

/** Zet de naam via één pad en geeft de bewaarde naam terug. */
type NamePath = (t: T, w: W, name: string) => Promise<string | undefined>;

const PATHS: Array<[string, NamePath]> = [
  [
    "users.updateProfile",
    async (t, w, name) => {
      await as(t, "user_olga").mutation(api.users.updateProfile, { name });
      return (await t.run((ctx) => ctx.db.get(w.users.olga!)))?.name;
    },
  ],
  [
    "groups.create",
    async (t, _w, name) => {
      const id = await as(t, "user_olga").mutation(api.groups.create, { name });
      return (await groupRow(t, id))?.name;
    },
  ],
  [
    "groups.update",
    async (t, w, name) => {
      await as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, name });
      return (await groupRow(t, w.groupId))?.name;
    },
  ],
  [
    "albums.create",
    async (t, w, name) => {
      const id = await as(t, "user_olga").mutation(api.albums.create, { groupId: w.groupId, name });
      return (await albumRow(t, id))?.name;
    },
  ],
  [
    "albums.update",
    async (t, w, name) => {
      await as(t, "user_olga").mutation(api.albums.update, { albumId: w.A, name });
      return (await albumRow(t, w.A))?.name;
    },
  ],
];

// Onzichtbare tekens die vóór fix-cyclus 2 nog door de check kwamen. De
// eerste vijf vond de red-team; de rest is A's inventaris (spec §Fix-cyclus 2).
const INVISIBLE: Array<[string, number]> = [
  ["zachte afbreekstreep", 0x00ad],
  ["Arabisch letterteken", 0x061c],
  ["lege braille-cel", 0x2800],
  ["Hangul-vulteken", 0x3164],
  ["combining grapheme joiner", 0x034f],
  ["Hangul choseong-vulteken", 0x115f],
  ["Hangul jungseong-vulteken", 0x1160],
  ["Khmer-klinker", 0x17b4],
  ["Mongools variatieteken", 0x180b],
  ["Mongools klinkerscheidingsteken", 0x180e],
  ["word joiner", 0x2060],
  ["onzichtbaar functieteken", 0x2061],
  ["onzichtbaar plusteken", 0x2064],
  ["verouderd opmaakteken", 0x206a],
  ["verouderd cijferteken", 0x206f],
  ["variatiekiezer 1", 0xfe00],
  ["halve-breedte Hangul-vulteken", 0xffa0],
  ["annotatie-anker", 0xfff9],
  ["annotatie-einde", 0xfffb],
  ["Egyptisch opmaakteken", 0x13430],
  ["steno-opmaakteken", 0x1bca0],
  ["muzieknotatie-opmaakteken", 0x1d173],
  ["taalmarkering", 0xe0001],
  ["tag-letter A", 0xe0041],
  ["variatiekiezer 17", 0xe0100],
];

const REFUSED: Array<[string, string]> = [
  ...INVISIBLE.map(([label, cp]): [string, string] => [`${hex(cp)} ${label}, binnenin`, `Club${ch(cp)}Nieuw`]),
  ...[0x00ad, 0x2800, 0x3164, 0x115f, 0xffa0, 0x2060].map((cp): [string, string] => [
    `${hex(cp)} alleen`,
    ch(cp),
  ]),
  // ZWJ en ZWNJ buiten hun context.
  ["ZWJ alleen", ZWJ],
  ["ZWNJ alleen", ZWNJ],
  ["ZWJ tussen Latijnse letters", `Cl${ZWJ}ub`],
  ["ZWJ tussen Latijnse letters met accent", `Zo${ch(0xeb)}${ZWJ}${ch(0xeb)}`],
  ["ZWNJ tussen Latijnse letters", `Jan${ZWNJ}Piet`],
  ["ZWJ aan het eind", `Club${ZWJ}`],
  ["ZWJ aan het begin", `${ZWJ}Club`],
  ["ZWJ tussen emoji en letter", `${ch(0x1f600)}${ZWJ}a`],
  ["ZWJ naast een spatie", `${ch(0x1f600)} ${ZWJ}${ch(0x1f600)}`],
  ["twee ZWJ achter elkaar", `${ch(0x1f600)}${ZWJ}${ZWJ}${ch(0x1f600)}`],
  // VS15 en VS16 buiten hun context.
  ["VS16 alleen", VS16],
  ["VS16 na een letter", `Club${VS16}Nieuw`],
  ["VS15 na een letter", `a${VS15}`],
  ["twee VS16 achter elkaar", `${ch(0x2764)}${VS16}${VS16}`],
];

const ALLOWED: Array<[string, string]> = [
  ["gezin (ZWJ tussen emoji, WP15b)", `${ch(0x1f468)}${ZWJ}${ch(0x1f469)}${ZWJ}${ch(0x1f467)}`],
  ["Perzisch met ZWNJ (WP15b)", `${ch(0x645)}${ch(0x6cc)}${ZWNJ}${ch(0x62e)}${ch(0x648)}${ch(0x627)}${ch(0x647)}${ch(0x645)}`],
  ["Hindi met ZWJ", `${ch(0x915)}${ch(0x94d)}${ZWJ}${ch(0x937)}`],
  ["regenboogvlag (VS16 en ZWJ)", `${ch(0x1f3f3)}${VS16}${ZWJ}${ch(0x1f308)} Club`],
  ["hart met VS16", `${ch(0x2764)}${VS16} Hockey`],
  ["hart met VS15", `${ch(0x2764)}${VS15}`],
  ["keycap", `Team 1${VS16}${ch(0x20e3)}`],
  ["huidskleur en ZWJ", `${ch(0x1f469)}${ch(0x1f3fd)}${ZWJ}${ch(0x1f4bb)}`],
  ["hart in vlammen", `${ch(0x2764)}${VS16}${ZWJ}${ch(0x1f525)}`],
  ["gewone naam met spaties en accent", "Zoë's Club 2"],
];

describe.each(PATHS)("A-invariant 17 — naam via %s", (_path, setName) => {
  it.each(REFUSED)("%s: NAME_INVALID", async (_label, name) => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NAME_INVALID", () => setName(t, w, name));
  });

  it.each(ALLOWED)("%s: mag", async (_label, name) => {
    const t = newT();
    const w = await world(t);
    expect(await setName(t, w, name)).toBe(name);
  });
});
