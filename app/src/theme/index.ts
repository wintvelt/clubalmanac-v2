import { useColorScheme } from "react-native";
import { colors, type ColorScheme, type ColorTokens } from "./tokens";

export * from "./tokens";

export type Theme = { scheme: ColorScheme; colors: ColorTokens };

// Volgt de iOS-modus, ook als de user wisselt terwijl de app open is
// (invariant 3). app.json zet userInterfaceStyle op "automatic".
export function useTheme(): Theme {
  const scheme: ColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, colors: colors[scheme] };
}
