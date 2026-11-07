import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Id } from "../../../convex/_generated/dataModel";
import { BackPill } from "../components/BackPill";
import { Gradient } from "../components/Gradient";
import { LetterTile } from "../components/LetterTile";
import { Notice } from "../components/Notice";
import { CoverScrim, PhotoImage } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { SmallButton } from "../components/SmallButton";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useLiveQuery } from "../data/useLiveQuery";
import { radius, size, space, useTheme, type TypeRoleName } from "../theme";

// Gedeelde stukken van Mijn groepen en Groep (WP16).

// Terug naar Mijn groepen, ook zonder scherm eronder (deep link).
export function backToMyGroups() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

// Grote titel bovenaan een scherm zonder navigatiebalk. Blijft staan in elke
// toestand, ook in "reconnecting" (design.md §6: de kop blijft staan).
export function LargeTitleHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.column, { paddingTop: insets.top + space.l }]}>
      <Text variant="largeTitle" accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

// Een cover-foto: het id plus de draaiing uit Convex (invariant 4).
export type CoverPhoto = { _id: string; exifOrientation?: number; hasFormats?: boolean };

// De kop van Groep (design.md §5, §7). Met een cover (WP17a): de foto over de
// volle breedte (*groot*). Zonder cover, of als het beeld niet laadt: de
// wash-tint met het vlak in het verloop met de eerste letter (WP16 besluit 2).
// De terugknop-pil staat linksboven onder de statusbalk.
export function CoverHeader({ name, cover }: { name?: string; cover?: CoverPhoto | null }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Bij grote tekst kan de kop hoger worden dan het vaste vlak; de cover groeit mee.
  const [measured, setMeasured] = useState(0);
  const height = Math.max(insets.top + size.cover, measured);
  const tile =
    name !== undefined ? (
      <LetterTile name={name} size={size.groupTile * 1.5} radius={radius.groupPhoto} variant="largeTitle" />
    ) : null;
  // Mislukt het beeld: de wash-tint met de letter in het midden.
  const fallback = (
    <>
      <Gradient from={colors.washStart} to={colors.washEnd} />
      <View style={styles.coverFallbackTile}>{tile}</View>
    </>
  );
  return (
    <View
      style={[styles.cover, { paddingTop: insets.top + space.s, minHeight: insets.top + size.cover }]}
      onLayout={(e) => setMeasured(Math.ceil(e.nativeEvent.layout.height))}
    >
      {cover ? (
        <View style={StyleSheet.absoluteFill}>
          <PhotoImage
            photoId={cover._id}
            format="groot"
            exifOrientation={cover.exifOrientation}
            hasFormats={cover.hasFormats}
            box={{ width, height }}
            fallback={fallback}
          />
          <CoverScrim height={height} />
        </View>
      ) : (
        <Gradient from={colors.washStart} to={colors.washEnd} />
      )}
      <View style={styles.coverColumn}>
        <BackPill title="Mijn groepen" onPress={backToMyGroups} />
        {/* Zonder cover staat de letter in de flow, onder de pil (WP16). */}
        {!cover && tile && <View style={styles.coverTile}>{tile}</View>}
      </View>
    </View>
  );
}

type TileProps = { name: string; size: number; radius: number; variant?: TypeRoleName };

// WP17a: de cover van een groep op een kaart (Mijn groepen), *klein*. Een
// eigen live query per kaart met cover, voor de draaiing (invariant 4).
// Zonder cover, zonder toegang tot de cover, of bij een fout: de letter.
export function GroupCoverTile({ groupId, coverPhotoId, ...tile }: TileProps & { groupId: Id<"groups">; coverPhotoId?: string }) {
  const letter = <LetterTile {...tile} />;
  if (!coverPhotoId) return letter;
  return (
    <QueryBoundary fallback={() => letter}>
      <GroupCover groupId={groupId} tile={tile} letter={letter} />
    </QueryBoundary>
  );
}

function GroupCover({ groupId, tile, letter }: { groupId: Id<"groups">; tile: TileProps; letter: ReactNode }) {
  const group = useLiveQuery(api.groups.getWithCover, { groupId });
  return <CoverTile cover={group?.cover} tile={tile} letter={letter} />;
}

// Idem voor een album in Groep → Albums.
export function AlbumCoverTile({ albumId, coverPhotoId, ...tile }: TileProps & { albumId: Id<"albums">; coverPhotoId?: string }) {
  const letter = <LetterTile {...tile} />;
  if (!coverPhotoId) return letter;
  return (
    <QueryBoundary fallback={() => letter}>
      <AlbumCover albumId={albumId} tile={tile} letter={letter} />
    </QueryBoundary>
  );
}

function AlbumCover({ albumId, tile, letter }: { albumId: Id<"albums">; tile: TileProps; letter: ReactNode }) {
  const album = useLiveQuery(api.albums.getWithCover, { albumId });
  return <CoverTile cover={album?.cover} tile={tile} letter={letter} />;
}

function CoverTile({ cover, tile, letter }: { cover: CoverPhoto | null | undefined; tile: TileProps; letter: ReactNode }) {
  if (!cover) return <>{letter}</>;
  return (
    <PhotoImage
      photoId={cover._id}
      format="klein"
      exifOrientation={cover.exifOrientation}
      hasFormats={cover.hasFormats}
      box={{ width: tile.size, height: tile.size }}
      radius={tile.radius}
      fallback={letter}
    />
  );
}

// Fout bij laden (design.md §6): een melding met "Opnieuw" erin.
export function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Notice kind="error" title={title} message="Controleer je verbinding en probeer het opnieuw.">
      <SmallButton title="Opnieuw" icon="refresh" onPress={onRetry} />
    </Notice>
  );
}

const styles = StyleSheet.create({
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
  },
  cover: { width: "100%", overflow: "hidden" },
  coverColumn: {
    flex: 1,
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    paddingBottom: space.l,
    gap: space.l,
  },
  coverTile: { flex: 1, alignItems: "center", justifyContent: "center" },
  coverFallbackTile: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
