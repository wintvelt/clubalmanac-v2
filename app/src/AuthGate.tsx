import { useAuth, useClerk, useUser } from "@clerk/expo";
import { useConvexAuth } from "convex/react";
import { router, usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SignOutButton } from "./auth/SignOutButton";
import { Button } from "./components/Button";
import { Text } from "./components/Text";
import { api } from "./convexApi";
import { AuthStateContext, ReconnectContext } from "./data/authStateContext";
import { useRestartClerk } from "./data/clerkRestart";
import { useConvexConnection } from "./data/convexConnection";
import { useResumeSession } from "./data/resumeSession";
import { useAppState } from "./data/useAppState";
import { useSessionQuery } from "./data/useLiveQuery";
import { useOnline } from "./data/online";
import { RECONNECT_TIMEOUT_MS } from "./lib/reconnectView";
import { routeAccess } from "./lib/routeAccess";
import { authRetryDue, deriveSessionState, type SessionState } from "./lib/sessionState";
import {
  deriveStartupState,
  STARTUP_TIMEOUT_MS,
  startupRetryDue,
  type GateState,
} from "./lib/startupState";
import { StatusScreen } from "./screens/StatusScreen";

// De poort vóór elke route: de vijf toestanden van WP13 (invarianten 4, 10,
// 11, 12, 13) plus "reconnecting" (WP15a F1) en "startupFailed" (F12), per pad
// (WP15a invarianten 4 en 10). Alleen lezen: geen recordVisit hier (dat is
// WP15b).
//
// De navigator (children) rendert alleen bij "show", "login" en "home". Wie
// welk scherm mag zien, regelen de guards in src/app/_layout.tsx met dezelfde
// toestand. Klopt het pad nog niet bij de toestand ("login", "home"), dan
// leidt de poort zelf om, en dekt een laadscherm de navigator af tot het pad
// klopt: zo is er geen render waarin een ingelogd scherm zonder sessie te zien
// is.
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { tokenFetchFailed, retry: retryConnection } = useConvexConnection();
  const online = useOnline();
  const session = {
    clerkLoaded: isLoaded,
    clerkSignedIn: isSignedIn === true,
    convexAuthLoading: isLoading,
    convexAuthenticated: isAuthenticated,
  };
  // Live: maakt de webhook de rij alsnog aan, dan wordt dit vanzelf "ready".
  // Gepauzeerd in de achtergrond geldt de laatst bekende rij (invariant 12).
  const currentUser = useSessionQuery(api.users.current, {}, session);
  const derived = deriveSessionState({ ...session, currentUser, tokenFetchFailed, online });
  const sticky = useStickyReconnecting(derived, session.clerkSignedIn);
  const { retrying } = sticky;
  // F12: "laden" duurt nooit langer dan de time-out.
  const loading = useElapsed(sticky.state === "loading", STARTUP_TIMEOUT_MS);
  const state = deriveStartupState({
    session: sticky.state,
    clerkStatus: useClerk().status,
    clerkSignedIn: session.clerkSignedIn,
    loadingForMs: loading.ms,
  });
  const { retryingForMs, retry } = useRetryTimer(retrying, retryConnection);
  useRetryOnReturn(state, online, retry, useRestartClerk());
  useResumeSession();

  const pathname = usePathname();
  const access = routeAccess(pathname, state);

  // "login" en "home": de poort leidt zelf om, en wacht niet op de guard.
  useEffect(() => {
    if (access === "login") router.replace("/inloggen");
    if (access === "home") router.replace("/");
  }, [access, pathname]);

  const reconnect = useMemo(
    () => ({ online, retrying, retryingForMs, retry }),
    [online, retrying, retryingForMs, retry],
  );

  // Zonder Clerk weet de app niet of er een sessie is: geen navigator.
  if (state === "startupFailed") return <StartupFailedScreen online={online} />;

  switch (access) {
    case "wait":
      return <Loading />;
    case "convexAuthFailed":
      return (
        <StatusScreen
          error
          title="Verbinden met de server lukt niet"
          message="Je bent ingelogd, maar de server accepteert je sessie niet. Log uit en probeer het opnieuw. Blijft dit gebeuren, meld het dan bij de beheerder."
        >
          <SignOutButton />
        </StatusScreen>
      );
    case "noUserRow":
      return <NoUserRowScreen />;
    case "show":
    case "login":
    case "home":
      return (
        <AuthStateContext value={state}>
          <ReconnectContext value={reconnect}>
            {children}
            {access !== "show" && (
              <View style={StyleSheet.absoluteFill}>
                <Loading />
              </View>
            )}
          </ReconnectContext>
        </AuthStateContext>
      );
  }
}

