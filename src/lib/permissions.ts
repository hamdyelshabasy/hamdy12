export const STAFF_ROLES = [
  'SUPER_ADMIN',
  'CONTENT_MANAGER',
  'TEACHING_ASSISTANT',
  'SUPPORT',
] as const;

export type StaffRoleSlug = (typeof STAFF_ROLES)[number];
export type RoleSlug = StaffRoleSlug | 'STUDENT';

export const ACTIVE_ACCOUNT_STATUS = 'ACTIVE';

export const PERMISSIONS = {
  REPORTS_VIEW: 'reports:view',
  STUDENTS_VIEW: 'students:view',
  STUDENTS_APPROVE: 'students:approve',
  STUDENTS_MANAGE: 'students:manage',
  STUDENTS_DELETE: 'students:delete',
  STUDENT_ACCESS_GRANT: 'student_access:grant',
  STUDENT_ACCESS_REVOKE: 'student_access:revoke',
  SESSIONS_MANAGE: 'sessions:manage',
  CONTENT_VIEW: 'content:view',
  CONTENT_MANAGE: 'content:manage',
  COURSES_MANAGE: 'courses:manage',
  EXAMS_VIEW: 'exams:view',
  EXAMS_MANAGE: 'exams:manage',
  EXAMS_GRADE: 'exams:grade',
  HOMEWORK_VIEW: 'homework:view',
  HOMEWORK_MANAGE: 'homework:manage',
  HOMEWORK_GRADE: 'homework:grade',
  QUESTION_BANK_VIEW: 'question_bank:view',
  QUESTION_BANK_CONTRIBUTE: 'question_bank:contribute',
  QUESTION_BANK_REVIEW: 'question_bank:review',
  QUESTION_BANK_MANAGE: 'question_bank:manage',
  COUPONS_MANAGE: 'coupons:manage',
  CODES_VIEW: 'codes:view',
  CODES_MANAGE: 'codes:manage',
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_VERIFY: 'payments:verify',
  GROUPS_MANAGE: 'groups:manage',
  SCHEDULE_MANAGE: 'schedule:manage',
  COMMENTS_MODERATE: 'comments:moderate',
  NOTIFICATIONS_SEND: 'notifications:send',
  STAFF_MANAGE: 'staff:manage',
  SETTINGS_MANAGE: 'settings:manage',
  BACKUPS_MANAGE: 'backups:manage',
  AUDIT_VIEW: 'audit:view',
} as const;

export type AdminPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_ADMIN_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS));

/**
 * High-risk permissions strictly reserved for SUPER_ADMIN (platform owner).
 * Even if a non-SUPER_ADMIN role row is misconfigured in the database, these
 * permissions are unconditionally denied at the authorization layer.
 */
export const OWNER_ONLY_PERMISSIONS = new Set<string>([
  PERMISSIONS.STAFF_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.BACKUPS_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.STUDENTS_DELETE,
]);

