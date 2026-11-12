import { useMutation } from "convex/react";
import { Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import MapView, { Marker, type MapPressEvent, type MarkerDragStartEndEvent } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { PhotoImage } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useLiveQuery } from "../data/useLiveQuery";
import { MIDDLE_NL, spotRegion, type Point } from "../lib/placeShare";
import { size, space, useTheme } from "../theme";

// WP17d besluit 3: "Locatie wijzigen" van een eigen foto. De foto staat als
// speld op de kaart; slepen of op de kaart tikken verplaatst hem. "Opslaan"
// stuurt de plek naar photos.setLocation; de plaatsnaam maakt de backend
// (Photon). "Locatie weghalen" wist plek en plaatsnaam, na een bevestiging.
// Zonder plek staat de speld in midden-Nederland. Geen locatie van het
// toestel (A-invariant 7). Hetzelfde scherm in een album en in Mijn foto's.
export function LocationScreen() {
  const { photoId } = useLocalSearchParams<{ photoId: string }>();
  const pid = String(photoId) as Id<"photos">;
  if (useAuthState() === "reconnecting") return <Screen underHeader>{null}</Screen>;
  return (
    <QueryBoundary
      key={pid}
      fallback={() => (
        <Screen underHeader>
          <View style={styles.column}>
            <Notice
              kind="error"
              title="Deze foto kun je niet wijzigen"
              message="De foto is er niet meer, of hij is niet van jou."
            />
          </View>
        </Screen>
      )}
    >
      <LocationContent photoId={pid} />
    </QueryBoundary>
  );
}

type Feedback = { kind: "error" | "success"; title: string; message?: string };

const FAILED: Feedback = {
  kind: "error",
  title: "Opslaan helaas niet gelukt",
  message: "Er is niets veranderd. Probeer het later opnieuw.",
};

function LocationContent({ photoId }: { photoId: Id<"photos"> }) {
  const saved = useLiveQuery(api.photos.getLocation, { photoId });
  const photo = useLiveQuery(api.photos.getById, { photoId });
  if (saved === undefined || photo === undefined) return <LoadingState label="Kaart laden…" />;
  return <LocationEditor photoId={photoId} saved={saved} photo={photo} />;
}

function LocationEditor({
  photoId,
  saved,
  photo,
}: {
  photoId: Id<"photos">;
  saved: Point | null;
  photo: { exifOrientation?: number; hasFormats: boolean };
}) {
  const { colors } = useTheme();
  const setLocation = useMutation(api.photos.setLocation);
  const map = useRef<MapView>(null);
  const [pin, setPin] = useState<Point>(() => saved ?? { latitude: MIDDLE_NL.latitude, longitude: MIDDLE_NL.longitude });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const changed = saved === null || saved.latitude !== pin.latitude || saved.longitude !== pin.longitude;

  const move = (p: Point) => {
    setFeedback(null);
    setPin(p);
  };

  const run = async (location: Point | null, done: Feedback): Promise<boolean> => {
    setBusy(true);
    setFeedback(null);
    try {
      await setLocation({ photoId, location });
      setFeedback(done);
      return true;
    } catch {
      setFeedback(FAILED);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert(
      "Locatie weghalen?",
      "De plek en de plaatsnaam gaan weg bij deze foto. Hij staat dan niet meer op de kaart.",
      [
        { text: "Annuleren", style: "cancel" },
        {
          text: "Weghalen",
          style: "destructive",
          onPress: () => {
            void run(null, { kind: "success", title: "Locatie is weggehaald" }).then((ok) => {
              if (!ok) return;
              // Zonder plek staat de speld weer in midden-Nederland; de kaart gaat mee.
              setPin({ latitude: MIDDLE_NL.latitude, longitude: MIDDLE_NL.longitude });
              map.current?.animateToRegion(MIDDLE_NL, 300);
            });
          },
        },
      ],
    );

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title: "Locatie wijzigen" }} />
      <MapView
        ref={map}
        style={styles.fill}
        initialRegion={saved ? spotRegion(saved) : MIDDLE_NL}
        onPress={(e: MapPressEvent) => move(e.nativeEvent.coordinate)}
        showsPointsOfInterests={false}
        accessibilityLabel="Kaart. Tik op de plek van de foto, of sleep de speld."
      >
        <Marker
          coordinate={pin}
          draggable
          onDragEnd={(e: MarkerDragStartEndEvent) => move(e.nativeEvent.coordinate)}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges
          accessibilityLabel="Speld van de foto"
        >
          <View style={styles.pinWrap}>
            <View style={[styles.pinPhoto, { borderColor: colors.surface, backgroundColor: colors.line }]}>
              <PhotoImage
                photoId={photoId}
                format="klein"
                exifOrientation={photo.exifOrientation}
                hasFormats={photo.hasFormats}
                box={{ width: PIN, height: PIN }}
                radius={8}
              />
            </View>
            <View style={[styles.pinTail, { borderTopColor: colors.surface }]} />
          </View>
        </Marker>
      </MapView>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
        <View style={styles.column}>
          <Text variant="albumMeta" color="muted">
            {saved ? "Sleep de speld, of tik op de kaart." : "Deze foto heeft nog geen locatie. Sleep de speld, of tik op de kaart."}
          </Text>
          {feedback && <Notice kind={feedback.kind} title={feedback.title} message={feedback.message} />}
          <Button
            title="Opslaan"
            onPress={() => void run(pin, { kind: "success", title: "Locatie is bijgewerkt" })}
            busy={busy}
            busyTitle="Opslaan…"
            disabled={!changed}
          />
          <View style={styles.row}>
            <SmallButton
              title="Naar de foto"
              icon="pin"
              onPress={() => map.current?.animateToRegion(spotRegion(pin), 300)}
            />
            {saved ? <SmallButton title="Locatie weghalen" icon="trash" tone="danger" disabled={busy} onPress={remove} /> : null}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const PIN = 52;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.m },
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    gap: space.m,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  pinWrap: { alignItems: "center" },
  pinPhoto: { width: PIN + 6, height: PIN + 6, borderRadius: 11, borderWidth: 3, overflow: "hidden" },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
});
