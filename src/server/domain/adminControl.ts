export interface VideoOpenLimitInput {
  isStaff: boolean;
  courseDefaultMaxOpens: number | null | undefined;
  videoMaxOpens: number | null | undefined;
  studentMaxOpensOverride: number | null | undefined; // null = inherit, -1 = explicitly unlimited, >0 = custom cap
  bonusOpens: number;
  countedOpens: number;
  currentSessionId: number | null;
  lastSessionId: number | null;
  lastCountedAt: Date | string | null;
  now?: Date;
  idempotencyWindowMs?: number;
}

export interface VideoOpenLimitDecision {
  allowed: boolean;
  shouldIncrement: boolean;
  effectiveMaxOpens: number | null; // null = unlimited
  countedOpensBefore: number;
  countedOpensAfter: number;
  remainingOpens: number | null; // null = unlimited
  reasonCode:
    | 'STAFF_UNLIMITED'
    | 'UNLIMITED'
    | 'WITHIN_IDEMPOTENCY_WINDOW'
    | 'COUNTED_NEW_OPEN'
    | 'OPEN_LIMIT_REACHED';
}

const DEFAULT_IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes per session prevents refresh/seek/re-render double counting

export function resolveEffectiveVideoMaxOpens(params: {
  courseDefaultMaxOpens: number | null | undefined;
  videoMaxOpens: number | null | undefined;
  studentMaxOpensOverride: number | null | undefined;
  bonusOpens: number;
}): number | null {
  const bonus = Math.max(0, Math.floor(params.bonusOpens || 0));

  // Explicit student unlimited override
  if (params.studentMaxOpensOverride === -1) {
    return null;
  }

  let base: number | null = null;
  if (typeof params.studentMaxOpensOverride === 'number' && params.studentMaxOpensOverride > 0) {
    base = Math.floor(params.studentMaxOpensOverride);
  } else if (typeof params.videoMaxOpens === 'number' && params.videoMaxOpens > 0) {
    base = Math.floor(params.videoMaxOpens);
  } else if (typeof params.courseDefaultMaxOpens === 'number' && params.courseDefaultMaxOpens > 0) {
    base = Math.floor(params.courseDefaultMaxOpens);
  }

  if (base === null) return null;
  return base + bonus;
}

export function evaluateVideoOpenLimit(input: VideoOpenLimitInput): VideoOpenLimitDecision {
  const counted = Math.max(0, Math.floor(input.countedOpens || 0));

  if (input.isStaff) {
    return {
      allowed: true,
      shouldIncrement: false,
      effectiveMaxOpens: null,
      countedOpensBefore: counted,
      countedOpensAfter: counted,
      remainingOpens: null,
      reasonCode: 'STAFF_UNLIMITED',
    };
  }

  const effectiveMax = resolveEffectiveVideoMaxOpens({
    courseDefaultMaxOpens: input.courseDefaultMaxOpens,
    videoMaxOpens: input.videoMaxOpens,
    studentMaxOpensOverride: input.studentMaxOpensOverride,
    bonusOpens: input.bonusOpens,
  });

  const now = input.now || new Date();
  const windowMs = input.idempotencyWindowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS;
  const lastAt = input.lastCountedAt ? new Date(input.lastCountedAt) : null;
  const sameSessionWithinWindow =
    lastAt !== null &&
    !Number.isNaN(lastAt.getTime()) &&
    now.getTime() - lastAt.getTime() < windowMs &&
    (input.currentSessionId === null ||
      input.lastSessionId === null ||
      input.currentSessionId === input.lastSessionId);

  if (effectiveMax === null) {
    return {
      allowed: true,
      shouldIncrement: !sameSessionWithinWindow,
      effectiveMaxOpens: null,
      countedOpensBefore: counted,
      countedOpensAfter: sameSessionWithinWindow ? counted : counted + 1,
      remainingOpens: null,
      reasonCode: sameSessionWithinWindow ? 'WITHIN_IDEMPOTENCY_WINDOW' : 'UNLIMITED',
    };
  }

  // If the student already opened this video in the same session recently (e.g., refresh or re-render),
  // allow continuing without charging another open, provided at least 1 open was already counted.
  if (sameSessionWithinWindow && counted > 0 && counted <= effectiveMax) {
    return {
      allowed: true,
      shouldIncrement: false,
      effectiveMaxOpens: effectiveMax,
      countedOpensBefore: counted,
      countedOpensAfter: counted,
      remainingOpens: Math.max(0, effectiveMax - counted),
      reasonCode: 'WITHIN_IDEMPOTENCY_WINDOW',
    };
  }

  if (counted >= effectiveMax) {
    return {
      allowed: false,
      shouldIncrement: false,
      effectiveMaxOpens: effectiveMax,
      countedOpensBefore: counted,
      countedOpensAfter: counted,
      remainingOpens: 0,
      reasonCode: 'OPEN_LIMIT_REACHED',
    };
  }

  const nextCount = counted + 1;
  return {
    allowed: true,
    shouldIncrement: true,
    effectiveMaxOpens: effectiveMax,
    countedOpensBefore: counted,
    countedOpensAfter: nextCount,
    remainingOpens: Math.max(0, effectiveMax - nextCount),
    reasonCode: 'COUNTED_NEW_OPEN',
  };
}

