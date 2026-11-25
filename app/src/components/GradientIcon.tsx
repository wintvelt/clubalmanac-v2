import MaskedViewNative from "@react-native-masked-view/masked-view";
import type { ComponentType, ReactElement } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useTheme } from "../theme";
import { Gradient } from "./Gradient";
import { Icon, type IconName } from "./Icon";

type Props = { name: IconName; size: number };

// De types van masked-view 0.3.2 leunen op `NativeMethods` uit de oude
// React Native-types; met RN 0.88 is de klasse daardoor geen geldig
// JSX-component voor TypeScript. Zelfde props, alleen het type.
const MaskedView = MaskedViewNative as unknown as ComponentType<ViewProps & { maskElement: ReactElement }>;

// WP38 (feedback Wouter, derde ronde): een icoon in het merkverloop, van
// `gradStart` naar `gradEnd`, schuin (135°), met de stops van Gradient. Op iOS
// en Android maskeert de glyph het verloop (`@react-native-masked-view`); de
// web-variant staat in GradientIcon.web.tsx (CSS `background-clip: text`).
// Decoratief: de titel ernaast zegt wat het is.
export function GradientIcon({ name, size }: Props) {
  const { colors } = useTheme();
  return (
    <MaskedView
      style={{ width: size, height: size }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      maskElement={
        <View style={styles.center}>
          <Icon name={name} size={size} color="#000000" />
        </View>
      }
    >
      <View style={styles.fill}>
        <Gradient from={colors.gradStart} to={colors.gradEnd} angle={135} />
      </View>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  fill: { flex: 1 },
});
