import { useAction } from "convex/react";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Gradient } from "../components/Gradient";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { SmallButton } from "../components/SmallButton";
import { EmptyState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { coverSource, filmErrorMessage, filmSections, type FilmListItem } from "../lib/films";
import { filmPath } from "../lib/groupRoutes";
import { radius, space, useTheme } from "../theme";

// WP21: de tab Films van een groep. Een lijst met covers onder de kopjes
// "Trailers" en "Blockbusters" (pariteit). Hier staat geen speler: de lijst
// speelt niets vanzelf af en laadt geen film vooruit (invariant 6). Een tik op
// een tegel opent het filmscherm, dat meteen start.
//
// Een cover komt via een korte ondertekende link (`films.coverUrl`) en gaat in
// de cache van expo-image onder een vaste sleutel per film (A-invariant 15),
// zodat dezelfde cover niet elke keer opnieuw uit S3 komt. Zonder cover, of als
// hij niet laadt, een nette tegel (invariant 7); een mislukte cover geeft één
// melding met opnieuw proberen (invariant 5).

export function FilmsTab({ groupId, films }: { groupId: Id<"groups">; films: FilmListItem[] }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [round, setRound] = useState(0);
  const onCoverFailed = useCallback((filmId: string) => {
    setFailed((prev) => (prev.has(filmId) ? prev : new Set(prev).add(filmId)));
  }, []);
  const retryCovers = () => {
    setFailed(new Set());
    setRound((r) => r + 1);
  };

  if (films.length === 0) {
    return <EmptyState icon="film" title="Geen films" text="In deze groep staan geen films." />;
  }
  const message = filmErrorMessage("cover");
  return (
    <View style={styles.sections}>
      {failed.size > 0 && (
        <Notice kind="error" message={message.text}>
          <SmallButton title={message.retryLabel} icon="refresh" onPress={retryCovers} />
        </Notice>
      )}
      {filmSections(films).map((section) => (
        <View key={section.kind} style={styles.section}>
          <Text variant="fieldLabel" color="muted" accessibilityRole="header">
            {section.title}
          </Text>
          {section.films.map((film) => (
            <FilmTile
              key={`${film._id}:${round}`}
              film={film}
              onCoverFailed={onCoverFailed}
              onPress={() => router.push(filmPath(groupId, film._id))}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

type Cover = { uri: string; cacheKey: string };

function FilmTile({
  film,
  onCoverFailed,
  onPress,
}: {
  film: FilmListItem;
  onCoverFailed: (filmId: string) => void;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const getCover = useAction(api.films.coverUrl);
  const [cover, setCover] = useState<Cover | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    if (!film.hasCover) return;
    let alive = true;
    getCover({ filmId: film._id as Id<"films"> })
      .then(({ url }) => {
        if (alive) setCover(coverSource(film._id, url));
      })
      .catch(() => {
        if (!alive) return;
        setCoverFailed(true);
        onCoverFailed(film._id);
      });
    return () => {
      alive = false;
    };
  }, [film._id, film.hasCover, getCover, onCoverFailed]);

  const label = `${film.title}, ${film.year}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Speelt de film af"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface }, pressed && { backgroundColor: colors.line }]}
    >
      <View style={styles.cover}>
        <Gradient from={colors.gradStart} to={colors.gradEnd} radius={radius.albumTile} />
        <View style={styles.coverIcon}>
          <Icon name="film" size={40} color={colors.onGradient} />
        </View>
        {cover && !coverFailed && (
          <Image
            source={cover}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
            accessible={false}
            onError={() => {
              setCoverFailed(true);
              onCoverFailed(film._id);
            }}
          />
        )}
      </View>
      <View style={styles.text}>
        <Text variant="albumName">{film.title}</Text>
        <Text variant="albumMeta" color="muted">
          {film.year}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },
  section: { gap: space.m },
  card: { gap: space.s, padding: space.m, borderRadius: radius.albumTile },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.albumTile,
    overflow: "hidden",
  },
  coverIcon: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  text: { gap: space.xs },
});
