/**
 * Rendering a name that may be a seeded default (§13).
 *
 * Closed enums — priority, state groups — map to messages in code, and no
 * translation key ever reaches the database. Seeded *defaults* are the awkward
 * middle: "In Progress" and "General" are names a company owns and may rename,
 * but until they do, a Khmer workspace should not be looking at English.
 *
 * So the row carries both: a `nameKey` while the product chose the name, and a
 * literal that wins the moment a person types their own. This is the one place
 * that rule is applied, so a screen cannot forget half of it and show a raw
 * message key to a user.
 *
 * In `src/lib` because both sides render names — the board draws its columns on
 * the server, the settings editor re-renders them as you type.
 */

export type SeededName = {
  name: string;
  nameKey: string | null;
};

/**
 * The name to show.
 *
 * `translate` is next-intl's `t`, passed in rather than imported so this stays
 * pure and works identically in a server component, a client component and a
 * test. A key with no catalogue entry falls back to the stored literal instead
 * of rendering `defaultState.todo` at a user — the catalogues are checked
 * key-for-key by `messages.test.ts`, but a fallback that is a real English word
 * is the better failure if one ever slips through.
 */
export function displayName(
  value: SeededName,
  translate: (key: string) => string,
): string {
  if (!value.nameKey) return value.name;

  try {
    const translated = translate(value.nameKey);
    return translated && translated !== value.nameKey ? translated : value.name;
  } catch {
    return value.name;
  }
}
