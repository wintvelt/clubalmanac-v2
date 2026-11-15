import { afterEach, beforeEach, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";

// WP20: gedeelde opzet voor de mail-tests (melden, afwijzen, meteen
// verwijderen). Spec: docs/work-packages/WP20-melden.md §A-invarianten.

export const INFO_SENDER = "info@clubalmanac.com";

/** 12:00 UTC: Amsterdam en UTC vallen op dezelfde dag (geen datum-orakel op tijdzone). */
export const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Mailjet-env + nep-fetch + vaste klok, voor elke test in het bestand. */
export function useMailWorld(): { fetchSpy: () => ReturnType<typeof vi.fn> } {
  let spy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.MAILJET_VERIFIED_SENDERS = INFO_SENDER;
    process.env.MAILJET_API_KEY = "k";
    process.env.MAILJET_API_SECRET = "s";
    spy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.MAILJET_VERIFIED_SENDERS;
    delete process.env.MAILJET_API_KEY;
    delete process.env.MAILJET_API_SECRET;
  });
  return { fetchSpy: () => spy };
}

export type SentMail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

/** Alle berichten die via de Mailjet Send API gingen. */
export function sentMails(fetchSpy: ReturnType<typeof vi.fn>): SentMail[] {
  const out: SentMail[] = [];
  for (const call of fetchSpy.mock.calls) {
    const init = call[1] as RequestInit | undefined;
    if (!init || typeof init.body !== "string") continue;
    let payload: unknown;
    try {
      payload = JSON.parse(init.body);
    } catch {
      continue;
    }
    const messages = (payload as { Messages?: unknown[] }).Messages ?? [];
    for (const m of messages as Array<Record<string, any>>) {
      out.push({
        from: m.From?.Email ?? "",
        to: (m.To ?? []).map((x: { Email?: string }) => x.Email ?? ""),
        subject: m.Subject ?? "",
        html: m.HTMLPart ?? "",
        text: m.TextPart ?? "",
      });
    }
  }
  return out;
}

const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/**
 * De dag van een tijdstip zoals een mens hem leest, onafhankelijk van de
 * templates: "28-11-2026", "28 november 2026" of "28-11". De mail moet er
 * één van bevatten.
 */
export function dayForms(ts: number): string[] {
  const d = new Date(ts);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return [`${dd}-${mm}-${yyyy}`, `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${yyyy}`];
}

export function mentionsDay(text: string, ts: number): boolean {
  return dayForms(ts).some((f) => text.includes(f));
}

// Functies die er nog niet zijn (RED): via een referentie op naam, zodat de
// typecheck niet van de gegenereerde api afhangt.
export const removeFlagged = makeFunctionReference<"mutation", { photoId: Id<"photos"> }, null>(
  "photos:removeFlagged",
);
