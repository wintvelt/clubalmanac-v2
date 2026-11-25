import { useAuth } from "@clerk/expo";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { originalUploaderAvailable } from "../../modules/clubalmanac-video";
import { Button } from "../components/Button";
import { DayPicker } from "../components/DayPicker";
import { ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { FounderButton } from "../components/FounderButton";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import { api } from "../convexApi";
import { askConfirmation } from "../data/confirm";
import { originalEvent } from "../data/originals";
import { startDownload } from "../data/originalDownload";
import { useLiveQuery } from "../data/useLiveQuery";
import { useWideLayout } from "../components/wideLayout";
import {
  FOUNDER_BUTTONS,
  WITHDRAW_CONFIRMATION,
  allRows,
  closeConfirmation,
  downloadAll,
  downloadAllIds,
  downloadHeaderText,
  downloadRows,
  downloadStatusText,
  dutchDayOf,
  endDayRange,
  endOfDutchDay,
  filmRefusalText,
  formatBytes,
  mineRows,
  originalMetaText,
  projectPageView,
  projectStatusText,
  projectTitle,
  removeAllConfirmation,
  standText,
  submittedDayText,
  submittedText,
  takenText,
  type FilmAction,
  type MineRow,
  type MineStand,
  type ProjectOriginal,
} from "../lib/filmProject";
import { formatDay, type Day } from "../lib/groupAdmin";
import { filmProjectPath, groupPath } from "../lib/groupRoutes";
import { groupErrorKind } from "../lib/groups";
import { formatDuration } from "../lib/videos";
import { radius, size, space, useTheme } from "../theme";
import { LoadError } from "./GroupParts";
import { WideSide, WideSplit } from "./WideSide";
import { FILM_PLATFORM, OriginalPoster, WifiOnlySwitch, useNow, useOriginals } from "./FilmProjectParts";

// WP38c: de schermen van het filmproject. Spec:
// docs/work-packages/WP38-filmproject-originelen.md §Opdracht 38c,
// §Spec-criticus 38c (lege en foutstanden, webapp-varianten, invarianten), en
// de mockup (builds/filmproject-mockup.html).
//
// - Projectpagina (alle leden), onder de groep: de schakelaar "Alleen via
//   wifi", "Mijn filmpjes" met de stand uit de wachtrij van dit toestel (ook
//   wat nog niet is aangemeld) en Terugtrekken, en "Alle filmpjes" (alleen wat
//   binnen is). De oprichter sluit en verschuift de einddatum (in de app).
// - Op het web is de projectpagina alleen te bekijken; de oprichter krijgt er
//   de downloadpagina: download per origineel met een gewone link, "Alles
//   downloaden" na elkaar met verse links, en "Alles verwijderen" na sluiten.
//   Dat is de enige schrijfactie van het filmproject op het web (WP35 W5,
//   blind spot 2).
// - Starten (oprichter, alleen in de app): een titel en een einddatum
//   (besluit 27). De oprichter wijzigt de titel op de projectpagina, ook na
//   sluiten.
// - Een weigering toont de tekst bij de code (filmRefusalText), nooit de fout.

type ProjectData = FunctionReturnType<typeof api.filmProjects.get>;

/** Standaard einddatum: over 14 dagen (A-keuze). */
const DEFAULT_END_DAYS = 14;
/** Tussen twee downloads van "Alles downloaden", zodat de browser elk bestand start. */
const DOWNLOAD_GAP_MS = 1500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

type Status = { kind: "error" | "success"; text: string } | null;

// --- de projectpagina ------------------------------------------------------------------

export function FilmProjectScreen() {
  const { groupId, projectId } = useLocalSearchParams<{ groupId: string; projectId: string }>();
  const gid = String(groupId) as Id<"groups">;
  const pid = String(projectId);
  return (
    <QueryBoundary key={pid} fallback={(error, reset) => <ProjectFailed groupId={gid} error={error} reset={reset} />}>
      <ProjectContent projectId={pid} />
    </QueryBoundary>
  );
}

// NOT_MEMBER: geen lid (meer), of het project is weg (na een jaar). Met een weg
// terug naar de groep.
function ProjectFailed({ groupId, error, reset }: { groupId: Id<"groups">; error: unknown; reset: () => void }) {
  if (groupErrorKind(error) === "notMember") {
    return (
      <Screen underHeader>
        <Notice kind="error" message="Dit filmproject is er niet meer." />
        <SmallButton title="Naar de groep" icon="groups" onPress={() => router.replace(groupPath(groupId))} />
      </Screen>
    );
  }
  return (
    <Screen underHeader>
      <LoadError title="Dit filmproject laden lukt niet" onRetry={reset} />
    </Screen>
  );
}

function ProjectContent({ projectId }: { projectId: string }) {
  const data = useLiveQuery(api.filmProjects.get, { projectId });
  if (data === undefined) {
    return (
      <Screen underHeader>
        <LoadingState label="Laden…" />
      </Screen>
    );
  }
  const view = projectPageView({
    platform: FILM_PLATFORM,
    uploader: originalUploaderAvailable,
    isFounder: data.isFounder,
    open: data.project.open,
    originals: data.originals,
  });
  if (view.download) return <DownloadPage data={data} view={view} />;
  return <ProjectPage data={data} view={view} />;
}

function ProjectPage({
  data,
  view,
}: {
  data: ProjectData;
  view: ReturnType<typeof projectPageView>;
}) {
  const { project, originals } = data;
  const now = useNow(30_000);
  const snap = useOriginals();
  const { userId } = useAuth();
  const withdraw = useMutation(api.filmProjects.withdraw);
  const actions = useProjectActions(project);
  const { run, busy, status } = actions;

  const device =
    FILM_PLATFORM === "ios" && originalUploaderAvailable && userId
      ? { userId, queue: snap.queue, wifiOnly: snap.wifiOnly, network: snap.network }
      : null;
  const mine = mineRows({ platform: FILM_PLATFORM, projectId: project.projectId, originals, device, now });
  const all = allRows(originals);
  const title = projectTitle(project.title);

  async function onWithdraw(row: MineRow) {
    const originalId = row.originalId;
    if (!originalId || !(await askConfirmation(WITHDRAW_CONFIRMATION))) return;
    await run(
      "withdraw",
      async () => {
        await withdraw({ originalId });
        // 38c-8: de wachtrij hoort het pas als het terugtrekken gelukt is.
        originalEvent({ kind: "teruggetrokken", originalId });
      },
      "Teruggetrokken. Het filmpje staat nog in het album.",
    );
  }

  const header = [
    projectStatusText(project, now),
    view.count === 1 ? "1 filmpje" : `${view.count} filmpjes`,
    view.underway !== null && view.underway > 0 ? `nog ${view.underway} onderweg` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Links (breed) of bovenaan (smal): titel, stand, schakelaar en de knoppen van de oprichter.
  const controls = (
    <>
      <FounderEdits project={project} view={view} now={now} actions={actions} withClose={false} />
      {view.wifiSwitch && <WifiOnlySwitch />}
    </>
  );
  const tail = (
    <>
      {view.downloadHint && (
        <Text variant="meta" color="muted">
          Downloaden kan in de webapp.
        </Text>
      )}
      {view.close && (
        <FounderButton button={FOUNDER_BUTTONS.close} tone="danger" disabled={busy} onPress={() => void actions.onClose()} />
      )}
    </>
  );
  const lists = (
    <>
      {status && <Notice kind={status.kind} message={status.text} />}

      {mine.length > 0 && (
        <View style={styles.section}>
          <Text variant="fieldLabel" color="muted" accessibilityRole="header">
            Mijn filmpjes
          </Text>
          <ListSection>
            {mine.map((row) => (
              <MineItem key={row.key} row={row} now={now} busy={busy} onWithdraw={() => void onWithdraw(row)} />
            ))}
          </ListSection>
        </View>
      )}

      {/* Breed en leeg: de lege stand in het midden van de rechterkolom (components/wideMain.ts). */}
      <View style={[styles.section, all.length === 0 && styles.fillRest]}>
        <Text variant="fieldLabel" color="muted" accessibilityRole="header">
          Alle filmpjes
        </Text>
        {all.length === 0 ? (
          <EmptyState
            icon="film"
            title="Nog geen filmpjes"
            text={
              project.open
                ? "Nieuwe filmpjes in deze groep gaan ook als origineel mee."
                : "Er is nog geen filmpje binnengekomen."
            }
          />
        ) : (
          <ListSection>
            {all.map((row) => (
              <View
                key={row.originalId}
                style={styles.row}
                accessible
                accessibilityLabel={`${row.name}, ${formatDuration(row.durationMs)}, ${originalMetaText(row, now)}`}
              >
                <OriginalPoster originalId={row.originalId} durationMs={row.durationMs} />
                <View style={styles.grow}>
                  <Text variant="albumName">{row.name}</Text>
                  <Text variant="albumMeta" color="muted">
                    {originalMetaText(row, now)}
                  </Text>
                </View>
              </View>
            ))}
          </ListSection>
        )}
      </View>
    </>
  );

  // Feedback derde ronde, punt 2: breed (webapp, iPad liggend) zoals de
  // groepspagina: links titel, stand, schakelaar en knoppen; rechts de lijsten.
  const wide = useWideLayout();
  if (wide) {
    return (
      <WideSplit
        side={
          <WideSide
            back={{ title: "Groep", onPress: () => backToGroup(project.groupId) }}
            name={title}
            cover={null}
            noCover
            meta={header}
          >
            {controls}
            {tail}
          </WideSide>
        }
      >
        <Stack.Screen options={{ title: "Filmproject", headerShown: false }} />
        <Screen underHeader>{lists}</Screen>
      </WideSplit>
    );
  }

  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: "Filmproject", headerShown: true }} />
      <View style={styles.intro}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="meta" color="muted">
          {header}
        </Text>
      </View>
      {controls}
      {lists}
      {tail}
    </Screen>
  );
}

