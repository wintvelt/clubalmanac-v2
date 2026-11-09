import { useAuth } from "@clerk/expo";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Pressable, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { LinkButton } from "../components/LinkButton";
import { ProfileAvatar } from "../components/Photo";
import { ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { UnreadLabel } from "../components/UnreadLabel";
import { YearHeading } from "../components/YearHeading";
import { api } from "../convexApi";
import {
  clearDeparting,
  markDeparting,
  setNotice,
  useDeparting,
  useNoticeUntilBlur,
} from "../data/adminState";
import { forgetLastGroup, saveLastGroup } from "../data/lastGroup";
import { useLiveQuery } from "../data/useLiveQuery";
import {
  groupRights,
  memberActionLabel,
  memberActions,
  memberConfirmation,
  memberSuccess,
  refusalOf,
  type MemberAction,
  type Role,
} from "../lib/groupAdmin";
import { albumPath, editGroupPath, newAlbumPath } from "../lib/groupRoutes";
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
import { toMyGroups } from "./AlbumParts";
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
  // WP28b A-invariant 23: na verlaten of verwijderen geen "geen lid" tussendoor.
  const departing = useDeparting(id);
  return (
    <QueryBoundary
      key={id}
      fallback={(error, reset) =>
        departing ? <Departing /> : <GroupFailed groupId={id} error={error} reset={reset} />
      }
    >
      <GroupContent groupId={id} />
    </QueryBoundary>
  );
}

