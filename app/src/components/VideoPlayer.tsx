import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../convexApi";
import { withOneRetry } from "../lib/actionRetry";
import { formatDuration, linkExpired, videoPlayerSource } from "../lib/videos";
import { photoLayers, radius, space } from "../theme";
import { Icon } from "./Icon";
import { Notice } from "./Notice";
import { PhotoImage } from "./Photo";
import { SmallButton } from "./SmallButton";
import { LoadingState } from "./States";
import { Text } from "./Text";

// WP37: een filmpje in het detail (album en Mijn foto's), op iOS, iPad en het
// web (expo-video speelt daar met een `<video>`).
//
// - Eerst de poster met een afspeelteken en de duur; geen autoplay (A-keuze).
//   Pas bij een tik haalt de app een afspeellink (`videos.playUrl`, 1 uur,
//   per verzoek opnieuw getoetst, A-invariant 17).
// - Geen filmpje op schijf (A-invariant 23): `useCaching: false`, geen download.
// - Weg-vegen stopt het filmpje (`active` false: pauzeren).
// - Een fout (verlopen link, netwerk) geeft een NL-melding met opnieuw
//   proberen; dat haalt een verse link en gaat verder waar de kijker was.

type Phase = "poster" | "loading" | "playing" | "error" | "refused";

type VideoPhoto = {
  exifOrientation?: number;
  hasFormats: boolean;
  video?: { durationMs: number };
};

function isRefusal(error: unknown): boolean {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    (error.data as { code?: unknown }).code === "VIDEO_NOT_FOUND"
  );
}

export function VideoPage({
  photoId,
  photo,
  box,
  active,
  label,
  memoryOnly,
  onFullscreenExit,
}: {
  photoId: Id<"photos">;
  photo: VideoPhoto;
  box: { width: number; height: number };
  /** Staat deze pagina in beeld? Anders pauzeren. */
  active: boolean;
  label: string;
  /** De poster niet op schijf (de wachtrij van de webmaster, WP20 besluit 10). */
  memoryOnly?: boolean;
  /** WP46: terug uit het volledig scherm van de speler (de statusbalk van het detail). */
  onFullscreenExit?: () => void;
}) {
  const getLink = useAction(api.videos.playUrl);
  const [phase, setPhase] = useState<Phase>("poster");
  const link = useRef<{ url: string; expiresAt: number } | null>(null);
  const position = useRef(0);
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1;
  });

  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  useEffect(() => {
    const status = player.addListener("statusChange", ({ status: next }) => {
      if (next === "error") {
        player.pause();
        setPhase("error");
      }
    });
    const time = player.addListener("timeUpdate", ({ currentTime }) => {
      if (Number.isFinite(currentTime) && currentTime > 0) position.current = currentTime;
    });
    return () => {
      status.remove();
      time.remove();
    };
  }, [player]);

  const play = async () => {
    setPhase("loading");
    try {
      if (!link.current || linkExpired(link.current, Date.now())) {
        link.current = await withOneRetry(() => getLink({ photoId }));
      }
      await player.replaceAsync(videoPlayerSource(link.current));
      if (position.current > 0) player.currentTime = position.current;
      setPhase("playing");
      player.play();
    } catch (error) {
      link.current = null;
      setPhase(isRefusal(error) ? "refused" : "error");
    }
  };

  const retry = () => {
    // Een fout kan een verlopen link zijn: altijd een verse.
    link.current = null;
    void play();
  };

  return (
    <View style={[box, styles.wrap]}>
      {phase === "playing" ? (
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, Platform.OS === "web" && styles.webFill]}
          nativeControls
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          onFullscreenExit={onFullscreenExit}
          allowsPictureInPicture={false}
        />
      ) : (
        <Pressable
          onPress={phase === "poster" ? () => void play() : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Afspelen`}
          style={box}
        >
          <PhotoImage
            photoId={photoId}
            format="groot"
            exifOrientation={photo.exifOrientation}
            hasFormats={photo.hasFormats}
            box={box}
            fit="contain"
            neutralLoading
            memoryOnly={memoryOnly}
          />
          {phase === "poster" && (
            <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
              <View style={styles.playButton}>
                <View style={[StyleSheet.absoluteFill, styles.playLayer]} />
                <Icon name="play" size={56} color={photoLayers.text} filled />
              </View>
              {photo.video && (
                <Text variant="bodyStrong" style={styles.duration}>
                  {formatDuration(photo.video.durationMs)}
                </Text>
              )}
            </View>
          )}
          {phase === "loading" && (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <LoadingState label="Filmpje laden…" />
            </View>
          )}
        </Pressable>
      )}
      {(phase === "error" || phase === "refused") && (
        <View style={styles.notice}>
          {phase === "refused" ? (
            <Notice kind="error" title="Dit filmpje is niet beschikbaar" message="Misschien staat het er niet meer." />
          ) : (
            <Notice kind="error" message="Het filmpje laden lukt nu niet. Controleer je verbinding en probeer het opnieuw.">
              <SmallButton title="Opnieuw proberen" icon="refresh" onPress={retry} />
            </Notice>
          )}
        </View>
      )}
    </View>
  );
}

/** Het afspeelteken en de duur op een tegel (besluit 1); geen afspeelteken op een cover. */
export function VideoBadge({ durationMs }: { durationMs: number }) {
  return (
    <View style={styles.badge} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[StyleSheet.absoluteFill, styles.playLayer]} />
      <Icon name="play" size={14} color={photoLayers.text} filled />
      <Text variant="albumMeta" style={styles.badgeText} maxFontSizeMultiplier={1.3}>
        {formatDuration(durationMs)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: "#000", overflow: "hidden" },
  center: { alignItems: "center", justifyContent: "center", gap: space.s },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  playLayer: { backgroundColor: photoLayers.pill.color, opacity: photoLayers.pill.opacity },
  duration: { color: photoLayers.text },
  notice: { position: "absolute", left: space.m, right: space.m, bottom: space.m },
  // Op het web is `<video>` een replaced element: zonder maat krijgt hij zijn eigen maat.
  webFill: { width: "100%", height: "100%" },
  badge: {
    position: "absolute",
    left: space.xs,
    bottom: space.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: space.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  badgeText: { color: photoLayers.text, fontWeight: "700" },
});
