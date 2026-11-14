import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { useInviteCoverLoad } from "../data/images";
import { orientationTransform } from "../lib/photos";
import { radius, useTheme } from "../theme";
import { LetterTile } from "./LetterTile";

// WP19b A-invariant 15: de groepsfoto via het beeldpad van de genodigde. Lukt
// het laden niet, dan de lettertegel. Alleen in het geheugen: de toegang
// eindigt met de uitnodiging.
//
// WP19c besluit 4, A-invariant 12: het pad geeft *klein*, ruwe pixels zonder
// tag. `listReceived` geeft de stand (`group.coverOrientation`); het beeld
// draait daarmee zoals `ProfileAvatar`. Het vak is vierkant, dus een
// kwartslag past zonder het vak te wisselen.

const COVER = 64;

export function InviteCover({
  inviteId,
  name,
  exifOrientation,
}: {
  inviteId: string;
  name: string;
  exifOrientation?: number;
}) {
  const { source, attempt, onError } = useInviteCoverLoad(inviteId, "klein");
  const { colors } = useTheme();
  if (source === null) return <LetterTile name={name} size={COVER} radius={radius.albumTile} />;
  return (
    <View
      style={[styles.cover, { backgroundColor: colors.line }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Groepsfoto van ${name}`}
    >
      {source && (
        <Image
          key={attempt}
          source={source}
          cachePolicy="memory"
          style={[StyleSheet.absoluteFill, { transform: orientationTransform(exifOrientation) }]}
          contentFit="cover"
          accessible={false}
          onError={onError}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { width: COVER, height: COVER, borderRadius: radius.albumTile, overflow: "hidden" },
});
