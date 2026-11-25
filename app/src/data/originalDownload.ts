// WP38c (besluit 8): downloaden kan alleen in de webapp (originalDownload.web.ts).
// In de app is er geen downloadknop; deze variant doet niets.
export function startDownload(_url: string): boolean {
  return false;
}
