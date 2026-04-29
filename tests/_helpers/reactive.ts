// Cat-4 reactive test helper. Roept query 2x aan rond een mutation
// en geeft beide resultaten terug. Caller asserteert wat er moet veranderen.
//
// Verifieert dat een join-on-read query (cat-1) na een upstream mutation
// fresh data oplevert — proxy voor "subscribed UI rerendert".
//
// Gebruik:
//   const { before, after } = await assertReactive(
//     () => withUser(t, "alice").query(api.groups.listMine, {}),
//     () => withUser(t, "admin").mutation(api.groups.update, { groupId, name: "X" }),
//   );
//   expect(before[0].name).not.toBe(after[0].name);

export async function assertReactive<T>(
  query: () => Promise<T>,
  mutation: () => Promise<unknown>,
): Promise<{ before: T; after: T }> {
  const before = await query();
  await mutation();
  const after = await query();
  return { before, after };
}
