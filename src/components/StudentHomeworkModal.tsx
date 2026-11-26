import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Award,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  ListOrdered,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import {
  formatFileSizeAr,
  formatRemainingTimeAr,
  getStudentStatusBadgeClass,
  uploadHomeworkFile,
} from '../lib/homeworkUpload.ts';
import type { StudentHomeworkDetailResponse } from '../types/homework.ts';
import { QuestionImageGallery } from './QuestionImageGallery.tsx';

interface PendingUploadItem {
  localId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey?: string;
  previewUrl?: string;
  status: 'UPLOADING' | 'UPLOADED' | 'ERROR';
  progress: number;
  errorAr?: string;
}

interface StudentHomeworkModalProps {
  assignmentId: number;
  onClose: () => void;
  onSubmitted?: () => void;
}

export const StudentHomeworkModal: React.FC<StudentHomeworkModalProps> = ({
  assignmentId,
  onClose,
  onSubmitted,
}) => {
  const [detail, setDetail] = useState<StudentHomeworkDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'submit' | 'result' | 'model_answer'>('submit');

  // Submission composer state
  const [writtenAnswer, setWrittenAnswer] = useState('');
  const [structuredAnswers, setStructuredAnswers] = useState<
    Record<number, { selectedChoiceId?: string | null; textAnswer?: string }>
  >({});
  const [files, setFiles] = useState<PendingUploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [previewAttachmentUrl, setPreviewAttachmentUrl] = useState<{
    title: string;
    url: string;
    isPdf: boolean;
  } | null>(null);

  const submissionKeyRef = useRef<string>(`sub_${assignmentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replacingLocalId, setReplacingLocalId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<StudentHomeworkDetailResponse>(`/api/student/homework/${assignmentId}`);
      setDetail(res);

      // Pre-fill draft if student has an in-progress draft
      const draft = res.submissions.find((s) => s.status === 'DRAFT');
      if (draft) {
        setWrittenAnswer(draft.writtenAnswer || '');
        const draftAnsMap: Record<number, { selectedChoiceId?: string | null; textAnswer?: string }> = {};
        for (const sa of draft.structuredAnswers || []) {
          draftAnsMap[sa.questionId] = {
            selectedChoiceId: sa.selectedChoiceId ?? null,
            textAnswer: sa.textAnswer || '',
          };
        }
        setStructuredAnswers(draftAnsMap);
        setFiles(
          draft.files.map((f) => ({
            localId: `draft_${f.storageKey}`,
            fileName: f.fileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            storageKey: f.storageKey,
            previewUrl: f.previewUrl,
            status: 'UPLOADED',
            progress: 100,
          })),
        );
      }

      if (res.assignment.statusCode === 'GRADED' && !res.submissionPermission.canSubmit) {
        setActiveTab('result');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setSubmitFeedback(null);
    const incoming = Array.from(fileList);
    const remainingSlots = Math.max(0, 8 - files.length);
    if (incoming.length > remainingSlots) {
      setSubmitFeedback({
        type: 'error',
        text: `الحد الأقصى هو 8 ملفات في التسليم الواحد. يمكنك إضافة ${remainingSlots} ملف فقط.`,
      });
    }
    const batch = incoming.slice(0, remainingSlots);

    for (const file of batch) {
      const localId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setFiles((prev) => [
        ...prev,
        {
          localId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          status: 'UPLOADING',
          progress: 10,
        },
      ]);

      try {
        const uploaded = await uploadHomeworkFile(
          '/api/student/homework/upload-file',
          file,
          'SUBMISSION_FILE',
          (pct) => {
            setFiles((prev) =>
              prev.map((item) => (item.localId === localId ? { ...item, progress: pct } : item)),
            );
          },
        );

        setFiles((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  fileName: uploaded.fileName,
                  mimeType: uploaded.mimeType,
                  sizeBytes: uploaded.sizeBytes,
                  storageKey: uploaded.storageKey,
                  previewUrl: uploaded.previewUrl,
                  status: 'UPLOADED',
                  progress: 100,
                }
              : item,
          ),
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  status: 'ERROR',
                  progress: 0,
                  errorAr: (err as Error).message,
                }
              : item,
          ),
        );
      }
    }
  };

  const handleReplaceFile = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    const targetId = replacingLocalId;
    setReplacingLocalId(null);
    if (!file || !targetId) return;

    setFiles((prev) =>
      prev.map((item) =>
        item.localId === targetId
          ? {
              ...item,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              status: 'UPLOADING',
              progress: 10,
              errorAr: undefined,
            }
          : item,
      ),
    );

    try {
      const uploaded = await uploadHomeworkFile(
        '/api/student/homework/upload-file',
        file,
        'SUBMISSION_FILE',
        (pct) => {
          setFiles((prev) =>
            prev.map((item) => (item.localId === targetId ? { ...item, progress: pct } : item)),
          );
        },
      );
      setFiles((prev) =>
        prev.map((item) =>
          item.localId === targetId
            ? {
                ...item,
                fileName: uploaded.fileName,
                mimeType: uploaded.mimeType,
                sizeBytes: uploaded.sizeBytes,
                storageKey: uploaded.storageKey,
                previewUrl: uploaded.previewUrl,
                status: 'UPLOADED',
                progress: 100,
              }
            : item,
        ),
      );
    } catch (err) {
      setFiles((prev) =>
        prev.map((item) =>
          item.localId === targetId
            ? { ...item, status: 'ERROR', progress: 0, errorAr: (err as Error).message }
            : item,
        ),
      );
    }
  };

  const moveFile = (index: number, delta: -1 | 1) => {
    setFiles((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const removeFile = (localId: string) => {
    setFiles((prev) => prev.filter((f) => f.localId !== localId));
  };

  const handleSubmit = async (isDraft: boolean) => {
    setSubmitFeedback(null);
    const uploadingAny = files.some((f) => f.status === 'UPLOADING');
    if (uploadingAny) {
      setSubmitFeedback({
        type: 'error',
        text: 'يرجى الانتظار حتى يكتمل رفع جميع الملفات قبل التسليم.',
      });
      return;
    }

    const failedAny = files.some((f) => f.status === 'ERROR');
    if (failedAny) {
      setSubmitFeedback({
        type: 'error',
        text: 'توجد ملفات فشل رفعها. يرجى حذفها أو استبدالها قبل التسليم.',
      });
      return;
    }

    const uploadedFiles = files
      .filter((f) => f.status === 'UPLOADED' && f.storageKey)
      .map((f, idx) => ({
        storageKey: f.storageKey!,
        fileName: f.fileName,
        displayOrder: idx,
      }));

    const structuredAnswersPayload = Object.entries(structuredAnswers)
      .map(([qid, ans]) => ({
        questionId: Number(qid),
        selectedChoiceId: ans.selectedChoiceId ?? null,
        textAnswer: (ans.textAnswer || '').trim(),
      }))
      .filter(
        (item) =>
          Number.isInteger(item.questionId) &&
          item.questionId > 0 &&
          (Boolean(item.selectedChoiceId) || Boolean(item.textAnswer)),
      );

    if (
      !isDraft &&
      uploadedFiles.length === 0 &&
      !writtenAnswer.trim() &&
      structuredAnswersPayload.length === 0
    ) {
      setSubmitFeedback({
        type: 'error',
        text: 'يرجى اختيار إجابات الأسئلة أو رفع صور الحل / PDF أو كتابة إجابتك قبل التسليم النهائي.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string; version: number }>(
        `/api/student/homework/${assignmentId}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({
            writtenAnswer,
            structuredAnswers: structuredAnswersPayload,
            isDraft,
            clientSubmissionKey: isDraft ? undefined : submissionKeyRef.current,
            files: uploadedFiles,
          }),
        },
      );
      setSubmitFeedback({ type: 'success', text: res.message });
      if (!isDraft) {
        // Generate a fresh idempotency key for any future resubmission version
        submissionKeyRef.current = `sub_${assignmentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        setFiles([]);
        setWrittenAnswer('');
        setStructuredAnswers({});
      }
      await loadDetail();
      onSubmitted?.();
    } catch (err) {
      setSubmitFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const latestSubmitted = detail?.submissions.find((s) => s.status !== 'DRAFT') || null;
  const remaining = formatRemainingTimeAr(detail?.assignment.deadline, detail?.serverNow);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل الواجب وتسليم الحل"
      data-testid="student-homework-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B162C] px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#93C5FD]">
              {detail?.assignment.trackNameAr && <span>{detail.assignment.trackNameAr}</span>}
              {detail?.assignment.gradeNameAr && <span>· {detail.assignment.gradeNameAr}</span>}
              {detail?.assignment.lessonTitleAr && <span>· {detail.assignment.lessonTitleAr}</span>}
            </div>
            <h2 className="mt-1 text-base font-extrabold sm:text-lg">
              {detail?.assignment.titleAr || 'تفاصيل الواجب'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة الواجب"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center p-12 text-sm text-slate-500">
            <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#2563EB]" />
            <span>جارٍ تحميل تفاصيل الواجب...</span>
          </div>
        ) : error || !detail ? (
          <div className="p-6">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error || 'تعذر تحميل الواجب'}
            </div>
          </div>
        ) : (
          <>
            {/* Top Info Strip & Tabs */}
            <div className="border-b border-slate-200 bg-[#F7F9FC] px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md border px-2.5 py-0.5 font-bold ${getStudentStatusBadgeClass(
                      detail.assignment.statusCode,
                    )}`}
                  >
                    {detail.assignment.statusLabelAr}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-2.5 py-0.5 font-mono-num font-bold text-[#0B162C]">
                    الدرجة النهائية: {detail.assignment.maximumGrade}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 font-semibold ${
                      remaining.isExpired
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : remaining.isUrgent
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    <span>{remaining.text}</span>
                  </span>
                </div>
                {detail.assignment.deadline && (
                  <span className="text-[11px] text-slate-500">
                    آخر موعد: {formatDateTimeAr(detail.assignment.deadline)}
                  </span>
                )}
              </div>

              {/* Navigation Tabs */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('submit')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    activeTab === 'submit'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  التعليمات وتسليم الحل
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('result')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    activeTab === 'result'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  تسليماتي والنتيجة ({detail.submissions.filter((s) => s.status !== 'DRAFT').length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('model_answer')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    activeTab === 'model_answer'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {detail.modelAnswer.isReleased ? (
                    <FileCheck2 className="h-3.5 w-3.5" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" />
                  )}
                  <span>نموذج الإجابة</span>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* TAB 1: INSTRUCTIONS & SUBMIT */}
              {activeTab === 'submit' && (
                <>
                  {/* Returned for Revision Alert */}
                  {latestSubmitted?.status === 'RETURNED_FOR_REVISION' && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-1">
                      <div className="font-extrabold flex items-center gap-1.5">
                        <RefreshCw className="h-4 w-4 text-amber-700" />
                        <span>أعاد المدرس هذا الواجب للمراجعة وإعادة التسليم</span>
                      </div>
                      {latestSubmitted.revisionInstructions && (
                        <p className="leading-relaxed">{latestSubmitted.revisionInstructions}</p>
                      )}
                      {latestSubmitted.teacherFeedback &&
                        latestSubmitted.teacherFeedback !== latestSubmitted.revisionInstructions && (
                          <p className="leading-relaxed text-amber-900">
                            ملاحظة المدرس: {latestSubmitted.teacherFeedback}
                          </p>
                        )}
                    </div>
                  )}

                  {/* Instructions & Description */}
                  <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-2">
                    <h3 className="text-sm font-extrabold text-[#0B162C]">تعليمات وتفاصيل الواجب</h3>
                    {detail.assignment.descriptionAr && (
                      <p className="text-xs leading-relaxed text-slate-700">
                        {detail.assignment.descriptionAr}
                      </p>
                    )}
                    {detail.assignment.instructionsAr && (
                      <div className="whitespace-pre-line rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800">
                        {detail.assignment.instructionsAr}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-slate-600">
                      <span>
                        • التسليم المتأخر: {detail.assignment.allowLateSubmission ? 'مسموح' : 'غير مسموح'}
                      </span>
                      <span>
                        • إعادة التسليم:{' '}
                        {detail.assignment.allowResubmission
                          ? `مسموحة (حتى ${detail.assignment.maximumSubmissions} محاولات)`
                          : 'محاولة واحدة'}
                      </span>
                      {detail.assignment.courseTitleAr && (
                        <span>• الكورس: {detail.assignment.courseTitleAr}</span>
                      )}
                    </div>
                  </div>

                  {/* Homework Question Attachments (Independent from Video Lesson PDF) */}
                  {detail.assignment.attachments.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                      <h3 className="text-sm font-extrabold text-[#0B162C]">
                        ملفات أسئلة الواجب ({detail.assignment.attachments.length})
                      </h3>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {detail.assignment.attachments.map((att, idx) => {
                          const isPdf =
                            att.attachmentType === 'GOOGLE_DRIVE_PDF' ||
                            att.mimeType === 'application/pdf';
                          return (
                            <div
                              key={att.id ?? idx}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-[#F7F9FC] p-3"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isPdf ? (
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
                                      ? 'ملف PDF (Google Drive)'
                                      : `${isPdf ? 'PDF' : 'صورة'} · ${formatFileSizeAr(att.sizeBytes)}`}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {att.previewUrl && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewAttachmentUrl({
                                        title: att.fileName,
                                        url: att.previewUrl!,
                                        isPdf,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#1D4ED8]"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>عرض</span>
                                  </button>
                                )}
                                {att.viewUrl && (
                                  <a
                                    href={att.viewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                    title="فتح في نافذة جديدة"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Structured Homework Questions (including Bank Questions & Images) */}
                  {detail.assignment.questions.length > 0 && (
                    <div
                      data-testid="student-homework-questions-box"
                      className="rounded-xl border border-blue-200 bg-white p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-[#0B162C]">
                          <ListOrdered className="h-4 w-4 text-[#2563EB]" />
                          <span>أسئلة الواجب ({detail.assignment.questions.length})</span>
                        </h3>
                        <span className="font-mono-num text-[11px] font-bold text-slate-500">
                          مجموع الدرجات: {detail.assignment.maximumGrade}
                        </span>
                      </div>
                      <div className="space-y-4">
                        {detail.assignment.questions.map((q) => {
                          const qId = q.id;
                          const draftAns = qId ? structuredAnswers[qId] : undefined;
                          const latestSubmittedAns = qId
                            ? latestSubmitted?.structuredAnswers?.find((sa) => sa.questionId === qId)
                            : undefined;
                          const effectiveSelectedChoiceId = detail.submissionPermission.canSubmit
                            ? (draftAns?.selectedChoiceId ?? null)
                            : (latestSubmittedAns?.selectedChoiceId ?? draftAns?.selectedChoiceId ?? null);
                          const hasChoices = Array.isArray(q.choices) && q.choices.length > 0;
                          const choiceLetters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

                          return (
                            <div
                              key={q.id ?? q.questionNumber}
                              data-testid={`student-hw-question-${q.id ?? q.questionNumber}`}
                              className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-[#0B162C] px-1.5 font-mono-num text-[11px] font-bold text-white">
                                    س{q.questionNumber}
                                  </span>
                                  <span className="text-xs sm:text-sm font-extrabold text-[#0B162C]">
                                    {q.labelAr}
                                  </span>
                                </div>
                                <span className="rounded bg-white border border-slate-200 px-2 py-0.5 font-mono-num text-[11px] font-bold text-[#2563EB]">
                                  {q.maxGrade} درجة
                                </span>
                              </div>
                              {q.promptSnapshotAr &&
                                q.promptSnapshotAr.trim() &&
                                q.promptSnapshotAr.trim() !== q.labelAr.trim() && (
                                  <p className="whitespace-pre-line text-xs sm:text-sm font-semibold leading-relaxed text-slate-800">
                                    {q.promptSnapshotAr}
                                  </p>
                                )}
                              {q.descriptionAr &&
                                q.descriptionAr.trim() !== (q.promptSnapshotAr || '').trim() && (
                                  <p className="text-xs text-slate-600">{q.descriptionAr}</p>
                                )}

                              {q.questionImages && q.questionImages.length > 0 && (
                                <div className="pt-1">
                                  <QuestionImageGallery
                                    images={q.questionImages
                                      .filter((img) => Boolean(img.previewUrl))
                                      .map((img, iIdx) => ({
                                        url: img.previewUrl!,
                                        alt: img.fileName || `صورة السؤال ${q.questionNumber} (${iIdx + 1})`,
                                      }))}
                                  />
                                </div>
                              )}

                              {/* Multiple-choice / True-False options */}
                              {hasChoices && qId && (
                                <div
                                  className="space-y-2 pt-1"
                                  data-testid={`hw-question-choices-${qId}`}
                                >
                                  <div className="text-[11px] font-bold text-slate-500">
                                    {detail.submissionPermission.canSubmit
                                      ? 'اختر الإجابة الصحيحة:'
                                      : 'اختيارات السؤال:'}
                                  </div>
                                  <div className="grid gap-2.5 sm:grid-cols-2">
                                    {q.choices!.map((ch, cIdx) => {
                                      const isSelected = effectiveSelectedChoiceId === ch.id;
                                      const isRevealedCorrect =
                                        detail.modelAnswer.isReleased && ch.isCorrect === true;
                                      const isRevealedWrong =
                                        detail.modelAnswer.isReleased &&
                                        isSelected &&
                                        ch.isCorrect === false;

                                      let cls =
                                        'border-slate-200 bg-white text-slate-800 hover:border-blue-400 hover:bg-blue-50/40';
                                      if (isRevealedCorrect) {
                                        cls =
                                          'border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-400';
                                      } else if (isRevealedWrong) {
                                        cls = 'border-red-400 bg-red-50 text-red-950';
                                      } else if (isSelected) {
                                        cls =
                                          'border-[#2563EB] bg-blue-50 text-[#0B162C] ring-2 ring-[#2563EB]/25';
                                      }

                                      return (
                                        <button
                                          key={ch.id}
                                          type="button"
                                          data-testid={`hw-choice-${qId}-${ch.id}`}
                                          disabled={!detail.submissionPermission.canSubmit}
                                          onClick={() => {
                                            if (!detail.submissionPermission.canSubmit) return;
                                            setStructuredAnswers((prev) => ({
                                              ...prev,
                                              [qId]: {
                                                ...prev[qId],
                                                selectedChoiceId: ch.id,
                                              },
                                            }));
                                          }}
                                          className={`flex items-center gap-3 rounded-xl border p-3 text-right transition-all disabled:cursor-default ${cls}`}
                                        >
                                          <span
                                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                                              isSelected
                                                ? 'bg-[#2563EB] text-white'
                                                : isRevealedCorrect
                                                  ? 'bg-emerald-600 text-white'
                                                  : 'bg-slate-100 text-slate-700'
                                            }`}
                                          >
                                            {choiceLetters[cIdx] || cIdx + 1}
                                          </span>
                                          <span className="flex-1 text-xs sm:text-sm font-bold leading-snug">
                                            {ch.labelAr}
                                          </span>
                                          {isSelected && (
                                            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2563EB]" />
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Optional short-answer input for NUMERIC / SHORT_ANSWER bank questions */}
                              {!hasChoices &&
                                qId &&
                                detail.submissionPermission.canSubmit &&
                                (q.questionType === 'NUMERIC' || q.questionType === 'SHORT_ANSWER') && (
                                  <div className="pt-1">
                                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                      إجابتك لهذا السؤال:
                                    </label>
                                    <input
                                      type="text"
                                      value={draftAns?.textAnswer || ''}
                                      onChange={(e) =>
                                        setStructuredAnswers((prev) => ({
                                          ...prev,
                                          [qId]: {
                                            ...prev[qId],
                                            textAnswer: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder={
                                        q.questionType === 'NUMERIC'
                                          ? 'اكتب الناتج الرقمي هنا...'
                                          : 'اكتب إجابتك المختصرة هنا...'
                                      }
                                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B162C] focus:border-[#2563EB] focus:outline-none"
                                    />
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Submission Composer */}
                  {detail.submissionPermission.canSubmit ? (
                    <div className="rounded-xl border border-blue-200 bg-white p-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-extrabold text-[#0B162C]">
                            تسليم حل الواجب (النسخة رقم {detail.submissionPermission.nextVersion})
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            ارفع صور صفحات الحل بخط اليد (JPG / PNG / WEBP) أو ملف PDF، ويمكنك إضافة إجابة نصية اختيارية.
                          </p>
                        </div>
                        {detail.submissionPermission.isLate && (
                          <span className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-700">
                            سيُحتسب هذا التسليم متأخرًا
                          </span>
                        )}
                      </div>

                      {/* Upload Drop Area */}
                      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-[#F7F9FC] p-4 text-center">
                        <Upload className="mx-auto h-7 w-7 text-[#2563EB]" />
                        <p className="mt-1.5 text-xs font-bold text-[#0B162C]">
                          اختر صور الحل أو ملف PDF (حتى 8 ملفات · بحد أقصى 5 ميجابايت لكل ملف)
                        </p>
                        <div className="mt-3 flex flex-wrap justify-center gap-2">
                          <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]">
                            <ImageIcon className="h-4 w-4" />
                            <span>رفع صور الحل</span>
                            <input
                              type="file"
                              multiple
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                void handleFilesSelected(e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                            <FileText className="h-4 w-4 text-red-600" />
                            <span>رفع ملف PDF</span>
                            <input
                              type="file"
                              accept="application/pdf"
                              className="hidden"
                              onChange={(e) => {
                                void handleFilesSelected(e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>
                        <input
                          ref={replaceInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            void handleReplaceFile(e.target.files);
                            e.target.value = '';
                          }}
                        />
                      </div>

                      {/* Uploaded Files List with Reorder / Replace / Remove */}
                      {files.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-bold text-slate-700">
                            الملفات المرفقة للتسليم ({files.length} / 8) — يمكنك ترتيب الصفحات قبل التسليم:
                          </div>
                          {files.map((f, idx) => (
                            <div
                              key={f.localId}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-[#F7F9FC] p-2.5"
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0B162C] font-mono-num text-[11px] font-bold text-white">
                                  {idx + 1}
                                </span>
                                {f.previewUrl && f.mimeType.startsWith('image/') ? (
                                  <img
                                    src={f.previewUrl}
                                    alt={f.fileName}
                                    className="h-11 w-11 shrink-0 rounded-md border border-slate-200 object-cover"
                                  />
                                ) : (
                                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white">
                                    <FileText className="h-5 w-5 text-red-600" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-bold text-[#0B162C]">
                                    {f.fileName}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    <span>{f.mimeType === 'application/pdf' ? 'PDF' : 'صورة'}</span>
                                    <span>· {formatFileSizeAr(f.sizeBytes)}</span>
                                    {f.status === 'UPLOADING' && (
                                      <span className="font-bold text-[#2563EB]">
                                        جارٍ الرفع ({f.progress}%)...
                                      </span>
                                    )}
                                    {f.status === 'UPLOADED' && (
                                      <span className="inline-flex items-center gap-0.5 font-bold text-emerald-700">
                                        <CheckCircle2 className="h-3 w-3" />
                                        <span>تم الرفع</span>
                                      </span>
                                    )}
                                    {f.status === 'ERROR' && (
                                      <span className="font-bold text-red-700">
                                        فشل الرفع: {f.errorAr}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  aria-label={`تحريك الملف ${idx + 1} لأعلى`}
                                  disabled={idx === 0}
                                  onClick={() => moveFile(idx, -1)}
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`تحريك الملف ${idx + 1} لأسفل`}
                                  disabled={idx === files.length - 1}
                                  onClick={() => moveFile(idx, 1)}
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReplacingLocalId(f.localId);
                                    replaceInputRef.current?.click();
                                  }}
                                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  استبدال
                                </button>
                                <button
                                  type="button"
                                  aria-label={`حذف الملف ${f.fileName}`}
                                  onClick={() => removeFile(f.localId)}
                                  className="rounded border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Optional Written Answer */}
                      <div>
                        <label
                          htmlFor="student-hw-written-answer"
                          className="block text-xs font-bold text-[#0B162C]"
                        >
                          الإجابة النصية أو ملاحظات للمدرس (اختياري)
                        </label>
                        <textarea
                          id="student-hw-written-answer"
                          rows={4}
                          value={writtenAnswer}
                          onChange={(e) => setWrittenAnswer(e.target.value)}
                          placeholder="يمكنك كتابة الناتج النهائي أو خطوات الحل أو أي ملاحظة تود توضيحها للمدرس..."
                          className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>

                      {submitFeedback && (
                        <div
                          role="alert"
                          className={`flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs font-semibold ${
                            submitFeedback.type === 'success'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-red-200 bg-red-50 text-red-800'
                          }`}
                        >
                          {submitFeedback.type === 'success' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 shrink-0" />
                          )}
                          <span>{submitFeedback.text}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                        <button
                          type="button"
                          disabled={submitting || files.some((f) => f.status === 'UPLOADING')}
                          onClick={() => void handleSubmit(true)}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          حفظ كمسودة
                        </button>
                        <button
                          type="button"
                          data-testid="submit-homework-btn"
                          disabled={submitting || files.some((f) => f.status === 'UPLOADING')}
                          onClick={() => void handleSubmit(false)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                        >
                          {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          <span>{submitting ? 'جارٍ التسليم...' : 'تسليم الواجب نهائيًا'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                      <div className="font-bold text-[#0B162C]">التسليم غير متاح حاليًا</div>
                      <p className="mt-1">
                        {detail.submissionPermission.reasonAr ||
                          'تم استلام تسليمك أو انتهى موعد التسليم المحدد.'}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* TAB 2: RESULTS & VERSION HISTORY */}
              {activeTab === 'result' && (
                <div className="space-y-4">
                  {detail.submissions.filter((s) => s.status !== 'DRAFT').length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-8 text-center text-sm text-slate-500">
                      لم تقم بتسليم أي نسخة من هذا الواجب بعد.
                    </div>
                  ) : (
                    detail.submissions
                      .filter((s) => s.status !== 'DRAFT')
                      .map((sub) => {
                        const pct =
                          sub.isGradePublished &&
                          sub.awardedGrade !== null &&
                          detail.assignment.maximumGrade > 0
                            ? Math.round((sub.awardedGrade / detail.assignment.maximumGrade) * 100)
                            : null;

                        return (
                          <div
                            key={sub.id}
                            className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-[#0B162C] px-2.5 py-0.5 font-mono-num text-xs font-bold text-white">
                                  النسخة #{sub.version}
                                </span>
                                <span className="text-xs text-slate-500">
                                  تاريخ التسليم: {formatDateTimeAr(sub.submittedAt)}
                                </span>
                                {sub.isLate && (
                                  <span className="rounded bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700">
                                    تسليم متأخر
                                  </span>
                                )}
                              </div>

                              {sub.isGradePublished && sub.awardedGrade !== null ? (
                                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1">
                                  <Award className="h-4 w-4 text-emerald-700" />
                                  <span className="text-xs font-bold text-emerald-800">نتيجة الواجب:</span>
                                  <span className="font-mono-num text-sm font-extrabold text-emerald-900">
                                    {sub.awardedGrade} / {detail.assignment.maximumGrade} ({pct}%)
                                  </span>
                                </div>
                              ) : sub.status === 'RETURNED_FOR_REVISION' ? (
                                <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                                  مطلوب إعادة التسليم
                                </span>
                              ) : (
                                <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#2563EB]">
                                  قيد المراجعة والتصحيح
                                </span>
                              )}
                            </div>

                            {/* Question-by-Question Published Breakdown */}
                            {sub.isGradePublished && sub.questionGrades && sub.questionGrades.length > 0 && (
                              <div
                                data-testid={`student-question-grades-v${sub.version}`}
                                className="rounded-xl border border-blue-200 bg-[#F7F9FC] p-3.5 space-y-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0B162C]">
                                    <ListOrdered className="h-4 w-4 text-[#2563EB]" />
                                    <span>تفاصيل تصحيح الأسئلة</span>
                                  </div>
                                  <span className="font-mono-num text-[11px] font-bold text-slate-600">
                                    مجموع درجات الأسئلة:{' '}
                                    {sub.questionTotalGrade !== null
                                      ? sub.questionTotalGrade
                                      : Number(
                                          sub.questionGrades
                                            .reduce((acc, q) => acc + q.awardedGrade, 0)
                                            .toFixed(2),
                                        )}{' '}
                                    / {detail.assignment.maximumGrade}
                                  </span>
                                </div>

                                <div className="space-y-2">
                                  {sub.questionGrades.map((qg) => (
                                    <div
                                      key={qg.questionId}
                                      className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-[#0B162C] px-1.5 font-mono-num text-[10px] font-bold text-white">
                                            س{qg.questionNumber}
                                          </span>
                                          <span className="text-xs font-extrabold text-[#0B162C]">
                                            {qg.labelAr}
                                          </span>
                                        </div>
                                        <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-mono-num text-xs font-extrabold text-[#2563EB]">
                                          {qg.awardedGrade} / {qg.maxGrade}
                                        </span>
                                      </div>

                                      {qg.descriptionAr && (
                                        <p className="text-[11px] text-slate-500">{qg.descriptionAr}</p>
                                      )}

                                      {(() => {
                                        const matchedQ = detail.assignment.questions.find(
                                          (dq) => dq.id === qg.questionId || dq.questionNumber === qg.questionNumber,
                                        );
                                        if (!matchedQ?.questionImages || matchedQ.questionImages.length === 0) return null;
                                        return (
                                          <div className="pt-1">
                                            <QuestionImageGallery
                                              variant="compact"
                                              images={matchedQ.questionImages
                                                .filter((img) => Boolean(img.previewUrl))
                                                .map((img, iIdx) => ({
                                                  url: img.previewUrl!,
                                                  alt:
                                                    img.fileName ||
                                                    `صورة السؤال ${qg.questionNumber} (${iIdx + 1})`,
                                                }))}
                                            />
                                          </div>
                                        );
                                      })()}

                                      {qg.teacherComment && (
                                        <div className="flex items-start gap-1.5 rounded-md border border-slate-100 bg-[#F7F9FC] px-2.5 py-1.5 text-xs text-slate-700">
                                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                                          <div>
                                            <span className="font-bold text-[#0B162C]">ملاحظة المدرس: </span>
                                            <span className="whitespace-pre-line">{qg.teacherComment}</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>

                                {/* Summary + Manual Overall Override Notice */}
                                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-bold text-slate-600">مجموع درجات الأسئلة:</span>
                                    <span className="font-mono-num font-bold text-[#0B162C]">
                                      {sub.questionTotalGrade ?? sub.awardedGrade} / {detail.assignment.maximumGrade}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                                    <span className="font-extrabold text-[#0B162C]">الدرجة النهائية للواجب:</span>
                                    <span className="font-mono-num text-sm font-extrabold text-emerald-700">
                                      {sub.awardedGrade} / {detail.assignment.maximumGrade}
                                    </span>
                                  </div>
                                  {sub.isManualOverride && (
                                    <div
                                      data-testid={`student-manual-override-v${sub.version}`}
                                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950 space-y-0.5"
                                    >
                                      <div className="font-extrabold">
                                        تم تعديل الدرجة النهائية يدويًا بواسطة المدرس
                                      </div>
                                      {sub.overrideReason && (
                                        <div>
                                          <span className="font-bold">السبب: </span>
                                          <span>{sub.overrideReason}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {sub.isGradePublished && sub.rubricScores.length > 0 && (
                              <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3">
                                <div className="text-xs font-bold text-[#0B162C]">توزيع الدرجة حسب المعايير:</div>
                                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                                  {sub.rubricScores.map((r) => (
                                    <div
                                      key={r.id}
                                      className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 text-xs border border-slate-100"
                                    >
                                      <span className="text-slate-700">{r.labelAr}</span>
                                      <span className="font-mono-num font-bold text-[#2563EB]">
                                        {r.awardedPoints} / {r.maxPoints}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {sub.teacherFeedback && (
                              <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-slate-800">
                                <div className="font-bold text-[#2563EB]">التعليق العام على الواجب:</div>
                                <p className="mt-1 whitespace-pre-line leading-relaxed">
                                  {sub.teacherFeedback}
                                </p>
                              </div>
                            )}

                            {sub.revisionInstructions && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                <div className="font-bold">تعليمات إعادة التسليم:</div>
                                <p className="mt-1 whitespace-pre-line">{sub.revisionInstructions}</p>
                              </div>
                            )}

                            {sub.structuredAnswers && sub.structuredAnswers.length > 0 && (
                              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs space-y-1.5">
                                <div className="font-bold text-[#0B162C]">إجاباتك المختارة للأسئلة:</div>
                                <div className="space-y-1">
                                  {sub.structuredAnswers.map((sa) => {
                                    const qDef = detail.assignment.questions.find(
                                      (q) => q.id === sa.questionId,
                                    );
                                    const chosen = qDef?.choices?.find(
                                      (c) => c.id === sa.selectedChoiceId,
                                    );
                                    return (
                                      <div
                                        key={sa.questionId}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-100 bg-white px-2.5 py-1.5"
                                      >
                                        <span className="font-bold text-slate-700">
                                          س{qDef?.questionNumber ?? sa.questionId}:{' '}
                                          {qDef?.labelAr || 'سؤال'}
                                        </span>
                                        <span className="font-bold text-[#2563EB]">
                                          {chosen
                                            ? chosen.labelAr
                                            : sa.textAnswer || '—'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {sub.writtenAnswer && (
                              <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs">
                                <div className="font-bold text-slate-700">إجابتك النصية:</div>
                                <p className="mt-1 whitespace-pre-line text-slate-800">
                                  {sub.writtenAnswer}
                                </p>
                              </div>
                            )}

                            {sub.files.length > 0 && (
                              <div className="grid gap-2.5 sm:grid-cols-2">
                                {sub.files.map((f, fIdx) => (
                                  <div
                                    key={f.storageKey}
                                    className="overflow-hidden rounded-lg border border-slate-200 bg-[#F7F9FC]"
                                  >
                                    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-1.5 text-[11px]">
                                      <span className="truncate font-bold text-slate-700">
                                        {fIdx + 1}. {f.fileName}
                                      </span>
                                      <a
                                        href={f.previewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#2563EB] hover:underline shrink-0"
                                      >
                                        فتح
                                      </a>
                                    </div>
                                    {f.mimeType.startsWith('image/') ? (
                                      <img
                                        src={f.previewUrl}
                                        alt={f.fileName}
                                        className="h-44 w-full object-contain bg-slate-100 p-1"
                                      />
                                    ) : (
                                      <div className="flex h-32 flex-col items-center justify-center gap-2 p-3 text-xs text-slate-600">
                                        <FileText className="h-7 w-7 text-red-600" />
                                        <a
                                          href={f.previewUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="rounded-md bg-[#2563EB] px-3 py-1.5 text-[11px] font-bold text-white"
                                        >
                                          عرض ملف PDF المسلم
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              )}

              {/* TAB 3: MODEL ANSWER */}
              {activeTab === 'model_answer' && (
                <div className="space-y-4">
                  {!detail.modelAnswer.exists ? (
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-8 text-center text-sm text-slate-500">
                      لا يوجد نموذج إجابة مضاف لهذا الواجب حاليًا.
                    </div>
                  ) : !detail.modelAnswer.isReleased ? (
                    <div
                      data-testid="model-answer-locked-box"
                      className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-8 text-center space-y-2"
                    >
                      <Lock className="mx-auto h-8 w-8 text-slate-400" />
                      <div className="text-sm font-extrabold text-[#0B162C]">
                        نموذج الإجابة غير متاح حاليًا
                      </div>
                      <p className="text-xs text-slate-600">{detail.modelAnswer.messageAr}</p>
                      {detail.modelAnswer.releaseAt && (
                        <p className="text-xs font-semibold text-[#2563EB]">
                          موعد الإتاحة المجدول: {formatDateTimeAr(detail.modelAnswer.releaseAt)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div data-testid="model-answer-released-box" className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <div>
                          <h3 className="text-sm font-extrabold text-emerald-900">
                            {detail.modelAnswer.titleAr || 'نموذج الإجابة'}
                          </h3>
                          {detail.modelAnswer.notesAr && (
                            <p className="mt-1 text-xs leading-relaxed text-emerald-800">
                              {detail.modelAnswer.notesAr}
                            </p>
                          )}
                        </div>
                        {latestSubmitted && (
                          <button
                            type="button"
                            onClick={() => setCompareMode((v) => !v)}
                            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                          >
                            {compareMode ? 'عرض النموذج بالكامل' : 'مقارنة مع حلي المسلم'}
                          </button>
                        )}
                      </div>

                      <div className={compareMode && latestSubmitted ? 'grid gap-4 lg:grid-cols-2' : 'space-y-4'}>
                        {/* Model Answer Content */}
                        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-extrabold text-[#0B162C]">نموذج الإجابة المعتمد</div>

                          {detail.modelAnswer.drivePreviewUrl && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-600">
                                  ملف PDF (Google Drive)
                                </span>
                                {detail.modelAnswer.driveViewUrl && (
                                  <a
                                    href={detail.modelAnswer.driveViewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-bold text-[#2563EB] hover:underline"
                                  >
                                    <span>فتح في Google Drive</span>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </div>
                              <iframe
                                title="نموذج الإجابة PDF"
                                src={detail.modelAnswer.drivePreviewUrl}
                                className="h-[460px] w-full rounded-lg border border-slate-200"
                              />
                            </div>
                          )}

                          {(detail.modelAnswer.files || []).map((mf) => (
                            <div
                              key={mf.storageKey}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-[#F7F9FC]"
                            >
                              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 text-xs">
                                <span className="font-bold text-[#0B162C]">{mf.fileName}</span>
                                {mf.previewUrl && (
                                  <a
                                    href={mf.previewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#2563EB] font-semibold hover:underline"
                                  >
                                    فتح الملف
                                  </a>
                                )}
                              </div>
                              {mf.mimeType === 'application/pdf' ? (
                                <iframe
                                  title={mf.fileName}
                                  src={mf.previewUrl}
                                  className="h-[440px] w-full border-0 bg-white"
                                />
                              ) : (
                                <img
                                  src={mf.previewUrl}
                                  alt={mf.fileName}
                                  className="max-h-[440px] w-full object-contain bg-white p-2"
                                />
                              )}
                            </div>
                          ))}

                          {/* Released Bank-Question Model Answers */}
                          {detail.assignment.questions
                            .filter(
                              (q) =>
                                (q.modelAnswerTextSnapshot && q.modelAnswerTextSnapshot.trim()) ||
                                (q.modelAnswerFiles && q.modelAnswerFiles.length > 0),
                            )
                            .map((q) => (
                              <div
                                key={q.id ?? q.questionNumber}
                                className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2"
                              >
                                <div className="text-xs font-extrabold text-emerald-900">
                                  نموذج إجابة س{q.questionNumber}: {q.labelAr}
                                </div>
                                {q.modelAnswerTextSnapshot && (
                                  <p className="whitespace-pre-line text-xs text-slate-800">
                                    {q.modelAnswerTextSnapshot}
                                  </p>
                                )}
                                {q.modelAnswerFiles && q.modelAnswerFiles.length > 0 && (
                                  <div className="space-y-2">
                                    {q.modelAnswerFiles.map((maf, mIdx) => (
                                      <div
                                        key={maf.storageKey || mIdx}
                                        className="overflow-hidden rounded-lg border border-emerald-200 bg-white"
                                      >
                                        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-[11px]">
                                          <span className="font-bold text-slate-700">{maf.fileName}</span>
                                          {maf.previewUrl && (
                                            <a
                                              href={maf.previewUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="font-semibold text-[#2563EB] hover:underline"
                                            >
                                              فتح
                                            </a>
                                          )}
                                        </div>
                                        {maf.mimeType === 'application/pdf' ? (
                                          <iframe
                                            title={maf.fileName}
                                            src={maf.previewUrl}
                                            className="h-[380px] w-full border-0"
                                          />
                                        ) : (
                                          <img
                                            src={maf.previewUrl}
                                            alt={maf.fileName}
                                            className="max-h-[380px] w-full object-contain p-2"
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>

                        {/* Side-by-side Student Submission when Compare Mode active */}
                        {compareMode && latestSubmitted && (
                          <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/30 p-4">
                            <div className="text-xs font-extrabold text-[#2563EB]">
                              إجابتك المسلمة (النسخة #{latestSubmitted.version})
                            </div>
                            {latestSubmitted.writtenAnswer && (
                              <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs whitespace-pre-line">
                                {latestSubmitted.writtenAnswer}
                              </div>
                            )}
                            {latestSubmitted.files.map((sf) => (
                              <div
                                key={sf.storageKey}
                                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                              >
                                <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700">
                                  {sf.fileName}
                                </div>
                                {sf.mimeType === 'application/pdf' ? (
                                  <iframe
                                    title={sf.fileName}
                                    src={sf.previewUrl}
                                    className="h-[420px] w-full border-0"
                                  />
                                ) : (
                                  <img
                                    src={sf.previewUrl}
                                    alt={sf.fileName}
                                    className="max-h-[420px] w-full object-contain p-2"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Centered Responsive Image / PDF Lightbox Modal */}
      {previewAttachmentUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={previewAttachmentUrl.title}
          onClick={() => setPreviewAttachmentUrl(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-3 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs">
              <span className="truncate font-bold text-[#0B162C]">{previewAttachmentUrl.title}</span>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={previewAttachmentUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-[#2563EB] hover:bg-blue-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>فتح بالكامل</span>
                </a>
                <button
                  type="button"
                  aria-label="إغلاق المعاينة"
                  onClick={() => setPreviewAttachmentUrl(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {previewAttachmentUrl.isPdf ? (
              <iframe
                title={previewAttachmentUrl.title}
                src={previewAttachmentUrl.url}
                className="h-[76vh] w-full border-0 bg-white"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-50 p-3">
                <img
                  src={previewAttachmentUrl.url}
                  alt={previewAttachmentUrl.title}
                  className="max-h-[78vh] max-w-full rounded-lg bg-white object-contain shadow-sm"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
