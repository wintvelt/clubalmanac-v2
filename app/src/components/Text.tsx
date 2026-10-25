import { Text as RNText, type TextProps } from "react-native";
import { typography, useTheme, type ColorTokens, type TypeRoleName } from "../theme";

type Props = TextProps & { variant?: TypeRoleName; color?: keyof ColorTokens };

// Alle tekst loopt hierdoor: rol en kleur komen uit de tokens. De grens op de
// tekstgrootte zit alleen in de rollen die hem hebben (tabbalk-labels).
export function Text({ variant = "body", color = "text", style, ...rest }: Props) {
  const { colors } = useTheme();
  const t = typography[variant];
  return (
    <RNText
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
