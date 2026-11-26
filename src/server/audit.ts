import { db } from '../db/index.ts';
import { auditLogs, notifications } from '../db/schema.ts';

export async function logAudit(params: {
  actorId?: number | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId?: string | number;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogs).values({
      actorId: params.actorId ?? null,
      actorName: params.actorName,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId !== undefined ? String(params.entityId) : '',
      detailsJson: params.details ?? {},
      ipAddress: params.ipAddress ?? '',
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export async function createNotification(params: {
  userId?: number | null;
  gradeId?: number | null;
  titleAr: string;
  bodyAr: string;
  type?: string;
  targetType?: string | null;
  targetId?: number | null;
  targetMetaJson?: Record<string, unknown> | null;
}) {
  try {
    await db.insert(notifications).values({
      userId: params.userId ?? null,
      gradeId: params.gradeId ?? null,
      titleAr: params.titleAr,
      bodyAr: params.bodyAr,
      type: params.type ?? 'GENERAL',
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      targetMetaJson: params.targetMetaJson ?? null,
    });
  } catch (err) {
    console.error('Notification insert failed:', err);
  }
}
