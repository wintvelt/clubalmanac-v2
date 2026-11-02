import { useIsFocused } from "expo-router";
import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { useRef } from "react";
import { screenQueryIsLive, sessionQueryIsLive } from "../lib/liveQuery";
import { useAuthState } from "./authStateContext";
import { useAppState } from "./useAppState";

// WP15a invariant 6: het enige toegangspad voor live Convex-data. Geen ander
// bestand gebruikt useQuery of een watch (tests/liveQueryAccess.test.ts).
// Of een query loopt, beslist src/lib/liveQuery.ts; buiten "live" krijgt
// Convex "skip", en dan is er geen abonnement.

type Query = FunctionReference<"query">;

// Een live query voor het scherm in beeld (invarianten 5, 13, 14). Een stack
// en de tabs houden schermen gemount, dus focus beslist, niet unmounten.
// Gepauzeerd geeft het de laatst bekende waarde, tot de verse er is
// (invariant 12). Die waarde leeft in deze hook; de poort mount alles opnieuw
// per Clerk-sessie, dus er blijft niets van een vorige user staan.
export function useLiveQuery<Q extends Query>(
  query: Q,
  args: FunctionArgs<Q>,
): FunctionReturnType<Q> | undefined {
  const focused = useIsFocused();
  const appState = useAppState();
  const authState = useAuthState();
  const live = screenQueryIsLive({ focused, appState, authState });
  return useRetainedQuery(query, args, live);
}

// De ene query achter de auth-poort (users.current). Hangt niet van focus af:
// hij staat boven de navigatie. Wel pauzeert hij buiten AppState "active".
export function useSessionQuery<Q extends Query>(
  query: Q,
  args: FunctionArgs<Q>,
  session: {
    clerkLoaded: boolean;
    clerkSignedIn: boolean;
    convexAuthLoading: boolean;
    convexAuthenticated: boolean;
  },
): FunctionReturnType<Q> | undefined {
  const appState = useAppState();
  const live = sessionQueryIsLive({ appState, ...session });
  return useRetainedQuery(query, args, live);
}

function useRetainedQuery<Q extends Query>(
  query: Q,
  args: FunctionArgs<Q>,
  live: boolean,
): FunctionReturnType<Q> | undefined {
  const rest = [live ? args : "skip"] as OptionalRestArgsOrSkip<Q>;
  const result = useQuery(query, ...rest);
  const key = `${getFunctionName(query)}:${JSON.stringify(args)}`;
  const last = useRef<{ key: string; value: FunctionReturnType<Q> } | null>(null);
  if (result !== undefined) last.current = { key, value: result };
  if (result !== undefined) return result;
  // Alleen de waarde van dezelfde query met dezelfde args.
  return last.current?.key === key ? last.current.value : undefined;
}
