export const VALID_SESSION_TYPES = ['LIVE', 'REVISION', 'RECORDED'] as const;
export type ScheduleSessionType = (typeof VALID_SESSION_TYPES)[number];

export const VALID_LIVE_PROVIDERS = [
  'ZOOM',
  'GOOGLE_MEET',
  'MEET',
  'YOUTUBE_UNLISTED',
  'YOUTUBE_LIVE',
  'CUSTOM',
] as const;
export type ScheduleLiveProvider = (typeof VALID_LIVE_PROVIDERS)[number];

export interface ValidatedSchedulePayload {
  gradeId: number;
  groupId: number | null;
  titleAr: string;
  descriptionAr: string;
  scheduledAt: Date;
  durationMin: number;
  sessionType: ScheduleSessionType;
  liveProvider: ScheduleLiveProvider;
  joinUrl: string;
  isPublished: boolean;
}

export interface ValidatedGroupPayload {
  gradeId: number;
  nameAr: string;
  scheduleTextAr: string;
  descriptionAr: string;
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errorAr: string };

export function sanitizeScheduleJoinUrl(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: true, data: '' };
  }
  const str = String(raw).trim();
  if (!str) {
    return { ok: true, data: '' };
  }
  if (str.length > 1000) {
    return { ok: false, errorAr: 'رابط الانضمام طويل جدًا (الحد الأقصى 1000 حرف)' };
  }
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, errorAr: 'يجب أن يبدأ رابط الحصة المباشرة بـ https:// أو http://' };
    }
    return { ok: true, data: parsed.toString() };
  } catch {
    return { ok: false, errorAr: 'رابط الانضمام المباشر غير صالح، يرجى إدخال رابط صحيح' };
  }
}

export function validateSchedulePayload(raw: unknown): ValidationResult<ValidatedSchedulePayload> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errorAr: 'بيانات الموعد غير صالحة' };
  }
  const body = raw as Record<string, unknown>;

  const gradeId = Number(body.gradeId);
  if (!Number.isInteger(gradeId) || gradeId <= 0) {
    return { ok: false, errorAr: 'يرجى اختيار الصف الدراسي' };
  }

  let groupId: number | null = null;
  if (body.groupId !== undefined && body.groupId !== null && body.groupId !== '' && Number(body.groupId) !== 0) {
    const parsedGroupId = Number(body.groupId);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId <= 0) {
      return { ok: false, errorAr: 'المجموعة الدراسية المحددة غير صالحة' };
    }
    groupId = parsedGroupId;
  }

  const titleAr = String(body.titleAr ?? '').trim();
  if (titleAr.length < 2 || titleAr.length > 200) {
    return { ok: false, errorAr: 'يرجى إدخال عنوان واضح للموعد (من حرفين إلى 200 حرف)' };
  }

  const descriptionAr = String(body.descriptionAr ?? '').trim();
  if (descriptionAr.length > 1000) {
    return { ok: false, errorAr: 'وصف الموعد يجب ألا يتجاوز 1000 حرف' };
  }

  const scheduledAtRaw = body.scheduledAt;
  if (!scheduledAtRaw || (typeof scheduledAtRaw !== 'string' && !(scheduledAtRaw instanceof Date))) {
    return { ok: false, errorAr: 'يرجى تحديد تاريخ ووقت الموعد' };
  }
  const scheduledAt = scheduledAtRaw instanceof Date ? scheduledAtRaw : new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, errorAr: 'تاريخ أو وقت الموعد غير صالح' };
  }

  const durationRaw = body.durationMin === undefined || body.durationMin === '' ? 90 : Number(body.durationMin);
  if (!Number.isFinite(durationRaw) || durationRaw < 10 || durationRaw > 480) {
    return { ok: false, errorAr: 'مدة الحصة يجب أن تكون بين 10 و 480 دقيقة' };
  }
  const durationMin = Math.round(durationRaw);

  const sessionTypeRaw = String(body.sessionType ?? 'LIVE').trim().toUpperCase();
  if (!(VALID_SESSION_TYPES as readonly string[]).includes(sessionTypeRaw)) {
    return { ok: false, errorAr: 'نوع الجلسة غير مدعوم' };
  }
  const sessionType = sessionTypeRaw as ScheduleSessionType;

  const providerRaw = String(body.liveProvider ?? 'ZOOM').trim().toUpperCase();
  if (!(VALID_LIVE_PROVIDERS as readonly string[]).includes(providerRaw)) {
    return { ok: false, errorAr: 'منصة البث المحددة غير مدعومة' };
  }
  const liveProvider = providerRaw as ScheduleLiveProvider;

  const urlCheck = sanitizeScheduleJoinUrl(body.joinUrl);
  if (!urlCheck.ok) {
    return urlCheck;
  }

  const isPublished = body.isPublished === undefined ? true : Boolean(body.isPublished);

  return {
    ok: true,
    data: {
      gradeId,
      groupId,
      titleAr,
      descriptionAr,
      scheduledAt,
      durationMin,
      sessionType,
      liveProvider,
      joinUrl: urlCheck.data,
      isPublished,
    },
  };
}

export function validateGroupPayload(raw: unknown): ValidationResult<ValidatedGroupPayload> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errorAr: 'بيانات المجموعة غير صالحة' };
  }
  const body = raw as Record<string, unknown>;

  const gradeId = Number(body.gradeId);
  if (!Number.isInteger(gradeId) || gradeId <= 0) {
    return { ok: false, errorAr: 'يرجى اختيار الصف الدراسي للمجموعة' };
  }

  const nameAr = String(body.nameAr ?? '').trim();
  if (nameAr.length < 2 || nameAr.length > 160) {
    return { ok: false, errorAr: 'يرجى إدخال اسم واضح للمجموعة (من حرفين إلى 160 حرفًا)' };
  }

  const scheduleTextAr = String(body.scheduleTextAr ?? '').trim();
  if (scheduleTextAr.length > 300) {
    return { ok: false, errorAr: 'نص المواعيد الأسبوعية طويل جدًا (الحد الأقصى 300 حرف)' };
  }

  const descriptionAr = String(body.descriptionAr ?? '').trim();
  if (descriptionAr.length > 1000) {
    return { ok: false, errorAr: 'وصف المجموعة يجب ألا يتجاوز 1000 حرف' };
  }

  return {
    ok: true,
    data: {
      gradeId,
      nameAr,
      scheduleTextAr,
      descriptionAr,
    },
  };
}

/**
 * Formats an ISO string or Date into YYYY-MM-DDTHH:mm in the caller's local time
 * (used for HTML <input type="datetime-local">).
 */
export function formatLocalDateTimeInput(isoOrDate: string | Date): string {
  const dt = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
