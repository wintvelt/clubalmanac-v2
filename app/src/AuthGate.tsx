import { useAuth, useUser } from "@clerk/expo";
import { useConvexAuth, useQuery } from "convex/react";
import { SignOutButton } from "./auth/SignOutButton";
import { Text } from "./components/Text";
import { api } from "./convexApi";
import { deriveAuthState } from "./lib/authState";
import { HomeScreen } from "./screens/HomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { StatusScreen } from "./screens/StatusScreen";

// De vijf toestanden van WP13 (invarianten 4, 10, 11, 12, 13).
// Alleen lezen: geen recordVisit hier (invariant 16, dat is WP15).
export function AuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const queryAllowed = isLoaded && isSignedIn === true && !isLoading && isAuthenticated;
  // Live: maakt de webhook de rij alsnog aan, dan wordt dit vanzelf "ready".
  const currentUser = useQuery(api.users.current, queryAllowed ? {} : "skip");

  const state = deriveAuthState({
    clerkLoaded: isLoaded,
    clerkSignedIn: isSignedIn === true,
    convexAuthLoading: isLoading,
    convexAuthenticated: isAuthenticated,
    currentUser,
  });

  switch (state) {
    case "loading":
      return <StatusScreen spinner spinnerLabel="Laden…" />;
    case "signedOut":
      return <LoginScreen />;
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
    case "ready":
      // deriveAuthState geeft alleen "ready" met een rij.
      return currentUser ? (
        <HomeScreen user={currentUser} />
      ) : (
        <StatusScreen spinner spinnerLabel="Laden…" />
      );
  }
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
