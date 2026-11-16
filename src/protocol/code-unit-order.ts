/**
 * Locale independent string ordering.
 *
 * Anything that is hashed, fingerprinted, serialized or compared across
 * machines must order strings by UTF-16 code unit, never by localeCompare or
 * Intl.Collator, which depend on the computer's language setting.
 */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
