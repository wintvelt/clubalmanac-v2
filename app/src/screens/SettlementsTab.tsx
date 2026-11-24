import type { FunctionReturnType } from "convex/server";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "../components/Icon";
import { LetterTile } from "../components/LetterTile";
import { AnimatedPressable, FadeIn, PressShade, TileZoom, useArrivals, usePressMotion } from "../components/Motion";
import { Text } from "../components/Text";
import { YearHeading } from "../components/YearHeading";
import type { api } from "../convexApi";
import { settlementPath } from "../lib/groupRoutes";
import { settlementsByYear, timelineLabel, timelineMeta } from "../lib/settlements";
import { radius, size, space, useTheme } from "../theme";

export type SettlementListItem = FunctionReturnType<typeof api.settlements.listByGroup>[number];

// WP41: de tab Geld van een groep. De tijdlijn per jaar, met dezelfde jaarkop
// als de albums. Per afrekening een kaart: de tegel, de naam, de periode met
// het aantal deelnemers en "x van y nog open" of "Afgerond". Tik op de kaart
// en het overzicht opent. De lijst komt van GroupScreen (hij beslist ook of
// de tab er is, invariant 8).
export function SettlementsTab({ groupId, settlements }: { groupId: Id<"groups">; settlements: SettlementListItem[] }) {
  const arrivals = useArrivals(settlements.map((s) => s._id));
  return (
    <View style={styles.years}>
      {settlementsByYear(settlements).map(({ year, settlements: inYear }) => (
        <View key={year} style={styles.year}>
          <YearHeading year={year} />
          {inYear.map((s) => (
            <FadeIn key={s._id} active={arrivals.has(s._id)}>
              <SettlementCard item={s} onPress={() => router.push(settlementPath(groupId, s._id))} />
            </FadeIn>
          ))}
        </View>
      ))}
    </View>
  );
}

function SettlementCard({ item, onPress }: { item: SettlementListItem; onPress: () => void }) {
  const { colors } = useTheme();
  const press = usePressMotion("tile");
  const meta = timelineMeta(item);
  const label = timelineLabel(item);
  const done = item.openCount === 0;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${meta}, ${label}`}
      onPress={press.withRelease(onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.card, { backgroundColor: colors.surface }, press.style]}
    >
      <TileZoom zoom={press.coverStyle} size={size.albumTile} radius={radius.albumTile}>
        <LetterTile name={item.name} size={size.albumTile} radius={radius.albumTile} variant="albumName" />
      </TileZoom>
      <View style={styles.text}>
        <Text variant="albumName">{item.name}</Text>
        <Text variant="albumMeta" color="muted">
          {meta}
        </Text>
        <View style={styles.label}>
          {done && <Icon name="check" size={18} color={colors.success} filled />}
          <Text variant="badge" color={done ? "success" : "ctaText"}>
            {label}
          </Text>
        </View>
      </View>
      <Icon name="chevron" size={20} color={colors.muted} />
      <PressShade style={press.shadeStyle} radius={radius.albumTile} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  years: { gap: space.xl },
  year: { gap: space.m },
  card: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    padding: space.m,
    borderRadius: radius.albumTile,
  },
  text: { flex: 1, gap: space.xs },
  label: { flexDirection: "row", alignItems: "center", gap: space.xs },
});
