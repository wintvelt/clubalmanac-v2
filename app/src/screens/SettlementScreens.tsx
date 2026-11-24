import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { BackPill } from "../components/BackPill";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { LinkButton } from "../components/LinkButton";
import { ListSection } from "../components/ListRow";
import { Notice } from "../components/Notice";
import { QueryBoundary } from "../components/QueryBoundary";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";
import { useWideLayout } from "../components/wideLayout";
import { api } from "../convexApi";
import { useAuthState } from "../data/authStateContext";
import { useLiveQuery } from "../data/useLiveQuery";
import { groupPath, participantPath, settlementPath, settlementTablePath } from "../lib/groupRoutes";
import { groupErrorKind } from "../lib/groups";
import {
  balanceLabel,
  balanceLine,
  COLUMN_TITLES,
  formatCell,
  formatEuro,
  formatLongDate,
  formatShortDate,
  participantOutcome,
  participantsText,
  participantStatus,
  partMeta,
  paymentLines,
  rowCell,
  stillToPay,
  totalCell,
  visibleColumns,
  type ParticipantStatusKind,
  type Settlement,
  type SettlementRow,
} from "../lib/settlements";
import { border, LARGE_TEXT_SCALE, radius, size, space, typography, useTheme, type ColorTokens } from "../theme";
import { LoadError } from "./GroupParts";
import { WideSplit } from "./WideSide";

// WP41: de schermen van Geld, onder de groep in de Home-stack (spec
// §Schermen): de afrekening, de hele tabel en één deelnemer. Alleen kijken:
// alles komt uit het clubboek, de app rekent niets na (A10). Geen uitlegtekst
// (besluit 6): titels, bedragen en de knoppen om verder te gaan.
//
// De afrekening is een live query (`settlements.get`). Stuurt het clubboek hem
// opnieuw, dan houdt hij zijn id en ververst het scherm zonder laden
// (useLiveQuery houdt de vorige waarde). Geen lid (meer), of de afrekening is
// weg: NOT_MEMBER, opgevangen door de grens (invariant 1).

type Params = { groupId: string; settlementId: string; name?: string };

function useSettlementParams() {
  const params = useLocalSearchParams<Params>();
  return {
    groupId: String(params.groupId) as Id<"groups">,
    settlementId: String(params.settlementId) as Id<"settlements">,
    name: params.name === undefined ? undefined : String(params.name),
  };
}

// --- de grens: geen toegang of een fout ----------------------------------------------

function SettlementBoundary({
  settlementId,
  groupId,
  children,
}: {
  settlementId: string;
  groupId: Id<"groups">;
  children: ReactNode;
}) {
  // In "reconnecting" toont Screen laden of een fout met "Opnieuw" (WP15a F1).
  const reconnecting = useAuthState() === "reconnecting";
  if (reconnecting) return <Screen underHeader>{null}</Screen>;
  return (
    <QueryBoundary
      key={settlementId}
      fallback={(error, reset) =>
        groupErrorKind(error) === "notMember" ? (
          <Gone groupId={groupId} title="Deze afrekening is er niet" />
        ) : (
          <Screen underHeader>
            <Stack.Screen options={{ headerShown: true }} />
            <LoadError title="Deze afrekening laden lukt niet" onRetry={reset} />
          </Screen>
        )
      }
    >
      {children}
    </QueryBoundary>
  );
}

function backTo(path: string) {
  if (router.canGoBack()) router.back();
  else router.replace(path);
}

function Gone({ groupId, title }: { groupId: Id<"groups">; title: string }) {
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: "Geld", headerShown: true }} />
      <Notice kind="error" title={title} />
      <Button title="Terug naar de groep" icon="back" onPress={() => backTo(groupPath(groupId))} />
    </Screen>
  );
}

function useSettlement(settlementId: Id<"settlements">): Settlement | undefined {
  return useLiveQuery(api.settlements.get, { settlementId });
}

function Loading() {
  return (
    <Screen underHeader>
      <LoadingState label="Afrekening laden…" />
    </Screen>
  );
}

