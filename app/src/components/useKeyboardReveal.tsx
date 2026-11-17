import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Dimensions,
  Keyboard,
  Platform,
  TextInput,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type HostInstance,
  type ScrollViewInstance,
} from "react-native";
import { resizeOffset, revealOffset } from "../lib/keyboardReveal";

// WP32 invariant 11 (C1–C5): met het toetsenbord open staat het veld waarin
// getypt wordt in beeld, met daaronder zoveel mogelijk (de knop, een fout na
// versturen). KeyboardAvoidingView meet zijn plek ten opzichte van zijn ouder;
// in een modaal en boven een tabbalk vergiste hij zich (repetitie
// 2026-11-17). Hier meet het scherm in venster-coördinaten, net als het
// toetsenbord: de ruimte die het toetsenbord over de ScrollView legt, komt
// er onderaan bij (`keyboardSpace`), en het scherm kiest de scrollpositie als
// het toetsenbord opent, als een ander veld focus krijgt en als de inhoud van
// maat verandert (een melding verschijnt, een meerregelig veld groeit). Bij
// een maatwijziging springt het scherm niet terug naar het veld (C5,
// resizeOffset).

// Ruimte boven het veld voor zijn label, en eronder.
const MARGIN = 40;

export const keyboardByWindow = Platform.OS === "ios";

// Een veld meldt zijn focus aan het scherm eromheen (TextField): een ander
// veld kiezen terwijl het toetsenbord al open is, opent het niet opnieuw.
export const KeyboardRevealContext = createContext<(() => void) | null>(null);

// Een modaal blad (presentation "modal"): daarin rekent measureInWindow vanaf
// de bovenkant van het blad, het toetsenbord vanaf de bovenkant van het
// scherm. Op een iPhone loopt het blad door tot de onderkant van het scherm;
// het verschil is dus de schermhoogte min de hoogte van het blad. De route
// van een modaal zet dit (src/app/…).
const ModalSheetContext = createContext(false);

export function InModalSheet({ children }: { children: ReactNode }) {
  return <ModalSheetContext.Provider value>{children}</ModalSheetContext.Provider>;
}

export function useKeyboardReveal(
  scrollRef: RefObject<ScrollViewInstance | null>,
  // Het buitenste vlak van het scherm, tot de onderkant van het blad.
  outerRef: RefObject<HostInstance | null>,
) {
  const inModalSheet = useContext(ModalSheetContext);
  const contentHeight = useRef(0);
  // De hoogte van de inhoud zonder de ruimte voor het toetsenbord: verandert
  // die, dan veranderde de inhoud zelf.
  const ownHeight = useRef(0);
  const scrollY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const [keyboardSpace, setKeyboardSpace] = useState(0);
  const renderedSpace = useRef(0);
  renderedSpace.current = keyboardSpace;
  // De laatste meting: ScrollView, zichtbaar deel en het veld met focus.
  const last = useRef<{
    height: number;
    visibleHeight: number;
    input: unknown;
    fieldTop: number;
    fieldBottom: number;
  } | null>(null);

  type Resize = { wasAtEnd: boolean; fieldWasInView: boolean };

  const reveal = (resize?: Resize) => {
    const scroll = scrollRef.current;
    const top = keyboardTop.current;
    const input = TextInput.State.currentlyFocusedInput();
    if (!scroll || top === null || !input) return;
    const inner = scroll.getInnerViewRef();
    if (!inner) return;
    withSheetShift((shift) => scroll.measureInWindow((_x, rnY, _w, height) => {
      const y = rnY + shift;
      const visibleHeight = Math.min(height, top - y);
      if (visibleHeight <= 0) return;
      // Alleen als het veld in dit scherm staat: een scherm eronder in de
      // stack hoort het toetsenbord ook.
      input.measureLayout(
        inner,
        (_fx, fieldTop, _fw, fieldHeight) => {
          setKeyboardSpace(Math.max(0, height - visibleHeight));
          const fieldBottom = fieldTop + fieldHeight;
          last.current = { height, visibleHeight, input, fieldTop, fieldBottom };
          const place = {
            fieldTop,
            fieldBottom,
            visibleHeight,
            maxOffset: contentHeight.current - height,
            margin: MARGIN,
            current: scrollY.current,
          };
          const offset = resize ? resizeOffset({ ...place, ...resize }) : revealOffset(place);
          if (Math.abs(offset - scrollY.current) > 1) scroll.scrollTo({ y: offset, animated: true });
        },
        () => {},
      );
    }));
  };

  const withSheetShift = (then: (shift: number) => void) => {
    const outer = outerRef.current;
    if (!inModalSheet || !outer) {
      then(0);
      return;
    }
    outer.measureInWindow((_x, y, _w, height) => then(Dimensions.get("window").height - (y + height)));
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  useEffect(() => {
    if (!keyboardByWindow) return;
    const subs = [
      Keyboard.addListener("keyboardDidShow", (e: KeyboardEvent) => {
        keyboardTop.current = e.endCoordinates.screenY;
        revealRef.current();
      }),
      Keyboard.addListener("keyboardDidHide", () => {
        keyboardTop.current = null;
        last.current = null;
        setKeyboardSpace(0);
      }),
    ];
    // Het toetsenbord stond al open (een scherm dat erboven opent).
    const metrics = Keyboard.metrics();
    if (metrics) keyboardTop.current = metrics.screenY;
    return () => subs.forEach((s) => s.remove());
  }, []);

  return {
    keyboardSpace,
    onContentSizeChange: (_w: number, h: number) => {
      const before = last.current;
      const oldContent = contentHeight.current;
      const own = h - renderedSpace.current;
      const ownChanged = Math.abs(own - ownHeight.current) > 1;
      contentHeight.current = h;
      ownHeight.current = own;
      if (keyboardTop.current === null) return;
      // Alleen de ruimte voor het toetsenbord veranderde (net geopend): de
      // plek zoals bij openen, nu met de juiste hoogte.
      if (!ownChanged || !before) {
        revealRef.current();
        return;
      }
      const y = scrollY.current;
      const sameField = before.input === TextInput.State.currentlyFocusedInput();
      revealRef.current({
        wasAtEnd: y >= oldContent - before.height - MARGIN,
        fieldWasInView:
          sameField && before.fieldBottom > y && before.fieldTop < y + before.visibleHeight,
      });
    },
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
    },
    // Een ander veld krijgt focus terwijl het toetsenbord al open is.
    onFieldFocus: () => {
      setTimeout(() => revealRef.current(), 0);
    },
  };
}
