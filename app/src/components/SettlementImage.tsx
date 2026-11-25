import { Image } from "expo-image";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSettlementImageLoad } from "../data/images";
import { settlementTile, type SettlementImageInfo } from "../lib/settlements";
import { useTheme } from "../theme";

// WP41c besluit 5, C6: de foto van een afrekening, via het beeldpad met het
// Clerk-token (`useSettlementImageLoad`). Welke tegel: `settlementTile`.
// Zonder foto, of als de foto van deze versie niet laadt: `fallback` (de
// letter in de tijdlijn, niets bovenaan het overzicht). Een nieuwe versie
// bouwt de foto opnieuw op (key) en probeert het opnieuw.
// Tijdens het laden een leeg vlak, geen letter die daarna wegspringt.

type Box = { width: number; height: number };

export function SettlementImage({
  settlementId,
  name,
  image,
  box,
  radius = 0,
  fallback = null,
}: {
  settlementId: string;
  name: string;
  image: SettlementImageInfo;
  box: Box;
  radius?: number;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const tile = settlementTile(image, failed);
  if (tile.kind === "letter") return <>{fallback}</>;
  return (
    <SettlementPhoto
      key={tile.version}
      settlementId={settlementId}
      version={tile.version}
      name={name}
      box={box}
      radius={radius}
      fallback={fallback}
      onFail={setFailed}
    />
  );
}

function SettlementPhoto({
  settlementId,
  version,
  name,
  box,
  radius,
  fallback,
  onFail,
}: {
  settlementId: string;
  version: string;
  name: string;
  box: Box;
  radius: number;
  fallback: ReactNode;
  onFail: (version: string) => void;
}) {
  const { colors } = useTheme();
  // Na een fout één nieuwe poging met een vers token (src/lib/imageRetry.ts);
  // daarna `source === null`.
  const { source, attempt, onError } = useSettlementImageLoad(settlementId, version);
  const failed = source === null;
  useEffect(() => {
    if (failed) onFail(version);
  }, [failed, version, onFail]);
  if (failed) return <>{fallback}</>;
  return (
    <View
      style={[box, { borderRadius: radius, overflow: "hidden", backgroundColor: colors.line }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Foto van ${name}`}
    >
      {source && (
        <Image
          key={attempt}
          source={source}
          // Alleen in het geheugen: de toegang eindigt bij vertrek uit de groep.
          cachePolicy="memory"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          accessible={false}
          onError={onError}
        />
      )}
    </View>
  );
}
