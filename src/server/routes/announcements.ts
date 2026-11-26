import crypto from 'node:crypto';
import express, { Router, type NextFunction, type Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  announcements,
  announcementStoredFiles,
  grades,
  groups,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  hasAnyPermission,
  requireActiveAccount,
  requireAuth,
  requireStaff,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { logAudit } from '../audit.ts';
import { publishedAnnouncementsCache } from '../cache.ts';
import { getHomeworkFileSigningSecret } from '../config/secrets.ts';

function getAnnouncementSigningKey(): string {
  return crypto
    .createHmac('sha256', getHomeworkFileSigningSecret())
    .update('announcement-media-v1')
    .digest('hex');
}

const MAX_IMAGE_OR_GIF_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_BYTES = 12 * 1024 * 1024; // 12 MB

function requireAnnouncementPermission(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.authUser) return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً' });
  if (
    req.authUser.roleSlug === 'SUPER_ADMIN' ||
    hasAnyPermission(req.authUser, [
      PERMISSIONS.NOTIFICATIONS_SEND,
      PERMISSIONS.CONTENT_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ])
  ) {
    return next();
  }
  return res.status(403).json({ error: 'ليس لديك صلاحية إدارة الإعلانات.' });
}

export function detectSafeAnnouncementMediaMime(buf: Buffer): {
  mimeType: string;
  mediaType: 'IMAGE' | 'GIF' | 'VIDEO_UPLOAD';
} | null {
  if (buf.length < 12) return null;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', mediaType: 'IMAGE' };
  }
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mimeType: 'image/png', mediaType: 'IMAGE' };
  }
  // GIF87a / GIF89a
  const gifSig = buf.subarray(0, 6).toString('ascii');
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return { mimeType: 'image/gif', mediaType: 'GIF' };
  }
  // WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', mediaType: 'IMAGE' };
  }
  // MP4 / MOV (ftyp at offset 4)
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { mimeType: 'video/mp4', mediaType: 'VIDEO_UPLOAD' };
  }
  // WEBM (EBML header 1A 45 DF A3)
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { mimeType: 'video/webm', mediaType: 'VIDEO_UPLOAD' };
  }
  return null;
}

export function validateSafeHttpsUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    host.endsWith('.internal')
  ) {
    return null;
  }
  return parsed.toString();
}

export function buildSignedAnnouncementMediaUrl(storageKey: string): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 6; // 6 hours
  const sig = crypto
    .createHmac('sha256', getAnnouncementSigningKey())
    .update(`${storageKey}:${exp}`)
    .digest('hex')
    .slice(0, 32);
  return `/api/announcements/files/${encodeURIComponent(storageKey)}?exp=${exp}&sig=${sig}`;
}

function verifyAnnouncementMediaSignature(storageKey: string, expRaw: string, sigRaw: string): boolean {
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto
    .createHmac('sha256', getAnnouncementSigningKey())
    .update(`${storageKey}:${exp}`)
    .digest('hex')
    .slice(0, 32);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sigRaw || '')));
  } catch {
    return false;
  }
}

