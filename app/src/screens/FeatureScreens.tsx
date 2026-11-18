import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, Alert, StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { AnimatedPressable, FadeIn, useArrivals, usePressMotion } from "../components/Motion";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { SmallButton } from "../components/SmallButton";
import { EmptyState, LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import { api } from "../convexApi";
import { successTap } from "../data/haptics";
import { useLiveQuery } from "../data/useLiveQuery";
import {
  DESCRIPTION_MAX_LENGTH,
  FEATURE_STATUSES,
  TITLE_MAX_LENGTH,
  featureErrorField,
  featureErrorText,
  featureStatusLabel,
  sortIdeas,
  sortProblems,
  type FeatureType,
} from "../lib/features";
import { radius, size, space, useTheme } from "../theme";
import { LoadError } from "./GroupParts";

// WP20: ideeën en problemen, in Instellingen (besluit 4). Een lid geeft een
// idee of probleem door, ziet de ideeën van iedereen met hun status en stemt.
// Een probleem ziet alleen wie het meldde en de webmaster (invariant 5). De
// webmaster zet de status en verwijdert (A-invariant 2). Nergens de naam van
// de indiener (de backend geeft hem niet). Elke actie meldt of hij lukte
// (invariant 7).

type Feature = FunctionReturnType<typeof api.features.list>[number];
type Status = { kind: "error" | "success"; text: string } | null;

export const SUBMIT_PATH = "/instellingen/doorgeven";

function submitPath(type: FeatureType): string {
  return `${SUBMIT_PATH}?soort=${type === "problem" ? "probleem" : "idee"}`;
}

function confirm(title: string, message: string, button: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Annuleren", style: "cancel", onPress: () => resolve(false) },
        { text: button, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function withBoundary(title: string, content: ReactNode) {
  return (
    <QueryBoundary
      fallback={(_e, reset) => (
        <Screen underHeader>
          <LoadError title={title} onRetry={reset} />
        </Screen>
      )}
    >
      {content}
    </QueryBoundary>
  );
}

// De webmaster-acties bij een idee of probleem: status zetten en verwijderen.
// Alleen getoond als users.isWebmaster true geeft; de backend weigert anderen.
function useWebmasterActions(setStatus: (s: Status) => void) {
  const setFeatureStatus = useMutation(api.features.setStatus);
  const remove = useMutation(api.features.remove);
  const inFlight = useRef(false);

  const once = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await work();
    } finally {
      inFlight.current = false;
    }
  };

  const chooseStatus = (f: Feature) => {
    const options = [...FEATURE_STATUSES.map(featureStatusLabel), "Annuleren"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Status", options, cancelButtonIndex: options.length - 1 },
      (index) => {
        const status = FEATURE_STATUSES[index];
        if (!status) return;
        void once(async () => {
          setStatus(null);
          try {
            await setFeatureStatus({ featureId: f._id, status });
            setStatus({ kind: "success", text: `Status van "${f.title}" is nu ${featureStatusLabel(status)}.` });
          } catch {
            setStatus({ kind: "error", text: "De status is niet gewijzigd. Probeer het later opnieuw." });
          }
        });
      },
    );
  };

  const removeFeature = (f: Feature) =>
    void once(async () => {
      const what = f.type === "problem" ? "probleem" : "idee";
      const ok = await confirm(`Dit ${what} verwijderen?`, `"${f.title}" verdwijnt, met de stemmen. Dit kun je niet ongedaan maken.`, "Verwijderen");
      if (!ok) return;
      setStatus(null);
      try {
        await remove({ featureId: f._id });
        setStatus({ kind: "success", text: `"${f.title}" is verwijderd.` });
        // WP33 invariant 10: een bevestigde verwijdering is gelukt.
        successTap();
      } catch {
        setStatus({ kind: "error", text: "Dat lukte niet. Er is niets veranderd. Probeer het later opnieuw." });
      }
    });

  return { chooseStatus, removeFeature };
}

function FeatureCard({
  feature,
  vote,
  webmaster,
}: {
  feature: Feature;
  vote?: { voted: boolean; onToggle: () => void; busy: boolean };
  webmaster?: { onStatus: () => void; onRemove: () => void };
}) {
  const { colors } = useTheme();
  // WP33 invariant 6: de stemknop krimpt bij indrukken.
  const press = usePressMotion("button");
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="albumName">{feature.title}</Text>
          <Text variant="albumMeta" color="muted">
            {featureStatusLabel(feature.status)}
          </Text>
        </View>
        {vote && (
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={
              vote.voted
                ? `Je stemde op dit idee, ${feature.upvoteCount} stemmen. Stem terugnemen`
                : `${feature.upvoteCount} stemmen. Stem op dit idee`
            }
            accessibilityState={{ selected: vote.voted, busy: vote.busy }}
            disabled={vote.busy}
            onPress={press.withRelease(vote.onToggle)}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            hitSlop={space.s}
            style={[
              styles.vote,
              { borderColor: colors.primary, backgroundColor: vote.voted ? colors.tabPill : "transparent" },
              press.dim && styles.pressed,
              press.style,
            ]}
          >
            <Icon name="vote" size={20} color={colors.primary} filled={vote.voted} />
            <Text variant="smallButton" color="primary">
              {String(feature.upvoteCount)}
            </Text>
          </AnimatedPressable>
        )}
      </View>
      {feature.description ? <Text>{feature.description}</Text> : null}
      {webmaster && (
        <View style={styles.row}>
          <SmallButton title="Status" icon="edit" onPress={webmaster.onStatus} />
          <SmallButton title="Verwijderen" icon="trash" tone="danger" onPress={webmaster.onRemove} />
        </View>
      )}
    </View>
  );
}

