import { isDeviceBlockedForUser } from './deviceAccess.ts';

export type EntitlementSource = 'MANUAL_GRANT' | 'SUBSCRIPTION' | 'PURCHASE' | 'ACTIVATION_CODE';
export type EntitlementTargetType = 'VIDEO' | 'COURSE' | 'GRADE_ALL';

export interface EntitlementRecord {
  id: number;
  userId: number;
  targetType: string;
  targetId: number;
  source: string;
  priority: number;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  isRevoked: boolean;
}

export interface VideoAccessContext {
  userRoleSlug: string;
  userStatus: string;
  approvedGradeIds: number[];
  videoId: number;
  videoGradeId: number;
  videoType: string; // FREE | PAID | COURSE
  videoPublished: boolean;
  publicationStatus?: string; // PUBLISHED | DRAFT | HIDDEN
  videoCourseId?: number | null;
  courseIdsContainingVideo: number[];
  isFreePreviewInCourse?: boolean;
  entitlements: EntitlementRecord[];
  now?: Date;
}

export interface AccessDecision {
  allowed: boolean;
  reasonCode:
    | 'STAFF_ACCESS'
    | 'FREE_VIDEO'
    | 'FREE_COURSE_PREVIEW'
    | 'ENTITLEMENT_GRANTED'
    | 'ACCOUNT_NOT_ACTIVE'
    | 'GRADE_NOT_APPROVED'
    | 'VIDEO_UNPUBLISHED'
    | 'COURSE_ENROLLMENT_REQUIRED'
    | 'PAYMENT_OR_CODE_REQUIRED';
  matchedSource?: string;
  matchedEntitlementId?: number;
  expiresAt?: Date | null;
}

export function getAccessDeniedMessageAr(reasonCode: AccessDecision['reasonCode'], videoType?: string): string {
  switch (reasonCode) {
    case 'ACCOUNT_NOT_ACTIVE':
      return 'حسابك قيد المراجعة أو غير مفعّل حاليًا. يرجى انتظار موافقة المدرس لتتمكن من مشاهدة الفيديوهات.';
    case 'GRADE_NOT_APPROVED':
      return 'هذا الفيديو يتبع صفًا دراسيًا غير معتمد في حسابك. يمكنك تقديم طلب الانضمام للصف من لوحة الطالب.';
    case 'VIDEO_UNPUBLISHED':
      return 'هذا الفيديو غير متاح للنشر حاليًا (مسودة أو مخفي من قِبل المدرس).';
    case 'COURSE_ENROLLMENT_REQUIRED':
      return 'هذا الفيديو جزء من كورس كامل. اشترك في الكورس أو أدخل كود تفعيل الكورس لفتحه فورًا.';
    case 'PAYMENT_OR_CODE_REQUIRED':
    default:
      if (videoType === 'COURSE') {
        return 'هذا الفيديو مخصص للمشتركين في الكورس الكامل. اشترك في الكورس أو استخدم كود تفعيل لفتح المشاهدة.';
      }
      return 'هذا الفيديو مدفوع. يمكنك فتحه بشراء الفيديو منفردًا، أو بالاشتراك في باقة الصف، أو عبر إدخال كود تفعيل.';
  }
}

export function getSourcePriority(source: EntitlementSource): number {
  switch (source) {
    case 'MANUAL_GRANT':
      return 100;
    case 'SUBSCRIPTION':
      return 80;
    case 'PURCHASE':
      return 60;
    case 'ACTIVATION_CODE':
      return 40;
    default:
      return 10;
  }
}

export function isEntitlementActive(ent: EntitlementRecord, now = new Date()): boolean {
  if (ent.isRevoked) return false;
  const starts = new Date(ent.startsAt);
  if (starts.getTime() > now.getTime()) return false;
  if (ent.expiresAt) {
    const expires = new Date(ent.expiresAt);
    if (expires.getTime() <= now.getTime()) return false;
  }
  return true;
}

