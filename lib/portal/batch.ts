import "server-only";

/** D1 binds at most 100 parameters per statement, so multi-row inserts go in chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** True when a D1 statement failed on the named SQLite constraint, such as "UNIQUE" or "FOREIGN KEY". */
export function constraintFailed(error: unknown, kind: "UNIQUE" | "FOREIGN KEY") {
  const pattern = new RegExp(`${kind} constraint failed`, "i");
  for (let e: unknown = error; e instanceof Error; e = e.cause) if (pattern.test(e.message)) return true;
  return false;
}
