/**
 * Exact ID inventory from Appendix A of the Panefold v1 system design.
 * Statements and levels deliberately remain in the source design; this inventory does not
 * synthesize requirement text or claim that evidence exists.
 */
const REQUIREMENT_FAMILY_COUNTS = [
  ["A11Y", 8],
  ["ACC", 3],
  ["API", 8],
  ["ARC", 5],
  ["COL", 6],
  ["DOM", 5],
  ["EXP", 5],
  ["EXT", 6],
  ["FOC", 6],
  ["FWK", 6],
  ["GOV", 6],
  ["I18N", 3],
  ["INT", 7],
  ["LAY", 7],
  ["LIF", 7],
  ["MOD", 6],
  ["MOT", 10],
  ["OBS", 6],
  ["PER", 8],
  ["PKG", 5],
  ["PRF", 7],
  ["QLT", 5],
  ["REN", 6],
  ["RSK", 4],
  ["RSP", 2],
  ["SCP", 4],
  ["SEC", 8],
  ["SUR", 7],
  ["SYS", 5],
  ["THM", 2],
  ["TST", 9],
  ["TXN", 8],
] as const;

export const PANEFOLD_V1_REQUIREMENT_IDS: readonly string[] = Object.freeze(
  REQUIREMENT_FAMILY_COUNTS.flatMap(([family, count]) =>
    Array.from(
      { length: count },
      (_, index) => `${family}-${(index + 1).toString().padStart(3, "0")}`,
    ),
  ),
);

export const PANEFOLD_V1_REQUIREMENT_COUNT = 190;
