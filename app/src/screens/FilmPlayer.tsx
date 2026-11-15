import { useAction } from "convex/react";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useReducer, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice } from "../components/Notice";
import { SmallButton } from "../components/SmallButton";
import { LoadingState } from "../components/States";
import { api } from "../convexApi";
import {
  filmErrorMessage,
  filmVideoSource,
  initialPlayback,
  isFilmRefusal,
  playbackReducer,
} from "../lib/films";
import { radius, space } from "../theme";

// WP21: de speler van één film, met de standaard-speler van iOS (volledig
// scherm, spoelen, AirPlay). Alleen op het filmscherm: de lijst heeft geen
// speler (invariant 6).
//
// - Elke poging haalt een verse link van 3 uur (`films.videoUrl`); de backend
//   controleert de toegang per verzoek (invariant 8).
// - De film streamt van S3 met range-verzoeken; `useCaching: false`, en geen
//   download: er komt geen film op de telefoon (invariant 6, A-invariant 15).
// - Mislukt de link of het afspelen (verlopen link, netwerk, S3), dan een
//   NL-melding met opnieuw proberen; dat haalt een verse link en gaat verder
//   waar de kijker was (invariant 5, A-invariant 14).

type Failure = "link" | "playback" | "refused";

export function FilmPlayer({ filmId, title }: { filmId: Id<"films">; title: string }) {
  const getLink = useAction(api.films.videoUrl);
  const [state, dispatch] = useReducer(playbackReducer, initialPlayback);
  const [failure, setFailure] = useState<Failure>("link");
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1;
  });
  // De plek waar de speler naartoe moet zodra hij klaar is (na opnieuw proberen).
  const pendingSeek = useRef<number | null>(null);
  const position = useRef(0);
  position.current = state.position;

  // Een verse link per poging.
  useEffect(() => {
    let alive = true;
    getLink({ filmId })
      .then(async ({ url }) => {
        if (!alive) return;
        pendingSeek.current = position.current > 0 ? position.current : null;
        await player.replaceAsync(filmVideoSource(url, title));
        if (!alive) return;
        // Al klaar voordat de statusChange kwam: meteen naar de oude plek.
        if (pendingSeek.current !== null && player.status === "readyToPlay") {
          player.currentTime = pendingSeek.current;
          pendingSeek.current = null;
        }
        dispatch({ type: "linkReady" });
        player.play();
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setFailure(isFilmRefusal(error) ? "refused" : "link");
        dispatch({ type: "failed" });
      });
    return () => {
      alive = false;
    };
    // Alleen een nieuwe poging haalt een nieuwe link (niet een nieuwe titel of speler).
  }, [state.attempt, filmId]);

  useEffect(() => {
    const status = player.addListener("statusChange", ({ status: next }) => {
      if (next === "readyToPlay" && pendingSeek.current !== null) {
        player.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
      if (next === "error") {
        player.pause();
        setFailure("playback");
        dispatch({ type: "failed" });
      }
    });
    const time = player.addListener("timeUpdate", ({ currentTime }) => {
      // Tot de sprong naar de oude plek gedaan is, telt de voortgang niet.
      if (pendingSeek.current === null) dispatch({ type: "progress", seconds: currentTime });
    });
    return () => {
      status.remove();
      time.remove();
    };
  }, [player]);

  return (
    <View style={styles.wrap}>
      <View style={styles.video}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture={false}
        />
        {state.phase === "loading" && (
          <View style={styles.overlay}>
            <LoadingState label="Film laden…" />
          </View>
        )}
      </View>
      {state.phase === "error" && <FailureNotice failure={failure} onRetry={() => dispatch({ type: "retry" })} />}
    </View>
  );
}

function FailureNotice({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  if (failure === "refused") {
    return (
      <Notice
        kind="error"
        title="Deze film is niet beschikbaar"
        message="Misschien ben je geen lid meer van de groep, of staat de film er niet meer."
      />
    );
  }
  const message = filmErrorMessage(failure);
  return (
    <Notice kind="error" message={message.text}>
      <SmallButton title={message.retryLabel} icon="refresh" onPress={onRetry} />
    </Notice>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.m },
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.albumTile,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
