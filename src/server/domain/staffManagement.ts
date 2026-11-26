export const MANAGED_STAFF_ROLES = [
  'TEACHING_ASSISTANT',
  'CONTENT_MANAGER',
  'SUPPORT',
] as const;

export type ManagedStaffRoleSlug = (typeof MANAGED_STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS_AR: Record<ManagedStaffRoleSlug, string> = {
  TEACHING_ASSISTANT: 'مساعد مدرس',
  CONTENT_MANAGER: 'مدير محتوى',
  SUPPORT: 'دعم فني',
};

export const STAFF_ROLE_SUMMARY_AR: Record<ManagedStaffRoleSlug, string> = {
  TEACHING_ASSISTANT:
    'عرض الطلاب والموافقة على طلبات التسجيل، تصحيح الامتحانات والواجبات، الرد على تعليقات الطلاب، وإدارة المجموعات.',
  CONTENT_MANAGER:
    'إدارة المسارات والصفوف والدروس والفيديوهات، الكورسات، إنشاء الامتحانات وبنك الأسئلة، الواجبات، وجدولة الحصص المباشرة.',
  SUPPORT:
    'عرض ملفات الطلاب للقراءة، إدارة أجهزة وجلسات الطلاب (إنهاء/حظر/إلغاء حظر)، وعرض الطلبات والأكواد للقراءة فقط.',
};

const EGYPTIAN_PHONE_REGEX = /^01[0125][0-9]{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isAssignableStaffRole(slug: unknown): slug is ManagedStaffRoleSlug {
  return (
    typeof slug === 'string' &&
    (MANAGED_STAFF_ROLES as readonly string[]).includes(slug)
  );
}

export function normalizeEgyptianPhone(raw: string): string {
  return String(raw || '').trim().replace(/[\s-]+/g, '');
}

export function validateEgyptianPhone(raw: string): { ok: true; phone: string } | { ok: false; errorAr: string } {
  const phone = normalizeEgyptianPhone(raw);
  if (!EGYPTIAN_PHONE_REGEX.test(phone)) {
    return {
      ok: false,
      errorAr: 'يرجى إدخال رقم هاتف مصري صحيح مكون من 11 رقمًا ويبدأ بـ 010 أو 011 أو 012 أو 015.',
    };
  }
  return { ok: true, phone };
}

export function normalizeOptionalEmail(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateOptionalEmail(
  raw: string | null | undefined,
): { ok: true; email: string | null } | { ok: false; errorAr: string } {
  const email = normalizeOptionalEmail(raw);
  if (email === null) {
    return { ok: true, email: null };
  }
  if (email.length > 254 || !EMAIL_REGEX.test(email)) {
    return { ok: false, errorAr: 'صيغة البريد الإلكتروني غير صحيحة.' };
  }
  return { ok: true, email };
}

export function validateStaffFullName(raw: string): { ok: true; fullName: string } | { ok: false; errorAr: string } {
  const fullName = String(raw || '').trim().replace(/\s+/g, ' ');
  if (fullName.length < 3) {
    return { ok: false, errorAr: 'يرجى إدخال الاسم الكامل للموظف (3 أحرف على الأقل).' };
  }
  if (fullName.length > 120) {
    return { ok: false, errorAr: 'الاسم الكامل طويل جدًا (الحد الأقصى 120 حرفًا).' };
  }
  return { ok: true, fullName };
}

/**
 * Enforces a strong password policy for staff accounts:
 * - Between 8 and 128 characters
 * - At least one uppercase Latin letter (A-Z)
 * - At least one lowercase Latin letter (a-z)
 * - At least one digit (0-9)
 * - Confirmation must match exactly when provided
 */
export function validateStrongStaffPassword(
  password: string,
  confirmPassword?: string,
): { ok: true } | { ok: false; errorAr: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, errorAr: 'كلمة المرور يجب أن لا تقل عن 8 أحرف.' };
  }
  if (password.length > 128) {
    return { ok: false, errorAr: 'كلمة المرور طويلة جدًا (الحد الأقصى 128 حرفًا).' };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      ok: false,
      errorAr: 'يجب أن تحتوي كلمة المرور على حرف إنجليزي كبير (A-Z) وحرف صغير (a-z) ورقم واحد على الأقل.',
    };
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return { ok: false, errorAr: 'تأكيد كلمة المرور غير متطابق.' };
  }
  return { ok: true };
}

export type StaffMutationDecision =
  | { allowed: true }
  | { allowed: false; statusCode: 400 | 403; errorAr: string };

/**
 * Pure domain guard for mutations targeting an existing staff account
 * (editing profile, changing role, suspending/reactivating, or resetting password).
 */
export function evaluateStaffTargetMutation(params: {
  actorId: number;
  actorRoleSlug: string;
  targetId: number;
  targetRoleSlug: string;
}): StaffMutationDecision {
  if (params.actorRoleSlug !== 'SUPER_ADMIN') {
    return {
      allowed: false,
      statusCode: 403,
      errorAr: 'هذه العملية متاحة للمدير العام الرئيسي (SUPER_ADMIN) فقط.',
    };
  }
  if (params.targetId === params.actorId) {
    return {
      allowed: false,
      statusCode: 403,
      errorAr: 'لا يمكن تعديل أو تعطيل حساب المدير العام الخاص بك من إدارة الموظفين.',
    };
  }
  if (params.targetRoleSlug === 'SUPER_ADMIN') {
    return {
      allowed: false,
      statusCode: 403,
      errorAr: 'لا يمكن تعديل أو إيقاف أو تغيير كلمة مرور حساب المدير العام الرئيسي.',
    };
  }
  if (!isAssignableStaffRole(params.targetRoleSlug)) {
    return {
      allowed: false,
      statusCode: 400,
      errorAr: 'هذا الإجراء مخصص لحسابات فريق العمل فقط ولا ينطبق على حسابات الطلاب.',
    };
  }
  return { allowed: true };
}

export type StaffRoleChangeDecision =
  | { allowed: true; changed: boolean }
  | { allowed: false; statusCode: 400 | 403; errorAr: string };

export function evaluateStaffRoleChange(params: {
  currentRoleSlug: string;
  nextRoleSlug: unknown;
}): StaffRoleChangeDecision {
  if (params.nextRoleSlug === 'SUPER_ADMIN') {
    return {
      allowed: false,
      statusCode: 403,
      errorAr: 'لا يمكن ترقية أي حساب إلى المدير العام الرئيسي (SUPER_ADMIN) من هذه الواجهة.',
    };
  }
  if (!isAssignableStaffRole(params.nextRoleSlug)) {
    return {
      allowed: false,
      statusCode: 400,
      errorAr: 'الدور الوظيفي المختار غير صالح. الأدوار المتاحة هي: مساعد مدرس، مدير محتوى، دعم فني.',
    };
  }
  return {
    allowed: true,
    changed: params.currentRoleSlug !== params.nextRoleSlug,
  };
}

export interface SafeStaffRecord {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  roleSlug: string;
  roleNameAr: string;
  lastLoginAt: string | Date | null;
  createdAt: string | Date | null;
}

export function sanitizeStaffPublicRecord(input: {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  roleSlug: string;
  roleNameAr: string;
  lastLoginAt?: string | Date | null;
  createdAt?: string | Date | null;
}): SafeStaffRecord {
  return {
    id: input.id,
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
    status: input.status,
    roleSlug: input.roleSlug,
    roleNameAr: input.roleNameAr,
    lastLoginAt: input.lastLoginAt ?? null,
    createdAt: input.createdAt ?? null,
  };
}