// --- 2. de afrekening --------------------------------------------------------------------

export function SettlementScreen() {
  const { groupId, settlementId } = useSettlementParams();
  return (
    <SettlementBoundary groupId={groupId} settlementId={settlementId}>
      <SettlementOverview groupId={groupId} settlementId={settlementId} />
    </SettlementBoundary>
  );
}

function SettlementOverview({ groupId, settlementId }: { groupId: Id<"groups">; settlementId: Id<"settlements"> }) {
  const settlement = useSettlement(settlementId);
  const wide = useWideLayout();
  if (settlement === undefined) return <Loading />;

  const openParticipant = (name: string) => router.push(participantPath(groupId, settlementId, name));
  const intro = <Intro settlement={settlement} />;
  const tiles = <Tiles settlement={settlement} />;
  const participants = (
    <Section title="Deelnemers">
      <ParticipantList rows={settlement.rows} onOpen={openParticipant} />
    </Section>
  );
  const parts =
    settlement.parts.length > 0 ? (
      <Section title="Per onderdeel">
        <PartList settlement={settlement} />
      </Section>
    ) : null;

  // Breed (web, iPad liggend): links de kop, de tegels en de deelnemers;
  // rechts de hele tabel zonder vegen, en de onderdelen.
  if (wide) {
    return (
      <WideSplit
        side={
          <>
            <View style={styles.pill}>
              <BackPill title="Groep" onPress={() => backTo(groupPath(groupId))} />
            </View>
            {intro}
            {tiles}
            {participants}
          </>
        }
      >
        <Stack.Screen options={{ title: settlement.name, headerShown: false }} />
        <Screen underHeader fullWidth>
          <SettlementTable settlement={settlement} onOpen={openParticipant} />
          {parts}
        </Screen>
      </WideSplit>
    );
  }

  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: settlement.name, headerShown: true }} />
      {intro}
      {tiles}
      {participants}
      {parts}
      <LinkButton
        title="Bekijk de hele tabel"
        icon="document"
        onPress={() => router.push(settlementTablePath(groupId, settlementId))}
      />
    </Screen>
  );
}

function Intro({ settlement }: { settlement: Settlement }) {
  return (
    <View style={styles.intro}>
      <Text variant="title" accessibilityRole="header">
        {settlement.name}
      </Text>
      {settlement.period ? <Text variant="meta">{settlement.period}</Text> : null}
      <Text variant="meta" color="muted">
        Stand van {formatLongDate(settlement.publishedOn)}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="fieldLabel" color="muted" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

// De tegels: Totale kosten (met het bedrag per persoon), Uit spaarpotten (bij
// een lustrum), Bijdrage uit clubkas (als die er is), Nog te betalen. Bij grote
// tekst (fontScale ≥ 1,2, design.md §3; F7) onder elkaar, elk over de hele breedte.
//
// Gate WP41: een bedrag breekt nooit midden in een getal. Op het web breekt een
// woord dat niet past wél (ook met harde spaties), bv. in de smalle linkerkolom
// van een breed scherm. Daarom naast elkaar alleen als elk bedrag in een halve
// tegel past: de breedte van de rij gemeten (onLayout), het bedrag geschat aan
// de hand van zijn tekens. Tot de meting er is: onder elkaar.
function Tiles({ settlement }: { settlement: Settlement }) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const { totals } = settlement;
  const toPay = stillToPay(settlement.rows);
  const halves = [
    settlement.lustrum ? formatEuro(totals.fromPot) : null,
    totals.club !== 0 ? formatEuro(totals.club) : null,
    formatEuro(toPay.cents),
  ].filter((x): x is string => x !== null);
  const halfInner = (width - space.s) / 2 - 2 * space.m;
  const half =
    fontScale < LARGE_TEXT_SCALE &&
    width > 0 &&
    halves.every((v) => amountWidth(v, typography.amount.fontSize * fontScale) <= halfInner);
  return (
    <View style={styles.tiles} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Tile
        label="Totale kosten"
        value={formatEuro(totals.costs)}
        sub={settlement.costPerPerson === null ? undefined : `${formatEuro(settlement.costPerPerson)} per persoon`}
        half={false}
      />
      {settlement.lustrum && <Tile label="Uit spaarpotten" value={formatEuro(totals.fromPot)} half={half} />}
      {totals.club !== 0 && <Tile label="Bijdrage uit clubkas" value={formatEuro(totals.club)} half={half} />}
      <Tile label="Nog te betalen" value={formatEuro(toPay.cents)} sub={participantsText(toPay.count)} half={half} />
    </View>
  );
}

// Breedte van een bedrag in de vette systeemletter, in em per teken, met marge
// (liever een keer onder elkaar dan een bedrag dat breekt).
const NARROW_CHARS = new Set([".", ",", "\u00A0", " "]);
function amountWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const c of text) em += NARROW_CHARS.has(c) ? 0.3 : 0.62;
  return em * fontSize * 1.05;
}

