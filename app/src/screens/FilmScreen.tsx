import { router, Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useLiveQuery } from "../data/useLiveQuery";
import { groupPath } from "../lib/groupRoutes";
import { space } from "../theme";
import { FilmPlayer } from "./FilmPlayer";

// WP21: het filmscherm (pariteit: een eigen scherm onder de groep). De titel
// komt uit de live lijst; staat de film daar niet (meer) in, bijvoorbeeld na
// het verlaten van de groep, dan verdwijnt de speler meteen en volgt een
// melding (invariant 8). De speler zelf staat in FilmPlayer: dit bestand
// leest de lijst en laadt geen speler-module (invariant 6).
export function FilmScreen() {
  const { groupId, filmId } = useLocalSearchParams<{ groupId: string; filmId: string }>();
  const films = useLiveQuery(api.films.list, {});
  const film = films?.find((f) => f._id === filmId);

  if (films === undefined) {
    return (
      <Screen underHeader>
        <LoadingState label="Film laden…" />
      </Screen>
    );
  }
  if (!film) return <FilmGone groupId={String(groupId)} />;

  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: film.title }} />
      <FilmPlayer filmId={film._id} title={film.title} />
      <View style={styles.meta}>
        <Text variant="title" accessibilityRole="header">
          {film.title}
        </Text>
        <Text variant="meta" color="muted">
          {film.kind === "trailer" ? `Trailer · ${film.year}` : String(film.year)}
        </Text>
      </View>
    </Screen>
  );
}

function FilmGone({ groupId }: { groupId: string }) {
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: "Film" }} />
      <Notice
        kind="error"
        title="Deze film is niet beschikbaar"
        message="Misschien ben je geen lid meer van de groep, of staat de film er niet meer."
      />
      <Button title="Terug naar de groep" icon="back" onPress={() => (router.canGoBack() ? router.back() : router.replace(groupPath(groupId)))} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { gap: space.xs, paddingTop: space.m },
});