// --- de handelingen van de oprichter op het project ----------------------------------------

type ProjectActions = ReturnType<typeof useProjectActions>;

/**
 * Sluiten, einddatum en titel wijzigen, met één melding en één handeling
 * tegelijk. In de app op de projectpagina, op het web op de downloadpagina
 * (feedback webapp dev, tweede ronde: een bewuste uitzondering op W5, alleen
 * voor de oprichter). Dezelfde bevestiging bij sluiten (`closeConfirmation`).
 */
function useProjectActions(project: ProjectData["project"]) {
  const close = useMutation(api.filmProjects.close);
  const setEndsAt = useMutation(api.filmProjects.setEndsAt);
  const setTitle = useMutation(api.filmProjects.setTitle);
  const once = useOnce();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [editingEnd, setEditingEnd] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  async function run(action: FilmAction, work: () => Promise<void>, success?: string) {
    await once(async () => {
      setBusy(true);
      setStatus(null);
      try {
        await work();
        if (success) setStatus({ kind: "success", text: success });
      } catch (error) {
        setStatus({ kind: "error", text: filmRefusalText(error, action) });
      } finally {
        setBusy(false);
      }
    });
  }

  async function onClose() {
    if (!(await askConfirmation(closeConfirmation(project.title)))) return;
    await run("close", () => close({ projectId: project.projectId }).then(() => undefined), "Het filmproject is gesloten.");
  }

  async function onChangeEnd(day: Day) {
    await run(
      "changeEnd",
      async () => {
        await setEndsAt({ projectId: project.projectId, endsAt: endOfDutchDay(day) });
        setEditingEnd(false);
      },
      `Open tot ${formatDay(day)}.`,
    );
  }

  // Besluit 27 (Wouter: ja): de titel wijzigen, ook na sluiten.
  async function onChangeTitle(next: string) {
    await run(
      "changeTitle",
      async () => {
        await setTitle({ projectId: project.projectId, title: next });
        setEditingTitle(false);
      },
      "De titel is gewijzigd.",
    );
  }

  return { run, busy, status, editingEnd, setEditingEnd, editingTitle, setEditingTitle, onClose, onChangeEnd, onChangeTitle };
}

