import { useAuth } from "@clerk/expo";
import { router, useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "../components/Icon";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { UnreadLabel } from "../components/UnreadLabel";
import { api } from "../convexApi";
import { forgetLastGroup, loadLastGroup } from "../data/lastGroup";
import { useLiveQuery } from "../data/useLiveQuery";
import { groupPath } from "../lib/groupRoutes";
import { homeDecisions, homeSessionKey } from "../lib/homeDecision";
import { displayYear, homeTarget, roleLabel, sortMyGroups, unreadBadge } from "../lib/groups";
import { radius, size, space, useTheme } from "../theme";
import type { FunctionReturnType } from "convex/server";
import { GroupCoverTile, LargeTitleHeader, LoadError } from "./GroupParts";

type MyGroup = FunctionReturnType<typeof api.groups.listMine>[number];

// WP16: Mijn groepen, de wortel van de Home-stack. Per groep naam, "Sinds
// <jaar>", je rol en de teller van de backend (besluit 4, invariant 10).
// Bij een koude start en na inloggen kiest dit scherm één keer de Home-stack
// (§Routes): met de laatst bezochte groep erop, als je daar nog lid van bent.
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
  const groups = useLiveQuery(api.groups.listMine, {});
  const homeReady = useHomeDecision(groups);

  // Invariant 12: tot Home gekozen heeft, geen flits van de lijst.
  if (groups === undefined || !homeReady) return <LoadingState label="Groepen laden…" />;
  if (groups.length === 0) {
    return (
      <EmptyState
        icon="groups"
        title="Nog geen groepen"
        text="Je bent nog geen lid van een groep. Word je uitgenodigd, dan staat de groep hier."
      />
    );
  }
  return (
    <View style={styles.list}>
      {sortMyGroups(groups).map((group) => (
        <GroupCard key={group._id} group={group} />
      ))}
    </View>
  );
}

// Home kiest één keer per sessie (invariant 12). Het geheugen daarvan staat in
// homeDecisions, buiten dit scherm: een remount na "reconnecting" of na
// "Opnieuw" in de foutgrens kiest niet nog eens (fix-cyclus 1, S1). Een nieuwe
// Clerk-sessie kiest opnieuw, met het geheugen van die user (invariant 6).
// Opent een deep link een ander scherm boven dit scherm, dan kiest Home niets.
function useHomeDecision(groups: MyGroup[] | undefined): boolean {
  const { userId, sessionId } = useAuth();
  const sessionKey = homeSessionKey(userId, sessionId);
  const focused = useIsFocused();
  // undefined: nog niet gelezen.
  const [lastGroupId, setLastGroupId] = useState<string | null | undefined>(undefined);
  // "pushing": de groep gaat erop. Tot hij dit scherm bedekt, blijft het
  // laden staan, anders flitst de lijst nog even (invariant 12).
  const [phase, setPhase] = useState<"deciding" | "pushing" | "done">(() =>
    homeDecisions.isDecided(sessionKey) ? "done" : "deciding",
  );
  const decided = phase !== "deciding";

  useEffect(() => {
    let current = true;
    if (!userId) setLastGroupId(null);
    else void loadLastGroup(userId).then((id) => current && setLastGroupId(id));
    return () => {
      current = false;
    };
  }, [userId]);

  const target = decided || lastGroupId === undefined ? null : homeTarget({ lastGroupId, myGroups: groups });

  useEffect(() => {
    if (target === null || target.kind === "wait") return;
    homeDecisions.markDecided(sessionKey);
    if (target.kind === "group" && focused) {
      router.push(groupPath(target.groupId));
      setPhase("pushing");
      return;
    }
    if (target.kind === "myGroups" && target.forget && userId && lastGroupId) {
      void forgetLastGroup(userId, lastGroupId);
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[group.name, meta, badge?.accessibilityLabel].filter(Boolean).join(", ")}
      onPress={() => router.push(groupPath(group._id))}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface },
        pressed && { backgroundColor: colors.line },
      ]}
    >
      <GroupCoverTile
        groupId={group._id}
        coverPhotoId={group.coverPhotoId}
        name={group.name}
        size={size.groupTile}
        radius={radius.groupPhoto}
      />
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
