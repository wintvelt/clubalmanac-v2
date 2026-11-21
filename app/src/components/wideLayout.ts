import { Platform, useWindowDimensions } from "react-native";
import { wideOnIOS } from "../lib/wideLayout";

// De brede layout van Groep en Album (src/lib/wideLayout.ts): op iOS alleen
// een liggende iPad. Volgt het venster. Web: wideLayout.web.ts.
export function useWideLayout(): boolean {
  const { width, height } = useWindowDimensions();
  return wideOnIOS({ isPad: Platform.OS === "ios" && Platform.isPad, width, height });
}
