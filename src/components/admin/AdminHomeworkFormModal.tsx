import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Library,
  ListOrdered,
  Loader2,
  Lock,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { formatFileSizeAr, uploadHomeworkFile } from '../../lib/homeworkUpload.ts';
import type { AdminCatalogData } from './AdminContentPanel.tsx';
import type {
  AdminHomeworkDetail,
  HomeworkAttachmentItem,
  HomeworkModelAnswerFile,
  HomeworkPublicationStatus,
  HomeworkQuestionDefinition,
  HomeworkScope,
  ModelAnswerVisibilityPolicy,
  RubricCriterion,
} from '../../types/homework.ts';
import type { QuestionBankListItem } from '../../types/questionBank.ts';
import { QuestionBankPickerModal } from './questionBank/QuestionBankPickerModal.tsx';

interface TargetStudentMeta {
  id: number;
  fullName: string;
  phone: string | null;
  gradeIds: number[];
}

interface TargetGroupMeta {
  id: number;
  gradeId: number;
  nameAr: string;
}

interface AdminHomeworkFormModalProps {
  catalog: AdminCatalogData;
  studentsMeta: TargetStudentMeta[];
  groupsMeta: TargetGroupMeta[];
  editingId: number | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const DEFAULT_PHYSICS_RUBRIC: RubricCriterion[] = [
  { id: 'law', labelAr: 'كتابة القانون الفيزيائي الصحيح', maxPoints: 2 },
  { id: 'steps', labelAr: 'خطوات الحل والاستنتاج', maxPoints: 3 },
  { id: 'calc', labelAr: 'التعويض والحسابات العددية', maxPoints: 2 },
  { id: 'units', labelAr: 'وحدات القياس الصحيحة', maxPoints: 1 },
  { id: 'final', labelAr: 'الناتج النهائي', maxPoints: 2 },
];

const MODEL_ANSWER_POLICY_OPTIONS: Array<{ value: ModelAnswerVisibilityPolicy; label: string }> = [
  { value: 'HIDDEN', label: 'مخفي عن الطلاب' },
  { value: 'AFTER_DEADLINE', label: 'يظهر بعد انتهاء موعد التسليم' },
  { value: 'AFTER_SUBMISSION', label: 'يظهر بعد تسليم الطالب' },
  { value: 'AFTER_GRADING', label: 'يظهر بعد تصحيح الواجب' },
  { value: 'MANUAL_RELEASE', label: 'يظهر عند سماح المدرس' },
  { value: 'SCHEDULED_RELEASE', label: 'يظهر في تاريخ ووقت محدد' },
];

const ARABIC_QUESTION_ORDINALS = [
  'السؤال الأول',
  'السؤال الثاني',
  'السؤال الثالث',
  'السؤال الرابع',
  'السؤال الخامس',
  'السؤال السادس',
  'السؤال السابع',
  'السؤال الثامن',
  'السؤال التاسع',
  'السؤال العاشر',
];

function getDefaultArabicQuestionLabel(index: number): string {
  return ARABIC_QUESTION_ORDINALS[index] || `السؤال ${index + 1}`;
}

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const AdminHomeworkFormModal: React.FC<AdminHomeworkFormModalProps> = ({
  catalog,
  studentsMeta,
  groupsMeta,
  editingId,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formSection, setFormSection] = useState<'basic' | 'attachments' | 'model_answer'>('basic');

  const initialTrackId = catalog.tracks[0]?.id || 0;
  const initialGradeId =
    catalog.grades.find((g) => g.trackId === initialTrackId)?.id || catalog.grades[0]?.id || 0;

  const [titleAr, setTitleAr] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [instructionsAr, setInstructionsAr] = useState('');
  const [trackId, setTrackId] = useState<number>(initialTrackId);
  const [gradeId, setGradeId] = useState<number>(initialGradeId);
  const [unitId, setUnitId] = useState<number>(0);
  const [lessonId, setLessonId] = useState<number>(0);
  const [videoId, setVideoId] = useState<number>(0);
  const [courseId, setCourseId] = useState<number>(0);
  const [maximumGrade, setMaximumGrade] = useState<number>(10);
  const [rubric, setRubric] = useState<RubricCriterion[]>([]);
  const [questions, setQuestions] = useState<HomeworkQuestionDefinition[]>([]);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);

  const [publicationStatus, setPublicationStatus] = useState<HomeworkPublicationStatus>('PUBLISHED');
  const [publishedAt, setPublishedAt] = useState('');
  const [deadline, setDeadline] = useState('');
  const [allowLateSubmission, setAllowLateSubmission] = useState(true);
  const [allowResubmission, setAllowResubmission] = useState(true);
  const [maximumSubmissions, setMaximumSubmissions] = useState(2);
  const [allowReopenAfterGrading, setAllowReopenAfterGrading] = useState(false);

  const [assignmentScope, setAssignmentScope] = useState<HomeworkScope>('GRADE');
  const [targetStudentIds, setTargetStudentIds] = useState<number[]>([]);
  const [targetGroupIds, setTargetGroupIds] = useState<number[]>([]);

  // Homework Question Attachments (independent of lesson PDF)
  const [attachments, setAttachments] = useState<HomeworkAttachmentItem[]>([]);
  const [driveAttTitle, setDriveAttTitle] = useState('');
  const [driveAttUrl, setDriveAttUrl] = useState('');
  const [uploadingAtt, setUploadingAtt] = useState(false);

