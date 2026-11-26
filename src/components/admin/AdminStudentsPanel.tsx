import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  GraduationCap,
  MapPin,
  Phone,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, formatDateAr } from '../../lib/api.ts';
import { PERMISSIONS, hasAnyPermission, hasPermission } from '../../lib/permissions.ts';
import type { AuthUser } from '../../types/lms.ts';
import {
  AdminActionMenu,
  AdminCard,
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMasterDetail,
  AdminPageHeader,
  AdminSegmentedTabs,
  AdminStatusBadge,
  type AdminTone,
} from './AdminUiPrimitives.tsx';
import { StudentFullProfileDrawer, type ProfileTab } from './StudentFullProfileDrawer.tsx';

interface AdminStudentRow {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
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
}

interface DeleteModalState {
  student: AdminStudentRow;
  safety: {
    canArchive: boolean;
    canPermanentlyDelete: boolean;
    blockReasonAr: string | null;
    warningsAr: string[];
  } | null;
  loading: boolean;
  reason: string;
  showPermanent: boolean;
  confirmText: string;
}

type StatusTabId = 'ALL' | 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

interface AdminStudentsPanelProps {
  tracks: Array<{ id: number; nameAr: string }>;
  grades: Array<{ id: number; trackId: number; nameAr: string }>;
  videos: Array<{ id: number; gradeId: number; titleAr: string; videoType: string }>;
  courses: Array<{ id: number; gradeId: number; titleAr: string }>;
  currentUser: AuthUser;
  onToast: (msg: string) => void;
  initialStatusFilter?: 'ALL' | 'PENDING_APPROVAL' | 'ACTIVE';
  initialAction?: 'NONE' | 'CREATE';
  navigationNonce?: number;
}

function getStudentStatusMeta(status: string): { label: string; tone: AdminTone } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'نشط ومفعّل', tone: 'emerald' };
    case 'PENDING_APPROVAL':
      return { label: 'في انتظار الموافقة', tone: 'amber' };
    case 'REJECTED':
      return { label: 'مرفوض', tone: 'rose' };
    case 'SUSPENDED':
      return { label: 'موقوف', tone: 'rose' };
    case 'ARCHIVED':
      return { label: 'مؤرشف ومعطّل', tone: 'slate' };
    default:
      return { label: status, tone: 'slate' };
  }
}