function GroupContent({ groupId }: { groupId: Id<"groups"> }) {
  // WP17a: met de cover (en zijn draaiing) voor de kop.
  const group = useLiveQuery(api.groups.getWithCover, { groupId });
  // WP28b: je rol voor de knoppen (groups.listMine, vondst 1).
  const mine = useLiveQuery(api.groups.listMine, {});
  const me = useLiveQuery(api.users.profile, {});
  const role = mine?.find((g) => g._id === groupId)?.role;
  const rights =
    group && me && role ? groupRights({ me: me._id, role, founderId: group.createdBy }) : undefined;
  const departing = useDeparting(groupId);
  const notice = useNoticeUntilBlur(`group:${groupId}`);
  const [tab, setTab] = useState<Tab>("albums");
  const { userId } = useAuth();

  // Beslissing 4: onthouden zodra de groep echt getoond wordt.
  const shown = group !== undefined && group !== null;
  useEffect(() => {
    if (shown && userId) void saveLastGroup(userId, groupId);
  }, [shown, userId, groupId]);

  if (group === null) return departing ? <Departing /> : <NotMember groupId={groupId} />;

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
            {rights?.editGroup && (
              <View style={styles.action}>
                <SmallButton title="Bewerk groep" icon="edit" onPress={() => router.push(editGroupPath(groupId))} />
              </View>
            )}
          </View>
          {notice && <Notice kind="success" message={notice} />}
          <SegmentedTabs tabs={TABS} selected={tab} onSelect={setTab} />
          {tab === "albums" ? (
            <AlbumsTab groupId={groupId} canCreate={rights?.createAlbum ?? false} />
          ) : (
            <MembersTab groupId={groupId} groupName={group.name} founderId={group.createdBy} />
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

// WP28b A-invariant 23: de app navigeert weg; tot dan alleen "Bezig…".
function Departing() {
  return (
    <Screen header={<CoverHeader />}>
      <LoadingState label="Bezig…" />
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

function AlbumsTab({ groupId, canCreate }: { groupId: Id<"groups">; canCreate: boolean }) {
  const albums = useLiveQuery(api.albums.listByGroupWithUnread, { groupId });
  if (albums === undefined) return <LoadingState label="Albums laden…" />;
  // WP28b: "Nieuw album" op een eigen regel boven de jaren, ook in de lege toestand.
  const create = canCreate ? (
    <LinkButton title="Nieuw album" icon="plus" tone="action" onPress={() => router.push(newAlbumPath(groupId))} />
  ) : null;
  if (albums.length === 0) {
    return (
      <View style={styles.years}>
        {create}
        <EmptyState icon="photos" title="Nog geen albums" text="In deze groep staan nog geen albums." />
      </View>
    );
  }
  return (
    <View style={styles.years}>
      {create}
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

type MemberStatus = { kind: "error" | "success"; text: string } | null;

// WP28b: tik op een lid opent een menu met wat jij bij dat lid mag
// (memberActions, A-invariant 18). Een rij zonder acties heeft geen pijl en
// reageert niet. De melding staat bij de ledenlijst.
function MembersTab({ groupId, groupName, founderId }: { groupId: Id<"groups">; groupName: string; founderId: string }) {
  const members = useLiveQuery(api.groups.listMembers, { groupId });
  const me = useLiveQuery(api.users.profile, {});
  const { userId: clerkUserId } = useAuth();
  const updateRole = useMutation(api.groups.updateMemberRole);
  const transferFounder = useMutation(api.groups.transferFounder);
  const removeMember = useMutation(api.groups.removeMember);
  const [status, setStatus] = useState<MemberStatus>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  if (members === undefined || me === undefined) return <LoadingState label="Leden laden…" />;
  const sections = memberSections(members, { meId: me?._id ?? null, founderId });
  const myRole = members.find((m) => m.membership.userId === me?._id)?.membership.role;
  const viewer = me && myRole ? { me: me._id as string, role: myRole, founderId } : undefined;
  const iAmFounder = viewer !== undefined && viewer.me === founderId;

  async function run(action: MemberAction, target: { userId: Id<"users">; name: string | null }) {
    if (inFlight.current) return;
    const confirmation = memberConfirmation(action, target.name);
    if (confirmation && !(await ask(confirmation))) return;
    inFlight.current = true;
    setBusy(true);
    setStatus(null);
    const leaving = action === "leave";
    if (leaving) markDeparting(groupId);
    try {
      switch (action) {
        case "makeAdmin":
        case "makeMember":
          await updateRole({ groupId, userId: target.userId, role: action === "makeAdmin" ? "admin" : "member" });
          break;
        case "transferFounder":
          await transferFounder({ groupId, userId: target.userId });
          break;
        case "removeMember":
        case "leave":
          await removeMember({ groupId, userId: target.userId });
          break;
      }
      if (leaving) {
        if (clerkUserId) void forgetLastGroup(clerkUserId, groupId);
        setNotice("myGroups", `Je hebt ${groupName} verlaten`);
        toMyGroups();
        return;
      }
      setStatus({ kind: "success", text: memberSuccess(action, target.name) });
    } catch (error) {
      if (leaving) clearDeparting(groupId);
      setStatus({ kind: "error", text: refusalOf(error, action).text });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function openMenu(actions: MemberAction[], target: { userId: Id<"users">; name: string | null }) {
    if (inFlight.current) return;
    setStatus(null);
    const options = [...actions.map(memberActionLabel), "Annuleren"];
    const destructive = actions.findIndex((a) => a === "removeMember" || a === "leave");
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: target.name ?? "Naam onbekend",
        options,
        cancelButtonIndex: options.length - 1,
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
      },
      (index) => {
        const action = actions[index];
        if (action) void run(action, target);
      },
    );
  }

  return (
    <View style={styles.years}>
      <Text variant="meta" color="muted">
        {members.length === 1 ? "1 lid" : `${members.length} leden`}
      </Text>
      {busy && (
        <Text variant="meta" color="muted" accessibilityLiveRegion="polite">
          Bezig…
        </Text>
      )}
      {status && <Notice kind={status.kind} message={status.text} />}
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
              const actions = viewer
                ? memberActions(viewer, { userId: m.membership.userId, role: m.membership.role as Role })
                : [];
              return (
                <MemberRow
                  key={m.membership._id}
                  name={name}
                  meta={meta}
                  user={m.user}
                  onPress={
                    actions.length > 0 && !busy
                      ? () => openMenu(actions, { userId: m.membership.userId, name })
                      : undefined
                  }
                />
              );
            })}
          </ListSection>
        </View>
      ))}
      {iAmFounder && (
        <Text variant="meta" color="muted">
          Als oprichter kun je de groep niet verlaten. Maak eerst een ander lid oprichter. Ben je het enige lid,
          verwijder dan de groep bij Bewerk groep.
        </Text>
      )}
    </View>
  );
}

function ask(c: { title: string; message: string; button: string; destructive: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      c.title,
      c.message,
      [
        { text: "Annuleren", style: "cancel", onPress: () => resolve(false) },
        { text: c.button, style: c.destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

type MemberUser = FunctionReturnType<typeof api.groups.listMembers>[number]["user"];

function MemberRow({
  name,
  meta,
  user,
  onPress,
}: {
  name: string | null;
  meta: string;
  user: MemberUser;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const label = `${name ?? "Naam onbekend"}, ${meta}`;
  const body = (
    <>
      <ProfileAvatar
        userId={user?._id}
        name={name}
        size={size.avatar}
        exifOrientation={user?.profileOrientation}
        version={user?.profileVersion}
        hasFormats={user?.profileHasFormats}
      />
      <View style={styles.text}>
        <Text color={name ? "text" : "muted"}>{name ?? "Naam onbekend"}</Text>
        <Text variant="albumMeta" color="muted">
          {meta}
        </Text>
      </View>
      {onPress && <Icon name="chevron" size={20} color={colors.muted} />}
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={styles.member}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opent de acties voor dit lid"
      onPress={onPress}
      style={({ pressed }) => [styles.member, pressed && { backgroundColor: colors.line }]}
    >
      {body}
    </Pressable>
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
  action: { paddingTop: space.s },
});