/** De knoppen van de oprichter (gele sleutel) en de velden om titel en einddatum te wijzigen. */
function FounderEdits({
  project,
  view,
  now,
  actions,
  withClose,
}: {
  project: ProjectData["project"];
  view: { close: boolean; changeEnd: boolean; changeTitle: boolean };
  now: number;
  actions: ProjectActions;
  withClose: boolean;
}) {
  const { busy } = actions;
  const showClose = withClose && view.close;
  if (!view.changeTitle && !view.changeEnd && !showClose) return null;
  return (
    <>
      <View style={styles.buttons}>
        {view.changeTitle && (
          <FounderButton
            button={FOUNDER_BUTTONS.changeTitle}
            disabled={busy}
            onPress={() => actions.setEditingTitle((e) => !e)}
          />
        )}
        {view.changeEnd && (
          <FounderButton button={FOUNDER_BUTTONS.changeEnd} disabled={busy} onPress={() => actions.setEditingEnd((e) => !e)} />
        )}
        {showClose && (
          <FounderButton button={FOUNDER_BUTTONS.close} tone="danger" disabled={busy} onPress={() => void actions.onClose()} />
        )}
      </View>

      {actions.editingTitle && view.changeTitle && (
        <TitleEditor initial={project.title} busy={busy} onSave={(next) => void actions.onChangeTitle(next)} />
      )}

      {actions.editingEnd && view.changeEnd && (
        <EndDatePicker
          initial={dutchDayOf(project.endsAt)}
          now={now}
          busy={busy}
          saveTitle="Bewaar einddatum"
          onSave={(day) => void actions.onChangeEnd(day)}
        />
      )}
    </>
  );
}