export function resolveVideoAccess(ctx: VideoAccessContext): AccessDecision {
  const now = ctx.now ?? new Date();
  const isStaff = ['SUPER_ADMIN', 'CONTENT_MANAGER', 'TEACHING_ASSISTANT'].includes(ctx.userRoleSlug);

  if (isStaff) {
    return { allowed: true, reasonCode: 'STAFF_ACCESS' };
  }

  if (ctx.userStatus !== 'ACTIVE') {
    return { allowed: false, reasonCode: 'ACCOUNT_NOT_ACTIVE' };
  }

  const effectivePublished =
    ctx.publicationStatus !== undefined
      ? ctx.publicationStatus === 'PUBLISHED' && ctx.videoPublished
      : ctx.videoPublished;

  if (!effectivePublished) {
    return { allowed: false, reasonCode: 'VIDEO_UNPUBLISHED' };
  }

  if (!ctx.approvedGradeIds.includes(ctx.videoGradeId)) {
    return { allowed: false, reasonCode: 'GRADE_NOT_APPROVED' };
  }

  if (ctx.videoType === 'FREE') {
    return { allowed: true, reasonCode: 'FREE_VIDEO' };
  }

  if (ctx.isFreePreviewInCourse) {
    return { allowed: true, reasonCode: 'FREE_COURSE_PREVIEW' };
  }

  const allCourseIds = new Set<number>(ctx.courseIdsContainingVideo);
  if (ctx.videoCourseId && ctx.videoCourseId > 0) {
    allCourseIds.add(ctx.videoCourseId);
  }

  const matching = ctx.entitlements
    .filter((ent) => isEntitlementActive(ent, now))
    .filter((ent) => {
      if (ent.targetType === 'VIDEO' && ent.targetId === ctx.videoId) return true;
      if (ent.targetType === 'COURSE' && allCourseIds.has(ent.targetId)) return true;
      if (ent.targetType === 'GRADE_ALL' && ent.targetId === ctx.videoGradeId) return true;
      return false;
    })
    .sort((a, b) => b.priority - a.priority);

  if (matching.length > 0) {
    const best = matching[0];
    return {
      allowed: true,
      reasonCode: 'ENTITLEMENT_GRANTED',
      matchedSource: best.source,
      matchedEntitlementId: best.id,
      expiresAt: best.expiresAt ? new Date(best.expiresAt) : null,
    };
  }

  return {
    allowed: false,
    reasonCode: ctx.videoType === 'COURSE' ? 'COURSE_ENROLLMENT_REQUIRED' : 'PAYMENT_OR_CODE_REQUIRED',
  };
}

export interface SessionPolicyInput {
  maxDevices: number;
  allowConcurrent: boolean;
  currentSessionId: number;
  currentDeviceFingerprint: string;
  activeSessions: Array<{
    id: number;
    deviceFingerprint: string;
    isRevoked: boolean;
    isBlocked: boolean;
    activeVideoId: number | null;
    lastHeartbeatAt: Date | string;
  }>;
  now?: Date;
}

export interface SessionPolicyDecision {
  allowed: boolean;
  reason?: 'DEVICE_BLOCKED' | 'DEVICE_LIMIT_EXCEEDED' | 'CONCURRENT_PLAYBACK_DETECTED';
}

export function evaluatePlaybackSessionPolicy(input: SessionPolicyInput): SessionPolicyDecision {
  const now = input.now ?? new Date();
  const validSessions = input.activeSessions.filter((s) => !s.isRevoked);
  const current = validSessions.find((s) => s.id === input.currentSessionId);

  if (
    current?.isBlocked ||
    isDeviceBlockedForUser(input.activeSessions, input.currentDeviceFingerprint)
  ) {
    return { allowed: false, reason: 'DEVICE_BLOCKED' };
  }

  const uniqueFingerprints = new Set(validSessions.filter((s) => !s.isBlocked).map((s) => s.deviceFingerprint));
  if (uniqueFingerprints.size > input.maxDevices && !uniqueFingerprints.has(input.currentDeviceFingerprint)) {
    return { allowed: false, reason: 'DEVICE_LIMIT_EXCEEDED' };
  }

  if (!input.allowConcurrent) {
    const activeWindowMs = 45 * 1000;
    const otherPlaying = validSessions.find(
      (s) =>
        s.id !== input.currentSessionId &&
        s.activeVideoId !== null &&
        now.getTime() - new Date(s.lastHeartbeatAt).getTime() <= activeWindowMs,
    );
    if (otherPlaying) {
      return { allowed: false, reason: 'CONCURRENT_PLAYBACK_DETECTED' };
    }
  }

  return { allowed: true };
}
