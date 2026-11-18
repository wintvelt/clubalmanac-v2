import { useAuth } from "@clerk/expo";
import { router, useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "../components/Icon";
import { LinkButton } from "../components/LinkButton";
import { FadeIn, TileZoom, useArrivals, usePressMotion } from "../components/Motion";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { UnreadLabel } from "../components/UnreadLabel";
import { forgetDepartedIn, useNoticeUntilBlur } from "../data/adminState";
import { useHomeGroup, useMyGroups, type MyGroup } from "../data/homeGroupState";
import { groupPath, newGroupPath } from "../lib/groupRoutes";
import { homeDecisions, homeSessionKey } from "../lib/homeDecision";
import { displayYear, roleLabel, sortMyGroups, unreadBadge } from "../lib/groups";
import { radius, size, space, useTheme } from "../theme";
import { GroupCoverTile, LargeTitleHeader, LoadError } from "./GroupParts";

// WP16: Mijn groepen, de wortel van de Home-stack. Per groep naam, "Sinds
// <jaar>", je rol en de teller van de backend (besluit 4, invariant 10).
// Bij een koude start en na inloggen kiest dit scherm één keer de Home-stack
// (§Routes): met de thuisgroep erop, als er een is (WP32 invariant 5).
export function MyGroupsScreen() {
  return (
    <Screen header={<LargeTitleHeader title="Mijn groepen" />}>
      <QueryBoundary fallback={(_error, reset) => <LoadError title="Je groepen laden lukt niet" onRetry={reset} />}>
        <MyGroupsList />
      </QueryBoundary>
    </Screen>
  );
}

function MyGroupsList() {
  const groups = useMyGroups();
  const homeReady = useHomeDecision(groups);
  // WP28b: na verlaten of groep verwijderen (A-keuze 7).
  const notice = useNoticeUntilBlur("myGroups");
  // WP33 D4: een groep die binnenkomt, fadet in.
  const arrivals = useArrivals(groups?.map((g) => g._id));
  // Een groep die hier weer staat (nieuwe uitnodiging), is niet meer vertrokken.
  useEffect(() => {
    if (groups) forgetDepartedIn(groups.map((g) => g._id));
  }, [groups]);

  // Invariant 12: tot Home gekozen heeft, geen flits van de lijst.
  if (groups === undefined || !homeReady) return <LoadingState label="Groepen laden…" />;
  // WP28b: "Nieuwe groep" op een eigen regel boven de lijst, ook als die leeg is.
  const top = (
    <>
      {notice && <Notice kind="success" message={notice} />}
      <LinkButton title="Nieuwe groep" icon="plus" tone="action" onPress={() => router.push(newGroupPath())} />
    </>
  );
  if (groups.length === 0) {
    return (
      <View style={styles.list}>
        {top}
        <EmptyState
          icon="groups"
          title="Nog geen groepen"
          text="Je bent nog geen lid van een groep. Word je uitgenodigd, dan staat de groep hier."
        />
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {top}
      {sortMyGroups(groups).map((group) => (
        <FadeIn key={group._id} active={arrivals.has(group._id)}>
          <GroupCard group={group} />
        </FadeIn>
      ))}
    </View>
  );
}

// Home kiest één keer per sessie (WP16 invariant 12, WP32 invariant 5 en A2).
// Het geheugen daarvan staat in homeDecisions, buiten dit scherm: een remount
// na "reconnecting" of na "Opnieuw" in de foutgrens kiest niet nog eens
// (fix-cyclus 1, S1). Een nieuwe Clerk-sessie kiest opnieuw, met de
// thuisgroep van die user. Tot de opgeslagen waarde gelezen is én de lijst er
// is: laden, geen flits. Opent een deep link een ander scherm boven dit
// scherm, dan kiest Home niets.
function useHomeDecision(groups: MyGroup[] | undefined): boolean {
  const { userId, sessionId } = useAuth();
  const sessionKey = homeSessionKey(userId, sessionId);
  const focused = useIsFocused();
  const home = useHomeGroup(groups ?? []);
  // "pushing": de groep gaat erop. Tot hij dit scherm bedekt, blijft het
  // laden staan, anders flitst de lijst nog even.
  const [phase, setPhase] = useState<"deciding" | "pushing" | "done">(() =>
    homeDecisions.isDecided(sessionKey) ? "done" : "deciding",
  );
  const decided = phase !== "deciding";
  // Zonder lijst is de thuisgroep nog onbekend (useHomeGroup kreeg [] mee).
  const target = decided || groups === undefined || home.kind === "unknown" ? null : home;

  useEffect(() => {
    if (target === null) return;
    // De Home-knop kan intussen al gekozen hebben.
    if (homeDecisions.isDecided(sessionKey)) {
      setPhase("done");
      return;
    }
    homeDecisions.markDecided(sessionKey);
    if (target.kind === "group" && focused) {
      router.push(groupPath(target.groupId));
      setPhase("pushing");
      return;
    }
    setPhase("done");
  }, [target?.kind, target?.kind === "group" ? target.groupId : null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === "pushing" && !focused) setPhase("done");
  }, [phase, focused]);

  return phase === "done";
}

function GroupCard({ group }: { group: MyGroup }) {
  const { colors } = useTheme();
  const meta = `Sinds ${displayYear(group)} · ${roleLabel(group.role)}`;
  const badge = unreadBadge(group.unreadCount);
  // WP33 invariant 5: de cover zoomt licht in bij indrukken.
  const press = usePressMotion("tile");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[group.name, meta, badge?.accessibilityLabel].filter(Boolean).join(", ")}
      onPress={() => router.push(groupPath(group._id))}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface },
        pressed && { backgroundColor: colors.line },
      ]}
    >
      <TileZoom zoom={press.style} size={size.groupTile} radius={radius.groupPhoto}>
        <GroupCoverTile
          groupId={group._id}
          coverPhotoId={group.coverPhotoId}
          name={group.name}
          size={size.groupTile}
          radius={radius.groupPhoto}
        />
      </TileZoom>
      <View style={styles.text}>
        <Text variant="groupName">{group.name}</Text>
        <Text variant="meta" color="muted">
          {meta}
        </Text>
        <UnreadLabel count={group.unreadCount} />
      </View>
      <Icon name="chevron" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.m },
  card: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    padding: space.m,
    borderRadius: radius.card,
  },
  text: { flex: 1, gap: space.xs },
});
