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
import { AnimatedPressable, FadeIn, PressShade, TileZoom, useArrivals, usePressMotion } from "../components/Motion";
import { ProfileAvatar } from "../components/Photo";
import { ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { useWideLayout } from "../components/wideLayout";
import { InvitedSection } from "./InvitesScreens";
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
import { successTap } from "../data/haptics";
import { forgetLastGroup } from "../data/lastGroup";
import { READ_ONLY } from "../data/readOnly";
import { useMyGroups } from "../data/homeGroupState";
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
import { groupHasFilms } from "../lib/films";
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
import { FilmProjectBanners, StartFilmProjectButton } from "./FilmProjectParts";
import { FilmsTab } from "./FilmsTab";
import { AlbumCoverTile, backToMyGroups, CoverHeader, LoadError } from "./GroupParts";
import { WideSide, WideSplit } from "./WideSide";

type Tab = "albums" | "films" | "leden";
const TABS = [
  { key: "albums", title: "Albums" },
  { key: "leden", title: "Leden" },
] as const;
// WP21 (pariteit): Films tussen Albums en Leden, alleen in een groep met films.
const TABS_WITH_FILMS = [
  { key: "albums", title: "Albums" },
  { key: "films", title: "Films" },
  { key: "leden", title: "Leden" },
] as const;

// WP16: Groep, met de groepstabs Albums en Leden (besluit 5). Alleen de
// zichtbare tab heeft een live query (§Routes): de andere is niet gemount.
// WP21: in een groep met films staat Films ertussen. De filmlijst loopt wel
// altijd mee (klein): hij beslist of die tab er is.
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
  const mine = useMyGroups();
  const me = useLiveQuery(api.users.profile, {});
  const role = mine?.find((g) => g._id === groupId)?.role;
  // WP35 W5: op het web geen rechten: niets bewerken, geen nieuw album.
  const rights =
    !READ_ONLY && group && me && role ? groupRights({ me: me._id, role, founderId: group.createdBy }) : undefined;
  const departing = useDeparting(groupId);
  const notice = useNoticeUntilBlur(`group:${groupId}`);
  const [tab, setTab] = useState<Tab>("albums");
  // WP21: de films van je groepen (leeg zonder toegang). Bepaalt of de tab
  // Films er is; de tab zelf speelt niets af.
  const films = useLiveQuery(api.films.list, {});
  const hasFilms = groupHasFilms(films, groupId);
  const shownTab: Tab = tab === "films" && !hasFilms ? "albums" : tab;
  // WP38c (38c-3): de oprichter ziet "Filmproject starten" (in de app, zonder
  // open project), elk lid de balk per project.
  const isFounder = group !== undefined && group !== null && me !== undefined && me !== null && group.createdBy === me._id;

  const wide = useWideLayout();

  if (group === null) return departing ? <Departing /> : <NotMember groupId={groupId} />;

  // WP35 (breed web-venster, liggende iPad): links de cover, titel, "Bewerk
  // groep" en tabs; rechts de inhoud.
  if (wide) {
    const tabs = hasFilms ? TABS_WITH_FILMS : TABS;
    return (
      <WideSplit
        side={
          <WideSide
            name={group?.name}
            cover={group?.cover}
            description={group?.description}
            meta={group ? `Opgericht ${displayYear(group)}` : undefined}
          >
            <View style={styles.sideActions}>
              {rights?.editGroup && (
                <SmallButton title="Bewerk groep" icon="edit" onPress={() => router.push(editGroupPath(groupId))} />
              )}
              {group !== undefined && <StartFilmProjectButton groupId={groupId} isFounder={isFounder} />}
            </View>
            {group !== undefined && <FilmProjectBanners groupId={groupId} isFounder={isFounder} />}
            {group !== undefined && <SegmentedTabs tabs={tabs} selected={shownTab} onSelect={setTab} />}
          </WideSide>
        }
      >
        <Stack.Screen options={{ title: group?.name ?? "Groep" }} />
        {/* De statusbalk regelt WideSplit al. */}
        <Screen underHeader>
          {group === undefined ? (
            <LoadingState label="Groep laden…" />
          ) : (
            <>
              {notice && <Notice kind="success" message={notice} />}
              {shownTab === "albums" ? (
                <AlbumsTab groupId={groupId} canCreate={rights?.createAlbum ?? false} />
              ) : shownTab === "films" ? (
                <FilmsTab groupId={groupId} films={(films ?? []).filter((f) => f.groupId === groupId)} />
              ) : (
                <MembersTab groupId={groupId} groupName={group.name} founderId={group.createdBy} />
              )}
            </>
          )}
        </Screen>
      </WideSplit>
    );
  }

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
            {(rights?.editGroup || isFounder) && (
              <View style={styles.actions}>
                {rights?.editGroup && (
                  <SmallButton title="Bewerk groep" icon="edit" onPress={() => router.push(editGroupPath(groupId))} />
                )}
                <StartFilmProjectButton groupId={groupId} isFounder={isFounder} />
              </View>
            )}
          </View>
          <FilmProjectBanners groupId={groupId} isFounder={isFounder} />
          {notice && <Notice kind="success" message={notice} />}
          <SegmentedTabs tabs={hasFilms ? TABS_WITH_FILMS : TABS} selected={shownTab} onSelect={setTab} />
          {shownTab === "albums" ? (
            <AlbumsTab groupId={groupId} canCreate={rights?.createAlbum ?? false} />
          ) : shownTab === "films" ? (
            <FilmsTab groupId={groupId} films={(films ?? []).filter((f) => f.groupId === groupId)} />
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
  // WP33 D4: een album dat binnenkomt (ook van een ander lid), fadet in.
  const arrivals = useArrivals(albums?.map((a) => a._id));
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
            <FadeIn key={album._id} active={arrivals.has(album._id)}>
              <AlbumRow
                albumId={album._id}
                coverPhotoId={album.coverPhotoId}
                name={album.name}
                unreadCount={album.unreadCount}
                onPress={() => router.push(albumPath(groupId, album._id))}
              />
            </FadeIn>
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
  // WP33 B1 (besluit 5): de rij krimpt en wordt iets donkerder, de cover
  // zoomt erin.
  const press = usePressMotion("tile");
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={[name, badge?.accessibilityLabel].filter(Boolean).join(", ")}
      onPress={press.withRelease(onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.card, { backgroundColor: colors.surface }, press.style]}
    >
      <TileZoom zoom={press.coverStyle} size={size.albumTile} radius={radius.albumTile}>
        <AlbumCoverTile
          albumId={albumId}
          coverPhotoId={coverPhotoId}
          name={name}
          size={size.albumTile}
          radius={radius.albumTile}
          variant="albumName"
        />
      </TileZoom>
      <View style={styles.text}>
        {/* Albumnamen breken over regels, nooit afgekapt (design.md §3). */}
        <Text variant="albumName">{name}</Text>
        <UnreadLabel count={unreadCount} />
      </View>
      <Icon name="chevron" size={20} color={colors.muted} />
      <PressShade style={press.shadeStyle} radius={radius.albumTile} />
    </AnimatedPressable>
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
  // WP33 D4: een lid dat binnenkomt, fadet in.
  const arrivals = useArrivals(members?.map((m) => m.membership._id));

  if (members === undefined || me === undefined) return <LoadingState label="Leden laden…" />;
  const sections = memberSections(members, { meId: me?._id ?? null, founderId });
  const myRole = members.find((m) => m.membership.userId === me?._id)?.membership.role;
  // WP35 W5: op het web geen acties bij een lid.
  const viewer = !READ_ONLY && me && myRole ? { me: me._id as string, role: myRole, founderId } : undefined;
  const iAmFounder = viewer !== undefined && viewer.me === founderId;
  // WP19b A-invariant 12: uitnodigen en "Uitgenodigd" alleen voor een admin.
  // WP35 W5: op het web niet uitnodigen.
  const iAmAdmin = !READ_ONLY && myRole === "admin";

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
      // WP33 invariant 10 (besluit 2): gelukt na een rode bevestigingsknop
      // (uit de groep halen, verlaten): een tik als de groene melding verschijnt.
      const tap = confirmation?.destructive === true;
      if (leaving) {
        if (clerkUserId) void forgetLastGroup(clerkUserId, groupId);
        setNotice("myGroups", `Je hebt ${groupName} verlaten`);
        toMyGroups();
        if (tap) successTap();
        return;
      }
      setStatus({ kind: "success", text: memberSuccess(action, target.name) });
      if (tap) successTap();
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
                <FadeIn key={m.membership._id} active={arrivals.has(m.membership._id)}>
                  <MemberRow
                    name={name}
                    meta={meta}
                    user={m.user}
                    onPress={
                      actions.length > 0 && !busy
                        ? () => openMenu(actions, { userId: m.membership.userId, name })
                        : undefined
                    }
                  />
                </FadeIn>
              );
            })}
          </ListSection>
        </View>
      ))}
      {iAmAdmin && <InvitedSection groupId={groupId} />}
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
  // "Bewerk groep" en "Filmproject starten" naast elkaar; leeg neemt geen ruimte.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.s, paddingTop: space.s },
  sideActions: { flexDirection: "row", flexWrap: "wrap", gap: space.s, alignSelf: "flex-start" },
});
