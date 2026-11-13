import { useMutation } from "convex/react";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { SmallButton } from "../components/SmallButton";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useLiveQuery } from "../data/useLiveQuery";
import { locationPath, myLocationPath, myRotatePath, rotatePath } from "../lib/groupRoutes";
import { placeShareActions, placeShareLabel, shareNotice, type PlaceShareAction } from "../lib/placeShare";
import { addOutcome, myPhotoActions } from "../lib/myPhotos";
import { profilePhotoNotice } from "../lib/profileEdit";
import {
  photoActionLabel,
  photoActions,
  selectionPlan,
  selectionSummary,
  type PhotoAction,
  type Role,
  type SelectionAction,
} from "../lib/photoActions";
import { size, space, useTheme } from "../theme";

// WP17b: het foto-menu (detail: knop "Acties" rechtsboven; raster: lang
// drukken) en het selectiemenu. Het menu toont alleen wat de user mag
// (invariant 1 en 10); de backend beslist. Een weigering geeft één NL-melding
// en verandert niets. De melding staat onder de foto of onderaan het raster
// en blijft tot de volgende actie (design.md §6).

export type Feedback = { kind: "error" | "success"; title: string; message?: string };

// Wat het menu over een foto moet weten. Alle velden staan in albums.listPhotos.
// `ownerName`: voor de melding bij "Als profielfoto" (WP27 vraag 3).
// WP17d: `hasFormats` (delen alleen met formaten) en `exifOrientation` (rechtop delen).
export type MenuPhoto = {
  photoId: Id<"photos">;
  ownerId: Id<"users">;
  addedBy: Id<"users">;
  ownerName?: string;
  hasFormats?: boolean;
  exifOrientation?: number;
};

// WP17d: "Delen" en "Locatie wijzigen" bij de acties van WP17b.
export type MenuAction = PhotoAction | PlaceShareAction;

function menuActionLabel(action: MenuAction): string {
  return action === "share" || action === "location" ? placeShareLabel(action) : photoActionLabel(action);
}

const SHARE_FAILED: Feedback = {
  kind: "error",
  title: "Helaas, delen is niet gelukt",
  message: "Probeer het later opnieuw.",
};

// Wie kijkt, en met welke rol in de groep van dit album. De maker van het
// album telt niet (WP28 A-keuze 2, WP28b A-invariant 22).
export type MenuContext = { me: Id<"users">; role: Role };

const FAILED: Feedback = {
  kind: "error",
  title: "Helaas, dat lukte niet",
  message: "Er is niets veranderd. Probeer het later opnieuw.",
};

const SUCCESS: Record<Exclude<PhotoAction, "rotate">, Feedback> = {
  albumCover: { kind: "success", title: "Albumcover ingesteld", message: "Elk lid ziet deze foto nu als cover van het album." },
  groupCover: { kind: "success", title: "Groepscover ingesteld", message: "Elk lid ziet deze foto nu als cover van de groep." },
  profilePhoto: { kind: "success", title: "Profielfoto ingesteld" },
  removeFromAlbum: { kind: "success", title: "Uit het album gehaald" },
  delete: { kind: "success", title: "Foto verwijderd" },
};

// Invariant 2: wat er weggaat bij verwijderen.
function deleteWhat(n: number): string {
  return n === 1
    ? "De foto verdwijnt uit elk album. Is hij een cover of een profielfoto, dan is hij dat niet meer. Dit kun je niet ongedaan maken."
    : `De ${n} foto's verdwijnen uit elk album. Zijn ze een cover of een profielfoto, dan zijn ze dat niet meer. Dit kun je niet ongedaan maken.`;
}

// WP17c: waar het menu hoort. Een album (met zijn groep), of Mijn foto's
// (null): daar is elke foto van jou en kent het menu geen album (A-invariant 13).
export type MenuPlace = { groupId: Id<"groups">; albumId: Id<"albums"> } | null;

// De rol in de groep van dit album komt uit groups.listMine (de album-reads
// geven hem niet). Laden, of geen lid: geen context, dus geen menu.
export function useMenuContext(groupId: Id<"groups">, me: Id<"users"> | undefined): MenuContext | undefined {
  const groups = useLiveQuery(api.groups.listMine, {});
  const role = groups?.find((g) => g._id === groupId)?.role;
  return useMemo(() => (role && me ? { me, role } : undefined), [role, me]);
}