function Tile({ label, value, sub, half }: { label: string; value: string; sub?: string; half: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={[label, value, sub].filter(Boolean).join(", ")}
      style={[styles.tile, half ? styles.tileHalf : styles.tileFull, { backgroundColor: colors.surface }]}
    >
      <Text variant="albumMeta" color="muted">
        {label}
      </Text>
      <Text variant="amount" style={styles.figures}>
        {value}
      </Text>
      {sub ? (
        <Text variant="albumMeta" color="muted">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const STATUS_COLOR: Record<ParticipantStatusKind, keyof ColorTokens> = {
  done: "muted",
  pays: "danger",
  receives: "success",
};

function ParticipantList({ rows, onOpen }: { rows: SettlementRow[]; onOpen: (name: string) => void }) {
  const { colors } = useTheme();
  return (
    <ListSection>
      {rows.map((row) => {
        const status = participantStatus(row);
        const amount = balanceLabel(row.balance);
        return (
          <Pressable
            key={row.name}
            accessibilityRole="button"
            accessibilityLabel={`${row.name}, ${status.label}, ${amount}`}
            onPress={() => onOpen(row.name)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.line }]}
          >
            <View style={styles.rowText}>
              <Text variant="bodyStrong">{row.name}</Text>
              <Text variant="albumMeta" color={STATUS_COLOR[status.kind]}>
                {status.label}
              </Text>
            </View>
            <Text
              variant={status.kind === "done" ? "body" : "bodyStrong"}
              color={STATUS_COLOR[status.kind]}
              style={[styles.figures, styles.amount]}
            >
              {amount}
            </Text>
            <Icon name="chevron" size={20} color={colors.muted} />
          </Pressable>
        );
      })}
    </ListSection>
  );
}

function PartList({ settlement }: { settlement: Settlement }) {
  return (
    <ListSection>
      {settlement.parts.map((part, i) => (
        <View key={`${i}:${part.name}`} style={styles.row} accessible>
          <View style={styles.rowText}>
            <Text>{part.name}</Text>
            <Text variant="albumMeta" color="muted">
              {partMeta(part)}
            </Text>
          </View>
          <Text style={[styles.figures, styles.amount]}>{formatEuro(part.costs)}</Text>
        </View>
      ))}
    </ListSection>
  );
}

// --- 3. de hele tabel ---------------------------------------------------------------------

export function SettlementTableScreen() {
  const { groupId, settlementId } = useSettlementParams();
  return (
    <SettlementBoundary groupId={groupId} settlementId={settlementId}>
      <TableContent groupId={groupId} settlementId={settlementId} />
    </SettlementBoundary>
  );
}

function TableContent({ groupId, settlementId }: { groupId: Id<"groups">; settlementId: Id<"settlements"> }) {
  const settlement = useSettlement(settlementId);
  if (settlement === undefined) return <Loading />;
  return (
    <Screen underHeader fullWidth>
      <Stack.Screen options={{ title: settlement.name, headerShown: true }} />
      <SettlementTable
        settlement={settlement}
        onOpen={(name) => router.push(participantPath(groupId, settlementId, name))}
      />
    </Screen>
  );
}

type Cell = { text: string; color?: keyof ColorTokens };

// Dezelfde kolommen als in het clubboek: de onderdelen, dan de vaste kolommen
// (lege clubkas en voorgeschoten vallen weg). De namen blijven staan, de rest
// veegt opzij. Per kolom gebouwd, zodat elke kolom zo breed is als zijn
// breedste cel; elke cel is één regel van dezelfde tekstrol, dus de rijen
// lopen gelijk. Onderaan de totaalrij uit `totals` en `parts[].costs`.
function SettlementTable({ settlement, onOpen }: { settlement: Settlement; onOpen: (name: string) => void }) {
  const { colors } = useTheme();
  const columns = visibleColumns(settlement);
  const balanceColor = (cents: number | null): keyof ColorTokens | undefined =>
    cents === null || cents === 0 ? undefined : cents > 0 ? "danger" : "success";

  const scrolled: { title: string; cells: Cell[]; total: Cell }[] = [
    ...settlement.parts.map((part, i) => ({
      title: part.name,
      cells: settlement.rows.map((row) => ({ text: formatCell(row.cells[i] ?? null) })),
      total: { text: formatCell(part.costs) },
    })),
    ...columns.map((col) => ({
      title: COLUMN_TITLES[col],
      cells: settlement.rows.map((row) => ({
        text: rowCell(row, col),
        color: col === "balance" ? balanceColor(row.balance) : col === "status" && row.open === 0 ? "muted" : undefined,
      })),
      total: {
        text: totalCell(settlement.totals, col),
        color: col === "balance" ? balanceColor(settlement.totals.balance) : undefined,
      },
    })),
  ];

  return (
    <View style={[styles.table, { backgroundColor: colors.surface }]}>
      <View style={[styles.nameColumn, { borderRightColor: colors.line }]}>
        <TableCell text="Deelnemer" header align="left" />
        {settlement.rows.map((row) => (
          <Pressable
            key={row.name}
            accessibilityRole="button"
            accessibilityLabel={row.name}
            onPress={() => onOpen(row.name)}
            style={({ pressed }) => pressed && { backgroundColor: colors.line }}
          >
            <TableCell text={row.name} align="left" strong />
          </Pressable>
        ))}
        <TableCell text="Totaal" align="left" strong total />
      </View>
      <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableColumns}>
        {scrolled.map((col, c) => (
          <View key={c}>
            <TableCell text={col.title} header />
            {col.cells.map((cell, r) => (
              <TableCell key={r} text={cell.text} color={cell.color} />
            ))}
            <TableCell text={col.total.text} color={col.total.color} strong total />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function TableCell({
  text,
  color,
  header = false,
  strong = false,
  total = false,
  align = "right",
}: {
  text: string;
  color?: keyof ColorTokens;
  header?: boolean;
  strong?: boolean;
  total?: boolean;
  align?: "left" | "right";
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.cell,
        align === "left" ? styles.cellLeft : styles.cellRight,
        !header && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
        total && { borderTopWidth: border.total, borderTopColor: colors.fieldLine },
      ]}
    >
      <Text
        variant="albumMeta"
        color={header ? "muted" : (color ?? "text")}
        numberOfLines={1}
        style={[styles.figures, (strong || header) && styles.strong, align === "left" && styles.nameText]}
      >
        {/* Een lege cel houdt de hoogte van een regel. */}
        {text === "" ? " " : text}
      </Text>
    </View>
  );
}

// --- 4. één deelnemer -----------------------------------------------------------------------

export function ParticipantScreen() {
  const { groupId, settlementId, name } = useSettlementParams();
  return (
    <SettlementBoundary groupId={groupId} settlementId={settlementId}>
      <ParticipantContent groupId={groupId} settlementId={settlementId} name={name ?? ""} />
    </SettlementBoundary>
  );
}

function ParticipantContent({
  groupId,
  settlementId,
  name,
}: {
  groupId: Id<"groups">;
  settlementId: Id<"settlements">;
  name: string;
}) {
  const settlement = useSettlement(settlementId);
  if (settlement === undefined) return <Loading />;
  // Op naam (uniek per afrekening). Staat hij er niet (meer) in, dan geen
  // gegevens van een ander.
  const row = settlement.rows.find((r) => r.name === name);
  if (!row) {
    return (
      <Screen underHeader>
        <Stack.Screen options={{ title: settlement.name, headerShown: true }} />
        <Notice kind="error" title="Deze deelnemer staat niet in de afrekening" />
        <Button
          title="Terug naar de afrekening"
          icon="back"
          onPress={() => backTo(settlementPath(groupId, settlementId))}
        />
      </Screen>
    );
  }
  const status = participantStatus(row);
  const outcome = participantOutcome(row, settlement.lustrum);
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: row.name, headerShown: true }} />
      <View style={styles.intro}>
        <Text variant="title" accessibilityRole="header">
          {row.name}
        </Text>
        <Text variant="meta" color="muted">
          {[settlement.name, settlement.period].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <OutcomeCard text={outcome} kind={status.kind} />
      <CostsBlock settlement={settlement} row={row} />
      {settlement.lustrum && <SavingsBlock settlement={settlement} row={row} />}
      <PaymentsBlock row={row} />
    </Screen>
  );
}

function OutcomeCard({ text, kind }: { text: string; kind: ParticipantStatusKind }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.outcome, { backgroundColor: colors.surface }]}>
      <Text variant="amount" color={kind === "done" ? "text" : STATUS_COLOR[kind]} accessibilityLiveRegion="polite">
        {text}
      </Text>
    </View>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Section title={title}>
      <View style={[styles.block, { backgroundColor: colors.surface }]}>{children}</View>
    </Section>
  );
}

