// WP29 fix-cyclus 1, punt 7: wat de poort toont als er een sessie is maar
// users.current `null` is. Na Account verwijderen is dat zo:
// - het verwijderen of uitloggen loopt nog: alleen "Laden…";
// - verwijderd, maar het uitloggen lukte niet: "Je account is verwijderd",
//   met Uitloggen (niet "Je account is nog niet klaar");
// - anders: "Je account is nog niet klaar".
// De vlaggen komen uit app/src/data/accountDeletion.ts.

export type NoUserRowView = "loading" | "accountDeleted" | "notReady";

export function noUserRowView(input: { deleting: boolean; deleted: boolean }): NoUserRowView {
  if (input.deleting) return "loading";
  if (input.deleted) return "accountDeleted";
  return "notReady";
}
