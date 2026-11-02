import { useAuth } from "@clerk/expo";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  finishTokenFetch,
  initialTokenFetch,
  startTokenFetch,
  tokenFetchFailed as failed,
} from "../lib/tokenFetch";

// Convex met het Clerk-token, zoals ConvexProviderWithClerk, met twee
// toevoegingen voor WP15a F1:
// - het meet of de laatst gestarte tokenophaal mislukte (fout of geen token).
//   Een late uitkomst van een eerdere poging telt niet (F9);
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

type TokenAttempt = {
  attempt: number;
  begin: () => number;
  end: (id: number, ok: boolean) => void;
};

const TokenAttemptContext = createContext<TokenAttempt>({
  attempt: 0,
  begin: () => 0,
  end: () => {},
});

export function ConvexProviderWithClerkRetry({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [tokenFetchFailed, setTokenFetchFailed] = useState(false);
  const fetches = useRef(initialTokenFetch);
  const begin = useCallback(() => {
    const { state, id } = startTokenFetch(fetches.current);
    fetches.current = state;
    return id;
  }, []);
  const end = useCallback((id: number, ok: boolean) => {
    fetches.current = finishTokenFetch(fetches.current, id, ok);
    setTokenFetchFailed(failed(fetches.current));
  }, []);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const token = useMemo(() => ({ attempt, begin, end }), [attempt, begin, end]);
  const connection = useMemo(() => ({ tokenFetchFailed, retry }), [tokenFetchFailed, retry]);
  return (
    <TokenAttemptContext value={token}>
      <ConvexProviderWithAuth client={client} useAuth={useAuthFromClerk}>
        <ConnectionContext value={connection}>{children}</ConnectionContext>
      </ConvexProviderWithAuth>
    </TokenAttemptContext>
  );
}

// Gelijk aan de hook in convex/react-clerk, plus `attempt` en een volgnummer
// om elke aanroep van fetchAccessToken.
function useAuthFromClerk() {
  const { isLoaded, isSignedIn, getToken, orgId, orgRole, sessionId, sessionClaims } = useAuth();
  const { attempt, begin, end } = useContext(TokenAttemptContext);
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      const id = begin();
      try {
        const token =
          sessionClaims?.aud === "convex"
            ? await getToken({ skipCache: forceRefreshToken })
            : await getToken({ template: "convex", skipCache: forceRefreshToken });
        end(id, token !== null);
        return token;
      } catch {
        end(id, false);
        return null;
      }
    },
    // Clerk's useAuth is niet gememoïseerd: getToken hoort er niet bij. Een
    // nieuwe `attempt` geeft een nieuwe functie, en dus een nieuwe poging.
    [orgId, orgRole, sessionId, attempt, begin, end],
  );
  return useMemo(
    () => ({ isLoading: !isLoaded, isAuthenticated: isSignedIn ?? false, fetchAccessToken }),
    [isLoaded, isSignedIn, fetchAccessToken],
  );
}
