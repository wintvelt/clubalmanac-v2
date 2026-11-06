import { useAuth } from "@clerk/expo";
import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { Button } from "../components/Button";
import { Notice } from "../components/Notice";
import { forgetLastGroup } from "../data/lastGroup";
import { groupErrorKind } from "../lib/groups";
import { LoadError } from "./GroupParts";

// Gedeelde stukken van Album en Foto-detail (WP17a).

// Naar Mijn groepen, de wortel van de Home-stack, ook vanaf Album of Foto.
export function toMyGroups() {
  if (router.canDismiss()) router.dismissAll();
  else router.replace("/");
}

// Invariant 7 (WP16 invariant 5 en 9): geen lid meer, of het album of de foto
// bestaat niet. Geen crash en geen oude inhoud, wel een NL-melding en een weg
// naar Mijn groepen. Home vergeet deze groep (WP16 invariant 6).
export function NotMemberNotice({ groupId, what }: { groupId: string; what: "album" | "foto" }) {
  const { userId } = useAuth();
  useEffect(() => {
    if (userId) void forgetLastGroup(userId, groupId);
  }, [userId, groupId]);
  return (
    <>
      <Notice
        kind="error"
        title={what === "album" ? "Je kunt dit album niet meer zien" : "Je kunt deze foto niet meer zien"}
        message={
          what === "album"
            ? "Misschien ben je uit de groep gehaald, of bestaat het album niet meer."
            : "Misschien ben je uit de groep gehaald, of staat de foto niet meer in het album."
        }
      />
      <Button title="Naar Mijn groepen" icon="groups" onPress={toMyGroups} />
    </>
  );
}

// De fout van een album- of foto-read: NOT_MEMBER of iets anders.
export function AlbumReadFailed({
  groupId,
  what,
  error,
  reset,
}: {
  groupId: string;
  what: "album" | "foto";
  error: unknown;
  reset: () => void;
}) {
  return (
    <>
      <Stack.Screen options={{ title: what === "album" ? "Album" : "Foto" }} />
      {groupErrorKind(error) === "notMember" ? (
        <NotMemberNotice groupId={groupId} what={what} />
      ) : (
        <LoadError title={what === "album" ? "Dit album laden lukt niet" : "Deze foto laden lukt niet"} onRetry={reset} />
      )}
    </>
  );
}
