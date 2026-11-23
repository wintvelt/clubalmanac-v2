// WP38b: pure hulpjes voor het proefscherm van de originelen
// (OriginalProbeScreen), alleen in dev-builds. Overgenomen uit de spike
// (`wp38b-spike`, besluit 26).

// De dev-deployment (docs/work-packages/WP38-filmproject-originelen.md, Spike
// 38b). Het proefscherm opent en sluit echte filmprojecten: nooit tegen prod.
const DEV_CONVEX_URL = /^https:\/\/glorious-pheasant-759\.([a-z0-9-]+\.)*convex\.cloud\/?$/i;

export function isDevDeployment(convexUrl: string | undefined): boolean {
  return typeof convexUrl === "string" && DEV_CONVEX_URL.test(convexUrl.trim());
}

const pad = (n: number) => String(n).padStart(2, "0");

/** uu:mm:ss in de tijd van het toestel. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** dd-mm uu:mm in de tijd van het toestel. */
export function dayTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function bytesText(n: number): string {
  if (!Number.isFinite(n)) return "?";
  if (n >= 2 ** 30) return `${(n / 2 ** 30).toFixed(2).replace(".", ",")} GiB`;
  if (n >= 2 ** 20) return `${(n / 2 ** 20).toFixed(1).replace(".", ",")} MiB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KiB`;
  return `${n} B`;
}

export function durationText(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "?";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Een fout als korte tekst: de data van een ConvexError, anders de melding, zonder links. */
export function errorText(error: unknown, convexData?: unknown): string {
  if (convexData !== undefined) {
    try {
      return JSON.stringify(convexData);
    } catch {
      return "ConvexError";
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "<link>").slice(0, 200);
}
