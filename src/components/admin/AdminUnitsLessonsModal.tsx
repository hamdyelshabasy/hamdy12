import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Edit3,
  Eye,
  EyeOff,
  FolderPlus,
  Layers,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import {
  computeLessonDeleteImpact,
  computeUnitDeleteImpact,
  filterAndEnrichLessons,
  filterAndEnrichUnits,
  validateLessonInput,
  validateUnitInput,
  type CurriculumLessonRecord,
  type CurriculumUnitRecord,
} from '../../lib/curriculumStructure.ts';
import type { AdminCatalogData } from './AdminContentPanel.tsx';

export type UnitsLessonsModalTab = 'units' | 'lessons';

interface AdminUnitsLessonsModalProps {
  open: boolean;
  onClose: () => void;
  catalog: AdminCatalogData;
  onReload: () => Promise<void>;
  onToast: (msg: string) => void;
  canManageContent: boolean;
  isOwner?: boolean;
  initialTab?: UnitsLessonsModalTab;
  initialGradeId?: number;
  initialUnitId?: number;
  elevatedZIndex?: boolean;
}

export const AdminUnitsLessonsModal: React.FC<AdminUnitsLessonsModalProps> = ({
  open,
  onClose,
  catalog,
  onReload,
  onToast,
  canManageContent,
  isOwner = false,
  initialTab = 'units',
  initialGradeId = 0,
  initialUnitId = 0,
  elevatedZIndex = false,
}) => {
  const [activeTab, setActiveTab] = useState<UnitsLessonsModalTab>(initialTab);
  const [filterTrackId, setFilterTrackId] = useState<number>(0);
  const [filterGradeId, setFilterGradeId] = useState<number>(initialGradeId || 0);
  const [filterUnitId, setFilterUnitId] = useState<number>(initialUnitId || 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create Unit form state
  const [newUnitGradeId, setNewUnitGradeId] = useState<number>(
    initialGradeId || catalog.grades[0]?.id || 0,
  );
  const [newUnitTitle, setNewUnitTitle] = useState('');
  const [newUnitDescription, setNewUnitDescription] = useState('');
  const [creatingUnit, setCreatingUnit] = useState(false);

  // Edit Unit inline state
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [editUnitDraft, setEditUnitDraft] = useState({
    gradeId: 0,
    titleAr: '',
    descriptionAr: '',
    sortOrder: 0,
    isVisible: true,
  });
  const [savingUnitId, setSavingUnitId] = useState<number | null>(null);
  const [deleteUnitConfirmId, setDeleteUnitConfirmId] = useState<number | null>(null);
  const [deletingUnitId, setDeletingUnitId] = useState<number | null>(null);

  // Create Lesson form state
  const [newLessonUnitId, setNewLessonUnitId] = useState<number>(
    initialUnitId || catalog.units[0]?.id || 0,
  );
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [newLessonPdfTitle, setNewLessonPdfTitle] = useState('');
  const [creatingLesson, setCreatingLesson] = useState(false);

  // Edit Lesson inline state
  const [editingLessonId, setEditingLessonId] = useState<number | null>(null);
  const [editLessonDraft, setEditLessonDraft] = useState({
    unitId: 0,
    titleAr: '',
    descriptionAr: '',
    pdfTitleAr: '',
    sortOrder: 0,
    isVisible: true,
  });
  const [savingLessonId, setSavingLessonId] = useState<number | null>(null);
  const [deleteLessonConfirmId, setDeleteLessonConfirmId] = useState<number | null>(null);
  const [deletingLessonId, setDeletingLessonId] = useState<number | null>(null);

  const gradeById = useMemo(() => new Map(catalog.grades.map((g) => [g.id, g])), [catalog.grades]);
  const wasOpenRef = useRef(false);

  // Sync defaults ONLY when modal transitions from closed -> open (never on catalog reload while open)
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    setActiveTab(initialTab);
    setFeedback(null);
    setEditingUnitId(null);
    setDeleteUnitConfirmId(null);
    setEditingLessonId(null);
    setDeleteLessonConfirmId(null);
    setSearchQuery('');

    const defaultGrade = initialGradeId || catalog.grades[0]?.id || 0;
    setFilterGradeId(initialGradeId || 0);
    setFilterTrackId(0);
    setFilterUnitId(initialUnitId || 0);
    setNewUnitGradeId(defaultGrade);

    const matchingUnit =
      (initialUnitId && catalog.units.find((u) => u.id === initialUnitId)?.id) ||
      (initialGradeId && catalog.units.find((u) => u.gradeId === initialGradeId)?.id) ||
      catalog.units[0]?.id ||
      0;
    setNewLessonUnitId(matchingUnit);
  }, [open, initialTab, initialGradeId, initialUnitId, catalog.grades, catalog.units]);

  // Keep form selectors valid if catalog updates while modal is open
  useEffect(() => {
    if (!open) return;
    if (catalog.grades.length > 0 && !catalog.grades.some((g) => g.id === newUnitGradeId)) {
      setNewUnitGradeId(filterGradeId || catalog.grades[0].id);
    }
  }, [open, catalog.grades, newUnitGradeId, filterGradeId]);

  useEffect(() => {
    if (!open) return;
    if (catalog.units.length > 0 && !catalog.units.some((u) => u.id === newLessonUnitId)) {
      const nextUnit =
        (filterUnitId && catalog.units.find((u) => u.id === filterUnitId)?.id) ||
        (filterGradeId && catalog.units.find((u) => u.gradeId === filterGradeId)?.id) ||
        catalog.units[0].id;
      setNewLessonUnitId(nextUnit);
    }
  }, [open, catalog.units, newLessonUnitId, filterGradeId, filterUnitId]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const filteredGrades = useMemo(
    () => (filterTrackId ? catalog.grades.filter((g) => g.trackId === filterTrackId) : catalog.grades),
    [catalog.grades, filterTrackId],
  );

  const filteredUnitsForSelect = useMemo(() => {
    return catalog.units.filter((u) => {
      const g = gradeById.get(u.gradeId);
      if (filterTrackId && g?.trackId !== filterTrackId) return false;
      if (filterGradeId && u.gradeId !== filterGradeId) return false;
      return true;
    });
  }, [catalog.units, filterTrackId, filterGradeId, gradeById]);

  const enrichedUnits = useMemo(
    () =>
      filterAndEnrichUnits({
        tracks: catalog.tracks,
        grades: catalog.grades,
        units: catalog.units,
        lessons: catalog.lessons,
        videos: catalog.videos,
        trackId: filterTrackId || undefined,
        gradeId: filterGradeId || undefined,
        searchQuery,
      }),
    [
      catalog.tracks,
      catalog.grades,
      catalog.units,
      catalog.lessons,
      catalog.videos,
      filterTrackId,
      filterGradeId,
      searchQuery,
    ],
  );

  const enrichedLessons = useMemo(
    () =>
      filterAndEnrichLessons({
        grades: catalog.grades,
        units: catalog.units,
        lessons: catalog.lessons,
        videos: catalog.videos,
        trackId: filterTrackId || undefined,
        gradeId: filterGradeId || undefined,
        unitId: filterUnitId || undefined,
        searchQuery,
      }),
    [
      catalog.grades,
      catalog.units,
      catalog.lessons,
      catalog.videos,
      filterTrackId,
      filterGradeId,
      filterUnitId,
      searchQuery,
    ],
  );

  if (!open) return null;

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const check = validateUnitInput({
      gradeId: newUnitGradeId,
      titleAr: newUnitTitle,
      descriptionAr: newUnitDescription,
    });
    if (!check.valid) {
      setFeedback({ type: 'error', text: check.errorAr || 'بيانات الوحدة غير مكتملة' });
      return;
    }

    setCreatingUnit(true);
    try {
      const res = await apiRequest<{ unit: { id: number; titleAr: string } }>('/api/admin/units', {
        method: 'POST',
        body: JSON.stringify({
          gradeId: newUnitGradeId,
          titleAr: check.normalizedTitleAr,
          descriptionAr: check.normalizedDescriptionAr,
        }),
      });
      setNewUnitTitle('');
      setNewUnitDescription('');
      if (res.unit?.id) {
        setNewLessonUnitId(res.unit.id);
      }
      const msg = `تمت إضافة الوحدة «${res.unit?.titleAr || check.normalizedTitleAr}» بنجاح`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setCreatingUnit(false);
    }
  };

  const startEditUnit = (unit: AdminCatalogData['units'][number]) => {
    setFeedback(null);
    setDeleteUnitConfirmId(null);
    setEditingUnitId(unit.id);
    setEditUnitDraft({
      gradeId: unit.gradeId,
      titleAr: unit.titleAr,
      descriptionAr: unit.descriptionAr || '',
      sortOrder: unit.sortOrder ?? 0,
      isVisible: unit.isVisible !== false,
    });
  };

  const handleSaveUnitEdit = async (unitId: number) => {
    setFeedback(null);
    const check = validateUnitInput({
      gradeId: editUnitDraft.gradeId,
      titleAr: editUnitDraft.titleAr,
      descriptionAr: editUnitDraft.descriptionAr,
    });
    if (!check.valid) {
      setFeedback({ type: 'error', text: check.errorAr || 'بيانات تعديل الوحدة غير صالحة' });
      return;
    }

    setSavingUnitId(unitId);
    try {
      await apiRequest(`/api/admin/units/${unitId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          gradeId: editUnitDraft.gradeId,
          titleAr: check.normalizedTitleAr,
          descriptionAr: check.normalizedDescriptionAr,
          sortOrder: Math.max(0, Number(editUnitDraft.sortOrder) || 0),
          isVisible: editUnitDraft.isVisible,
        }),
      });
      setEditingUnitId(null);
      const msg = `تم تحديث الوحدة «${check.normalizedTitleAr}» بنجاح`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingUnitId(null);
    }
  };

  const handleToggleUnitVisibility = async (unit: CurriculumUnitRecord) => {
    setFeedback(null);
    const nextVisible = unit.isVisible === false;
    setSavingUnitId(unit.id);
    try {
      await apiRequest(`/api/admin/units/${unit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isVisible: nextVisible }),
      });
      const msg = nextVisible
        ? `تم إظهار الوحدة «${unit.titleAr}» للطلاب`
        : `تم إخفاء الوحدة «${unit.titleAr}» مؤقتًا`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingUnitId(null);
    }
  };

  const handleConfirmDeleteUnit = async (unit: CurriculumUnitRecord) => {
    setFeedback(null);
    setDeletingUnitId(unit.id);
    try {
      await apiRequest(`/api/admin/units/${unit.id}`, { method: 'DELETE' });
      setDeleteUnitConfirmId(null);
      if (filterUnitId === unit.id) setFilterUnitId(0);
      const msg = `تم حذف الوحدة «${unit.titleAr}» بنجاح`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setDeletingUnitId(null);
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const check = validateLessonInput({
      unitId: newLessonUnitId,
      titleAr: newLessonTitle,
      pdfTitleAr: newLessonPdfTitle,
    });
    if (!check.valid) {
      setFeedback({ type: 'error', text: check.errorAr || 'بيانات الدرس غير مكتملة' });
      return;
    }

    setCreatingLesson(true);
    try {
      const res = await apiRequest<{ lesson: { id: number; titleAr: string } }>('/api/admin/lessons', {
        method: 'POST',
        body: JSON.stringify({
          unitId: newLessonUnitId,
          titleAr: check.normalizedTitleAr,
          pdfTitleAr: check.normalizedPdfTitleAr,
        }),
      });
      setNewLessonTitle('');
      setNewLessonPdfTitle('');
      const msg = `تمت إضافة الدرس «${res.lesson?.titleAr || check.normalizedTitleAr}» بنجاح`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setCreatingLesson(false);
    }
  };

  const startEditLesson = (lesson: CurriculumLessonRecord) => {
    setFeedback(null);
    setDeleteLessonConfirmId(null);
    setEditingLessonId(lesson.id);
    setEditLessonDraft({
      unitId: lesson.unitId,
      titleAr: lesson.titleAr,
      descriptionAr: lesson.descriptionAr || '',
      pdfTitleAr: lesson.pdfTitleAr || '',
      sortOrder: lesson.sortOrder ?? 0,
      isVisible: lesson.isVisible !== false,
    });
  };

  const handleSaveLessonEdit = async (lessonId: number) => {
    setFeedback(null);
    const check = validateLessonInput({
      unitId: editLessonDraft.unitId,
      titleAr: editLessonDraft.titleAr,
      descriptionAr: editLessonDraft.descriptionAr,
      pdfTitleAr: editLessonDraft.pdfTitleAr,
    });
    if (!check.valid) {
      setFeedback({ type: 'error', text: check.errorAr || 'بيانات تعديل الدرس غير صالحة' });
      return;
    }

    setSavingLessonId(lessonId);
    try {
      await apiRequest(`/api/admin/lessons/${lessonId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          unitId: editLessonDraft.unitId,
          titleAr: check.normalizedTitleAr,
          descriptionAr: check.normalizedDescriptionAr,
          pdfTitleAr: check.normalizedPdfTitleAr,
          sortOrder: Math.max(0, Number(editLessonDraft.sortOrder) || 0),
          isVisible: editLessonDraft.isVisible,
        }),
      });
      setEditingLessonId(null);
      const msg = `تم تحديث الدرس «${check.normalizedTitleAr}» بنجاح`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingLessonId(null);
    }
  };

  const handleToggleLessonVisibility = async (lesson: CurriculumLessonRecord) => {
    setFeedback(null);
    const nextVisible = lesson.isVisible === false;
    setSavingLessonId(lesson.id);
    try {
      await apiRequest(`/api/admin/lessons/${lesson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isVisible: nextVisible }),
      });
      const msg = nextVisible
        ? `تم إظهار الدرس «${lesson.titleAr}» للطلاب`
        : `تم إخفاء الدرس «${lesson.titleAr}» مؤقتًا`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingLessonId(null);
    }
  };

  const handleConfirmDeleteLesson = async (lesson: CurriculumLessonRecord) => {
    setFeedback(null);
    setDeletingLessonId(lesson.id);
    try {
      await apiRequest(`/api/admin/lessons/${lesson.id}`, { method: 'DELETE' });
      setDeleteLessonConfirmId(null);
      const msg = `تم حذف الدرس «${lesson.titleAr}» بنجاح`;
      setFeedback({ type: 'success', text: msg });
      onToast(msg);
      await onReload();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setDeletingLessonId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="إدارة الوحدات والدروس"
      data-testid="units-lessons-modal"
      dir="rtl"
      className={`fixed inset-0 ${elevatedZIndex ? 'z-[60]' : 'z-50'} flex items-center justify-center bg-slate-950/60 p-3 sm:p-5`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[#2563EB]">
              <Layers className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold text-[#0F172A] sm:text-lg">
                إدارة الوحدات والدروس
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {isOwner
                  ? 'صلاحيات المدرس الكاملة مفعّلة — إضافة وتعديل وحذف وترتيب وإخفاء الوحدات والدروس لكل صف دراسي.'
                  : 'إضافة وتعديل وحذف الوحدات الدراسية والدروس وربطها بالصفوف والفيديوهات.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة الوحدات والدروس"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Segmented Tabs + Quick Filters */}
        <div className="space-y-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div
              role="tablist"
              aria-label="أقسام إدارة المنهج"
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'units'}
                data-testid="tab-manage-units"
                onClick={() => {
                  setActiveTab('units');
                  setFeedback(null);
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-extrabold transition-colors ${
                  activeTab === 'units'
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>الوحدات الدراسية</span>
                <span
                  className={`font-mono-num tabular-nums text-[11px] ${
                    activeTab === 'units' ? 'text-blue-100' : 'text-slate-400'
                  }`}
                >
                  ({catalog.units.length})
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'lessons'}
                data-testid="tab-manage-lessons"
                onClick={() => {
                  setActiveTab('lessons');
                  setFeedback(null);
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-extrabold transition-colors ${
                  activeTab === 'lessons'
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>الدروس</span>
                <span
                  className={`font-mono-num tabular-nums text-[11px] ${
                    activeTab === 'lessons' ? 'text-blue-100' : 'text-slate-400'
                  }`}
                >
                  ({catalog.lessons.length})
                </span>
              </button>
            </div>

            <div className="text-xs text-slate-500">
              <span className="font-mono-num tabular-nums font-bold text-[#0F172A]">
                {activeTab === 'units' ? enrichedUnits.length : enrichedLessons.length}
              </span>{' '}
              {activeTab === 'units' ? 'وحدة معروضة' : 'درس معروض'}
            </div>
          </div>

          {/* Filter Row */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                aria-label="بحث في الوحدات والدروس"
                placeholder={activeTab === 'units' ? 'ابحث باسم الوحدة...' : 'ابحث باسم الدرس أو الوحدة...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pr-9 pl-3 text-xs text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
              />
            </div>

            <select
              aria-label="تصفية حسب المسار"
              value={filterTrackId}
              onChange={(e) => {
                const nextTrack = Number(e.target.value);
                setFilterTrackId(nextTrack);
                setFilterGradeId(0);
                setFilterUnitId(0);
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-[#2563EB] focus:outline-none"
            >
              <option value={0}>كل المسارات</option>
              {catalog.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr}
                </option>
              ))}
            </select>

            <select
              aria-label="تصفية حسب الصف الدراسي"
              value={filterGradeId}
              onChange={(e) => {
                const nextGrade = Number(e.target.value);
                setFilterGradeId(nextGrade);
                setFilterUnitId(0);
                if (nextGrade > 0) setNewUnitGradeId(nextGrade);
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-[#2563EB] focus:outline-none"
            >
              <option value={0}>كل الصفوف</option>
              {filteredGrades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameAr}
                </option>
              ))}
            </select>

            {activeTab === 'lessons' ? (
              <select
                aria-label="تصفية حسب الوحدة"
                value={filterUnitId}
                onChange={(e) => {
                  const nextUnit = Number(e.target.value);
                  setFilterUnitId(nextUnit);
                  if (nextUnit > 0) setNewLessonUnitId(nextUnit);
                }}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-[#2563EB] focus:outline-none"
              >
                <option value={0}>كل الوحدات</option>
                {filteredUnitsForSelect.map((u) => {
                  const g = gradeById.get(u.gradeId);
                  return (
                    <option key={u.id} value={u.id}>
                      {u.titleAr}
                      {g ? ` — ${g.nameAr}` : ''}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div className="hidden items-center justify-end text-[11px] text-slate-500 lg:flex">
                <span>اضغط على أي وحدة لتعديل اسمها أو إدارتها</span>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 sm:px-6">
          {feedback && (
            <div
              role={feedback.type === 'error' ? 'alert' : 'status'}
              data-testid="units-lessons-feedback"
              className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold ${
                feedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              <span>{feedback.text}</span>
              <button
                type="button"
                aria-label="إغلاق الرسالة"
                onClick={() => setFeedback(null)}
                className="rounded-lg p-1 hover:bg-black/5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {!canManageContent && (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900"
            >
              حسابك الحالي لا يملك صلاحية تعديل الوحدات والدروس. يرجى استخدام حساب المدرس الرئيسي أو طلب صلاحية إدارة المحتوى.
            </div>
          )}

          {/* TAB 1: UNITS */}
          {activeTab === 'units' && (
            <div className="space-y-4">
              {canManageContent && (
                <form
                  onSubmit={handleCreateUnit}
                  data-testid="create-unit-form"
                  className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-3"
                >
                  <div className="flex items-center gap-2 text-xs font-extrabold text-[#0F172A]">
                    <FolderPlus className="h-4 w-4 text-[#2563EB]" />
                    <span>إضافة وحدة دراسية جديدة</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <label htmlFor="new-unit-grade" className="mb-1 block text-[11px] font-bold text-slate-700">
                        الصف الدراسي *
                      </label>
                      <select
                        id="new-unit-grade"
                        value={newUnitGradeId}
                        onChange={(e) => setNewUnitGradeId(Number(e.target.value))}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                      >
                        {catalog.grades.length === 0 ? (
                          <option value={0}>لا توجد صفوف مسجلة</option>
                        ) : (
                          catalog.grades.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.nameAr}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <div className="sm:col-span-5">
                      <label htmlFor="new-unit-title" className="mb-1 block text-[11px] font-bold text-slate-700">
                        اسم الوحدة الدراسية *
                      </label>
                      <input
                        id="new-unit-title"
                        type="text"
                        required
                        placeholder="مثال: الوحدة الأولى — التيار الكهربي وقانون أوم"
                        value={newUnitTitle}
                        onChange={(e) => setNewUnitTitle(e.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div className="flex items-end sm:col-span-3">
                      <button
                        type="submit"
                        disabled={creatingUnit || catalog.grades.length === 0}
                        data-testid="submit-create-unit-btn"
                        className="inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[#2563EB] px-4 text-xs font-extrabold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] disabled:opacity-55"
                      >
                        {creatingUnit ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        <span>{creatingUnit ? 'جارٍ الإضافة...' : 'إضافة الوحدة'}</span>
                      </button>
                    </div>
                    <div className="sm:col-span-12">
                      <input
                        type="text"
                        aria-label="وصف مختصر للوحدة (اختياري)"
                        placeholder="وصف مختصر للوحدة يظهر للتنظيم (اختياري)..."
                        value={newUnitDescription}
                        onChange={(e) => setNewUnitDescription(e.target.value)}
                        className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  </div>
                </form>
              )}

              {/* Units List */}
              {enrichedUnits.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center">
                  <Layers className="mx-auto h-7 w-7 text-slate-400" />
                  <p className="mt-2 text-sm font-bold text-[#0F172A]">لا توجد وحدات مطابقة حاليًا</p>
                  <p className="mt-1 text-xs text-slate-500">
                    أضف أول وحدة دراسية من النموذج بالأعلى أو امسح خيارات البحث لعرض جميع الوحدات.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200/80 rounded-xl border border-slate-200 bg-white" data-testid="units-manage-list">
                  {enrichedUnits.map(({ unit, gradeNameAr, lessonsCount, videosCount }) => {
                    const isEditing = editingUnitId === unit.id;
                    const isConfirmingDelete = deleteUnitConfirmId === unit.id;
                    const isVisible = unit.isVisible !== false;
                    const impact = isConfirmingDelete
                      ? computeUnitDeleteImpact(unit.id, catalog.lessons, catalog.videos)
                      : null;

                    return (
                      <div key={unit.id} className="p-3.5 sm:p-4" data-testid={`unit-row-${unit.id}`}>
                        {isEditing ? (
                          <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3.5">
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                              <div className="sm:col-span-5">
                                <label
                                  htmlFor={`edit-unit-title-${unit.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  اسم الوحدة *
                                </label>
                                <input
                                  id={`edit-unit-title-${unit.id}`}
                                  type="text"
                                  value={editUnitDraft.titleAr}
                                  onChange={(e) =>
                                    setEditUnitDraft((prev) => ({ ...prev, titleAr: e.target.value }))
                                  }
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                                />
                              </div>
                              <div className="sm:col-span-4">
                                <label
                                  htmlFor={`edit-unit-grade-${unit.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  الصف الدراسي
                                </label>
                                <select
                                  id={`edit-unit-grade-${unit.id}`}
                                  value={editUnitDraft.gradeId}
                                  onChange={(e) =>
                                    setEditUnitDraft((prev) => ({
                                      ...prev,
                                      gradeId: Number(e.target.value),
                                    }))
                                  }
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0F172A]"
                                >
                                  {catalog.grades.map((g) => (
                                    <option key={g.id} value={g.id}>
                                      {g.nameAr}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="sm:col-span-3">
                                <label
                                  htmlFor={`edit-unit-order-${unit.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  الترتيب
                                </label>
                                <input
                                  id={`edit-unit-order-${unit.id}`}
                                  type="number"
                                  min={0}
                                  value={editUnitDraft.sortOrder}
                                  onChange={(e) =>
                                    setEditUnitDraft((prev) => ({
                                      ...prev,
                                      sortOrder: Number(e.target.value),
                                    }))
                                  }
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono-num text-xs tabular-nums text-[#0F172A]"
                                />
                              </div>
                              <div className="sm:col-span-12">
                                <label
                                  htmlFor={`edit-unit-desc-${unit.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  وصف الوحدة (اختياري)
                                </label>
                                <input
                                  id={`edit-unit-desc-${unit.id}`}
                                  type="text"
                                  value={editUnitDraft.descriptionAr}
                                  onChange={(e) =>
                                    setEditUnitDraft((prev) => ({
                                      ...prev,
                                      descriptionAr: e.target.value,
                                    }))
                                  }
                                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs text-slate-700"
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={editUnitDraft.isVisible}
                                  onChange={(e) =>
                                    setEditUnitDraft((prev) => ({
                                      ...prev,
                                      isVisible: e.target.checked,
                                    }))
                                  }
                                  className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                                />
                                <span>ظاهرة للطلاب في المنصة</span>
                              </label>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingUnitId(null)}
                                  className="h-9 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  إلغاء
                                </button>
                                <button
                                  type="button"
                                  disabled={savingUnitId === unit.id}
                                  data-testid={`save-unit-edit-${unit.id}`}
                                  onClick={() => void handleSaveUnitEdit(unit.id)}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                                >
                                  {savingUnitId === unit.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" />
                                  )}
                                  <span>حفظ التعديلات</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="font-mono-num text-[11px] font-bold text-slate-400 tabular-nums">
                                    #{unit.sortOrder ?? 0}
                                  </span>
                                  <h4 className="text-sm font-extrabold text-[#0F172A]">
                                    {unit.titleAr}
                                  </h4>
                                  <span
                                    className={`text-[11px] font-bold ${
                                      isVisible ? 'text-emerald-700' : 'text-amber-700'
                                    }`}
                                  >
                                    {isVisible ? '· ظاهرة' : '· مخفية'}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                                  <span className="font-semibold text-slate-600">{gradeNameAr}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono-num tabular-nums">{lessonsCount} دروس</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono-num tabular-nums">{videosCount} فيديوهات</span>
                                </div>
                                {unit.descriptionAr && (
                                  <p className="mt-1 text-xs text-slate-500">{unit.descriptionAr}</p>
                                )}
                              </div>

                              {canManageContent && (
                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    aria-label={`إدارة دروس الوحدة "${unit.titleAr}"`}
                                    onClick={() => {
                                      setFilterGradeId(unit.gradeId);
                                      setFilterUnitId(unit.id);
                                      setNewLessonUnitId(unit.id);
                                      setActiveTab('lessons');
                                      setFeedback(null);
                                    }}
                                    className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-xl border border-blue-200 bg-blue-50/70 px-3 text-xs font-bold text-[#2563EB] transition-colors hover:bg-blue-100"
                                  >
                                    <BookOpen className="h-3.5 w-3.5" />
                                    <span>الدروس</span>
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`تعديل الوحدة "${unit.titleAr}"`}
                                    data-testid={`edit-unit-btn-${unit.id}`}
                                    onClick={() => startEditUnit(unit)}
                                    className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    <span>تعديل</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingUnitId === unit.id}
                                    aria-label={
                                      isVisible
                                        ? `إخفاء الوحدة "${unit.titleAr}"`
                                        : `إظهار الوحدة "${unit.titleAr}"`
                                    }
                                    onClick={() => void handleToggleUnitVisibility(unit)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                                    title={isVisible ? 'إخفاء الوحدة عن الطلاب' : 'إظهار الوحدة للطلاب'}
                                  >
                                    {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`حذف الوحدة "${unit.titleAr}"`}
                                    data-testid={`delete-unit-btn-${unit.id}`}
                                    onClick={() => {
                                      setEditingUnitId(null);
                                      setDeleteUnitConfirmId((prev) => (prev === unit.id ? null : unit.id));
                                    }}
                                    className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    <span>حذف</span>
                                  </button>
                                </div>
                              )}
                            </div>

                            {isConfirmingDelete && impact && (
                              <div
                                role="alert"
                                className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex items-start gap-2 text-xs text-rose-900">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                                  <div>
                                    <div className="font-extrabold">
                                      تأكيد حذف الوحدة «{unit.titleAr}»
                                    </div>
                                    <p className="mt-0.5 leading-relaxed text-rose-800">{impact.warningAr}</p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-end gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setDeleteUnitConfirmId(null)}
                                    className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                  >
                                    إلغاء
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingUnitId === unit.id}
                                    data-testid={`confirm-delete-unit-${unit.id}`}
                                    onClick={() => void handleConfirmDeleteUnit(unit)}
                                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-60"
                                  >
                                    {deletingUnitId === unit.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                    <span>تأكيد الحذف</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LESSONS */}
          {activeTab === 'lessons' && (
            <div className="space-y-4">
              {canManageContent && (
                <form
                  onSubmit={handleCreateLesson}
                  data-testid="create-lesson-form"
                  className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-3"
                >
                  <div className="flex items-center gap-2 text-xs font-extrabold text-[#0F172A]">
                    <BookOpen className="h-4 w-4 text-[#2563EB]" />
                    <span>إضافة درس جديد داخل وحدة</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <label htmlFor="new-lesson-unit" className="mb-1 block text-[11px] font-bold text-slate-700">
                        الوحدة الدراسية *
                      </label>
                      <select
                        id="new-lesson-unit"
                        value={newLessonUnitId}
                        onChange={(e) => setNewLessonUnitId(Number(e.target.value))}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                      >
                        {catalog.units.length === 0 ? (
                          <option value={0}>أضف وحدة أولاً من تبويب الوحدات</option>
                        ) : (
                          catalog.units.map((u) => {
                            const g = gradeById.get(u.gradeId);
                            return (
                              <option key={u.id} value={u.id}>
                                {u.titleAr}
                                {g ? ` — ${g.nameAr}` : ''}
                              </option>
                            );
                          })
                        )}
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label htmlFor="new-lesson-title" className="mb-1 block text-[11px] font-bold text-slate-700">
                        اسم الدرس *
                      </label>
                      <input
                        id="new-lesson-title"
                        type="text"
                        required
                        placeholder="مثال: الدرس الأول — شدة التيار وفرق الجهد"
                        value={newLessonTitle}
                        onChange={(e) => setNewLessonTitle(e.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label htmlFor="new-lesson-pdf" className="mb-1 block text-[11px] font-bold text-slate-700">
                        عنوان مذكرة PDF (اختياري)
                      </label>
                      <input
                        id="new-lesson-pdf"
                        type="text"
                        placeholder="مثال: مذكرة شرح ومسائل الدرس"
                        value={newLessonPdfTitle}
                        onChange={(e) => setNewLessonPdfTitle(e.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div className="flex justify-end sm:col-span-12">
                      <button
                        type="submit"
                        disabled={creatingLesson || catalog.units.length === 0}
                        data-testid="submit-create-lesson-btn"
                        className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[#2563EB] px-5 text-xs font-extrabold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] disabled:opacity-55"
                      >
                        {creatingLesson ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        <span>{creatingLesson ? 'جارٍ الإضافة...' : 'إضافة الدرس'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Lessons List */}
              {enrichedLessons.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center">
                  <BookOpen className="mx-auto h-7 w-7 text-slate-400" />
                  <p className="mt-2 text-sm font-bold text-[#0F172A]">لا توجد دروس مطابقة حاليًا</p>
                  <p className="mt-1 text-xs text-slate-500">
                    أضف درسًا جديدًا للوحدة المختارة من النموذج بالأعلى أو غيّر التصفية لعرض باقي الدروس.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200/80 rounded-xl border border-slate-200 bg-white" data-testid="lessons-manage-list">
                  {enrichedLessons.map(({ lesson, unitTitleAr, gradeNameAr, videosCount }) => {
                    const isEditing = editingLessonId === lesson.id;
                    const isConfirmingDelete = deleteLessonConfirmId === lesson.id;
                    const isVisible = lesson.isVisible !== false;
                    const impact = isConfirmingDelete
                      ? computeLessonDeleteImpact(lesson.id, catalog.videos)
                      : null;

                    return (
                      <div key={lesson.id} className="p-3.5 sm:p-4" data-testid={`lesson-row-${lesson.id}`}>
                        {isEditing ? (
                          <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3.5">
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                              <div className="sm:col-span-5">
                                <label
                                  htmlFor={`edit-lesson-title-${lesson.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  اسم الدرس *
                                </label>
                                <input
                                  id={`edit-lesson-title-${lesson.id}`}
                                  type="text"
                                  value={editLessonDraft.titleAr}
                                  onChange={(e) =>
                                    setEditLessonDraft((prev) => ({
                                      ...prev,
                                      titleAr: e.target.value,
                                    }))
                                  }
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                                />
                              </div>
                              <div className="sm:col-span-5">
                                <label
                                  htmlFor={`edit-lesson-unit-${lesson.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  الوحدة الدراسية
                                </label>
                                <select
                                  id={`edit-lesson-unit-${lesson.id}`}
                                  value={editLessonDraft.unitId}
                                  onChange={(e) =>
                                    setEditLessonDraft((prev) => ({
                                      ...prev,
                                      unitId: Number(e.target.value),
                                    }))
                                  }
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0F172A]"
                                >
                                  {catalog.units.map((u) => {
                                    const g = gradeById.get(u.gradeId);
                                    return (
                                      <option key={u.id} value={u.id}>
                                        {u.titleAr}
                                        {g ? ` — ${g.nameAr}` : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                              <div className="sm:col-span-2">
                                <label
                                  htmlFor={`edit-lesson-order-${lesson.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  الترتيب
                                </label>
                                <input
                                  id={`edit-lesson-order-${lesson.id}`}
                                  type="number"
                                  min={0}
                                  value={editLessonDraft.sortOrder}
                                  onChange={(e) =>
                                    setEditLessonDraft((prev) => ({
                                      ...prev,
                                      sortOrder: Number(e.target.value),
                                    }))
                                  }
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono-num text-xs tabular-nums text-[#0F172A]"
                                />
                              </div>
                              <div className="sm:col-span-6">
                                <label
                                  htmlFor={`edit-lesson-pdf-${lesson.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  عنوان مذكرة PDF (اختياري)
                                </label>
                                <input
                                  id={`edit-lesson-pdf-${lesson.id}`}
                                  type="text"
                                  value={editLessonDraft.pdfTitleAr}
                                  onChange={(e) =>
                                    setEditLessonDraft((prev) => ({
                                      ...prev,
                                      pdfTitleAr: e.target.value,
                                    }))
                                  }
                                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs text-slate-700"
                                />
                              </div>
                              <div className="sm:col-span-6">
                                <label
                                  htmlFor={`edit-lesson-desc-${lesson.id}`}
                                  className="mb-1 block text-[11px] font-bold text-slate-700"
                                >
                                  وصف الدرس (اختياري)
                                </label>
                                <input
                                  id={`edit-lesson-desc-${lesson.id}`}
                                  type="text"
                                  value={editLessonDraft.descriptionAr}
                                  onChange={(e) =>
                                    setEditLessonDraft((prev) => ({
                                      ...prev,
                                      descriptionAr: e.target.value,
                                    }))
                                  }
                                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs text-slate-700"
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={editLessonDraft.isVisible}
                                  onChange={(e) =>
                                    setEditLessonDraft((prev) => ({
                                      ...prev,
                                      isVisible: e.target.checked,
                                    }))
                                  }
                                  className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                                />
                                <span>ظاهر للطلاب في المنصة</span>
                              </label>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingLessonId(null)}
                                  className="h-9 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  إلغاء
                                </button>
                                <button
                                  type="button"
                                  disabled={savingLessonId === lesson.id}
                                  data-testid={`save-lesson-edit-${lesson.id}`}
                                  onClick={() => void handleSaveLessonEdit(lesson.id)}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                                >
                                  {savingLessonId === lesson.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" />
                                  )}
                                  <span>حفظ التعديلات</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="font-mono-num text-[11px] font-bold text-slate-400 tabular-nums">
                                    #{lesson.sortOrder ?? 0}
                                  </span>
                                  <h4 className="text-sm font-extrabold text-[#0F172A]">
                                    {lesson.titleAr}
                                  </h4>
                                  <span
                                    className={`text-[11px] font-bold ${
                                      isVisible ? 'text-emerald-700' : 'text-amber-700'
                                    }`}
                                  >
                                    {isVisible ? '· ظاهر' : '· مخفي'}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                                  <span className="font-semibold text-slate-600">{unitTitleAr}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{gradeNameAr}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono-num tabular-nums">{videosCount} فيديوهات</span>
                                  {lesson.pdfTitleAr && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-rose-700">مذكرة: {lesson.pdfTitleAr}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {canManageContent && (
                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    aria-label={`تعديل الدرس "${lesson.titleAr}"`}
                                    data-testid={`edit-lesson-btn-${lesson.id}`}
                                    onClick={() => startEditLesson(lesson)}
                                    className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    <span>تعديل</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingLessonId === lesson.id}
                                    aria-label={
                                      isVisible
                                        ? `إخفاء الدرس "${lesson.titleAr}"`
                                        : `إظهار الدرس "${lesson.titleAr}"`
                                    }
                                    onClick={() => void handleToggleLessonVisibility(lesson)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                                    title={isVisible ? 'إخفاء الدرس عن الطلاب' : 'إظهار الدرس للطلاب'}
                                  >
                                    {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`حذف الدرس "${lesson.titleAr}"`}
                                    data-testid={`delete-lesson-btn-${lesson.id}`}
                                    onClick={() => {
                                      setEditingLessonId(null);
                                      setDeleteLessonConfirmId((prev) =>
                                        prev === lesson.id ? null : lesson.id,
                                      );
                                    }}
                                    className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    <span>حذف</span>
                                  </button>
                                </div>
                              )}
                            </div>

                            {isConfirmingDelete && impact && (
                              <div
                                role="alert"
                                className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex items-start gap-2 text-xs text-rose-900">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                                  <div>
                                    <div className="font-extrabold">
                                      تأكيد حذف الدرس «{lesson.titleAr}»
                                    </div>
                                    <p className="mt-0.5 leading-relaxed text-rose-800">{impact.warningAr}</p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-end gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setDeleteLessonConfirmId(null)}
                                    className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                  >
                                    إلغاء
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingLessonId === lesson.id}
                                    data-testid={`confirm-delete-lesson-${lesson.id}`}
                                    onClick={() => void handleConfirmDeleteLesson(lesson)}
                                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-60"
                                  >
                                    {deletingLessonId === lesson.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                    <span>تأكيد الحذف</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-6">
          <div className="text-[11px] text-slate-500">
            يتم تحديث القوائم في إدارة الفيديوهات وصفحة الطلاب فور الحفظ.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