const STAND_TONE: Record<MineStand, "wait" | "busy" | "ok"> = {
  binnen: "ok",
  wordt_verstuurd: "busy",
  wacht_op_wifi: "wait",
  wacht: "wait",
  elders: "wait",
  onderweg: "busy",
};

function MineItem({ row, now, busy, onWithdraw }: { row: MineRow; now: number; busy: boolean; onWithdraw: () => void }) {
  const { colors } = useTheme();
  const tone = STAND_TONE[row.stand];
  const pill =
    tone === "ok"
      ? { backgroundColor: colors.success, color: colors.onCta }
      : tone === "busy"
        ? { backgroundColor: colors.primary, color: colors.onCta }
        : { backgroundColor: colors.line, color: colors.text };
  const stand = standText(row.stand);
  const meta = [stand, row.bytes !== null ? formatBytes(row.bytes) : null].filter(Boolean).join(" · ");
  return (
    <View style={styles.row}>
      <OriginalPoster originalId={row.originalId} durationMs={row.durationMs} />
      <View style={styles.grow} accessible accessibilityLabel={`${submittedText(row.submittedAt, now)}, ${meta}`}>
        <Text variant="albumMeta" color="muted">
          {submittedText(row.submittedAt, now)}
        </Text>
        <View style={styles.pillRow}>
          <View style={[styles.pill, { backgroundColor: pill.backgroundColor }]}>
            <Text variant="badge" style={{ color: pill.color }}>
              {stand}
            </Text>
          </View>
          {row.bytes !== null && (
            <Text variant="albumMeta" color="muted">
              {formatBytes(row.bytes)}
            </Text>
          )}
        </View>
      </View>
      {row.canWithdraw && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Terugtrekken"
          disabled={busy}
          onPress={onWithdraw}
          hitSlop={space.s}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text variant="barLabel" color="danger">
            Terugtrekken
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// --- de downloadpagina (webapp, oprichter) -------------------------------------------------

function DownloadPage({ data, view }: { data: ProjectData; view: ReturnType<typeof projectPageView> }) {
  const { project, originals } = data;
  const canRemoveAll = view.removeAll;
  const now = useNow(60_000);
  // Feedback webapp dev, tweede ronde: sluiten, titel en einddatum ook hier.
  const actions = useProjectActions(project);
  const downloadUrl = useAction(api.filmProjects.downloadUrl);
  const removeAll = useMutation(api.filmProjects.removeAll);
  const once = useOnce();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  // Fix-cyclus 1, punt 3: een foutmelding per rij.
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const rows = downloadRows(originals);
  const all = downloadAllIds(originals);

  // Een verse link per origineel, en dan een gewone link (geen fetch, 38c-17).
  // `null`: gelukt; anders de tekst voor die rij.
  async function downloadOne(originalId: string): Promise<string | null> {
    try {
      const { url } = await downloadUrl({ originalId });
      return startDownload(url) ? null : filmRefusalText(null, "download");
    } catch (error) {
      return filmRefusalText(error, "download");
    }
  }

  const onDownload = (originalId: string) =>
    once(async () => {
      setBusy(originalId);
      setStatus(null);
      setRowErrors(new Map());
      try {
        setRowErrors(await downloadAll([originalId], downloadOne, () => wait(DOWNLOAD_GAP_MS)));
      } finally {
        setBusy(null);
      }
    });

  const onDownloadAll = () =>
    once(async () => {
      setBusy("all");
      setStatus(null);
      setRowErrors(new Map());
      try {
        const errors = await downloadAll(all, downloadOne, () => wait(DOWNLOAD_GAP_MS));
        setRowErrors(errors);
        if (errors.size > 0) {
          setStatus({
            kind: "error",
            text: errors.size === 1 ? "1 download lukte niet." : `${errors.size} downloads lukten niet.`,
          });
        }
      } finally {
        setBusy(null);
      }
    });

  const onRemoveAll = () =>
    once(async () => {
      if (!(await askConfirmation(removeAllConfirmation(originals.length)))) return;
      setBusy("remove");
      setStatus(null);
      setRowErrors(new Map());
      try {
        await removeAll({ projectId: project.projectId });
        setStatus({ kind: "success", text: "Alle originelen zijn verwijderd." });
      } catch (error) {
        setStatus({ kind: "error", text: filmRefusalText(error, "removeAll") });
      } finally {
        setBusy(null);
      }
    });

  const headerText = downloadHeaderText(project, originals, now);
  // Links (breed) of bovenaan (smal): de knoppen van de oprichter.
  const controls = (
    <>
      <FounderEdits project={project} view={view} now={now} actions={actions} withClose />
      {actions.status && <Notice kind={actions.status.kind} message={actions.status.text} />}
      {all.length > 0 && (
        <FounderButton
          button={FOUNDER_BUTTONS.downloadAll}
          busyTitle={busy === "all" ? "Downloaden…" : undefined}
          disabled={busy !== null}
          onPress={() => void onDownloadAll()}
        />
      )}
    </>
  );
  const removeAllButton = canRemoveAll ? (
    <FounderButton
      button={FOUNDER_BUTTONS.removeAll}
      tone="danger"
      disabled={busy !== null}
      onPress={() => void onRemoveAll()}
    />
  ) : null;
  const list = (
    <>
      {status && <Notice kind={status.kind} message={status.text} />}
      {rows.length === 0 ? (
        <EmptyState icon="film" title="Nog geen filmpjes" text="Er is nog geen origineel ingestuurd." />
      ) : (
        <ListSection>
          {rows.map((o) => (
            <DownloadRow
              key={o.originalId}
              original={o}
              canDownload={o.canDownload}
              now={now}
              busy={busy !== null}
              error={rowErrors.get(o.originalId) ?? null}
              onDownload={() => void onDownload(o.originalId)}
            />
          ))}
        </ListSection>
      )}
    </>
  );

  // Feedback derde ronde, punt 2: breed zoals de groepspagina.
  const wide = useWideLayout();
  if (wide) {
    return (
      <WideSplit
        side={
          <WideSide
            back={{ title: "Groep", onPress: () => backToGroup(project.groupId) }}
            name={projectTitle(project.title)}
            cover={null}
            noCover
            meta={headerText}
          >
            {controls}
            {removeAllButton}
          </WideSide>
        }
      >
        <Stack.Screen options={{ title: "Filmproject", headerShown: false }} />
        <Screen underHeader>{list}</Screen>
      </WideSplit>
    );
  }

  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: "Filmproject", headerShown: true }} />
      <View style={styles.intro}>
        <Text variant="title" accessibilityRole="header">
          {projectTitle(project.title)}
        </Text>
        <Text variant="meta" color="muted">
          {headerText}
        </Text>
      </View>
      {controls}
      {list}
      {removeAllButton}
    </Screen>
  );
}

