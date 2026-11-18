import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState, type ReactNode } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { FadeIn, useArrivals } from "../components/Motion";
import { Notice } from "../components/Notice";
import { PhotoImage } from "../components/Photo";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { successTap } from "../data/haptics";
import { useLiveQuery } from "../data/useLiveQuery";
import { flagDay, flagQueueOrder, flagStage, flagStageLabel, ownFlagView, removalDay, type FlagDates } from "../lib/flags";
import { radius, space, useTheme } from "../theme";
import { LoadError } from "./GroupParts";

// WP20: gemelde foto's. Besluit 4: allebei in Profiel, alleen zichtbaar als er
// iets is. De eigenaar ziet zijn eigen gemelde foto's en maakt bezwaar of
// verwijdert de foto (A-keuze 8). De webmaster ziet de wachtrij en beslist,
// ook zonder bezwaar (besluit 2). Nergens de melder of de reden (invariant 1,
// A-keuze 3). Elke actie meldt of hij lukte (invariant 7).

type Status = { kind: "error" | "success"; text: string } | null;

function confirm(title: string, message: string, button: string, destructive = true): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Annuleren", style: "cancel", onPress: () => resolve(false) },
        { text: button, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// Eén aanroep tegelijk, ook bij dubbel tikken. WP20 besluit 6, N1: "Bezig…"
// pas na de bevestiging, en alleen op de knop die je koos (`isBusy`). Zolang
// de vraag openstaat, doet een tweede tik niets.
type Action = "appeal" | "remove" | "keep" | "deny" | "removeNow";
function useBusy() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);
  const run = async (
    id: string,
    action: Action,
    ask: (() => Promise<boolean>) | null,
    work: () => Promise<void>,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (ask && !(await ask())) return;
      setBusy({ id, action });
      await work();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  const isBusy = (id: string, action: Action) => busy?.id === id && busy.action === action;
  return { anyBusy: busy !== null, isBusy, run };
}

const THUMB = 96;

// De datums die er zijn; gemigreerde meldingen hebben er soms minder.
function FlagDatesText({ photo, deleteAt }: { photo: FlagDates; deleteAt: number | null }) {
  const lines = [
    photo.flaggedAt !== undefined ? `Gemeld op ${flagDay(photo.flaggedAt)}` : null,
    photo.flaggedAppealDate !== undefined ? `Bezwaar gemaakt op ${flagDay(photo.flaggedAppealDate)}` : null,
    photo.flaggedAppealDenyDate !== undefined ? `Bezwaar afgewezen op ${flagDay(photo.flaggedAppealDenyDate)}` : null,
    // WP20 besluit 6, S1: de laatste hele dag, zoals de mail.
    deleteAt !== null ? `Wordt verwijderd na ${removalDay(deleteAt)}` : null,
  ].filter((l): l is string => l !== null);
  return (
    <>
      {lines.map((l) => (
        <Text key={l} variant="albumMeta" color="muted">
          {l}
        </Text>
      ))}
    </>
  );
}

function Card({ children, fadeIn = false }: { children: ReactNode; fadeIn?: boolean }) {
  const { colors } = useTheme();
  return (
    <FadeIn active={fadeIn} style={[styles.card, { backgroundColor: colors.surface }]}>
      {children}
    </FadeIn>
  );
}

// --- Eigenaar: "Gemelde foto's" ----------------------------------------------------------

type MyFlagged = FunctionReturnType<typeof api.photos.listMyFlagged>[number];

export function MyFlaggedScreen() {
  return (
    <QueryBoundary
      fallback={(_e, reset) => (
        <Screen underHeader>
          <LoadError title="Je gemelde foto's laden lukt niet" onRetry={reset} />
        </Screen>
      )}
    >
      <MyFlaggedContent />
    </QueryBoundary>
  );
}

