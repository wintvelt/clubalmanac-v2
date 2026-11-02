import { useAuth, useUser } from "@clerk/expo";
import { useConvexAuth } from "convex/react";
import { usePathname } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SignOutButton } from "./auth/SignOutButton";
import { Text } from "./components/Text";
import { api } from "./convexApi";
import { AuthStateContext } from "./data/authStateContext";
import { useSessionQuery } from "./data/useLiveQuery";
import { deriveAuthState } from "./lib/authState";
import { routeAccess } from "./lib/routeAccess";
import { StatusScreen } from "./screens/StatusScreen";

// De poort vóór elke route: de vijf toestanden van WP13 (invarianten 4, 10,
// 11, 12, 13) per pad (WP15a invarianten 4 en 10). Alleen lezen: geen
// recordVisit hier (dat is WP15b).
//
// De navigator (children) rendert alleen bij "show", "login" en "home". Wie
// welk scherm mag zien, regelen de guards in src/app/_layout.tsx met dezelfde
// toestand. Klopt het pad nog niet bij de toestand ("login", "home"), dan
// dekt een laadscherm de navigator af tot de guard hem heeft omgezet: zo is
// er geen render waarin een ingelogd scherm zonder sessie te zien is.
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const session = {
    clerkLoaded: isLoaded,
    clerkSignedIn: isSignedIn === true,
    convexAuthLoading: isLoading,
    convexAuthenticated: isAuthenticated,
  };
  // Live: maakt de webhook de rij alsnog aan, dan wordt dit vanzelf "ready".
  // Gepauzeerd in de achtergrond geldt de laatst bekende rij (invariant 12).
  const currentUser = useSessionQuery(api.users.current, {}, session);
  const state = deriveAuthState({ ...session, currentUser });
  const access = routeAccess(usePathname(), state);

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
          {children}
          {access !== "show" && (
            <View style={StyleSheet.absoluteFill}>
              <Loading />
            </View>
          )}
        </AuthStateContext>
      );
  }
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
