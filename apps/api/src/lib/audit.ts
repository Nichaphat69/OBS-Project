import { prisma } from '@obs/db';
import { emitChange } from './events.js';

/** Shared audit_log writer — every mutating action across the ported services logs through
 * this, matching src/db/index.js's logAudit() in the original. Also emits a "change" event for
 * the SSE stream, same as the original — every write that's worth an audit row is also worth
 * nudging any open browser tab to refresh (see events.ts / routes/stream.ts). */
export async function logAudit(entry: {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      at: new Date().toISOString(),
      actor: entry.actor,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      detail: JSON.stringify(entry.detail),
    },
  });
  emitChange(entry.action);
}
