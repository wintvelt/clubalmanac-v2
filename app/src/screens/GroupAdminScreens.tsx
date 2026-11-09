import { useAuth } from "@clerk/expo";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, Alert, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../components/Button";
import { LetterTile } from "../components/LetterTile";
import { Notice } from "../components/Notice";
import { PhotoImage } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import { api } from "../convexApi";
import { clearDeparting, markDeparting, setNotice, useDeparting } from "../data/adminState";
import { forgetLastGroup } from "../data/lastGroup";
import { useLiveQuery } from "../data/useLiveQuery";
import {
  changedFields,
  dayFromPicker,
  dayOf,
  DELETE_ALBUM_CONFIRMATION,
  DELETE_GROUP_CONFIRMATION,
  groupRights,
  newGroupArgs,
  pickerDate,
  refusalOf,
  type AdminAction,
  type Confirmation,
  type Day,
  type Refusal,
} from "../lib/groupAdmin";
import { albumPath, groupPath } from "../lib/groupRoutes";
import { groupErrorKind } from "../lib/groups";
import { radius, size, space, useTheme } from "../theme";
import { toMyGroups } from "./AlbumParts";
import { LoadError, type CoverPhoto } from "./GroupParts";

// WP28b: Nieuwe groep, Nieuw album (modaal), Bewerk groep en Bewerk album
// (scherm erboven). Spec: docs/work-packages/WP28-groepsbeheer.md §WP28b,
// §Opbouw van de schermen. Elk ding staat één keer; "Bewaar" kan pas na een
// wijziging en stuurt alleen wat wijzigde (A-invariant 20). Een weigering geeft
// de melding uit de code, bij het veld of onder de knop (A-invariant 21).

// --- Gedeeld -----------------------------------------------------------------------

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

function FieldError({ refusal, field }: { refusal: Refusal | null; field: Refusal["field"] }) {
  return refusal?.field === field ? <Notice kind="error" message={refusal.text} /> : null;
}

// --- Nieuwe groep, Nieuw album -------------------------------------------------------

export function NewGroupScreen() {
  const create = useMutation(api.groups.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const once = useOnce();
  const ready = name.trim().length > 0;

  const submit = () =>
    once(async () => {
      if (!ready) return;
      setBusy(true);
      setRefusal(null);
      try {
        const groupId = await create(newGroupArgs({ name, description }));
        router.replace(groupPath(groupId));
      } catch (error) {
        setRefusal(refusalOf(error, "createGroup"));
      } finally {
        setBusy(false);
      }
    });

  return (
    <Screen underHeader>
      <View style={styles.field}>
        <TextField
          label="Naam"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setRefusal(null);
          }}
          invalid={refusal?.field === "name"}
          autoCapitalize="sentences"
          returnKeyType="next"
        />
        <FieldError refusal={refusal} field="name" />
      </View>
      <TextField
        label="Omschrijving"
        value={description}
        onChangeText={(text) => {
          setDescription(text);
          setRefusal(null);
        }}
        autoCapitalize="sentences"
        multiline
      />
      <View style={styles.field}>
        {!ready && (
          <Text variant="meta" color="muted">
            Vul eerst een naam in.
          </Text>
        )}
        <Button title="Groep maken" busyTitle="Maken…" busy={busy} disabled={!ready} onPress={() => void submit()} />
        <FieldError refusal={refusal} field="general" />
      </View>
    </Screen>
  );
}

export function NewAlbumScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const create = useMutation(api.albums.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const once = useOnce();
  const ready = name.trim().length > 0;

  const submit = () =>
    once(async () => {
      if (!ready) return;
      setBusy(true);
      setRefusal(null);
      try {
        const albumId = await create({ groupId: gid, name: name.trim() });
        router.replace(albumPath(gid, albumId));
      } catch (error) {
        setRefusal(refusalOf(error, "createAlbum"));
      } finally {
        setBusy(false);
      }
    });

  return (
    <Screen underHeader>
      <View style={styles.field}>
        <TextField
          label="Naam"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setRefusal(null);
          }}
          invalid={refusal?.field === "name"}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <FieldError refusal={refusal} field="name" />
      </View>
      <View style={styles.field}>
        {!ready && (
          <Text variant="meta" color="muted">
            Vul eerst een naam in.
          </Text>
        )}
        <Button title="Album maken" busyTitle="Maken…" busy={busy} disabled={!ready} onPress={() => void submit()} />
        <FieldError refusal={refusal} field="general" />
        <Text variant="meta" color="muted">
          De datum en de cover kies je daarna, bij Bewerk album.
        </Text>
      </View>
    </Screen>
  );
}

