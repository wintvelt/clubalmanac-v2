import type { ClerkStatus } from "./startupState";

// WP15a F15: wat het scherm "startupFailed" toont. De tekst volgt de oorzaak:
// geen internet, een server die niet op tijd antwoordt, of een fout van Clerk
// die blijft. Naast "Opnieuw" is er altijd een uitweg: alles lokaal wissen en
// opnieuw inloggen.

export type StartupFailedView = {
  kind: "offline" | "serverSlow" | "startupError";
  title: string;
  message: string;
  retry: "enabled";
  reset: "enabled";
};

const TITLE = "De app kan nu niet starten";

export function startupFailedView(input: {
  // null = onbekend, en dat telt als offline.
  online: boolean | null;
  clerkStatus: ClerkStatus;
}): StartupFailedView {
  const view = { title: TITLE, retry: "enabled", reset: "enabled" } as const;
  if (input.online !== true) {
    return {
      ...view,
      kind: "offline",
      message: "Er is geen internet. De app probeert het opnieuw zodra er netwerk is.",
    };
  }
  if (input.clerkStatus === "error") {
    return {
      ...view,
      kind: "startupError",
      message:
        "Er ging iets mis bij het starten. Tik op \"Opnieuw\". Lukt het daarna nog niet, kies dan \"Opnieuw inloggen\".",
    };
  }
  return {
    ...view,
    kind: "serverSlow",
    message: "De server antwoordt niet op tijd. Tik op \"Opnieuw\" om het nog een keer te proberen.",
  };
}
