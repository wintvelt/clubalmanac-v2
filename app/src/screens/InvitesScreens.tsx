import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { InviteCover } from "../components/InviteCover";
import { LetterTile } from "../components/LetterTile";
import { LinkButton } from "../components/LinkButton";
import { ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { ProfileAvatar } from "../components/Photo";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import { api } from "../convexApi";
import { useLiveQuery } from "../data/useLiveQuery";
import { groupPath, invitePath } from "../lib/groupRoutes";
import {
  createArgs,
  DECLINE_CONFIRMATION,
  emptyRow,
  INVITE_GONE_TEXT,
  inviteRefusalText,
  isInviteGone,
  rowReady,
  sentText,
  validUntilText,
  WITHDRAW_CONFIRMATION,
  type InviteDraftRow,
} from "../lib/invites";
import { radius, size, space, useTheme } from "../theme";

// WP19b: Uitnodigen (Groep → Leden, alleen een admin), Uitnodigingen (Profiel)
// en het blok "Uitgenodigd" in Leden. Spec: docs/work-packages/
// WP19b-uitnodigen-aanmelden.md §Scherm in de app.

type Confirmation = { title: string; message: string; button: string; destructive: boolean };

function confirm(c: Confirmation): Promise<boolean> {
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

// Eén aanroep tegelijk, ook bij dubbel tikken.
function useOnce() {
  const inFlight = useRef(false);
  return async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await work();
    } finally {
      inFlight.current = false;
    }
  };
}

// --- Uitnodigen ---------------------------------------------------------------------
//
// Een verzendlijst: per genodigde naam, e-mail en "als admin". Eén bericht voor
// de hele lijst, optioneel (besluit 2, V1). Elke regel is een eigen aanroep:
// een geweigerde regel blijft staan met de melding eronder, een verstuurde
// verdwijnt.