export interface StudentAnnouncementItem {
  id: number;
  titleAr: string;
  bodyAr: string;
  mediaType: 'NONE' | 'IMAGE' | 'GIF' | 'VIDEO_UPLOAD' | 'EXTERNAL_VIDEO';
  mediaUrl: string | null;
  mediaMimeType: string | null;
  externalVideoUrl: string | null;
  ctaLabelAr: string;
  ctaTargetType:
    | 'NONE'
    | 'VIDEO'
    | 'COURSE'
    | 'HOMEWORK'
    | 'EXAM'
    | 'PDF'
    | 'SCHEDULE'
    | 'CURRICULUM'
    | 'BILLING'
    | 'EXTERNAL_URL';
  ctaTargetId: number | null;
  ctaExternalUrl: string | null;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

/**
 * Loads ONLY active, published, schedule-valid announcements targeting this student.
 * Never loads base64 file bytes — returns lightweight signed media URLs only.
 */
export async function loadActiveAnnouncementsForStudent(input: {
  trackIds: number[];
  gradeIds: number[];
  groupIds: number[];
  now?: Date;
}): Promise<StudentAnnouncementItem[]> {
  const now = input.now || new Date();
  const rows = (await publishedAnnouncementsCache.getOrLoad('published', () =>
    db
      .select()
      .from(announcements)
      .where(eq(announcements.status, 'PUBLISHED'))
      .orderBy(desc(announcements.priority), desc(announcements.createdAt))
      .limit(30),
  )) as Array<typeof announcements.$inferSelect>;

  const trackSet = new Set(input.trackIds);
  const gradeSet = new Set(input.gradeIds);
  const groupSet = new Set(input.groupIds);

  return rows
    .filter((a) => {
      if (a.startsAt && a.startsAt.getTime() > now.getTime()) return false;
      if (a.endsAt && a.endsAt.getTime() < now.getTime()) return false;
      if (a.targetScope === 'ALL') return true;
      if (a.targetScope === 'TRACK') return Boolean(a.targetTrackId && trackSet.has(a.targetTrackId));
      if (a.targetScope === 'GRADE') return Boolean(a.targetGradeId && gradeSet.has(a.targetGradeId));
      if (a.targetScope === 'GROUP') return Boolean(a.targetGroupId && groupSet.has(a.targetGroupId));
      return false;
    })
    .slice(0, 12)
    .map((a) => ({
      id: a.id,
      titleAr: a.titleAr,
      bodyAr: a.bodyAr || '',
      mediaType: a.mediaType as StudentAnnouncementItem['mediaType'],
      mediaUrl: a.storageKey ? buildSignedAnnouncementMediaUrl(a.storageKey) : null,
      mediaMimeType: a.mediaMimeType ?? null,
      externalVideoUrl: a.externalVideoUrl ?? null,
      ctaLabelAr: a.ctaLabelAr || '',
      ctaTargetType: a.ctaTargetType as StudentAnnouncementItem['ctaTargetType'],
      ctaTargetId: a.ctaTargetId ?? null,
      ctaExternalUrl: a.ctaExternalUrl ?? null,
      priority: a.priority,
      startsAt: a.startsAt ? a.startsAt.toISOString() : null,
      endsAt: a.endsAt ? a.endsAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    }));
}

const announcementPayloadSchema = z.object({
  titleAr: z.string().trim().min(2, 'عنوان الإعلان مطلوب').max(180),
  bodyAr: z.string().trim().max(2000).optional().default(''),
  mediaType: z.enum(['NONE', 'IMAGE', 'GIF', 'VIDEO_UPLOAD', 'EXTERNAL_VIDEO']).default('NONE'),
  storageKey: z.string().trim().max(200).nullable().optional(),
  mediaFileName: z.string().trim().max(200).nullable().optional(),
  mediaMimeType: z.string().trim().max(100).nullable().optional(),
  externalVideoUrl: z.string().trim().max(1000).nullable().optional(),
  ctaLabelAr: z.string().trim().max(80).optional().default(''),
  ctaTargetType: z
    .enum([
      'NONE',
      'VIDEO',
      'COURSE',
      'HOMEWORK',
      'EXAM',
      'PDF',
      'SCHEDULE',
      'CURRICULUM',
      'BILLING',
      'EXTERNAL_URL',
    ])
    .default('NONE'),
  ctaTargetId: z.coerce.number().int().positive().nullable().optional(),
  ctaExternalUrl: z.string().trim().max(1000).nullable().optional(),
  targetScope: z.enum(['ALL', 'TRACK', 'GRADE', 'GROUP']).default('ALL'),
  targetTrackId: z.coerce.number().int().positive().nullable().optional(),
  targetGradeId: z.coerce.number().int().positive().nullable().optional(),
  targetGroupId: z.coerce.number().int().positive().nullable().optional(),
  priority: z.coerce.number().int().min(-100).max(1000).default(0),
  status: z.enum(['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED']).default('DRAFT'),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
});

function parseDateOrNull(val: string | null | undefined): Date | null {
  if (!val || !val.trim()) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

// =========================================================================
// SIGNED MEDIA STREAMING ROUTER (/api/announcements/files)
// =========================================================================
export const announcementFilesRouter = Router();

announcementFilesRouter.get('/:storageKey', async (req, res) => {
  try {
    const storageKey = String(req.params.storageKey || '').trim();
    const exp = String(req.query.exp || '');
    const sig = String(req.query.sig || '');

    if (!storageKey || !verifyAnnouncementMediaSignature(storageKey, exp, sig)) {
      return res.status(403).json({ error: 'رابط الوسائط غير صالح أو منتهي الصلاحية' });
    }

    const [file] = await db
      .select()
      .from(announcementStoredFiles)
      .where(eq(announcementStoredFiles.storageKey, storageKey))
      .limit(1);
    if (!file) return res.status(404).json({ error: 'الملف غير موجود' });

    const buffer = Buffer.from(file.dataBase64, 'base64');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  } catch (err) {
    console.error('Announcement file serve error:', err);
    return res.status(500).json({ error: 'تعذر تحميل ملف الإعلان' });
  }
});

// =========================================================================
// ADMIN ANNOUNCEMENTS ROUTER (/api/admin/announcements)
// =========================================================================
export const adminAnnouncementsRouter = Router();
adminAnnouncementsRouter.use(express.json({ limit: '18mb' }));
adminAnnouncementsRouter.use(
  requireAuth,
  requireActiveAccount,
  requireStaff(),
  requireAnnouncementPermission,
);
adminAnnouncementsRouter.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400) publishedAnnouncementsCache.clear();
    });
  }
  next();
});

