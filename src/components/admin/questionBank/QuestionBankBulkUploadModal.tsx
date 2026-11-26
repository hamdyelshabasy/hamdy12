import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Layers,
  Merge,
  RefreshCw,
  Send,
  Split,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest } from '../../../lib/api.ts';
import type { AdminCatalogData } from '../AdminContentPanel.tsx';
import { QUESTION_TYPE_LABELS } from '../../../types/exams.ts';
import type {
  QuestionDifficulty,
  UploadedBankFileResponse,
} from '../../../types/questionBank.ts';

interface QuestionBankBulkUploadModalProps {
  open: boolean;
  catalog: AdminCatalogData;
  canReview: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface UploadedFileEntry {
  localId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
  duplicateMessage?: string;
}

interface BulkDraftRow {
  clientKey: string;
  promptAr: string;
  topicAr: string;
  questionType: string;
  difficulty: QuestionDifficulty;
  points: number;
  sourceAr: string;
  questionImages: UploadedFileEntry[];
  modelAnswerAr: string;
  modelAnswerFiles: UploadedFileEntry[];
  pairingConfirmed: boolean;
  saveStatus: 'IDLE' | 'SAVED' | 'FAILED';
  savedBankCode?: string;
  saveErrorAr?: string;
  uploadingAnswer?: boolean;
}

interface FailedUploadItem {
  localId: string;
  file: File;
  errorAr: string;
}

const MAX_BATCH_QUESTIONS = 25;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الملف المحدد'));
    reader.readAsDataURL(file);
  });
}