export function InviteScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const create = useMutation(api.invites.create);
  const nextKey = useRef(1);
  const [rows, setRows] = useState<InviteDraftRow[]>([emptyRow("0")]);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState(false);
  const once = useOnce();
  const ready = rows.length > 0 && rows.every(rowReady);

  const update = (key: string, patch: Partial<InviteDraftRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setErrors((e) => {
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
    setSent(0);
  };
  const addRow = () => setRows((rs) => [...rs, emptyRow(String(nextKey.current++))]);
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const submit = () =>
    once(async () => {
      if (!ready) return;
      setBusy(true);
      setSent(0);
      const failed: Record<string, string> = {};
      let ok = 0;
      for (const row of rows) {
        try {
          await create(createArgs(row, gid, message) as Parameters<typeof create>[0]);
          ok++;
        } catch (error) {
          failed[row.key] = inviteRefusalText(error, "create");
        }
      }
      const left = rows.filter((r) => failed[r.key] !== undefined);
      setRows(left.length > 0 ? left : [emptyRow(String(nextKey.current++))]);
      setErrors(failed);
      setSent(ok);
      if (left.length === 0) setMessage("");
      setBusy(false);
    });

  return (
    <Screen underHeader>
      <Text color="muted">
        De genodigde krijgt een mail: installeer de app en log in met dit e-mailadres. Daarna staat de uitnodiging
        in de app.
      </Text>
      {rows.map((row, i) => (
        <View key={row.key} style={styles.block}>
          <Text variant="fieldLabel" color="muted" accessibilityRole="header">
            {`Genodigde ${i + 1}`}
          </Text>
          <TextField
            label="Naam"
            value={row.name}
            onChangeText={(name) => update(row.key, { name })}
            autoCapitalize="words"
            textContentType="name"
            returnKeyType="next"
          />
          <TextField
            label="E-mailadres"
            value={row.email}
            onChangeText={(email) => update(row.key, { email })}
            invalid={errors[row.key] !== undefined}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <View style={styles.switchRow}>
            <Text style={styles.flex}>Als admin</Text>
            <Switch
              value={row.admin}
              onValueChange={(admin) => update(row.key, { admin })}
              accessibilityLabel={`Genodigde ${i + 1} als admin`}
            />
          </View>
          {errors[row.key] !== undefined && <Notice kind="error" message={errors[row.key]} />}
          {rows.length > 1 && (
            <SmallButton title="Weghalen" icon="trash" tone="danger" onPress={() => removeRow(row.key)} />
          )}
        </View>
      ))}
      <LinkButton title="Nog iemand uitnodigen" icon="plus" onPress={addRow} />
      <TextField
        label="Bericht (mag leeg blijven)"
        value={message}
        onChangeText={(text) => {
          setMessage(text);
          setSent(0);
        }}
        autoCapitalize="sentences"
        multiline
      />
      <View style={styles.block}>
        {!ready && (
          <Text variant="meta" color="muted">
            Vul bij elke genodigde een naam en een e-mailadres in.
          </Text>
        )}
        <Button
          title={rows.length > 1 ? "Uitnodigingen versturen" : "Uitnodiging versturen"}
          busyTitle="Versturen…"
          busy={busy}
          disabled={!ready}
          onPress={() => void submit()}
        />
        {sent > 0 && <Notice kind="success" message={sentText(sent)} />}
      </View>
    </Screen>
  );
}

// --- Uitgenodigd (in Leden, alleen een admin) ---------------------------------------

type Pending = FunctionReturnType<typeof api.invites.listForGroup>[number];

export function InvitedSection({ groupId }: { groupId: Id<"groups"> }) {
  const invites = useLiveQuery(api.invites.listForGroup, { groupId });
  const remove = useMutation(api.invites.remove);
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const once = useOnce();

  if (invites === undefined || invites.length === 0) {
    return (
      <View style={styles.section}>
        <LinkButton title="Uitnodigen" icon="mail" onPress={() => router.push(invitePath(groupId))} />
        {status && <Notice kind={status.kind} message={status.text} />}
      </View>
    );
  }

  const withdraw = (invite: Pending) =>
    once(async () => {
      const who = invite.name ?? invite.email;
      if (!(await confirm(WITHDRAW_CONFIRMATION(who)))) return;
      setStatus(null);
      try {
        await remove({ inviteId: invite._id });
        setStatus({ kind: "success", text: `De uitnodiging aan ${who} is ingetrokken.` });
      } catch (error) {
        setStatus({ kind: "error", text: inviteRefusalText(error, "remove") });
      }
    });

  return (
    <View style={styles.section}>
      <Text variant="fieldLabel" color="muted" accessibilityRole="header">
        Uitgenodigd
      </Text>
      {status && <Notice kind={status.kind} message={status.text} />}
      <ListSection>
        {invites.map((invite) => (
          <PendingRow key={invite._id} invite={invite} onPress={() => void withdraw(invite)} />
        ))}
      </ListSection>
      <LinkButton title="Uitnodigen" icon="mail" onPress={() => router.push(invitePath(groupId))} />
    </View>
  );
}

function PendingRow({ invite, onPress }: { invite: Pending; onPress: () => void }) {
  const { colors } = useTheme();
  const name = invite.name ?? invite.email;
  const meta = [invite.name ? invite.email : null, invite.role === "admin" ? "Als admin" : null, validUntilText(invite.expiresAt)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${meta}`}
      accessibilityHint="Uitnodiging intrekken"
      onPress={onPress}
      style={({ pressed }) => [styles.member, pressed && { backgroundColor: colors.line }]}
    >
      <Icon name="mail" color={colors.muted} />
      <View style={styles.flex}>
        <Text>{name}</Text>
        <Text variant="albumMeta" color="muted">
          {meta}
        </Text>
      </View>
      <Text variant="meta" style={{ color: colors.danger }}>
        Intrekken
      </Text>
    </Pressable>
  );
}

// --- Uitnodigingen (Profiel) ----------------------------------------------------------
//
// De open uitnodigingen voor je eigen adres (invites.listReceived). Accepteren
// → naar de groep. Afwijzen → weg uit de lijst. Niet meer geldig → een
// mededeling, geen fout.

type Received = FunctionReturnType<typeof api.invites.listReceived>[number];

export function ReceivedInvitesScreen() {
  const invites = useLiveQuery(api.invites.listReceived, {});
  const accept = useMutation(api.invites.accept);
  const decline = useMutation(api.invites.decline);
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const once = useOnce();

  if (invites === undefined) return <LoadingState label="Uitnodigingen laden…" />;

  const act = (invite: Received, action: "accept" | "decline") =>
    once(async () => {
      if (action === "decline" && !(await confirm(DECLINE_CONFIRMATION(invite.group.name)))) return;
      setStatus(null);
      setBusyId(invite._id);
      try {
        if (action === "accept") {
          const { groupId } = await accept({ inviteId: invite._id });
          router.navigate(groupPath(groupId));
        } else {
          await decline({ inviteId: invite._id });
          setStatus({ kind: "success", text: `Je hebt de uitnodiging voor ${invite.group.name} afgewezen.` });
        }
      } catch (error) {
        setStatus(
          isInviteGone(error)
            ? { kind: "success", text: INVITE_GONE_TEXT }
            : { kind: "error", text: inviteRefusalText(error, action) },
        );
      } finally {
        setBusyId(null);
      }
    });

  return (
    <Screen underHeader>
      {status && <Notice kind={status.kind} message={status.text} />}
      {invites.length === 0 ? (
        <EmptyState icon="mail" title="Geen uitnodigingen" text="Als iemand je uitnodigt voor een groep, zie je dat hier." />
      ) : (
        invites.map((invite) => (
          <ReceivedCard
            key={invite._id}
            invite={invite}
            busy={busyId === invite._id}
            disabled={busyId !== null}
            onAccept={() => void act(invite, "accept")}
            onDecline={() => void act(invite, "decline")}
          />
        ))
      )}
    </Screen>
  );
}

function ReceivedCard({
  invite,
  busy,
  disabled,
  onAccept,
  onDecline,
}: {
  invite: Received;
  busy: boolean;
  disabled: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors } = useTheme();
  const inviter = invite.inviter;
  const inviterName = inviter?.name ?? "Iemand";
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        {invite.group.hasCover ? (
          <InviteCover
            inviteId={invite._id}
            name={invite.group.name}
            exifOrientation={invite.group.coverOrientation}
          />
        ) : (
          <LetterTile name={invite.group.name} size={COVER} radius={radius.albumTile} />
        )}
        <View style={styles.flex}>
          <Text variant="albumName">{invite.group.name}</Text>
          <Text variant="albumMeta" color="muted">
            {[invite.role === "admin" ? "Als admin" : null, validUntilText(invite.expiresAt)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
      <View style={styles.from}>
        <ProfileAvatar
          userId={inviter?._id}
          name={inviter?.name ?? null}
          size={size.avatar}
          exifOrientation={inviter?.profileOrientation}
          version={inviter?.profileVersion}
          hasFormats={inviter?.profileHasFormats}
        />
        <Text style={styles.flex}>{`${inviterName} nodigt je uit`}</Text>
      </View>
      {invite.message ? <Text style={styles.message}>{`“${invite.message}”`}</Text> : null}
      <Button title="Accepteren" busyTitle="Bezig…" busy={busy} disabled={disabled && !busy} onPress={onAccept} />
      <Button title="Afwijzen" variant="secondary" disabled={disabled} onPress={onDecline} />
    </View>
  );
}

const COVER = 64;

const styles = StyleSheet.create({
  block: { gap: space.s },
  section: { gap: space.s },
  flex: { flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: size.row },
  member: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  card: { gap: space.m, padding: space.l, borderRadius: radius.albumTile },
  head: { flexDirection: "row", alignItems: "center", gap: space.m },
  from: { flexDirection: "row", alignItems: "center", gap: space.m },
  message: { fontStyle: "italic" },
});
