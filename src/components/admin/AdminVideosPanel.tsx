import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FileX2,
  Filter,
  GripVertical,
  ImagePlus,
  KeyRound,
  Layers,
  LayoutGrid,
  List,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Unlock,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react';
import { apiRequest, formatDurationAr } from '../../lib/api.ts';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '../../lib/permissions.ts';
import { buildPrivacyEnhancedEmbedUrl, extractYouTubeVideoId } from '../../lib/youtube.ts';
import {
  buildGoogleDrivePreviewUrl,
  buildGoogleDriveViewUrl,
  extractGoogleDriveFileId,
} from '../../lib/googleDrive.ts';
import type { AuthUser } from '../../types/lms.ts';
import type { AdminCatalogData, AdminVideoRecord } from './AdminContentPanel.tsx';
import { AdminUnitsLessonsModal, type UnitsLessonsModalTab } from './AdminUnitsLessonsModal.tsx';
import { AdminVideoViewersModal } from './AdminVideoViewersModal.tsx';
import {
  AdminVideoAccessCodesModal,
  type VideoAccessModalTab,
} from './AdminVideoAccessCodesModal.tsx';
import {
  AdminActionMenu,
  AdminCard,
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminPageHeader,
  AdminSegmentedTabs,
  AdminStatusBadge,
  type AdminTone,
} from './AdminUiPrimitives.tsx';

interface AdminVideosPanelProps {
  catalog: AdminCatalogData;
  currentUser?: AuthUser;
  onReload: () => Promise<void>;
  onToast: (msg: string) => void;
  initialAction?: 'NONE' | 'CREATE';
  navigationNonce?: number;
}

type PublicationStatus = 'PUBLISHED' | 'DRAFT' | 'HIDDEN';
type VideoCategory = 'FREE' | 'PAID' | 'COURSE';

