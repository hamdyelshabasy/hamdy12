import React, { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Search,
  Shield,
  ShieldAlert,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../lib/api.ts';
import type { AuthUser } from '../../types/lms.ts';

export interface StaffMemberItem {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  roleSlug: string;
  roleNameAr: string;
  lastLoginAt?: string | null;
  createdAt?: string | null;
}

type ManagedRoleSlug = 'TEACHING_ASSISTANT' | 'CONTENT_MANAGER' | 'SUPPORT';

const ASSIGNABLE_ROLES: Array<{
  slug: ManagedRoleSlug;
  labelAr: string;
  summaryAr: string;
}> = [
  {
    slug: 'TEACHING_ASSISTANT',
    labelAr: 'مساعد مدرس',
    summaryAr:
      'عرض الطلاب والموافقة على طلبات التسجيل، إضافة أسئلة في بنك الأسئلة (تُرفع للمراجعة)، تصحيح الامتحانات والواجبات، الرد على تعليقات الطلاب، وإدارة المجموعات.',
  },
  {
    slug: 'CONTENT_MANAGER',
    labelAr: 'مدير محتوى',
    summaryAr:
      'إدارة المسارات والصفوف والدروس والفيديوهات، الكورسات، إنشاء الامتحانات وبنك الأسئلة، الواجبات، وجدولة الحصص المباشرة.',
  },
  {
    slug: 'SUPPORT',
    labelAr: 'دعم فني',
    summaryAr:
      'عرض بيانات الطلاب للقراءة، إدارة أجهزة وجلسات الطلاب (إنهاء/حظر/إلغاء حظر)، وعرض الطلبات والأكواد للقراءة فقط.',
  },
];

const ROLE_BADGE_STYLES: Record<string, string> = {
  SUPER_ADMIN: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  TEACHING_ASSISTANT: 'border-blue-200 bg-blue-50 text-blue-800',
  CONTENT_MANAGER: 'border-violet-200 bg-violet-50 text-violet-800',
  SUPPORT: 'border-teal-200 bg-teal-50 text-teal-800',
};

interface AdminStaffPanelProps {
  staff: StaffMemberItem[];
  currentUser: AuthUser;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  embedded?: boolean;
}

type ActiveModal =
  | { type: 'create' }
  | { type: 'create-super-admin' }
  | { type: 'edit'; member: StaffMemberItem }
  | { type: 'role'; member: StaffMemberItem }
  | { type: 'status'; member: StaffMemberItem; nextStatus: 'SUSPENDED' | 'ACTIVE' }
  | { type: 'reset-password'; member: StaffMemberItem }
  | null;

export const AdminStaffPanel: React.FC<AdminStaffPanelProps> = ({
  staff,
  currentUser,
  onRefresh,
  onToast,
  embedded = false,
}) => {
  const isSuperAdmin = currentUser.roleSlug === 'SUPER_ADMIN';

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Active modal state
  const [modal, setModal] = useState<ActiveModal>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Create form state
  const [createForm, setCreateForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    roleSlug: 'TEACHING_ASSISTANT' as ManagedRoleSlug,
    password: '',
    confirmPassword: '',
  });
  const [showCreatePass, setShowCreatePass] = useState(false);

  // Guarded Additional Super Admin creation form state
  const [superAdminForm, setSuperAdminForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    currentAdminPassword: '',
    explicitConfirmation: false,
  });

  // Edit profile form state
  const [editForm, setEditForm] = useState({
    fullName: '',
    phone: '',
    email: '',
  });

  // Change role form state
  const [selectedRoleSlug, setSelectedRoleSlug] = useState<ManagedRoleSlug>('TEACHING_ASSISTANT');

  // Reset password form state
  const [resetForm, setResetForm] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [showResetPass, setShowResetPass] = useState(false);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staff.filter((member) => {
      if (roleFilter !== 'ALL' && member.roleSlug !== roleFilter) return false;
      if (statusFilter !== 'ALL' && member.status !== statusFilter) return false;
      if (!q) return true;
      return (
        member.fullName.toLowerCase().includes(q) ||
        (member.phone || '').toLowerCase().includes(q) ||
        (member.email || '').toLowerCase().includes(q) ||
        member.roleNameAr.toLowerCase().includes(q)
      );
    });
  }, [staff, searchQuery, roleFilter, statusFilter]);

  const closeModal = () => {
    setModal(null);
    setModalError('');
    setSubmitting(false);
    setShowCreatePass(false);
    setShowResetPass(false);
    setCreateForm({
      fullName: '',
      phone: '',
      email: '',
      roleSlug: 'TEACHING_ASSISTANT',
      password: '',
      confirmPassword: '',
    });
    setResetForm({ newPassword: '', confirmPassword: '' });
  };

  const openCreateModal = () => {
    setModalError('');
    setShowCreatePass(false);
    setCreateForm({
      fullName: '',
      phone: '',
      email: '',
      roleSlug: 'TEACHING_ASSISTANT',
      password: '',
      confirmPassword: '',
    });
    setModal({ type: 'create' });
  };

  const openEditModal = (member: StaffMemberItem) => {
    setModalError('');
    setEditForm({
      fullName: member.fullName,
      phone: member.phone || '',
      email: member.email || '',
    });
    setModal({ type: 'edit', member });
  };

  const openRoleModal = (member: StaffMemberItem) => {
    setModalError('');
    const fallbackRole: ManagedRoleSlug =
      member.roleSlug === 'CONTENT_MANAGER' || member.roleSlug === 'SUPPORT'
        ? member.roleSlug
        : 'TEACHING_ASSISTANT';
    setSelectedRoleSlug(fallbackRole);
    setModal({ type: 'role', member });
  };

  const openStatusModal = (member: StaffMemberItem) => {
    setModalError('');
    const nextStatus = member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setModal({ type: 'status', member, nextStatus });
  };

  const openResetPasswordModal = (member: StaffMemberItem) => {
    setModalError('');
    setShowResetPass(false);
    setResetForm({ newPassword: '', confirmPassword: '' });
    setModal({ type: 'reset-password', member });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    if (createForm.password !== createForm.confirmPassword) {
      setModalError('تأكيد كلمة المرور غير متطابق.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          fullName: createForm.fullName,
          phone: createForm.phone,
          email: createForm.email,
          roleSlug: createForm.roleSlug,
          password: createForm.password,
          confirmPassword: createForm.confirmPassword,
        }),
      });
      await onRefresh();
      closeModal();
      onToast(res.message || 'تم إنشاء حساب الموظف بنجاح');
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSuperAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    if (superAdminForm.password !== superAdminForm.confirmPassword) {
      setModalError('تأكيد كلمة المرور غير متطابق.');
      return;
    }
    if (!superAdminForm.explicitConfirmation) {
      setModalError('يرجى تفعيل مربع التأكيد الصريح قبل إنشاء حساب مدير عام إضافي.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/staff/super-admin', {
        method: 'POST',
        body: JSON.stringify(superAdminForm),
      });
      await onRefresh();
      setSuperAdminForm({
        fullName: '',
        phone: '',
        email: '',
        password: '',
        confirmPassword: '',
        currentAdminPassword: '',
        explicitConfirmation: false,
      });
      closeModal();
      onToast(res.message || 'تم إنشاء حساب المدير العام الإضافي بنجاح');
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal || modal.type !== 'edit') return;
    setModalError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/staff/${modal.member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editForm.fullName,
          phone: editForm.phone,
          email: editForm.email,
        }),
      });
      await onRefresh();
      closeModal();
      onToast(res.message || 'تم تحديث بيانات الموظف بنجاح');
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal || modal.type !== 'role') return;
    setModalError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/staff/${modal.member.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleSlug: selectedRoleSlug }),
      });
      await onRefresh();
      closeModal();
      onToast(res.message || 'تم تغيير الدور الوظيفي بنجاح');
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusConfirm = async () => {
    if (!modal || modal.type !== 'status') return;
    setModalError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/staff/${modal.member.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: modal.nextStatus }),
      });
      await onRefresh();
      closeModal();
      onToast(res.message || 'تم تحديث حالة حساب الموظف بنجاح');
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal || modal.type !== 'reset-password') return;
    setModalError('');

    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setModalError('تأكيد كلمة المرور الجديدة غير متطابق.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/staff/${modal.member.id}/reset-password`,
        {
          method: 'POST',
          body: JSON.stringify({
            newPassword: resetForm.newPassword,
            confirmPassword: resetForm.confirmPassword,
          }),
        },
      );
      await onRefresh();
      closeModal();
      onToast(res.message || 'تم إعادة تعيين كلمة المرور بنجاح');
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isSuperAdmin) {
    return null;
  }

  const activeRoleMeta = (slug: ManagedRoleSlug) =>
    ASSIGNABLE_ROLES.find((r) => r.slug === slug) || ASSIGNABLE_ROLES[0];

  return (
    <section
      aria-label="إدارة فريق العمل والصلاحيات"
      className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-[#0F172A]">
            <Shield className="h-4 w-4 text-[#2563EB]" />
            <span>أعضاء الفريق والصلاحيات</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            إضافة وإدارة حسابات المساعدين ومديري المحتوى والدعم الفني وتغيير أدوارهم بأمان.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>+ إضافة موظف جديد</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setModalError('');
              setSuperAdminForm({
                fullName: '',
                phone: '',
                email: '',
                password: '',
                confirmPassword: '',
                currentAdminPassword: '',
                explicitConfirmation: false,
              });
              setModal({ type: 'create-super-admin' });
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-800 transition-colors hover:bg-indigo-100"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>+ مدير عام إضافي</span>
          </button>
        </div>
      </div>

      {/* Accurate Role Permissions Reference (shown when standalone; Screen 17 shows it in sidebar) */}
      {!embedded && (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {ASSIGNABLE_ROLES.map((r) => (
            <div key={r.slug} className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
              <div className="text-xs font-extrabold text-[#0B162C]">{r.labelAr}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{r.summaryAr}</p>
            </div>
          ))}
        </div>
      )}

      {/* Compact Search & Filters */}
      <div className="grid gap-2.5 sm:grid-cols-12">
        <div className="relative sm:col-span-6">
          <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            aria-label="بحث في فريق العمل"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم أو رقم الهاتف أو البريد..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-3 text-xs focus:border-[#2563EB] focus:outline-none"
          />
        </div>
        <div className="sm:col-span-3">
          <select
            aria-label="تصفية حسب الدور الوظيفي"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
          >
            <option value="ALL">جميع الأدوار ({staff.length})</option>
            <option value="SUPER_ADMIN">المدير العام</option>
            <option value="TEACHING_ASSISTANT">مساعد مدرس</option>
            <option value="CONTENT_MANAGER">مدير محتوى</option>
            <option value="SUPPORT">دعم فني</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <select
            aria-label="تصفية حسب حالة الحساب"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
          >
            <option value="ALL">جميع الحالات</option>
            <option value="ACTIVE">نشط</option>
            <option value="SUSPENDED">موقوف</option>
          </select>
        </div>
      </div>

      {/* Responsive Staff Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-right text-xs">
          <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
            <tr>
              <th className="px-3.5 py-2.5 font-bold">الموظف</th>
              <th className="px-3.5 py-2.5 font-bold">بيانات التواصل</th>
              <th className="px-3.5 py-2.5 font-bold">الدور الوظيفي</th>
              <th className="px-3.5 py-2.5 font-bold">الحالة</th>
              <th className="px-3.5 py-2.5 font-bold">إجراءات الإدارة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredStaff.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  لا توجد نتائج مطابقة للبحث أو التصفية الحالية.
                </td>
              </tr>
            ) : (
              filteredStaff.map((member) => {
                const isProtectedOwner =
                  member.roleSlug === 'SUPER_ADMIN' || member.id === currentUser.id;
                const isActive = member.status === 'ACTIVE';
                const badgeClass =
                  ROLE_BADGE_STYLES[member.roleSlug] || 'border-slate-200 bg-slate-50 text-slate-700';

                return (
                  <tr key={member.id} className="hover:bg-slate-50/60">
                    <td className="px-3.5 py-3">
                      <div className="font-bold text-[#0B162C]">{member.fullName}</div>
                      {member.lastLoginAt && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          آخر دخول: {formatDateTimeAr(member.lastLoginAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="font-mono-num text-slate-700" dir="ltr">
                        {member.phone || '—'}
                      </div>
                      {member.email && (
                        <div className="mt-0.5 text-[11px] text-slate-500" dir="ltr">
                          {member.email}
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-3">
                      <span
                        className={`inline-block rounded-md border px-2.5 py-1 text-[11px] font-bold ${badgeClass}`}
                      >
                        {member.roleNameAr}
                      </span>
                    </td>
                    <td className="px-3.5 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                          isActive
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                        }`}
                      >
                        {isActive ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3">
                      {isProtectedOwner ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                          <Shield className="h-3.5 w-3.5" />
                          <span>حساب المدير العام (محمي)</span>
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(member)}
                            aria-label={`تعديل بيانات ${member.fullName}`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-[#2563EB] hover:text-[#2563EB]"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>تعديل البيانات</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openRoleModal(member)}
                            aria-label={`تغيير دور ${member.fullName}`}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50/70 px-2.5 py-1.5 text-[11px] font-semibold text-[#1D4ED8] hover:bg-blue-100"
                          >
                            <UserCog className="h-3 w-3" />
                            <span>تغيير الدور</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openStatusModal(member)}
                            aria-label={`${isActive ? 'إيقاف حساب' : 'إعادة تفعيل حساب'} ${member.fullName}`}
                            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold ${
                              isActive
                                ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            }`}
                          >
                            {isActive ? (
                              <>
                                <Ban className="h-3 w-3" />
                                <span>إيقاف الحساب</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                <span>إعادة تفعيل الحساب</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => openResetPasswordModal(member)}
                            aria-label={`إعادة تعيين كلمة مرور ${member.fullName}`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-[#F7F9FC] px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-400"
                          >
                            <KeyRound className="h-3 w-3" />
                            <span>إعادة تعيين كلمة المرور</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ==================== MODAL 1: CREATE STAFF ==================== */}
      {modal?.type === 'create' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-staff-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h4 id="create-staff-title" className="flex items-center gap-2 text-sm font-extrabold text-[#0B162C]">
                <UserPlus className="h-4 w-4 text-[#2563EB]" />
                <span>إضافة موظف جديد</span>
              </h4>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 p-5">
              {modalError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {modalError}
                </div>
              )}

              <div>
                <label htmlFor="staff-create-name" className="mb-1 block text-xs font-bold text-slate-700">
                  الاسم الكامل *
                </label>
                <input
                  id="staff-create-name"
                  type="text"
                  required
                  minLength={3}
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                  placeholder="مثال: أ. أحمد محمود (مساعد فيزياء)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="staff-create-phone" className="mb-1 block text-xs font-bold text-slate-700">
                    رقم الهاتف (مصري) *
                  </label>
                  <input
                    id="staff-create-phone"
                    type="tel"
                    dir="ltr"
                    required
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                    placeholder="01012345678"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="staff-create-email" className="mb-1 block text-xs font-bold text-slate-700">
                    البريد الإلكتروني (اختياري)
                  </label>
                  <input
                    id="staff-create-email"
                    type="email"
                    dir="ltr"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    placeholder="assistant@example.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="staff-create-role" className="mb-1 block text-xs font-bold text-slate-700">
                  الدور الوظيفي *
                </label>
                <select
                  id="staff-create-role"
                  value={createForm.roleSlug}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, roleSlug: e.target.value as ManagedRoleSlug })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r.slug} value={r.slug}>
                      {r.labelAr}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 rounded-lg border border-slate-200 bg-[#F7F9FC] p-2.5 text-[11px] leading-relaxed text-slate-600">
                  <strong className="text-[#0B162C]">صلاحيات هذا الدور: </strong>
                  {activeRoleMeta(createForm.roleSlug).summaryAr}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="staff-create-pass" className="mb-1 block text-xs font-bold text-slate-700">
                    كلمة المرور الأولية *
                  </label>
                  <div className="relative">
                    <input
                      id="staff-create-pass"
                      type={showCreatePass ? 'text' : 'password'}
                      required
                      minLength={8}
                      dir="ltr"
                      autoComplete="new-password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      placeholder="••••••••"
                      className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-left font-mono-num text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label={showCreatePass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      onClick={() => setShowCreatePass((v) => !v)}
                      className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      {showCreatePass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="staff-create-confirm" className="mb-1 block text-xs font-bold text-slate-700">
                    تأكيد كلمة المرور *
                  </label>
                  <input
                    id="staff-create-confirm"
                    type={showCreatePass ? 'text' : 'password'}
                    required
                    minLength={8}
                    dir="ltr"
                    autoComplete="new-password"
                    value={createForm.confirmPassword}
                    onChange={(e) => setCreateForm({ ...createForm, confirmPassword: e.target.value })}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                شروط كلمة المرور: 8 أحرف على الأقل، وتحتوي على حرف إنجليزي كبير (A-Z) وحرف صغير (a-z) ورقم واحد على الأقل. سلّمها للموظف بطريقة آمنة ومباشرة.
              </p>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                >
                  {submitting ? 'جارٍ الإنشاء...' : 'إنشاء وتفعيل الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 2: EDIT STAFF PROFILE ==================== */}
      {modal?.type === 'edit' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-staff-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h4 id="edit-staff-title" className="text-sm font-extrabold text-[#0B162C]">
                تعديل بيانات الموظف
              </h4>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-3.5 p-5">
              {modalError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {modalError}
                </div>
              )}

              <div>
                <label htmlFor="staff-edit-name" className="mb-1 block text-xs font-bold text-slate-700">
                  الاسم الكامل
                </label>
                <input
                  id="staff-edit-name"
                  type="text"
                  required
                  minLength={3}
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="staff-edit-phone" className="mb-1 block text-xs font-bold text-slate-700">
                  رقم الهاتف (مصري)
                </label>
                <input
                  id="staff-edit-phone"
                  type="tel"
                  dir="ltr"
                  required
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="staff-edit-email" className="mb-1 block text-xs font-bold text-slate-700">
                  البريد الإلكتروني (اختياري)
                </label>
                <input
                  id="staff-edit-email"
                  type="email"
                  dir="ltr"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-xs focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B162C] px-4 py-2 text-xs font-bold text-white hover:bg-[#2563EB] disabled:opacity-60"
                >
                  {submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 3: CHANGE ROLE ==================== */}
      {modal?.type === 'role' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-role-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h4 id="change-role-title" className="flex items-center gap-2 text-sm font-extrabold text-[#0B162C]">
                <UserCog className="h-4 w-4 text-[#2563EB]" />
                <span>تغيير الدور الوظيفي</span>
              </h4>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRoleSubmit} className="space-y-4 p-5">
              {modalError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {modalError}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs">
                <div className="font-bold text-[#0B162C]">{modal.member.fullName}</div>
                <div className="mt-0.5 text-slate-500">الدور الحالي: {modal.member.roleNameAr}</div>
              </div>

              <div>
                <label htmlFor="staff-change-role-select" className="mb-1 block text-xs font-bold text-slate-700">
                  اختر الدور الوظيفي الجديد
                </label>
                <select
                  id="staff-change-role-select"
                  value={selectedRoleSlug}
                  onChange={(e) => setSelectedRoleSlug(e.target.value as ManagedRoleSlug)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r.slug} value={r.slug}>
                      {r.labelAr}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 rounded-lg border border-slate-200 bg-[#F7F9FC] p-2.5 text-[11px] leading-relaxed text-slate-600">
                  {activeRoleMeta(selectedRoleSlug).summaryAr}
                </p>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <span>
                  عند تغيير الدور الوظيفي سيتم إنهاء جميع جلسات الموظف الحالية فورًا، وسيحتاج إلى تسجيل الدخول من جديد لتطبيق الصلاحيات الجديدة.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                >
                  {submitting ? 'جارٍ التحديث...' : 'تأكيد تغيير الدور'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 4: SUSPEND / REACTIVATE CONFIRM ==================== */}
      {modal?.type === 'status' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-staff-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h4 id="status-staff-title" className="text-sm font-extrabold text-[#0B162C]">
                {modal.nextStatus === 'SUSPENDED' ? 'تأكيد إيقاف حساب الموظف' : 'تأكيد إعادة تفعيل حساب الموظف'}
              </h4>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              {modalError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-700">
                  {modalError}
                </div>
              )}

              <p className="leading-relaxed text-slate-700">
                {modal.nextStatus === 'SUSPENDED' ? (
                  <>
                    هل أنت متأكد من إيقاف حساب <strong className="text-[#0B162C]">{modal.member.fullName}</strong>؟ سيتم إنهاء جميع جلساته النشطة فورًا ومنعه من تسجيل الدخول، مع الاحتفاظ بجميع سجلات التصحيح والنشاط السابقة.
                  </>
                ) : (
                  <>
                    هل تريد إعادة تفعيل حساب <strong className="text-[#0B162C]">{modal.member.fullName}</strong>؟ سيتمكن الموظف من تسجيل الدخول مجددًا بجلسة جديدة وفقًا لدوره الحالي ({modal.member.roleNameAr}).
                  </>
                )}
              </p>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleStatusConfirm()}
                  className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-60 ${
                    modal.nextStatus === 'SUSPENDED'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {submitting
                    ? 'جارٍ التنفيذ...'
                    : modal.nextStatus === 'SUSPENDED'
                      ? 'نعم، إيقاف الحساب فورًا'
                      : 'نعم، إعادة التفعيل'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 5: RESET PASSWORD ==================== */}
      {modal?.type === 'reset-password' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-pass-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h4 id="reset-pass-title" className="flex items-center gap-2 text-sm font-extrabold text-[#0B162C]">
                <KeyRound className="h-4 w-4 text-[#2563EB]" />
                <span>إعادة تعيين كلمة مرور الموظف</span>
              </h4>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3.5 p-5">
              {modalError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {modalError}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs">
                <div className="font-bold text-[#0B162C]">{modal.member.fullName}</div>
                <div className="mt-0.5 font-mono-num text-slate-500" dir="ltr">
                  {modal.member.phone}
                </div>
              </div>

              <div>
                <label htmlFor="staff-reset-pass" className="mb-1 block text-xs font-bold text-slate-700">
                  كلمة المرور الجديدة *
                </label>
                <div className="relative">
                  <input
                    id="staff-reset-pass"
                    type={showResetPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    dir="ltr"
                    autoComplete="new-password"
                    value={resetForm.newPassword}
                    onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-left font-mono-num text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={showResetPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    onClick={() => setShowResetPass((v) => !v)}
                    className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    {showResetPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="staff-reset-confirm" className="mb-1 block text-xs font-bold text-slate-700">
                  تأكيد كلمة المرور الجديدة *
                </label>
                <input
                  id="staff-reset-confirm"
                  type={showResetPass ? 'text' : 'password'}
                  required
                  minLength={8}
                  dir="ltr"
                  autoComplete="new-password"
                  value={resetForm.confirmPassword}
                  onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900">
                سيتم إنهاء جميع جلسات الموظف السابقة فور حفظ كلمة المرور الجديدة، ولن تعمل كلمة المرور القديمة بعد ذلك.
              </p>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B162C] px-4 py-2 text-xs font-bold text-white hover:bg-[#2563EB] disabled:opacity-60"
                >
                  {submitting ? 'جارٍ التحديث...' : 'حفظ كلمة المرور الجديدة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Guarded Additional SUPER_ADMIN Creation Modal */}
      {modal?.type === 'create-super-admin' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-indigo-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-indigo-700" />
                <h4 className="text-sm font-extrabold text-[#0B162C]">
                  إنشاء حساب مدير عام إضافي (Super Admin)
                </h4>
              </div>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
              <strong>تنبيه أمني:</strong> سيحصل هذا الحساب على الصلاحيات الكاملة لإدارة المنصة والطلاب والمالية وفريق العمل. لا يُسمح بترقية حساب طالب أو موظف قائم — يجب استخدام رقم هاتف جديد.
            </div>

            {modalError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateSuperAdminSubmit} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">الاسم الكامل *</label>
                  <input
                    type="text"
                    required
                    value={superAdminForm.fullName}
                    onChange={(e) => setSuperAdminForm({ ...superAdminForm, fullName: e.target.value })}
                    placeholder="أ. الاسم الكامل"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">رقم الهاتف الجديد *</label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={superAdminForm.phone}
                    onChange={(e) => setSuperAdminForm({ ...superAdminForm, phone: e.target.value })}
                    placeholder="01XXXXXXXXX"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">البريد الإلكتروني (اختياري)</label>
                <input
                  type="email"
                  dir="ltr"
                  value={superAdminForm.email}
                  onChange={(e) => setSuperAdminForm({ ...superAdminForm, email: e.target.value })}
                  placeholder="admin2@example.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-xs"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">كلمة مرور قوية للحساب الجديد *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    dir="ltr"
                    autoComplete="new-password"
                    value={superAdminForm.password}
                    onChange={(e) => setSuperAdminForm({ ...superAdminForm, password: e.target.value })}
                    placeholder="8+ أحرف وأرقام ورمز"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">تأكيد كلمة المرور *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    dir="ltr"
                    autoComplete="new-password"
                    value={superAdminForm.confirmPassword}
                    onChange={(e) => setSuperAdminForm({ ...superAdminForm, confirmPassword: e.target.value })}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2.5">
                <div>
                  <label className="mb-1 block text-xs font-bold text-indigo-950">
                    كلمة مرور حسابك الحالي ({currentUser.fullName}) للتحقق الأمني *
                  </label>
                  <input
                    type="password"
                    required
                    dir="ltr"
                    autoComplete="current-password"
                    value={superAdminForm.currentAdminPassword}
                    onChange={(e) =>
                      setSuperAdminForm({ ...superAdminForm, currentAdminPassword: e.target.value })
                    }
                    placeholder="أدخل كلمة مرورك الحالية"
                    className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-left font-mono-num text-xs"
                  />
                </div>
                <label className="flex items-start gap-2 text-[11px] font-semibold text-indigo-950">
                  <input
                    type="checkbox"
                    checked={superAdminForm.explicitConfirmation}
                    onChange={(e) =>
                      setSuperAdminForm({ ...superAdminForm, explicitConfirmation: e.target.checked })
                    }
                    className="mt-0.5"
                  />
                  <span>أؤكد رغبتي الصريحة في إنشاء حساب مدير عام (SUPER_ADMIN) إضافي بصلاحيات كاملة وتسجيل العملية في سجل التدقيق.</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-800 disabled:opacity-60"
                >
                  {submitting ? 'جارٍ التحقق والإنشاء...' : 'إنشاء المدير العام الإضافي'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