/**
 * Conservative default role permission matrix.
 * Non-SUPER_ADMIN roles follow least privilege and never receive owner-only,
 * unrestricted financial approval, or unrestricted activation-code generation rights.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleSlug, string[]> = {
  SUPER_ADMIN: ['*'],
  CONTENT_MANAGER: [
    PERMISSIONS.CONTENT_VIEW,
    PERMISSIONS.CONTENT_MANAGE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.EXAMS_VIEW,
    PERMISSIONS.EXAMS_MANAGE,
    PERMISSIONS.HOMEWORK_VIEW,
    PERMISSIONS.HOMEWORK_MANAGE,
    PERMISSIONS.QUESTION_BANK_VIEW,
    PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
    PERMISSIONS.SCHEDULE_MANAGE,
  ],
  TEACHING_ASSISTANT: [
    PERMISSIONS.CONTENT_VIEW,
    PERMISSIONS.STUDENTS_VIEW,
    PERMISSIONS.STUDENTS_APPROVE,
    PERMISSIONS.EXAMS_VIEW,
    PERMISSIONS.EXAMS_GRADE,
    PERMISSIONS.HOMEWORK_VIEW,
    PERMISSIONS.HOMEWORK_GRADE,
    PERMISSIONS.QUESTION_BANK_VIEW,
    PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
    PERMISSIONS.COMMENTS_MODERATE,
    PERMISSIONS.GROUPS_MANAGE,
  ],
  SUPPORT: [
    PERMISSIONS.CONTENT_VIEW,
    PERMISSIONS.STUDENTS_VIEW,
    PERMISSIONS.SESSIONS_MANAGE,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.CODES_VIEW,
  ],
  STUDENT: ['student:self'],
};

export interface PermissionSubject {
  roleSlug: string;
  status: string;
  permissions: readonly string[];
}

export function isStaffRole(slug: string | null | undefined): slug is StaffRoleSlug {
  return Boolean(slug && (STAFF_ROLES as readonly string[]).includes(slug));
}

export function isAccountActive(status: string | null | undefined): boolean {
  return status === ACTIVE_ACCOUNT_STATUS;
}

export function getInactiveStaffErrorMessage(status: string | null | undefined): string {
  switch (status) {
    case 'SUSPENDED':
      return 'تم إيقاف حساب الموظف ولا يمكنه الوصول إلى لوحة الإدارة. يرجى التواصل مع المدير العام.';
    case 'ARCHIVED':
      return 'تم أرشفة وتعطيل هذا الحساب الإداري. يرجى التواصل مع المدير العام.';
    case 'REJECTED':
      return 'هذا الحساب غير مصرح له بالدخول إلى لوحة الإدارة.';
    case 'PENDING_APPROVAL':
      return 'حساب الموظف غير مفعّل بعد. يرجى انتظار تفعيله من قِبل المدير العام.';
    default:
      return 'حساب الموظف غير نشط حاليًا ولا يملك صلاحية الوصول.';
  }
}

/**
 * Checks if an authenticated user holds a specific recognized admin permission.
 * Deny-by-default:
 *  - Requires active account status ('ACTIVE')
 *  - Requires a recognized staff role
 *  - Rejects unknown/unrecognized permission strings
 *  - Enforces OWNER_ONLY_PERMISSIONS ceiling for non-SUPER_ADMIN roles
 *  - Ignores wildcard '*' for non-SUPER_ADMIN roles
 */
export function hasPermission(
  subject: PermissionSubject | null | undefined,
  permission: string,
): boolean {
  if (!subject) return false;
  if (!isStaffRole(subject.roleSlug)) return false;
  if (!isAccountActive(subject.status)) return false;
  if (!permission || !ALL_ADMIN_PERMISSIONS.has(permission)) return false;

  if (subject.roleSlug === 'SUPER_ADMIN') {
    return true;
  }

  if (OWNER_ONLY_PERMISSIONS.has(permission)) {
    return false;
  }

  const perms = Array.isArray(subject.permissions) ? subject.permissions : [];
  return perms.includes(permission);
}

/**
 * Checks if an authenticated active staff user holds AT LEAST ONE of the given permissions.
 */
export function hasAnyPermission(
  subject: PermissionSubject | null | undefined,
  requiredPermissions: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(requiredPermissions) || !requiredPermissions.length) return false;
  return requiredPermissions.some((perm) => hasPermission(subject, perm));
}

export type StaffAuthDecision =
  | { allowed: true }
  | {
      allowed: false;
      statusCode: 401 | 403;
      reason: 'UNAUTHENTICATED' | 'NOT_STAFF' | 'ACCOUNT_INACTIVE' | 'MISSING_PERMISSION';
      errorAr: string;
      shouldRevokeSession: boolean;
    };

/**
 * Evaluates full server-side authorization for a staff route.
 * When `requiredPermissions` is provided (string or non-empty string[]),
 * at least one listed permission must be held by the caller.
 */