export function menuActions(
  ctx: MenuContext | undefined,
  photo: MenuPhoto | undefined,
  // WP17d besluit 5 (A-invariant 13): geen standaard-plek. Een album, of null
  // voor Mijn foto's; wie hem vergeet, krijgt een typefout.
  place: MenuPlace,
): MenuAction[] {
  if (!ctx || !photo) return [];
  // WP17d A-invariant 6: delen bij elke foto met formaten, locatie bij een
  // eigen foto. Bovenaan; verwijderen (rood) blijft onderaan.
  const placeShare = placeShareActions({ me: ctx.me, ownerId: photo.ownerId, hasFormats: photo.hasFormats === true });
  if (place === null) return photo.ownerId === ctx.me ? [...placeShare, ...myPhotoActions()] : [];
  return [...placeShare, ...photoActions({ ...ctx, ownerId: photo.ownerId, addedBy: photo.addedBy })];
}

function confirm(title: string, message: string, verb: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Annuleren", style: "cancel" },
    { text: verb, style: "destructive", onPress: onConfirm },
  ]);
}

// WP17d: het delen zelf (src/data/share.ts, useSharePhoto) geeft het scherm
// mee; zo laadt dit menu geen native module.
export type SharePhoto = (photo: MenuPhoto) => Promise<"shared" | "unavailable">;

export function usePhotoMenu({
  place,
  ctx,
  photoIds,
  onFeedback,
  sharePhoto,
}: {
  place: MenuPlace;
  ctx: MenuContext | undefined;
  sharePhoto: SharePhoto;
  // De foto's die nu in het album staan: verdwijnt de foto van een open menu, dan sluit het.
  photoIds: readonly string[];
  onFeedback: (f: Feedback | null) => void;
}) {
  const updateAlbum = useMutation(api.albums.update);
  const updateGroup = useMutation(api.groups.update);
  const setProfilePhoto = useMutation(api.users.setProfilePhoto);
  const removeFromAlbum = useMutation(api.albums.removePhoto);
  const removePhoto = useMutation(api.photos.remove);
  const openFor = useRef<string | null>(null);
  // WP17d A-invariant 12: de ref houdt een tweede tik tegen (ook binnen één
  // render), de state laat het scherm zien dat het delen bezig is.
  const shareBusy = useRef(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (openFor.current !== null && !photoIds.includes(openFor.current)) {
      openFor.current = null;
      ActionSheetIOS.dismissActionSheet();
    }
  }, [photoIds]);

  const attempt = useCallback(
    async (run: () => Promise<unknown>, done: Feedback) => {
      try {
        await run();
        onFeedback(done);
      } catch {
        onFeedback(FAILED);
      }
    },
    [onFeedback],
  );

  // WP17d besluit 3: bij andermans foto eerst één regel dat hij de app verlaat.
  const share = useCallback(
    (photo: MenuPhoto) => {
      const run = async () => {
        if (shareBusy.current) return;
        shareBusy.current = true;
        setSharing(true);
        try {
          const outcome = await sharePhoto(photo);
          if (outcome === "unavailable") onFeedback(SHARE_FAILED);
        } catch {
          onFeedback(SHARE_FAILED);
        } finally {
          shareBusy.current = false;
          setSharing(false);
        }
      };
      // Tijdens het delen doet een nieuwe tik op "Delen" niets, ook niet bij een andere foto.
      if (shareBusy.current) return;
      const notice = ctx ? shareNotice({ me: ctx.me, ownerId: photo.ownerId, ownerName: photo.ownerName }) : null;
      if (notice === null) {
        void run();
        return;
      }
      Alert.alert("Foto delen?", notice, [
        { text: "Annuleren", style: "cancel" },
        { text: "Delen", onPress: () => void run() },
      ]);
    },
    [ctx, sharePhoto, onFeedback],
  );

  const perform = useCallback(
    (action: MenuAction, photo: MenuPhoto) => {
      const { photoId } = photo;
      if (action === "share") {
        share(photo);
        return;
      }
      if (action === "location") {
        router.push(place ? locationPath(place.groupId, place.albumId, photoId) : myLocationPath(photoId));
        return;
      }
      if (action === "rotate") {
        router.push(place ? rotatePath(place.groupId, place.albumId, photoId) : myRotatePath(photoId));
        return;
      }
      // Wat bij een album hoort, kan alleen in een album (A-invariant 13).
      if (place === null && (action === "albumCover" || action === "groupCover" || action === "removeFromAlbum")) return;
      const groupId = place?.groupId as Id<"groups">;
      const albumId = place?.albumId as Id<"albums">;
      switch (action) {
        case "albumCover":
          void attempt(() => updateAlbum({ albumId, coverPhotoId: photoId }), SUCCESS.albumCover);
          return;
        case "groupCover":
          void attempt(() => updateGroup({ groupId, coverPhotoId: photoId }), SUCCESS.groupCover);
          return;
        case "profilePhoto": {
          // Invariant 6, WP27 invariant 2: eerst zeggen dat een profielfoto
          // openbaar is; bij de foto van een ander ook van wie hij is, en dat
          // die er geen bericht van krijgt (besluit 5).
          const notice = profilePhotoNotice({ isMe: ctx?.me === photo.ownerId, name: photo.ownerName });
          Alert.alert(
            notice.title,
            notice.message,
            [
              { text: "Annuleren", style: "cancel" },
              {
                text: "Instellen",
                onPress: () => void attempt(() => setProfilePhoto({ photoId }), SUCCESS.profilePhoto),
              },
            ],
          );
          return;
        }
        case "removeFromAlbum": {
          const run = () => void attempt(() => removeFromAlbum({ albumId, photoId }), SUCCESS.removeFromAlbum);
          // Besluit 3: alleen bij de foto van een ander; die zet alleen de eigenaar terug.
          if (ctx && photo.ownerId !== ctx.me) {
            confirm(
              "Uit dit album halen?",
              "Dit is de foto van een ander. Alleen de eigenaar kan hem weer in het album zetten.",
              "Uit album halen",
              run,
            );
          } else {
            run();
          }
          return;
        }
        case "delete":
          // Invariant 2: altijd eerst vragen, en zeggen wat er weggaat.
          confirm("Foto overal verwijderen?", deleteWhat(1), "Verwijderen", () =>
            void attempt(() => removePhoto({ photoId }), SUCCESS.delete),
          );
          return;
      }
    },
    [place, ctx, share, attempt, updateAlbum, updateGroup, setProfilePhoto, removeFromAlbum, removePhoto],
  );

  const open = useCallback(
    (photo: MenuPhoto) => {
      const actions = menuActions(ctx, photo, place);
      if (actions.length === 0) return;
      onFeedback(null);
      const options = [...actions.map(menuActionLabel), "Annuleren"];
      const destructive = actions.indexOf("delete");
      openFor.current = photo.photoId;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
        },
        (index) => {
          openFor.current = null;
          const action = actions[index];
          if (action) perform(action, photo);
        },
      );
    },
    [ctx, place, onFeedback, perform],
  );

  // WP17d A-invariant 13: "is er een menu?" met dezelfde plek als `open`.
  const hasActions = useCallback(
    (photo: MenuPhoto | undefined) => menuActions(ctx, photo, place).length > 0,
    [ctx, place],
  );

  return { open, sharing, hasActions };
}

