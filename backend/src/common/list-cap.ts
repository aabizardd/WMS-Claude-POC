/**
 * Safety cap for list endpoints that return all rows without pagination
 * (e.g. small master-data tables consumed by client-side sorting/dropdowns).
 *
 * These tables are expected to stay well under this size; the cap is a guard
 * rail so an unexpectedly large table can never return an unbounded result set
 * and slow the app down. It does not change the UI for normal data volumes.
 */
export const LIST_HARD_CAP = 1000;
