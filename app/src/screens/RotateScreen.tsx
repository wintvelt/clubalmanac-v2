import { useMutation } from "convex/react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
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
import { composeRotation, previewOrientation, type RotateStep } from "../lib/photoActions";
import { size, space, useTheme } from "../theme";
import { AlbumReadFailed } from "./AlbumParts";

// WP17b invariant 11: het draaischerm. Links, rechts en spiegelen werken op
// het voorbeeld; "Bewaren" stuurt ze samen als één photos.rotate en kan pas
// als er iets veranderd is. Na bewaren staat de foto zoals het voorbeeld, en
// gaat het terug naar het detail. De foto komt uit de live album-lijst: een
// ander die hem draait, verschuift het voorbeeld mee (delta, WP8); een foto
// die verdwijnt, geeft een melding.
export function RotateScreen() {
  const { groupId, albumId, photoId } = useLocalSearchParams<{
    groupId: string;
    albumId: string;
    photoId: string;
  }>();
  const gid = String(groupId) as Id<"groups">;
  const aid = String(albumId) as Id<"albums">;
  if (useAuthState() === "reconnecting") return <Screen underHeader>{null}</Screen>;
  return (
    <QueryBoundary
      key={aid}
      fallback={(error, reset) => (
        <Screen underHeader>
          <AlbumReadFailed groupId={gid} what="foto" error={error} reset={reset} />
        </Screen>
      )}
    >
      <RotateContent albumId={aid} photoId={String(photoId)} />
    </QueryBoundary>
  );
}

function RotateContent({ albumId, photoId }: { albumId: Id<"albums">; photoId: string }) {
  const entries = useLiveQuery(api.albums.listPhotos, { albumId });
  const entry = entries?.find((e) => e.albumPhoto.photoId === photoId);
  return (
    <RotateView
      photoId={entry?.albumPhoto.photoId}
      photo={entries === undefined ? undefined : (entry?.photo ?? null)}
      goneTitle="Deze foto staat niet meer in het album"
    />
  );
}

// WP17c: het draaischerm vanuit Mijn foto's. De foto komt live uit
// photos.getById; is hij weg, dan de melding van de grens.
export function MyRotateScreen() {
  const { photoId } = useLocalSearchParams<{ photoId: string }>();
  const pid = String(photoId) as Id<"photos">;
  if (useAuthState() === "reconnecting") return <Screen underHeader>{null}</Screen>;
  return (
    <QueryBoundary
      key={pid}
      fallback={() => (
        <Screen underHeader>
          <RotateView photoId={undefined} photo={null} goneTitle="Deze foto is er niet meer" />
        </Screen>
      )}
    >
      <MyRotateContent photoId={pid} />
    </QueryBoundary>
  );
}

function MyRotateContent({ photoId }: { photoId: Id<"photos"> }) {
  const photo = useLiveQuery(api.photos.getById, { photoId });
  return <RotateView photoId={photoId} photo={photo} goneTitle="Deze foto is er niet meer" />;
}

type RotatePhoto = { exifOrientation?: number; hasFormats: boolean };

// Het scherm zelf: `photo` undefined is laden, null is weg.
function RotateView({
  photoId,
  photo,
  goneTitle,
}: {
  photoId: Id<"photos"> | undefined;
  photo: RotatePhoto | null | undefined;
  goneTitle: string;
}) {
  const { colors } = useTheme();
  const rotate = useMutation(api.photos.rotate);
  const [steps, setSteps] = useState<RotateStep[]>([]);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const edit = composeRotation(steps);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || box.width !== width || box.height !== height) setBox({ width, height });
  };

  const press = (step: RotateStep) => {
    setFailed(false);
    setSteps((s) => [...s, step]);
  };

  const save = async () => {
    if (!edit || !photoId) return;
    setBusy(true);
    setFailed(false);
    try {
      await rotate({ photoId, ...edit });
      // De live stand is nu de nieuwe; zonder dit staat het voorbeeld even dubbel gedraaid.
      setSteps([]);
      router.back();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  let body;
  if (photo === undefined) {
    body = <LoadingState label="Foto laden…" />;
  } else if (!photoId || !photo) {
    body = (
      <View style={styles.column}>
        <Notice
          kind="error"
          title={goneTitle}
          message="Misschien heeft iemand hem weggehaald of verwijderd."
        />
        <Button title="Terug" variant="secondary" icon="back" onPress={() => router.back()} />
      </View>
    );
  } else {
    // Het voorbeeld: dezelfde bytes (hasFormats van de foto), met de stand na bewaren.
    const preview = {
      exifOrientation: edit ? previewOrientation(photo.exifOrientation, edit) : photo.exifOrientation,
      hasFormats: photo.hasFormats,
    };
    body = (
      <>
        <View style={styles.fill} onLayout={onLayout}>
          {box && (
            <PhotoImage
              photoId={photoId}
              format="groot"
              exifOrientation={preview.exifOrientation}
              hasFormats={preview.hasFormats}
              box={box}
              fit="contain"
              accessibilityLabel={edit ? "Voorbeeld van de gedraaide foto" : "De foto zoals hij nu staat"}
            />
          )}
        </View>
        <ScrollView
          style={[styles.controls, { borderTopColor: colors.line }]}
          contentContainerStyle={[styles.column, styles.controlsContent]}
          bounces={false}
        >
          <View style={styles.row}>
            <SmallButton title="Links" icon="rotateLeft" onPress={() => press("left")} accessibilityLabel="Een kwartslag naar links" />
            <SmallButton title="Spiegelen" icon="mirror" onPress={() => press("mirror")} accessibilityLabel="Links en rechts spiegelen" />
            <SmallButton title="Rechts" icon="rotateRight" onPress={() => press("right")} accessibilityLabel="Een kwartslag naar rechts" />
          </View>
          {!edit && (
            <Text variant="meta" color="muted">
              Draai of spiegel de foto. Daarna kun je bewaren.
            </Text>
          )}
          <Button title="Bewaren" busy={busy} busyTitle="Bewaren…" disabled={!edit} onPress={() => void save()} />
          {failed && (
            <Notice kind="error" title="Helaas, dat lukte niet" message="Er is niets veranderd. Probeer het later opnieuw." />
          )}
        </ScrollView>
      </>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title: "Draaien" }} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    gap: space.m,
  },
  controls: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  controlsContent: { paddingVertical: space.l },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
});
