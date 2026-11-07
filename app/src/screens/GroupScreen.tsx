import { useAuth } from "@clerk/expo";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ProfileAvatar } from "../components/Photo";
import { ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { UnreadLabel } from "../components/UnreadLabel";
import { YearHeading } from "../components/YearHeading";
import { api } from "../convexApi";
import { forgetLastGroup, saveLastGroup } from "../data/lastGroup";
import { useLiveQuery } from "../data/useLiveQuery";
import { albumPath } from "../lib/groupRoutes";
import {
  albumsByYear,
  displayYear,
  groupErrorKind,
  memberName,
  memberSections,
  sectionTitle,
  unreadBadge,
  yearOf,
} from "../lib/groups";
import { radius, size, space, useTheme } from "../theme";
import { AlbumCoverTile, backToMyGroups, CoverHeader, LoadError } from "./GroupParts";

type Tab = "albums" | "leden";
const TABS = [
  { key: "albums", title: "Albums" },
  { key: "leden", title: "Leden" },
] as const;

// WP16: Groep, met de groepstabs Albums en Leden (besluit 5). Alleen de
// zichtbare tab heeft een live query (§Routes): de andere is niet gemount.
// Geen lid (meer), of de groep bestaat niet: de NOT_MEMBER-fout van de
// backend, opgevangen door de grens hieronder (invarianten 5 en 9).
export function GroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const id = String(groupId) as Id<"groups">;
  return (
    <QueryBoundary key={id} fallback={(error, reset) => <GroupFailed groupId={id} error={error} reset={reset} />}>
      <GroupContent groupId={id} />
    </QueryBoundary>
  );
}

function GroupContent({ groupId }: { groupId: Id<"groups"> }) {
  // WP17a: met de cover (en zijn draaiing) voor de kop.
  const group = useLiveQuery(api.groups.getWithCover, { groupId });
  const [tab, setTab] = useState<Tab>("albums");
  const { userId } = useAuth();

  // Beslissing 4: onthouden zodra de groep echt getoond wordt.
  const shown = group !== undefined && group !== null;
  useEffect(() => {
    if (shown && userId) void saveLastGroup(userId, groupId);
  }, [shown, userId, groupId]);

  if (group === null) return <NotMember groupId={groupId} />;

  return (
    <Screen header={<CoverHeader name={group?.name} cover={group?.cover} />}>
      {/* De titel is de terugknop-tekst op het albumscherm. */}
      <Stack.Screen options={{ title: group?.name ?? "Groep" }} />
      {group === undefined ? (
        <LoadingState label="Groep laden…" />
      ) : (
        <>
          <View style={styles.intro}>
            <Text variant="title" accessibilityRole="header">
              {group.name}
            </Text>
            {group.description ? <Text>{group.description}</Text> : null}
            <Text variant="meta" color="muted">
              Opgericht {displayYear(group)}
            </Text>
          </View>
          <SegmentedTabs tabs={TABS} selected={tab} onSelect={setTab} />
          {tab === "albums" ? (
            <AlbumsTab groupId={groupId} />
          ) : (
            <MembersTab groupId={groupId} founderId={group.createdBy} />
          )}
        </>
      )}
    </Screen>
  );
}

function GroupFailed({ groupId, error, reset }: { groupId: Id<"groups">; error: unknown; reset: () => void }) {
  if (groupErrorKind(error) === "notMember") return <NotMember groupId={groupId} />;
  return (
    <Screen header={<CoverHeader />}>
      <LoadError title="Deze groep laden lukt niet" onRetry={reset} />
    </Screen>
  );
}

// Invariant 9: geen crash en geen oude inhoud, wel een NL-melding en een weg
// naar Mijn groepen. Home vergeet deze groep (invariant 6).
function NotMember({ groupId }: { groupId: Id<"groups"> }) {
  const { userId } = useAuth();
  useEffect(() => {
    if (userId) void forgetLastGroup(userId, groupId);
  }, [userId, groupId]);
  return (
    <Screen header={<CoverHeader />}>
      <Stack.Screen options={{ title: "Groep" }} />
      <Notice
        kind="error"
        title="Je bent geen lid van deze groep"
        message="Misschien ben je uit de groep gehaald, of bestaat de groep niet meer."
      />
      <Button title="Naar Mijn groepen" icon="groups" onPress={backToMyGroups} />
    </Screen>
  );
}