// --- Selectie (invariant 7, A-keuze 2) -------------------------------------------------

function photos(n: number): string {
  return n === 1 ? "1 foto" : `${n} foto's`;
}

const DONE: Record<SelectionAction, string> = {
  delete: "verwijderd",
  removeFromAlbum: "uit het album gehaald",
  addToAlbum: "toegevoegd aan het album",
};

export function useSelectionActions({
  albumId,
  ctx,
  onFeedback,
  onDone,
  onBusyChange,
}: {
  // Het album van de selectie; in Mijn foto's geen (dan geen "uit album").
  albumId?: Id<"albums">;
  ctx: MenuContext | undefined;
  onFeedback: (f: Feedback | null) => void;
  onDone: () => void;
  // Zodat de balk kan laten zien dat hij bezig is.
  onBusyChange?: (busy: boolean) => void;
}) {
  const removeFromAlbum = useMutation(api.albums.removePhoto);
  const removePhoto = useMutation(api.photos.remove);
  const addToAlbum = useMutation(api.albums.addPhoto);
  // Fix-cyclus 1, invariant 15: één ronde tegelijk. Een ref, geen state: een
  // tweede tik vóór de volgende render ziet hem ook.
  const busy = useRef(false);

  return useCallback(
    // WP17c: bij "addToAlbum" is `target` het gekozen album.
    (action: SelectionAction, selected: readonly MenuPhoto[], target?: Id<"albums">) => {
      if (busy.current || !ctx || selected.length === 0) return;
      if (action === "removeFromAlbum" && !albumId) return;
      if (action === "addToAlbum" && !target) return;
      onFeedback(null);
      const plan = selectionPlan(action, selected, ctx);
      const finish = async () => {
        if (busy.current) return;
        busy.current = true;
        onBusyChange?.(true);
        // Per foto: wat mag, gebeurt; wat de backend daarna nog weigert, telt als mislukt.
        const results = await Promise.allSettled(
          plan.allowed.map((photoId) =>
            action === "delete"
              ? removePhoto({ photoId })
              : action === "addToAlbum"
                ? addToAlbum({ albumId: target!, photoId })
                : removeFromAlbum({ albumId: albumId!, photoId }),
          ),
        );
        busy.current = false;
        onBusyChange?.(false);
        // Invariant 3: "stond er al in" is geen fout; elke andere weigering wel.
        let failed = 0;
        let alreadyIn = 0;
        for (const r of results) {
          if (r.status === "fulfilled") continue;
          if (action === "addToAlbum" && addOutcome(r.reason) === "alreadyIn") alreadyIn++;
          else failed++;
        }
        const done = plan.allowed.length - failed - alreadyIn;
        const summary = selectionSummary(action, { done, notAllowed: plan.notAllowed.length, failed, alreadyIn });
        onFeedback(
          summary === null
            ? { kind: "success", title: `${photos(done)} ${DONE[action]}` }
            : {
                // Alleen "stond er al in": geen fout.
                kind: failed > 0 || plan.notAllowed.length > 0 ? "error" : "success",
                title: done > 0 ? `${photos(done)} ${DONE[action]}` : "Er is niets veranderd",
                message: summary,
              },
        );
        onDone();
      };
      if (plan.allowed.length === 0) {
        void finish();
        return;
      }
      const notMine = plan.notAllowed.length;
      if (action === "addToAlbum") {
        void finish();
        return;
      }
      if (action === "delete") {
        const rest = notMine > 0 ? ` ${photos(notMine)} van anderen blijven staan.` : "";
        const n = plan.allowed.length;
        confirm(`${photos(n)} overal verwijderen?`, `${deleteWhat(n)}${rest}`, "Verwijderen", () => void finish());
        return;
      }
      // Besluit 3: bevestigen als er een foto van een ander bij zit.
      const othersAllowed = selected.filter((p) => plan.allowed.includes(p.photoId) && p.ownerId !== ctx.me).length;
      if (othersAllowed > 0) {
        confirm(
          `${photos(plan.allowed.length)} uit dit album halen?`,
          `Daarbij ${othersAllowed === 1 ? "is 1 foto" : `zijn ${othersAllowed} foto's`} van een ander. Alleen de eigenaar kan die weer in het album zetten.`,
          "Uit album halen",
          () => void finish(),
        );
        return;
      }
      void finish();
    },
    [albumId, ctx, onFeedback, onDone, onBusyChange, removeFromAlbum, removePhoto, addToAlbum],
  );
}

