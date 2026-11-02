import { useAuth, useUser } from "@clerk/expo";
import { useConvexAuth } from "convex/react";
import { router, usePathname } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SignOutButton } from "./auth/SignOutButton";
import { Text } from "./components/Text";
import { api } from "./convexApi";
import { AuthStateContext, ReconnectContext } from "./data/authStateContext";
import { useConvexConnection } from "./data/convexConnection";
import { useAppState } from "./data/useAppState";
import { useSessionQuery } from "./data/useLiveQuery";
import { useOnline } from "./data/useOnline";
import { routeAccess } from "./lib/routeAccess";
import { authRetryDue, deriveSessionState, type SessionState } from "./lib/sessionState";
import { StatusScreen } from "./screens/StatusScreen";

// De poort vóór elke route: de vijf toestanden van WP13 (invarianten 4, 10,
// 11, 12, 13) plus "reconnecting" (WP15a F1), per pad (WP15a invarianten 4
// en 10). Alleen lezen: geen recordVisit hier (dat is WP15b).
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
  const { tokenFetchFailed, retry } = useConvexConnection();
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
  const { state, retrying } = useStickyReconnecting(derived, session.clerkSignedIn);
  useRetryOnReturn(state, online, retry);

  const pathname = usePathname();
  const access = routeAccess(pathname, state);

  // "login" en "home": de poort leidt zelf om, en wacht niet op de guard.
  useEffect(() => {
    if (access === "login") router.replace("/inloggen");
    if (access === "home") router.replace("/");
  }, [access, pathname]);

  const reconnect = useMemo(() => ({ retrying, retry }), [retrying, retry]);

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

// Opnieuw proberen zodra de app actief en online wordt, vanuit een moment
// waarop dat niet zo was (src/lib/sessionState.ts). Alleen bij een wissel van
// AppState of netwerk, dus nooit in een lus.
function useRetryOnReturn(state: SessionState, online: boolean | null, retry: () => void) {
  const appState = useAppState();
  const before = useRef({ appState, online });
  const stateNow = useRef(state);
  stateNow.current = state;
  useEffect(() => {
    const now = { appState, online };
    if (authRetryDue({ state: stateNow.current, before: before.current, now })) retry();
    before.current = now;
  }, [appState, online, retry]);
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
