import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface QuestionImageItem {
  url: string;
  alt?: string;
  caption?: string;
}

interface QuestionImageGalleryProps {
  images: QuestionImageItem[];
  variant?: 'question' | 'answer' | 'compact';
  className?: string;
}

export function QuestionImageGallery({
  images,
  variant = 'question',
  className = '',
}: QuestionImageGalleryProps) {
  const validImages = images.filter((img) => Boolean(img.url));
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIdx(null);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => Math.min(4, Number((z + 0.35).toFixed(2))));
      } else if (e.key === '-') {
        e.preventDefault();
        setZoom((z) => {
          const next = Math.max(0.75, Number((z - 0.35).toFixed(2)));
          if (next <= 1) setPan({ x: 0, y: 0 });
          return next;
        });
      } else if (e.key === '0') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === 'ArrowRight' && validImages.length > 1) {
        setLightboxIdx((i) => (i === null ? null : (i + 1) % validImages.length));
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === 'ArrowLeft' && validImages.length > 1) {
        setLightboxIdx((i) =>
          i === null ? null : (i - 1 + validImages.length) % validImages.length,
        );
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIdx, validImages.length]);

  if (validImages.length === 0) return null;

  const openLightbox = (idx: number) => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setLightboxIdx(idx);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomIn = () => setZoom((z) => Math.min(4, Number((z + 0.35).toFixed(2))));
  const zoomOut = () =>
    setZoom((z) => {
      const next = Math.max(0.75, Number((z - 0.35).toFixed(2)));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore pointer release errors
    }
  };

  // Requirement #4: desktop 50-65% of question container width (expanding cleanly when wide/needed),
  // mobile near full width, preserve natural aspect ratio, no tiny max-h caps or cropping.
  const containerWidthClass =
    variant === 'compact'
      ? 'w-full sm:w-[75%] md:w-[58%]'
      : 'w-full md:w-[64%] lg:w-[62%] xl:w-[60%] max-w-[780px]';

  const currentLightboxImg = lightboxIdx !== null ? validImages[lightboxIdx] : null;

  return (
    <div className={`space-y-4 ${className}`}>
      {validImages.map((img, idx) => (
        <figure
          key={`${img.url}-${idx}`}
          className={`mx-auto ${containerWidthClass} group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md`}
        >
          <button
            type="button"
            onClick={() => openLightbox(idx)}
            className="block w-full cursor-zoom-in bg-white p-2 sm:p-3 text-center focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            aria-label={img.alt ? `تكبير صورة: ${img.alt}` : 'تكبير صورة السؤال'}
          >
            <img
              src={img.url}
              alt={img.alt || `صورة السؤال ${idx + 1}`}
              loading="lazy"
              decoding="async"
              className="mx-auto block h-auto w-full max-h-[72vh] object-contain rounded-xl"
            />
          </button>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/90 px-3 py-1.5 text-[11px] font-bold text-slate-600">
            <span className="truncate">
              {img.caption ||
                (validImages.length > 1
                  ? `صورة ${idx + 1} من ${validImages.length}`
                  : 'اضغط على الصورة للتكبير والفحص بدقة كاملة')}
            </span>
            <button
              type="button"
              onClick={() => openLightbox(idx)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600/10 px-2.5 py-1 text-blue-700 hover:bg-blue-600/20 transition-colors"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>تكبير</span>
            </button>
          </div>
        </figure>
      ))}

      {currentLightboxImg && lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-[120] flex flex-col bg-slate-950/95 backdrop-blur-md"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="عارض صور الأسئلة بالحجم الكامل"
        >
          {/* Top toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-900/90 px-4 py-3 text-white">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
              <span className="truncate max-w-[200px] sm:max-w-md">
                {currentLightboxImg.alt || `صورة ${lightboxIdx + 1}`}
              </span>
              {validImages.length > 1 && (
                <span className="rounded-lg bg-white/10 px-2 py-0.5 text-xs text-slate-300">
                  {lightboxIdx + 1} / {validImages.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={zoomOut}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
                title="تصغير (-)"
                aria-label="تصغير"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="min-w-[52px] text-center text-xs font-extrabold text-blue-300">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={zoomIn}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
                title="تكبير (+)"
                aria-label="تكبير"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={resetView}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-white/10 px-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
                title="إعادة الضبط (0)"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">إعادة</span>
              </button>
              <button
                type="button"
                onClick={() => setLightboxIdx(null)}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-rose-600 px-3 text-xs font-extrabold text-white hover:bg-rose-500 transition-colors"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
                <span>إغلاق</span>
              </button>
            </div>
          </div>

          {/* Interactive zoom/pan canvas */}
          <div
            className={`relative flex-1 overflow-auto flex items-center justify-center p-4 sm:p-8 select-none ${
              zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
            }`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={() => {
              if (zoom > 1) resetView();
              else setZoom(2);
            }}
          >
            <img
              src={currentLightboxImg.url}
              alt={currentLightboxImg.alt || 'صورة مكبرة'}
              draggable={false}
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
              className="max-h-[82vh] max-w-[94vw] rounded-xl bg-white object-contain p-1.5 shadow-2xl transition-transform duration-100"
            />

            {validImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIdx((lightboxIdx - 1 + validImages.length) % validImages.length);
                    resetView();
                  }}
                  className="fixed right-3 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 border border-white/15 text-white hover:bg-blue-600 transition-colors"
                  aria-label="الصورة السابقة"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIdx((lightboxIdx + 1) % validImages.length);
                    resetView();
                  }}
                  className="fixed left-3 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 border border-white/15 text-white hover:bg-blue-600 transition-colors"
                  aria-label="الصورة التالية"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          <div className="border-t border-white/10 bg-slate-900/80 px-4 py-2 text-center text-[11px] font-medium text-slate-300">
            انقر مرتين للتكبير السريع • اسحب الصورة للتحريك عند التكبير • اضغط Esc للإغلاق
          </div>
        </div>
      )}
    </div>
  );
}