export const QuestionBankBulkUploadModal: React.FC<QuestionBankBulkUploadModalProps> = ({
  open,
  catalog,
  canReview,
  onClose,
  onSaved,
}) => {
  const firstGrade = catalog.grades[0];
  const [trackId, setTrackId] = useState<string>(firstGrade ? String(firstGrade.trackId) : '');
  const [gradeId, setGradeId] = useState<string>(firstGrade ? String(firstGrade.id) : '');
  const [unitId, setUnitId] = useState<string>('');
  const [lessonId, setLessonId] = useState<string>('');
  const [defaultType, setDefaultType] = useState<string>('IMAGE_DIAGRAM');
  const [defaultDifficulty, setDefaultDifficulty] = useState<QuestionDifficulty>('MEDIUM');
  const [defaultPoints, setDefaultPoints] = useState<number>(2);
  const [defaultSourceAr, setDefaultSourceAr] = useState<string>('');
  const [defaultTagsText, setDefaultTagsText] = useState<string>('');

  const [rows, setRows] = useState<BulkDraftRow[]>([]);
  const [failedUploads, setFailedUploads] = useState<FailedUploadItem[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [summaryBanner, setSummaryBanner] = useState('');

  const answerFileInputRef = useRef<HTMLInputElement | null>(null);
  const [answerUploadTargetKey, setAnswerUploadTargetKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const g0 = catalog.grades[0];
    setTrackId(g0 ? String(g0.trackId) : '');
    setGradeId(g0 ? String(g0.id) : '');
    setUnitId('');
    setLessonId('');
    setDefaultType('IMAGE_DIAGRAM');
    setDefaultDifficulty('MEDIUM');
    setDefaultPoints(2);
    setDefaultSourceAr('');
    setDefaultTagsText('');
    setRows([]);
    setFailedUploads([]);
    setUploadingCount(0);
    setSubmitting(false);
    setError('');
    setSummaryBanner('');
  }, [open, catalog.grades]);

  const filteredGrades = useMemo(
    () => (trackId ? catalog.grades.filter((g) => g.trackId === Number(trackId)) : catalog.grades),
    [catalog.grades, trackId],
  );
  const filteredUnits = useMemo(
    () => (gradeId ? catalog.units.filter((u) => u.gradeId === Number(gradeId)) : []),
    [catalog.units, gradeId],
  );
  const filteredLessons = useMemo(
    () => (unitId ? catalog.lessons.filter((l) => l.unitId === Number(unitId)) : []),
    [catalog.lessons, unitId],
  );

  if (!open) return null;

  const uploadSingleFile = async (
    file: File,
    purpose: 'QUESTION_IMAGE' | 'MODEL_ANSWER_FILE',
  ): Promise<UploadedFileEntry> => {
    const dataBase64 = await readFileAsDataUrl(file);
    const res = await apiRequest<UploadedBankFileResponse>('/api/admin/question-bank/files/upload', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        dataBase64,
        purpose,
      }),
    });
    return {
      localId: `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      storageKey: res.storageKey,
      fileName: res.fileName,
      mimeType: res.mimeType,
      sizeBytes: res.sizeBytes,
      previewUrl: res.previewUrl,
      duplicateMessage: res.duplicateWarning?.isDuplicate ? res.duplicateWarning.messageAr : undefined,
    };
  };

  const handleSelectQuestionImages = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError('');
    setSummaryBanner('');
    const incoming = Array.from(fileList);
    const activeUnsavedCount = rows.filter((r) => r.saveStatus !== 'SAVED').length;
    const remaining = Math.max(0, MAX_BATCH_QUESTIONS - activeUnsavedCount);
    if (remaining <= 0) {
      setError(`الحد الأقصى للدفعة الواحدة هو ${MAX_BATCH_QUESTIONS} سؤالًا. احفظ الدفعة الحالية أولًا.`);
      return;
    }

    const batch = incoming.slice(0, remaining);
    if (incoming.length > remaining) {
      setError(`تم قبول أول ${remaining} صورة فقط (الحد الأقصى ${MAX_BATCH_QUESTIONS} سؤالًا في الدفعة).`);
    }

    setUploadingCount((c) => c + batch.length);
    for (const file of batch) {
      try {
        const uploaded = await uploadSingleFile(file, 'QUESTION_IMAGE');
        const newRow: BulkDraftRow = {
          clientKey: `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          promptAr: '',
          topicAr: '',
          questionType: defaultType,
          difficulty: defaultDifficulty,
          points: defaultPoints,
          sourceAr: defaultSourceAr,
          questionImages: [uploaded],
          modelAnswerAr: '',
          modelAnswerFiles: [],
          pairingConfirmed: true,
          saveStatus: 'IDLE',
        };
        setRows((prev) => [...prev, newRow]);
      } catch (err) {
        setFailedUploads((prev) => [
          ...prev,
          {
            localId: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            file,
            errorAr: (err as Error).message || 'تعذر رفع الصورة',
          },
        ]);
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    }
  };

  const retryFailedFileUpload = async (item: FailedUploadItem) => {
    setFailedUploads((prev) => prev.filter((f) => f.localId !== item.localId));
    setUploadingCount((c) => c + 1);
    try {
      const uploaded = await uploadSingleFile(item.file, 'QUESTION_IMAGE');
      setRows((prev) => [
        ...prev,
        {
          clientKey: `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          promptAr: '',
          topicAr: '',
          questionType: defaultType,
          difficulty: defaultDifficulty,
          points: defaultPoints,
          sourceAr: defaultSourceAr,
          questionImages: [uploaded],
          modelAnswerAr: '',
          modelAnswerFiles: [],
          pairingConfirmed: true,
          saveStatus: 'IDLE',
        },
      ]);
    } catch (err) {
      setFailedUploads((prev) => [
        ...prev,
        {
          localId: item.localId,
          file: item.file,
          errorAr: (err as Error).message || 'تعذر رفع الصورة',
        },
      ]);
    } finally {
      setUploadingCount((c) => Math.max(0, c - 1));
    }
  };

  const handleAttachModelAnswerFiles = async (fileList: FileList | null) => {
    const targetKey = answerUploadTargetKey;
    setAnswerUploadTargetKey(null);
    if (!targetKey || !fileList || fileList.length === 0) return;

    const files = Array.from(fileList).slice(0, 6);
    setRows((prev) =>
      prev.map((r) => (r.clientKey === targetKey ? { ...r, uploadingAnswer: true } : r)),
    );

    const uploadedEntries: UploadedFileEntry[] = [];
    for (const f of files) {
      try {
        const entry = await uploadSingleFile(f, 'MODEL_ANSWER_FILE');
        uploadedEntries.push(entry);
      } catch (err) {
        setError(`تعذر رفع ملف الإجابة (${f.name}): ${(err as Error).message}`);
      }
    }

    setRows((prev) =>
      prev.map((r) =>
        r.clientKey === targetKey
          ? {
              ...r,
              uploadingAnswer: false,
              modelAnswerFiles: [...r.modelAnswerFiles, ...uploadedEntries].slice(0, 6),
              pairingConfirmed: true,
            }
          : r,
      ),
    );
  };

  const mergeWithPrevious = (idx: number) => {
    if (idx <= 0) return;
    setRows((prev) => {
      const target = prev[idx - 1];
      const current = prev[idx];
      if (!target || !current || target.saveStatus === 'SAVED' || current.saveStatus === 'SAVED') {
        return prev;
      }
      if (target.questionImages.length + current.questionImages.length > 6) {
        setError('لا يمكن دمج أكثر من 6 صور في سؤال واحد.');
        return prev;
      }
      const merged: BulkDraftRow = {
        ...target,
        questionImages: [...target.questionImages, ...current.questionImages],
        modelAnswerFiles: [...target.modelAnswerFiles, ...current.modelAnswerFiles].slice(0, 6),
        promptAr: [target.promptAr, current.promptAr].filter((s) => s.trim()).join('\n'),
        modelAnswerAr: [target.modelAnswerAr, current.modelAnswerAr].filter((s) => s.trim()).join('\n'),
      };
      const next = [...prev];
      next[idx - 1] = merged;
      next.splice(idx, 1);
      return next;
    });
  };

  const splitImageToOwnRow = (rowIdx: number, imgIdx: number) => {
    setRows((prev) => {
      const row = prev[rowIdx];
      if (!row || row.questionImages.length <= 1 || row.saveStatus === 'SAVED') return prev;
      const [removed] = row.questionImages.slice(imgIdx, imgIdx + 1);
      const remaining = row.questionImages.filter((_, i) => i !== imgIdx);
      const splitRow: BulkDraftRow = {
        clientKey: `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        promptAr: '',
        topicAr: row.topicAr,
        questionType: row.questionType,
        difficulty: row.difficulty,
        points: row.points,
        sourceAr: row.sourceAr,
        questionImages: [removed],
        modelAnswerAr: '',
        modelAnswerFiles: [],
        pairingConfirmed: true,
        saveStatus: 'IDLE',
      };
      const next = [...prev];
      next[rowIdx] = { ...row, questionImages: remaining };
      next.splice(rowIdx + 1, 0, splitRow);
      return next;
    });
  };

  const applyBulkMetadataToAll = () => {
    setRows((prev) =>
      prev.map((r) =>
        r.saveStatus === 'SAVED'
          ? r
          : {
              ...r,
              questionType: defaultType,
              difficulty: defaultDifficulty,
              points: defaultPoints,
              sourceAr: defaultSourceAr,
            },
      ),
    );
    setSummaryBanner('تم تطبيق التصنيف الافتراضي (النوع، الصعوبة، الدرجة، المصدر) على جميع المسودات غير المحفوظة.');
  };

  const pendingRows = rows.filter((r) => r.saveStatus !== 'SAVED');
  const savedCount = rows.filter((r) => r.saveStatus === 'SAVED').length;

  const handleSaveBatch = async (submitForReview: boolean) => {
    if (submitting || uploadingCount > 0) return;
    setError('');
    setSummaryBanner('');

    if (!gradeId) {
      setError('يرجى اختيار الصف الدراسي قبل حفظ الدفعة.');
      return;
    }
    if (pendingRows.length === 0) {
      setError('لا توجد مسودات جديدة لحفظها. ارفع صور الأسئلة أولًا.');
      return;
    }

    const tags = defaultTagsText
      .split(/[,،]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const res = await apiRequest<{
        succeededCount: number;
        failedCount: number;
        message: string;
        results: Array<{
          index: number;
          clientKey?: string;
          ok: boolean;
          id?: number;
          bankCode?: string;
          errorAr?: string;
        }>;
      }>('/api/admin/question-bank/bulk', {
        method: 'POST',
        body: JSON.stringify({
          defaults: {
            trackId: trackId ? Number(trackId) : null,
            gradeId: Number(gradeId),
            unitId: unitId ? Number(unitId) : null,
            lessonId: lessonId ? Number(lessonId) : null,
            difficulty: defaultDifficulty,
            questionType: defaultType,
            points: Number(defaultPoints) || 2,
            sourceAr: defaultSourceAr.trim(),
            tags,
          },
          submitForReview,
          items: pendingRows.map((r) => ({
            clientKey: r.clientKey,
            questionType: r.questionType,
            difficulty: r.difficulty,
            promptAr: r.promptAr,
            points: r.points,
            topicAr: r.topicAr,
            sourceAr: r.sourceAr,
            questionImageKeys: r.questionImages.map((img) => img.storageKey),
            modelAnswerAr: r.modelAnswerAr,
            modelAnswerFileKeys: r.modelAnswerFiles.map((f) => f.storageKey),
            pairingConfirmed: r.pairingConfirmed,
          })),
        }),
      });

      const byClientKey = new Map(res.results.map((r) => [r.clientKey, r]));
      setRows((prev) =>
        prev.map((row) => {
          const outcome = byClientKey.get(row.clientKey);
          if (!outcome) return row;
          return outcome.ok
            ? {
                ...row,
                saveStatus: 'SAVED',
                savedBankCode: outcome.bankCode,
                saveErrorAr: undefined,
              }
            : {
                ...row,
                saveStatus: 'FAILED',
                saveErrorAr: outcome.errorAr || 'تعذر حفظ السؤال',
              };
        }),
      );

      if (res.failedCount === 0) {
        onSaved(res.message);
        onClose();
      } else {
        setSummaryBanner(res.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="الرفع الجماعي لصور الأسئلة"
      data-testid="question-bank-bulk-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
    >
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B162C] px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <Layers className="h-5 w-5 text-[#60A5FA]" />
            <div>
              <h2 className="text-base font-extrabold">
                الرفع الجماعي لصور الأسئلة (حتى {MAX_BATCH_QUESTIONS} سؤالًا في الدفعة)
              </h2>
              <p className="mt-0.5 text-xs text-slate-300">
                كل صورة تنشئ مسودة سؤال مستقل تلقائيًا، ويمكنك دمج صفحتين في سؤال واحد أو إرفاق الإجابة النموذجية لكل سؤال يدويًا.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Hidden input for explicit manual model answer attachment */}
        <input
          ref={answerFileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            void handleAttachModelAnswerFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Bulk Classification Settings */}
          <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold text-[#0B162C]">
                1. التصنيف الافتراضي للدفعة (المسار، الصف، الوحدة، الدرس، الصعوبة)
              </div>
              {pendingRows.length > 0 && (
                <button
                  type="button"
                  onClick={applyBulkMetadataToAll}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[11px] font-bold text-[#2563EB] hover:bg-blue-50"
                >
                  تطبيق الإعدادات على كل المسودات ({pendingRows.length})
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">المسار</label>
                <select
                  value={trackId}
                  onChange={(e) => {
                    const nextTrack = e.target.value;
                    setTrackId(nextTrack);
                    const g = catalog.grades.find((x) => !nextTrack || x.trackId === Number(nextTrack));
                    setGradeId(g ? String(g.id) : '');
                    setUnitId('');
                    setLessonId('');
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">كل المسارات</option>
                  {catalog.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">الصف الدراسي *</label>
                <select
                  value={gradeId}
                  onChange={(e) => {
                    setGradeId(e.target.value);
                    setUnitId('');
                    setLessonId('');
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">اختر الصف...</option>
                  {filteredGrades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nameAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">الوحدة / الفصل</label>
                <select
                  value={unitId}
                  onChange={(e) => {
                    setUnitId(e.target.value);
                    setLessonId('');
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">— اختياري —</option>
                  {filteredUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.titleAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">الدرس</label>
                <select
                  value={lessonId}
                  onChange={(e) => setLessonId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">— اختياري —</option>
                  {filteredLessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.titleAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">النوع الافتراضي</label>
                <select
                  value={defaultType}
                  onChange={(e) => setDefaultType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="IMAGE_DIAGRAM">سؤال مصور / رسم بياني</option>
                  <option value="PHYSICS_PROBLEM">مسألة فيزيائية (مقالي / خطوات)</option>
                  <option value="MCQ">اختيار من متعدد (MCQ)</option>
                  <option value="ESSAY">مقالي / تعليل</option>
                  <option value="SHORT_ANSWER">إجابة قصيرة</option>
                  <option value="NUMERIC">رقمي</option>
                  <option value="TRUE_FALSE">صح وخطأ</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">الصعوبة الافتراضية</label>
                <select
                  value={defaultDifficulty}
                  onChange={(e) => setDefaultDifficulty(e.target.value as QuestionDifficulty)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="EASY">سهل</option>
                  <option value="MEDIUM">متوسط</option>
                  <option value="HARD">متقدم / صعب</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">الدرجة الافتراضية</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={defaultPoints}
                  onChange={(e) => setDefaultPoints(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono-num text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">المصدر (كتاب / امتحان)</label>
                <input
                  type="text"
                  value={defaultSourceAr}
                  onChange={(e) => setDefaultSourceAr(e.target.value)}
                  placeholder="مثال: كتاب الامتحان — فصل 1"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">
                وسوم مشتركة (افصل بينها بفاصلة)
              </label>
              <input
                type="text"
                value={defaultTagsText}
                onChange={(e) => setDefaultTagsText(e.target.value)}
                placeholder="مثال: كيرشوف، دوائر كهربية، مراجعة نهائية"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
            </div>
          </div>

          {/* Explicit Pairing Notice + Upload Dropzone */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-extrabold text-[#0B162C]">
                2. ارفع صور الأسئلة (PNG / JPG / WebP — حتى 3 ميجابايت للصورة)
              </div>
              <p className="text-[11px] text-slate-600">
                ربط الإجابات النموذجية يتم يدويًا وصراحة لكل سؤال أدناه لضمان عدم حدوث أي خلط بين صور الأسئلة وإجاباتها.
              </p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#1D4ED8]">
              <Upload className="h-4 w-4" />
              <span>
                {uploadingCount > 0 ? `جارٍ رفع ${uploadingCount} ملف...` : 'اختيار صور الأسئلة'}
              </span>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                data-testid="bulk-question-images-input"
                onChange={(e) => {
                  void handleSelectQuestionImages(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {summaryBanner && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{summaryBanner}</span>
            </div>
          )}

          {/* Failed File Uploads Retry Strip */}
          {failedUploads.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-2">
              <div className="text-xs font-bold text-amber-900">
                ملفات فشل رفعها ({failedUploads.length}) — يمكنك إعادة المحاولة لكل ملف:
              </div>
              <div className="space-y-1.5">
                {failedUploads.map((f) => (
                  <div
                    key={f.localId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs border border-amber-200"
                  >
                    <div>
                      <span className="font-bold text-[#0B162C]">{f.file.name}</span>
                      <span className="mr-2 text-red-700">— {f.errorAr}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void retryFailedFileUpload(f)}
                        className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>إعادة الرفع</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFailedUploads((prev) => prev.filter((x) => x.localId !== f.localId))
                        }
                        className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                      >
                        تجاهل
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Draft Questions Workspace */}
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 py-12 text-center">
              <ImageIcon className="mx-auto h-9 w-9 text-slate-400" />
              <p className="mt-2 text-sm font-bold text-[#0B162C]">
                لم يتم رفع صور أسئلة بعد
              </p>
              <p className="mt-1 text-xs text-slate-500">
                اختر مجموعة من صور مسائل الفيزياء؛ ستظهر هنا كمسودات جاهزة للدمج أو إرفاق الإجابات النموذجية.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-700">
                <span>
                  المسودات في هذه الدفعة: {rows.length} (تم حفظ: {savedCount} · بانتظار الحفظ:{' '}
                  {pendingRows.length})
                </span>
              </div>

              {rows.map((row, idx) => {
                const isSaved = row.saveStatus === 'SAVED';
                const isFailed = row.saveStatus === 'FAILED';
                return (
                  <div
                    key={row.clientKey}
                    data-testid={`bulk-row-${idx}`}
                    className={`rounded-xl border p-4 space-y-3 ${
                      isSaved
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : isFailed
                          ? 'border-red-300 bg-red-50/40'
                          : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0B162C] font-mono-num text-xs font-bold text-white">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-extrabold text-[#0B162C]">
                          {isSaved
                            ? `تم الحفظ بنجاح (${row.savedBankCode})`
                            : `مسودة سؤال (${row.questionImages.length} صورة)`}
                        </span>
                        {isFailed && row.saveErrorAr && (
                          <span className="text-xs font-bold text-red-700">— {row.saveErrorAr}</span>
                        )}
                      </div>

                      {!isSaved && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {idx > 0 && rows[idx - 1]?.saveStatus !== 'SAVED' && (
                            <button
                              type="button"
                              onClick={() => mergeWithPrevious(idx)}
                              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                              title="دمج صور هذا السؤال مع السؤال السابق كسؤال متعدد الصفحات"
                            >
                              <Merge className="h-3.5 w-3.5" />
                              <span>دمج مع السؤال السابق</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setRows((prev) => prev.filter((r) => r.clientKey !== row.clientKey))
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>إزالة</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-12">
                      {/* Question Images Column */}
                      <div className="lg:col-span-5 space-y-2">
                        <div className="text-[11px] font-bold text-slate-600">صور السؤال:</div>
                        <div className="grid grid-cols-2 gap-2">
                          {row.questionImages.map((img, imgIdx) => (
                            <div
                              key={img.localId}
                              className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 space-y-1"
                            >
                              <img
                                src={img.previewUrl}
                                alt={img.fileName}
                                className="h-28 w-full rounded object-contain bg-white"
                              />
                              <div className="truncate text-[10px] font-semibold text-slate-600">
                                {img.fileName}
                              </div>
                              {img.duplicateMessage && (
                                <div className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                  تنبيه: صورة مكررة سابقًا
                                </div>
                              )}
                              {!isSaved && row.questionImages.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => splitImageToOwnRow(idx, imgIdx)}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-[#2563EB] hover:underline"
                                >
                                  <Split className="h-3 w-3" />
                                  <span>فصل كسؤال مستقل</span>
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Metadata + Explicit Model Answer Column */}
                      <div className="lg:col-span-7 space-y-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <select
                            disabled={isSaved}
                            value={row.questionType}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.clientKey === row.clientKey
                                    ? { ...r, questionType: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                          >
                            {Object.entries(QUESTION_TYPE_LABELS).map(([k, lbl]) => (
                              <option key={k} value={k}>
                                {lbl}
                              </option>
                            ))}
                          </select>

                          <select
                            disabled={isSaved}
                            value={row.difficulty}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.clientKey === row.clientKey
                                    ? { ...r, difficulty: e.target.value as QuestionDifficulty }
                                    : r,
                                ),
                              )
                            }
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="EASY">سهل</option>
                            <option value="MEDIUM">متوسط</option>
                            <option value="HARD">صعب</option>
                          </select>

                          <input
                            type="number"
                            disabled={isSaved}
                            min={1}
                            max={200}
                            value={row.points}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.clientKey === row.clientKey
                                    ? { ...r, points: Math.max(1, Number(e.target.value) || 1) }
                                    : r,
                                ),
                              )
                            }
                            placeholder="الدرجة"
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono-num text-xs"
                          />
                        </div>

                        <input
                          type="text"
                          disabled={isSaved}
                          value={row.promptAr}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.clientKey === row.clientKey ? { ...r, promptAr: e.target.value } : r,
                              ),
                            )
                          }
                          placeholder="نص اختياري للسؤال (يمكن تركه فارغًا للاعتماد على الصورة فقط)"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />

                        {/* Explicit Manual Model Answer Attachment */}
                        <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-[#0B162C]">
                              الإجابة النموذجية لهذا السؤال (ربط يدوي صريح — اختياري)
                            </span>
                            {!isSaved && (
                              <button
                                type="button"
                                disabled={row.uploadingAnswer}
                                onClick={() => {
                                  setAnswerUploadTargetKey(row.clientKey);
                                  answerFileInputRef.current?.click();
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                <Upload className="h-3 w-3" />
                                <span>
                                  {row.uploadingAnswer
                                    ? 'جارٍ رفع الإجابة...'
                                    : 'إرفاق صورة / PDF للإجابة'}
                                </span>
                              </button>
                            )}
                          </div>

                          <input
                            type="text"
                            disabled={isSaved}
                            value={row.modelAnswerAr}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.clientKey === row.clientKey
                                    ? { ...r, modelAnswerAr: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            placeholder="إجابة نصية مختصرة أو خطوات الحل (اختياري)..."
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                          />

                          {row.modelAnswerFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {row.modelAnswerFiles.map((mf) => (
                                <div
                                  key={mf.localId}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px]"
                                >
                                  {mf.mimeType === 'application/pdf' ? (
                                    <FileText className="h-3.5 w-3.5 text-red-600" />
                                  ) : (
                                    <img
                                      src={mf.previewUrl}
                                      alt={mf.fileName}
                                      className="h-6 w-6 rounded object-cover"
                                    />
                                  )}
                                  <span className="max-w-[130px] truncate font-semibold text-slate-700">
                                    {mf.fileName}
                                  </span>
                                  {!isSaved && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setRows((prev) =>
                                          prev.map((r) =>
                                            r.clientKey === row.clientKey
                                              ? {
                                                  ...r,
                                                  modelAnswerFiles: r.modelAnswerFiles.filter(
                                                    (x) => x.localId !== mf.localId,
                                                  ),
                                                }
                                              : r,
                                          ),
                                        )
                                      }
                                      className="text-red-600 hover:text-red-800"
                                      aria-label="حذف ملف الإجابة"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="text-xs text-slate-600">
            {pendingRows.length > 0
              ? `جاهز لحفظ ${pendingRows.length} مسودة جديدة (إعادة المحاولة لا تُكرر العناصر المحفوظة سابقًا).`
              : 'ارفع صور الأسئلة لبدء تجهيز الدفعة.'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              إغلاق
            </button>
            <button
              type="button"
              disabled={submitting || uploadingCount > 0 || pendingRows.length === 0}
              onClick={() => void handleSaveBatch(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-[#0B162C] hover:bg-slate-100 disabled:opacity-50"
            >
              {submitting ? 'جارٍ الحفظ...' : `حفظ كمسودات (${pendingRows.length})`}
            </button>
            <button
              type="button"
              disabled={submitting || uploadingCount > 0 || pendingRows.length === 0}
              data-testid="bulk-submit-for-review-btn"
              onClick={() => void handleSaveBatch(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {canReview ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              <span>
                {submitting
                  ? 'جارٍ الحفظ...'
                  : canReview
                    ? `حفظ واعتماد الكل (${pendingRows.length})`
                    : `حفظ وإرسال للمراجعة (${pendingRows.length})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
