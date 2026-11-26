import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  BookOpen,
  Calendar,
  Check,
  ClipboardCheck,
  CreditCard,
  Eye,
  KeyRound,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  ShieldBan,
  Unlock,
  User,
  Video,
  X,
} from 'lucide-react';
import { apiRequest, formatDateAr, formatDateTimeAr } from '../../lib/api.ts';
import { PERMISSIONS, hasPermission } from '../../lib/permissions.ts';
import type { AuthUser } from '../../types/lms.ts';
import { StudentHomeworkSummaryBlock } from './StudentHomeworkSummaryBlock.tsx';

export type ProfileTab = 'personal' | 'courses' | 'videos' | 'exams' | 'payments' | 'activity';

interface FullStudentProfileResponse {
  student: {
    id: number;
    fullName: string;
    phone: string | null;
    email: string | null;
    status: string;
    roleSlug: string;
    roleNameAr: string;
    maxDevices: number;
    allowConcurrent: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    parentPhone: string;
    governorate: string;
    parentShareCode: string;
    primaryTrackId: number | null;
    primaryGradeId: number | null;
    trackNameAr: string;
    gradeNameAr: string;
    approvedAt: string | null;
    decisionNote: string;
  };
  groups: Array<{ groupId: number; nameAr: string; scheduleTextAr: string; joinedAt: string }>;
  courseEntitlements: Array<{
    id: number;
    targetType: string;
    targetId: number;
    targetTitleAr: string;
    gradeNameAr: string;
    source: string;
    startsAt: string;
    expiresAt: string | null;
    isRevoked: boolean;
    revokedAt: string | null;
    grantedByName: string | null;
    note: string;
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    remainingDays: number | null;
  }>;
  subscriptions: Array<{
    id: number;
    courseTitleAr: string | null;
    planNameAr: string | null;
    status: string;
    startsAt: string;
    expiresAt: string;
    remainingDays: number | null;
  }>;
  availableCourses: Array<{
    id: number;
    titleAr: string;
    gradeId: number;
    gradeNameAr: string;
    trackNameAr: string;
    validityDays: number;
    publicationStatus: string;
    isStudentGrade: boolean;
    alreadyActive: boolean;
  }>;
  videoEntitlements: Array<{
    id: number;
    targetId: number;
    videoTitleAr: string;
    videoType: string;
    gradeNameAr: string;
    unitTitleAr: string;
    source: string;
    expiresAt: string | null;
    isRevoked: boolean;
    grantedByName: string | null;
    note: string;
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    remainingDays: number | null;
    countedOpens: number;
    effectiveMaxOpens: number | null;
    remainingOpens: number | null;
  }>;
  videoAccessLedger: Array<{
    videoId: number;
    titleAr: string;
    gradeNameAr: string;
    lessonTitleAr: string;
    courseTitleAr: string | null;
    videoType: string;
    countedOpens: number;
    effectiveMaxOpens: number | null;
    remainingOpens: number | null;
    maxOpensOverride: number | null;
    bonusOpens: number;
    completionPercent: number;
    isCompleted: boolean;
    lastCountedAt: string | null;
  }>;
  examsOverview: Array<{
    examId: number;
    titleAr: string;
    examType: string;
    gradeNameAr: string;
    attemptsCount: number;
    maxAttempts: number;
    status: string;
    latestAttemptId: number | null;
    submittedAt: string | null;
    obtainedScore: number | null;
    bestScore: number | null;
    maxScore: number;
    percent: number | null;
    passed: boolean | null;
    generalFeedback: string;
  }>;
  orders: Array<{
    id: number;
    orderNumber: string;
    targetTitleAr: string;
    amountEgp: number;
    discountEgp: number;
    finalAmountEgp: number;
    couponCode: string | null;
    paymentMethod: string;
    status: string;
    paymentStatus: string | null;
    createdAt: string;
  }>;
  codeRedemptions: Array<{
    id: number;
    codePrefix: string;
    targetType: string;
    targetId: number;
    durationDays: number;
    redeemedAt: string;
  }>;
  sessions: Array<{
    id: number;
    deviceFingerprint?: string;
    deviceLabel: string;
    ipAddress: string;
    isRevoked: boolean;
    isBlocked: boolean;
    lastHeartbeatAt: string;
  }>;
  activityLogs: Array<{
    id: number;
    actorName: string;
    action: string;
    entityType: string;
    detailsJson: Record<string, unknown> | null;
    createdAt: string;
  }>;
  deletionSafety: {
    canArchive: boolean;
    canPermanentlyDelete: boolean;
    blockReasonAr: string | null;
    warningsAr: string[];
  };
  catalogRefs: {
    units: Array<{ id: number; gradeId: number; titleAr: string; gradeNameAr: string }>;
  };
}

interface AttemptReviewData {
  attempt: {
    id: number;
    status: string;
    totalScore: string | number;
    maxScore: string | number;
    passed: boolean;
    generalFeedback: string | null;
  };
  exam: { titleAr: string };
  answers: Array<{
    id: number;
    questionPromptAr: string;
    questionType: string;
    maxPoints: number;
    awardedPoints: string | number;
    selectedChoiceLabelAr?: string | null;
    textAnswer?: string | null;
    numericAnswer?: string | null;
    isCorrect?: boolean | null;
    graderFeedback?: string | null;
  }>;
}

