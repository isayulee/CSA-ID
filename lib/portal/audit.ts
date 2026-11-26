import "server-only";
import { sql } from "drizzle-orm";
import type { AdminAuditAction, AdminAuditTarget } from "@/lib/db/schema";

export type AuditEntry = {
  actorGoogleSub: string;
  action: AdminAuditAction;
  targetType: AdminAuditTarget;
  targetId: string;
  targetLabel: string;
  reason?: string | null;
};

/**
 * The columns of one `admin_audit_log` row as constants, for an
 * `insert ... select` whose `from ... where` makes the entry conditional on the
 * row the action changes. Written that way, a racing second action writes no
 * second entry. The fields follow the table's column order, because an
 * INSERT ... SELECT lists every column.
 */
export function auditColumns(entry: AuditEntry) {
  return {
    id: sql<string>`${crypto.randomUUID()}`.as("id"),
    actorGoogleSub: sql<string>`${entry.actorGoogleSub}`.as("actor_google_sub"),
    action: sql<AdminAuditAction>`${entry.action}`.as("action"),
    targetType: sql<AdminAuditTarget>`${entry.targetType}`.as("target_type"),
    targetId: sql<string>`${entry.targetId}`.as("target_id"),
    targetLabel: sql<string>`${entry.targetLabel.slice(0, 128)}`.as("target_label"),
    reason: sql<string | null>`${entry.reason ?? null}`.as("reason"),
    createdAt: sql<number>`unixepoch()`.as("created_at"),
  };
}
