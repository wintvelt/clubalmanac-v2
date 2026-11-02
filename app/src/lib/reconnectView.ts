// WP15a F6–F8: wat het inhoudsgebied toont in "reconnecting". Uitloggen is er
// altijd (besluit K1: geen escalatie naar convexAuthFailed). De tekst zegt wat
// er echt aan de hand is: zonder netwerk geen internet, met netwerk een server
// die niet antwoordt. Een poging die blijft hangen, eindigt na een vaste
// time-out weer in de melding met knoppen.

export const RECONNECT_TIMEOUT_MS = 15_000;

export type ReconnectView = {
  kind: "busy" | "offline" | "serverUnreachable";
  title: string;
  message: string;
  retry: "enabled" | "busy";
  signOut: "enabled";
};

export function reconnectView(input: {
  // null = onbekend, en dat telt als offline.
  online: boolean | null;
  retrying: boolean;
  retryingForMs: number;
}): ReconnectView {
  if (input.retrying && input.retryingForMs < RECONNECT_TIMEOUT_MS) {
    return { kind: "busy", title: "Verbinden…", message: "", retry: "busy", signOut: "enabled" };
  }
  if (input.online !== true) {
    return {
      kind: "offline",
      title: "Geen internet",
      message: "De app probeert het opnieuw zodra er netwerk is.",
      retry: "enabled",
      signOut: "enabled",
    };
  }
  return {
    kind: "serverUnreachable",
    title: "De server is niet bereikbaar",
    message: "Tik op \"Opnieuw\" om het nog een keer te proberen.",
    retry: "enabled",
    signOut: "enabled",
  };
}