export type CouponDerivedStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'LIMIT_REACHED' | 'ARCHIVED';

export interface CouponLike {
  code: string;
  discountType?: string | null;
  discountPercent: number;
  discountAmountEgp?: number | null;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | string | null;
  eligibleCourseIdsJson?: number[] | null;
  isActive: boolean;
  isArchived?: boolean | null;
}

export function resolveCouponStatus(coupon: CouponLike, now = new Date()): CouponDerivedStatus {
  if (coupon.isArchived) return 'ARCHIVED';
  if (!coupon.isActive) return 'INACTIVE';
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return 'LIMIT_REACHED';
  }
  return 'ACTIVE';
}

export interface CouponDiscountResult {
  valid: boolean;
  discountEgp: number;
  finalAmountEgp: number;
  errorMessageAr?: string;
}

export function computeCouponDiscount(params: {
  coupon: CouponLike;
  amountEgp: number;
  targetType: 'VIDEO' | 'COURSE' | 'PLAN';
  targetId: number;
  now?: Date;
}): CouponDiscountResult {
  const status = resolveCouponStatus(params.coupon, params.now || new Date());
  if (status === 'ARCHIVED' || status === 'INACTIVE') {
    return {
      valid: false,
      discountEgp: 0,
      finalAmountEgp: params.amountEgp,
      errorMessageAr: 'كود الخصم غير مفعّل حاليًا.',
    };
  }
  if (status === 'EXPIRED') {
    return {
      valid: false,
      discountEgp: 0,
      finalAmountEgp: params.amountEgp,
      errorMessageAr: 'انتهت صلاحية كود الخصم.',
    };
  }
  if (status === 'LIMIT_REACHED') {
    return {
      valid: false,
      discountEgp: 0,
      finalAmountEgp: params.amountEgp,
      errorMessageAr: 'وصل كود الخصم للحد الأقصى من الاستخدامات.',
    };
  }

  const eligible = Array.isArray(params.coupon.eligibleCourseIdsJson)
    ? params.coupon.eligibleCourseIdsJson.filter((n) => Number.isFinite(n) && n > 0)
    : [];

  if (eligible.length > 0) {
    if (params.targetType !== 'COURSE' || !eligible.includes(params.targetId)) {
      return {
        valid: false,
        discountEgp: 0,
        finalAmountEgp: params.amountEgp,
        errorMessageAr: 'هذا الكوبون مخصص لكورسات محددة فقط ولا ينطبق على هذا الاختيار.',
      };
    }
  }

  const type = (params.coupon.discountType || 'PERCENT').toUpperCase();
  let rawDiscount = 0;
  if (type === 'FIXED') {
    rawDiscount = Math.max(0, Math.round(params.coupon.discountAmountEgp || 0));
  } else {
    const pct = Math.max(0, Math.min(100, params.coupon.discountPercent || 0));
    rawDiscount = Math.round((params.amountEgp * pct) / 100);
  }

  const discountEgp = Math.min(params.amountEgp, rawDiscount);
  return {
    valid: true,
    discountEgp,
    finalAmountEgp: Math.max(0, params.amountEgp - discountEgp),
  };
}

export interface StudentDeletionImpact {
  roleSlug: string;
  paidOrdersCount: number;
  examAttemptsCount: number;
  activeSubscriptionsCount: number;
  manualEntitlementsCount: number;
  redemptionsCount: number;
}

export interface DeletionSafetyResult {
  canArchive: boolean;
  canPermanentlyDelete: boolean;
  blockReasonAr: string | null;
  warningsAr: string[];
}

