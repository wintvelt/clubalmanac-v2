import { ConvexError } from "convex/values";
import { NAME_MAX_LENGTH } from "./constants";

// WP15b A-punt 3: tekens die een naam onleesbaar of misleidend maken.
// Controletekens (C0, DEL, C1), regel- en alineascheiding, tekens die de
// leesrichting omdraaien, en onzichtbare spaties. U+200C/U+200D (ZWNJ/ZWJ)
// mogen: die zitten in emoji en in sommige schriften.
// WP28 A-invariant 12: dezelfde regel voor groeps- en albumnamen.
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
  if (FORBIDDEN_NAME_CHARS.test(name)) fail("NAME_INVALID");
  return name;
}
