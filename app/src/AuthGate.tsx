import { useAuth, useClerk, useSignIn, useUser } from "@clerk/expo";
import { useConvexAuth } from "convex/react";
import { router, usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { wipeClerkStorage } from "./auth/deviceClerkStorage";
import { useLoginRequestRunning } from "./auth/loginRequest";
import { SignOutButton } from "./auth/SignOutButton";
import { Button } from "./components/Button";
import { Notice } from "./components/Notice";
import { Text } from "./components/Text";
import { api } from "./convexApi";
import { useAccountDeleted, useAccountDeleting } from "./data/accountDeletion";
import { AuthStateContext, ReconnectContext } from "./data/authStateContext";
import { restartClerk } from "./data/clerkRestart";
import { useConvexConnection } from "./data/convexConnection";
import { useAppState } from "./data/useAppState";
import { useSessionQuery } from "./data/useLiveQuery";
import { useOnline } from "./data/online";
import { useRecordVisit } from "./data/useRecordVisit";
import { noUserRowView, type NoUserRowView } from "./lib/noUserRowView";
import { RECONNECT_TIMEOUT_MS } from "./lib/reconnectView";
import { routeAccess } from "./lib/routeAccess";
import {
  authRetryDue,
  deriveSessionState,
  rememberSinceUp,
  type Conditions,
  type SessionState,
} from "./lib/sessionState";
import { startupFailedView } from "./lib/startupFailedView";
import {
  clerkRestartDue,
  deriveStartupState,
  loginInProgress,
  STARTUP_TIMEOUT_MS,
  startupRetryDue,
  type ClerkStatus,
  type GateState,
} from "./lib/startupState";
import { StatusScreen } from "./screens/StatusScreen";

// De poort vóór elke route: de vijf toestanden van WP13 (invarianten 4, 10,
// 11, 12, 13) plus "reconnecting" (WP15a F1) en "startupFailed" (F12), per pad
// (WP15a invarianten 4 en 10). Daarnaast registreert de poort een bezoek bij
// elke terugkeer naar "actief en ingelogd" (WP15b, useRecordVisit).
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
  // WP19b A-invariant 3: zonder users-rij zegt de backend waarom. Alleen live
  // zolang users.current `null` is.
  const signupState = useSessionQuery(api.users.signupState, {}, {
    ...session,
    convexAuthenticated: session.convexAuthenticated && currentUser === null,
  });
  const derived = deriveSessionState({ ...session, currentUser, tokenFetchFailed, online });
  const sticky = useStickyReconnecting(derived, session.clerkSignedIn);
  const { retrying } = sticky;
  useRecordVisit(sticky.state, currentUser?._id ?? null);
  // F12: "laden" duurt nooit langer dan de time-out.
  const loading = useTimeout(sticky.state === "loading", STARTUP_TIMEOUT_MS);
  const clerkStatus = useClerk().status;
  const state = deriveStartupState({
    session: sticky.state,
    clerkStatus,
    clerkSignedIn: session.clerkSignedIn,
    loadingTimedOut: loading.timedOut,
  });
  const { retryTimedOut, retry } = useRetryTimer(retrying, retryConnection);
  useRetryOnReturn({
    state,
    online,
    clerkStatus,
    clerkSignedIn: session.clerkSignedIn,
    // F17, F23: tijdens een login herstart de app Clerk nooit: vanaf de tik op
    // "Stuur code", en in de codestap (ook na een tweede start).
    loginInProgress: loginInProgress({
      signInStatus: useSignIn().signIn.status,
      requestRunning: useLoginRequestRunning(),
    }),
    retry,
  });

  const pathname = usePathname();
  const access = routeAccess(pathname, state);
  // WP29: na Account verwijderen is users.current `null` tot het uitloggen
  // klaar is; dan geen "Je account is nog niet klaar" tussendoor, en als het
  // uitloggen mislukt "Je account is verwijderd" (noUserRowView).
  const accountDeleting = useAccountDeleting();
  const accountDeleted = useAccountDeleted();

  // "login" en "home": de poort leidt zelf om, en wacht niet op de guard.
  useEffect(() => {
    if (access === "login") router.replace("/inloggen");
    if (access === "home") router.replace("/");
  }, [access, pathname]);

  const reconnect = useMemo(
    () => ({ online, retrying, retryTimedOut, retry }),
    [online, retrying, retryTimedOut, retry],
  );

  // Zonder Clerk weet de app niet of er een sessie is: geen navigator.
  if (state === "startupFailed") return <StartupFailedScreen online={online} clerkStatus={clerkStatus} />;

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
      return (
        <NoUserRow
          view={noUserRowView({ deleting: accountDeleting, deleted: accountDeleted, signupState })}
        />
      );
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

// Is `active` al langer dan de time-out waar (F16)? Eén timer per periode,
// geen klok: springt de klok, dan loopt de time-out toch één keer af. Een
// nieuwe periode begint bij elke overgang naar waar, en met `restart`.
function useTimeout(active: boolean, timeoutMs: number): { timedOut: boolean; restart: () => void } {
  const [period, setPeriod] = useState(0);
  const [expired, setExpired] = useState<number | null>(null);
  if (!active && expired !== null) setExpired(null);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setExpired(period), timeoutMs);
    return () => clearTimeout(timer);
  }, [active, period, timeoutMs]);
  const restart = useCallback(() => setPeriod((p) => p + 1), []);
  return { timedOut: active && expired === period, restart };
}

