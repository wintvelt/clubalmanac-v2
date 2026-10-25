import type { ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { size, space, useTheme } from "../theme";

type Props = {
  children: ReactNode;
  background?: "bg" | "surface";
  // Volle breedte boven de inhoud, tot onder de statusbalk. Regelt zelf de
  // bovenste safe area.
  header?: ReactNode;
  // Inhoud verticaal in het midden (statusschermen).
  centered?: boolean;
};

// Scrolt altijd, zodat bij de grootste tekststand en met het toetsenbord open
// niets onbereikbaar wordt (invariant 4, bevinding 13). Op iPad en liggend
// blijft de tekstkolom hoogstens 640 pt breed, in het midden.
export function Screen({ children, background = "bg", header, centered = false }: Props) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={header ? ["left", "right", "bottom"] : ["top", "left", "right", "bottom"]}
      style={[styles.fill, { backgroundColor: colors[background] }]}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, centered && styles.centered]}
        >
          {header}
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