// --- Ideeën -------------------------------------------------------------------------------

export function IdeasScreen() {
  return withBoundary("De ideeën laden lukt niet", <IdeasContent />);
}

function IdeasContent() {
  const ideas = useLiveQuery(api.features.list, { type: "feature" });
  const mine = useLiveQuery(api.features.listMyUpvotes, {});
  const webmaster = useLiveQuery(api.users.isWebmaster, {});
  const upvote = useMutation(api.features.upvote);
  const removeUpvote = useMutation(api.features.removeUpvote);
  const [status, setStatus] = useState<Status>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const actions = useWebmasterActions(setStatus);
  // WP33 D4: een idee dat binnenkomt, fadet in.
  const arrivals = useArrivals(ideas?.map((f) => f._id));

  if (ideas === undefined || mine === undefined) {
    return (
      <Screen underHeader>
        <LoadingState label="Ideeën laden…" />
      </Screen>
    );
  }
  const voted = new Set<string>(mine);

  const toggle = async (f: Feature) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(f._id);
    setStatus(null);
    const had = voted.has(f._id);
    try {
      if (had) await removeUpvote({ featureId: f._id });
      else await upvote({ featureId: f._id });
    } catch {
      setStatus({
        kind: "error",
        text: had ? "Je stem is niet teruggenomen. Probeer het later opnieuw." : "Je stem is niet geteld. Probeer het later opnieuw.",
      });
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };

  return (
    <Screen underHeader>
      <Text>Ideeën voor de app, van alle leden. Stem op wat jij ook wilt; de webmaster zet de status.</Text>
      <Button title="Idee doorgeven" icon="idea" onPress={() => router.push(submitPath("feature"))} />
      {status && <Notice kind={status.kind} message={status.text} />}
      {ideas.length === 0 ? (
        <EmptyState icon="idea" title="Nog geen ideeën" text="Heb je een idee voor de app? Geef het door." />
      ) : (
        sortIdeas(ideas).map((f) => (
          <FadeIn key={f._id} active={arrivals.has(f._id)}>
            <FeatureCard
              feature={f}
              vote={{ voted: voted.has(f._id), busy: busyId === f._id, onToggle: () => void toggle(f) }}
              webmaster={
                webmaster ? { onStatus: () => actions.chooseStatus(f), onRemove: () => actions.removeFeature(f) } : undefined
              }
            />
          </FadeIn>
        ))
      )}
    </Screen>
  );
}

// --- Problemen ----------------------------------------------------------------------------

export function ProblemsScreen() {
  return withBoundary("De problemen laden lukt niet", <ProblemsContent />);
}

