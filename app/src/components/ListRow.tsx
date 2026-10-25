import { Children, Fragment, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { radius, size, space, useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

type RowProps = {
  title: string;
  onPress: () => void;
  icon?: IconName;
  // Gevaarlijke rij (Account verwijderen): in `danger`, in een eigen blok.
  danger?: boolean;
  // Uit voor een rij die niet naar een ander scherm gaat, zoals Uitloggen.
  chevron?: boolean;
};

export function ListRow({ title, onPress, icon, danger = false, chevron = !danger }: RowProps) {
  const { colors } = useTheme();
  const tint = danger ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.line }]}
    >
      {icon && <Icon name={icon} color={tint} />}
      <Text variant="listRow" style={[styles.title, danger && { color: colors.danger }]}>
        {title}
      </Text>
      {chevron && <Icon name="chevron" size={20} color={colors.muted} />}
    </Pressable>
  );
}

// Lijstblok zoals iOS-Instellingen: rijen op `surface` met een lijn ertussen.
export function ListSection({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={[styles.separator, { backgroundColor: colors.line }]} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: radius.listBlock, overflow: "hidden" },
  row: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  title: { flex: 1 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space.l },
});