// Een nieuwe poging laat Convex even "laden" zeggen. Kwam de app uit
// "reconnecting", dan blijft hij daar tot de uitkomst er is: anders verdwijnt
// de navigator, en daarmee de plek in de stacks.
function useStickyReconnecting(
  derived: SessionState,
  clerkSignedIn: boolean,
): { state: SessionState; retrying: boolean } {
  const [wasReconnecting, setWasReconnecting] = useState(false);
  if (derived === "reconnecting" && !wasReconnecting) setWasReconnecting(true);
  if (derived !== "reconnecting" && derived !== "loading" && wasReconnecting) {
    setWasReconnecting(false);
  }
  const retrying = derived === "loading" && wasReconnecting && clerkSignedIn;
  return { state: retrying ? "reconnecting" : derived, retrying };
}

// Hoe lang is `active` al waar? Begint bij elke overgang naar waar opnieuw,
// en met `restart` ook tussendoor. Bij de time-out rendert de poort opnieuw.
function useElapsed(active: boolean, timeoutMs: number): { ms: number; restart: () => void } {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTimedOut] = useState(0);
  if (active && startedAt === null) setStartedAt(Date.now());
  if (!active && startedAt !== null) setStartedAt(null);
  useEffect(() => {
    if (startedAt === null) return;
    const left = startedAt + timeoutMs - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTimedOut((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [startedAt, timeoutMs]);
  const restart = useCallback(() => setStartedAt(Date.now()), []);
  return { ms: startedAt === null ? 0 : Date.now() - startedAt, restart };
}

// Hoe lang loopt de huidige poging al (F8)? Elke nieuwe poging begint een
// nieuwe time-out, ook als de vorige nog doorloopt.
function useRetryTimer(
  retrying: boolean,
  retryConnection: () => void,
): { retryingForMs: number; retry: () => void } {
  const { ms, restart } = useElapsed(retrying, RECONNECT_TIMEOUT_MS);
  const retry = useCallback(() => {
    restart();
    retryConnection();
  }, [restart, retryConnection]);
  return { retryingForMs: ms, retry };
}

// Opnieuw proberen zodra de app actief en online wordt, vanuit een moment
// waarop dat niet zo was: na "startupFailed" Clerk opnieuw starten (F12), in
// "reconnecting" een nieuw Convex-token. Alleen bij een wissel van AppState of
// netwerk, dus nooit in een lus. Het netwerk wordt boven Clerk gemeten
// (src/data/online.tsx): na een herstart van Clerk is er geen nieuwe wissel.
function useRetryOnReturn(
  state: GateState,
  online: boolean | null,
  retry: () => void,
  restartClerk: () => void,
) {
  const appState = useAppState();
  const before = useRef({ appState, online });
  const stateNow = useRef(state);
  stateNow.current = state;
  useEffect(() => {
    const now = { appState, online };
    const s = stateNow.current;
    if (startupRetryDue({ state: s, before: before.current, now })) restartClerk();
    else if (s !== "startupFailed" && authRetryDue({ state: s, before: before.current, now })) retry();
    before.current = now;
  }, [appState, online, retry, restartClerk]);
}

// F12: Clerk start niet. "Opnieuw" mount Clerk opnieuw (App.tsx).
function StartupFailedScreen({ online }: { online: boolean | null }) {
  const restartClerk = useRestartClerk();
  return (
    <StatusScreen
      error
      title="De app kan nu niet starten"
      message={
        online === true
          ? "De server is niet bereikbaar. Tik op \"Opnieuw\"."
          : "Er is geen internet. De app probeert het opnieuw zodra er netwerk is."
      }
    >
      <Button title="Opnieuw" onPress={restartClerk} />
    </StatusScreen>
  );
}

function Loading() {
  return <StatusScreen spinner spinnerLabel="Laden…" />;
}

function NoUserRowScreen() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  return (
    <StatusScreen
      title="Je account is nog niet klaar"
      message="Je bent ingelogd, maar we vinden je account nog niet. Meestal duurt dit een paar seconden. Gebeurt er niets, meld het dan bij de beheerder."
      spinner
    >
      {email && <Text color="muted">Ingelogd als {email}</Text>}
      <SignOutButton />
    </StatusScreen>
  );
}
