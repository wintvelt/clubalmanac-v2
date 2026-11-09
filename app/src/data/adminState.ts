import { useIsFocused } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";

// WP28b: wat het beheer tussen schermen deelt, alleen in het geheugen van deze
// app-sessie.
//
// 1. Vertrek (A-invariant 23). Wie een groep verlaat of verwijdert, of een
//    album verwijdert, verliest de toegang terwijl het scherm nog open is. De
//    live query gooit dan NOT_MEMBER, en het scherm zou even "Je bent geen
//    lid" tonen. Daarom markeert de app het id vóór de mutation; een scherm
//    dat dan NOT_MEMBER krijgt, toont alleen "Bezig…" tot de app wegnavigeert.
//    Mislukt de mutation, dan gaat de markering eraf. Een groep komt alleen
//    terug met een nieuwe uitnodiging: Mijn groepen haalt de markering dan
//    weg (forgetDepartedIn).
//
// 2. De melding na het wegnavigeren (A-keuze 7): op Mijn groepen na verlaten
//    of groep verwijderen, in de groep na album verwijderen. Hij blijft tot de
//    volgende actie: het scherm haalt hem weg als het uit beeld gaat.

type Listener = () => void;

const departing = new Set<string>();
const notices = new Map<string, string>();
const listeners = new Set<Listener>();
let version = 0;

function emit() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getVersion = () => version;

function useStore<T>(read: () => T): T {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return read();
}

export function markDeparting(id: string): void {
  departing.add(id);
  emit();
}

export function clearDeparting(id: string): void {
  if (departing.delete(id)) emit();
}

export function isDeparting(id: string): boolean {
  return departing.has(id);
}

export function useDeparting(id: string): boolean {
  return useStore(() => departing.has(id));
}

/** Een groep die weer in Mijn groepen staat (nieuwe uitnodiging), is niet meer vertrokken. */
export function forgetDepartedIn(groupIds: readonly string[]): void {
  let changed = false;
  for (const id of groupIds) if (departing.delete(id)) changed = true;
  if (changed) emit();
}

export type NoticeKey = "myGroups" | `group:${string}`;

export function setNotice(key: NoticeKey, text: string): void {
  notices.set(key, text);
  emit();
}

export function clearNotice(key: NoticeKey): void {
  if (notices.delete(key)) emit();
}

export function useNotice(key: NoticeKey): string | null {
  return useStore(() => notices.get(key) ?? null);
}

// WP28b A-keuze 7, design.md §6: de melding na een actie elders (album
// verwijderd, groep verlaten) blijft tot de volgende actie. Gaat dit scherm uit
// beeld, dan is hij weg.
export function useNoticeUntilBlur(key: NoticeKey): string | null {
  const text = useNotice(key);
  const focused = useIsFocused();
  const was = useRef(focused);
  useEffect(() => {
    if (was.current && !focused) clearNotice(key);
    was.current = focused;
  }, [focused, key]);
  return text;
}
