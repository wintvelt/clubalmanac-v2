import { Image, type ImageContentFit } from "expo-image";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useProfileSource, usePhotoLoad } from "../data/images";
import type { ImageFormat } from "../lib/imageUrls";
import { orientationTransform, swapsAspect } from "../lib/photos";
import { photoLayers, useTheme } from "../theme";
import { Icon } from "./Icon";
import { LetterTile } from "./LetterTile";
import type { TypeRoleName } from "../theme";

// WP17a: beelden uit het beeldpad. Elk beeld staat rechtop volgens
// `exifOrientation` uit Convex (invariant 4, WP8 §Frontend-contract).

type Box = { width: number; height: number };

// Het beeld gedraaid binnen een vak. Bij een kwartslag krijgt het beeld de
// omgekeerde maten, zodat het na draaien het vak precies vult.
function Oriented({
  box,
  exifOrientation,
  children,
}: {
  box: Box;
  exifOrientation: number | undefined;
  children: (inner: Box) => ReactNode;
}) {
  const swap = swapsAspect(exifOrientation);
  const inner = swap ? { width: box.height, height: box.width } : box;
  return (
    <View style={[box, styles.clip]}>
      <View
        style={[
          inner,
          {
            position: "absolute",
            left: (box.width - inner.width) / 2,
            top: (box.height - inner.height) / 2,
            transform: orientationTransform(exifOrientation),
          },
        ]}
      >
        {children(inner)}
      </View>
    </View>
  );
}

type PhotoProps = {
  photoId: string;
  format: ImageFormat;
  exifOrientation?: number;
  // WP25 A-invariant 26: `hasFormats` van hetzelfde object als
  // `exifOrientation`. Zonder formaten geeft het beeldpad het origineel; dat
  // gaat niet op schijf. Ontbreekt het, dan geldt false.
  hasFormats?: boolean;
  box: Box;
  fit?: ImageContentFit;
  radius?: number;
  // Wat er staat als het beeld niet laadt. Zonder: een rustige fout-toestand
  // met "opnieuw laden" (design.md §6, pariteit Album).
  fallback?: ReactNode;
  // Voor VoiceOver; zonder is het beeld decoratief.
  accessibilityLabel?: string;
};

// Een foto, een album- of een groepscover. Tot het beeld er is: een grijs vlak
// met een beeld-icoon.
export function PhotoImage({
  photoId,
  format,
  exifOrientation,
  hasFormats,
  box,
  fit = "cover",
  radius = 0,
  fallback,
  accessibilityLabel,
}: PhotoProps) {
  const { colors } = useTheme();
  const [state, setState] = useState<"loading" | "loaded">("loading");
  // Invariant 18: na een fout één nieuwe poging met een vers token, daarna
  // terugvallen (de fout-tegel, of `fallback`). Zie src/lib/imageRetry.ts.
  const withFormats = hasFormats === true;
  const { source, attempt, onError, retry } = usePhotoLoad(photoId, format, withFormats);
  const failed = source === null;

  if (failed && fallback !== undefined) return <>{fallback}</>;

  return (
    <View
      style={[
        box,
        // Grijs zolang het laadt; daarna niets, zodat een passend beeld (detail)
        // geen grijze balken krijgt.
        { borderRadius: radius, overflow: "hidden", backgroundColor: state === "loaded" ? "transparent" : colors.line },
      ]}
      accessible={accessibilityLabel !== undefined}
      accessibilityRole={accessibilityLabel !== undefined ? "image" : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {source ? (
        <Oriented box={box} exifOrientation={exifOrientation}>
          {(inner) => (
            <Image
              // Wisselt hasFormats, dan bouwt het beeld opnieuw op: bytes en stand samen.
              key={`${attempt}-${withFormats ? "formaat" : "origineel"}`}
              source={source}
              // Met formaten de schijfcache (invariant 1); het origineel alleen in het geheugen.
              cachePolicy={withFormats ? undefined : "memory"}
              style={inner}
              contentFit={fit}
              recyclingKey={photoId}
              transition={150}
              accessible={false}
              onLoad={() => setState("loaded")}
              onError={onError}
            />
          )}
        </Oriented>
      ) : null}
      {state === "loading" && !failed && (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Icon name="photos" size={Math.min(28, box.width / 3)} color={colors.muted} />
        </View>
      )}
      {failed && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Foto laden lukt niet. Opnieuw laden"
          onPress={() => {
            setState("loading");
            retry();
          }}
          style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.surface }]}
        >
          <Icon name="refresh" size={Math.min(28, box.width / 3)} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

type AvatarProps = {
  userId: string | null | undefined;
  name: string | null | undefined;
  size: number;
  format?: ImageFormat;
  variant?: TypeRoleName;
  // WP25 A-invariant 19: `profileOrientation` uit de user-vorm. Het profielpad
  // geeft *klein* met ruwe pixels; de avatar draait ze zoals Photo.
  exifOrientation?: number;
  // WP25 A-invariant 26: `profileHasFormats` van hetzelfde object. Wisselt het,
  // dan bouwt het beeld opnieuw op (de stand alleen laadt geen nieuwe bytes).
  hasFormats?: boolean;
};

// Profielfoto, rond. Geen profielfoto, een gewist beeld of een fout: de
// letter, zonder fout-toestand (invariant 14). Decoratief: de rij eromheen
// draagt de naam. Openbaar (besluit 8), en zonder cache (invariant 3, audit
// S6): dezelfde URL geeft na een wissel een ander beeld.
export function ProfileAvatar({
  userId,
  name,
  size,
  format = "klein",
  variant = "bodyStrong",
  exifOrientation,
  hasFormats,
}: AvatarProps) {
  const letter = <LetterTile name={name} size={size} radius={size / 2} variant={variant} />;
  if (!userId) return letter;
  return (
    <ProfileImage
      userId={userId}
      size={size}
      format={format}
      letter={letter}
      exifOrientation={exifOrientation}
      hasFormats={hasFormats === true}
    />
  );
}

function ProfileImage({
  userId,
  size,
  format,
  letter,
  exifOrientation,
  hasFormats,
}: {
  userId: string;
  size: number;
  format: ImageFormat;
  letter: ReactNode;
  exifOrientation: number | undefined;
  hasFormats: boolean;
}) {
  const source = useProfileSource(userId, format);
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  if (source === null || state === "failed") return <>{letter}</>;
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      {state === "loading" && <View style={StyleSheet.absoluteFill}>{letter}</View>}
      <Image
        key={hasFormats ? "formaat" : "origineel"}
        source={source}
        // Rond en vierkant: draaien verandert de maat niet, dus geen Oriented-box.
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: orientationTransform(exifOrientation),
        }}
        contentFit="cover"
        cachePolicy="none"
        recyclingKey={userId}
        accessible={false}
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
      />
    </View>
  );
}

// De scrim over een cover-foto (design.md §2, photoLayers.coverScrim): zwart
// van boven naar onder, zodat de statusbalk en de terugknop-pil leesbaar zijn.
export function CoverScrim({ height }: { height: number }) {
  const { top, at100, bottom } = photoLayers.coverScrim;
  const at = Math.min(1, 100 / Math.max(height, 1));
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000000" stopOpacity={top} />
          <Stop offset={at} stopColor="#000000" stopOpacity={at100} />
          <Stop offset={1} stopColor="#000000" stopOpacity={bottom} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#scrim)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  center: { alignItems: "center", justifyContent: "center" },
});