// Een regel in een blok: links de tekst (met eventueel een tweede regel of een
// datum), rechts het bedrag dat nooit breekt.
function Line({
  label,
  sub,
  date,
  amount,
  sum = false,
  color,
  first = false,
  onPress,
  expanded,
}: {
  label: string;
  sub?: string;
  date?: string;
  amount: string;
  sum?: boolean;
  color?: keyof ColorTokens;
  first?: boolean;
  onPress?: () => void;
  expanded?: boolean;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      {date !== undefined && (
        <Text variant="albumMeta" color="muted" style={[styles.figures, styles.date]}>
          {date}
        </Text>
      )}
      <View style={styles.lineText}>
        <Text variant={sum ? "bodyStrong" : "body"}>{label}</Text>
        {sub ? (
          <Text variant="albumMeta" color="muted">
            {sub}
          </Text>
        ) : null}
      </View>
      {onPress && <Icon name="chevron" size={18} color={colors.muted} />}
      <Text
        variant={sum ? "bodyStrong" : "body"}
        color={color ?? "text"}
        style={[styles.figures, styles.amount]}
      >
        {amount}
      </Text>
    </>
  );
  const lineStyle = [
    styles.line,
    !first && {
      borderTopWidth: sum ? border.total : StyleSheet.hairlineWidth,
      borderTopColor: sum ? colors.fieldLine : colors.line,
    },
  ];
  if (!onPress) {
    return (
      <View style={lineStyle} accessible>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: expanded ?? false }}
      onPress={onPress}
      style={({ pressed }) => [...lineStyle, pressed && { backgroundColor: colors.line }]}
    >
      {body}
    </Pressable>
  );
}