interface StudentFullProfileDrawerProps {
  studentId: number;
  initialTab?: ProfileTab;
  currentUser?: AuthUser;
  tracks: Array<{ id: number; nameAr: string }>;
  grades: Array<{ id: number; trackId: number; nameAr: string }>;
  videos: Array<{ id: number; gradeId: number; titleAr: string; videoType: string }>;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onRequestDelete: (studentId: number) => void;
  onToast: (msg: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL_GRANT: 'منحة يدوية من المدرس',
  PURCHASE: 'شراء مباشر',
  SUBSCRIPTION: 'اشتراك باقة',
  ACTIVATION_CODE: 'كود تفعيل',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'نشط ومعتمد', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PENDING_APPROVAL: { label: 'بانتظار الموافقة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  REJECTED: { label: 'مرفوض', cls: 'bg-red-50 text-red-700 border-red-200' },
  SUSPENDED: { label: 'موقوف مؤقتًا', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  ARCHIVED: { label: 'مؤرشف ومعطّل', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
};

export const StudentFullProfileDrawer: React.FC<StudentFullProfileDrawerProps> = ({
  studentId,
  initialTab = 'personal',
  currentUser,
  tracks,
  grades,
  videos,
  onClose,
  onUpdated,
  onRequestDelete,
  onToast,
}) => {
  const canManageSessions = currentUser ? hasPermission(currentUser, PERMISSIONS.SESSIONS_MANAGE) : true;
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [data, setData] = useState<FullStudentProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Editable personal form
  const [editForm, setEditForm] = useState({
    fullName: '',
    phone: '',
    parentPhone: '',
    email: '',
    governorate: '',
    trackId: 0,
    gradeId: 0,
    status: 'ACTIVE',
    maxDevices: 2,
    allowConcurrent: false,
    newPassword: '',
  });

  // Course grant form
  const [selectedCourseIds, setSelectedCourseIds] = useState<number[]>([]);
  const [courseGrantDays, setCourseGrantDays] = useState<number>(0);
  const [courseGrantCustomDate, setCourseGrantCustomDate] = useState('');
  const [courseGrantNote, setCourseGrantNote] = useState('');
  const [grantAllModalOpen, setGrantAllModalOpen] = useState(false);
  const [grantAllIncludeOtherGrades, setGrantAllIncludeOtherGrades] = useState(false);

  // Expiry edit state per entitlement
  const [editingExpiryId, setEditingExpiryId] = useState<number | null>(null);
  const [customExpiryVal, setCustomExpiryVal] = useState('');

  // Video grant form
  const [videoGrantMode, setVideoGrantMode] = useState<'VIDEOS' | 'UNIT'>('VIDEOS');
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<number>(0);
  const [videoGrantDays, setVideoGrantDays] = useState<number>(0);
  const [videoGrantNote, setVideoGrantNote] = useState('');

  // Video open limit editor
  const [limitEditVideoId, setLimitEditVideoId] = useState<number | null>(null);
  const [limitOverrideVal, setLimitOverrideVal] = useState<string>('');
  const [limitBonusVal, setLimitBonusVal] = useState<number>(0);

  // Inline Exam Attempt Review
  const [reviewAttempt, setReviewAttempt] = useState<AttemptReviewData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Confirm paid revoke modal
  const [confirmPaidRevokeEnt, setConfirmPaidRevokeEnt] = useState<{ id: number; title: string; source: string } | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<FullStudentProfileResponse>(
        `/api/admin/manage/students/${studentId}/full-profile`,
      );
      setData(res);
      setEditForm({
        fullName: res.student.fullName || '',
        phone: res.student.phone || '',
        parentPhone: res.student.parentPhone || '',
        email: res.student.email || '',
        governorate: res.student.governorate || '',
        trackId: res.student.primaryTrackId || tracks[0]?.id || 0,
        gradeId: res.student.primaryGradeId || grades[0]?.id || 0,
        status: res.student.status,
        maxDevices: res.student.maxDevices,
        allowConcurrent: res.student.allowConcurrent,
        newPassword: '',
      });
      if (res.catalogRefs.units.length > 0 && selectedUnitId === 0) {
        setSelectedUnitId(res.catalogRefs.units[0].id);
      }
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [studentId, tracks, grades, onToast, selectedUnitId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        fullName: editForm.fullName,
        phone: editForm.phone,
        parentPhone: editForm.parentPhone,
        email: editForm.email,
        governorate: editForm.governorate,
        trackId: editForm.trackId || undefined,
        gradeId: editForm.gradeId || undefined,
        status: editForm.status,
        maxDevices: editForm.maxDevices,
        allowConcurrent: editForm.allowConcurrent,
      };
      if (editForm.newPassword.trim().length >= 6) {
        payload.newPassword = editForm.newPassword.trim();
      }
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${studentId}/profile`,
        { method: 'PATCH', body: JSON.stringify(payload) },
      );
      onToast(res.message);
      await loadProfile();
      await onUpdated();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreStudent = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${studentId}/restore`,
        { method: 'POST' },
      );
      onToast(res.message);
      await loadProfile();
      await onUpdated();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleGrantSelectedCourses = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourseIds.length) {
      onToast('يرجى تحديد كورس واحد على الأقل أولًا');
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${studentId}/courses/grant`,
        {
          method: 'POST',
          body: JSON.stringify({
            courseIds: selectedCourseIds,
            durationDays: courseGrantCustomDate ? 0 : courseGrantDays,
            expiresAt: courseGrantCustomDate ? new Date(courseGrantCustomDate).toISOString() : null,
            note: courseGrantNote,
          }),
        },
      );
      setSelectedCourseIds([]);
      setCourseGrantNote('');
      setCourseGrantCustomDate('');
      onToast(res.message);
      await loadProfile();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmGrantAllEligible = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${studentId}/courses/grant`,
        {
          method: 'POST',
          body: JSON.stringify({
            grantAllEligible: true,
            includeAllGrades: grantAllIncludeOtherGrades,
            durationDays: courseGrantCustomDate ? 0 : courseGrantDays,
            expiresAt: courseGrantCustomDate ? new Date(courseGrantCustomDate).toISOString() : null,
            note: courseGrantNote || 'منحة إدارية: جميع الكورسات المتاحة حاليًا',
          }),
        },
      );
      setGrantAllModalOpen(false);
      onToast(res.message);
      await loadProfile();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleExtendOrRestoreEntitlement = async (
    entId: number,
    payload: { extendDays?: number; expiresAt?: string | null; restore?: boolean },
  ) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/manage/entitlements/${entId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setEditingExpiryId(null);
      setCustomExpiryVal('');
      onToast(res.message);
      await loadProfile();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeEntitlement = async (
    ent: { id: number; title: string; source: string },
    confirmPaidRevoke = false,
  ) => {
    if (ent.source !== 'MANUAL_GRANT' && !confirmPaidRevoke) {
      setConfirmPaidRevokeEnt(ent);
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/entitlements/${ent.id}/revoke`,
        {
          method: 'POST',
          body: JSON.stringify({ confirmPaidRevoke }),
        },
      );
      setConfirmPaidRevokeEnt(null);
      onToast(res.message);
      await loadProfile();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleGrantVideos = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body =
        videoGrantMode === 'UNIT'
          ? { unitId: selectedUnitId, durationDays: videoGrantDays, note: videoGrantNote }
          : { videoIds: selectedVideoIds, durationDays: videoGrantDays, note: videoGrantNote };
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${studentId}/videos/grant`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setSelectedVideoIds([]);
      setVideoGrantNote('');
      onToast(res.message);
      await loadProfile();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateVideoLimit = async (
    videoId: number,
    payload: { maxOpensOverride?: number | null; bonusOpens?: number; resetOpens?: boolean },
  ) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${studentId}/videos/${videoId}/limit`,
        { method: 'PUT', body: JSON.stringify(payload) },
      );
      setLimitEditVideoId(null);
      onToast(res.message);
      await loadProfile();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSessionAction = async (
    action: 'REVOKE_ONE' | 'BLOCK_DEVICE' | 'UNBLOCK_DEVICE' | 'LOGOUT_ALL_USER',
    sessionId?: number,
  ) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ success: boolean; message?: string }>('/api/admin/sessions/action', {
        method: 'POST',
        body: JSON.stringify({ action, sessionId, userId: studentId }),
      });
      onToast(res.message || 'تم تحديث حالة الأجهزة والجلسات');
      await loadProfile();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenAttemptReview = async (attemptId: number) => {
    setReviewLoading(true);
    try {
      const res = await apiRequest<AttemptReviewData>(
        `/api/admin/phase2-exams/attempts/${attemptId}`,
      );
      setReviewAttempt(res);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setReviewLoading(false);
    }
  };

  const eligibleCoursesPreview =
    data?.availableCourses.filter(
      (c) => !c.alreadyActive && (grantAllIncludeOtherGrades || c.isStudentGrade),
    ) || [];

  const statusMeta = data
    ? STATUS_LABELS[data.student.status] || {
        label: data.student.status,
        cls: 'bg-slate-100 text-slate-700 border-slate-200',
      }
    : null;

  const TABS: Array<{ id: ProfileTab; label: string; icon: React.ReactNode }> = [
    { id: 'personal', label: 'البيانات الشخصية', icon: <User className="h-3.5 w-3.5" /> },
    { id: 'courses', label: 'الكورسات والاشتراكات', icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: 'videos', label: 'صلاحيات الفيديوهات', icon: <Video className="h-3.5 w-3.5" /> },
    { id: 'exams', label: 'الامتحانات والدرجات', icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    { id: 'payments', label: 'المدفوعات والأكواد', icon: <CreditCard className="h-3.5 w-3.5" /> },
    { id: 'activity', label: 'سجل النشاط', icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="الملف الكامل للطالب"
      className="fixed inset-0 z-[55] flex justify-end bg-slate-950/55"
    >
      <div className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-[#F7F9FC] px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-extrabold text-[#0B162C]">
                {data ? data.student.fullName : 'الملف الكامل للطالب'}
              </h3>
              {data && (
                <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono-num text-[11px] font-bold text-slate-600">
                  ID #{data.student.id}
                </span>
              )}
              {statusMeta && (
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${statusMeta.cls}`}>
                  {statusMeta.label}
                </span>
              )}
            </div>
            {data && (
              <p className="mt-1 text-xs text-slate-600">
                {data.student.trackNameAr} · {data.student.gradeNameAr} · هاتف:{' '}
                <span className="font-mono-num" dir="ltr">
                  {data.student.phone || '—'}
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data && data.student.status === 'ARCHIVED' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRestoreStudent()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>استعادة وتفعيل الحساب</span>
              </button>
            )}
            {data && data.deletionSafety.canArchive && (
              <button
                type="button"
                onClick={() => onRequestDelete(data.student.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>أرشفة / حذف الطالب</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق الملف الكامل للطالب"
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="أقسام ملف الطالب"
          className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-bold transition-colors ${
                  active
                    ? 'bg-[#0B162C] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B162C]'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading || !data ? (
            <div className="py-12 text-center text-sm text-slate-500">جارٍ تحميل الملف الكامل للطالب...</div>
          ) : (
            <>
              {/* TAB 1: PERSONAL INFO & SECURITY */}
              {tab === 'personal' && (
                <div className="space-y-6">
                  {/* Summary Strip */}
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
                      <div className="text-[11px] text-slate-500">تاريخ التسجيل</div>
                      <div className="mt-1 text-xs font-bold text-[#0B162C]">
                        {formatDateAr(data.student.createdAt)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
                      <div className="text-[11px] text-slate-500">آخر تسجيل دخول</div>
                      <div className="mt-1 text-xs font-bold text-[#0B162C]">
                        {formatDateTimeAr(data.student.lastLoginAt)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
                      <div className="text-[11px] text-slate-500">كود متابعة ولي الأمر</div>
                      <div className="mt-1 font-mono-num text-xs font-bold text-[#2563EB]" dir="ltr">
                        {data.student.parentShareCode || '—'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
                      <div className="text-[11px] text-slate-500">المجموعات المسجل بها</div>
                      <div className="mt-1 text-xs font-bold text-[#0B162C]">
                        {data.groups.length > 0 ? data.groups.map((g) => g.nameAr).join('، ') : 'غير منضم لمجموعة'}
                      </div>
                    </div>
                  </div>

                  {/* Edit Student Info Form */}
                  <form
                    onSubmit={handleSaveProfile}
                    className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
                  >
                    <h4 className="text-sm font-extrabold text-[#0B162C]">تعديل البيانات الشخصية والأكاديمية</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>الاسم بالكامل</span>
                        <input
                          type="text"
                          required
                          value={editForm.fullName}
                          onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>رقم هاتف الطالب</span>
                        <input
                          type="tel"
                          dir="ltr"
                          required
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-sm font-normal"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>رقم هاتف ولي الأمر</span>
                        <input
                          type="tel"
                          dir="ltr"
                          value={editForm.parentPhone}
                          onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-sm font-normal"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>البريد الإلكتروني (اختياري)</span>
                        <input
                          type="email"
                          dir="ltr"
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm font-normal"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>المحافظة</span>
                        <input
                          type="text"
                          value={editForm.governorate}
                          onChange={(e) => setEditForm({ ...editForm, governorate: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>حالة الحساب</span>
                        <select
                          value={editForm.status}
                          onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                        >
                          <option value="ACTIVE">نشط ومعتمد</option>
                          <option value="PENDING_APPROVAL">في انتظار الموافقة</option>
                          <option value="REJECTED">مرفوض</option>
                          <option value="SUSPENDED">موقوف مؤقتًا</option>
                          <option value="ARCHIVED">مؤرشف ومعطّل</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>المسار الدراسي</span>
                        <select
                          value={editForm.trackId}
                          onChange={(e) => {
                            const tid = Number(e.target.value);
                            const firstG = grades.find((g) => g.trackId === tid);
                            setEditForm({ ...editForm, trackId: tid, gradeId: firstG?.id || 0 });
                          }}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                        >
                          {tracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nameAr}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>الصف الدراسي</span>
                        <select
                          value={editForm.gradeId}
                          onChange={(e) => setEditForm({ ...editForm, gradeId: Number(e.target.value) })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                        >
                          {grades
                            .filter((g) => g.trackId === editForm.trackId)
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.nameAr}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span>الحد الأقصى للأجهزة</span>
                        <select
                          value={editForm.maxDevices}
                          onChange={(e) => setEditForm({ ...editForm, maxDevices: Number(e.target.value) })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-sm font-normal"
                        >
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              {n} جهاز
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          <KeyRound className="h-3.5 w-3.5 text-[#2563EB]" />
                          إعادة تعيين كلمة المرور (اختياري)
                        </span>
                        <input
                          type="password"
                          minLength={6}
                          placeholder="اتركه فارغًا للإبقاء على الحالية"
                          value={editForm.newPassword}
                          onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={editForm.allowConcurrent}
                          onChange={(e) => setEditForm({ ...editForm, allowConcurrent: e.target.checked })}
                        />
                        <span>السماح بالتشغيل المتزامن من أكثر من جهاز</span>
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span>حفظ التعديلات</span>
                      </button>
                    </div>
                  </form>

                  {/* Devices & Sessions */}
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-extrabold text-[#0B162C]">الأجهزة والجلسات المسجلة</h4>
                      {canManageSessions && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSessionAction('LOGOUT_ALL_USER')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>تسجيل خروج من كل الأجهزة</span>
                        </button>
                      )}
                    </div>
                    <div className="mt-3 divide-y divide-slate-100">
                      {data.sessions.length === 0 ? (
                        <p className="py-4 text-xs text-slate-500">لا توجد جلسات مسجلة حتى الآن.</p>
                      ) : (
                        data.sessions.map((s) => (
                          <div key={s.id} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                            <div>
                              <div className="font-bold text-[#0B162C]">
                                {s.deviceLabel} · <span className="font-mono-num">{s.ipAddress}</span>
                              </div>
                              <div className="text-slate-500">
                                آخر نشاط: {formatDateTimeAr(s.lastHeartbeatAt)}
                                {s.deviceFingerprint ? (
                                  <span className="mr-2 font-mono text-[11px] text-slate-400">
                                    معرّف الجهاز: {s.deviceFingerprint.slice(0, 14)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {s.isBlocked ? (
                                <>
                                  <span className="font-bold text-red-700">جهاز محظور</span>
                                  {canManageSessions && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void handleSessionAction('UNBLOCK_DEVICE', s.id)}
                                      className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                    >
                                      <Unlock className="h-3 w-3" />
                                      إلغاء الحظر
                                    </button>
                                  )}
                                </>
                              ) : s.isRevoked ? (
                                <>
                                  <span className="text-slate-400">منتهية</span>
                                  {canManageSessions && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void handleSessionAction('BLOCK_DEVICE', s.id)}
                                      className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                    >
                                      <ShieldBan className="h-3 w-3" />
                                      حظر
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  {!canManageSessions && (
                                    <span className="font-semibold text-emerald-700">نشطة</span>
                                  )}
                                  {canManageSessions && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void handleSessionAction('REVOKE_ONE', s.id)}
                                        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-50"
                                      >
                                        إنهاء
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void handleSessionAction('BLOCK_DEVICE', s.id)}
                                        className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                      >
                                        <ShieldBan className="h-3 w-3" />
                                        حظر
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: COURSES & SUBSCRIPTIONS */}
              {tab === 'courses' && (
                <div className="space-y-6">
                  {/* Grant Courses Control Panel */}
                  <form
                    onSubmit={handleGrantSelectedCourses}
                    className="rounded-xl border border-blue-200 bg-blue-50/40 p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-extrabold text-[#0B162C]">
                        <Unlock className="h-4 w-4 text-[#2563EB]" />
                        <span>منح كورسات للطالب (كورس واحد، عدة كورسات، أو جميع الكورسات المتاحة)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGrantAllModalOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1E293B]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>منح جميع الكورسات المتاحة</span>
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                      {data.availableCourses.length === 0 ? (
                        <p className="text-xs text-slate-500">لا توجد كورسات متاحة حاليًا.</p>
                      ) : (
                        data.availableCourses.map((c) => {
                          const checked = selectedCourseIds.includes(c.id);
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                                c.alreadyActive
                                  ? 'border-emerald-200 bg-emerald-50/40 text-slate-600'
                                  : checked
                                    ? 'border-[#2563EB] bg-blue-50/50'
                                    : 'border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  disabled={c.alreadyActive}
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedCourseIds((prev) =>
                                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                                    )
                                  }
                                />
                                <div>
                                  <span className="font-bold text-[#0B162C]">{c.titleAr}</span>
                                  <span className="mr-2 text-[11px] text-slate-500">
                                    ({c.gradeNameAr}
                                    {c.isStudentGrade ? ' · صف الطالب' : ''})
                                  </span>
                                </div>
                              </div>
                              {c.alreadyActive ? (
                                <span className="font-bold text-emerald-700">مفتوح بالفعل</span>
                              ) : (
                                <span className="font-mono-num text-[11px] text-slate-500">
                                  صلاحية افتراضية: {c.validityDays} يومًا
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <select
                        aria-label="مدة صلاحية الكورس"
                        value={courseGrantDays}
                        onChange={(e) => setCourseGrantDays(Number(e.target.value))}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      >
                        <option value={0}>صلاحية دائمة</option>
                        <option value={7}>لمدة 7 أيام</option>
                        <option value={30}>لمدة 30 يومًا</option>
                        <option value={90}>لمدة 90 يومًا</option>
                        <option value={180}>لمدة 180 يومًا</option>
                        <option value={365}>لمدة سنة كاملة</option>
                      </select>
                      <input
                        type="date"
                        aria-label="تاريخ انتهاء مخصص (اختياري)"
                        value={courseGrantCustomDate}
                        onChange={(e) => setCourseGrantCustomDate(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-xs"
                      />
                      <input
                        type="text"
                        placeholder="ملاحظة إدارية (اختياري)"
                        value={courseGrantNote}
                        onChange={(e) => setCourseGrantNote(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={busy || selectedCourseIds.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                        <span>منح الكورسات المحددة ({selectedCourseIds.length})</span>
                      </button>
                    </div>
                  </form>

                  {/* Assigned Course Entitlements */}
                  <div>
                    <h4 className="text-sm font-extrabold text-[#0B162C]">
                      الكورسات والصلاحيات الممنوحة للطالب ({data.courseEntitlements.length})
                    </h4>
                    <div className="mt-3 space-y-2.5">
                      {data.courseEntitlements.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-500">
                          لا توجد كورسات أو صلاحيات صف مسجلة لهذا الطالب بعد.
                        </div>
                      ) : (
                        data.courseEntitlements.map((ent) => (
                          <div
                            key={ent.id}
                            className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-sm text-[#0B162C]">{ent.targetTitleAr}</span>
                                  <span
                                    className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                      ent.status === 'ACTIVE'
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : ent.status === 'EXPIRED'
                                          ? 'bg-amber-50 text-amber-700'
                                          : 'bg-red-50 text-red-700'
                                    }`}
                                  >
                                    {ent.status === 'ACTIVE'
                                      ? 'نشط'
                                      : ent.status === 'EXPIRED'
                                        ? 'منتهي الصلاحية'
                                        : 'مسحوب'}
                                  </span>
                                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                    {SOURCE_LABELS[ent.source] || ent.source}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  البداية: {formatDateAr(ent.startsAt)} · الانتهاء:{' '}
                                  {ent.expiresAt ? formatDateAr(ent.expiresAt) : 'دائم'}
                                  {ent.remainingDays !== null && ent.status === 'ACTIVE' && (
                                    <span className="mr-2 font-mono-num font-bold text-[#2563EB]">
                                      (متبقي {ent.remainingDays} يوم)
                                    </span>
                                  )}
                                  {ent.note ? ` · ${ent.note}` : ''}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                {ent.status === 'REVOKED' ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void handleExtendOrRestoreEntitlement(ent.id, { restore: true })
                                    }
                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    <span>استعادة الصلاحية</span>
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void handleExtendOrRestoreEntitlement(ent.id, { extendDays: 30 })
                                      }
                                      className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#2563EB] hover:bg-blue-100"
                                    >
                                      +30 يومًا
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingExpiryId(editingExpiryId === ent.id ? null : ent.id);
                                        setCustomExpiryVal(
                                          ent.expiresAt ? ent.expiresAt.slice(0, 10) : '',
                                        );
                                      }}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                      <Calendar className="h-3 w-3" />
                                      <span>تعديل الانتهاء</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void handleRevokeEntitlement({
                                          id: ent.id,
                                          title: ent.targetTitleAr,
                                          source: ent.source,
                                        })
                                      }
                                      className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                                    >
                                      سحب الصلاحية
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {editingExpiryId === ent.id && (
                              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 text-xs">
                                <input
                                  type="date"
                                  value={customExpiryVal}
                                  onChange={(e) => setCustomExpiryVal(e.target.value)}
                                  className="rounded-md border border-slate-300 px-2.5 py-1 font-mono-num"
                                />
                                <button
                                  type="button"
                                  disabled={busy || !customExpiryVal}
                                  onClick={() =>
                                    void handleExtendOrRestoreEntitlement(ent.id, {
                                      expiresAt: new Date(customExpiryVal).toISOString(),
                                    })
                                  }
                                  className="rounded-md bg-[#2563EB] px-3 py-1 font-bold text-white"
                                >
                                  حفظ التاريخ
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleExtendOrRestoreEntitlement(ent.id, { expiresAt: null })
                                  }
                                  className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700"
                                >
                                  جعلها دائمة
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: VIDEO ACCESS & VIEW LIMITS */}
              {tab === 'videos' && (
                <div className="space-y-6">
                  {/* Grant Individual Videos or Unit */}
                  <form
                    onSubmit={handleGrantVideos}
                    className="rounded-xl border border-blue-200 bg-blue-50/40 p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-extrabold text-[#0B162C]">
                        منح صلاحية فيديو محدد أو عدة فيديوهات أو وحدة كاملة
                      </h4>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setVideoGrantMode('VIDEOS')}
                          className={`rounded-md px-3 py-1 text-xs font-bold ${
                            videoGrantMode === 'VIDEOS'
                              ? 'bg-[#0B162C] text-white'
                              : 'border border-slate-300 bg-white text-slate-700'
                          }`}
                        >
                          فيديوهات محددة
                        </button>
                        <button
                          type="button"
                          onClick={() => setVideoGrantMode('UNIT')}
                          className={`rounded-md px-3 py-1 text-xs font-bold ${
                            videoGrantMode === 'UNIT'
                              ? 'bg-[#0B162C] text-white'
                              : 'border border-slate-300 bg-white text-slate-700'
                          }`}
                        >
                          وحدة دراسية كاملة
                        </button>
                      </div>
                    </div>

                    {videoGrantMode === 'VIDEOS' ? (
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2.5 space-y-1.5">
                        {videos.map((v) => (
                          <label
                            key={v.id}
                            className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedVideoIds.includes(v.id)}
                                onChange={() =>
                                  setSelectedVideoIds((prev) =>
                                    prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id],
                                  )
                                }
                              />
                              <span className="font-semibold text-[#0B162C]">{v.titleAr}</span>
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {v.videoType === 'FREE' ? 'مجاني' : v.videoType === 'COURSE' ? 'ضمن كورس' : 'مدفوع'}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <select
                        value={selectedUnitId}
                        onChange={(e) => setSelectedUnitId(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      >
                        {data.catalogRefs.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.titleAr} ({u.gradeNameAr})
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      <select
                        value={videoGrantDays}
                        onChange={(e) => setVideoGrantDays(Number(e.target.value))}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      >
                        <option value={0}>صلاحية دائمة</option>
                        <option value={7}>7 أيام</option>
                        <option value={30}>30 يومًا</option>
                        <option value={90}>90 يومًا</option>
                      </select>
                      <input
                        type="text"
                        placeholder="ملاحظة (اختياري)"
                        value={videoGrantNote}
                        onChange={(e) => setVideoGrantNote(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={
                          busy ||
                          (videoGrantMode === 'VIDEOS' ? selectedVideoIds.length === 0 : !selectedUnitId)
                        }
                        className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                      >
                        منح صلاحية المشاهدة
                      </button>
                    </div>
                  </form>

                  {/* Active Individual Video Entitlements */}
                  <div>
                    <h4 className="text-sm font-extrabold text-[#0B162C]">
                      الصلاحيات الفردية للفيديوهات ({data.videoEntitlements.length})
                    </h4>
                    <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                      {data.videoEntitlements.length === 0 ? (
                        <p className="p-4 text-xs text-slate-500">لا توجد صلاحيات فردية لفيديوهات محددة.</p>
                      ) : (
                        data.videoEntitlements.map((ve) => (
                          <div key={ve.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                            <div>
                              <div className="font-bold text-[#0B162C]">{ve.videoTitleAr}</div>
                              <div className="text-slate-500">
                                {SOURCE_LABELS[ve.source] || ve.source} · الانتهاء:{' '}
                                {ve.expiresAt ? formatDateAr(ve.expiresAt) : 'دائم'}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {ve.status === 'REVOKED' ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleExtendOrRestoreEntitlement(ve.id, { restore: true })
                                  }
                                  className="rounded-md bg-emerald-600 px-2.5 py-1 font-bold text-white"
                                >
                                  استعادة
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleRevokeEntitlement({
                                      id: ve.id,
                                      title: ve.videoTitleAr,
                                      source: ve.source,
                                    })
                                  }
                                  className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 font-bold text-red-700"
                                >
                                  سحب
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Per-Student Video View Limit Ledger */}
                  <div>
                    <h4 className="text-sm font-extrabold text-[#0B162C]">
                      سجل حدود المشاهدة والتقدم للفيديوهات ({data.videoAccessLedger.length})
                    </h4>
                    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
                          <tr>
                            <th className="p-3">الفيديو</th>
                            <th className="p-3">المرات المستهلكة / الحد</th>
                            <th className="p-3">المتبقي</th>
                            <th className="p-3">نسبة الإنجاز</th>
                            <th className="p-3">التحكم بالحدود</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.videoAccessLedger.map((v) => (
                            <React.Fragment key={v.videoId}>
                              <tr>
                                <td className="p-3">
                                  <div className="font-bold text-[#0B162C]">{v.titleAr}</div>
                                  <div className="text-[11px] text-slate-500">
                                    {v.courseTitleAr || v.lessonTitleAr}
                                  </div>
                                </td>
                                <td className="p-3 font-mono-num">
                                  {v.countedOpens} / {v.effectiveMaxOpens === null ? 'غير محدود' : v.effectiveMaxOpens}
                                </td>
                                <td className="p-3 font-mono-num font-bold text-[#2563EB]">
                                  {v.remainingOpens === null ? '∞' : v.remainingOpens}
                                </td>
                                <td className="p-3 font-mono-num">{v.completionPercent}%</td>
                                <td className="p-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (limitEditVideoId === v.videoId) {
                                          setLimitEditVideoId(null);
                                        } else {
                                          setLimitEditVideoId(v.videoId);
                                          setLimitOverrideVal(
                                            v.maxOpensOverride === null ? '' : String(v.maxOpensOverride),
                                          );
                                          setLimitBonusVal(v.bonusOpens);
                                        }
                                      }}
                                      className="rounded border border-slate-300 px-2 py-1 font-semibold hover:bg-slate-50"
                                    >
                                      تخصيص الحد
                                    </button>
                                    {v.countedOpens > 0 && (
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          void handleUpdateVideoLimit(v.videoId, { resetOpens: true })
                                        }
                                        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 font-bold text-emerald-700"
                                      >
                                        تصفير العداد
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {limitEditVideoId === v.videoId && (
                                <tr className="bg-blue-50/40">
                                  <td colSpan={5} className="p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <label className="text-[11px] font-semibold">
                                        الحد المخصص للطالب (-1 غير محدود، فارغ = افتراضي):
                                        <input
                                          type="number"
                                          min={-1}
                                          max={500}
                                          value={limitOverrideVal}
                                          onChange={(e) => setLimitOverrideVal(e.target.value)}
                                          className="mr-2 w-24 rounded border border-slate-300 bg-white px-2 py-1 font-mono-num"
                                        />
                                      </label>
                                      <label className="text-[11px] font-semibold">
                                        مشاهدات إضافية (Bonus):
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          value={limitBonusVal}
                                          onChange={(e) => setLimitBonusVal(Number(e.target.value))}
                                          className="mr-2 w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono-num"
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          void handleUpdateVideoLimit(v.videoId, {
                                            maxOpensOverride:
                                              limitOverrideVal === '' ? null : Number(limitOverrideVal),
                                            bonusOpens: limitBonusVal,
                                          })
                                        }
                                        className="rounded bg-[#2563EB] px-3 py-1 font-bold text-white"
                                      >
                                        حفظ
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: EXAMS & GRADES */}
              {tab === 'exams' && (
                <div className="space-y-5">
                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-right text-xs">
                      <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
                        <tr>
                          <th className="p-3">الامتحان</th>
                          <th className="p-3">المحاولات</th>
                          <th className="p-3">الحالة</th>
                          <th className="p-3">الدرجة والنسبة</th>
                          <th className="p-3">التاريخ</th>
                          <th className="p-3">المراجعة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.examsOverview.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-slate-500">
                              لا توجد امتحانات مخصصة أو مكتملة لهذا الطالب حتى الآن.
                            </td>
                          </tr>
                        ) : (
                          data.examsOverview.map((ex) => (
                            <tr key={ex.examId}>
                              <td className="p-3">
                                <div className="font-bold text-[#0B162C]">{ex.titleAr}</div>
                                <div className="text-[11px] text-slate-500">{ex.gradeNameAr}</div>
                              </td>
                              <td className="p-3 font-mono-num">
                                {ex.attemptsCount} / {ex.maxAttempts}
                              </td>
                              <td className="p-3 font-bold">
                                {ex.status === 'NOT_STARTED' ? (
                                  <span className="text-slate-500">لم يبدأ بعد</span>
                                ) : ex.status === 'AWAITING_MANUAL_GRADING' ? (
                                  <span className="text-amber-700">بانتظار التصحيح اليدوي</span>
                                ) : ex.status === 'IN_PROGRESS' ? (
                                  <span className="text-[#2563EB]">قيد الحل</span>
                                ) : ex.passed ? (
                                  <span className="text-emerald-700">ناجح</span>
                                ) : (
                                  <span className="text-red-700">لم يجتز</span>
                                )}
                              </td>
                              <td className="p-3 font-mono-num font-bold">
                                {ex.obtainedScore !== null
                                  ? `${ex.obtainedScore} / ${ex.maxScore} (${ex.percent ?? 0}%)`
                                  : '—'}
                              </td>
                              <td className="p-3 text-slate-500">{formatDateAr(ex.submittedAt)}</td>
                              <td className="p-3">
                                {ex.latestAttemptId ? (
                                  <button
                                    type="button"
                                    disabled={reviewLoading}
                                    onClick={() => void handleOpenAttemptReview(ex.latestAttemptId!)}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 font-semibold text-[#0B162C] hover:border-[#2563EB]"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>مراجعة الإجابات</span>
                                  </button>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Inline Attempt Review Box */}
                  {reviewAttempt && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-extrabold text-[#0B162C]">
                            مراجعة إجابات الامتحان: {reviewAttempt.exam.titleAr}
                          </h4>
                          <p className="font-mono-num text-xs text-slate-600">
                            الدرجة النهائية: {reviewAttempt.attempt.totalScore} / {reviewAttempt.attempt.maxScore}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReviewAttempt(null)}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold"
                        >
                          إغلاق المراجعة
                        </button>
                      </div>
                      {reviewAttempt.attempt.generalFeedback && (
                        <div className="rounded-lg border border-blue-200 bg-white p-3 text-xs text-slate-700">
                          <strong>ملاحظة المدرس:</strong> {reviewAttempt.attempt.generalFeedback}
                        </div>
                      )}
                      <div className="space-y-2">
                        {reviewAttempt.answers.map((ans, idx) => (
                          <div key={ans.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-[#0B162C]">
                                س{idx + 1}: {ans.questionPromptAr}
                              </span>
                              <span className="font-mono-num font-bold text-[#2563EB]">
                                {ans.awardedPoints} / {ans.maxPoints}
                              </span>
                            </div>
                            <div className="mt-1 text-slate-600">
                              إجابة الطالب:{' '}
                              {ans.selectedChoiceLabelAr || ans.numericAnswer || ans.textAnswer || 'لم يُجب'}
                            </div>
                            {ans.graderFeedback && (
                              <div className="mt-1 text-emerald-700">تعليق المصحح: {ans.graderFeedback}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <StudentHomeworkSummaryBlock studentId={studentId} />
                </div>
              )}

              {/* TAB 5: PAYMENTS & CODES */}
              {tab === 'payments' && (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-extrabold text-[#0B162C]">
                      الطلبات والمدفوعات المسجلة ({data.orders.length})
                    </h4>
                    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
                          <tr>
                            <th className="p-3">رقم الطلب</th>
                            <th className="p-3">المحتوى</th>
                            <th className="p-3">المبلغ / الخصم</th>
                            <th className="p-3">الكوبون</th>
                            <th className="p-3">الحالة</th>
                            <th className="p-3">التاريخ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.orders.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-6 text-center text-slate-500">
                                لا توجد طلبات دفع مسجلة لهذا الطالب.
                              </td>
                            </tr>
                          ) : (
                            data.orders.map((o) => (
                              <tr key={o.id}>
                                <td className="p-3 font-mono-num font-bold" dir="ltr">
                                  {o.orderNumber}
                                </td>
                                <td className="p-3 font-semibold text-[#0B162C]">{o.targetTitleAr}</td>
                                <td className="p-3 font-mono-num">
                                  {o.finalAmountEgp} ج.م
                                  {o.discountEgp > 0 && (
                                    <span className="mr-1 text-emerald-700">(-{o.discountEgp})</span>
                                  )}
                                </td>
                                <td className="p-3 font-mono-num text-[#2563EB]">{o.couponCode || '—'}</td>
                                <td className="p-3 font-bold">
                                  {o.status === 'PAID'
                                    ? 'مدفوع ومؤكد'
                                    : o.status === 'UNDER_REVIEW'
                                      ? 'قيد المراجعة'
                                      : o.status}
                                </td>
                                <td className="p-3 text-slate-500">{formatDateAr(o.createdAt)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-extrabold text-[#0B162C]">
                      أكواد التفعيل المستخدمة ({data.codeRedemptions.length})
                    </h4>
                    <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                      {data.codeRedemptions.length === 0 ? (
                        <p className="p-4 text-xs text-slate-500">لم يقم الطالب بتفعيل أي أكواد بعد.</p>
                      ) : (
                        data.codeRedemptions.map((r) => (
                          <div key={r.id} className="flex items-center justify-between p-3 text-xs">
                            <div>
                              <span className="font-mono-num font-bold text-[#2563EB]" dir="ltr">
                                {r.codePrefix}
                              </span>
                              <span className="mr-2 text-slate-600">
                                {r.targetType} #{r.targetId} ({r.durationDays} يومًا)
                              </span>
                            </div>
                            <span className="text-slate-500">{formatDateTimeAr(r.redeemedAt)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: REAL ACTIVITY LOG */}
              {tab === 'activity' && (
                <div className="space-y-3">
                  <h4 className="text-sm font-extrabold text-[#0B162C]">
                    سجل النشاط والتدقيق الحقيقي ({data.activityLogs.length})
                  </h4>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                    {data.activityLogs.length === 0 ? (
                      <p className="p-6 text-center text-xs text-slate-500">لا توجد أحداث مسجلة بعد.</p>
                    ) : (
                      data.activityLogs.map((log) => (
                        <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                          <div>
                            <span className="font-bold text-[#0B162C]">{log.actorName}</span> ·{' '}
                            <span className="font-mono-num font-semibold text-[#2563EB]">{log.action}</span>
                          </div>
                          <span className="text-slate-500">{formatDateTimeAr(log.createdAt)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirm Grant All Eligible Courses Modal */}
      {grantAllModalOpen && data && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-extrabold text-[#0B162C]">
                تأكيد منح جميع الكورسات المتاحة حاليًا
              </h4>
              <button type="button" onClick={() => setGrantAllModalOpen(false)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              سيتم منح الطالب <strong>{data.student.fullName}</strong> صلاحية يدوية للوصول إلى الكورسات المتاحة حاليًا
              فقط (لن يتم منحه أي كورسات مستقبلية تلقائيًا، وسيتم تخطي الكورسات المفتوحة مسبقًا دون تكرار).
            </p>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={grantAllIncludeOtherGrades}
                onChange={(e) => setGrantAllIncludeOtherGrades(e.target.checked)}
              />
              <span>تضمين كورسات الصفوف الأخرى أيضًا (الافتراضي: صف الطالب فقط)</span>
            </label>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs space-y-1.5">
              {eligibleCoursesPreview.length === 0 ? (
                <p className="text-slate-500">الطالب يملك بالفعل صلاحية نشطة لجميع الكورسات في هذا النطاق.</p>
              ) : (
                eligibleCoursesPreview.map((c) => (
                  <div key={c.id} className="flex items-center justify-between">
                    <span className="font-bold text-[#0B162C]">• {c.titleAr}</span>
                    <span className="text-slate-500">{c.gradeNameAr}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGrantAllModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busy || eligibleCoursesPreview.length === 0}
                onClick={() => void handleConfirmGrantAllEligible()}
                className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                تأكيد منح {eligibleCoursesPreview.length} كورس الآن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Confirmation for Revoking Paid/Subscription Entitlement */}
      {confirmPaidRevokeEnt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="text-base font-extrabold">تنبيه: سحب صلاحية غير يدوية</h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-700">
              الصلاحية <strong>{confirmPaidRevokeEnt.title}</strong> مصدرها{' '}
              <strong>{SOURCE_LABELS[confirmPaidRevokeEnt.source] || confirmPaidRevokeEnt.source}</strong> وليست منحة
              يدوية. هل أنت متأكد من رغبتك في سحبها مع الإبقاء على السجل المالي محفوظًا؟
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmPaidRevokeEnt(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRevokeEntitlement(confirmPaidRevokeEnt, true)}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
              >
                تأكيد السحب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
