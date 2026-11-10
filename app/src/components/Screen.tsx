import { useContext, useEffect, useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignOutButton } from "../auth/SignOutButton";
import { useAuthState, useReconnect } from "../data/authStateContext";
import { reconnectView } from "../lib/reconnectView";
import { size, space, useTheme } from "../theme";
import { Notice } from "./Notice";
import { SmallButton } from "./SmallButton";
import { LoadingState } from "./States";

type Props = {
  children: ReactNode;
  background?: "bg" | "surface";
  // Volle breedte boven de inhoud, tot onder de statusbalk. Regelt zelf de
  // bovenste safe area.
  header?: ReactNode;
  // Inhoud verticaal in het midden (statusschermen).
  centered?: boolean;
  // Onder een navigatiebalk: die regelt de bovenste safe area al.
  underHeader?: boolean;
  // Houdt het einde van de inhoud in beeld, ook als het toetsenbord opengaat
  // (bv. de knop onder het laatste veld van een formulier).
  keepEndInView?: boolean;
};

// Scrolt altijd, zodat bij de grootste tekststand en met het toetsenbord open
// niets onbereikbaar wordt (invariant 4, bevinding 13). Op iPad en liggend
// blijft de tekstkolom hoogstens 640 pt breed, in het midden. In
// "reconnecting" toont het inhoudsgebied laden of een fout, altijd met
// "Opnieuw" en "Uitloggen"; de kop en de tabbalk blijven staan (WP15a F1, F6,
// design.md §6).
export function Screen({
  children,
  background = "bg",
  header,
  centered = false,
  underHeader = false,
  keepEndInView = false,
}: Props) {
  const { colors } = useTheme();
  const reconnecting = useAuthState() === "reconnecting";
  // WP29 fix-cyclus 3: KeyboardAvoidingView meet zijn plek ten opzichte van
  // zijn ouder, niet van het venster. Onder een navigatiebalk telt hij die dan
  // niet mee, en bleef de onderkant van het formulier onder het toetsenbord.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const scrollRef = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (keepEndInView) scrollRef.current?.scrollToEnd({ animated: true });
  }, [keepEndInView]);
  return (
    <SafeAreaView
      edges={header || underHeader ? ["left", "right", "bottom"] : ["top", "left", "right", "bottom"]}
      style={[styles.fill, { backgroundColor: colors[background] }]}
    >
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={underHeader ? headerHeight : 0}
        style={styles.fill}
      >
        <ScrollView
          ref={scrollRef}
          // Het toetsenbord maakt de lijst kleiner: dan opnieuw naar het einde.
          onLayout={() => {
            if (keepEndInView) scrollRef.current?.scrollToEnd({ animated: true });
          }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, centered && styles.centered]}
        >
          {header}
          <View style={styles.column}>{reconnecting ? <ReconnectingState /> : children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ReconnectingState() {
  const { online, retrying, retryTimedOut, retry } = useReconnect();
  const view = reconnectView({ online, retrying, retryTimedOut });
  const retryButton = (
    <SmallButton title="Opnieuw" onPress={retry} disabled={view.retry === "busy"} />
  );
  return (
    <>
      {view.kind === "busy" ? (
        <>
          <LoadingState label={view.title} />
          {retryButton}
        </>
      ) : (
        <Notice kind="error" title={view.title} message={view.message}>
          {retryButton}
        </Notice>
      )}
      <SignOutButton />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: space.xxl },
  centered: { justifyContent: "center" },
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingTop: space.xl,
    gap: space.l,
  },
});
