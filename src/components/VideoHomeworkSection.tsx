import React, { useCallback, useEffect, useState } from 'react';
import { Award, BookCheck, Clock, Eye, FileCheck2, Send } from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import { getStudentStatusBadgeClass } from '../lib/homeworkUpload.ts';
import type { StudentHomeworkCardItem } from '../types/homework.ts';
import { StudentHomeworkModal } from './StudentHomeworkModal.tsx';

interface VideoHomeworkResponse {
  serverNow: string;
  items: StudentHomeworkCardItem[];
}

interface VideoHomeworkSectionProps {
  videoId: number;
}

/**
 * Independent homework section rendered directly below the Video Player and Lesson PDF.
 * Completely self-contained state ensures opening homework modals or submitting solutions
 * never triggers any re-render in SecureVideoPlayer.
 */
export const VideoHomeworkSection: React.FC<VideoHomeworkSectionProps> = ({ videoId }) => {
  const [items, setItems] = useState<StudentHomeworkCardItem[]>([]);
  const [loadedVideoId, setLoadedVideoId] = useState<number | null>(null);
  const [activeHomeworkId, setActiveHomeworkId] = useState<number | null>(null);

  const fetchVideoHomework = useCallback(async () => {
    try {
      const res = await apiRequest<VideoHomeworkResponse>(`/api/student/homework/video/${videoId}`);
      setLoadedVideoId(videoId);
      setItems(res.items || []);
    } catch {
      setLoadedVideoId(videoId);
      setItems([]);
    }
  }, [videoId]);

  useEffect(() => {
    void fetchVideoHomework();
  }, [fetchVideoHomework]);

  // Hide cleanly when no homework is assigned to this video (zero clutter)
  if (loadedVideoId !== videoId || items.length === 0) {
    return null;
  }

  return (
    <>
      <section
        data-testid="video-homework-section"
        aria-labelledby="video-homework-section-heading"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-[#2563EB]">
              <BookCheck className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="video-homework-section-heading"
                className="text-base font-extrabold text-[#0B162C]"
              >
                واجبات الدرس
              </h2>
              <p className="text-xs text-slate-500">
                الواجبات والتكليفات المرتبطة مباشرة بهذا الفيديو ({items.length})
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {items.map((hw) => (
            <div
              key={hw.id}
              data-testid={`video-homework-card-${hw.id}`}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 transition-colors hover:border-[#2563EB]/40"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-[#0B162C]">{hw.titleAr}</h3>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-bold shrink-0 ${getStudentStatusBadgeClass(
                      hw.statusCode,
                    )}`}
                  >
                    {hw.statusLabelAr}
                  </span>
                </div>

                {hw.descriptionAr && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-slate-600">
                    {hw.descriptionAr}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                  <span className="font-mono-num font-bold text-[#0B162C]">
                    الدرجة: {hw.awardedGrade !== null ? `${hw.awardedGrade} / ` : ''}
                    {hw.maximumGrade}
                  </span>
                  {hw.deadline && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>آخر موعد: {formatDateTimeAr(hw.deadline)}</span>
                    </span>
                  )}
                  {hw.isModelAnswerReleased && (
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                      <FileCheck2 className="h-3.5 w-3.5" />
                      <span>نموذج الإجابة متاح</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3">
                <button
                  type="button"
                  onClick={() => setActiveHomeworkId(hw.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>عرض الواجب</span>
                </button>

                {hw.canSubmit && (
                  <button
                    type="button"
                    onClick={() => setActiveHomeworkId(hw.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>
                      {hw.statusCode === 'RETURNED_FOR_REVISION'
                        ? 'إعادة تسليم الحل'
                        : hw.submittedVersionsCount > 0
                          ? 'تسليم نسخة جديدة'
                          : 'تسليم الحل'}
                    </span>
                  </button>
                )}

                {hw.statusCode === 'GRADED' && (
                  <button
                    type="button"
                    onClick={() => setActiveHomeworkId(hw.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <Award className="h-3.5 w-3.5" />
                    <span>عرض النتيجة</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {activeHomeworkId !== null && (
        <StudentHomeworkModal
          assignmentId={activeHomeworkId}
          onClose={() => setActiveHomeworkId(null)}
          onSubmitted={() => {
            void fetchVideoHomework();
          }}
        />
      )}
    </>
  );
};
