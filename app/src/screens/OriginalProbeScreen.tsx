import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, Switch, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  freeBytes,
  listOriginals,
  originalInfo,
  originalSha256,
  originalUploaderAvailable,
  partsBytes,
  uploaderClearLog,
  uploaderExitAfterBackgroundSend,
  uploaderJobs,
  uploaderLog,
  uploaderSetExitAfterBackgroundSend,
  type UploaderJobView,
  type UploaderLogEntry,
} from "../../modules/clubalmanac-video";
import { ListSection } from "../components/ListRow";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SmallButton } from "../components/SmallButton";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { DEV_TOOLS } from "../data/devTools";
import { originalEvent, originalsSnapshot, setOriginalsWifiOnly, listenOriginals } from "../data/originals";
import { useAppState } from "../data/useAppState";
import { useLiveQuery } from "../data/useLiveQuery";
import { bytesText, clock, dayTime, durationText, errorText } from "../lib/originalProbe";
import { ownOriginalStand, type QueueEntry } from "../lib/originalQueue";
import { waitsForWifi } from "../lib/originalUpload";
import { space, useTheme } from "../theme";
import { StatusScreen } from "./StatusScreen";

// WP38b (docs/work-packages/WP38-filmproject-originelen.md, Gate 38b): een
// proefscherm voor de gate op de iPhone, alleen in een build tegen dev,
// bereikbaar vanuit Instellingen. Geen scherm van 38c.
//
// Het toont de wachtrij van dit toestel met de stand per origineel
// (`ownOriginalStand`), de delen bij iOS, of het bewaarde bestand er nog is,
// de schakelaar "Alleen via wifi", terugtrekken, de SHA-256 van het bewaarde
// bestand en het log van de uploader. Voor gate 6 (koud) een schakelaar die de
// app zichzelf laat stoppen direct nadat hij op de achtergrond delen aan iOS
// gaf (één keer). Daarnaast een filmproject openen en
// sluiten (oprichter), zodat de gate zonder de schermen van 38c kan. Een
// filmpje toevoegen gaat via het gewone toevoegscherm. Nooit een link of pad
// in beeld of in het log.

const DAY_MS = 24 * 60 * 60 * 1000;

function refusal(e: unknown): unknown {
  return e instanceof ConvexError ? e.data : undefined;
}

export function OriginalProbeScreen() {
  if (!DEV_TOOLS) {
    return <StatusScreen title="Niet beschikbaar" message="Dit proefscherm is er alleen in een dev-build." />;
  }
  if (!originalUploaderAvailable) {
    return <StatusScreen title="Geen uploader" message="Deze build heeft de uploader voor originelen nog niet." />;
  }
  return <ProbeBody />;
}

type FileState = { exists: boolean; bytes: number };