// --- Bouwstenen voor de schermen --------------------------------------------------------

// Rechtsboven in het detail: "Acties", met icoon en label (design.md §9).
export function ActionsButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Acties voor deze foto"
      onPress={onPress}
      hitSlop={space.s}
      style={({ pressed }) => [styles.actions, pressed && styles.pressed]}
    >
      <Icon name="more" size={22} color={colors.primary} />
      <Text variant="button" color="primary" maxFontSizeMultiplier={1.3}>
        Acties
      </Text>
    </Pressable>
  );
}

// WP17d A-invariant 12: zolang *groot* wordt opgehaald en klaargemaakt, staat
// er dat het delen bezig is (op 4G een paar seconden).
export function SharingProgress() {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Foto klaarmaken om te delen"
      accessibilityLiveRegion="polite"
      style={[progress.row, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <ActivityIndicator color={colors.primary} />
      <Text variant="body">Foto klaarmaken om te delen…</Text>
    </View>
  );
}

const progress = StyleSheet.create({
  row: {
    minHeight: size.touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12, // radius.listBlock; de theme-mocks in de tests kennen geen radius
  },
});

// De melding na een actie, met "Oké" om hem weg te halen.
export function ActionFeedback({ feedback, onClose }: { feedback: Feedback; onClose: () => void }) {
  return (
    <Notice kind={feedback.kind} title={feedback.title} message={feedback.message}>
      <SmallButton title="Oké" onPress={onClose} />
    </Notice>
  );
}

const styles = StyleSheet.create({
  actions: {
    minHeight: size.touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
  pressed: { opacity: 0.6 },
});

// Voor de selectiebalk en de melding onderaan het raster.
export function BottomPanel({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[panel.bar, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
      <View style={panel.column}>{children}</View>
    </View>
  );
}

const panel = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.m },
  column: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
    gap: space.m,
  },
});