function MyFlaggedContent() {
  const photos = useLiveQuery(api.photos.listMyFlagged, {});
  const appeal = useMutation(api.photos.appeal);
  const remove = useMutation(api.photos.remove);
  const [status, setStatus] = useState<Status>(null);
  const { anyBusy, isBusy, run } = useBusy();
  // WP33 D4: een gemelde foto die binnenkomt, fadet in.
  const arrivals = useArrivals(photos?.map((p) => p._id));

  if (photos === undefined) {
    return (
      <Screen underHeader>
        <LoadingState label="Gemelde foto's laden…" />
      </Screen>
    );
  }

  const doAppeal = (p: MyFlagged) =>
    run(p._id, "appeal", null, async () => {
      setStatus(null);
      try {
        await appeal({ photoId: p._id });
        setStatus({ kind: "success", text: "Je bezwaar is doorgegeven. De webmaster beoordeelt de foto; tot dan wordt hij niet verwijderd." });
      } catch {
        setStatus({ kind: "error", text: "Je bezwaar is niet doorgegeven. Misschien kan het niet meer, of is er geen verbinding. Probeer het later opnieuw." });
      }
    });

  const doRemove = (p: MyFlagged) =>
    run(p._id, "remove", () =>
      confirm(
        "Foto overal verwijderen?",
        "De foto verdwijnt uit elk album. Is hij een cover of een profielfoto, dan is hij dat niet meer. Dit kun je niet ongedaan maken.",
        "Verwijderen",
      ),
    async () => {
      setStatus(null);
      try {
        await remove({ photoId: p._id });
        setStatus({ kind: "success", text: "De foto is verwijderd." });
        // WP33 invariant 10: een bevestigde verwijdering is gelukt.
        successTap();
      } catch {
        setStatus({ kind: "error", text: "De foto is niet verwijderd. Probeer het later opnieuw." });
      }
    });

  return (
    <Screen underHeader>
      {photos.length > 0 && (
        <Text>
          Andere leden hebben deze foto's gemeld als ongepast. Ben je het er niet mee eens? Maak dan bezwaar; de
          webmaster beoordeelt de foto. Zonder bezwaar wordt de foto na de genoemde datum verwijderd.
        </Text>
      )}
      {status && <Notice kind={status.kind} message={status.text} />}
      {photos.length === 0 ? (
        <EmptyState icon="flag" title="Geen meldingen" text="Er zijn geen meldingen over jouw foto's." />
      ) : (
        photos.map((p) => {
          const view = ownFlagView(p);
          return (
            <Card key={p._id} fadeIn={arrivals.has(p._id)}>
              <View style={styles.head}>
                <PhotoImage
                  photoId={p._id}
                  format="klein"
                  exifOrientation={p.exifOrientation}
                  hasFormats={p.hasFormats}
                  box={{ width: THUMB, height: THUMB }}
                  radius={radius.albumTile}
                  accessibilityLabel="Gemelde foto"
                />
                <View style={styles.flex}>
                  <Text variant="albumName">{flagStageLabel(view.stage)}</Text>
                  <FlagDatesText photo={p} deleteAt={view.deleteAt} />
                </View>
              </View>
              {view.stage === "appealed" && (
                <Text variant="meta" color="muted">
                  De webmaster beoordeelt je bezwaar. Tot dan wordt de foto niet verwijderd.
                </Text>
              )}
              {view.canAppeal && (
                <Button
                  title="Bezwaar maken"
                  busyTitle="Bezig…"
                  busy={isBusy(p._id, "appeal")}
                  disabled={anyBusy && !isBusy(p._id, "appeal")}
                  onPress={() => void doAppeal(p)}
                />
              )}
              <Button
                title="Foto verwijderen"
                variant="secondary"
                busyTitle="Verwijderen…"
                busy={isBusy(p._id, "remove")}
                disabled={anyBusy && !isBusy(p._id, "remove")}
                onPress={() => void doRemove(p)}
              />
            </Card>
          );
        })
      )}
    </Screen>
  );
}

// --- Webmaster: "Meldingen beoordelen" ----------------------------------------------------

type Flagged = FunctionReturnType<typeof api.photos.listAllFlagged>[number];

// Invariant 3: de app verbergt het scherm, de backend weigert. Een directe
// route voor wie geen webmaster is, geeft een nette weigering en vraagt de
// wachtrij niet eens op.
export function FlagQueueScreen() {
  const webmaster = useLiveQuery(api.users.isWebmaster, {});
  if (webmaster === undefined) {
    return (
      <Screen underHeader>
        <LoadingState label="Meldingen laden…" />
      </Screen>
    );
  }
  if (!webmaster) {
    return (
      <Screen underHeader>
        <EmptyState icon="flag" title="Alleen voor de webmaster" text="Dit scherm is alleen voor de webmaster van Clubalmanac." />
      </Screen>
    );
  }
  return (
    <QueryBoundary
      fallback={(_e, reset) => (
        <Screen underHeader>
          <LoadError title="De meldingen laden lukt niet" onRetry={reset} />
        </Screen>
      )}
    >
      <FlagQueueContent />
    </QueryBoundary>
  );
}