// --- Bewerk groep, Bewerk album ------------------------------------------------------

type Kind = "group" | "album";

const TEXTS: Record<
  Kind,
  { title: string; loading: string; coverHint: string; dateHint: string; delete: string; cover: AdminAction; edit: AdminAction; remove: AdminAction }
> = {
  group: {
    title: "Bewerk groep",
    loading: "Groep laden…",
    coverHint: "Een cover kies je bij een foto in een album: Acties, Als groepscover.",
    dateHint: "Bepaalt het jaar en de volgorde in Mijn groepen.",
    delete: "Groep verwijderen",
    cover: "removeGroupCover",
    edit: "editGroup",
    remove: "deleteGroup",
  },
  album: {
    title: "Bewerk album",
    loading: "Album laden…",
    coverHint: "Een cover kies je bij een foto in dit album: Acties, Als albumcover.",
    dateHint: "Bepaalt het jaar en de volgorde in de groep.",
    delete: "Album verwijderen",
    cover: "removeAlbumCover",
    edit: "editAlbum",
    remove: "deleteAlbum",
  },
};

export function EditGroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const departing = useDeparting(gid);
  return (
    <QueryBoundary
      key={gid}
      fallback={(error, reset) => (
        <EditFailed kind="group" departing={departing} notMember={groupErrorKind(error) === "notMember"} reset={reset} />
      )}
    >
      <EditGroupContent groupId={gid} />
    </QueryBoundary>
  );
}

export function EditAlbumScreen() {
  const { groupId, albumId } = useLocalSearchParams<{ groupId: string; albumId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const aid = String(albumId) as Id<"albums">;
  const departing = useDeparting(aid);
  return (
    <QueryBoundary
      key={aid}
      fallback={(error, reset) => (
        <EditFailed kind="album" departing={departing} notMember={groupErrorKind(error) === "notMember"} reset={reset} />
      )}
    >
      <EditAlbumContent groupId={gid} albumId={aid} />
    </QueryBoundary>
  );
}

// A-invariant 23: na verwijderen geen "geen lid" tussendoor, alleen "Bezig…"
// tot de app weg is.
function EditFailed({
  kind,
  departing,
  notMember,
  reset,
}: {
  kind: Kind;
  departing: boolean;
  notMember: boolean;
  reset: () => void;
}) {
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: TEXTS[kind].title }} />
      {departing ? (
        <LoadingState label="Bezig…" />
      ) : notMember ? (
        <>
          <Notice kind="error" message={refusalOf(new ConvexError({ code: "NOT_MEMBER" }), TEXTS[kind].edit).text} />
          <Button title="Naar Mijn groepen" icon="groups" onPress={toMyGroups} />
        </>
      ) : (
        <LoadError title={kind === "group" ? "Deze groep laden lukt niet" : "Dit album laden lukt niet"} onRetry={reset} />
      )}
    </Screen>
  );
}

function useViewer(groupId: Id<"groups">) {
  const mine = useLiveQuery(api.groups.listMine, {});
  const me = useLiveQuery(api.users.profile, {});
  const group = mine?.find((g) => g._id === groupId);
  if (!me || !group) return undefined;
  return groupRights({ me: me._id, role: group.role, founderId: group.createdBy });
}

function EditGroupContent({ groupId }: { groupId: Id<"groups"> }) {
  const group = useLiveQuery(api.groups.getWithCover, { groupId });
  const rights = useViewer(groupId);
  const update = useMutation(api.groups.update);
  const remove = useMutation(api.groups.remove);
  const { userId } = useAuth();

  if (group === undefined || rights === undefined) return <Loading kind="group" />;
  if (group === null) return <EditFailed kind="group" departing={false} notMember reset={() => {}} />;

  return (
    <EditForm
      kind="group"
      stored={group}
      cover={group.coverPhotoId ? group.cover : null}
      canEdit={rights.editGroup}
      canDelete={rights.deleteGroup}
      withDescription
      save={(changes) => update({ groupId, ...changes })}
      removeCover={() => update({ groupId, coverPhotoId: null })}
      remove={async () => {
        const name = group.name;
        markDeparting(groupId);
        try {
          await remove({ groupId });
        } catch (error) {
          clearDeparting(groupId);
          throw error;
        }
        if (userId) void forgetLastGroup(userId, groupId);
        setNotice("myGroups", `${name} is verwijderd`);
        toMyGroups();
      }}
    />
  );
}