  // Model Answer state
  const [maEnabled, setMaEnabled] = useState(false);
  const [maTitle, setMaTitle] = useState('نموذج الإجابة');
  const [maNotes, setMaNotes] = useState('');
  const [maDriveUrl, setMaDriveUrl] = useState('');
  const [maFiles, setMaFiles] = useState<HomeworkModelAnswerFile[]>([]);
  const [maPolicy, setMaPolicy] = useState<ModelAnswerVisibilityPolicy>('AFTER_GRADING');
  const [maReleaseAt, setMaReleaseAt] = useState('');
  const [maManuallyReleased, setMaManuallyReleased] = useState(false);
  const [uploadingMa, setUploadingMa] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    let active = true;
    setLoading(true);
    apiRequest<AdminHomeworkDetail>(`/api/admin/homework/${editingId}`)
      .then((hw) => {
        if (!active) return;
        setTitleAr(hw.titleAr);
        setDescriptionAr(hw.descriptionAr || '');
        setInstructionsAr(hw.instructionsAr || '');
        setTrackId(hw.trackId);
        setGradeId(hw.gradeId);
        setUnitId(hw.unitId || 0);
        setLessonId(hw.lessonId || 0);
        setVideoId(hw.videoId || 0);
        setCourseId(hw.courseId || 0);
        setMaximumGrade(hw.maximumGrade);
        setRubric(hw.rubric || []);
        setQuestions(hw.questions || []);
        setPublicationStatus(hw.publicationStatus);
        setPublishedAt(toDateTimeLocal(hw.publishedAt));
        setDeadline(toDateTimeLocal(hw.deadline));
        setAllowLateSubmission(hw.allowLateSubmission);
        setAllowResubmission(hw.allowResubmission);
        setMaximumSubmissions(hw.maximumSubmissions || 1);
        setAllowReopenAfterGrading(hw.allowReopenAfterGrading);
        setAssignmentScope(hw.assignmentScope);
        setTargetStudentIds(hw.targetStudentIds || []);
        setTargetGroupIds(hw.targetGroupIds || []);
        setAttachments(hw.attachments || []);
        if (hw.modelAnswer) {
          setMaEnabled(true);
          setMaTitle(hw.modelAnswer.titleAr || 'نموذج الإجابة');
          setMaNotes(hw.modelAnswer.notesAr || '');
          setMaDriveUrl(hw.modelAnswer.driveUrl || '');
          setMaFiles(hw.modelAnswer.files || []);
          setMaPolicy(hw.modelAnswer.visibilityPolicy);
          setMaReleaseAt(toDateTimeLocal(hw.modelAnswer.releaseAt));
          setMaManuallyReleased(hw.modelAnswer.manuallyReleased);
        } else {
          setMaEnabled(false);
        }
      })
      .catch((err) => {
        if (active) setError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editingId]);

  // Compatible cascading lists
  const trackGrades = useMemo(
    () => catalog.grades.filter((g) => g.trackId === trackId),
    [catalog.grades, trackId],
  );
  const gradeUnits = useMemo(
    () => catalog.units.filter((u) => u.gradeId === gradeId),
    [catalog.units, gradeId],
  );
  const unitLessons = useMemo(
    () =>
      unitId
        ? catalog.lessons.filter((l) => l.unitId === unitId)
        : catalog.lessons.filter((l) => gradeUnits.some((u) => u.id === l.unitId)),
    [catalog.lessons, unitId, gradeUnits],
  );
  const compatibleVideos = useMemo(
    () => catalog.videos.filter((v) => v.gradeId === gradeId),
    [catalog.videos, gradeId],
  );
  const compatibleCourses = useMemo(
    () => catalog.courses.filter((c) => c.gradeId === gradeId),
    [catalog.courses, gradeId],
  );
  const compatibleGroups = useMemo(
    () => groupsMeta.filter((g) => g.gradeId === gradeId),
    [groupsMeta, gradeId],
  );
  const compatibleStudents = useMemo(
    () => studentsMeta.filter((s) => s.gradeIds.length === 0 || s.gradeIds.includes(gradeId)),
    [studentsMeta, gradeId],
  );

  const handleTrackChange = (newTrackId: number) => {
    setTrackId(newTrackId);
    const firstGrade = catalog.grades.find((g) => g.trackId === newTrackId);
    setGradeId(firstGrade?.id || 0);
    setUnitId(0);
    setLessonId(0);
    setVideoId(0);
    setCourseId(0);
    setTargetGroupIds([]);
  };

  const handleGradeChange = (newGradeId: number) => {
    setGradeId(newGradeId);
    setUnitId(0);
    setLessonId(0);
    setVideoId(0);
    setCourseId(0);
    setTargetGroupIds([]);
  };

  const handleVideoChange = (newVideoId: number) => {
    setVideoId(newVideoId);
    if (newVideoId) {
      const v = catalog.videos.find((item) => item.id === newVideoId);
      if (v) {
        if (v.lessonId) setLessonId(v.lessonId);
        if (v.unitId) setUnitId(v.unitId);
        if (v.courseId && !courseId) setCourseId(v.courseId);
      }
    }
  };