/** Terug naar de groep: de stack terug, of (een directe link) naar de groep. */
function backToGroup(groupId: Id<"groups">) {
  if (router.canGoBack()) router.back();
  else router.replace(groupPath(groupId));
}

function DownloadRow({
  original,
  canDownload,
  now,
  busy,
  error,
  onDownload,
}: {
  original: ProjectOriginal;
  canDownload: boolean;
  now: number;
  busy: boolean;
  error: string | null;
  onDownload: () => void;
}) {
  const taken = takenText(original.takenAt, now);
  const meta = [
    taken ? `Opgenomen ${taken}` : null,
    `Ingestuurd ${submittedDayText(original.submittedAt, now)}`,
    formatDuration(original.durationMs),
    formatBytes(original.bytes),
    downloadStatusText(original, now),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.downloadRow}>
      <View style={styles.row}>
        <OriginalPoster originalId={original.originalId} durationMs={null} side={44} />
        <View style={styles.grow}>
          <Text variant="albumName">{original.ownerName}</Text>
          <Text variant="albumMeta" color="muted">
            {meta}
          </Text>
        </View>
        {canDownload && (
          <FounderButton
            button={FOUNDER_BUTTONS.download}
            labelSuffix={original.ownerName}
            disabled={busy}
            onPress={onDownload}
          />
        )}
      </View>
      {error && <Notice kind="error" message={error} />}
    </View>
  );
}