export const AdminStudentsPanel: React.FC<AdminStudentsPanelProps> = ({
  tracks,
  grades,
  videos,
  currentUser,
  onToast,
  initialStatusFilter,
  initialAction,
  navigationNonce,
}) => {
  const canApproveStudents = hasAnyPermission(currentUser, [
    PERMISSIONS.STUDENTS_APPROVE,
    PERMISSIONS.STUDENTS_MANAGE,
  ]);
  const canManageStudents = hasPermission(currentUser, PERMISSIONS.STUDENTS_MANAGE);
  const canDeleteStudents = hasAnyPermission(currentUser, [
    PERMISSIONS.STUDENTS_MANAGE,
    PERMISSIONS.STUDENTS_DELETE,
  ]);
  const canGrantAccess = hasPermission(currentUser, PERMISSIONS.STUDENT_ACCESS_GRANT);

  const [allStudents, setAllStudents] = useState<AdminStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTabId>(initialStatusFilter || 'ALL');
  const [gradeFilter, setGradeFilter] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Complete Student Profile Drawer
  const [profileDrawer, setProfileDrawer] = useState<{ studentId: number; tab: ProfileTab } | null>(
    null,
  );

  // Safe Two-Level Archive / Delete Modal
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Manual Add Student Modal
  const [addOpen, setAddOpen] = useState(false);
  const [newStudent, setNewStudent] = useState({
    fullName: '',
    phone: '',
    parentPhone: '',
    password: '',
    trackId: tracks[0]?.id || 0,
    gradeId: grades[0]?.id || 0,
    governorate: 'القاهرة',
  });

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
      setPage(1);
    }
    if (initialAction === 'CREATE' && canManageStudents) {
      setAddOpen(true);
    }
  }, [initialStatusFilter, initialAction, navigationNonce, canManageStudents]);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ students: AdminStudentRow[] }>('/api/admin/students');
      setAllStudents(res.students || []);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  // Real counts from all students
  const counts = useMemo(() => {
    let active = 0;
    let pending = 0;
    let suspended = 0;
    let archived = 0;
    for (const s of allStudents) {
      if (s.status === 'ACTIVE') active++;
      else if (s.status === 'PENDING_APPROVAL') pending++;
      else if (s.status === 'SUSPENDED' || s.status === 'REJECTED') suspended++;
      else if (s.status === 'ARCHIVED') archived++;
    }
    return {
      total: allStudents.length,
      active,
      pending,
      suspended,
      archived,
    };
  }, [allStudents]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allStudents.filter((st) => {
      if (statusFilter === 'SUSPENDED') {
        if (st.status !== 'SUSPENDED' && st.status !== 'REJECTED') return false;
      } else if (statusFilter !== 'ALL' && st.status !== statusFilter) {
        return false;
      }
      if (gradeFilter > 0 && st.primaryGradeId !== gradeFilter) return false;
      if (q) {
        const hay = `${st.fullName} ${st.phone || ''} ${st.parentPhone || ''} ${st.governorate || ''} ${st.gradeNameAr || ''} ${st.trackNameAr || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allStudents, statusFilter, gradeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedStudents = useMemo(
    () => filteredStudents.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredStudents, safePage, pageSize],
  );

  // Keep selected preview student synced with visible list
  const selectedStudent = useMemo(() => {
    if (selectedStudentId !== null) {
      const found = allStudents.find((s) => s.id === selectedStudentId);
      if (found) return found;
    }
    return pagedStudents[0] ?? filteredStudents[0] ?? null;
  }, [selectedStudentId, allStudents, pagedStudents, filteredStudents]);

  const handleBulkDecision = async (ids: number[], decision: 'ACTIVE' | 'REJECTED' | 'SUSPENDED') => {
    if (!ids.length) return;
    try {
      await apiRequest('/api/admin/students/bulk-decision', {
        method: 'POST',
        body: JSON.stringify({ userIds: ids, decision }),
      });
      setSelectedIds([]);
      onToast(
        decision === 'ACTIVE'
          ? `تم قبول وتفعيل ${ids.length} طالب بنجاح`
          : decision === 'REJECTED'
            ? `تم رفض ${ids.length} طلب`
            : `تم إيقاف ${ids.length} حساب`,
      );
      await loadStudents();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const openSafeDeleteModal = async (student: AdminStudentRow) => {
    setDeleteModal({
      student,
      safety: null,
      loading: true,
      reason: '',
      showPermanent: false,
      confirmText: '',
    });
    try {
      const res = await apiRequest<{ deletionSafety: DeleteModalState['safety'] }>(
        `/api/admin/manage/students/${student.id}/full-profile`,
      );
      setDeleteModal((prev) =>
        prev ? { ...prev, safety: res.deletionSafety, loading: false } : null,
      );
    } catch (err) {
      onToast((err as Error).message);
      setDeleteModal(null);
    }
  };

  const handleArchiveStudent = async () => {
    if (!deleteModal) return;
    setDeleteBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${deleteModal.student.id}/archive`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: deleteModal.reason }),
        },
      );
      onToast(res.message);
      setDeleteModal(null);
      if (profileDrawer?.studentId === deleteModal.student.id) {
        setProfileDrawer(null);
      }
      await loadStudents();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handlePermanentDeleteStudent = async () => {
    if (!deleteModal) return;
    setDeleteBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${deleteModal.student.id}/permanent`,
        {
          method: 'DELETE',
          body: JSON.stringify({ confirmText: deleteModal.confirmText }),
        },
      );
      onToast(res.message);
      setDeleteModal(null);
      if (profileDrawer?.studentId === deleteModal.student.id) {
        setProfileDrawer(null);
      }
      await loadStudents();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRestoreStudent = async (studentId: number) => {
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/students/${studentId}/restore`,
        { method: 'POST' },
      );
      onToast(res.message);
      await loadStudents();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleAddManualStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/students', {
        method: 'POST',
        body: JSON.stringify({ ...newStudent, status: 'ACTIVE' }),
      });
      setAddOpen(false);
      setNewStudent({
        fullName: '',
        phone: '',
        parentPhone: '',
        password: '',
        trackId: tracks[0]?.id || 0,
        gradeId: grades[0]?.id || 0,
        governorate: 'القاهرة',
      });
      onToast('تمت إضافة الطالب وتفعيله بنجاح');
      await loadStudents();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
    setGradeFilter(0);
    setPage(1);
  };

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'ALL' || gradeFilter > 0;

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <AdminPageHeader
        title="إدارة الطلاب والموافقات"
        subtitle="مراجعة طلبات التسجيل، اعتماد الحسابات، منح صلاحيات الكورسات والفيديوهات، والأرشفة الآمنة."
        icon={<Users className="h-5 w-5" />}
        actions={
          canManageStudents && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة طالب جديد</span>
            </button>
          )
        }
      />

      {/* 4 Real KPI Cards (Ref 02) */}
      <AdminKpiGrid cols={4}>
        <AdminKpiCard
          label="إجمالي الطلاب"
          value={counts.total}
          subtitle="جميع السجلات المسجلة"
          icon={<Users className="h-5 w-5" />}
          tone="blue"
          onClick={() => {
            setStatusFilter('ALL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="طلاب مفعّلون"
          value={counts.active}
          subtitle="حسابات نشطة ومعتمدة"
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="emerald"
          onClick={() => {
            setStatusFilter('ACTIVE');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="في انتظار الموافقة"
          value={counts.pending}
          subtitle="تحتاج مراجعة وتفعيل"
          icon={<Clock className="h-5 w-5" />}
          tone="amber"
          onClick={() => {
            setStatusFilter('PENDING_APPROVAL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="موقوف / مؤرشف"
          value={counts.suspended + counts.archived}
          subtitle={`موقوف/مرفوض: ${counts.suspended} · مؤرشف: ${counts.archived}`}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone="purple"
          onClick={() => {
            setStatusFilter('ARCHIVED');
            setPage(1);
          }}
        />
      </AdminKpiGrid>

      {/* Segmented Status Tabs (Ref 02) */}
      <AdminSegmentedTabs<StatusTabId>
        activeId={statusFilter}
        onChange={(id) => {
          setStatusFilter(id);
          setSelectedIds([]);
          setPage(1);
        }}
        items={[
          { id: 'ALL', label: 'كل الطلاب', count: counts.total },
          { id: 'PENDING_APPROVAL', label: 'طلبات التسجيل', count: counts.pending },
          { id: 'ACTIVE', label: 'طلاب مفعّلون', count: counts.active },
          { id: 'SUSPENDED', label: 'موقوف / مرفوض', count: counts.suspended },
          { id: 'ARCHIVED', label: 'أرشيف الطلاب', count: counts.archived },
        ]}
      />

      {/* Filter Bar + Bulk Actions */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="ابحث بالاسم، رقم الهاتف، ولي الأمر، أو المحافظة..."
        onReset={resetFilters}
        hasActiveFilters={hasActiveFilters}
        rightSlot={
          canApproveStudents && selectedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <AdminStatusBadge tone="blue">
                تم تحديد <span className="font-mono-num">{selectedIds.length}</span>
              </AdminStatusBadge>
              <button
                type="button"
                onClick={() => void handleBulkDecision(selectedIds, 'ACTIVE')}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                قبول وتفعيل
              </button>
              <button
                type="button"
                onClick={() => void handleBulkDecision(selectedIds, 'SUSPENDED')}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
              >
                إيقاف
              </button>
              <button
                type="button"
                onClick={() => void handleBulkDecision(selectedIds, 'REJECTED')}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
              >
                رفض
              </button>
            </div>
          ) : undefined
        }
      >
        <select
          aria-label="تصفية حسب الصف"
          value={gradeFilter}
          onChange={(e) => {
            setGradeFilter(Number(e.target.value));
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-[#2563EB] focus:outline-none"
        >
          <option value={0}>كل الصفوف الدراسية</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nameAr}
            </option>
          ))}
        </select>
      </AdminFilterBar>

      {/* Master-Detail Workspace: Table on Right (8 cols) + Sticky Student Preview Panel on Left (4 cols) */}
      <AdminMasterDetail
        mainSpan="8"
        main={
          <AdminCard padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                  <tr>
                    <th className="w-10 px-3.5 py-3">
                      <input
                        type="checkbox"
                        aria-label="تحديد الكل في الصفحة"
                        checked={
                          pagedStudents.length > 0 &&
                          pagedStudents.every((s) => selectedIds.includes(s.id))
                        }
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? pagedStudents.map((s) => s.id) : [])
                        }
                        className="rounded border-slate-300 text-[#2563EB]"
                      />
                    </th>
                    <th className="px-3.5 py-3">الطالب</th>
                    <th className="px-3.5 py-3">الصف والمسار</th>
                    <th className="px-3.5 py-3">حالة الحساب</th>
                    <th className="px-3.5 py-3">آخر دخول</th>
                    <th className="px-3.5 py-3 text-left">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-xs text-slate-500">
                        جارٍ تحميل قائمة الطلاب...
                      </td>
                    </tr>
                  ) : pagedStudents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6">
                        <AdminEmptyState
                          icon={<Users className="h-5 w-5" />}
                          title="لا يوجد طلاب مطابقون"
                          description="جرّب تغيير حالة التصفية أو مسح كلمة البحث."
                        />
                      </td>
                    </tr>
                  ) : (
                    pagedStudents.map((st) => {
                      const statusMeta = getStudentStatusMeta(st.status);
                      const isSelected = selectedStudent?.id === st.id;
                      const initial = (st.fullName || 'ط').trim().charAt(0);
                      return (
                        <tr
                          key={st.id}
                          onClick={() => setSelectedStudentId(st.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50/80'
                          }`}
                        >
                          <td
                            className="px-3.5 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`تحديد ${st.fullName}`}
                              checked={selectedIds.includes(st.id)}
                              onChange={() => toggleSelect(st.id)}
                              className="rounded border-slate-300 text-[#2563EB]"
                            />
                          </td>
                          <td className="px-3.5 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 font-display text-xs font-extrabold text-[#2563EB] ring-1 ring-blue-100">
                                {initial}
                              </span>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedStudentId(st.id);
                                    setProfileDrawer({ studentId: st.id, tab: 'personal' });
                                  }}
                                  className="truncate text-right text-xs font-extrabold text-[#0F172A] hover:text-[#2563EB] hover:underline"
                                >
                                  {st.fullName}
                                </button>
                                <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                                  {st.phone || '—'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3.5 py-3">
                            <div className="font-bold text-slate-700">{st.gradeNameAr || '—'}</div>
                            <div className="text-[11px] text-slate-400">
                              {st.trackNameAr || '—'}
                            </div>
                          </td>
                          <td className="px-3.5 py-3">
                            <AdminStatusBadge tone={statusMeta.tone} dot>
                              {statusMeta.label}
                            </AdminStatusBadge>
                          </td>
                          <td className="px-3.5 py-3 font-mono-num text-[11px] text-slate-500">
                            {formatDateAr(st.lastLoginAt)}
                          </td>
                          <td
                            className="px-3.5 py-3 text-left"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1.5">
                              {st.status === 'PENDING_APPROVAL' && canApproveStudents && (
                                <button
                                  type="button"
                                  onClick={() => void handleBulkDecision([st.id], 'ACTIVE')}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                                >
                                  <UserCheck className="h-3.5 w-3.5" />
                                  <span>قبول</span>
                                </button>
                              )}
                              {st.status === 'ARCHIVED' && canManageStudents && (
                                <button
                                  type="button"
                                  onClick={() => void handleRestoreStudent(st.id)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  <span>استعادة</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setProfileDrawer({ studentId: st.id, tab: 'personal' })
                                }
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:border-[#2563EB] hover:text-[#2563EB]"
                              >
                                الملف
                              </button>
                              <AdminActionMenu
                                ariaLabel={`خيارات ${st.fullName}`}
                                items={[
                                  ...(canGrantAccess
                                    ? [
                                        {
                                          id: 'courses',
                                          label: 'إدارة الكورسات والصلاحيات',
                                          icon: <BookOpen className="h-3.5 w-3.5" />,
                                          onClick: () =>
                                            setProfileDrawer({ studentId: st.id, tab: 'courses' }),
                                        },
                                      ]
                                    : []),
                                  ...(canApproveStudents && st.status === 'PENDING_APPROVAL'
                                    ? [
                                        {
                                          id: 'reject',
                                          label: 'رفض الطلب',
                                          icon: <UserX className="h-3.5 w-3.5" />,
                                          tone: 'danger' as const,
                                          onClick: () =>
                                            void handleBulkDecision([st.id], 'REJECTED'),
                                        },
                                      ]
                                    : []),
                                  ...(canApproveStudents && st.status === 'ACTIVE'
                                    ? [
                                        {
                                          id: 'suspend',
                                          label: 'إيقاف الحساب مؤقتًا',
                                          icon: <ShieldAlert className="h-3.5 w-3.5" />,
                                          tone: 'danger' as const,
                                          onClick: () =>
                                            void handleBulkDecision([st.id], 'SUSPENDED'),
                                        },
                                      ]
                                    : []),
                                  ...(canApproveStudents &&
                                  (st.status === 'SUSPENDED' || st.status === 'REJECTED')
                                    ? [
                                        {
                                          id: 'activate',
                                          label: 'إعادة تفعيل الحساب',
                                          icon: <UserCheck className="h-3.5 w-3.5" />,
                                          tone: 'success' as const,
                                          onClick: () =>
                                            void handleBulkDecision([st.id], 'ACTIVE'),
                                        },
                                      ]
                                    : []),
                                  ...(canDeleteStudents
                                    ? [
                                        {
                                          id: 'delete',
                                          label: 'أرشفة أو حذف الطالب',
                                          icon: <Trash2 className="h-3.5 w-3.5" />,
                                          tone: 'danger' as const,
                                          onClick: () => void openSafeDeleteModal(st),
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {filteredStudents.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                <div>
                  عرض{' '}
                  <span className="font-mono-num font-bold text-[#0F172A]">
                    {(safePage - 1) * pageSize + 1}–
                    {Math.min(safePage * pageSize, filteredStudents.length)}
                  </span>{' '}
                  من إجمالي{' '}
                  <span className="font-mono-num font-bold text-[#0F172A]">
                    {filteredStudents.length}
                  </span>{' '}
                  طالب
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="عدد العناصر في الصفحة"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700"
                  >
                    <option value={10}>10 / صفحة</option>
                    <option value={25}>25 / صفحة</option>
                    <option value={50}>50 / صفحة</option>
                  </select>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    السابق
                  </button>
                  <span className="font-mono-num font-bold text-[#0F172A]">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    التالي
                  </button>
                </div>
              </div>
            )}
          </AdminCard>
        }
        detail={
          <AdminCard padding="md">
            {!selectedStudent ? (
              <AdminEmptyState
                icon={<GraduationCap className="h-5 w-5" />}
                title="معاينة ملف الطالب"
                description="اختر أي طالب من الجدول لعرض ملخص بياناته والانتقال السريع لملفه الكامل."
              />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-[#0F172A]">ملخص الطالب</h3>
                  <span className="font-mono-num text-[11px] font-bold text-slate-400">
                    STD-{selectedStudent.id}
                  </span>
                </div>

                {/* Profile Header Box */}
                <div className="rounded-xl border border-blue-100/80 bg-gradient-to-l from-blue-50/70 to-white p-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#2563EB] font-display text-base font-extrabold text-white shadow-sm">
                      {(selectedStudent.fullName || 'ط').trim().charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-extrabold text-[#0F172A]">
                        {selectedStudent.fullName}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {selectedStudent.gradeNameAr || '—'} · {selectedStudent.trackNameAr || '—'}
                      </div>
                      <div className="mt-1.5">
                        <AdminStatusBadge
                          tone={getStudentStatusMeta(selectedStudent.status).tone}
                          dot
                        >
                          {getStudentStatusMeta(selectedStudent.status).label}
                        </AdminStatusBadge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Jump Tabs into Full Profile Drawer */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setProfileDrawer({ studentId: selectedStudent.id, tab: 'personal' })
                    }
                    className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                  >
                    البيانات
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setProfileDrawer({ studentId: selectedStudent.id, tab: 'courses' })
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 hover:border-blue-200 hover:text-[#2563EB]"
                  >
                    الكورسات
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setProfileDrawer({ studentId: selectedStudent.id, tab: 'exams' })
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 hover:border-blue-200 hover:text-[#2563EB]"
                  >
                    النتائج
                  </button>
                </div>

                {/* Contact & Metadata Rows */}
                <div className="divide-y divide-slate-100 text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Phone className="h-3.5 w-3.5" />
                      <span>هاتف الطالب</span>
                    </span>
                    <span className="font-mono-num font-bold text-[#0F172A]" dir="ltr">
                      {selectedStudent.phone || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Phone className="h-3.5 w-3.5" />
                      <span>هاتف ولي الأمر</span>
                    </span>
                    <span className="font-mono-num font-bold text-[#0F172A]" dir="ltr">
                      {selectedStudent.parentPhone || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>المحافظة</span>
                    </span>
                    <span className="font-bold text-[#0F172A]">
                      {selectedStudent.governorate || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>تاريخ التسجيل</span>
                    </span>
                    <span className="font-mono-num font-semibold text-slate-700">
                      {formatDateAr(selectedStudent.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Clock className="h-3.5 w-3.5" />
                      <span>آخر دخول</span>
                    </span>
                    <span className="font-mono-num font-semibold text-slate-700">
                      {formatDateAr(selectedStudent.lastLoginAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-500">الحد الأقصى للأجهزة</span>
                    <span className="font-mono-num font-bold text-[#0F172A]">
                      {selectedStudent.maxDevices} جهاز
                    </span>
                  </div>
                </div>

                {/* Primary & Contextual CTA Buttons */}
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setProfileDrawer({ studentId: selectedStudent.id, tab: 'personal' })
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>عرض الملف الكامل</span>
                  </button>

                  {canApproveStudents && selectedStudent.status === 'PENDING_APPROVAL' && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void handleBulkDecision([selectedStudent.id], 'ACTIVE')}
                        className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        قبول وتفعيل
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleBulkDecision([selectedStudent.id], 'REJECTED')}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                      >
                        رفض الطلب
                      </button>
                    </div>
                  )}

                  {canDeleteStudents && (
                    <button
                      type="button"
                      onClick={() => void openSafeDeleteModal(selectedStudent)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>أرشفة أو حذف الحساب</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </AdminCard>
        }
      />

      {/* Complete Student Profile Drawer */}
      {profileDrawer && (
        <StudentFullProfileDrawer
          studentId={profileDrawer.studentId}
          initialTab={profileDrawer.tab}
          currentUser={currentUser}
          tracks={tracks}
          grades={grades}
          videos={videos}
          onClose={() => setProfileDrawer(null)}
          onUpdated={loadStudents}
          onRequestDelete={(sid) => {
            const st = allStudents.find((x) => x.id === sid);
            if (st) void openSafeDeleteModal(st);
          }}
          onToast={onToast}
        />
      )}

      {/* Safe Two-Level Archive / Permanent Delete Modal */}
      {deleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد حذف أو أرشفة الطالب"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="text-base font-extrabold text-[#0F172A]">
                  إدارة إزالة / حذف الطالب: {deleteModal.student.fullName}
                </h3>
              </div>
              <button type="button" onClick={() => setDeleteModal(null)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {deleteModal.loading ? (
              <p className="py-6 text-center text-xs text-slate-500">
                جارٍ فحص السجلات المرتبطة بالطالب...
              </p>
            ) : (
              <>
                <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">
                  <div className="font-extrabold">
                    الإجراء الآمن والموصى به: أرشفة وتعطيل الحساب
                  </div>
                  <p>
                    يوقف دخول الطالب فورًا ويسحب جميع الجلسات النشطة، مع الحفاظ الكامل على سجل
                    الامتحانات والدرجات والمدفوعات والاشتراكات التاريخية وإمكانية الاستعادة لاحقًا.
                  </p>
                  {deleteModal.safety && deleteModal.safety.warningsAr.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pr-4 text-amber-800">
                      {deleteModal.safety.warningsAr.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>سبب الأرشفة (اختياري — يُسجل في سجل التدقيق)</span>
                  <input
                    type="text"
                    value={deleteModal.reason}
                    onChange={(e) => setDeleteModal({ ...deleteModal, reason: e.target.value })}
                    placeholder="مثال: انتهاء العام الدراسي أو بناءً على طلب ولي الأمر"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-normal"
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={deleteBusy || !deleteModal.safety?.canArchive}
                    onClick={() => void handleArchiveStudent()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#0D172B] px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Archive className="h-4 w-4" />
                    <span>أرشفة وتعطيل الحساب بأمان (موصى به)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setDeleteModal({ ...deleteModal, showPermanent: !deleteModal.showPermanent })
                    }
                    className="text-xs font-bold text-rose-700 underline hover:text-rose-800"
                  >
                    {deleteModal.showPermanent
                      ? 'إخفاء خيار الحذف النهائي'
                      : 'خيار متقدم: الحذف النهائي'}
                  </button>
                </div>

                {deleteModal.showPermanent && (
                  <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs">
                    {!deleteModal.safety?.canPermanentlyDelete ? (
                      <p className="font-semibold text-rose-800">
                        {deleteModal.safety?.blockReasonAr ||
                          'الحذف النهائي محظور حفاظًا على السجلات المرتبطة.'}
                      </p>
                    ) : (
                      <>
                        <p className="font-semibold text-rose-800">
                          تحذير: الحذف النهائي يزيل حساب الطالب نهائيًا ولا يمكن التراجع عنه. للتأكيد
                          اكتب عبارة <strong>حذف نهائي</strong> أدناه:
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder='اكتب "حذف نهائي"'
                            value={deleteModal.confirmText}
                            onChange={(e) =>
                              setDeleteModal({ ...deleteModal, confirmText: e.target.value })
                            }
                            className="flex-1 rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            disabled={
                              deleteBusy ||
                              (deleteModal.confirmText.trim() !== 'حذف نهائي' &&
                                deleteModal.confirmText.trim() !== 'DELETE')
                            }
                            onClick={() => void handlePermanentDeleteStudent()}
                            className="rounded-xl bg-rose-600 px-3 py-1.5 font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            تأكيد الحذف النهائي
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Manual Add Student Modal */}
      {addOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="إضافة طالب جديد يدويًا"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-[#0F172A]">إضافة طالب جديد يدويًا</h3>
              <button type="button" onClick={() => setAddOpen(false)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleAddManualStudent} className="mt-4 space-y-3">
              <input
                type="text"
                required
                placeholder="الاسم بالكامل"
                value={newStudent.fullName}
                onChange={(e) => setNewStudent({ ...newStudent, fullName: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="tel"
                required
                dir="ltr"
                placeholder="رقم هاتف الطالب (010...)"
                value={newStudent.phone}
                onChange={(e) => setNewStudent({ ...newStudent, phone: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left font-mono-num text-sm"
              />
              <input
                type="tel"
                required
                dir="ltr"
                placeholder="رقم هاتف ولي الأمر"
                value={newStudent.parentPhone}
                onChange={(e) => setNewStudent({ ...newStudent, parentPhone: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left font-mono-num text-sm"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="كلمة مرور مؤقتة (6+ أحرف)"
                value={newStudent.password}
                onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newStudent.trackId}
                  onChange={(e) => {
                    const tid = Number(e.target.value);
                    const g = grades.find((x) => x.trackId === tid);
                    setNewStudent({ ...newStudent, trackId: tid, gradeId: g?.id || 0 });
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs"
                >
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr}
                    </option>
                  ))}
                </select>
                <select
                  value={newStudent.gradeId}
                  onChange={(e) =>
                    setNewStudent({ ...newStudent, gradeId: Number(e.target.value) })
                  }
                  className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs"
                >
                  {grades
                    .filter((g) => g.trackId === newStudent.trackId)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-[#2563EB] py-2.5 text-sm font-bold text-white hover:bg-[#1D4ED8]"
              >
                حفظ وتفعيل الطالب فورًا
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