interface VideoFormState {
  titleAr: string;
  youtubeUrl: string;
  descriptionAr: string;
  trackId: number;
  gradeId: number;
  unitId: number;
  lessonId: number;
  videoType: VideoCategory;
  courseId: number | '';
  priceEgp: number;
  thumbnailUrl: string;
  sortOrder: number;
  publicationStatus: PublicationStatus;
  durationMin: number;
  pdfTitle: string;
  pdfDriveUrl: string;
  pdfDescription: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  FREE: 'فيديو مجاني',
  PAID: 'فيديو مدفوع',
  COURSE: 'فيديو ضمن كورس كامل',
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PUBLISHED: { label: 'منشور', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DRAFT: { label: 'مسودة', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  HIDDEN: { label: 'مخفي', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const AdminVideosPanel: React.FC<AdminVideosPanelProps> = ({
  catalog,
  currentUser,
  onReload,
  onToast,
  initialAction,
  navigationNonce,
}) => {
  // View switcher (Grid thumbnails vs Compact table — never renders both simultaneously)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTrackId, setFilterTrackId] = useState<number>(0);
  const [filterGradeId, setFilterGradeId] = useState<number>(0);
  const [filterUnitId, setFilterUnitId] = useState<number>(0);
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterPdf, setFilterPdf] = useState<'ALL' | 'WITH_PDF' | 'WITHOUT_PDF'>('ALL');

  // Dedicated Units & Lessons Management Modal state
  const [unitsModalOpen, setUnitsModalOpen] = useState(false);
  const [unitsModalTab, setUnitsModalTab] = useState<UnitsLessonsModalTab>('units');
  const [unitsModalGradeId, setUnitsModalGradeId] = useState<number>(0);
  const [unitsModalUnitId, setUnitsModalUnitId] = useState<number>(0);

  const canManageContent = currentUser
    ? hasPermission(currentUser, PERMISSIONS.CONTENT_MANAGE)
    : true;
  const canManageCodes = currentUser
    ? hasAnyPermission(currentUser, [PERMISSIONS.CODES_MANAGE, PERMISSIONS.CODES_VIEW])
    : true;
  const canManageSubscriptions = currentUser
    ? hasAnyPermission(currentUser, [
        PERMISSIONS.CONTENT_MANAGE,
        PERMISSIONS.STUDENT_ACCESS_GRANT,
        PERMISSIONS.STUDENT_ACCESS_REVOKE,
      ])
    : true;
  const isOwner = currentUser?.roleSlug === 'SUPER_ADMIN';

  const openUnitsLessonsModal = (
    tab: UnitsLessonsModalTab = 'units',
    gradeId = 0,
    unitId = 0,
  ) => {
    setUnitsModalTab(tab);
    setUnitsModalGradeId(gradeId);
    setUnitsModalUnitId(unitId);
    setUnitsModalOpen(true);
  };

  // Add/Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<AdminVideoRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [manualThumbEdited, setManualThumbEdited] = useState(false);
  const [thumbUploading, setThumbUploading] = useState(false);
  const [thumbUploadError, setThumbUploadError] = useState('');
  const thumbFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showFormPdfPreview, setShowFormPdfPreview] = useState(false);
  const [savingPdfOnly, setSavingPdfOnly] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const pdfSectionRef = useRef<HTMLDivElement | null>(null);
  const pdfUrlInputRef = useRef<HTMLInputElement | null>(null);

  // Preview, Viewers & Access/Codes Modals state
  const [previewVideo, setPreviewVideo] = useState<AdminVideoRecord | null>(null);
  const [pdfPreviewVideo, setPdfPreviewVideo] = useState<AdminVideoRecord | null>(null);
  const [viewersVideo, setViewersVideo] = useState<AdminVideoRecord | null>(null);
  const [accessModalVideo, setAccessModalVideo] = useState<AdminVideoRecord | null>(null);
  const [accessModalTab, setAccessModalTab] = useState<VideoAccessModalTab>('codes');

  // Delete Confirmation Modal state
  const [deleteTarget, setDeleteTarget] = useState<AdminVideoRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Remove PDF Only Confirmation Modal state
  const [removePdfTarget, setRemovePdfTarget] = useState<AdminVideoRecord | null>(null);
  const [removingPdf, setRemovingPdf] = useState(false);

  const openVideoAccessModal = (v: AdminVideoRecord, tab: VideoAccessModalTab) => {
    setAccessModalTab(tab);
    setAccessModalVideo(v);
  };

  // Upload custom thumbnail image from computer (resized safely to max 1280px wide)
  const handleThumbnailFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setThumbUploadError('');
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setThumbUploadError('يرجى اختيار صورة بصيغة PNG أو JPG أو WEBP أو GIF فقط.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setThumbUploadError('حجم الصورة يتجاوز 5 ميجابايت. يرجى اختيار صورة أصغر.');
      return;
    }

    setThumbUploading(true);
    try {
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة المحدد'));
        reader.readAsDataURL(file);
      });

      let finalDataUrl = rawDataUrl;
      // Downscale large non-GIF images on canvas so thumbnails stay crisp and lightweight
      if (file.type.toLowerCase() !== 'image/gif' && rawDataUrl.length > 350_000) {
        finalDataUrl = await new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              const maxW = 1280;
              const scale = img.width > maxW ? maxW / img.width : 1;
              const w = Math.max(1, Math.round(img.width * scale));
              const h = Math.max(1, Math.round(img.height * scale));
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                resolve(rawDataUrl);
                return;
              }
              ctx.drawImage(img, 0, 0, w, h);
              const compressed = canvas.toDataURL('image/jpeg', 0.85);
              resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
            } catch {
              resolve(rawDataUrl);
            }
          };
          img.onerror = () => resolve(rawDataUrl);
          img.src = rawDataUrl;
        });
      }

      if (finalDataUrl.length > 3_400_000) {
        setThumbUploadError('حجم الصورة كبير جدًا بعد المعالجة. يرجى اختيار صورة أصغر.');
        return;
      }

      setManualThumbEdited(true);
      setForm((prev) => ({ ...prev, thumbnailUrl: finalDataUrl }));
    } catch (err) {
      setThumbUploadError((err as Error).message || 'تعذر تحميل الصورة من الجهاز');
    } finally {
      setThumbUploading(false);
    }
  };

  // Drag-and-drop reorder state
  const [orderedVideos, setOrderedVideos] = useState<AdminVideoRecord[]>(catalog.videos);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    setOrderedVideos(catalog.videos);
  }, [catalog.videos]);

  // Lookup maps
  const trackById = useMemo(() => new Map(catalog.tracks.map((t) => [t.id, t])), [catalog.tracks]);
  const gradeById = useMemo(() => new Map(catalog.grades.map((g) => [g.id, g])), [catalog.grades]);
  const unitById = useMemo(() => new Map(catalog.units.map((u) => [u.id, u])), [catalog.units]);
  const lessonById = useMemo(() => new Map(catalog.lessons.map((l) => [l.id, l])), [catalog.lessons]);
  const courseById = useMemo(() => new Map(catalog.courses.map((c) => [c.id, c])), [catalog.courses]);

  const buildDefaultForm = (): VideoFormState => {
    const firstTrack = catalog.tracks[0];
    const firstGrade =
      catalog.grades.find((g) => g.trackId === firstTrack?.id) || catalog.grades[0];
    const firstUnit =
      catalog.units.find((u) => u.gradeId === firstGrade?.id) || catalog.units[0];
    const firstLesson =
      catalog.lessons.find((l) => l.unitId === firstUnit?.id) || catalog.lessons[0];
    return {
      titleAr: '',
      youtubeUrl: '',
      descriptionAr: '',
      trackId: firstTrack?.id || 0,
      gradeId: firstGrade?.id || 0,
      unitId: firstUnit?.id || 0,
      lessonId: firstLesson?.id || 0,
      videoType: 'FREE',
      courseId: '',
      priceEgp: 90,
      thumbnailUrl: '',
      sortOrder: catalog.videos.length + 1,
      publicationStatus: 'PUBLISHED',
      durationMin: 0,
      pdfTitle: '',
      pdfDriveUrl: '',
      pdfDescription: '',
    };
  };

  const [form, setForm] = useState<VideoFormState>(buildDefaultForm);

  // Live YouTube extraction for form
  const parsedYouTube = useMemo(() => {
    if (!form.youtubeUrl.trim()) return null;
    return extractYouTubeVideoId(form.youtubeUrl);
  }, [form.youtubeUrl]);

  // Live Google Drive PDF extraction for form
  const parsedDrive = useMemo(() => {
    if (!form.pdfDriveUrl.trim()) return null;
    return extractGoogleDriveFileId(form.pdfDriveUrl);
  }, [form.pdfDriveUrl]);

  // Auto-populate thumbnail when valid YouTube URL entered unless teacher manually edited thumbnail
  useEffect(() => {
    if (parsedYouTube?.valid && parsedYouTube.thumbnailUrl && !manualThumbEdited) {
      setForm((prev) =>
        prev.thumbnailUrl === parsedYouTube.thumbnailUrl
          ? prev
          : { ...prev, thumbnailUrl: parsedYouTube.thumbnailUrl || '' },
      );
    }
  }, [parsedYouTube, manualThumbEdited]);

  // Cascading dropdown lists inside the modal
  const formGrades = useMemo(
    () => catalog.grades.filter((g) => !form.trackId || g.trackId === form.trackId),
    [catalog.grades, form.trackId],
  );
  const formUnits = useMemo(
    () => catalog.units.filter((u) => !form.gradeId || u.gradeId === form.gradeId),
    [catalog.units, form.gradeId],
  );
  const formLessons = useMemo(
    () => catalog.lessons.filter((l) => !form.unitId || l.unitId === form.unitId),
    [catalog.lessons, form.unitId],
  );
  const formCourses = useMemo(
    () => catalog.courses.filter((c) => !form.gradeId || c.gradeId === form.gradeId),
    [catalog.courses, form.gradeId],
  );

  // Cascading filter dropdowns
  const filterGrades = useMemo(
    () => (filterTrackId ? catalog.grades.filter((g) => g.trackId === filterTrackId) : catalog.grades),
    [catalog.grades, filterTrackId],
  );
  const filterUnits = useMemo(
    () => (filterGradeId ? catalog.units.filter((u) => u.gradeId === filterGradeId) : catalog.units),
    [catalog.units, filterGradeId],
  );

  const openAddModal = () => {
    setEditingVideo(null);
    setManualThumbEdited(false);
    setThumbUploadError('');
    setShowFormPdfPreview(false);
    setPdfFeedback(null);
    setFormError('');
    setForm(buildDefaultForm());
    setModalOpen(true);
  };

  useEffect(() => {
    if (initialAction === 'CREATE') {
      openAddModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAction, navigationNonce]);

  const openEditModal = (v: AdminVideoRecord, focusPdf = false) => {
    const grade = gradeById.get(v.gradeId);
    const lesson = lessonById.get(v.lessonId);
    const trackId = v.trackId || grade?.trackId || catalog.tracks[0]?.id || 0;
    const unitId = v.unitId || lesson?.unitId || catalog.units.find((u) => u.gradeId === v.gradeId)?.id || 0;
    const status = (v.publicationStatus || (v.isPublished ? 'PUBLISHED' : 'HIDDEN')) as PublicationStatus;

    setEditingVideo(v);
    setManualThumbEdited(Boolean(v.thumbnailUrl && !v.thumbnailUrl.includes('ytimg.com')));
    setThumbUploadError('');
    setShowFormPdfPreview(false);
    setPdfFeedback(null);
    setFormError('');
    setForm({
      titleAr: v.titleAr,
      youtubeUrl: v.youtubeUrl || (v.youtubeVideoId ? `https://www.youtube.com/watch?v=${v.youtubeVideoId}` : ''),
      descriptionAr: v.descriptionAr || '',
      trackId,
      gradeId: v.gradeId,
      unitId,
      lessonId: v.lessonId,
      videoType: (v.videoType as VideoCategory) || 'FREE',
      courseId: v.courseId || '',
      priceEgp: v.priceEgp || 0,
      thumbnailUrl: v.thumbnailUrl || '',
      sortOrder: v.sortOrder || 0,
      publicationStatus: status,
      durationMin: v.durationSec ? Math.round(v.durationSec / 60) : 0,
      pdfTitle: v.pdfTitle || '',
      pdfDriveUrl:
        v.pdfDriveUrl ||
        (v.pdfDriveFileId ? buildGoogleDriveViewUrl(v.pdfDriveFileId) : ''),
      pdfDescription: v.pdfDescription || '',
    });
    setModalOpen(true);
    if (focusPdf) {
      window.setTimeout(() => {
        pdfSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pdfUrlInputRef.current?.focus();
      }, 120);
    }
  };

  const handleTrackChange = (newTrackId: number) => {
    const nextGrade = catalog.grades.find((g) => g.trackId === newTrackId);
    const nextUnit = nextGrade ? catalog.units.find((u) => u.gradeId === nextGrade.id) : undefined;
    const nextLesson = nextUnit ? catalog.lessons.find((l) => l.unitId === nextUnit.id) : undefined;
    const nextCourse = nextGrade ? catalog.courses.find((c) => c.gradeId === nextGrade.id) : undefined;
    setForm((prev) => ({
      ...prev,
      trackId: newTrackId,
      gradeId: nextGrade?.id || 0,
      unitId: nextUnit?.id || 0,
      lessonId: nextLesson?.id || 0,
      courseId: prev.videoType === 'COURSE' ? nextCourse?.id || '' : '',
    }));
  };

  const handleGradeChange = (newGradeId: number) => {
    const nextUnit = catalog.units.find((u) => u.gradeId === newGradeId);
    const nextLesson = nextUnit ? catalog.lessons.find((l) => l.unitId === nextUnit.id) : undefined;
    const nextCourse = catalog.courses.find((c) => c.gradeId === newGradeId);
    setForm((prev) => ({
      ...prev,
      gradeId: newGradeId,
      unitId: nextUnit?.id || 0,
      lessonId: nextLesson?.id || 0,
      courseId: prev.videoType === 'COURSE' ? nextCourse?.id || '' : '',
    }));
  };

  const handleUnitChange = (newUnitId: number) => {
    const nextLesson = catalog.lessons.find((l) => l.unitId === newUnitId);
    setForm((prev) => ({
      ...prev,
      unitId: newUnitId,
      lessonId: nextLesson?.id || 0,
    }));
  };

  const handleSaveVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const yt = extractYouTubeVideoId(form.youtubeUrl);
    if (!yt.valid || !yt.videoId) {
      setFormError(yt.errorAr || 'يرجى إدخال رابط يوتيوب صالح');
      return;
    }
    if (!form.titleAr.trim() || form.titleAr.trim().length < 2) {
      setFormError('يرجى إدخال عنوان الفيديو (حرفين على الأقل)');
      return;
    }
    if (!form.gradeId || !form.lessonId) {
      setFormError('يرجى اختيار الصف والوحدة والدرس التابع لهم الفيديو');
      return;
    }
    if (form.videoType === 'COURSE' && formCourses.length > 0 && !form.courseId) {
      setFormError('يرجى اختيار الكورس المرتبط بهذا الفيديو');
      return;
    }

    const trimmedPdfUrl = form.pdfDriveUrl.trim();
    if (trimmedPdfUrl) {
      const drive = extractGoogleDriveFileId(trimmedPdfUrl);
      if (!drive.valid || !drive.fileId) {
        setFormError(drive.errorAr || 'رابط ملف PDF على Google Drive غير صالح');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        titleAr: form.titleAr.trim(),
        youtubeUrl: form.youtubeUrl.trim(),
        descriptionAr: form.descriptionAr.trim(),
        trackId: form.trackId || null,
        gradeId: form.gradeId,
        unitId: form.unitId || null,
        lessonId: form.lessonId,
        videoType: form.videoType,
        courseId: form.courseId ? Number(form.courseId) : null,
        priceEgp: form.videoType === 'FREE' ? 0 : Math.max(0, Number(form.priceEgp) || 0),
        thumbnailUrl: form.thumbnailUrl.trim() || yt.thumbnailUrl || '',
        sortOrder: Math.max(0, Number(form.sortOrder) || 0),
        publicationStatus: form.publicationStatus,
        durationSec: Math.max(0, Math.round((Number(form.durationMin) || 0) * 60)),
        pdfDriveUrl: trimmedPdfUrl,
        pdfTitle: trimmedPdfUrl ? form.pdfTitle.trim() : '',
        pdfDescription: trimmedPdfUrl ? form.pdfDescription.trim() : '',
      };

      if (editingVideo) {
        await apiRequest(`/api/admin/videos/${editingVideo.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onToast('تم تحديث بيانات الفيديو بنجاح');
      } else {
        await apiRequest('/api/admin/videos', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast(
          form.publicationStatus === 'PUBLISHED'
            ? 'تمت إضافة الفيديو ونشره للطلاب بنجاح'
            : 'تم حفظ الفيديو في لوحة الإدارة بنجاح',
        );
      }

      setModalOpen(false);
      await onReload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatusChange = async (v: AdminVideoRecord, nextStatus: PublicationStatus) => {
    try {
      await apiRequest(`/api/admin/videos/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ publicationStatus: nextStatus }),
      });
      onToast(
        nextStatus === 'PUBLISHED'
          ? 'تم نشر الفيديو للطلاب'
          : nextStatus === 'DRAFT'
            ? 'تم تحويل الفيديو إلى مسودة'
            : 'تم إخفاء الفيديو مؤقتًا',
      );
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/admin/videos/${deleteTarget.id}`, { method: 'DELETE' });
      onToast(`تم حذف الفيديو "${deleteTarget.titleAr}" بأمان دون التأثير على بيانات الطلاب أو الامتحانات`);
      setDeleteTarget(null);
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmRemovePdf = async () => {
    if (!removePdfTarget) return;
    setRemovingPdf(true);
    try {
      await apiRequest(`/api/admin/videos/${removePdfTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ removePdf: true }),
      });
      onToast(`تمت إزالة ملف PDF من الفيديو "${removePdfTarget.titleAr}" مع بقاء الفيديو يعمل بشكل طبيعي`);
      setRemovePdfTarget(null);
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setRemovingPdf(false);
    }
  };

  // Dedicated Save PDF Attachment button handler inside Add/Edit modal
  const handleSavePdfAttachment = async () => {
    setPdfFeedback(null);
    const trimmedUrl = form.pdfDriveUrl.trim();
    if (!trimmedUrl) {
      setPdfFeedback({ type: 'error', text: 'يرجى لصق رابط ملف PDF من Google Drive أولًا.' });
      pdfUrlInputRef.current?.focus();
      return;
    }
    const drive = extractGoogleDriveFileId(trimmedUrl);
    if (!drive.valid || !drive.fileId) {
      setPdfFeedback({
        type: 'error',
        text: drive.errorAr || 'رابط ملف PDF على Google Drive غير صالح.',
      });
      return;
    }

    // In Add Video mode (video not yet created), validate & confirm readiness so it saves with the video
    if (!editingVideo) {
      setPdfFeedback({
        type: 'success',
        text: 'تم التحقق من ملف PDF بنجاح وسيتم حفظه وربطه تلقائيًا عند الضغط على «حفظ الفيديو في المنصة».',
      });
      return;
    }

    // In Edit Video mode, persist PDF attachment immediately to Cloud SQL without leaving the modal
    setSavingPdfOnly(true);
    try {
      const resp = await apiRequest<{ video: AdminVideoRecord }>(
        `/api/admin/videos/${editingVideo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            pdfDriveUrl: trimmedUrl,
            pdfTitle: form.pdfTitle.trim(),
            pdfDescription: form.pdfDescription.trim(),
          }),
        },
      );
      setEditingVideo(resp.video);
      setForm((prev) => ({
        ...prev,
        pdfDriveUrl: resp.video.pdfDriveUrl || trimmedUrl,
        pdfTitle: resp.video.pdfTitle || prev.pdfTitle,
        pdfDescription: resp.video.pdfDescription || '',
      }));
      setPdfFeedback({
        type: 'success',
        text: 'تم حفظ مرفق PDF وربطه بالفيديو بنجاح! سيظهر الآن أسفل الفيديو في صفحة الطالب.',
      });
      onToast('تم حفظ مرفق PDF للفيديو بنجاح');
      await onReload();
    } catch (err) {
      setPdfFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingPdfOnly(false);
    }
  };

  // Remove attached PDF directly from Edit Video modal without deleting the video
  const handleRemovePdfInsideModal = async () => {
    setPdfFeedback(null);
    setShowFormPdfPreview(false);
    if (!editingVideo || !editingVideo.pdfDriveFileId) {
      setForm((prev) => ({ ...prev, pdfTitle: '', pdfDriveUrl: '', pdfDescription: '' }));
      return;
    }
    setSavingPdfOnly(true);
    try {
      const resp = await apiRequest<{ video: AdminVideoRecord }>(
        `/api/admin/videos/${editingVideo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ removePdf: true }),
        },
      );
      setEditingVideo(resp.video);
      setForm((prev) => ({ ...prev, pdfTitle: '', pdfDriveUrl: '', pdfDescription: '' }));
      setPdfFeedback({
        type: 'success',
        text: 'تمت إزالة ملف PDF المرفق بنجاح مع بقاء الفيديو يعمل بشكل طبيعي.',
      });
      onToast('تمت إزالة ملف PDF من الفيديو بنجاح');
      await onReload();
    } catch (err) {
      setPdfFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingPdfOnly(false);
    }
  };

  // Persist reordered list
  const persistOrder = async (nextList: AdminVideoRecord[]) => {
    setOrderedVideos(nextList);
    setReordering(true);
    try {
      await apiRequest('/api/admin/videos/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds: nextList.map((item) => item.id) }),
      });
      onToast('تم حفظ ترتيب الفيديوهات الجديد');
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
      setOrderedVideos(catalog.videos);
    } finally {
      setReordering(false);
    }
  };

  const handleDropOnRow = async (targetId: number) => {
    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const list = [...orderedVideos];
    const fromIdx = list.findIndex((item) => item.id === draggedId);
    const toIdx = list.findIndex((item) => item.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    setDraggedId(null);
    setDragOverId(null);
    await persistOrder(list);
  };

  const moveVideoStep = async (videoId: number, direction: -1 | 1) => {
    const list = [...orderedVideos];
    const idx = list.findIndex((v) => v.id === videoId);
    const nextIdx = idx + direction;
    if (idx === -1 || nextIdx < 0 || nextIdx >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(nextIdx, 0, moved);
    await persistOrder(list);
  };

  // Keep video form unit/lesson synced if teacher adds or deletes units/lessons while modal is open
  useEffect(() => {
    if (!modalOpen) return;
    setForm((prev) => {
      const validUnits = catalog.units.filter((u) => !prev.gradeId || u.gradeId === prev.gradeId);
      const nextUnitId = validUnits.some((u) => u.id === prev.unitId)
        ? prev.unitId
        : validUnits[0]?.id || 0;
      const validLessons = catalog.lessons.filter((l) => !nextUnitId || l.unitId === nextUnitId);
      const nextLessonId = validLessons.some((l) => l.id === prev.lessonId)
        ? prev.lessonId
        : validLessons[0]?.id || 0;
      if (nextUnitId === prev.unitId && nextLessonId === prev.lessonId) return prev;
      return { ...prev, unitId: nextUnitId, lessonId: nextLessonId };
    });
  }, [modalOpen, catalog.units, catalog.lessons]);

  // Filtered video list
  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orderedVideos.filter((v) => {
      const grade = gradeById.get(v.gradeId);
      const lesson = lessonById.get(v.lessonId);
      const effectiveTrackId = v.trackId || grade?.trackId || 0;
      const effectiveUnitId = v.unitId || lesson?.unitId || 0;
      const effectiveStatus = v.publicationStatus || (v.isPublished ? 'PUBLISHED' : 'HIDDEN');

      if (q && !v.titleAr.toLowerCase().includes(q) && !(v.descriptionAr || '').toLowerCase().includes(q)) {
        return false;
      }
      if (filterTrackId && effectiveTrackId !== filterTrackId) return false;
      if (filterGradeId && v.gradeId !== filterGradeId) return false;
      if (filterUnitId && effectiveUnitId !== filterUnitId) return false;
      if (filterCategory !== 'ALL' && v.videoType !== filterCategory) return false;
      if (filterStatus !== 'ALL' && effectiveStatus !== filterStatus) return false;
      if (filterPdf === 'WITH_PDF' && !v.pdfDriveFileId) return false;
      if (filterPdf === 'WITHOUT_PDF' && Boolean(v.pdfDriveFileId)) return false;
      return true;
    });
  }, [
    orderedVideos,
    searchQuery,
    filterTrackId,
    filterGradeId,
    filterUnitId,
    filterCategory,
    filterStatus,
    filterPdf,
    gradeById,
    lessonById,
  ]);

  const counts = useMemo(() => {
    let published = 0;
    let draft = 0;
    let hidden = 0;
    let withPdf = 0;
    for (const v of orderedVideos) {
      const st = v.publicationStatus || (v.isPublished ? 'PUBLISHED' : 'HIDDEN');
      if (st === 'PUBLISHED') published++;
      else if (st === 'DRAFT') draft++;
      else hidden++;
      if (v.pdfDriveFileId) withPdf++;
    }
    return { total: orderedVideos.length, published, draft, hidden, withPdf };
  }, [orderedVideos]);

  const paidLockedCount = useMemo(
    () => orderedVideos.filter((v) => v.videoType !== 'FREE').length,
    [orderedVideos],
  );

  const hasActiveFilters = Boolean(
    searchQuery ||
      filterTrackId ||
      filterGradeId ||
      filterUnitId ||
      filterCategory !== 'ALL' ||
      filterStatus !== 'ALL' ||
      filterPdf !== 'ALL',
  );

  const resetAllFilters = () => {
    setSearchQuery('');
    setFilterTrackId(0);
    setFilterGradeId(0);
    setFilterUnitId(0);
    setFilterCategory('ALL');
    setFilterStatus('ALL');
    setFilterPdf('ALL');
  };

  const statusTone = (statusKey: PublicationStatus): AdminTone =>
    statusKey === 'PUBLISHED' ? 'emerald' : statusKey === 'DRAFT' ? 'amber' : 'slate';

  return (
    <div className="space-y-4">
      {/* Header & Primary Actions (Ref 04) */}
      <AdminPageHeader
        title="إدارة الفيديوهات"
        subtitle="إضافة وتنظيم محاضرات يوتيوب وإرفاق ملفات PDF من Google Drive حسب المسار والصف والوحدة والدرس."
        icon={<Video className="h-5 w-5" />}
        actions={
          <>
            <button
              type="button"
              data-testid="open-units-lessons-modal-btn"
              onClick={() => openUnitsLessonsModal('units', filterGradeId || 0, filterUnitId || 0)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50/50 hover:text-[#2563EB]"
            >
              <Layers className="h-4 w-4 text-[#2563EB]" />
              <span>إضافة وحدة أو درس</span>
            </button>
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-[#1D4ED8]"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة فيديو جديد</span>
            </button>
          </>
        }
      />

      {/* 4 Real KPI Cards (Ref 04 — strictly real data, no invented GB storage) */}
      <AdminKpiGrid cols={4}>
        <AdminKpiCard
          label="إجمالي الفيديوهات"
          value={counts.total}
          subtitle={`في ${catalog.units.length} وحدة و ${catalog.lessons.length} درس`}
          icon={<Play className="h-5 w-5" />}
          tone="blue"
          onClick={() => setFilterStatus('ALL')}
        />
        <AdminKpiCard
          label="منشور"
          value={counts.published}
          subtitle="متاح للمشاهدة حسب الصلاحيات"
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="emerald"
          onClick={() => setFilterStatus('PUBLISHED')}
        />
        <AdminKpiCard
          label="مسودة / مخفي"
          value={counts.draft + counts.hidden}
          subtitle={`مسودة: ${counts.draft} · مخفي: ${counts.hidden}`}
          icon={<EyeOff className="h-5 w-5" />}
          tone="amber"
          onClick={() => setFilterStatus('DRAFT')}
        />
        <AdminKpiCard
          label="بملف PDF مرفق"
          value={counts.withPdf}
          subtitle={`فيديوهات مدفوعة/كورس: ${paidLockedCount}`}
          icon={<FileText className="h-5 w-5" />}
          tone="purple"
          onClick={() => setFilterPdf(filterPdf === 'WITH_PDF' ? 'ALL' : 'WITH_PDF')}
        />
      </AdminKpiGrid>


      {/* Segmented Status Tabs + View Switcher (Grid vs Compact Table — never both simultaneously) */}
      <AdminSegmentedTabs<string>
        activeId={filterStatus}
        onChange={setFilterStatus}
        items={[
          { id: 'ALL', label: 'الكل', count: counts.total },
          { id: 'PUBLISHED', label: 'منشور', count: counts.published },
          { id: 'DRAFT', label: 'مسودة', count: counts.draft },
          { id: 'HIDDEN', label: 'مخفي', count: counts.hidden },
        ]}
        rightSlot={
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              aria-label="عرض بطاقات"
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#2563EB] text-white shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>بطاقات</span>
            </button>
            <button
              type="button"
              aria-label="عرض جدول"
              aria-pressed={viewMode === 'table'}
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#2563EB] text-white shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span>جدول وترتيب</span>
            </button>
          </div>
        }
      />

      {/* Search & Filter Controls */}
      <AdminFilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="ابحث بعنوان الفيديو أو وصفه..."
        hasActiveFilters={hasActiveFilters}
        onReset={resetAllFilters}
      >
        <select
          aria-label="تصفية حسب المسار الدراسي"
          value={filterTrackId}
          onChange={(e) => {
            setFilterTrackId(Number(e.target.value));
            setFilterGradeId(0);
            setFilterUnitId(0);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700"
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
            setFilterGradeId(Number(e.target.value));
            setFilterUnitId(0);
          }}
          className="h-9 w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700"
        >
          <option value={0}>كل الصفوف</option>
          {filterGrades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nameAr}
            </option>
          ))}
        </select>
        <select
          aria-label="تصفية حسب الوحدة"
          value={filterUnitId}
          onChange={(e) => setFilterUnitId(Number(e.target.value))}
          className="h-9 w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700"
        >
          <option value={0}>كل الوحدات</option>
          {filterUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.titleAr}
            </option>
          ))}
        </select>
        <select
          aria-label="تصفية حسب التصنيف"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="h-9 w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700"
        >
          <option value="ALL">كل التصنيفات</option>
          <option value="FREE">مجاني</option>
          <option value="PAID">مدفوع</option>
          <option value="COURSE">كورس كامل</option>
        </select>
        <select
          aria-label="تصفية حسب ملف PDF"
          data-testid="filter-pdf-select"
          value={filterPdf}
          onChange={(e) => setFilterPdf(e.target.value as 'ALL' | 'WITH_PDF' | 'WITHOUT_PDF')}
          className="h-9 w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700"
        >
          <option value="ALL">حالة PDF (الكل)</option>
          <option value="WITH_PDF">يحتوي على PDF</option>
          <option value="WITHOUT_PDF">بدون PDF</option>
        </select>
      </AdminFilterBar>

      {/* Active View: Grid Thumbnails OR Compact Table (Never Both Simultaneously) */}
      {filteredVideos.length === 0 ? (
        <AdminEmptyState
          icon={<Video className="h-6 w-6" />}
          title="لا توجد فيديوهات مطابقة لخيارات البحث الحالية"
          description="أضف فيديو جديدًا أو اضغط «إعادة ضبط» لعرض كامل المكتبة."
          action={
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة فيديو جديد</span>
            </button>
          }
        />
      ) : viewMode === 'grid' ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="admin-videos-list"
        >
          {filteredVideos.map((v, idx) => {
            const grade = gradeById.get(v.gradeId);
            const lesson = lessonById.get(v.lessonId);
            const unit = unitById.get(v.unitId || lesson?.unitId || 0);
            const statusKey = (v.publicationStatus ||
              (v.isPublished ? 'PUBLISHED' : 'HIDDEN')) as PublicationStatus;
            const statusMeta = STATUS_LABELS[statusKey] || STATUS_LABELS.PUBLISHED;

            return (
              <div
                key={v.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:border-blue-200 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video w-full overflow-hidden bg-[#0D172B]">
                  {v.thumbnailUrl ? (
                    <img
                      src={v.thumbnailUrl}
                      alt={v.titleAr}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        if (v.youtubeVideoId) {
                          (e.currentTarget as HTMLImageElement).src =
                            `https://i.ytimg.com/vi/${v.youtubeVideoId}/hqdefault.jpg`;
                        }
                      }}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                      <Video className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                    <AdminStatusBadge tone={statusTone(statusKey)} dot>
                      {statusMeta.label}
                    </AdminStatusBadge>
                  </div>
                  {v.videoType !== 'FREE' && (
                    <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-lg bg-[#0D172B]/85 px-2 py-0.5 text-[10px] font-bold text-amber-200 backdrop-blur">
                      <Lock className="h-3 w-3" />
                      <span>
                        {v.videoType === 'PAID' && v.priceEgp > 0
                          ? `${v.priceEgp} ج.م`
                          : 'كورس'}
                      </span>
                    </span>
                  )}
                  {v.durationSec > 0 && (
                    <span
                      dir="ltr"
                      className="absolute bottom-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-white"
                    >
                      {formatDurationAr(v.durationSec)}
                    </span>
                  )}
                </div>

                {/* Card Body */}
                <div className="flex flex-1 flex-col justify-between p-3.5">
                  <div>
                    <h3 className="line-clamp-2 text-xs font-extrabold leading-snug text-[#0F172A]">
                      {v.titleAr}
                    </h3>
                    <div className="mt-1 truncate text-[11px] text-slate-500">
                      {[unit?.titleAr, lesson?.titleAr].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {grade && <AdminStatusBadge tone="purple">{grade.nameAr}</AdminStatusBadge>}
                      {v.pdfDriveFileId ? (
                        <span
                          data-testid={`video-pdf-badge-${v.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700"
                        >
                          <FileText className="h-3 w-3" />
                          <span>PDF</span>
                        </span>
                      ) : (
                        <span
                          data-testid={`video-no-pdf-badge-${v.id}`}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-400"
                        >
                          بدون PDF
                        </span>
                      )}
                      <span className="mr-auto font-mono-num text-[10px] font-semibold text-slate-400">
                        {v.viewsCount} مشاهدة
                      </span>
                    </div>
                  </div>

                  {/* Direct Teacher Management Controls Beside Every Video */}
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-2.5">
                    {/* Row 1: Primary View & Analytics + Codes + Subscription Lock */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        data-testid={`video-viewers-btn-${v.id}`}
                        aria-label={`مشاهدو الفيديو "${v.titleAr}"`}
                        onClick={() => setViewersVideo(v)}
                        className="inline-flex min-w-0 items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50/70 px-1.5 py-1.5 text-[11px] font-extrabold text-indigo-700 transition-colors hover:bg-indigo-100"
                      >
                        <Users className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          المشاهدين
                          {typeof v.uniqueViewersCount === 'number' && v.uniqueViewersCount > 0
                            ? ` (${v.uniqueViewersCount})`
                            : ''}
                        </span>
                      </button>
                      {canManageCodes && (
                        <button
                          type="button"
                          data-testid={`video-codes-btn-${v.id}`}
                          aria-label={`أكواد تفعيل "${v.titleAr}"`}
                          onClick={() => openVideoAccessModal(v, 'codes')}
                          className="inline-flex min-w-0 items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50/70 px-1.5 py-1.5 text-[11px] font-extrabold text-[#2563EB] transition-colors hover:bg-blue-100"
                        >
                          <KeyRound className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">أكواد</span>
                        </button>
                      )}
                      {canManageSubscriptions && (
                        <button
                          type="button"
                          data-testid={`video-access-btn-${v.id}`}
                          aria-label={`قفل وفتح اشتراكات "${v.titleAr}"`}
                          onClick={() => openVideoAccessModal(v, 'subscriptions')}
                          className={`inline-flex min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 py-1.5 text-[11px] font-extrabold transition-colors ${
                            v.videoType === 'FREE'
                              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100'
                              : 'border-amber-200 bg-amber-50/80 text-amber-800 hover:bg-amber-100'
                          }`}
                        >
                          {v.videoType === 'FREE' ? (
                            <Unlock className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <Lock className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="truncate">
                            {v.videoType === 'FREE' ? 'مفتوح' : 'اشتراك'}
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Row 2: Preview + Quick Hide/Show + Edit + Delete + More */}
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        aria-label={`معاينة "${v.titleAr}"`}
                        onClick={() => setPreviewVideo(v)}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-extrabold text-[#0F172A] hover:border-blue-200 hover:bg-blue-50/60 hover:text-[#2563EB]"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>معاينة</span>
                      </button>
                      {canManageContent && (
                        <>
                          <button
                            type="button"
                            data-testid={`video-hide-btn-${v.id}`}
                            title={statusKey === 'PUBLISHED' ? 'إخفاء الفيديو' : 'إظهار ونشر الفيديو'}
                            aria-label={
                              statusKey === 'PUBLISHED'
                                ? `إخفاء "${v.titleAr}"`
                                : `إظهار "${v.titleAr}"`
                            }
                            onClick={() =>
                              void handleQuickStatusChange(
                                v,
                                statusKey === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED',
                              )
                            }
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                              statusKey === 'PUBLISHED'
                                ? 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {statusKey === 'PUBLISHED' ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            data-testid={`video-edit-btn-${v.id}`}
                            title="تعديل الفيديو"
                            aria-label={`تعديل "${v.titleAr}"`}
                            onClick={() => openEditModal(v)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-[#2563EB]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            data-testid={`video-delete-btn-${v.id}`}
                            title="حذف الفيديو"
                            aria-label={`حذف "${v.titleAr}"`}
                            onClick={() => setDeleteTarget(v)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200/80 bg-red-50/50 text-red-600 hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      <AdminActionMenu
                        ariaLabel={`المزيد لـ ${v.titleAr}`}
                        items={[
                          {
                            id: 'viewers',
                            label: 'قائمة المشاهدين ونسبة الإكمال',
                            icon: <Users className="h-3.5 w-3.5" />,
                            onClick: () => setViewersVideo(v),
                          },
                          ...(canManageCodes
                            ? [
                                {
                                  id: 'codes',
                                  label: 'توليد أكواد تفعيل للفيديو',
                                  icon: <KeyRound className="h-3.5 w-3.5" />,
                                  onClick: () => openVideoAccessModal(v, 'codes'),
                                },
                              ]
                            : []),
                          ...(canManageSubscriptions
                            ? [
                                {
                                  id: 'subscriptions',
                                  label: 'قفل / فتح اشتراكات الفيديو',
                                  icon: <Lock className="h-3.5 w-3.5" />,
                                  onClick: () => openVideoAccessModal(v, 'subscriptions'),
                                },
                              ]
                            : []),
                          ...(v.pdfDriveFileId
                            ? [
                                {
                                  id: 'preview-pdf',
                                  label: 'معاينة PDF المرفق',
                                  icon: <FileText className="h-3.5 w-3.5" />,
                                  onClick: () => setPdfPreviewVideo(v),
                                },
                                {
                                  id: 'edit-pdf',
                                  label: 'تعديل مرفق PDF',
                                  icon: <FileText className="h-3.5 w-3.5" />,
                                  onClick: () => openEditModal(v, true),
                                },
                                {
                                  id: 'remove-pdf',
                                  label: 'إزالة مرفق PDF',
                                  icon: <FileX2 className="h-3.5 w-3.5" />,
                                  tone: 'danger' as const,
                                  onClick: () => setRemovePdfTarget(v),
                                },
                              ]
                            : [
                                {
                                  id: 'attach-pdf',
                                  label: 'إرفاق ملف PDF',
                                  icon: <FileText className="h-3.5 w-3.5" />,
                                  onClick: () => openEditModal(v, true),
                                },
                              ]),
                          {
                            id: 'move-up',
                            label: 'تحريك لأعلى',
                            icon: <ArrowUp className="h-3.5 w-3.5" />,
                            disabled: idx === 0 || reordering,
                            onClick: () => void moveVideoStep(v.id, -1),
                          },
                          {
                            id: 'move-down',
                            label: 'تحريك لأسفل',
                            icon: <ArrowDown className="h-3.5 w-3.5" />,
                            disabled: idx === filteredVideos.length - 1 || reordering,
                            onClick: () => void moveVideoStep(v.id, 1),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <AdminCard padding="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
            <span className="font-extrabold text-[#0F172A]">
              جدول الفيديوهات ({filteredVideos.length})
            </span>
            <span className="text-[11px] text-slate-500">
              {reordering
                ? 'جارٍ حفظ الترتيب الجديد...'
                : 'اسحب الصف لإعادة الترتيب أو استخدم أسهم التحريك'}
            </span>
          </div>
          <div className="overflow-x-auto" data-testid="admin-videos-list">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                <tr>
                  <th className="w-20 px-3 py-3">الترتيب</th>
                  <th className="px-3 py-3">الفيديو</th>
                  <th className="px-3 py-3">الصف / الوحدة / الدرس</th>
                  <th className="px-3 py-3">التصنيف و PDF</th>
                  <th className="px-3 py-3">الحالة</th>
                  <th className="px-3 py-3">المشاهدات</th>
                  <th className="px-3 py-3 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVideos.map((v, idx) => {
                  const grade = gradeById.get(v.gradeId);
                  const lesson = lessonById.get(v.lessonId);
                  const unit = unitById.get(v.unitId || lesson?.unitId || 0);
                  const statusKey = (v.publicationStatus ||
                    (v.isPublished ? 'PUBLISHED' : 'HIDDEN')) as PublicationStatus;
                  const statusMeta = STATUS_LABELS[statusKey] || STATUS_LABELS.PUBLISHED;
                  const isDropTarget = dragOverId === v.id && draggedId !== v.id;

                  return (
                    <tr
                      key={v.id}
                      draggable
                      onDragStart={() => setDraggedId(v.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverId !== v.id) setDragOverId(v.id);
                      }}
                      onDragLeave={() => {
                        if (dragOverId === v.id) setDragOverId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        void handleDropOnRow(v.id);
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDragOverId(null);
                      }}
                      className={`transition-colors ${
                        isDropTarget
                          ? 'bg-blue-50/70 ring-2 ring-inset ring-[#2563EB]'
                          : 'hover:bg-slate-50/80'
                      } ${draggedId === v.id ? 'opacity-50' : ''}`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <GripVertical className="h-4 w-4 cursor-grab text-slate-400" />
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              aria-label={`تحريك "${v.titleAr}" لأعلى`}
                              disabled={idx === 0 || reordering}
                              onClick={() => void moveVideoStep(v.id, -1)}
                              className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              aria-label={`تحريك "${v.titleAr}" لأسفل`}
                              disabled={idx === filteredVideos.length - 1 || reordering}
                              onClick={() => void moveVideoStep(v.id, 1)}
                              className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="h-11 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-[#0D172B]">
                            {v.thumbnailUrl ? (
                              <img
                                src={v.thumbnailUrl}
                                alt={v.titleAr}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-slate-400">
                                <Video className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="max-w-[220px] truncate font-extrabold text-[#0F172A]">
                              {v.titleAr}
                            </div>
                            {v.durationSec > 0 && (
                              <div className="font-mono-num text-[10px] text-slate-400">
                                {formatDurationAr(v.durationSec)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-600">
                        <div className="font-bold text-slate-700">{grade?.nameAr || '—'}</div>
                        <div className="truncate text-slate-400">
                          {[unit?.titleAr, lesson?.titleAr].filter(Boolean).join(' / ') || '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <AdminStatusBadge tone="slate">
                            {CATEGORY_LABELS[v.videoType] || v.videoType}
                          </AdminStatusBadge>
                          {v.pdfDriveFileId ? (
                            <span
                              data-testid={`video-pdf-badge-${v.id}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
                            >
                              <FileText className="h-3 w-3" />
                              <span>PDF</span>
                            </span>
                          ) : (
                            <span
                              data-testid={`video-no-pdf-badge-${v.id}`}
                              className="text-[10px] text-slate-400"
                            >
                              —
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <AdminStatusBadge tone={statusTone(statusKey)} dot>
                          {statusMeta.label}
                        </AdminStatusBadge>
                      </td>
                      <td className="px-3 py-2.5 font-mono-num font-bold text-slate-700 tabular-nums">
                        {v.viewsCount}
                      </td>
                      <td className="px-3 py-2.5 text-left">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="مشاهدو الفيديو ونسبة الإكمال"
                            aria-label={`مشاهدو الفيديو "${v.titleAr}"`}
                            onClick={() => setViewersVideo(v)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                          >
                            <Users className="h-3.5 w-3.5" />
                            <span className="hidden xl:inline">المشاهدين</span>
                          </button>
                          {canManageCodes && (
                            <button
                              type="button"
                              title="توليد أكواد تفعيل للفيديو"
                              aria-label={`أكواد تفعيل "${v.titleAr}"`}
                              onClick={() => openVideoAccessModal(v, 'codes')}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50/70 text-[#2563EB] hover:bg-blue-100"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canManageSubscriptions && (
                            <button
                              type="button"
                              title="قفل وفتح اشتراكات الفيديو"
                              aria-label={`قفل وفتح اشتراكات "${v.titleAr}"`}
                              onClick={() => openVideoAccessModal(v, 'subscriptions')}
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                                v.videoType === 'FREE'
                                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100'
                                  : 'border-amber-200 bg-amber-50/70 text-amber-800 hover:bg-amber-100'
                              }`}
                            >
                              {v.videoType === 'FREE' ? (
                                <Unlock className="h-3.5 w-3.5" />
                              ) : (
                                <Lock className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            title="معاينة الفيديو"
                            aria-label={`معاينة "${v.titleAr}"`}
                            onClick={() => setPreviewVideo(v)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#2563EB] hover:bg-blue-50"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          {canManageContent && (
                            <>
                              <button
                                type="button"
                                title={statusKey === 'PUBLISHED' ? 'إخفاء الفيديو' : 'إظهار الفيديو'}
                                aria-label={
                                  statusKey === 'PUBLISHED'
                                    ? `إخفاء "${v.titleAr}"`
                                    : `إظهار "${v.titleAr}"`
                                }
                                onClick={() =>
                                  void handleQuickStatusChange(
                                    v,
                                    statusKey === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED',
                                  )
                                }
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                                  statusKey === 'PUBLISHED'
                                    ? 'border-slate-200 bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-700'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {statusKey === 'PUBLISHED' ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                title="تعديل الفيديو"
                                aria-label={`تعديل "${v.titleAr}"`}
                                onClick={() => openEditModal(v)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="حذف الفيديو"
                                aria-label={`حذف "${v.titleAr}"`}
                                onClick={() => setDeleteTarget(v)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50/60 text-red-600 hover:bg-red-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <AdminActionMenu
                            ariaLabel={`إجراءات "${v.titleAr}"`}
                            items={[
                              ...(v.pdfDriveFileId
                                ? [
                                    {
                                      id: 'preview-pdf',
                                      label: 'معاينة PDF',
                                      icon: <FileText className="h-3.5 w-3.5" />,
                                      onClick: () => setPdfPreviewVideo(v),
                                    },
                                    {
                                      id: 'edit-pdf',
                                      label: 'تعديل PDF',
                                      icon: <FileText className="h-3.5 w-3.5" />,
                                      onClick: () => openEditModal(v, true),
                                    },
                                    {
                                      id: 'remove-pdf',
                                      label: 'إزالة PDF',
                                      icon: <FileX2 className="h-3.5 w-3.5" />,
                                      tone: 'danger' as const,
                                      onClick: () => setRemovePdfTarget(v),
                                    },
                                  ]
                                : [
                                    {
                                      id: 'attach-pdf',
                                      label: 'إرفاق PDF',
                                      icon: <FileText className="h-3.5 w-3.5" />,
                                      onClick: () => openEditModal(v, true),
                                    },
                                  ]),
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* ADD / EDIT VIDEO MODAL (12 Fields + Live YouTube Extraction & Preview) */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto"
        >
          <div className="my-auto w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <div>
                <h3 id="video-modal-title" className="text-lg font-extrabold text-[#0B162C]">
                  {editingVideo ? 'تعديل بيانات الفيديو' : 'إضافة فيديو جديد'}
                </h3>
                <p className="text-xs text-slate-500">
                  الصق رابط فيديو يوتيوب لاستخراج المعرّف والصورة المصغرة والمعاينة تلقائيًا
                </p>
              </div>
              <button
                type="button"
                aria-label="إغلاق نافذة الفيديو"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVideo} className="p-6 space-y-5">
              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-800"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* 1. Title & 2. YouTube URL */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="yt-video-title" className="block text-xs font-bold text-[#0B162C]">
                    1. عنوان الفيديو *
                  </label>
                  <input
                    id="yt-video-title"
                    type="text"
                    required
                    placeholder="مثال: شرح قانون كيرشوف الثاني وحل مسائل امتحانات سابقة"
                    value={form.titleAr}
                    onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="yt-video-url" className="block text-xs font-bold text-[#0B162C]">
                    2. رابط الفيديو على يوتيوب (YouTube URL) *
                  </label>
                  <input
                    id="yt-video-url"
                    type="text"
                    dir="ltr"
                    required
                    placeholder="https://www.youtube.com/watch?v=... أو https://youtu.be/... أو Shorts / Live"
                    value={form.youtubeUrl}
                    onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-left font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                  {parsedYouTube && (
                    <div className="mt-2">
                      {parsedYouTube.valid && parsedYouTube.videoId ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <span>تم استخراج معرّف يوتيوب بنجاح:</span>
                          <code
                            dir="ltr"
                            className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono-num text-emerald-900"
                          >
                            {parsedYouTube.videoId}
                          </code>
                          {parsedYouTube.isShortsUrl && <span>(YouTube Shorts)</span>}
                          {parsedYouTube.isLiveUrl && <span>(YouTube Live)</span>}
                        </div>
                      ) : (
                        <div role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>{parsedYouTube.errorAr}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Live Embedded YouTube Preview inside Admin Form */}
              {parsedYouTube?.valid && parsedYouTube.videoId && (
                <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-[#0B162C]">
                    <span>معاينة مباشرة للفيديو (نطاق youtube-nocookie المعزز للخصوصية)</span>
                    <span className="font-mono-num text-slate-500" dir="ltr">
                      youtube-nocookie.com/embed/{parsedYouTube.videoId}
                    </span>
                  </div>
                  <div className="aspect-video w-full overflow-hidden rounded-lg bg-[#0B162C]">
                    <iframe
                      title="معاينة فيديو يوتيوب"
                      src={buildPrivacyEnhancedEmbedUrl(parsedYouTube.videoId)}
                      className="h-full w-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                </div>
              )}

              {/* 3. Video Description */}
              <div>
                <label htmlFor="yt-video-desc" className="block text-xs font-bold text-[#0B162C]">
                  3. وصف الفيديو
                </label>
                <textarea
                  id="yt-video-desc"
                  rows={2}
                  placeholder="أبرز النقاط والقوانين المشروحة في المحاضرة..."
                  value={form.descriptionAr}
                  onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              {/* 📎 ATTACHED LESSON PDF (Google Drive) — Placed directly below basic video info for immediate visibility */}
              <div
                ref={pdfSectionRef}
                data-testid="admin-video-pdf-section"
                className="rounded-xl border-2 border-red-200 bg-red-50/40 p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 shadow-xs">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold text-[#0B162C]">
                        📎 ملف الدرس PDF
                      </h4>
                      <p className="text-[11px] text-slate-600">
                        أضف رابط ملف PDF من Google Drive ليظهر تلقائيًا أسفل الفيديو في صفحة الطالب (اختياري)
                      </p>
                    </div>
                  </div>
                  <span className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-700">
                    Google Drive PDF
                  </span>
                </div>

                {/* Currently Attached PDF Summary Card (shown automatically in Edit Video mode if PDF exists) */}
                {editingVideo?.pdfDriveFileId && (
                  <div
                    data-testid="admin-current-pdf-summary"
                    className="rounded-xl border border-emerald-200 bg-white p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span>الملف المرفق حاليًا: {editingVideo.pdfTitle || editingVideo.titleAr}</span>
                        </div>
                        <div
                          dir="ltr"
                          className="truncate font-mono-num text-[11px] text-slate-500 max-w-full"
                        >
                          {editingVideo.pdfDriveUrl || buildGoogleDriveViewUrl(editingVideo.pdfDriveFileId)}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="admin-current-pdf-preview-btn"
                        onClick={() => setShowFormPdfPreview((prev) => !prev)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#0B162C] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2563EB]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>{showFormPdfPreview ? 'إخفاء المعاينة' : 'معاينة PDF'}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="admin-edit-pdf-link-btn"
                        onClick={() => {
                          pdfUrlInputRef.current?.focus();
                          pdfUrlInputRef.current?.select();
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>تعديل الرابط</span>
                      </button>
                      <button
                        type="button"
                        data-testid="admin-replace-pdf-btn"
                        onClick={() => {
                          setShowFormPdfPreview(false);
                          setPdfFeedback(null);
                          setForm((prev) => ({ ...prev, pdfDriveUrl: '' }));
                          window.setTimeout(() => pdfUrlInputRef.current?.focus(), 40);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-100"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>استبدال ملف PDF</span>
                      </button>
                      <button
                        type="button"
                        data-testid="admin-remove-pdf-modal-btn"
                        disabled={savingPdfOnly}
                        onClick={() => void handleRemovePdfInsideModal()}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
                      >
                        <FileX2 className="h-3.5 w-3.5" />
                        <span>إزالة ملف PDF</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="pdf-title" className="block text-xs font-bold text-[#0B162C]">
                      اسم ملف PDF الظاهر للطالب
                    </label>
                    <input
                      id="pdf-title"
                      type="text"
                      placeholder="مثال: مذكرة شرح قانون كيرشوف + واجب المحاضرة"
                      value={form.pdfTitle}
                      onChange={(e) => {
                        setPdfFeedback(null);
                        setForm({ ...form, pdfTitle: e.target.value });
                      }}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="pdf-drive-url" className="block text-xs font-bold text-[#0B162C]">
                      رابط ملف PDF على Google Drive
                    </label>
                    <input
                      ref={pdfUrlInputRef}
                      id="pdf-drive-url"
                      type="text"
                      dir="ltr"
                      placeholder="https://drive.google.com/file/d/FILE_ID/view?usp=sharing"
                      value={form.pdfDriveUrl}
                      onChange={(e) => {
                        setShowFormPdfPreview(false);
                        setPdfFeedback(null);
                        setForm({ ...form, pdfDriveUrl: e.target.value });
                      }}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left font-mono-num text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="pdf-description" className="block text-xs font-bold text-[#0B162C]">
                      وصف ملف PDF (اختياري)
                    </label>
                    <textarea
                      id="pdf-description"
                      rows={2}
                      placeholder="مثال: يحتوي الملف على ملخص القوانين و25 مسألة تدريبية بنظام الامتحان..."
                      value={form.pdfDescription}
                      onChange={(e) => {
                        setPdfFeedback(null);
                        setForm({ ...form, pdfDescription: e.target.value });
                      }}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Visible Action Row: Preview PDF + Save PDF Attachment + Open in Drive + Clear */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="toggle-admin-form-pdf-preview"
                    disabled={!parsedDrive?.valid || !parsedDrive.previewUrl}
                    onClick={() => setShowFormPdfPreview((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>{showFormPdfPreview ? 'إخفاء معاينة PDF' : 'معاينة PDF'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="save-pdf-attachment-btn"
                    disabled={savingPdfOnly}
                    onClick={() => void handleSavePdfAttachment()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>{savingPdfOnly ? 'جارٍ حفظ ملف PDF...' : 'حفظ مرفق PDF'}</span>
                  </button>

                  {parsedDrive?.valid && parsedDrive.viewUrl && (
                    <a
                      href={parsedDrive.viewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>فتح في Google Drive</span>
                    </a>
                  )}

                  {!editingVideo?.pdfDriveFileId &&
                    (form.pdfDriveUrl.trim() || form.pdfTitle.trim() || form.pdfDescription.trim()) && (
                      <button
                        type="button"
                        data-testid="clear-form-pdf-btn"
                        onClick={() => {
                          setShowFormPdfPreview(false);
                          setPdfFeedback(null);
                          setForm((prev) => ({
                            ...prev,
                            pdfTitle: '',
                            pdfDriveUrl: '',
                            pdfDescription: '',
                          }));
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50"
                      >
                        <FileX2 className="h-3.5 w-3.5" />
                        <span>مسح حقول PDF</span>
                      </button>
                    )}
                </div>

                {/* Live Validation & Save Feedback */}
                {pdfFeedback && (
                  <div
                    role={pdfFeedback.type === 'error' ? 'alert' : 'status'}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${
                      pdfFeedback.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {pdfFeedback.type === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                    )}
                    <span>{pdfFeedback.text}</span>
                  </div>
                )}

                {parsedDrive && (
                  <div className="space-y-2.5">
                    {parsedDrive.valid && parsedDrive.fileId && parsedDrive.previewUrl ? (
                      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                        <span>رابط Google Drive صالح · معرّف الملف:</span>
                        <code
                          dir="ltr"
                          className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 font-mono-num text-[11px] text-emerald-900"
                        >
                          {parsedDrive.fileId}
                        </code>
                      </div>
                    ) : (
                      <div
                        role="alert"
                        className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                      >
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{parsedDrive.errorAr}</span>
                      </div>
                    )}

                    {showFormPdfPreview && parsedDrive.valid && parsedDrive.previewUrl && (
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-[#F7F9FC] px-3 py-2 text-[11px] text-slate-600">
                          <span className="font-bold text-[#0B162C]">معاينة ملف PDF (Google Drive Preview)</span>
                          <span>
                            إذا ظهرت رسالة تعذر الوصول، تأكد أن صلاحية الملف هي «Anyone with the link — Viewer».
                          </span>
                        </div>
                        <div className="h-[360px] w-full">
                          <iframe
                            title="معاينة ملف PDF قبل الحفظ"
                            src={parsedDrive.previewUrl}
                            className="h-full w-full border-0"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Concise Arabic Sharing Guidance */}
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-600">
                  <strong className="text-[#0B162C]">تنبيه مهم للمشاركة:</strong> اضبط صلاحية ملف الـ PDF على Google Drive إلى{' '}
                  <strong className="text-[#0B162C]">«أي شخص لديه الرابط — عارض (Anyone with the link — Viewer)»</strong>{' '}
                  ليتمكن الطلاب المصرح لهم بمشاهدة الفيديو من عرضه داخل المنصة (يرث الـ PDF صلاحيات الفيديو تلقائيًا).
                </div>
              </div>

              {/* 4. Track, 5. Grade, 6. Unit, 7. Lesson */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="yt-track" className="block text-xs font-bold text-[#0B162C]">
                    4. المسار الدراسي *
                  </label>
                  <select
                    id="yt-track"
                    value={form.trackId}
                    onChange={(e) => handleTrackChange(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                  >
                    {catalog.tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="yt-grade" className="block text-xs font-bold text-[#0B162C]">
                    5. الصف الدراسي *
                  </label>
                  <select
                    id="yt-grade"
                    value={form.gradeId}
                    onChange={(e) => handleGradeChange(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                  >
                    {formGrades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="yt-unit" className="block text-xs font-bold text-[#0B162C]">
                      6. الوحدة الدراسية *
                    </label>
                    {canManageContent && (
                      <button
                        type="button"
                        onClick={() => openUnitsLessonsModal('units', form.gradeId || 0, 0)}
                        className="text-[11px] font-bold text-[#2563EB] hover:underline"
                      >
                        + إدارة الوحدات
                      </button>
                    )}
                  </div>
                  <select
                    id="yt-unit"
                    value={form.unitId}
                    onChange={(e) => handleUnitChange(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                  >
                    {formUnits.length === 0 ? (
                      <option value={0}>لا توجد وحدات لهذا الصف</option>
                    ) : (
                      formUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.titleAr}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="yt-lesson" className="block text-xs font-bold text-[#0B162C]">
                      7. الدرس *
                    </label>
                    {canManageContent && (
                      <button
                        type="button"
                        onClick={() =>
                          openUnitsLessonsModal('lessons', form.gradeId || 0, form.unitId || 0)
                        }
                        className="text-[11px] font-bold text-[#2563EB] hover:underline"
                      >
                        + إدارة الدروس
                      </button>
                    )}
                  </div>
                  <select
                    id="yt-lesson"
                    value={form.lessonId}
                    onChange={(e) => setForm({ ...form, lessonId: Number(e.target.value) })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                  >
                    {formLessons.length === 0 ? (
                      <option value={0}>لا توجد دروس لهذه الوحدة</option>
                    ) : (
                      formLessons.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.titleAr}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {/* 8. Category, Price, 9. Course Assignment */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="yt-category" className="block text-xs font-bold text-[#0B162C]">
                    8. تصنيف الفيديو *
                  </label>
                  <select
                    id="yt-category"
                    value={form.videoType}
                    onChange={(e) => {
                      const nextType = e.target.value as VideoCategory;
                      setForm((prev) => ({
                        ...prev,
                        videoType: nextType,
                        courseId:
                          nextType === 'COURSE'
                            ? prev.courseId || formCourses[0]?.id || ''
                            : nextType === 'FREE'
                              ? ''
                              : prev.courseId,
                      }));
                    }}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="FREE">فيديو مجاني (للطلاب المعتمدين)</option>
                    <option value="PAID">فيديو مدفوع (شراء أو اشتراك)</option>
                    <option value="COURSE">فيديو ضمن كورس كامل</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="yt-course" className="block text-xs font-bold text-[#0B162C]">
                    9. ربط بكورس {form.videoType === 'COURSE' ? '*' : '(اختياري)'}
                  </label>
                  <select
                    id="yt-course"
                    value={form.courseId}
                    onChange={(e) =>
                      setForm({ ...form, courseId: e.target.value ? Number(e.target.value) : '' })
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="">بدون ربط بكورس محدد</option>
                    {formCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.titleAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="yt-price" className="block text-xs font-bold text-[#0B162C]">
                    السعر المنفرد (ج.م)
                  </label>
                  <input
                    id="yt-price"
                    type="number"
                    min={0}
                    disabled={form.videoType === 'FREE'}
                    value={form.videoType === 'FREE' ? 0 : form.priceEgp}
                    onChange={(e) => setForm({ ...form, priceEgp: Number(e.target.value) })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono-num text-sm disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>

              {/* 10. Thumbnail Upload from Computer or URL, 11. Display Order, 12. Publication Status */}
              <div className="grid gap-4 sm:grid-cols-12">
                <div className="sm:col-span-6 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="yt-thumb" className="block text-xs font-bold text-[#0B162C]">
                      10. صورة مصغرة للفيديو (من جهاز الكمبيوتر أو رابط)
                    </label>
                    {parsedYouTube?.valid && parsedYouTube.thumbnailUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setManualThumbEdited(false);
                          setThumbUploadError('');
                          setForm((prev) => ({
                            ...prev,
                            thumbnailUrl: parsedYouTube.thumbnailUrl || '',
                          }));
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>استخدام صورة يوتيوب التلقائية</span>
                      </button>
                    )}
                  </div>

                  {/* Computer Image File Uploader */}
                  <input
                    ref={thumbFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    data-testid="video-thumbnail-file-input"
                    onChange={(e) => void handleThumbnailFileSelect(e)}
                    className="hidden"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="upload-video-thumbnail-btn"
                      disabled={thumbUploading}
                      onClick={() => thumbFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2 text-xs font-extrabold text-[#2563EB] transition-colors hover:bg-blue-100 disabled:opacity-60"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>{thumbUploading ? 'جارٍ رفع الصورة...' : 'رفع صورة من جهاز الكمبيوتر'}</span>
                    </button>
                    {form.thumbnailUrl && form.thumbnailUrl.startsWith('data:image/') && (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                        <ImagePlus className="h-3.5 w-3.5" />
                        <span>تم اختيار صورة من الجهاز</span>
                      </span>
                    )}
                  </div>

                  {thumbUploadError && (
                    <div role="alert" className="text-[11px] font-semibold text-red-600">
                      {thumbUploadError}
                    </div>
                  )}

                  <input
                    id="yt-thumb"
                    type="text"
                    dir="ltr"
                    placeholder="أو الصق رابط صورة خارجي (يُملأ تلقائيًا من يوتيوب)"
                    value={
                      form.thumbnailUrl.startsWith('data:image/')
                        ? ''
                        : form.thumbnailUrl
                    }
                    onChange={(e) => {
                      setManualThumbEdited(true);
                      setThumbUploadError('');
                      setForm({ ...form, thumbnailUrl: e.target.value });
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="yt-order" className="block text-xs font-bold text-[#0B162C]">
                    11. ترتيب الفيديو
                  </label>
                  <input
                    id="yt-order"
                    type="number"
                    min={0}
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono-num text-sm"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label htmlFor="yt-status" className="block text-xs font-bold text-[#0B162C]">
                    12. حالة النشر *
                  </label>
                  <select
                    id="yt-status"
                    value={form.publicationStatus}
                    onChange={(e) =>
                      setForm({ ...form, publicationStatus: e.target.value as PublicationStatus })
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="PUBLISHED">منشور (Published)</option>
                    <option value="DRAFT">مسودة (Draft)</option>
                    <option value="HIDDEN">مخفي (Hidden)</option>
                  </select>
                </div>
              </div>

              {/* Optional Duration Hint + Thumbnail Preview */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                <div className="flex items-center gap-3">
                  {form.thumbnailUrl ? (
                    <div className="relative shrink-0">
                      <img
                        src={form.thumbnailUrl}
                        alt="معاينة الصورة المصغرة"
                        data-testid="video-thumbnail-preview-img"
                        referrerPolicy="no-referrer"
                        className="h-16 w-28 rounded-lg border border-slate-200 object-cover bg-[#0B162C]"
                      />
                      <button
                        type="button"
                        aria-label="إزالة الصورة المصغرة المخصصة"
                        onClick={() => {
                          setManualThumbEdited(false);
                          setThumbUploadError('');
                          setForm((prev) => ({
                            ...prev,
                            thumbnailUrl: parsedYouTube?.valid && parsedYouTube.thumbnailUrl
                              ? parsedYouTube.thumbnailUrl
                              : '',
                          }));
                        }}
                        className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/80 text-white hover:bg-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-slate-400">
                      <ImagePlus className="h-5 w-5" />
                    </div>
                  )}
                  <div className="text-xs text-slate-600">
                    <div className="font-bold text-[#0B162C]">معاينة الصورة المصغرة للفيديو</div>
                    <div>
                      يمكنك رفع صورة مخصصة من جهازك (PNG / JPG / WEBP) أو الاعتماد على صورة يوتيوب التلقائية.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="yt-duration" className="text-xs font-semibold text-slate-600">
                    المدة (بالدقائق):
                  </label>
                  <input
                    id="yt-duration"
                    type="number"
                    min={0}
                    max={600}
                    value={form.durationMin}
                    onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono-num text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                >
                  {saving
                    ? 'جارٍ الحفظ...'
                    : editingVideo
                      ? 'حفظ التعديلات'
                      : 'حفظ الفيديو في المنصة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PREVIEW MODAL (Before Publishing) */}
      {previewVideo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة الفيديو"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-base font-extrabold text-[#0B162C]">{previewVideo.titleAr}</h3>
                <p className="text-xs text-slate-500">
                  معاينة المشرف قبل النشر · {CATEGORY_LABELS[previewVideo.videoType] || previewVideo.videoType}
                </p>
              </div>
              <button
                type="button"
                aria-label="إغلاق المعاينة"
                onClick={() => setPreviewVideo(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {previewVideo.youtubeVideoId ? (
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-[#0B162C]">
                  <iframe
                    title={previewVideo.titleAr}
                    src={buildPrivacyEnhancedEmbedUrl(previewVideo.youtubeVideoId)}
                    className="h-full w-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
                  لم يتم ربط رابط يوتيوب لهذا الفيديو بعد. اضغط على «تعديل» لإضافة رابط يوتيوب.
                </div>
              )}
              {previewVideo.descriptionAr && (
                <p className="text-sm leading-relaxed text-slate-600">{previewVideo.descriptionAr}</p>
              )}
              {previewVideo.pdfDriveFileId && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50/50 p-3 text-xs">
                  <div className="flex items-center gap-2 font-bold text-red-800">
                    <FileText className="h-4 w-4 text-red-600" />
                    <span>ملف PDF مرفق: {previewVideo.pdfTitle || previewVideo.titleAr}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const target = previewVideo;
                      setPreviewVideo(null);
                      setPdfPreviewVideo(target);
                    }}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                  >
                    معاينة ملف PDF
                  </button>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="font-mono-num text-xs text-slate-500" dir="ltr">
                  {previewVideo.youtubeUrl || 'No YouTube URL'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const target = previewVideo;
                    setPreviewVideo(null);
                    openEditModal(target);
                  }}
                  className="rounded-lg bg-[#0B162C] px-4 py-2 text-xs font-bold text-white hover:bg-[#2563EB]"
                >
                  تعديل هذا الفيديو
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL (Admin Quick Preview) */}
      {pdfPreviewVideo && pdfPreviewVideo.pdfDriveFileId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة ملف PDF المرفق"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
        >
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-extrabold text-[#0B162C]">
                    {pdfPreviewVideo.pdfTitle || pdfPreviewVideo.titleAr}
                  </h3>
                  <p className="truncate text-xs text-slate-500">
                    ملف PDF مرفق للفيديو: {pdfPreviewVideo.titleAr}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="إغلاق معاينة ملف PDF"
                onClick={() => setPdfPreviewVideo(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {pdfPreviewVideo.pdfDescription && (
                <p className="text-xs leading-relaxed text-slate-600">
                  {pdfPreviewVideo.pdfDescription}
                </p>
              )}
              <div className="h-[520px] w-full overflow-hidden rounded-xl border border-slate-200 bg-[#F7F9FC]">
                <iframe
                  title={`معاينة PDF: ${pdfPreviewVideo.pdfTitle || pdfPreviewVideo.titleAr}`}
                  src={buildGoogleDrivePreviewUrl(pdfPreviewVideo.pdfDriveFileId)}
                  className="h-full w-full border-0 bg-white"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <a
                  href={buildGoogleDriveViewUrl(pdfPreviewVideo.pdfDriveFileId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>فتح في Google Drive</span>
                </a>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const target = pdfPreviewVideo;
                      setPdfPreviewVideo(null);
                      openEditModal(target, true);
                    }}
                    className="rounded-lg bg-[#0B162C] px-4 py-2 text-xs font-bold text-white hover:bg-[#2563EB]"
                  >
                    تعديل بيانات ملف PDF
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REMOVE PDF CONFIRMATION MODAL (Does NOT Delete Video) */}
      {removePdfTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد إزالة ملف PDF"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-700">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
                <FileX2 className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#0B162C]">تأكيد إزالة ملف PDF المرفق</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              هل تريد إزالة ملف PDF المرفق عن الفيديو{' '}
              <strong className="text-[#0B162C]">«{removePdfTarget.titleAr}»</strong>؟
            </p>
            <p className="mt-2 rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs leading-relaxed text-slate-600">
              لن يتم حذف الفيديو أو التأثير على تشغيله أو تقدم الطلاب، وسيتم فقط فك ربط ملف PDF وإخفاء قسم المرفق من صفحة الطالب.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setRemovePdfTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={removingPdf}
                onClick={() => void handleConfirmRemovePdf()}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {removingPdf ? 'جارٍ الإزالة...' : 'تأكيد إزالة ملف PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد حذف الفيديو"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-700">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#0B162C]">تأكيد حذف الفيديو</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              هل أنت متأكد من حذف الفيديو{' '}
              <strong className="text-[#0B162C]">«{deleteTarget.titleAr}»</strong> نهائيًا؟
            </p>
            <p className="mt-2 rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs leading-relaxed text-slate-600">
              ملاحظة أمان: حذف الفيديو لن يؤثر على حسابات الطلاب أو سجلات الامتحانات أو مشتريات الكورسات أو أي بيانات أخرى بالمنصة.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'جارٍ الحذف...' : 'تأكيد الحذف النهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* VIDEO VIEWERS & WATCH-TIME ANALYTICS MODAL */}
      <AdminVideoViewersModal
        video={viewersVideo}
        onClose={() => setViewersVideo(null)}
      />

      {/* VIDEO ACTIVATION CODES & SUBSCRIPTION LOCK/UNLOCK MODAL */}
      <AdminVideoAccessCodesModal
        video={accessModalVideo}
        initialTab={accessModalTab}
        catalog={catalog}
        currentUser={currentUser}
        onClose={() => setAccessModalVideo(null)}
        onReload={onReload}
        onToast={onToast}
      />

      {/* UNITS & LESSONS FULL MANAGEMENT MODAL */}
      <AdminUnitsLessonsModal
        open={unitsModalOpen}
        onClose={() => setUnitsModalOpen(false)}
        catalog={catalog}
        onReload={onReload}
        onToast={onToast}
        canManageContent={canManageContent}
        isOwner={isOwner}
        initialTab={unitsModalTab}
        initialGradeId={unitsModalGradeId}
        initialUnitId={unitsModalUnitId}
        elevatedZIndex={modalOpen}
      />
    </div>
  );
};
