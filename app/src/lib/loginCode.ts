// WP13 invariant 19 + plakken: de code uit de mail komt ook van buiten het
// invoerveld (plakken, iOS-autofill, later de mail-link uit WP22). Alleen
// spaties, streepjes en regeleinden vallen weg; we raden niet uit langere tekst.

const SEPARATORS = /[\s-]/g;
const SIX_ASCII_DIGITS = /^[0-9]{6}$/;

export function normalizeLoginCode(input: string): string | null {
  const code = input.replace(SEPARATORS, "");
  return SIX_ASCII_DIGITS.test(code) ? code : null;
}