// Hoe lang loopt de huidige poging al (F8)? Elke nieuwe poging begint een
// nieuwe time-out, ook als de vorige nog doorloopt.
function useRetryTimer(
  retrying: boolean,
  retryConnection: () => void,
): { retryTimedOut: boolean; retry: () => void } {
  const { timedOut, restart } = useTimeout(retrying, RECONNECT_TIMEOUT_MS);
  const retry = useCallback(() => {
    restart();
    retryConnection();
  }, [restart, retryConnection]);
  return { retryTimedOut: timedOut, retry };
}

// Opnieuw proberen zodra de app actief en online wordt, vanuit een moment
// waarop dat niet zo was: na "startupFailed" Clerk opnieuw starten (F12), na
// een start uit de cache zonder sessie ook (F14), in "reconnecting" een nieuw
// Convex-token. De regels vergelijken met wat er gebeurde sinds de app voor
// het laatst actief en online was (rememberSinceUp, F22), dus ook een netwerk
// dat terugkwam terwijl de app "inactive" was. Een herstart van Clerk
// herlaadt de app; een nieuwe start begint zonder "netwerk kwam terug": de
// eerste meting van het netwerk (null → bekend) telt niet als wissel. Zo
// geeft herladen geen lus.
function useRetryOnReturn(input: {
  state: GateState;
  online: boolean | null;
  clerkStatus: ClerkStatus;
  clerkSignedIn: boolean;
  loginInProgress: boolean;
  retry: () => void;
}) {
  const { online, retry } = input;
  const appState = useAppState();
  const memo = useRef<Conditions>({ appState, online });
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    const now = { appState, online };
    const { state, clerkStatus, clerkSignedIn, loginInProgress } = latest.current;
    const was = memo.current;
    memo.current = rememberSinceUp(was, now);
    if (was.online === null) return;
    if (startupRetryDue({ state, before: was, now })) void restartClerk();
    else if (clerkRestartDue({ clerkStatus, clerkSignedIn, loginInProgress, before: was, now })) void restartClerk();
    else if (state !== "startupFailed" && authRetryDue({ state, before: was, now })) retry();
  }, [appState, online, retry]);
}

// F12, F15: Clerk start niet. "Opnieuw" start Clerk opnieuw (herladen). De
// uitweg wist alles lokaal (F13) en start Clerk opnieuw, zonder signOut: Clerk
// is niet geladen. Daarna volgt het inlogscherm.
function StartupFailedScreen({
  online,
  clerkStatus,
}: {
  online: boolean | null;
  clerkStatus: ClerkStatus;
}) {
  const view = startupFailedView({ online, clerkStatus });
  const [resetting, setResetting] = useState(false);
  const reset = () => {
    setResetting(true);
    void wipeClerkStorage()
      .then(() => restartClerk())
      .finally(() => setResetting(false));
  };
  return (
    <StatusScreen error title={view.title} message={view.message}>
      <Button title="Opnieuw" onPress={() => void restartClerk()} />
      <Button
        title="Opnieuw inloggen"
        busyTitle="Gegevens wissen…"
        variant="secondary"
        onPress={reset}
        busy={resetting}
      />
    </StatusScreen>
  );
}

function Loading() {
  return <StatusScreen spinner spinnerLabel="Laden…" />;
}

function NoUserRow({ view }: { view: NoUserRowView }) {
  switch (view) {
    case "loading":
      return <Loading />;
    case "accountDeleted":
      return <AccountDeletedScreen />;
    case "noInvite":
      return <NoInviteScreen />;
    case "notReady":
      return <NoUserRowScreen />;
  }
}

// WP19b A-invariant 3 en A-keuze 3: ingelogd, maar zonder account en zonder
// uitnodiging. Geen "opnieuw proberen": wie later wordt uitgenodigd, logt uit
// en opnieuw in.
function NoInviteScreen() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  return (
    <StatusScreen
      title="Je hebt eerst een uitnodiging nodig"
      message="Clubalmanac is alleen voor leden van een groep. Vraag een beheerder van je groep om je uit te nodigen met dit e-mailadres. Log daarna uit en opnieuw in."
    >
      {email && <Text color="muted">Ingelogd als {email}</Text>}
      <SignOutButton />
    </StatusScreen>
  );
}

// WP29 fix 7: het account is verwijderd, maar het uitloggen daarna lukte niet.
function AccountDeletedScreen() {
  return (
    <StatusScreen title="Je account is verwijderd">
      <Notice kind="error" message="Uitloggen lukte niet. Probeer het opnieuw." />
      <SignOutButton />
    </StatusScreen>
  );
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