// 1. Kosten: de regels met hun grondslag, het totaal, wat eraf gaat (clubkas,
// spaarpot, voorgeschoten) en wat er dan bij moet of terug komt.
function CostsBlock({ settlement, row }: { settlement: Settlement; row: SettlementRow }) {
  const end = balanceLine(row.balance);
  return (
    <Block title="1. Kosten">
      {row.lines.map((line, i) => (
        <Line
          key={i}
          first={i === 0}
          label={line.part}
          sub={line.basis || undefined}
          amount={formatEuro(line.amount)}
        />
      ))}
      <Line first={row.lines.length === 0} sum label="Totaal" amount={formatEuro(row.costs)} />
      {row.club !== 0 && <Line label="Uit clubkas" amount={formatEuro(-row.club)} />}
      {settlement.lustrum && row.fromPot !== 0 && <Line label="Uit zijn spaarpot" amount={formatEuro(-row.fromPot)} />}
      {row.advanced !== 0 && <Line label="Voorgeschoten" amount={formatEuro(-row.advanced)} />}
      <Line sum label={end.label} amount={formatEuro(end.cents)} />
    </Block>
  );
}

// 2. Spaarpot (alleen bij een lustrum): de regels, de maandinleg ingeklapt in
// één regel, het saldo, wat naar deze afrekening ging en wat over is.
function SavingsBlock({ settlement, row }: { settlement: Settlement; row: SettlementRow }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <Block title="2. Spaarpot">
      {row.savings.map((s, i) => (
        <View key={i}>
          <Line
            first={i === 0}
            date={formatShortDate(s.date)}
            label={s.description}
            amount={formatEuro(s.amount)}
            onPress={s.months && s.months.length > 0 ? () => toggle(i) : undefined}
            expanded={open.has(i)}
          />
          {open.has(i) &&
            (s.months ?? []).map((m, j) => (
              <Line key={j} date={formatShortDate(m.date)} label="" amount={formatEuro(m.amount)} color="muted" />
            ))}
        </View>
      ))}
      <Line
        first={row.savings.length === 0}
        sum
        label={settlement.settledOn ? `Saldo op ${formatShortDate(settlement.settledOn)}` : "Saldo"}
        amount={formatEuro(row.potBefore ?? 0)}
      />
      <Line label={`Naar ${settlement.name}`} amount={formatEuro(-row.fromPot)} />
      <Line sum label="Over" amount={formatEuro(row.potAfter ?? 0)} />
    </Block>
  );
}

