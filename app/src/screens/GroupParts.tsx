import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackPill } from "../components/BackPill";
import { Gradient } from "../components/Gradient";
import { LetterTile } from "../components/LetterTile";
import { Notice } from "../components/Notice";
import { SmallButton } from "../components/SmallButton";
import { Text } from "../components/Text";
import { radius, size, space, useTheme } from "../theme";

// Gedeelde stukken van Mijn groepen en Groep (WP16).

// Terug naar Mijn groepen, ook zonder scherm eronder (deep link).
export function backToMyGroups() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

// Grote titel bovenaan een scherm zonder navigatiebalk. Blijft staan in elke
// toestand, ook in "reconnecting" (design.md §6: de kop blijft staan).
export function LargeTitleHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.column, { paddingTop: insets.top + space.l }]}>
      <Text variant="largeTitle" accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

// De kop van Groep (design.md §5, §7): de coverkop zonder foto (wash-tint),
// met het vlak in het verloop met de eerste letter (besluit 2) en de
// terugknop-pil linksboven onder de statusbalk.
export function CoverHeader({ name }: { name?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.cover, { paddingTop: insets.top + space.s, minHeight: insets.top + size.cover }]}>
      <Gradient from={colors.washStart} to={colors.washEnd} />
      <View style={styles.coverColumn}>
        <BackPill title="Mijn groepen" onPress={backToMyGroups} />
        {name !== undefined && (
          <View style={styles.coverTile}>
            <LetterTile name={name} size={size.groupTile * 1.5} radius={radius.groupPhoto} variant="largeTitle" />
          </View>
        )}
      </View>
    </View>
  );
}

// Fout bij laden (design.md §6): een melding met "Opnieuw" erin.
export function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Notice kind="error" title={title} message="Controleer je verbinding en probeer het opnieuw.">
      <SmallButton title="Opnieuw" icon="refresh" onPress={onRetry} />
    </Notice>
  );
}

const styles = StyleSheet.create({
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
  },
  cover: { width: "100%" },
  coverColumn: {
    flex: 1,
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingBottom: space.l,
    gap: space.l,
  },
  coverTile: { flex: 1, alignItems: "center", justifyContent: "center" },
});