function EditAlbumContent({ groupId, albumId }: { groupId: Id<"groups">; albumId: Id<"albums"> }) {
  const album = useLiveQuery(api.albums.getWithCover, { albumId });
  const rights = useViewer(groupId);
  const update = useMutation(api.albums.update);
  const remove = useMutation(api.albums.remove);

  if (album === undefined || rights === undefined) return <Loading kind="album" />;

  return (
    <EditForm
      kind="album"
      stored={album}
      cover={album.coverPhotoId ? album.cover : null}
      canEdit={rights.editAlbum}
      canDelete={rights.deleteAlbum}
      withDescription={false}
      save={(changes) => update({ albumId, ...changes })}
      removeCover={() => update({ albumId, coverPhotoId: null })}
      remove={async () => {
        const name = album.name;
        markDeparting(albumId);
        try {
          await remove({ albumId });
        } catch (error) {
          clearDeparting(albumId);
          throw error;
        }
        setNotice(`group:${groupId}`, `${name} is verwijderd`);
        router.dismissTo(groupPath(groupId));
      }}
    />
  );
}

function Loading({ kind }: { kind: Kind }) {
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: TEXTS[kind].title }} />
      <LoadingState label={TEXTS[kind].loading} />
    </Screen>
  );
}

type Stored = { name: string; description?: string; sortDate?: number; createdAt: number };
type Draft = { name: string; description: string; day: Day };
type Status = { kind: "error" | "success"; text: string } | null;

function EditForm({
  kind,
  stored,
  cover,
  canEdit,
  canDelete,
  withDescription,
  save,
  removeCover,
  remove,
}: {
  kind: Kind;
  stored: Stored;
  cover: CoverPhoto | null;
  canEdit: boolean;
  canDelete: boolean;
  withDescription: boolean;
  save: (changes: { name?: string; description?: string; sortDate?: number }) => Promise<unknown>;
  removeCover: () => Promise<unknown>;
  remove: () => Promise<void>;
}) {
  const texts = TEXTS[kind];
  // null: niets aangeraakt, het formulier volgt de live waarden.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ kind: "saved" } | { kind: "refused"; refusal: Refusal } | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverStatus, setCoverStatus] = useState<Status>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const once = useOnce();

  const current: Draft = draft ?? { name: stored.name, description: stored.description ?? "", day: dayOf(stored) };
  const changes = changedFields(stored, withDescription ? current : { name: current.name, day: current.day });
  const refusal = saveStatus?.kind === "refused" ? saveStatus.refusal : null;

  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...current, ...patch });
    setSaveStatus(null);
    setCoverStatus(null);
    setDeleteError(null);
  };

  const onSave = () =>
    once(async () => {
      if (!changes) return;
      setSaving(true);
      setSaveStatus(null);
      try {
        await save(changes);
        setDraft(null);
        setSaveStatus({ kind: "saved" });
      } catch (error) {
        setSaveStatus({ kind: "refused", refusal: refusalOf(error, texts.edit) });
      } finally {
        setSaving(false);
      }
    });

  const onCoverMenu = () => {
    setCoverStatus(null);
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Cover weghalen", "Annuleren"], cancelButtonIndex: 1 },
      (index) => {
        if (index !== 0) return;
        void once(async () => {
          setCoverBusy(true);
          try {
            await removeCover();
            setCoverStatus({ kind: "success", text: "Cover weggehaald" });
          } catch (error) {
            setCoverStatus({ kind: "error", text: refusalOf(error, texts.cover).text });
          } finally {
            setCoverBusy(false);
          }
        });
      },
    );
  };

  const onDelete = () =>
    once(async () => {
      setDeleteError(null);
      const ok = await confirm(kind === "group" ? DELETE_GROUP_CONFIRMATION : DELETE_ALBUM_CONFIRMATION);
      if (!ok) return;
      setDeleting(true);
      try {
        await remove();
      } catch (error) {
        setDeleteError(refusalOf(error, texts.remove).text);
        setDeleting(false);
      }
    });

  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: texts.title }} />
      {!canEdit ? (
        <Notice kind="error" message={refusalOf(new ConvexError({ code: "NOT_ALLOWED" }), texts.edit).text} />
      ) : (
        <>
          <CoverBlock
            name={current.name.trim() || stored.name}
            cover={cover}
            hint={texts.coverHint}
            busy={coverBusy}
            onMenu={onCoverMenu}
            status={coverStatus}
          />

          <View style={styles.field}>
            <TextField
              label="Naam"
              value={current.name}
              onChangeText={(name) => edit({ name })}
              invalid={refusal?.field === "name"}
              autoCapitalize="sentences"
            />
            <FieldError refusal={refusal} field="name" />
          </View>

          {withDescription && (
            <TextField
              label="Omschrijving"
              value={current.description}
              onChangeText={(description) => edit({ description })}
              autoCapitalize="sentences"
              multiline
            />
          )}

          <DateBlock day={current.day} hint={texts.dateHint} invalid={refusal?.field === "date"} onChange={(day) => edit({ day })}>
            <FieldError refusal={refusal} field="date" />
          </DateBlock>

          <View style={styles.field}>
            {!changes && !saving && (
              <Text variant="meta" color="muted">
                Nog niets gewijzigd.
              </Text>
            )}
            <Button title="Bewaar" busyTitle="Bewaren…" busy={saving} disabled={!changes} onPress={() => void onSave()} />
            <FieldError refusal={refusal} field="general" />
            {saveStatus?.kind === "saved" && <Notice kind="success" message="Opgeslagen" />}
          </View>
        </>
      )}

      {canDelete && (
        <View style={[styles.field, styles.danger]}>
          <SmallButton
            title={deleting ? "Verwijderen…" : texts.delete}
            icon="trash"
            tone="danger"
            disabled={deleting}
            onPress={() => void onDelete()}
          />
          {deleteError && <Notice kind="error" message={deleteError} />}
        </View>
      )}
    </Screen>
  );
}

