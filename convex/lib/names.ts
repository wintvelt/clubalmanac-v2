import { ConvexError } from "convex/values";
import { NAME_MAX_LENGTH } from "./constants";

// WP15b A-punt 3: tekens die een naam onleesbaar of misleidend maken.
// Controletekens (C0, DEL, C1), regel- en alineascheiding, tekens die de
// leesrichting omdraaien, en onzichtbare spaties. U+200C/U+200D (ZWNJ/ZWJ)
// zitten in emoji en in sommige schriften: zie hasForbiddenChar.
// WP28 A-invariant 12: dezelfde regel voor groeps- en albumnamen.
// WP28 A-invariant 17: daarbovenop alles wat onzichtbaar is (zie isInvisible),
// met ZWJ/ZWNJ en VS15/VS16 alleen in hun context (A-keuze 2).
const FORBIDDEN_NAME_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\ufeff]/;

/**
 * Geeft de naam zoals hij bewaard wordt (getrimd), of gooit een ConvexError
 * met een code: `emptyCode` (een user-naam heet `NAME_EMPTY`, een groep of
 * album `NAME_REQUIRED`), `NAME_TOO_LONG` (meer dan NAME_MAX_LENGTH code
 * points) of `NAME_INVALID`. Een gewone Error komt in productie aan als
 * "Server Error"; de app toont de reden bij de code.
 * `trim` haalt ook vaste spaties (U+00A0, U+3000) en een BOM aan de rand weg.
 */
export function validName(
  raw: string,
  emptyCode: "NAME_EMPTY" | "NAME_REQUIRED",
): string {
  const name = raw.trim();
  const fail = (code: string): never => {
    throw new ConvexError({ code });
  };
  if (name.length === 0) fail(emptyCode);
  if ([...name].length > NAME_MAX_LENGTH) fail("NAME_TOO_LONG");
  if (hasForbiddenChar(name)) fail("NAME_INVALID");
  return name;
}

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const BRAILLE_BLANK = 0x2800;

// Opmaaktekens (Cf) en tekens die een renderer mag negeren
// (Default_Ignorable_Code_Point): onder meer de zachte afbreekstreep,
// Hangul-vultekens, variatiekiezers en de tag-tekens.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const LATIN = /\p{Script=Latin}/u;
const SPACE = /\p{White_Space}/u;
// Emoji-tekens, ook 0-9, # en * (keycap).
const EMOJI = /\p{Emoji}/u;

function isInvisible(c: string): boolean {
  return (
    FORBIDDEN_NAME_CHARS.test(c) ||
    INVISIBLE.test(c) ||
    c.codePointAt(0) === BRAILLE_BLANK
  );
}

// Een zichtbaar teken waar een ZWJ of ZWNJ naast mag: geen ASCII, geen
// Latijnse letter, geen spatie (emoji, Perzisch, Hindi wel).
function isJoinable(c: string | undefined): boolean {
  if (c === undefined) return false;
  if ((c.codePointAt(0) ?? 0) < 0x80) return false;
  return !isInvisible(c) && !LATIN.test(c) && !SPACE.test(c);
}

function hasForbiddenChar(name: string): boolean {
  const cps = [...name];
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]!;
    const cp = c.codePointAt(0);
    const left = cps[i - 1];
    if (cp === ZWJ || cp === ZWNJ) {
      const leftOk = left?.codePointAt(0) === VS16 || isJoinable(left);
      if (!leftOk || !isJoinable(cps[i + 1])) return true;
      continue;
    }
    if (cp === VS15 || cp === VS16) {
      if (left === undefined || !EMOJI.test(left)) return true;
      continue;
    }
    if (isInvisible(c)) return true;
  }
  return false;
}

/**
 * WP20 A-invariant 1: titel en omschrijving van een idee of probleem. Zelfde
 * tekenregel als namen, eigen grenzen. Geeft de getrimde tekst, of gooit een
 * ConvexError met de code van het veld.
 * - Titel: 1–100 code points, één regel (`TITLE_REQUIRED`, `TITLE_TOO_LONG`,
 *   `TITLE_INVALID`).
 * - Omschrijving: 0–2000 code points; regeleinden (`\n`) mogen, elke regel
 *   volgt de tekenregel (`DESCRIPTION_TOO_LONG`, `DESCRIPTION_INVALID`).
 */
export const FEATURE_TITLE_MAX_LENGTH = 100;
export const FEATURE_DESCRIPTION_MAX_LENGTH = 2000;

export function validFeatureTitle(raw: string): string {
  const title = raw.trim();
  if (title.length === 0) throw new ConvexError({ code: "TITLE_REQUIRED" });
  if ([...title].length > FEATURE_TITLE_MAX_LENGTH) {
    throw new ConvexError({ code: "TITLE_TOO_LONG" });
  }
  if (hasForbiddenChar(title)) throw new ConvexError({ code: "TITLE_INVALID" });
  return title;
}

export function validFeatureDescription(raw: string): string {
  const description = raw.trim();
  if ([...description].length > FEATURE_DESCRIPTION_MAX_LENGTH) {
    throw new ConvexError({ code: "DESCRIPTION_TOO_LONG" });
  }
  if (description.split("\n").some(hasForbiddenChar)) {
    throw new ConvexError({ code: "DESCRIPTION_INVALID" });
  }
  return description;
}