function ProbeBody() {
  const appState = useAppState();
  const snap = useSyncExternalStore(listenOriginals, originalsSnapshot);
  const [jobs, setJobs] = useState<UploaderJobView[]>([]);
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [folder, setFolder] = useState<{ count: number; parts: number; free: number | null } | null>(null);
  const [log, setLog] = useState<UploaderLogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  // Gate 6, koud: `null` als de build het niet kan.
  const [exitAfter, setExitAfter] = useState<boolean | null>(null);
  const withdraw = useMutation(api.filmProjects.withdraw);

  const refresh = useCallback(async () => {
    try {
      const [j, l, names, parts, free] = await Promise.all([
        uploaderJobs(),
        uploaderLog(300),
        listOriginals(),
        partsBytes(),
        freeBytes(),
      ]);
      setJobs(j);
      setLog(l);
      setExitAfter(await uploaderExitAfterBackgroundSend().catch(() => null));
      setFolder({ count: names.length, parts, free });
      const next: Record<string, FileState> = {};
      for (const e of originalsSnapshot().queue) {
        try {
          const info = await originalInfo(e.fileName);
          next[e.fileName] = { exists: info.exists, bytes: info.bytes };
        } catch {
          next[e.fileName] = { exists: false, bytes: 0 };
        }
      }
      setFiles(next);
    } catch (e) {
      setMessage(`stand lezen mislukt: ${errorText(e)}`);
    }
  }, []);

  // Elke seconde de stand, zolang de app voor is.
  useEffect(() => {
    if (appState !== "active") return;
    void refresh();
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [appState, refresh]);

  async function act(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(`${label}: ${errorText(e, refusal(e))}`);
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  const doWithdraw = (entry: QueueEntry) =>
    act("terugtrekken", async () => {
      if (!entry.originalId) return;
      await withdraw({ originalId: entry.originalId });
      originalEvent({ kind: "teruggetrokken", originalId: entry.originalId });
      setMessage("teruggetrokken");
    });

  const hash = (entry: QueueEntry) =>
    act("SHA-256", async () => {
      const t0 = Date.now();
      const h = await originalSha256(entry.fileName);
      setHashes((prev) => ({ ...prev, [entry.key]: h }));
      setMessage(`SHA-256 in ${Math.round((Date.now() - t0) / 1000)} s`);
    });

  const waiting = waitsForWifi(snap.wifiOnly, snap.network);

  return (
    <Screen underHeader>
      <Section title="Toestel">
        <Line text={`Netwerk: ${snap.network.type}${snap.network.expensive ? ", duur" : ""}`} />
        <Line
          text={`Vrij: ${folder?.free != null ? bytesText(folder.free) : "?"} · deelbestanden ${folder ? bytesText(folder.parts) : "?"} · bestanden in de map: ${folder?.count ?? "?"}`}
        />
        <View style={styles.row}>
          <Text variant="body">Alleen via wifi</Text>
          <Switch
            value={snap.wifiOnly}
            onValueChange={(v) => void act("wifi", async () => void (await setOriginalsWifiOnly(v)))}
            disabled={busy !== null || !snap.loaded}
          />
        </View>
        {waiting ? <Line text="De delen wachten op wifi (geen mobiel internet, geen hotspot)." /> : null}
        {exitAfter !== null ? (
          <View style={styles.row}>
            <Text variant="body" style={styles.rowText}>
              Gate 6: app stopt na delen op de achtergrond
            </Text>
            <Switch
              value={exitAfter}
              onValueChange={(v) =>
                void act("gate 6", async () => {
                  await uploaderSetExitAfterBackgroundSend(v);
                  setExitAfter(v);
                })
              }
              disabled={busy !== null}
            />
          </View>
        ) : null}
        <Line text={`Wachtrij ${snap.loaded ? "geladen" : "nog niet geladen"} · ingelogd: ${snap.userId ? "ja" : "nee"}`} />
        {busy ? <Line text={`Bezig: ${busy}`} /> : null}
        {message ? <Line text={message} /> : null}
      </Section>

      <QueryBoundary fallback={(e, reset) => <ErrorBlock error={e} onRetry={reset} />}>
        <ProjectSection />
      </QueryBoundary>

      <Section title={`Wachtrij (${snap.queue.length})`}>
        {snap.queue.length === 0 ? <Line text="Leeg." /> : null}
        {snap.queue.map((entry) => (
          <EntryBlock
            key={entry.key}
            entry={entry}
            mine={entry.userId === snap.userId}
            job={entry.originalId ? jobs.find((j) => j.originalId === entry.originalId) : undefined}
            file={files[entry.fileName]}
            hash={hashes[entry.key]}
            stand={
              entry.originalId
                ? ownOriginalStand({
                    status: "onderweg",
                    originalId: entry.originalId,
                    queue: snap.queue,
                    wifiOnly: snap.wifiOnly,
                    network: snap.network,
                    now: Date.now(),
                  })
                : "nog niet aangemeld"
            }
            busy={busy !== null}
            onWithdraw={() => void doWithdraw(entry)}
            onHash={() => void hash(entry)}
          />
        ))}
        {jobs
          .filter((j) => !snap.queue.some((e) => e.originalId === j.originalId))
          .map((j) => (
            <Line key={j.originalId} text={`Bij iOS zonder wachtrij: ${j.originalId}`} />
          ))}
      </Section>

      <Section title="Log">
        <View style={styles.buttons}>
          <SmallButton title="Vernieuw" onPress={() => void refresh()} />
          <SmallButton
            title="Log wissen"
            tone="danger"
            onPress={() => void act("log wissen", () => uploaderClearLog())}
            disabled={busy !== null}
          />
        </View>
        {[...log].reverse().map((l, i) => (
          <Text key={`${l.at}-${i}`} variant="albumMeta" selectable>
            {`${clock(l.at)} · ${l.net} · ${l.text}`}
          </Text>
        ))}
      </Section>
    </Screen>
  );
}

function EntryBlock({
  entry,
  mine,
  job,
  file,
  hash,
  stand,
  busy,
  onWithdraw,
  onHash,
}: {
  entry: QueueEntry;
  mine: boolean;
  job: UploaderJobView | undefined;
  file: FileState | undefined;
  hash: string | undefined;
  stand: string;
  busy: boolean;
  onWithdraw: () => void;
  onHash: () => void;
}) {
  const done = job ? job.parts.filter((p) => p.state === "klaar").length : 0;
  const failed = job ? job.parts.filter((p) => p.state === "mislukt").length : 0;
  const sent = job ? job.parts.reduce((sum, p) => sum + (p.state === "klaar" ? p.size : p.sent), 0) : 0;
  const waits = [
    entry.waitUntil && entry.waitUntil > Date.now() ? `wacht tot ${dayTime(entry.waitUntil)}` : null,
    entry.busyUntil && entry.busyUntil > Date.now() ? `bezig-wacht tot ${dayTime(entry.busyUntil)}` : null,
  ].filter(Boolean);
  return (
    <View style={styles.block}>
      <Text variant="bodyStrong">{`Origineel van ${clock(entry.addedAt)}${mine ? "" : " (andere user)"}`}</Text>
      <Line text={`Stap: ${entry.step} · stand: ${stand}${waits.length ? ` · ${waits.join(", ")}` : ""}`} />
      <Line text={`${bytesText(entry.bytes)} (${entry.bytes} bytes) · bestand: ${file ? (file.exists ? `er (${file.bytes} bytes)` : "weg") : "?"}`} />
      {entry.originalId ? <Line text={`Inzending: ${entry.originalId}`} /> : null}
      {entry.linksValidUntil ? (
        <Line
          text={`Links tot ${dayTime(entry.linksValidUntil)} · rondes ${entry.rounds} · generatie ${entry.generation}${job ? ` (uploader ${job.generation})` : ""}`}
        />
      ) : null}
      {job ? (
        <Line
          text={`Delen: ${done} van ${job.parts.length} klaar, ${failed} mislukt · ${bytesText(sent)} van ${bytesText(job.totalBytes)}${job.broken ? " · bestand kapot" : ""}`}
        />
      ) : null}
      {hash ? (
        <Text variant="albumMeta" selectable>
          {`SHA-256: ${hash}`}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <SmallButton title="SHA-256" disabled={busy || !file?.exists} onPress={onHash} />
        {entry.originalId && mine ? (
          <SmallButton title="Terugtrekken" tone="danger" disabled={busy} onPress={onWithdraw} />
        ) : null}
      </View>
      {job
        ? job.parts.map((p) => (
            <Text key={p.partNumber} variant="albumMeta">
              {`Deel ${p.partNumber}: ${p.state}${p.state === "bezig" && p.size > 0 ? ` ${Math.round((p.sent / p.size) * 100)}%` : ""}` +
                `${p.status ? ` · ${p.status}` : ""}${p.code ? ` · ${p.code}` : ""}` +
                `${p.session ? ` · ${p.session}` : ""}${p.attempts ? ` · poging ${p.attempts}` : ""} · ${clock(p.updatedAt)}`}
            </Text>
          ))
        : null}
    </View>
  );
}

// --- filmproject (uit de spike) ---------------------------------------------------

function ProjectSection() {
  const groups = useLiveQuery(api.groups.listMine, {});
  const me = useLiveQuery(api.users.profile, {});
  const [groupId, setGroupId] = useState<string | null>(null);
  if (groups === undefined || me === undefined) {
    return (
      <Section title="Filmproject">
        <Line text="Laden…" />
      </Section>
    );
  }
  const founded = groups.filter((g) => me !== null && g.createdBy === me._id);
  return (
    <Section title="Filmproject">
      <Line text={founded.length ? "Groep (jij bent oprichter):" : "Je bent nergens oprichter."} />
      <View style={styles.buttons}>
        {founded.map((g) => (
          <SmallButton key={g._id} title={`${g._id === groupId ? "✓ " : ""}${g.name}`} onPress={() => setGroupId(g._id)} />
        ))}
      </View>
      {groupId ? (
        <QueryBoundary key={groupId} fallback={(e, reset) => <ErrorBlock error={e} onRetry={reset} />}>
          <GroupProjects groupId={groupId as Id<"groups">} />
        </QueryBoundary>
      ) : null}
      <Line text="Een filmpje toevoegen gaat via het gewone toevoegscherm (de + in een album van de groep)." />
    </Section>
  );
}

function GroupProjects({ groupId }: { groupId: Id<"groups"> }) {
  const projects = useLiveQuery(api.filmProjects.listForGroup, { groupId });
  const albums = useLiveQuery(api.albums.listByGroup, { groupId });
  const openProject = useMutation(api.filmProjects.open);
  const closeProject = useMutation(api.filmProjects.close);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (projects === undefined || albums === undefined) return <Line text="Projecten laden…" />;
  const current = projects.find((p) => p.open);

  async function act(label: string, fn: () => Promise<unknown>) {
    if (working) return;
    setWorking(true);
    try {
      await fn();
      setNote(`${label}: gelukt`);
    } catch (e) {
      setNote(`${label} geweigerd: ${errorText(e, refusal(e))}`);
    } finally {
      setWorking(false);
    }
  }

  return (
    <View style={styles.block}>
      {projects.map((p) => (
        <Line key={p.projectId} text={`${p.open ? "Open" : "Dicht"}: ${p.albumName}, tot ${dayTime(p.endsAt)}`} />
      ))}
      {current ? (
        <>
          <View style={styles.buttons}>
            <SmallButton
              title="Sluit project"
              tone="danger"
              disabled={working}
              onPress={() => void act("sluiten", () => closeProject({ projectId: current.projectId }))}
            />
          </View>
          <QueryBoundary fallback={(e, reset) => <ErrorBlock error={e} onRetry={reset} />}>
            <ProjectOriginals projectId={current.projectId} />
          </QueryBoundary>
        </>
      ) : (
        <>
          <Line text="Geen open project. Open er een met album (einde over 14 dagen):" />
          <View style={styles.buttons}>
            {albums.map((a) => (
              <SmallButton
                key={a._id}
                title={a.name}
                disabled={working}
                onPress={() =>
                  void act("openen", () => openProject({ groupId, albumId: a._id, endsAt: Date.now() + 14 * DAY_MS }))
                }
              />
            ))}
          </View>
        </>
      )}
      {note ? <Line text={note} /> : null}
    </View>
  );
}

function ProjectOriginals({ projectId }: { projectId: string }) {
  const data = useLiveQuery(api.filmProjects.get, { projectId });
  if (data === undefined) return <Line text="Inzendingen laden…" />;
  return (
    <View style={styles.block}>
      <Line text={`Backend: ${data.originals.length} inzendingen${data.isFounder ? " (jij bent oprichter)" : ""}`} />
      {data.originals.map((o) => (
        <Line
          key={o.originalId}
          text={`${o.mine ? "eigen" : o.ownerName}: ${o.status}, ${durationText(o.durationMs)}, ingestuurd ${dayTime(o.submittedAt)} (${o.originalId})`}
        />
      ))}
    </View>
  );
}

// --- opmaak -------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      <ListSection>
        <View style={styles.inner}>{children}</View>
      </ListSection>
    </View>
  );
}

function Line({ text }: { text: string }) {
  return (
    <Text variant="albumMeta" selectable>
      {text}
    </Text>
  );
}

function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="albumMeta" style={{ color: colors.danger }}>
        {`Query-fout: ${errorText(error, refusal(error))}`}
      </Text>
      <SmallButton title="Opnieuw" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.s, marginBottom: space.l },
  inner: { padding: space.m, gap: space.xs },
  block: { gap: space.xs, marginTop: space.s },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowText: { flexShrink: 1, marginRight: space.s },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.s, marginVertical: space.xs },
});