export function evaluateStudentDeletionSafety(impact: StudentDeletionImpact): DeletionSafetyResult {
  if (impact.roleSlug !== 'STUDENT') {
    return {
      canArchive: false,
      canPermanentlyDelete: false,
      blockReasonAr: 'لا يمكن أرشفة أو حذف حسابات الإدارة أو المشرف العام حمايةً للنظام.',
      warningsAr: [],
    };
  }

  const warnings: string[] = [];
  if (impact.paidOrdersCount > 0) {
    warnings.push(`يوجد ${impact.paidOrdersCount} طلب/عملية دفع مسجلة لهذا الطالب.`);
  }
  if (impact.examAttemptsCount > 0) {
    warnings.push(`يوجد ${impact.examAttemptsCount} محاولة امتحان ودرجات محفوظة لهذا الطالب.`);
  }
  if (impact.activeSubscriptionsCount > 0) {
    warnings.push(`يوجد ${impact.activeSubscriptionsCount} اشتراك مسجل للطالب.`);
  }
  if (impact.redemptionsCount > 0) {
    warnings.push(`استخدم الطالب ${impact.redemptionsCount} كود تفعيل.`);
  }

  const hasHistoricalRecords =
    impact.paidOrdersCount > 0 || impact.examAttemptsCount > 0 || impact.activeSubscriptionsCount > 0;

  return {
    canArchive: true,
    canPermanentlyDelete: !hasHistoricalRecords,
    blockReasonAr: hasHistoricalRecords
      ? 'لا يمكن الحذف النهائي لوجود سجلات امتحانات أو مدفوعات أو اشتراكات تاريخية. استخدم "أرشفة وتعطيل الحساب" للحفاظ على البيانات التاريخية وإيقاف الدخول فورًا.'
      : null,
    warningsAr: warnings,
  };
}

export interface CourseDeletionImpact {
  subscribersCount: number;
  ordersCount: number;
  linkedExamsCount: number;
  linkedVideosCount: number;
}

export function evaluateCourseDeletionSafety(impact: CourseDeletionImpact): DeletionSafetyResult {
  const warnings: string[] = [];
  if (impact.subscribersCount > 0) {
    warnings.push(`يوجد ${impact.subscribersCount} طالب مشترك أو يملك صلاحية لهذا الكورس.`);
  }
  if (impact.ordersCount > 0) {
    warnings.push(`يوجد ${impact.ordersCount} طلب مالي مرتبط بهذا الكورس.`);
  }
  if (impact.linkedExamsCount > 0) {
    warnings.push(`يوجد ${impact.linkedExamsCount} امتحان مرتبط بهذا الكورس.`);
  }
  if (impact.linkedVideosCount > 0) {
    warnings.push(
      `يرتبط بالكورس ${impact.linkedVideosCount} فيديو (ملاحظة: الفيديوهات في المكتبة الرئيسية لن تُحذف أبدًا عند حذف أو أرشفة الكورس).`,
    );
  }

  const blocked = impact.subscribersCount > 0 || impact.ordersCount > 0 || impact.linkedExamsCount > 0;

  return {
    canArchive: true,
    canPermanentlyDelete: !blocked,
    blockReasonAr: blocked
      ? 'لا يمكن الحذف النهائي لهذا الكورس لوجود مشتركين أو طلبات دفع أو امتحانات مرتبطة به. يمكنك أرشفة الكورس بأمان لإخفائه من المبيعات الجديدة مع الحفاظ على جميع السجلات.'
      : null,
    warningsAr: warnings,
  };
}

export interface CourseGrantCandidate {
  id: number;
  titleAr: string;
  gradeId: number;
  publicationStatus?: string | null;
  isPublished?: boolean;
}

export interface ExistingEntitlementSummary {
  targetType: string;
  targetId: number;
  source: string;
  isRevoked: boolean;
  expiresAt: Date | string | null;
}

