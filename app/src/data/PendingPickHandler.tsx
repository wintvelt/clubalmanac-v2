import { router } from "expo-router";
import { useEffect } from "react";
import { setAddHandoff } from "./pickHandoff";
import { takePendingPick } from "./pendingPick";

// WP42c invariant 8, A36: na de start (ingelogd en klaar) één keer kijken of
// Android een keuze bewaarde terwijl de app dicht ging. Een keuze voor het
// toevoegscherm opent het toevoegscherm met die keuze en het album van toen;
// "kies opnieuw" opent het toevoegscherm met die melding. Op iOS en het web
// doet `takePendingPick` niets.
export function PendingPickHandler() {
  useEffect(() => {
    void takePendingPick()
      .then((action) => {
        if (action.kind !== "toevoegen" && action.kind !== "opnieuw_kiezen") return;
        setAddHandoff(action);
        const { albumId } = action;
        router.push(albumId ? { pathname: "/toevoegen", params: { albumId } } : "/toevoegen");
      })
      .catch(() => {});
  }, []);
  return null;
}
