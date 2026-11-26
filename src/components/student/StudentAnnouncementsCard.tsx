import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Megaphone,
  PlayCircle,
  Sparkles,
} from 'lucide-react';
import type { StudentAnnouncementItem, StudentDeepLinkTarget } from '../../types/lms.ts';

interface StudentAnnouncementsCardProps {
  announcements: StudentAnnouncementItem[];
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
}

export const StudentAnnouncementsCard: React.FC<StudentAnnouncementsCardProps> = ({
  announcements,
  onNavigateTarget,
}) => {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (activeIdx >= announcements.length) {
      setActiveIdx(0);
    }
  }, [announcements.length, activeIdx]);

  const current = announcements[activeIdx] || null;

  const handleCtaClick = () => {
    if (!current || current.ctaTargetType === 'NONE') return;
    if (current.ctaTargetType === 'EXTERNAL_URL') {
      if (current.ctaExternalUrl) {
        onNavigateTarget({ type: 'EXTERNAL_URL', externalUrl: current.ctaExternalUrl });
      }
      return;
    }
    onNavigateTarget({
      type: current.ctaTargetType,
      entityId: current.ctaTargetId ?? undefined,
    });
  };

  return (
    <section
      aria-label="إعلانات الأستاذ والمنصة"
      className="rounded-2xl border border-[#3B82F6]/40 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-3.5 text-white shadow-[0_8px_24px_rgba(2,8,24,0.45)]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/35">
            <Megaphone className="h-3.5 w-3.5" />
          </div>
          <h2 className="font-display text-[14px] font-extrabold text-white truncate">
            إعلانات المنصة
          </h2>
        </div>

        {announcements.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="الإعلان السابق"
              onClick={() =>
                setActiveIdx((i) => (i - 1 + announcements.length) % announcements.length)
              }
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-200 hover:border-sky-400/50 hover:bg-white/10"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <span className="font-mono-num text-[10.5px] font-bold text-slate-300 px-0.5">
              {activeIdx + 1}/{announcements.length}
            </span>
            <button
              type="button"
              aria-label="الإعلان التالي"
              onClick={() => setActiveIdx((i) => (i + 1) % announcements.length)}
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-200 hover:border-sky-400/50 hover:bg-white/10"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {!current ? (
        <div className="mt-2.5 rounded-xl border border-white/10 bg-[#122455]/55 px-3 py-3 text-center">
          <Sparkles className="mx-auto h-4 w-4 text-sky-300/70" />
          <p className="mt-1 text-[11.5px] font-medium text-slate-300">
            لا توجد إعلانات نشطة من الأستاذ حاليًا.
          </p>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          {/* Media preview — never autoplays with sound; preload="none" for uploaded videos */}
          {(current.mediaType === 'IMAGE' || current.mediaType === 'GIF') && current.mediaUrl && (
            <div className="overflow-hidden rounded-xl border border-white/15 bg-[#07112B]">
              <img
                src={current.mediaUrl}
                alt={current.titleAr}
                loading="lazy"
                className="max-h-36 w-full object-contain bg-[#060E24]"
              />
            </div>
          )}

          {current.mediaType === 'VIDEO_UPLOAD' && current.mediaUrl && (
            <div className="overflow-hidden rounded-xl border border-white/15 bg-black">
              <video
                src={current.mediaUrl}
                controls
                muted
                playsInline
                preload="none"
                className="max-h-40 w-full object-contain"
              />
            </div>
          )}

          {current.mediaType === 'EXTERNAL_VIDEO' && current.externalVideoUrl && (
            <a
              href={current.externalVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-xl border border-sky-400/35 bg-[#12265B]/80 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-[#193375] transition-colors"
            >
              <span className="flex items-center gap-2 truncate">
                <PlayCircle className="h-4 w-4 shrink-0 text-sky-300" />
                <span className="truncate">مشاهدة فيديو الإعلان</span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}

          <div>
            <h3 className="text-[12.5px] font-extrabold text-white leading-snug">
              {current.titleAr}
            </h3>
            {current.bodyAr && (
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-200/90 whitespace-pre-line line-clamp-4">
                {current.bodyAr}
              </p>
            )}
          </div>

          {current.ctaTargetType !== 'NONE' && (
            <button
              type="button"
              onClick={handleCtaClick}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-3 py-2 text-[11.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] hover:brightness-110 transition-all"
            >
              <span>{current.ctaLabelAr || 'عرض التفاصيل'}</span>
              {current.ctaTargetType === 'EXTERNAL_URL' ? (
                <ExternalLink className="h-3.5 w-3.5" />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {announcements.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 pt-0.5">
              {announcements.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`الانتقال للإعلان ${idx + 1}`}
                  onClick={() => setActiveIdx(idx)}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === activeIdx ? 'w-5 bg-sky-400' : 'w-1.5 bg-white/25 hover:bg-white/45'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