// --- starten (oprichter, alleen in de app) ---------------------------------------------------

export function NewFilmProjectScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  return <NewProject groupId={String(groupId) as Id<"groups">} />;
}

/**
 * Besluit 27: een titel en een einddatum, geen album. "Starten" blijft grijs
 * zolang de titel leeg is; een weigering over de titel zegt "titel".
 */
function NewProject({ groupId }: { groupId: Id<"groups"> }) {
  const open = useMutation(api.filmProjects.open);
  const once = useOnce();
  const [now] = useState(() => Date.now());
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const range = endDayRange(now);
  const [day, setDay] = useState<Day>(() => clampDay(dutchDayOf(now + DEFAULT_END_DAYS * 24 * 60 * 60 * 1000), range));
  const ready = title.trim().length > 0;

  const submit = () =>
    once(async () => {
      if (!ready) return;
      setBusy(true);
      setRefusal(null);
      try {
        const projectId = await open({ groupId, title: title.trim(), endsAt: endOfDutchDay(day) });
        router.replace(filmProjectPath(groupId, projectId));
      } catch (error) {
        setRefusal(filmRefusalText(error, "start"));
      } finally {
        setBusy(false);
      }
    });

  return (
    <Screen underHeader>
      <TextField
        label="Titel"
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          setRefusal(null);
        }}
        autoCapitalize="sentences"
        returnKeyType="done"
      />

      <EndDatePicker initial={day} now={now} busy={busy} onChange={setDay} />

      <View style={styles.section}>
        {!ready && (
          <Text variant="meta" color="muted">
            Vul eerst een titel in.
          </Text>
        )}
        <Button title="Starten" busyTitle="Starten…" busy={busy} disabled={!ready} onPress={() => void submit()} />
        {refusal && <Notice kind="error" message={refusal} />}
        <Text variant="meta" color="muted">
          Zolang het project open staat, gaat van elk nieuw filmpje in deze groep ook het origineel naar het project,
          in welk album het ook komt. Sluiten kan op de projectpagina.
        </Text>
      </View>
    </Screen>
  );
}

