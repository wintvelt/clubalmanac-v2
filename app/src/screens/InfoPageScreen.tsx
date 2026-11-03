import { StyleSheet, View } from "react-native";
import { Screen } from "../components/Screen";
import { Text } from "../components/Text";
import { INFO_TEXTS, type InfoBlock } from "../content/infoTexts";
import type { InfoSlug } from "../lib/infoPages";
import { space } from "../theme";
import { AppIdentity } from "./InfoList";

// WP15b: één Info-pagina, op twee routes (/instellingen/<slug> en
// /info/<slug>). Alleen vaste tekst, niets uit de sessie (invariant 11).
export function InfoPageScreen({ slug }: { slug: InfoSlug }) {
  return (
    <Screen underHeader>
      {slug === "over" && <AppIdentity />}
      {INFO_TEXTS[slug].map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </Screen>
  );
}

function Block({ block }: { block: InfoBlock }) {
  switch (block.kind) {
    case "heading":
      return (
        <Text variant="emptyTitle" accessibilityRole="header">
          {block.text}
        </Text>
      );
    case "paragraph":
      return (
        <Text>
          {block.lead && <Text style={styles.lead}>{block.lead}</Text>}
          {block.lead && block.text ? " " : ""}
          {block.text}
        </Text>
      );
    case "bullets":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text accessible={false}>•</Text>
              <Text style={styles.itemText}>{item}</Text>
            </View>
          ))}
        </View>
      );
  }
}

const styles = StyleSheet.create({
  lead: { fontStyle: "italic" },
  list: { gap: space.s },
  item: { flexDirection: "row", gap: space.s },
  itemText: { flex: 1 },
});