export function evaluateStaffAuthorization(
  subject: PermissionSubject | null | undefined,
  requiredPermissions?: string | readonly string[],
): StaffAuthDecision {
  if (!subject) {
    return {
      allowed: false,
      statusCode: 401,
      reason: 'UNAUTHENTICATED',
      errorAr: 'غير مصرح بالدخول. يرجى تسجيل الدخول للمتابعة.',
      shouldRevokeSession: false,
    };
  }

  if (!isStaffRole(subject.roleSlug)) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'NOT_STAFF',
      errorAr: 'ليس لديك صلاحية للوصول إلى لوحة إدارة المنصة.',
      shouldRevokeSession: false,
    };
  }

  if (!isAccountActive(subject.status)) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'ACCOUNT_INACTIVE',
      errorAr: getInactiveStaffErrorMessage(subject.status),
      shouldRevokeSession: true,
    };
  }

  if (requiredPermissions !== undefined) {
    const permList = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];

    if (permList.length === 0 || !hasAnyPermission(subject, permList)) {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'MISSING_PERMISSION',
        errorAr: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.',
        shouldRevokeSession: false,
      };
    }
  }

  return { allowed: true };
}

export type AdminDashboardTabId =
  | 'overview'
  | 'students'
  | 'tracks'
  | 'groups'
  | 'videos'
  | 'courses'
  | 'codes'
  | 'payments'
  | 'question_bank'
  | 'exams'
  | 'homework'
  | 'curriculum'
  | 'announcements'
  | 'communications'
  | 'staff'
  | 'devices'
  | 'settings'
  | 'audit'
  | 'operations';

export const ADMIN_TAB_REQUIRED_PERMISSIONS: Record<AdminDashboardTabId, readonly AdminPermission[]> = {
  overview: [PERMISSIONS.REPORTS_VIEW],
  students: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_APPROVE, PERMISSIONS.STUDENTS_MANAGE],
  tracks: [PERMISSIONS.CONTENT_MANAGE],
  groups: [PERMISSIONS.GROUPS_MANAGE, PERMISSIONS.SCHEDULE_MANAGE],
  videos: [PERMISSIONS.CONTENT_MANAGE],
  courses: [PERMISSIONS.COURSES_MANAGE, PERMISSIONS.COUPONS_MANAGE],
  codes: [PERMISSIONS.CODES_VIEW, PERMISSIONS.CODES_MANAGE],
  payments: [PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_VERIFY],
  question_bank: [
    PERMISSIONS.QUESTION_BANK_VIEW,
    PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
    PERMISSIONS.QUESTION_BANK_REVIEW,
    PERMISSIONS.QUESTION_BANK_MANAGE,
  ],
  exams: [PERMISSIONS.EXAMS_VIEW, PERMISSIONS.EXAMS_MANAGE, PERMISSIONS.EXAMS_GRADE],
  homework: [PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_MANAGE, PERMISSIONS.HOMEWORK_GRADE],
  curriculum: [
    PERMISSIONS.CONTENT_MANAGE,
    PERMISSIONS.SCHEDULE_MANAGE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.EXAMS_MANAGE,
    PERMISSIONS.HOMEWORK_MANAGE,
  ],
  announcements: [
    PERMISSIONS.NOTIFICATIONS_SEND,
    PERMISSIONS.CONTENT_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
  ],
  communications: [PERMISSIONS.COMMENTS_MODERATE, PERMISSIONS.NOTIFICATIONS_SEND],
  staff: [PERMISSIONS.STAFF_MANAGE],
  devices: [PERMISSIONS.SESSIONS_MANAGE],
  settings: [PERMISSIONS.SETTINGS_MANAGE],
  audit: [PERMISSIONS.BACKUPS_MANAGE, PERMISSIONS.AUDIT_VIEW],
  operations: [
    PERMISSIONS.GROUPS_MANAGE,
    PERMISSIONS.SCHEDULE_MANAGE,
    PERMISSIONS.COMMENTS_MODERATE,
    PERMISSIONS.NOTIFICATIONS_SEND,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.BACKUPS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
  ],
};

export function canAccessAdminTab(
  subject: PermissionSubject | null | undefined,
  tabId: AdminDashboardTabId,
): boolean {
  if (tabId === 'overview' || tabId === 'devices') {
    return Boolean(subject && isStaffRole(subject.roleSlug) && isAccountActive(subject.status));
  }
  if (!Object.prototype.hasOwnProperty.call(ADMIN_TAB_REQUIRED_PERMISSIONS, tabId)) {
    return false;
  }
  return hasAnyPermission(subject, ADMIN_TAB_REQUIRED_PERMISSIONS[tabId]);
}