function ProblemsContent() {
  // Invariant 5: de backend geeft een lid alleen zijn eigen problemen, de webmaster alle.
  const problems = useLiveQuery(api.features.list, { type: "problem" });
  const webmaster = useLiveQuery(api.users.isWebmaster, {});
  const [status, setStatus] = useState<Status>(null);
  const actions = useWebmasterActions(setStatus);
  // WP33 D4: een probleem dat binnenkomt, fadet in.
  const arrivals = useArrivals(problems?.map((f) => f._id));

  if (problems === undefined || webmaster === undefined) {
    return (
      <Screen underHeader>
        <LoadingState label="Problemen laden…" />
      </Screen>
    );
  }

  return (
    <Screen underHeader>
      <Text>
        {webmaster
          ? "Alle gemelde problemen. Alleen de melder en jij zien ze."
          : "Werkt er iets niet? Meld het; de webmaster krijgt een mail. Alleen jij en de webmaster zien je meldingen."}
      </Text>
      <Button title="Probleem melden" icon="problem" onPress={() => router.push(submitPath("problem"))} />
      {status && <Notice kind={status.kind} message={status.text} />}
      <Text variant="albumName" accessibilityRole="header">
        {webmaster ? "Gemelde problemen" : "Jouw meldingen"}
      </Text>
      {problems.length === 0 ? (
        <Text color="muted">Nog geen meldingen.</Text>
      ) : (
        sortProblems(problems).map((f) => (
          <FadeIn key={f._id} active={arrivals.has(f._id)}>
            <FeatureCard
              feature={f}
              webmaster={
                webmaster ? { onStatus: () => actions.chooseStatus(f), onRemove: () => actions.removeFeature(f) } : undefined
              }
            />
          </FadeIn>
        ))
      )}
    </Screen>
  );
}

// --- Doorgeven ----------------------------------------------------------------------------

const TYPES = [
  { key: "feature", title: "Idee" },
  { key: "problem", title: "Probleem" },
] as const;

type FormFeedback =
  | { kind: "error"; field: "title" | "description" | null; text: string }
  | { kind: "success"; text: string }
  | null;

export function SubmitFeatureScreen() {
  const { soort } = useLocalSearchParams<{ soort?: string }>();
  const [type, setType] = useState<FeatureType>(soort === "probleem" ? "problem" : "feature");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback>(null);
  const inFlight = useRef(false);
  const create = useMutation(api.features.create);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await create({ type, title, description });
      setTitle("");
      setDescription("");
      setFeedback({
        kind: "success",
        text:
          type === "problem"
            ? "We hebben je melding doorgestuurd naar de webmaster."
            : "Je idee is doorgegeven. Andere leden kunnen er nu op stemmen.",
      });
    } catch (error) {
      setFeedback({ kind: "error", field: featureErrorField(error), text: featureErrorText(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const fieldError = (field: "title" | "description") =>
    feedback?.kind === "error" && feedback.field === field ? feedback.text : null;
  const titleError = fieldError("title");
  const descriptionError = fieldError("description");

  return (
    <Screen underHeader keepEndInView>
      <SegmentedTabs
        tabs={TYPES}
        selected={type}
        onSelect={(k) => {
          setType(k);
          setFeedback(null);
        }}
      />
      <Text color="muted">
        {type === "problem"
          ? "Beschrijf wat er misgaat en wat je deed. De webmaster krijgt een mail met je naam en e-mailadres, om te kunnen reageren."
          : "Je idee staat daarna in de lijst met ideeën, zonder je naam. Andere leden kunnen erop stemmen."}
      </Text>
      <View style={styles.field}>
        <TextField
          label="Titel"
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            if (feedback?.kind !== "error" || feedback.field === "title") setFeedback(null);
          }}
          invalid={titleError !== null}
          maxLength={TITLE_MAX_LENGTH * 2}
          returnKeyType="next"
        />
        {titleError && <Notice kind="error" message={titleError} />}
      </View>
      <View style={styles.field}>
        <TextField
          label="Omschrijving"
          value={description}
          onChangeText={(t) => {
            setDescription(t);
            if (feedback?.kind !== "error" || feedback.field === "description") setFeedback(null);
          }}
          invalid={descriptionError !== null}
          multiline
          maxLength={DESCRIPTION_MAX_LENGTH * 2}
          minHeight={120}
        />
        {descriptionError && <Notice kind="error" message={descriptionError} />}
      </View>
      <Button
        title={type === "problem" ? "Probleem melden" : "Idee doorgeven"}
        busyTitle="Versturen…"
        busy={busy}
        onPress={() => void submit()}
      />
      {feedback?.kind === "error" && feedback.field === null && <Notice kind="error" message={feedback.text} />}
      {feedback?.kind === "success" && <Notice kind="success" message={feedback.text} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.listBlock, padding: space.l, gap: space.s },
  head: { flexDirection: "row", gap: space.m, alignItems: "flex-start" },
  flex: { flex: 1, gap: space.xs },
  row: { flexDirection: "row", gap: space.m, flexWrap: "wrap" },
  field: { gap: space.s },
  vote: {
    minHeight: size.touchMin,
    minWidth: size.touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.m,
    borderWidth: 1,
    borderRadius: radius.listBlock,
  },
  pressed: { opacity: 0.6 },
});
