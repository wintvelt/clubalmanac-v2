import { useMutation } from "convex/react";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { ActionSheetIOS, Alert, Pressable, StyleSheet, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { SmallButton } from "../components/SmallButton";
import { Text } from "../components/Text";
import { api } from "../convexApi";
import { useLiveQuery } from "../data/useLiveQuery";
import { rotatePath } from "../lib/groupRoutes";
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
export type MenuPhoto = {
  photoId: Id<"photos">;
  ownerId: Id<"users">;
  addedBy: Id<"users">;
  ownerName?: string;
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
    ? "De foto verdwijnt uit elk album, met zijn likes. Is hij een cover of een profielfoto, dan is hij dat niet meer. Dit kun je niet ongedaan maken."
    : `De ${n} foto's verdwijnen uit elk album, met hun likes. Zijn ze een cover of een profielfoto, dan zijn ze dat niet meer. Dit kun je niet ongedaan maken.`;
}

// De rol in de groep van dit album komt uit groups.listMine (de album-reads
// geven hem niet). Laden, of geen lid: geen context, dus geen menu.
export function useMenuContext(groupId: Id<"groups">, me: Id<"users"> | undefined): MenuContext | undefined {
  const groups = useLiveQuery(api.groups.listMine, {});
  const role = groups?.find((g) => g._id === groupId)?.role;
  return useMemo(() => (role && me ? { me, role } : undefined), [role, me]);
}

export function menuActions(ctx: MenuContext | undefined, photo: MenuPhoto | undefined): PhotoAction[] {
  if (!ctx || !photo) return [];
  return photoActions({ ...ctx, ownerId: photo.ownerId, addedBy: photo.addedBy });
}

function confirm(title: string, message: string, verb: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Annuleren", style: "cancel" },
    { text: verb, style: "destructive", onPress: onConfirm },
  ]);
}

export function usePhotoMenu({
  groupId,
  albumId,
  ctx,
  photoIds,
  onFeedback,
}: {
  groupId: Id<"groups">;
  albumId: Id<"albums">;
  ctx: MenuContext | undefined;
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

  const perform = useCallback(
    (action: PhotoAction, photo: MenuPhoto) => {
      const { photoId } = photo;
      switch (action) {
        case "rotate":
          router.push(rotatePath(groupId, albumId, photoId));
          return;
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
    [groupId, albumId, ctx, attempt, updateAlbum, updateGroup, setProfilePhoto, removeFromAlbum, removePhoto],
  );

  const open = useCallback(
    (photo: MenuPhoto) => {
      const actions = menuActions(ctx, photo);
      if (actions.length === 0) return;
      onFeedback(null);
      const options = [...actions.map(photoActionLabel), "Annuleren"];
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
    [ctx, onFeedback, perform],
  );

  return { open };
}

// --- Selectie (invariant 7, A-keuze 2) -------------------------------------------------

function photos(n: number): string {
  return n === 1 ? "1 foto" : `${n} foto's`;
}

const DONE: Record<SelectionAction, string> = {
  delete: "verwijderd",
  removeFromAlbum: "uit het album gehaald",
};

export function useSelectionActions({
  albumId,
  ctx,
  onFeedback,
  onDone,
  onBusyChange,
}: {
  albumId: Id<"albums">;
  ctx: MenuContext | undefined;
  onFeedback: (f: Feedback | null) => void;
  onDone: () => void;
  // Zodat de balk kan laten zien dat hij bezig is.
  onBusyChange?: (busy: boolean) => void;
}) {
  const removeFromAlbum = useMutation(api.albums.removePhoto);
  const removePhoto = useMutation(api.photos.remove);
  // Fix-cyclus 1, invariant 15: één ronde tegelijk. Een ref, geen state: een
  // tweede tik vóór de volgende render ziet hem ook.
  const busy = useRef(false);

  return useCallback(
    (action: SelectionAction, selected: readonly MenuPhoto[]) => {
      if (busy.current || !ctx || selected.length === 0) return;
      onFeedback(null);
      const plan = selectionPlan(action, selected, ctx);
      const finish = async () => {
        if (busy.current) return;
        busy.current = true;
        onBusyChange?.(true);
        // Per foto: wat mag, gebeurt; wat de backend daarna nog weigert, telt als mislukt.
        const results = await Promise.allSettled(
          plan.allowed.map((photoId) =>
            action === "delete" ? removePhoto({ photoId }) : removeFromAlbum({ albumId, photoId }),
          ),
        );
        busy.current = false;
        onBusyChange?.(false);
        const failed = results.filter((r) => r.status === "rejected").length;
        const done = plan.allowed.length - failed;
        const summary = selectionSummary(action, { done, notAllowed: plan.notAllowed.length, failed });
        onFeedback(
          summary === null
            ? { kind: "success", title: `${photos(done)} ${DONE[action]}` }
            : { kind: "error", title: done > 0 ? `${photos(done)} ${DONE[action]}` : "Er is niets veranderd", message: summary },
        );
        onDone();
      };
      if (plan.allowed.length === 0) {
        void finish();
        return;
      }
      const notMine = plan.notAllowed.length;
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
    [albumId, ctx, onFeedback, onDone, onBusyChange, removeFromAlbum, removePhoto],
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
