import { ClerkProvider, useAuth } from "@clerk/expo";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { StatusBar } from "expo-status-bar";
import { useState, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthGate } from "./src/AuthGate";
import { tokenCache } from "./src/auth/tokenCache";
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

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {"env" in envResult ? (
        <Providers env={envResult.env}>
          <AuthGate />
        </Providers>
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
  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
      <ConvexPerSession convex={convex}>{children}</ConvexPerSession>
    </ClerkProvider>
  );
}

// Eén Convex-auth-toestand per Clerk-sessie. Zonder de key blijft de
// "nee" van de uitgelogde toestand staan tot Convex het nieuwe token
// bevestigt, en flitst na inloggen kort "server weigert je sessie". Met de key
// begint elke sessie bij "laden", en blijft er na uitloggen niets van de
// vorige user in de boom hangen (invariant 13).
function ConvexPerSession({
  convex,
  children,
}: {
  convex: ConvexReactClient;
  children: ReactNode;
}) {
  const { sessionId } = useAuth();
  return (
    <ConvexProviderWithClerk key={sessionId ?? "signed-out"} client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