// --- Albums ---------------------------------------------------------------------

function AlbumsTab({ groupId }: { groupId: Id<"groups"> }) {
  const albums = useLiveQuery(api.albums.listByGroupWithUnread, { groupId });
  if (albums === undefined) return <LoadingState label="Albums laden…" />;
  if (albums.length === 0) {
    return <EmptyState icon="photos" title="Nog geen albums" text="In deze groep staan nog geen albums." />;
  }
  return (
    <View style={styles.years}>
      {albumsByYear(albums).map(({ year, albums: inYear }) => (
        <View key={year} style={styles.year}>
          <YearHeading year={year} />
          {inYear.map((album) => (
            <AlbumRow
              key={album._id}
              albumId={album._id}
              coverPhotoId={album.coverPhotoId}
              name={album.name}
              unreadCount={album.unreadCount}
              onPress={() => router.push(albumPath(groupId, album._id))}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

// Invariant 3: tikken opent het album; pas het albumscherm zet de teller op
// nul (WP17a vraag 6). De cover *klein*, anders de letter (WP17a).
function AlbumRow({
  albumId,
  coverPhotoId,
  name,
  unreadCount,
  onPress,
}: {
  albumId: Id<"albums">;
  coverPhotoId?: string;
  name: string;
  unreadCount: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const badge = unreadBadge(unreadCount);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, badge?.accessibilityLabel].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface },
        pressed && { backgroundColor: colors.line },
      ]}
    >
      <AlbumCoverTile
        albumId={albumId}
        coverPhotoId={coverPhotoId}
        name={name}
        size={size.albumTile}
        radius={radius.albumTile}
        variant="albumName"
      />
      <View style={styles.text}>
        {/* Albumnamen breken over regels, nooit afgekapt (design.md §3). */}
        <Text variant="albumName">{name}</Text>
        <UnreadLabel count={unreadCount} />
      </View>
      <Icon name="chevron" size={20} color={colors.muted} />
    </Pressable>
  );
}

// --- Leden ----------------------------------------------------------------------

function MembersTab({ groupId, founderId }: { groupId: Id<"groups">; founderId: string }) {
  const members = useLiveQuery(api.groups.listMembers, { groupId });
  const me = useLiveQuery(api.users.profile, {});
  if (members === undefined || me === undefined) return <LoadingState label="Leden laden…" />;
  const sections = memberSections(members, { meId: me?._id ?? null, founderId });
  return (
    <View style={styles.years}>
      <Text variant="meta" color="muted">
        {members.length === 1 ? "1 lid" : `${members.length} leden`}
      </Text>
      {sections.map((section) => (
        <View key={section.role} style={styles.section}>
          <Text variant="fieldLabel" color="muted" accessibilityRole="header">
            {sectionTitle(section.role)}
          </Text>
          <ListSection>
            {section.members.map((m) => {
              const name = memberName(m);
              const meta = [
                m.isFounder && "Oprichter",
                m.isMe && "Jij",
                `Lid sinds ${yearOf(m.membership.joinedAt)}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <View
                  key={m.membership._id}
                  accessible
                  accessibilityLabel={`${name ?? "Naam onbekend"}, ${meta}`}
                  style={styles.member}
                >
                  <ProfileAvatar
                    userId={m.user?._id}
                    name={name}
                    size={size.avatar}
                    exifOrientation={m.user?.profileOrientation}
                  />
                  <View style={styles.text}>
                    <Text color={name ? "text" : "muted"}>{name ?? "Naam onbekend"}</Text>
                    <Text variant="albumMeta" color="muted">
                      {meta}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ListSection>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.xs },
  years: { gap: space.xl },
  year: { gap: space.m },
  section: { gap: space.s },
  card: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    padding: space.m,
    borderRadius: radius.albumTile,
  },
  member: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  text: { flex: 1, gap: space.xs },
});
