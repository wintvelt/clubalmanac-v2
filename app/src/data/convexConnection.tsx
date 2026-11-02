import { useAuth } from "@clerk/expo";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Convex met het Clerk-token, zoals ConvexProviderWithClerk, met twee
// toevoegingen voor WP15a F1:
// - het meet of de laatste tokenophaal mislukte (fout of geen token);
// - het kan een nieuwe poging starten. Een nieuwe fetchAccessToken laat
//   Convex opnieuw setAuth doen, zonder de navigator opnieuw te mounten.

type Connection = { tokenFetchFailed: boolean; retry: () => void };

const ConnectionContext = createContext<Connection>({
  tokenFetchFailed: false,
  retry: () => {},
});

export function useConvexConnection(): Connection {
  return useContext(ConnectionContext);
}

type TokenAttempt = { attempt: number; report: (ok: boolean) => void };

const TokenAttemptContext = createContext<TokenAttempt>({ attempt: 0, report: () => {} });

export function ConvexProviderWithClerkRetry({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [tokenFetchFailed, setTokenFetchFailed] = useState(false);
  const report = useCallback((ok: boolean) => setTokenFetchFailed(!ok), []);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const token = useMemo(() => ({ attempt, report }), [attempt, report]);
  const connection = useMemo(() => ({ tokenFetchFailed, retry }), [tokenFetchFailed, retry]);
  return (
    <TokenAttemptContext value={token}>
      <ConvexProviderWithAuth client={client} useAuth={useAuthFromClerk}>
        <ConnectionContext value={connection}>{children}</ConnectionContext>
      </ConvexProviderWithAuth>
    </TokenAttemptContext>
  );
}

// Gelijk aan de hook in convex/react-clerk, plus `attempt` en `report`.
function useAuthFromClerk() {
  const { isLoaded, isSignedIn, getToken, orgId, orgRole, sessionId, sessionClaims } = useAuth();
  const { attempt, report } = useContext(TokenAttemptContext);
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        const token =
          sessionClaims?.aud === "convex"
            ? await getToken({ skipCache: forceRefreshToken })
            : await getToken({ template: "convex", skipCache: forceRefreshToken });
        report(token !== null);
        return token;
      } catch {
        report(false);
        return null;
      }
    },
    // Clerk's useAuth is niet gememoïseerd: getToken hoort er niet bij. Een
    // nieuwe `attempt` geeft een nieuwe functie, en dus een nieuwe poging.
    [orgId, orgRole, sessionId, attempt, report],
  );
  return useMemo(
    () => ({ isLoading: !isLoaded, isAuthenticated: isSignedIn ?? false, fetchAccessToken }),
    [isLoaded, isSignedIn, fetchAccessToken],
  );
}
