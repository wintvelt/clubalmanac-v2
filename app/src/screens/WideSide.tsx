import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackPill } from "../components/BackPill";
import { Gradient } from "../components/Gradient";
import { PhotoImage } from "../components/Photo";
import { Text } from "../components/Text";
import { initialOf } from "../lib/groups";
import { SIDE_WIDTH } from "../lib/wideLayout";
import { radius, size, space, useTheme } from "../theme";
import type { CoverPhoto } from "./GroupParts";

// WP35 (besluit Wouter 2026-11-20): de brede layout van Groep en Album.
// Links deze vaste kolom: terugknop-pil (Album), de cover in 4:3 met afgeronde
// hoeken (zonder cover, of als hij niet laadt: het verloop met de letter), de
// titel, de regels eronder en de knoppen. Rechts scrolt de inhoud; deze kolom
// blijft staan (scrolt alleen zelf als hij hoger is dan het venster).
// Alleen gebruikt als useWideLayout() waar is: een breed web-venster, of een
// liggende iPad. Geen bewegende kop (WP33): de cover staat stil.

const COVER_WIDTH = SIDE_WIDTH - 2 * size.screenMargin;
const COVER_HEIGHT = Math.round((COVER_WIDTH * 3) / 4);
// WP41c: hetzelfde vak voor de foto van een afrekening in de linkerkolom.
export const SIDE_COVER_BOX = { width: COVER_WIDTH, height: COVER_HEIGHT };

// Beide kolommen beginnen onder de statusbalk (op iOS; in de browser is die
// marge 0). Links en rechts heeft een iPad geen veilige marge; onderaan staat
// de tabbalk.
// WP40 (gate ronde 2): de selectiebalk ligt over het scherm; `bottomSpace` is
// zijn hoogte, zodat ook de onderkant van deze kolom boven de balk uit te
// scrollen is (zoals de lijst rechts).
export function WideSplit({
  side,
  bottomSpace = 0,
  children,
}: {
  side: ReactNode;
  bottomSpace?: number;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.split, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.side}
        contentContainerStyle={[
          styles.sideContent,
          bottomSpace > 0 && { paddingBottom: size.screenMargin + bottomSpace },
        ]}
        scrollIndicatorInsets={{ bottom: bottomSpace }}
      >
        {side}
      </ScrollView>
      <View style={styles.main}>{children}</View>
    </View>
  );
}

export function WideSide({
  back,
  top,
  name,
  cover,
  description,
  meta,
  children,
}: {
  back?: { title: string; onPress: () => void };
  // WP40 (A8): bovenin, op de plek van de pil (de kop van de selectiestand).
  top?: ReactNode;
  name: string | undefined;
  cover: CoverPhoto | null | undefined;
  description?: string;
  meta?: string;
  // Knoppen en tabs onder de titel.
  children?: ReactNode;
}) {
  return (
    <>
      {top ??
        (back && (
          <View style={styles.pill}>
            <BackPill title={back.title} onPress={back.onPress} />
          </View>
        ))}
      <SideCover name={name} cover={cover} />
      {name !== undefined && (
        <View style={styles.intro}>
          <Text variant="title" accessibilityRole="header">
            {name}
          </Text>
          {description ? <Text>{description}</Text> : null}
          {meta ? (
            <Text variant="meta" color="muted">
              {meta}
            </Text>
          ) : null}
        </View>
      )}
      {children}
    </>
  );
}

function SideCover({ name, cover }: { name: string | undefined; cover: CoverPhoto | null | undefined }) {
  const { colors } = useTheme();
  const box = { width: COVER_WIDTH, height: COVER_HEIGHT };
  const letter = (
    <View style={[box, styles.letter]} accessible={false}>
      <Gradient from={colors.gradStart} to={colors.gradEnd} radius={radius.groupPhoto} />
      {name !== undefined && (
        <Text variant="largeTitle" color="onGradient" maxFontSizeMultiplier={1}>
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
  if (!cover) return letter;
  return (
    <View style={[box, styles.coverClip]}>
      <PhotoImage
        photoId={cover._id}
        format="groot"
        exifOrientation={cover.exifOrientation}
        hasFormats={cover.hasFormats}
        box={box}
        radius={radius.groupPhoto}
        fallback={letter}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: "row" },
  side: { width: SIDE_WIDTH, flexGrow: 0, flexShrink: 0 },
  sideContent: { padding: size.screenMargin, paddingTop: space.xl, gap: space.l },
  main: { flex: 1, minWidth: 0 },
  pill: { alignSelf: "flex-start" },
  intro: { gap: space.xs },
  letter: { alignItems: "center", justifyContent: "center" },
  coverClip: { borderRadius: radius.groupPhoto, overflow: "hidden" },
});
