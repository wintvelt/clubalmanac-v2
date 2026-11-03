import { Text as RNText, useWindowDimensions, type TextProps } from "react-native";
import { typography, useTheme, type ColorTokens, type TypeRoleName } from "../theme";

type Props = TextProps & { variant?: TypeRoleName; color?: keyof ColorTokens };

// Alle tekst loopt hierdoor: rol en kleur komen uit de tokens. De grens op de
// tekstgrootte zit alleen in de rollen die hem hebben (tabbalk-labels).
//
// De key op fontScale is nodig (WP15b F2): React Native bewaart per tekst de
// opgemaakte tekst met de vergroting van de eerste opmaak. Wisselt de user de
// tekstgrootte terwijl de app open is, dan meet RN opnieuw met die oude tekst,
// en valt tekst rechts weg in plaats van door te lopen. Een nieuwe key geeft
// een nieuwe tekst-node, die met de nieuwe vergroting gemeten wordt.
export function Text({ variant = "body", color = "text", style, ...rest }: Props) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const t = typography[variant];
  return (
    <RNText
      key={fontScale}
      maxFontSizeMultiplier={"maxFontSizeMultiplier" in t ? t.maxFontSizeMultiplier : undefined}
      style={[
        {
          fontSize: t.fontSize,
          fontWeight: "fontWeight" in t ? t.fontWeight : undefined,
          fontFamily: "fontFamily" in t ? t.fontFamily : undefined,
          color: colors[color],
        },
        style,
      ]}
      {...rest}
    />
  );
}