// Bovenaan de cover gecentreerd, of de letter, met een menu als er een cover is.
function CoverBlock({
  name,
  cover,
  hint,
  busy,
  onMenu,
  status,
}: {
  name: string;
  cover: CoverPhoto | null;
  hint: string;
  busy: boolean;
  onMenu: () => void;
  status: Status;
}) {
  const side = size.groupTile * 2;
  const letter = <LetterTile name={name} size={side} radius={radius.groupPhoto} variant="largeTitle" />;
  return (
    <View style={styles.cover}>
      {cover ? (
        <PhotoImage
          photoId={cover._id}
          format="groot"
          exifOrientation={cover.exifOrientation}
          hasFormats={cover.hasFormats}
          box={{ width: side, height: side }}
          radius={radius.groupPhoto}
          fallback={letter}
          accessibilityLabel="Cover"
        />
      ) : (
        letter
      )}
      {cover && (
        <View style={styles.center}>
          <SmallButton
            title={busy ? "Weghalen…" : "Acties"}
            icon="more"
            accessibilityLabel="Acties voor de cover"
            disabled={busy}
            onPress={onMenu}
          />
        </View>
      )}
      {status && <Notice kind={status.kind} message={status.text} />}
      <Text variant="meta" color="muted" style={styles.centerText}>
        {hint}
      </Text>
    </View>
  );
}

// De kiezer werkt met de klok van het toestel (A-invariant 19); de getoonde dag
// is de dag van sortDate (UTC), anders van createdAt in NL-tijd.
function DateBlock({
  day,
  hint,
  invalid,
  onChange,
  children,
}: {
  day: Day;
  hint: string;
  invalid: boolean;
  onChange: (day: Day) => void;
  children?: ReactNode;
}) {
  const { colors, scheme } = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="fieldLabel">Datum</Text>
      <View style={[styles.picker, { backgroundColor: colors.field, borderColor: invalid ? colors.danger : colors.fieldLine }]}>
        <DateTimePicker
          value={pickerDate(day)}
          mode="date"
          display="spinner"
          locale="nl-NL"
          themeVariant={scheme}
          textColor={colors.text}
          onValueChange={(_event, date) => onChange(dayFromPicker(date))}
        />
      </View>
      <Text variant="meta" color="muted">
        {hint}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  cover: { alignItems: "center", gap: space.s },
  center: { alignItems: "center" },
  centerText: { textAlign: "center" },
  picker: { borderWidth: 1, borderRadius: radius.field, overflow: "hidden" },
  danger: { marginTop: space.xl },
});
