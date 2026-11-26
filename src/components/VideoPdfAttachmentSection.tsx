import React, { useEffect, useState } from 'react';
import { ExternalLink, Eye, EyeOff, FileText, Loader2 } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';

interface VideoPdfAttachment {
  videoId: number;
  title: string;
  description: string | null;
  previewUrl: string;
  viewUrl: string;
  attachedAt: string | null;
}

interface VideoPdfResponse {
  hasPdf: boolean;
  attachment: VideoPdfAttachment | null;
}

interface VideoPdfAttachmentSectionProps {
  videoId: number;
}

/**
 * Independent PDF attachment section displayed directly below the YouTube video player.
 * Completely isolated state ensures opening/closing the embedded Google Drive PDF viewer
 * never causes SecureVideoPlayer to re-render or disturb video playback.
 */
export const VideoPdfAttachmentSection: React.FC<VideoPdfAttachmentSectionProps> = ({
  videoId,
}) => {
  const [attachment, setAttachment] = useState<VideoPdfAttachment | null>(null);
  const [loadedVideoId, setLoadedVideoId] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setAttachment(null);
    setViewerOpen(false);
    setIframeLoading(false);

    apiRequest<VideoPdfResponse>(`/api/student/videos/${videoId}/pdf`)
      .then((res) => {
        if (!active) return;
        setLoadedVideoId(videoId);
        setAttachment(res.hasPdf && res.attachment ? res.attachment : null);
      })
      .catch(() => {
        if (!active) return;
        setLoadedVideoId(videoId);
        setAttachment(null);
      });

    return () => {
      active = false;
    };
  }, [videoId]);

  // Hide the entire PDF section cleanly when no PDF is attached (or unauthorized/loading)
  if (loadedVideoId !== videoId || !attachment) {
    return null;
  }

  const handleToggleViewer = () => {
    setViewerOpen((prev) => {
      const next = !prev;
      if (next) setIframeLoading(true);
      return next;
    });
  };

  return (
    <section
      data-testid="video-pdf-section"
      aria-labelledby="video-pdf-section-heading"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600">
            <FileText className="h-6 w-6" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="video-pdf-section-heading"
                className="text-base font-extrabold text-[#0B162C]"
              >
                📚 ملف الدرس والمرفقات
              </h2>
              <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                PDF
              </span>
            </div>
            <p
              data-testid="video-pdf-title"
              className="text-sm font-bold text-slate-800 break-words"
            >
              {attachment.title}
            </p>
            {attachment.description && (
              <p
                data-testid="video-pdf-description"
                className="text-xs leading-relaxed text-slate-600 break-words"
              >
                {attachment.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="toggle-pdf-viewer-btn"
            onClick={handleToggleViewer}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#1D4ED8] whitespace-nowrap"
          >
            {viewerOpen ? (
              <>
                <EyeOff className="h-4 w-4" />
                <span>إخفاء ملف PDF</span>
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                <span>عرض ملف PDF داخل المنصة</span>
              </>
            )}
          </button>

          <a
            href={attachment.viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-pdf-drive-link"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <ExternalLink className="h-4 w-4 text-slate-500" />
            <span>فتح في Google Drive</span>
          </a>
        </div>
      </div>

      {viewerOpen && (
        <div
          data-testid="video-pdf-iframe-wrapper"
          className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-[#F7F9FC]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
            <span className="font-bold text-[#0B162C]">معاينة ملف PDF داخل المنصة</span>
            <span>
              في حال تعذر عرض الملف أو ظهرت رسالة عدم صلاحية، اضغط «فتح في Google Drive» أعلاه أو أبلغ المدرس لضبط صلاحية المشاركة على Google Drive.
            </span>
          </div>

          <div className="relative h-[500px] w-full sm:h-[620px] lg:h-[700px]">
            {iframeLoading && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#F7F9FC]/90 text-xs font-semibold text-slate-600">
                <Loader2 className="h-6 w-6 animate-spin text-[#2563EB]" />
                <span>جارٍ تحميل ملف PDF من Google Drive...</span>
              </div>
            )}
            <iframe
              title={`ملف PDF: ${attachment.title}`}
              src={attachment.previewUrl}
              data-testid="video-pdf-iframe"
              onLoad={() => setIframeLoading(false)}
              className="h-full w-full border-0 bg-white"
              referrerPolicy="no-referrer"
              allow="autoplay"
            />
          </div>
        </div>
      )}
    </section>
  );
};