function FlagQueueContent() {
  const all = useLiveQuery(api.photos.listAllFlagged, {});
  const decide = useMutation(api.photos.decideFlag);
  const removeFlagged = useMutation(api.photos.removeFlagged);
  const [status, setStatus] = useState<Status>(null);
  const { anyBusy, isBusy, run } = useBusy();
  // WP33 D4: een melding die binnenkomt, fadet in.
  const arrivals = useArrivals(all?.map((p) => p._id));

  if (all === undefined) {
    return (
      <Screen underHeader>
        <LoadingState label="Meldingen laden…" />
      </Screen>
    );
  }
  const queue = [...all].sort(flagQueueOrder);

  const keep = (p: Flagged) =>
    run(p._id, "keep", () =>
      confirm(
        "Foto laten staan?",
        "De melding vervalt en de foto blijft staan. De eigenaar krijgt geen bericht.",
        "Laten staan",
        false,
      ),
    async () => {
      setStatus(null);
      try {
        await decide({ photoId: p._id, approve: true });
        setStatus({ kind: "success", text: "De melding is vervallen. De foto blijft staan." });
      } catch {
        setStatus({ kind: "error", text: "Dat lukte niet. Er is niets veranderd. Probeer het later opnieuw." });
      }
    });

  const deny = (p: Flagged) =>
    run(p._id, "deny", () =>
      confirm(
        "Bezwaar afwijzen?",
        "De eigenaar krijgt een mail. Over 7 dagen wordt de foto verwijderd.",
        "Afwijzen",
      ),
    async () => {
      setStatus(null);
      try {
        await decide({ photoId: p._id, approve: false });
        setStatus({ kind: "success", text: "Het bezwaar is afgewezen. De eigenaar krijgt een mail." });
        // WP33 invariant 10 (besluit 2): gelukt na de rode bevestigingsknop.
        successTap();
      } catch {
        setStatus({ kind: "error", text: "Dat lukte niet. Er is niets veranderd. Probeer het later opnieuw." });
      }
    });

  const removeNow = (p: Flagged) =>
    run(p._id, "removeNow", () =>
      confirm(
        "Foto nu verwijderen?",
        "De foto verdwijnt meteen uit elk album. De eigenaar krijgt een mail. Dit kun je niet ongedaan maken.",
        "Verwijderen",
      ),
    async () => {
      setStatus(null);
      try {
        await removeFlagged({ photoId: p._id });
        setStatus({ kind: "success", text: "De foto is verwijderd. De eigenaar krijgt een mail." });
        // WP33 invariant 10: een bevestigde verwijdering is gelukt.
        successTap();
      } catch {
        setStatus({ kind: "error", text: "Dat lukte niet. Er is niets veranderd. Probeer het later opnieuw." });
      }
    });

  return (
    <Screen underHeader>
      {queue.length > 0 && (
        <Text>
          Foto's die leden als ongepast meldden. Een bezwaar zonder besluit staat bovenaan. Zonder besluit wordt een
          foto na de genoemde datum verwijderd.
        </Text>
      )}
      {status && <Notice kind={status.kind} message={status.text} />}
      {queue.length === 0 ? (
        <EmptyState icon="flag" title="Geen meldingen" text="Er zijn geen gemelde foto's." />
      ) : (
        queue.map((p) => {
          const stage = flagStage(p);
          const deleteAt = stage === "appealed" ? null : (p.flaggedDeleteDate ?? null);
          const disabledFor = (a: Action) => anyBusy && !isBusy(p._id, a);
          return (
            <Card key={p._id} fadeIn={arrivals.has(p._id)}>
              <View style={styles.head}>
                <PhotoImage
                  photoId={p._id}
                  format="klein"
                  exifOrientation={p.exifOrientation}
                  hasFormats={p.hasFormats}
                  box={{ width: THUMB * 1.5, height: THUMB * 1.5 }}
                  fit="contain"
                  radius={radius.albumTile}
                  accessibilityLabel="Gemelde foto"
                  // Besluit 10 (N5): het beeld blijft niet op de telefoon van de webmaster.
                  memoryOnly
                />
                <View style={styles.flex}>
                  <Text variant="albumName">{flagStageLabel(stage)}</Text>
                  <FlagDatesText photo={p} deleteAt={deleteAt} />
                </View>
              </View>
              <Button
                title="Foto laten staan"
                variant={stage === "appealed" ? "cta" : "secondary"}
                busyTitle="Bezig…"
                busy={isBusy(p._id, "keep")}
                disabled={disabledFor("keep")}
                onPress={() => void keep(p)}
              />
              {stage === "appealed" && (
                <Button
                  title="Bezwaar afwijzen"
                  variant="secondary"
                  busyTitle="Bezig…"
                  busy={isBusy(p._id, "deny")}
                  disabled={disabledFor("deny")}
                  onPress={() => void deny(p)}
                />
              )}
              <Button
                title="Foto nu verwijderen"
                variant="secondary"
                busyTitle="Verwijderen…"
                busy={isBusy(p._id, "removeNow")}
                disabled={disabledFor("removeNow")}
                onPress={() => void removeNow(p)}
              />
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.listBlock, padding: space.l, gap: space.m },
  head: { flexDirection: "row", gap: space.m, alignItems: "flex-start" },
  flex: { flex: 1, gap: space.xs },
});
