import { ClerkProvider, useAuth } from "@clerk/expo";
import { ConvexReactClient } from "convex/react";
import { StatusBar } from "expo-status-bar";
import { useState, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { deviceClerkStorage } from "./src/auth/deviceClerkStorage";
import { ConvexProviderWithClerkRetry } from "./src/data/convexConnection";
import { ImageHostProvider } from "./src/data/images";
import { OnlineProvider } from "./src/data/online";
import { parseClientEnv, type ClientEnv } from "./src/lib/env";
import { StatusScreen } from "./src/screens/StatusScreen";

// Letterlijke toegang is nodig: Expo neemt EXPO_PUBLIC_-vars alleen zo op in
// de build. Ontbreekt er een, dan stopt de app hier (invariant 7).
function readEnv(): { env: ClientEnv } | { error: string } {
  try {
    return {
      env: parseClientEnv({
        EXPO_PUBLIC_CONVEX_URL: process.env.EXPO_PUBLIC_CONVEX_URL,
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
      }),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const envResult = readEnv();

// De schil om de router (src/app/_layout.tsx): env, safe area, Clerk en
// Convex. Het entry-punt is expo-router/entry; de routes staan in src/app/.
export default function App({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {"env" in envResult ? (
        <Providers env={envResult.env}>{children}</Providers>
      ) : (
        <StatusScreen error title="De app is verkeerd ingesteld" message={envResult.error} />
      )}
    </SafeAreaProvider>
  );
}

function Providers({ env, children }: { env: ClientEnv; children: ReactNode }) {
  const [convex] = useState(
    () => new ConvexReactClient(env.convexUrl, { unsavedChangesWarning: false }),
  );
  // De resource-cache laat Clerk offline starten met de laatst bekende
  // client en omgeving (status "degraded"). F13: cache en client-token staan
  // in één eigen opslag, die uitloggen helemaal wist.
  const storage = deviceClerkStorage(env.clerkPublishableKey);
  return (
    <OnlineProvider>
      <ClerkProvider
        publishableKey={env.clerkPublishableKey}
        tokenCache={storage.tokenCache}
        __experimental_resourceCache={storage.resourceCache}
      >
        <ImageHostProvider convexUrl={env.convexUrl}>
          <ConvexPerSession convex={convex}>{children}</ConvexPerSession>
        </ImageHostProvider>
      </ClerkProvider>
    </OnlineProvider>
  );
}

// Eén Convex-auth-toestand per Clerk-sessie. Zonder de key blijft de
// "nee" van de uitgelogde toestand staan tot Convex het nieuwe token
// bevestigt, en flitst na inloggen kort "server weigert je sessie". Met de key
// begint elke sessie bij "laden", en blijft er na uitloggen niets van de
// vorige user in de boom hangen (invariant 13): ook de navigator en zijn
// stacks mounten opnieuw (WP15a invariant 11).
function ConvexPerSession({
  convex,
  children,
}: {
  convex: ConvexReactClient;
  children: ReactNode;
}) {
  const { sessionId } = useAuth();
  return (
    <ConvexProviderWithClerkRetry key={sessionId ?? "signed-out"} client={convex}>
      {children}
    </ConvexProviderWithClerkRetry>
  );
}