adminAnnouncementsRouter.get('/', async (_req, res) => {
  try {
    const [rows, trackRows, gradeRows, groupRows] = await Promise.all([
      db
        .select()
        .from(announcements)
        .orderBy(desc(announcements.priority), desc(announcements.updatedAt)),
      db.select().from(academicTracks),
      db.select().from(grades),
      db.select().from(groups),
    ]);

    const trackMap = new Map(trackRows.map((t) => [t.id, t.nameAr]));
    const gradeMap = new Map(gradeRows.map((g) => [g.id, g.nameAr]));
    const groupMap = new Map(groupRows.map((g) => [g.id, g.nameAr]));

    return res.json({
      announcements: rows.map((a) => ({
        id: a.id,
        titleAr: a.titleAr,
        bodyAr: a.bodyAr,
        mediaType: a.mediaType,
        storageKey: a.storageKey,
        mediaFileName: a.mediaFileName,
        mediaMimeType: a.mediaMimeType,
        mediaUrl: a.storageKey ? buildSignedAnnouncementMediaUrl(a.storageKey) : null,
        externalVideoUrl: a.externalVideoUrl,
        ctaLabelAr: a.ctaLabelAr,
        ctaTargetType: a.ctaTargetType,
        ctaTargetId: a.ctaTargetId,
        ctaExternalUrl: a.ctaExternalUrl,
        targetScope: a.targetScope,
        targetTrackId: a.targetTrackId,
        targetTrackNameAr: a.targetTrackId ? trackMap.get(a.targetTrackId) || null : null,
        targetGradeId: a.targetGradeId,
        targetGradeNameAr: a.targetGradeId ? gradeMap.get(a.targetGradeId) || null : null,
        targetGroupId: a.targetGroupId,
        targetGroupNameAr: a.targetGroupId ? groupMap.get(a.targetGroupId) || null : null,
        priority: a.priority,
        status: a.status,
        startsAt: a.startsAt ? a.startsAt.toISOString() : null,
        endsAt: a.endsAt ? a.endsAt.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      groups: groupRows.map((g) => ({ id: g.id, nameAr: g.nameAr })),
    });
  } catch (err) {
    console.error('Admin announcements list error:', err);
    return res.status(500).json({ error: 'تعذر تحميل الإعلانات' });
  }
});

adminAnnouncementsRouter.post('/upload-media', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      fileName: z.string().trim().min(1).max(200),
      dataBase64: z.string().min(10),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات الملف المرفوع غير صالحة' });
    }

    const rawBase64 = parsed.data.dataBase64.includes(',')
      ? parsed.data.dataBase64.split(',').pop() || ''
      : parsed.data.dataBase64;
    const buffer = Buffer.from(rawBase64, 'base64');

    const detected = detectSafeAnnouncementMediaMime(buffer);
    if (!detected) {
      return res.status(400).json({
        error: 'نوع الملف غير مدعوم. يُسمح فقط بصور JPG / PNG / WEBP / GIF أو فيديو قصير MP4 / WEBM.',
      });
    }

    const maxBytes =
      detected.mediaType === 'VIDEO_UPLOAD' ? MAX_VIDEO_BYTES : MAX_IMAGE_OR_GIF_BYTES;
    if (buffer.length > maxBytes) {
      return res.status(400).json({
        error:
          detected.mediaType === 'VIDEO_UPLOAD'
            ? 'حجم الفيديو القصير يتجاوز الحد الأقصى المسموح (12 ميجابايت).'
            : 'حجم الصورة أو ملف GIF يتجاوز الحد الأقصى المسموح (5 ميجابايت).',
      });
    }

    const storageKey = `ann_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

    await db.insert(announcementStoredFiles).values({
      storageKey,
      uploadedById: req.authUser!.id,
      originalName: parsed.data.fileName,
      mimeType: detected.mimeType,
      sizeBytes: buffer.length,
      sha256Hash,
      dataBase64: buffer.toString('base64'),
    });

    return res.status(201).json({
      storageKey,
      fileName: parsed.data.fileName,
      mimeType: detected.mimeType,
      mediaType: detected.mediaType,
      sizeBytes: buffer.length,
      previewUrl: buildSignedAnnouncementMediaUrl(storageKey),
    });
  } catch (err) {
    console.error('Announcement media upload error:', err);
    return res.status(500).json({ error: 'تعذر رفع ملف وسائط الإعلان' });
  }
});

adminAnnouncementsRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const parsed = announcementPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الإعلان غير صالحة' });
    }
    const d = parsed.data;

    let safeExternalVideo: string | null = null;
    if (d.mediaType === 'EXTERNAL_VIDEO') {
      safeExternalVideo = validateSafeHttpsUrl(d.externalVideoUrl);
      if (!safeExternalVideo) {
        return res.status(400).json({ error: 'يرجى إدخال رابط فيديو خارجي آمن يبدأ بـ https://' });
      }
    }

    let safeCtaExternal: string | null = null;
    if (d.ctaTargetType === 'EXTERNAL_URL') {
      safeCtaExternal = validateSafeHttpsUrl(d.ctaExternalUrl);
      if (!safeCtaExternal) {
        return res.status(400).json({ error: 'رابط الزر الخارجي يجب أن يكون رابط https:// آمنًا' });
      }
    }

    const [created] = await db
      .insert(announcements)
      .values({
        titleAr: d.titleAr,
        bodyAr: d.bodyAr,
        mediaType: d.mediaType,
        storageKey:
          d.mediaType === 'IMAGE' || d.mediaType === 'GIF' || d.mediaType === 'VIDEO_UPLOAD'
            ? d.storageKey || null
            : null,
        mediaFileName: d.mediaFileName || null,
        mediaMimeType: d.mediaMimeType || null,
        externalVideoUrl: safeExternalVideo,
        ctaLabelAr: d.ctaLabelAr,
        ctaTargetType: d.ctaTargetType,
        ctaTargetId: d.ctaTargetId ?? null,
        ctaExternalUrl: safeCtaExternal,
        targetScope: d.targetScope,
        targetTrackId: d.targetScope === 'TRACK' ? d.targetTrackId ?? null : null,
        targetGradeId: d.targetScope === 'GRADE' ? d.targetGradeId ?? null : null,
        targetGroupId: d.targetScope === 'GROUP' ? d.targetGroupId ?? null : null,
        priority: d.priority,
        status: d.status,
        startsAt: parseDateOrNull(d.startsAt),
        endsAt: parseDateOrNull(d.endsAt),
        createdById: req.authUser!.id,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ANNOUNCEMENT_CREATED',
      entityType: 'announcement',
      entityId: created.id,
      details: { titleAr: created.titleAr, status: created.status, targetScope: created.targetScope },
    });

    return res.status(201).json({
      announcement: {
        ...created,
        mediaUrl: created.storageKey ? buildSignedAnnouncementMediaUrl(created.storageKey) : null,
      },
      message: 'تم إنشاء الإعلان بنجاح',
    });
  } catch (err) {
    console.error('Admin announcement create error:', err);
    return res.status(500).json({ error: 'تعذر حفظ الإعلان' });
  }
});

adminAnnouncementsRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الإعلان غير صالح' });
    }
    const parsed = announcementPayloadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات التحديث غير صالحة' });
    }
    const d = parsed.data;

    if (d.mediaType === 'EXTERNAL_VIDEO' && d.externalVideoUrl !== undefined) {
      if (!validateSafeHttpsUrl(d.externalVideoUrl)) {
        return res.status(400).json({ error: 'يرجى إدخال رابط فيديو خارجي آمن يبدأ بـ https://' });
      }
    }
    if (d.ctaTargetType === 'EXTERNAL_URL' && d.ctaExternalUrl !== undefined) {
      if (!validateSafeHttpsUrl(d.ctaExternalUrl)) {
        return res.status(400).json({ error: 'رابط الزر الخارجي يجب أن يكون رابط https:// آمنًا' });
      }
    }

    const [updated] = await db
      .update(announcements)
      .set({
        ...(d.titleAr !== undefined ? { titleAr: d.titleAr } : {}),
        ...(d.bodyAr !== undefined ? { bodyAr: d.bodyAr } : {}),
        ...(d.mediaType !== undefined ? { mediaType: d.mediaType } : {}),
        ...(d.storageKey !== undefined ? { storageKey: d.storageKey } : {}),
        ...(d.mediaFileName !== undefined ? { mediaFileName: d.mediaFileName } : {}),
        ...(d.mediaMimeType !== undefined ? { mediaMimeType: d.mediaMimeType } : {}),
        ...(d.externalVideoUrl !== undefined
          ? { externalVideoUrl: validateSafeHttpsUrl(d.externalVideoUrl) }
          : {}),
        ...(d.ctaLabelAr !== undefined ? { ctaLabelAr: d.ctaLabelAr } : {}),
        ...(d.ctaTargetType !== undefined ? { ctaTargetType: d.ctaTargetType } : {}),
        ...(d.ctaTargetId !== undefined ? { ctaTargetId: d.ctaTargetId ?? null } : {}),
        ...(d.ctaExternalUrl !== undefined
          ? { ctaExternalUrl: validateSafeHttpsUrl(d.ctaExternalUrl) }
          : {}),
        ...(d.targetScope !== undefined ? { targetScope: d.targetScope } : {}),
        ...(d.targetTrackId !== undefined ? { targetTrackId: d.targetTrackId ?? null } : {}),
        ...(d.targetGradeId !== undefined ? { targetGradeId: d.targetGradeId ?? null } : {}),
        ...(d.targetGroupId !== undefined ? { targetGroupId: d.targetGroupId ?? null } : {}),
        ...(d.priority !== undefined ? { priority: d.priority } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.startsAt !== undefined ? { startsAt: parseDateOrNull(d.startsAt) } : {}),
        ...(d.endsAt !== undefined ? { endsAt: parseDateOrNull(d.endsAt) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(announcements.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: 'الإعلان غير موجود' });

    return res.json({
      announcement: {
        ...updated,
        mediaUrl: updated.storageKey ? buildSignedAnnouncementMediaUrl(updated.storageKey) : null,
      },
      message: 'تم تحديث الإعلان بنجاح',
    });
  } catch (err) {
    console.error('Admin announcement update error:', err);
    return res.status(500).json({ error: 'تعذر تحديث الإعلان' });
  }
});

adminAnnouncementsRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الإعلان غير صالح' });
    }
    const [existing] = await db
      .select({ storageKey: announcements.storageKey })
      .from(announcements)
      .where(eq(announcements.id, id))
      .limit(1);

    await db.delete(announcements).where(eq(announcements.id, id));

    if (existing?.storageKey) {
      const stillUsed = await db
        .select({ id: announcements.id })
        .from(announcements)
        .where(eq(announcements.storageKey, existing.storageKey))
        .limit(1);
      if (stillUsed.length === 0) {
        await db
          .delete(announcementStoredFiles)
          .where(eq(announcementStoredFiles.storageKey, existing.storageKey));
      }
    }

    return res.json({ message: 'تم حذف الإعلان بنجاح' });
  } catch (err) {
    console.error('Admin announcement delete error:', err);
    return res.status(500).json({ error: 'تعذر حذف الإعلان' });
  }
});