/** Besluit 27: de titel wijzigen op de projectpagina (oprichter, ook na sluiten). */
// Audit-nit na besluit 27: verandert de titel elders (een ander toestel), dan
// volgt het veld zolang er niet getypt is.
function TitleEditor({ initial, busy, onSave }: { initial: string; busy: boolean; onSave: (title: string) => void }) {
  const [title, setTitle] = useState(initial);
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (!typed) setTitle(initial);
  }, [initial, typed]);
  const changed = title.trim().length > 0 && title.trim() !== initial;
  return (
    <View style={styles.section}>
      <TextField
        label="Titel"
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          setTyped(true);
        }}
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={() => {
          if (changed) onSave(title.trim());
        }}
      />
      <SmallButton title="Bewaar titel" disabled={busy || !changed} onPress={() => onSave(title.trim())} />
    </View>
  );
}

function sameDay(a: Day, b: Day): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function dayKey(d: Day): number {
  return d.year * 10000 + d.month * 100 + d.day;
}

function clampDay(day: Day, range: { first: Day; last: Day }): Day {
  if (dayKey(day) < dayKey(range.first)) return range.first;
  if (dayKey(day) > dayKey(range.last)) return range.last;
  return day;
}

/**
 * De einddatum als dag (38c-11): het einde van die dag in Nederland. Te
 * kiezen van vandaag tot de laatste dag die de backend aanneemt. De kiezer
 * werkt met de dag van het toestel; die dag telt als Nederlandse dag.
 */
function EndDatePicker({
  initial,
  now,
  busy,
  onChange,
  onSave,
  saveTitle,
}: {
  initial: Day;
  now: number;
  busy: boolean;
  onChange?: (day: Day) => void;
  onSave?: (day: Day) => void;
  saveTitle?: string;
}) {
  const range = endDayRange(now);
  const [day, setDay] = useState<Day>(() => clampDay(initial, range));
  return (
    <View style={styles.section}>
      <Text variant="fieldLabel">Open tot</Text>
      <DayPicker
        day={day}
        min={range.first}
        max={range.last}
        onChange={(picked) => {
          const next = clampDay(picked, range);
          setDay(next);
          onChange?.(next);
        }}
      />
      <Text variant="meta" color="muted">
        {`Sluit vanzelf aan het eind van ${formatDay(day)}.`}
      </Text>
      {onSave && (
        <SmallButton
          title={saveTitle ?? "Bewaar"}
          disabled={busy || sameDay(day, initial)}
          onPress={() => onSave(day)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.xs },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  fillRest: { flexGrow: 1 },
  section: { gap: space.s },
  row: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  downloadRow: { gap: space.xs, paddingBottom: space.xs },
  grow: { flex: 1, gap: 2 },
  pillRow: { flexDirection: "row", alignItems: "center", gap: space.s, flexWrap: "wrap" },
  pill: { alignSelf: "flex-start", paddingHorizontal: space.s, paddingVertical: 2, borderRadius: radius.pill },
  link: { minHeight: size.touchMin, justifyContent: "center" },
  pressed: { opacity: 0.6 },
});