  const handleUploadAttachment = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError('');
    setUploadingAtt(true);
    try {
      for (const file of Array.from(fileList)) {
        const up = await uploadHomeworkFile(
          '/api/admin/homework/upload-file',
          file,
          'ASSIGNMENT_ATTACHMENT',
        );
        setAttachments((prev) => [
          ...prev,
          {
            attachmentType: 'FILE',
            fileName: up.fileName,
            mimeType: up.mimeType,
            sizeBytes: up.sizeBytes,
            storageKey: up.storageKey,
            previewUrl: up.previewUrl,
            viewUrl: up.previewUrl,
            displayOrder: prev.length,
          },
        ]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingAtt(false);
    }
  };

  const handleAddDriveAttachment = () => {
    setError('');
    if (!driveAttUrl.trim()) {
      setError('يرجى إدخال رابط ملف PDF من Google Drive.');
      return;
    }
    setAttachments((prev) => [
      ...prev,
      {
        attachmentType: 'GOOGLE_DRIVE_PDF',
        fileName: driveAttTitle.trim() || 'ملف أسئلة الواجب (Google Drive PDF)',
        mimeType: 'application/pdf',
        sizeBytes: 0,
        driveUrl: driveAttUrl.trim(),
        displayOrder: prev.length,
      },
    ]);
    setDriveAttTitle('');
    setDriveAttUrl('');
  };

  const handleUploadModelAnswerFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError('');
    setUploadingMa(true);
    try {
      for (const file of Array.from(fileList)) {
        const up = await uploadHomeworkFile(
          '/api/admin/homework/upload-file',
          file,
          'MODEL_ANSWER',
        );
        setMaFiles((prev) => [
          ...prev,
          {
            storageKey: up.storageKey,
            fileName: up.fileName,
            mimeType: up.mimeType,
            sizeBytes: up.sizeBytes,
            displayOrder: prev.length,
            previewUrl: up.previewUrl,
          },
        ]);
      }
      setMaEnabled(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingMa(false);
    }
  };

  const rubricSum = Number(
    rubric.reduce((sum, r) => sum + (Number(r.maxPoints) || 0), 0).toFixed(2),
  );
  const questionsSum = Number(
    questions.reduce((sum, q) => sum + (Number(q.maxGrade) || 0), 0).toFixed(2),
  );

  const handleAddQuestion = () => {
    setQuestions((prev) => {
      const idx = prev.length;
      const remaining = Number((maximumGrade - prev.reduce((s, q) => s + (Number(q.maxGrade) || 0), 0)).toFixed(2));
      return [
        ...prev,
        {
          questionNumber: idx + 1,
          labelAr: getDefaultArabicQuestionLabel(idx),
          descriptionAr: '',
          maxGrade: remaining > 0 ? remaining : 5,
          displayOrder: idx,
        },
      ];
    });
  };

  const handleAddDefaultThreeQuestions = () => {
    const total = Number(maximumGrade) > 0 ? Number(maximumGrade) : 10;
    const q1 = Number((Math.floor((total / 3) * 2) / 2).toFixed(2)) || 1;
    const q2 = q1;
    const q3 = Number((total - q1 - q2).toFixed(2));
    const gradesList = q3 > 0 ? [q1, q2, q3] : [5, 5, 10];
    if (q3 <= 0) setMaximumGrade(20);
    setQuestions(
      gradesList.map((mg, idx) => ({
        questionNumber: idx + 1,
        labelAr: getDefaultArabicQuestionLabel(idx),
        descriptionAr: '',
        maxGrade: mg,
        displayOrder: idx,
      })),
    );
  };

  const moveQuestion = (index: number, delta: -1 | 1) => {
    setQuestions((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next.map((q, i) => ({ ...q, questionNumber: i + 1, displayOrder: i }));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (titleAr.trim().length < 3) {
      setError('يرجى كتابة عنوان الواجب (3 أحرف على الأقل).');
      setFormSection('basic');
      return;
    }

    if (rubric.length > 0 && Math.abs(rubricSum - maximumGrade) > 0.01) {
      setError(
        `مجموع درجات معايير التصحيح (${rubricSum}) يجب أن يساوي الدرجة النهائية للواجب (${maximumGrade}).`,
      );
      setFormSection('basic');
      return;
    }

    if (questions.length > 0) {
      for (let i = 0; i < questions.length; i++) {
        if (!questions[i].labelAr.trim()) {
          setError(`يرجى كتابة عنوان واضح للسؤال رقم ${i + 1}.`);
          setFormSection('basic');
          return;
        }
        if (!Number.isFinite(Number(questions[i].maxGrade)) || Number(questions[i].maxGrade) <= 0) {
          setError(`الدرجة العظمى للسؤال "${questions[i].labelAr}" يجب أن تكون أكبر من صفر.`);
          setFormSection('basic');
          return;
        }
      }
      if (Math.abs(questionsSum - maximumGrade) > 0.01) {
        setError(
          `مجموع درجات الأسئلة (${questionsSum}) يجب أن يساوي الدرجة النهائية للواجب (${maximumGrade}).`,
        );
        setFormSection('basic');
        return;
      }
    }

    const payload = {
      titleAr: titleAr.trim(),
      descriptionAr: descriptionAr.trim(),
      instructionsAr: instructionsAr.trim(),
      trackId,
      gradeId,
      unitId: unitId || null,
      lessonId: lessonId || null,
      videoId: videoId || null,
      courseId: courseId || null,
      maximumGrade: Number(maximumGrade),
      rubric,
      questions: questions.map((q, idx) => ({
        ...(q.id ? { id: q.id } : {}),
        questionNumber: idx + 1,
        labelAr: q.labelAr.trim(),
        descriptionAr: (q.descriptionAr || '').trim(),
        maxGrade: Number(q.maxGrade),
        displayOrder: idx,
        ...(q.bankQuestionId ? { bankQuestionId: q.bankQuestionId } : {}),
      })),
      assignmentScope,
      publicationStatus,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      allowLateSubmission,
      allowResubmission,
      maximumSubmissions: allowResubmission ? Math.max(1, Number(maximumSubmissions)) : 1,
      allowReopenAfterGrading,
      targetStudentIds: assignmentScope === 'STUDENTS' ? targetStudentIds : [],
      targetGroupIds: assignmentScope === 'GROUP' ? targetGroupIds : [],
      attachments: attachments.map((att, idx) => ({
        attachmentType: att.attachmentType,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        storageKey: att.storageKey || null,
        driveUrl: att.driveUrl || null,
        displayOrder: idx,
      })),
      modelAnswer: maEnabled
        ? {
            titleAr: maTitle.trim() || 'نموذج الإجابة',
            notesAr: maNotes.trim(),
            driveUrl: maDriveUrl.trim() || null,
            files: maFiles.map((f, idx) => ({
              storageKey: f.storageKey,
              fileName: f.fileName,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              displayOrder: idx,
            })),
            visibilityPolicy: maPolicy,
            releaseAt: maReleaseAt ? new Date(maReleaseAt).toISOString() : null,
            manuallyReleased: maManuallyReleased,
          }
        : null,
    };

    setSaving(true);
    try {
      const res = editingId
        ? await apiRequest<{ message: string }>(`/api/admin/homework/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiRequest<{ message: string }>('/api/admin/homework', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      onSaved(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editingId ? 'تعديل الواجب' : 'إنشاء واجب جديد'}
      data-testid="admin-homework-form-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B162C] px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-extrabold">
              {editingId ? 'تعديل الواجب وإعداداته' : 'إنشاء واجب منزلي جديد'}
            </h2>
            <p className="text-[11px] text-slate-300">
              اربط الواجب بالمسار والصف والفيديو أو الكورس، وأرفق ملفات الأسئلة ونموذج الإجابة
            </p>
          </div>
          <button
            type="button"
            aria-label="إغلاق النافذة"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-[#F7F9FC] px-5 py-2.5">
          {[
            { id: 'basic' as const, label: '1. بيانات الواجب والنطاق والموعد' },
            { id: 'attachments' as const, label: `2. مرفقات أسئلة الواجب (${attachments.length})` },
            { id: 'model_answer' as const, label: `3. نموذج الإجابة ${maEnabled ? '✓' : ''}` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFormSection(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                formSection === t.id
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center p-12 text-sm text-slate-500">
            <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#2563EB]" />
            <span>جارٍ تحميل بيانات الواجب...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* SECTION 1: BASIC DETAILS, ACADEMIC LINKING, DEADLINES, TARGETING & RUBRIC */}
            {formSection === 'basic' && (
              <div className="space-y-5">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="hw-title" className="block text-xs font-bold text-[#0B162C]">
                      عنوان الواجب *
                    </label>
                    <input
                      id="hw-title"
                      required
                      value={titleAr}
                      onChange={(e) => setTitleAr(e.target.value)}
                      placeholder="مثال: واجب الدرس الأول — قانون أوم والمقاومة الكهربية"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="hw-desc" className="block text-xs font-bold text-[#0B162C]">
                      وصف مختصر للواجب
                    </label>
                    <input
                      id="hw-desc"
                      value={descriptionAr}
                      onChange={(e) => setDescriptionAr(e.target.value)}
                      placeholder="ملخص سريع يظهر للطالب في بطاقة الواجب وتحت فيديو الدرس"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="hw-instructions" className="block text-xs font-bold text-[#0B162C]">
                      تعليمات الحل التفصيلية
                    </label>
                    <textarea
                      id="hw-instructions"
                      rows={3}
                      value={instructionsAr}
                      onChange={(e) => setInstructionsAr(e.target.value)}
                      placeholder="اكتب المسائل أو التعليمات: اكتب القانون أولًا، ووضّح خطوات التعويض ووحدات القياس، ثم صوّر الحل بخط واضح..."
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Academic Linking */}
                <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
                  <div className="text-xs font-extrabold text-[#0B162C]">
                    الربط الأكاديمي (يتم التحقق تلقائيًا من توافق المسار والصف)
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label htmlFor="hw-track" className="block text-[11px] font-bold text-slate-700">
                        المسار التعليمي *
                      </label>
                      <select
                        id="hw-track"
                        value={trackId}
                        onChange={(e) => handleTrackChange(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      >
                        {catalog.tracks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nameAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="hw-grade" className="block text-[11px] font-bold text-slate-700">
                        الصف الدراسي *
                      </label>
                      <select
                        id="hw-grade"
                        value={gradeId}
                        onChange={(e) => handleGradeChange(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      >
                        {trackGrades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nameAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="hw-unit" className="block text-[11px] font-bold text-slate-700">
                        الوحدة الدراسية
                      </label>
                      <select
                        id="hw-unit"
                        value={unitId}
                        onChange={(e) => {
                          setUnitId(Number(e.target.value));
                          setLessonId(0);
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      >
                        <option value={0}>— بدون تحديد وحدة —</option>
                        {gradeUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.titleAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="hw-lesson" className="block text-[11px] font-bold text-slate-700">
                        الدرس المرتبط
                      </label>
                      <select
                        id="hw-lesson"
                        value={lessonId}
                        onChange={(e) => setLessonId(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      >
                        <option value={0}>— بدون تحديد درس —</option>
                        {unitLessons.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.titleAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="hw-video" className="block text-[11px] font-bold text-[#2563EB]">
                        الفيديو المرتبط (يظهر الواجب أسفله مباشرة)
                      </label>
                      <select
                        id="hw-video"
                        value={videoId}
                        onChange={(e) => handleVideoChange(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-2.5 py-2 text-xs"
                      >
                        <option value={0}>— غير مرتبط بفيديو محدد —</option>
                        {compatibleVideos.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.titleAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="hw-course" className="block text-[11px] font-bold text-slate-700">
                        الكورس المرتبط (اختياري)
                      </label>
                      <select
                        id="hw-course"
                        value={courseId}
                        onChange={(e) => setCourseId(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      >
                        <option value={0}>— بدون تحديد كورس —</option>
                        {compatibleCourses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.titleAr}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Grading, Dates & Policies */}
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label htmlFor="hw-max-grade" className="block text-[11px] font-bold text-slate-700">
                      الدرجة النهائية *
                    </label>
                    <input
                      id="hw-max-grade"
                      type="number"
                      min={1}
                      max={1000}
                      step="0.5"
                      value={maximumGrade}
                      onChange={(e) => setMaximumGrade(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="hw-pub-status" className="block text-[11px] font-bold text-slate-700">
                      حالة النشر
                    </label>
                    <select
                      id="hw-pub-status"
                      value={publicationStatus}
                      onChange={(e) => setPublicationStatus(e.target.value as HomeworkPublicationStatus)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                    >
                      <option value="DRAFT">مسودة (غير مرئي)</option>
                      <option value="PUBLISHED">منشور فورًا</option>
                      <option value="SCHEDULED">مجدول بتاريخ ووقت</option>
                      <option value="HIDDEN">مخفي مؤقتًا</option>
                      <option value="ARCHIVED">مؤرشف</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="hw-pub-at" className="block text-[11px] font-bold text-slate-700">
                      تاريخ النشر {publicationStatus === 'SCHEDULED' ? '*' : '(اختياري)'}
                    </label>
                    <input
                      id="hw-pub-at"
                      type="datetime-local"
                      value={publishedAt}
                      onChange={(e) => setPublishedAt(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="hw-deadline" className="block text-[11px] font-bold text-slate-700">
                      آخر موعد للتسليم
                    </label>
                    <input
                      id="hw-deadline"
                      type="datetime-local"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                    />
                  </div>
                </div>

                {/* Submission Rules */}
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={allowLateSubmission}
                      onChange={(e) => setAllowLateSubmission(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                    />
                    <span>السماح بالتسليم المتأخر بعد الموعد (مع تمييزه كمتأخر)</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={allowResubmission}
                      onChange={(e) => setAllowResubmission(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                    />
                    <span>السماح بإعادة التسليم (حفظ كل نسخة دون حذف السابقة)</span>
                  </label>

                  {allowResubmission && (
                    <div className="flex items-center gap-2 text-xs">
                      <label htmlFor="hw-max-subs" className="font-bold text-slate-700">
                        الحد الأقصى لمحاولات التسليم:
                      </label>
                      <input
                        id="hw-max-subs"
                        type="number"
                        min={1}
                        max={20}
                        value={maximumSubmissions}
                        onChange={(e) => setMaximumSubmissions(Number(e.target.value))}
                        className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono-num text-xs"
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={allowReopenAfterGrading}
                      onChange={(e) => setAllowReopenAfterGrading(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                    />
                    <span>السماح بإعادة فتح التسليم حتى بعد نشر الدرجة</span>
                  </label>
                </div>

                {/* Target Audience Scope */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="text-xs font-extrabold text-[#0B162C]">توجيه الواجب إلى:</div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      { id: 'GRADE' as const, label: 'الصف الدراسي بالكامل' },
                      { id: 'COURSE' as const, label: 'المشتركون في الكورس' },
                      { id: 'GROUP' as const, label: 'مجموعة طلابية' },
                      { id: 'STUDENTS' as const, label: 'طلاب محددون' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setAssignmentScope(s.id)}
                        className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                          assignmentScope === s.id
                            ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                            : 'border-slate-200 bg-[#F7F9FC] text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {assignmentScope === 'GROUP' && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-600">اختر المجموعات المستهدفة:</div>
                      {compatibleGroups.length === 0 ? (
                        <p className="text-xs text-amber-700">لا توجد مجموعات مسجلة لهذا الصف حاليًا.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {compatibleGroups.map((g) => {
                            const checked = targetGroupIds.includes(g.id);
                            return (
                              <label
                                key={g.id}
                                className={`cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                                  checked
                                    ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                                    : 'border-slate-200 bg-[#F7F9FC] text-slate-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setTargetGroupIds((prev) =>
                                      checked ? prev.filter((id) => id !== g.id) : [...prev, g.id],
                                    )
                                  }
                                />
                                <span>{g.nameAr}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {assignmentScope === 'STUDENTS' && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-600">
                        اختر الطلاب المستهدفين ({targetStudentIds.length} محدد):
                      </div>
                      <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-[#F7F9FC] p-2 grid gap-1.5 sm:grid-cols-2">
                        {compatibleStudents.map((s) => {
                          const checked = targetStudentIds.includes(s.id);
                          return (
                            <label
                              key={s.id}
                              className="flex cursor-pointer items-center gap-2 rounded bg-white px-2.5 py-1.5 text-xs border border-slate-100"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setTargetStudentIds((prev) =>
                                    checked ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                                  )
                                }
                              />
                              <span className="font-semibold text-[#0B162C] truncate">{s.fullName}</span>
                              {s.phone && (
                                <span className="font-mono-num text-[10px] text-slate-400" dir="ltr">
                                  {s.phone}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Optional Physics Rubric Builder */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-extrabold text-[#0B162C]">
                        معايير التصحيح التفصيلية — Rubric (اختياري)
                      </div>
                      <p className="text-[11px] text-slate-500">
                        تساعدك على توزيع الدرجة بين القانون وخطوات الحل والحسابات والوحدات والناتج النهائي.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {rubric.length === 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setRubric(DEFAULT_PHYSICS_RUBRIC);
                            setMaximumGrade(10);
                          }}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                        >
                          إضافة قالب الفيزياء الجاهز (10 درجات)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setRubric((prev) => [
                            ...prev,
                            { id: `crit_${Date.now()}`, labelAr: '', maxPoints: 2 },
                          ])
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>إضافة معيار</span>
                      </button>
                    </div>
                  </div>

                  {rubric.length > 0 && (
                    <div className="space-y-2">
                      {rubric.map((r, idx) => (
                        <div key={r.id} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={r.labelAr}
                            onChange={(e) =>
                              setRubric((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, labelAr: e.target.value } : it)),
                              )
                            }
                            placeholder="اسم المعيار (مثال: القانون الفيزيائي)"
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                          />
                          <input
                            type="number"
                            min={0.5}
                            step="0.5"
                            value={r.maxPoints}
                            onChange={(e) =>
                              setRubric((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, maxPoints: Number(e.target.value) } : it,
                                ),
                              )
                            }
                            className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono-num text-xs"
                          />
                          <button
                            type="button"
                            aria-label="حذف المعيار"
                            onClick={() => setRubric((prev) => prev.filter((_, i) => i !== idx))}
                            className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <div
                        className={`text-xs font-bold ${
                          Math.abs(rubricSum - maximumGrade) <= 0.01
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        مجموع معايير التصحيح: {rubricSum} / الدرجة النهائية: {maximumGrade}
                      </div>
                    </div>
                  )}
                </div>

                {/* Question-by-Question Breakdown Builder */}
                <div
                  data-testid="homework-questions-builder"
                  className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0B162C]">
                        <ListOrdered className="h-4 w-4 text-[#2563EB]" />
                        <span>توزيع درجات الأسئلة — تصحيح كل سؤال على حدة (اختياري)</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-600">
                        حدّد الأسئلة والدرجة العظمى لكل سؤال لتصحيح كل سؤال بدرجة وملاحظة مستقلة، دون الحاجة لإعادة كتابة أسئلة الـ PDF أو الصور.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="add-hw-from-bank-btn"
                        onClick={() => setBankPickerOpen(true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#0B162C] px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#2563EB]"
                      >
                        <Library className="h-3.5 w-3.5" />
                        <span>إضافة أسئلة من بنك الأسئلة</span>
                      </button>
                      {questions.length === 0 && (
                        <button
                          type="button"
                          onClick={handleAddDefaultThreeQuestions}
                          className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#2563EB] hover:bg-blue-50"
                        >
                          إضافة 3 أسئلة افتراضية
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="add-homework-question-btn"
                        onClick={handleAddQuestion}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#2563EB] px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#1D4ED8]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>إضافة سؤال</span>
                      </button>
                    </div>
                  </div>

                  {questions.length > 0 && (
                    <div className="space-y-2.5">
                      {questions.map((q, idx) => (
                        <div
                          key={q.id ?? `new-q-${idx}`}
                          className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0B162C] font-mono-num text-[11px] font-bold text-white">
                              {idx + 1}
                            </span>
                            <input
                              type="text"
                              value={q.labelAr}
                              onChange={(e) =>
                                setQuestions((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, labelAr: e.target.value } : it,
                                  ),
                                )
                              }
                              placeholder={`مثال: ${getDefaultArabicQuestionLabel(idx)} — المسألة الحسابية`}
                              className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold focus:border-[#2563EB] focus:outline-none"
                            />
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-bold text-slate-600">الدرجة العظمى:</span>
                              <input
                                type="number"
                                min={0.5}
                                max={1000}
                                step="0.5"
                                value={q.maxGrade}
                                onChange={(e) =>
                                  setQuestions((prev) =>
                                    prev.map((it, i) =>
                                      i === idx ? { ...it, maxGrade: Number(e.target.value) } : it,
                                    ),
                                  )
                                }
                                className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono-num text-xs font-bold text-center"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label={`تحريك السؤال ${idx + 1} لأعلى`}
                                disabled={idx === 0}
                                onClick={() => moveQuestion(idx, -1)}
                                className="rounded border border-slate-200 bg-[#F7F9FC] p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`تحريك السؤال ${idx + 1} لأسفل`}
                                disabled={idx === questions.length - 1}
                                onClick={() => moveQuestion(idx, 1)}
                                className="rounded border border-slate-200 bg-[#F7F9FC] p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              {q.hasGradingRecords ? (
                                <span
                                  title="لا يمكن حذف سؤال يحتوي على درجات تصحيح محفوظة للطلاب"
                                  className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800"
                                >
                                  <Lock className="h-3 w-3" />
                                  <span>مصحّح</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  aria-label={`حذف السؤال ${idx + 1}`}
                                  onClick={() =>
                                    setQuestions((prev) =>
                                      prev
                                        .filter((_, i) => i !== idx)
                                        .map((it, i) => ({
                                          ...it,
                                          questionNumber: i + 1,
                                          displayOrder: i,
                                        })),
                                    )
                                  }
                                  className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <input
                            type="text"
                            value={q.descriptionAr || ''}
                            onChange={(e) =>
                              setQuestions((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, descriptionAr: e.target.value } : it,
                                ),
                              )
                            }
                            placeholder="وصف مختصر أو تلميح للسؤال (اختياري — مثال: مسألة الدائرة المغلقة رقم 2 بالملف)"
                            className="w-full rounded-lg border border-slate-200 bg-[#F7F9FC] px-3 py-1.5 text-[11px] text-slate-700 focus:border-[#2563EB] focus:bg-white focus:outline-none"
                          />
                          {q.bankQuestionId && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <span className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-[#2563EB]">
                                <Library className="h-3 w-3" />
                                <span>مضاف من بنك الأسئلة (#{q.bankQuestionId})</span>
                              </span>
                              {q.questionImages && q.questionImages.length > 0 && (
                                <div className="flex items-center gap-1.5">
                                  {q.questionImages.map((img, iIdx) => (
                                    <img
                                      key={img.storageKey || iIdx}
                                      src={img.previewUrl}
                                      alt={img.fileName || `صورة ${iIdx + 1}`}
                                      className="h-10 w-12 rounded border border-slate-200 bg-slate-50 object-contain"
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                        <span
                          className={`font-extrabold ${
                            Math.abs(questionsSum - maximumGrade) <= 0.01
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          مجموع درجات الأسئلة: <span className="font-mono-num">{questionsSum}</span> / الدرجة النهائية للواجب:{' '}
                          <span className="font-mono-num">{maximumGrade}</span>
                        </span>
                        {questionsSum > 0 && Math.abs(questionsSum - maximumGrade) > 0.01 && (
                          <button
                            type="button"
                            onClick={() => setMaximumGrade(questionsSum)}
                            className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                          >
                            ضبط الدرجة النهائية = {questionsSum}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 2: HOMEWORK QUESTION ATTACHMENTS (INDEPENDENT FROM LESSON PDF) */}
            {formSection === 'attachments' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-950">
                  <strong>ملاحظة مهمة:</strong> مرفقات أسئلة الواجب مستقلة تمامًا عن «ملف الدرس PDF» المرفق بالفيديو، ولن تؤثر عليه أو تستبدله أبدًا.
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* Direct file upload */}
                  <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
                    <div className="text-xs font-extrabold text-[#0B162C]">
                      رفع ملف أسئلة (PDF أو صور) مباشرة للمنصة
                    </div>
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-5 text-center hover:border-[#2563EB]">
                      {uploadingAtt ? (
                        <Loader2 className="h-6 w-6 animate-spin text-[#2563EB]" />
                      ) : (
                        <Upload className="h-6 w-6 text-[#2563EB]" />
                      )}
                      <span className="mt-2 text-xs font-bold text-[#0B162C]">
                        {uploadingAtt ? 'جارٍ رفع الملف...' : 'اختر ملف PDF أو صور الأسئلة'}
                      </span>
                      <span className="mt-0.5 text-[11px] text-slate-500">
                        JPG, PNG, WEBP, PDF · حتى 5 ميجابايت للملف
                      </span>
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        disabled={uploadingAtt}
                        onChange={(e) => {
                          void handleUploadAttachment(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {/* Google Drive PDF link */}
                  <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
                    <div className="text-xs font-extrabold text-[#0B162C]">
                      أو إرفاق رابط Google Drive PDF للأسئلة
                    </div>
                    <input
                      type="text"
                      value={driveAttTitle}
                      onChange={(e) => setDriveAttTitle(e.target.value)}
                      placeholder="عنوان الملف (مثال: ورقة مسائل الواجب الأول)"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    />
                    <input
                      type="url"
                      dir="ltr"
                      value={driveAttUrl}
                      onChange={(e) => setDriveAttUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddDriveAttachment}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#2563EB]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>إضافة رابط Google Drive</span>
                    </button>
                  </div>
                </div>

                {/* Attachments list */}
                {attachments.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-[#0B162C]">
                      المرفقات المضافة للواجب ({attachments.length}):
                    </div>
                    {attachments.map((att, idx) => (
                      <div
                        key={att.storageKey || att.driveUrl || idx}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {att.attachmentType === 'GOOGLE_DRIVE_PDF' ||
                          att.mimeType === 'application/pdf' ? (
                            <FileText className="h-5 w-5 shrink-0 text-red-600" />
                          ) : (
                            <ImageIcon className="h-5 w-5 shrink-0 text-[#2563EB]" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-[#0B162C]">
                              {att.fileName}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {att.attachmentType === 'GOOGLE_DRIVE_PDF'
                                ? 'Google Drive PDF'
                                : formatFileSizeAr(att.sizeBytes)}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                          className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECTION 3: MODEL ANSWER CONFIGURATION */}
            {formSection === 'model_answer' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-[#F7F9FC] p-4">
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm font-extrabold text-[#0B162C]">
                    <input
                      type="checkbox"
                      checked={maEnabled}
                      onChange={(e) => setMaEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                    />
                    <span>تفعيل «نموذج الإجابة» لهذا الواجب</span>
                  </label>
                  {maEnabled && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                      <FileCheck2 className="h-3.5 w-3.5" />
                      <span>محمي بقواعد الإتاحة الخادمية</span>
                    </span>
                  )}
                </div>

                {maEnabled && (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="ma-title" className="block text-xs font-bold text-[#0B162C]">
                          عنوان نموذج الإجابة
                        </label>
                        <input
                          id="ma-title"
                          value={maTitle}
                          onChange={(e) => setMaTitle(e.target.value)}
                          placeholder="نموذج الإجابة المعتمد"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        />
                      </div>

                      <div>
                        <label htmlFor="ma-policy" className="block text-xs font-bold text-[#2563EB]">
                          سياسة إتاحة نموذج الإجابة للطلاب *
                        </label>
                        <select
                          id="ma-policy"
                          value={maPolicy}
                          onChange={(e) => setMaPolicy(e.target.value as ModelAnswerVisibilityPolicy)}
                          className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold"
                        >
                          {MODEL_ANSWER_POLICY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {maPolicy === 'SCHEDULED_RELEASE' && (
                        <div>
                          <label htmlFor="ma-release-at" className="block text-xs font-bold text-[#0B162C]">
                            تاريخ ووقت الإتاحة المجدول *
                          </label>
                          <input
                            id="ma-release-at"
                            type="datetime-local"
                            value={maReleaseAt}
                            onChange={(e) => setMaReleaseAt(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                          />
                        </div>
                      )}

                      {maPolicy === 'MANUAL_RELEASE' && (
                        <div className="flex items-center pt-4">
                          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-emerald-800">
                            <input
                              type="checkbox"
                              checked={maManuallyReleased}
                              onChange={(e) => setMaManuallyReleased(e.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                            />
                            <span>إتاحة نموذج الإجابة الآن يدويًا للطلاب</span>
                          </label>
                        </div>
                      )}
                    </div>

                    <div>
                      <label htmlFor="ma-notes" className="block text-xs font-bold text-[#0B162C]">
                        ملاحظات أو شرح إضافي مع نموذج الإجابة (اختياري)
                      </label>
                      <textarea
                        id="ma-notes"
                        rows={2}
                        value={maNotes}
                        onChange={(e) => setMaNotes(e.target.value)}
                        placeholder="تنبيهات حول الأخطاء الشائعة أو خطوات التعويض المهمة..."
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>

                    {/* Private Upload for Model Answer */}
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-extrabold text-[#0B162C]">
                            رفع ملف نموذج الإجابة (PDF أو صور) — التخزين الخاص المحمي
                          </div>
                          <p className="text-[11px] text-slate-500">
                            موصى به للخصوصية الكاملة؛ لا يُرسل الملف للطالب إلا بعد تحقق شرط الإتاحة على الخادم.
                          </p>
                        </div>
                        <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]">
                          {uploadingMa ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          <span>{uploadingMa ? 'جارٍ الرفع...' : 'رفع PDF أو صور النموذج'}</span>
                          <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            className="hidden"
                            disabled={uploadingMa}
                            onChange={(e) => {
                              void handleUploadModelAnswerFile(e.target.files);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>

                      {maFiles.length > 0 && (
                        <div className="space-y-2">
                          {maFiles.map((f, idx) => (
                            <div
                              key={f.storageKey}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                <span className="truncate font-bold text-[#0B162C]">{f.fileName}</span>
                                <span className="text-[11px] text-slate-400">
                                  ({formatFileSizeAr(f.sizeBytes)})
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {f.previewUrl && (
                                  <a
                                    href={f.previewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2563EB] hover:underline"
                                  >
                                    <span>معاينة</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMaFiles((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="rounded border border-red-200 bg-red-50 p-1 text-red-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Optional Google Drive PDF Link for Model Answer */}
                    <div className="space-y-2">
                      <label htmlFor="ma-drive-url" className="block text-xs font-bold text-[#0B162C]">
                        أو رابط Google Drive PDF لنموذج الإجابة (اختياري)
                      </label>
                      <input
                        id="ma-drive-url"
                        type="url"
                        dir="ltr"
                        value={maDriveUrl}
                        onChange={(e) => setMaDriveUrl(e.target.value)}
                        placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-xs"
                      />
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
                        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
                        <span>
                          تنبيه أمان: لا يُكشف رابط Google Drive للطلاب قبل موعد الإتاحة، ولكن أي ملف مشارك بصلاحية «Anyone with the link» قد يمكن فتحه خارج المنصة إذا تم تداول الرابط لاحقًا. للخصوصية الصارمة يُفضّل رفع الملف مباشرة عبر التخزين الخاص أعلاه.
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-[#F7F9FC] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            data-testid="save-homework-btn"
            disabled={saving || uploadingAtt || uploadingMa}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>{saving ? 'جارٍ الحفظ...' : editingId ? 'حفظ التعديلات' : 'إنشاء الواجب'}</span>
          </button>
        </div>
      </form>

      <QuestionBankPickerModal
        open={bankPickerOpen}
        mode="HOMEWORK"
        catalog={catalog}
        defaultTrackId={trackId || null}
        defaultGradeId={gradeId || null}
        defaultUnitId={unitId || null}
        defaultLessonId={lessonId || null}
        alreadyLinkedBankIds={questions
          .map((q) => q.bankQuestionId)
          .filter((id): id is number => typeof id === 'number' && id > 0)}
        onClose={() => setBankPickerOpen(false)}
        onConfirm={(selected: QuestionBankListItem[]) => {
          if (!selected.length) return;
          setQuestions((prev) => {
            const appended: HomeworkQuestionDefinition[] = selected.map((bq, i) => ({
              questionNumber: prev.length + i + 1,
              labelAr: bq.promptAr.trim()
                ? bq.promptAr.trim().slice(0, 120)
                : `سؤال مصور من بنك الأسئلة (${bq.bankCode})`,
              descriptionAr: [bq.topicAr, bq.sourceAr].filter(Boolean).join(' · '),
              maxGrade: Math.max(1, Number(bq.points || 2)),
              displayOrder: prev.length + i,
              bankQuestionId: bq.id,
              questionType: bq.questionType,
              promptSnapshotAr: bq.promptAr,
              questionImages: bq.questionImages,
            }));
            const next = [...prev, ...appended];
            const nextSum = Number(
              next.reduce((s, item) => s + (Number(item.maxGrade) || 0), 0).toFixed(2),
            );
            if (nextSum > 0) setMaximumGrade(nextSum);
            return next;
          });
        }}
      />
    </div>
  );
};
