import { describe, expect, it } from "vitest";
import { RECONNECT_TIMEOUT_MS, reconnectView } from "../src/lib/reconnectView";

// WP15a F6, F7 + F8: wat het inhoudsgebied toont in "reconnecting".
// - F6: Uitloggen is er altijd. Anders zit de user vast bij een blijvende
//   tokenfout met netwerk (besluit K1: geen escalatie naar convexAuthFailed).
// - F7: de tekst zegt wat er echt aan de hand is. Met netwerk geen "controleer
//   je internet", en geen belofte van een automatische poging.
// - F8: een poging die blijft hangen, eindigt na een vaste time-out in een
//   melding met knoppen. Geen eindeloos "Verbinden…".
// - F16: de poort geeft een vlag "time-out afgelopen", geen duur. Zo hangt de
//   beslissing niet van de klok af.

type Input = Parameters<typeof reconnectView>[0];

const IDLE_OFFLINE: Input = { online: false, retrying: false, retryTimedOut: false };
const IDLE_ONLINE: Input = { online: true, retrying: false, retryTimedOut: false };

const INTERNET = /internet|netwerk|wifi|wi-fi/i;
const AUTO_RETRY = /zodra|vanzelf|automatisch|straks weer/i;

const text = (v: ReturnType<typeof reconnectView>) => `${v.title} ${v.message}`;

describe("reconnectView — Uitloggen is er altijd (F6)", () => {
  it("in elke combinatie van online, poging en duur", () => {
    for (const online of [true, false, null])
      for (const retrying of [true, false])
        for (const retryTimedOut of [false, true])
          expect(reconnectView({ online, retrying, retryTimedOut }).signOut).toBe("enabled");
  });
});

describe("reconnectView — offline (F7)", () => {
  it("soort offline, Opnieuw te tikken", () => {
    const v = reconnectView(IDLE_OFFLINE);
    expect(v.kind).toBe("offline");
    expect(v.retry).toBe("enabled");
  });

  it("zegt dat er geen internet is, en dat de app het opnieuw probeert zodra er netwerk is", () => {
    const v = reconnectView(IDLE_OFFLINE);
    expect(text(v)).toMatch(INTERNET);
    expect(text(v)).toMatch(AUTO_RETRY);
  });

  it("netwerk onbekend telt als offline", () => {
    expect(reconnectView({ ...IDLE_OFFLINE, online: null }).kind).toBe("offline");
  });
});

describe("reconnectView — online, server niet bereikbaar (F7)", () => {
  it("soort serverUnreachable, Opnieuw te tikken", () => {
    const v = reconnectView(IDLE_ONLINE);
    expect(v.kind).toBe("serverUnreachable");
    expect(v.retry).toBe("enabled");
  });

  it("noemt de server en de knop Opnieuw", () => {
    const v = reconnectView(IDLE_ONLINE);
    expect(text(v)).toMatch(/server/i);
    expect(v.message).toMatch(/Opnieuw/);
  });

  it("zegt niets over internet en belooft geen automatische poging", () => {
    const v = reconnectView(IDLE_ONLINE);
    expect(text(v)).not.toMatch(INTERNET);
    expect(text(v)).not.toMatch(AUTO_RETRY);
  });

  it("tekst verschilt van de offline-melding", () => {
    expect(text(reconnectView(IDLE_ONLINE))).not.toBe(text(reconnectView(IDLE_OFFLINE)));
  });
});

describe("reconnectView — een poging loopt (F8)", () => {
  it("binnen de time-out: bezig, Opnieuw zichtbaar maar niet te tikken", () => {
    for (const online of [true, false, null]) {
      const v = reconnectView({ online, retrying: true, retryTimedOut: false });
      expect(v.kind).toBe("busy");
      expect(v.retry).toBe("busy");
    }
  });

  it("na de time-out: de melding en de knoppen keren terug", () => {
    const online = reconnectView({ online: true, retrying: true, retryTimedOut: true });
    expect(online.kind).toBe("serverUnreachable");
    expect(online.retry).toBe("enabled");
    const offline = reconnectView({ online: false, retrying: true, retryTimedOut: true });
    expect(offline.kind).toBe("offline");
    expect(offline.retry).toBe("enabled");
  });

  it("na de time-out dezelfde tekst als zonder poging", () => {
    const late = { retrying: true, retryTimedOut: true };
    expect(reconnectView({ online: true, ...late })).toEqual(reconnectView(IDLE_ONLINE));
    expect(reconnectView({ online: false, ...late })).toEqual(reconnectView(IDLE_OFFLINE));
  });

  it("de time-out is vast, en ligt tussen 5 en 30 seconden", () => {
    expect(Number.isFinite(RECONNECT_TIMEOUT_MS)).toBe(true);
    expect(RECONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(RECONNECT_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("reconnectView — elke melding heeft tekst", () => {
  it("titel en uitleg zijn nooit leeg", () => {
    for (const online of [true, false, null])
      for (const retrying of [true, false])
        for (const retryTimedOut of [false, true]) {
          const v = reconnectView({ online, retrying, retryTimedOut });
          expect(v.title.trim()).not.toBe("");
          if (v.kind !== "busy") expect(v.message.trim()).not.toBe("");
        }
  });
});