export function planManualCourseGrants(params: {
  requestedCourseIds: number[];
  availableCourses: CourseGrantCandidate[];
  existingEntitlements: ExistingEntitlementSummary[];
  now?: Date;
}): {
  toGrant: CourseGrantCandidate[];
  skippedAlreadyActive: CourseGrantCandidate[];
} {
  const now = params.now || new Date();
  const uniqueIds = Array.from(new Set(params.requestedCourseIds.filter((id) => id > 0)));
  const courseMap = new Map(params.availableCourses.map((c) => [c.id, c]));

  const activeCourseIds = new Set(
    params.existingEntitlements
      .filter((e) => {
        if (e.targetType !== 'COURSE' || e.isRevoked) return false;
        if (e.expiresAt && new Date(e.expiresAt).getTime() <= now.getTime()) return false;
        return true;
      })
      .map((e) => e.targetId),
  );

  const toGrant: CourseGrantCandidate[] = [];
  const skippedAlreadyActive: CourseGrantCandidate[] = [];

  for (const id of uniqueIds) {
    const course = courseMap.get(id);
    if (!course) continue;
    if (activeCourseIds.has(id)) {
      skippedAlreadyActive.push(course);
    } else {
      toGrant.push(course);
    }
  }

  return { toGrant, skippedAlreadyActive };
}

export function computeRemainingDays(expiresAt: Date | string | null, now = new Date()): number | null {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - now.getTime();
  return Math.ceil(diffMs / 86400_000);
}

export const STUDENT_ROLE_SLUG = 'STUDENT';

export function isStudentRoleSlug(roleSlug: string | null | undefined): boolean {
  return roleSlug === STUDENT_ROLE_SLUG;
}

export type StudentTargetAccessResult =
  | { allowed: true }
  | { allowed: false; statusCode: 403 | 404; errorAr: string };

/**
 * Strictly ensures student-management routes operate ONLY on accounts
 * whose actual database role is STUDENT. All privileged or unknown roles
 * (SUPER_ADMIN, CONTENT_MANAGER, TEACHING_ASSISTANT, SUPPORT, etc.) are rejected.
 */
export function evaluateStudentTargetAccess(
  target: { id: number; roleSlug: string | null | undefined } | null | undefined,
): StudentTargetAccessResult {
  if (!target) {
    return {
      allowed: false,
      statusCode: 404,
      errorAr: 'الطالب غير موجود',
    };
  }

  if (!isStudentRoleSlug(target.roleSlug)) {
    return {
      allowed: false,
      statusCode: 403,
      errorAr: 'هذا الإجراء مخصص لحسابات الطلاب فقط ولا يمكن تنفيذه على حسابات الإدارة أو المساعدين.',
    };
  }

  return { allowed: true };
}

export type BulkStudentTargetAccessResult =
  | { allowed: true; studentIds: number[] }
  | {
      allowed: false;
      statusCode: 400 | 403 | 404;
      errorAr: string;
      blockedIds: number[];
      blockedRoles: string[];
    };

/**
 * Strictly validates every target in a bulk student operation.
 * If ANY requested user ID belongs to a non-STUDENT role, the ENTIRE batch is rejected
 * with 403 so crafted mixed payloads can never touch privileged accounts.
 */
export function evaluateBulkStudentTargetAccess(params: {
  requestedIds: number[];
  resolvedUsers: Array<{ id: number; roleSlug: string | null | undefined }>;
}): BulkStudentTargetAccessResult {
  const uniqueRequested = Array.from(
    new Set(params.requestedIds.filter((id) => Number.isInteger(id) && id > 0)),
  );

  if (uniqueRequested.length === 0) {
    return {
      allowed: false,
      statusCode: 400,
      errorAr: 'يرجى تحديد طالب واحد على الأقل',
      blockedIds: [],
      blockedRoles: [],
    };
  }

  const nonStudentTargets = params.resolvedUsers.filter((u) => !isStudentRoleSlug(u.roleSlug));
  if (nonStudentTargets.length > 0) {
    return {
      allowed: false,
      statusCode: 403,
      errorAr:
        'تم رفض العملية بالكامل: لا يمكن تطبيق إجراءات إدارة الطلاب الجماعية على حسابات الإدارة أو المساعدين.',
      blockedIds: nonStudentTargets.map((u) => u.id),
      blockedRoles: Array.from(new Set(nonStudentTargets.map((u) => String(u.roleSlug || 'UNKNOWN')))),
    };
  }

  const resolvedIdSet = new Set(params.resolvedUsers.map((u) => u.id));
  const studentIds = uniqueRequested.filter((id) => resolvedIdSet.has(id));

  if (studentIds.length === 0) {
    return {
      allowed: false,
      statusCode: 404,
      errorAr: 'لم يتم العثور على حسابات طلاب مطابقة للمعرّفات المحددة.',
      blockedIds: [],
      blockedRoles: [],
    };
  }

  return {
    allowed: true,
    studentIds,
  };
}

