import { useWindowDimensions } from "react-native";
import { WIDE_FROM } from "../lib/wideLayout";

// WP35: op het web vanaf WIDE_FROM px de brede layout (zijkolom + inhoud).
// Volgt het venster: smaller maken schakelt terug.
export function useWideLayout(): boolean {
  return useWindowDimensions().width >= WIDE_FROM;
}