// 3. Afrekening (F3, paymentLines): wat er bij moet of terug komt, wat eraf
// ging, en wat nog open staat. Niets af te rekenen: geen blok.
function PaymentsBlock({ row }: { row: SettlementRow }) {
  const lines = paymentLines(row);
  if (lines.length === 0) return null;
  const status = participantStatus(row);
  return (
    <Block title="3. Afrekening">
      {lines.map((line, i) => {
        const last = i === lines.length - 1;
        return (
          <Line
            key={i}
            first={i === 0}
            sum={last}
            label={line.label}
            amount={formatEuro(line.cents)}
            color={last ? STATUS_COLOR[status.kind] : undefined}
          />
        );
      })}
    </Block>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start" },
  intro: { gap: space.xs },
  section: { gap: space.s },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  tile: { borderRadius: radius.card, padding: space.m, gap: space.xs / 2 },
  tileFull: { flexBasis: "100%" },
  tileHalf: { flexGrow: 1, flexBasis: "40%" },
  figures: { fontVariant: ["tabular-nums"] },
  row: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  rowText: { flex: 1, minWidth: 0, gap: space.xs / 2 },
  amount: { flexShrink: 0, textAlign: "right" },
  table: { flexDirection: "row", borderRadius: radius.listBlock, overflow: "hidden" },
  nameColumn: { borderRightWidth: StyleSheet.hairlineWidth, maxWidth: "45%" },
  tableScroll: { flex: 1 },
  tableColumns: { flexDirection: "row" },
  cell: { paddingHorizontal: space.m, paddingVertical: space.s },
  cellLeft: { alignItems: "flex-start" },
  cellRight: { alignItems: "flex-end" },
  strong: { fontWeight: "700" },
  nameText: { fontWeight: "600" },
  outcome: { borderRadius: radius.card, padding: space.l },
  block: { borderRadius: radius.listBlock, paddingHorizontal: space.l },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingVertical: space.s + space.xs / 2,
    minHeight: size.touchMin,
  },
  lineText: { flex: 1, minWidth: 0, gap: space.xs / 2 },
  date: { flexShrink: 0 },
});
