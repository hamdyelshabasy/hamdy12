import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Maximize2,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Send,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr, formatDurationAr } from '../lib/api.ts';
import {
  buildPrivacyEnhancedEmbedUrl,
  clampSeekTarget,
  getYouTubeErrorMessageAr,
  resolveResumePositionSec,
  shouldPreservePlayerInstance,
  type PlayerMountIdentity,
} from '../lib/youtube.ts';
import { MathFormula } from './MathFormula.tsx';
import { VideoPdfAttachmentSection } from './VideoPdfAttachmentSection.tsx';
import { VideoHomeworkSection } from './VideoHomeworkSection.tsx';

interface PlaybackSessionResponse {
  video: {
    id: number;
    titleAr: string;
    descriptionAr: string;
    durationSec: number;
    thumbnailUrl: string;
    videoType?: string;
    allowSpeedChange: boolean;
    maxPlaybackSpeed: number;
  };
  playback: {
    provider: 'YOUTUBE' | 'PROTECTED_CANVAS';
    youtubeVideoId: string | null;
    embedUrl: string | null;
    signedStreamUrl: string;
    expiresInSec: number;
    watermarkText: string;
    resumePositionSec: number;
    watchedSec: number;
    completionPercent: number;
    isCompleted: boolean;
    accessSource: string;
    drmStatus: {
      hlsSignedTokensActive: boolean;
      widevineFairPlayReady: boolean;
      browserScreenCaptureLimitationNote: string;
    };
  };
}

interface StreamManifest {
  verified: boolean;
  videoId: number;
  titleAr: string;
  durationSec: number;
  qualities: string[];
  chapters: Array<{ timeSec: number; titleAr: string; formula: string }>;
  watermarkText: string;
  expiresAt: string;
}

interface CommentItem {
  id: number;
  authorName: string;
  bodyAr: string;
  replyAr: string | null;
  createdAt: string;
}

export interface VideoProgressUpdatePayload {
  videoId: number;
  lastPositionSec: number;
  watchedSec: number;
  completionPercent: number;
  isCompleted: boolean;
}

interface SecureVideoPlayerProps {
  videoId: number;
  lessonId: number;
  lessonTitleAr: string;
  unitTitleAr?: string;
  trackNameAr?: string;
  gradeNameAr?: string;
  pdfTitleAr?: string | null;
  pdfContentSummary?: string | null;
  allowComments: boolean;
  initialComments: CommentItem[];
  onClose: () => void;
  onProgressUpdated: (progress?: VideoProgressUpdatePayload) => void;
}

interface YTPlayerInstance {
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getIframe?: () => HTMLIFrameElement;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      host?: string;
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

interface PlayerDebugEvent {
  ts: number;
  event: string;
  videoId: number;
  details?: Record<string, unknown>;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __ytApiPromise?: Promise<YTNamespace>;
    __LMS_PLAYER_DEBUG__?: boolean;
    __LMS_PLAYER_EVENTS__?: PlayerDebugEvent[];
  }
}

function logPlayerDebug(event: string, videoId: number, details?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const entry: PlayerDebugEvent = { ts: Date.now(), event, videoId, details };
  const list = window.__LMS_PLAYER_EVENTS__ || [];
  list.push(entry);
  if (list.length > 120) list.splice(0, list.length - 120);
  window.__LMS_PLAYER_EVENTS__ = list;

  let debugEnabled = Boolean(window.__LMS_PLAYER_DEBUG__);
  if (!debugEnabled) {
    try {
      debugEnabled = window.localStorage.getItem('lms_player_debug') === '1';
    } catch {
      debugEnabled = false;
    }
  }
  if (debugEnabled) {
    console.debug(`[SecureVideoPlayer] ${event}`, { videoId, ...(details || {}) });
  }
}

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('No window'));
  }
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (window.__ytApiPromise) {
    return window.__ytApiPromise;
  }

  window.__ytApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube IFrame API load timeout'));
    }, 8000);

    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (prevCallback) prevCallback();
      if (window.YT) resolve(window.YT);
      else reject(new Error('YT global unavailable'));
    };

    const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Failed to load YouTube IFrame API script'));
      };
      document.head.appendChild(tag);
    }
  }).catch((err) => {
    window.__ytApiPromise = undefined;
    throw err;
  });

  return window.__ytApiPromise;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const SecureVideoPlayer: React.FC<SecureVideoPlayerProps> = ({
  videoId,
  lessonId,
  lessonTitleAr,
  unitTitleAr,
  trackNameAr,
  gradeNameAr,
  pdfTitleAr,
  pdfContentSummary,
  allowComments,
  initialComments,
  onClose,
  onProgressUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState<PlaybackSessionResponse | null>(null);
  const [manifest, setManifest] = useState<StreamManifest | null>(null);

  // YouTube player state & lifecycle guards
  const [ytError, setYtError] = useState('');
  const [ytFallbackIframe, setYtFallbackIframe] = useState(false);
  const [ytRetryNonce, setYtRetryNonce] = useState(0);
  const [ytReady, setYtReady] = useState(false);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const mountedIdentityRef = useRef<PlayerMountIdentity | null>(null);
  const pauseSaveTimerRef = useRef<number | null>(null);
  const initialResumeSecRef = useRef(0);

  // Live progress state (synced with server verified progress)
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [watchedSec, setWatchedSec] = useState(0);
  const [completionPercent, setCompletionPercent] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Legacy protected canvas controls
  const [speed, setSpeed] = useState(1);
  const [quality, setQuality] = useState('1080p HD');
  const [muted, setMuted] = useState(false);
  const [watermarkPos, setWatermarkPos] = useState({ top: 14, left: 12 });
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Q&A comments
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Stable refs so callbacks & live ticks NEVER recreate or destroy the YouTube player
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const watchedSecRef = useRef(0);
  const isPlayingRef = useRef(false);
  const sessionRef = useRef<PlaybackSessionResponse | null>(null);
  const onProgressUpdatedRef = useRef(onProgressUpdated);
  const videoIdRef = useRef(videoId);

  currentTimeRef.current = currentTime;
  durationRef.current = durationSec;
  watchedSecRef.current = watchedSec;
  isPlayingRef.current = isPlaying;
  sessionRef.current = session;
  onProgressUpdatedRef.current = onProgressUpdated;
  videoIdRef.current = videoId;

  // Component mount/unmount debug lifecycle
  useEffect(() => {
    logPlayerDebug('component_mount', videoIdRef.current);
    return () => {
      logPlayerDebug('component_unmount', videoIdRef.current);
    };
  }, []);

  // 1. Fetch Server-Authorized Playback Session & Manifest atomically per videoId
  useEffect(() => {
    let active = true;
    logPlayerDebug('video_id_change', videoId);
    setLoading(true);
    setError('');
    setYtError('');
    setYtFallbackIframe(false);
    setYtReady(false);
    setIsPlaying(false);
    setSession(null);
    setManifest(null);
    initialResumeSecRef.current = 0;

    (async () => {
      try {
        const s = await apiRequest<PlaybackSessionResponse>(
          `/api/student/videos/${videoId}/playback-session`,
          { method: 'POST' },
        );
        if (!active) return;

        const m = await apiRequest<StreamManifest>(s.playback.signedStreamUrl);
        if (!active) return;

        const savedPos = s.playback.resumePositionSec || 0;
        initialResumeSecRef.current = savedPos;
        currentTimeRef.current = savedPos;
        durationRef.current = s.video.durationSec || 0;
        watchedSecRef.current = s.playback.watchedSec || 0;

        setCurrentTime(savedPos);
        setDurationSec(s.video.durationSec || 0);
        setWatchedSec(s.playback.watchedSec || 0);
        setCompletionPercent(s.playback.completionPercent || 0);
        setIsCompleted(Boolean(s.playback.isCompleted));
        setSession(s);
        setManifest(m);

        if (s.playback.provider === 'PROTECTED_CANVAS') {
          setIsPlaying(true);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [videoId]);

  // Stable background progress saver — depends ONLY on videoId and never interrupts playback
  const saveProgress = useCallback(
    async (stopped = false) => {
      const s = sessionRef.current;
      if (!s) return;

      // Read freshest timestamp directly from live YT player when available
      let livePos = currentTimeRef.current;
      let liveDur = durationRef.current;
      const player = ytPlayerRef.current;
      if (player) {
        try {
          const pTime = player.getCurrentTime();
          if (Number.isFinite(pTime) && pTime >= 0) {
            livePos = pTime;
            currentTimeRef.current = pTime;
          }
          const pDur = player.getDuration();
          if (Number.isFinite(pDur) && pDur > 10) {
            liveDur = pDur;
            durationRef.current = pDur;
          }
        } catch {
          // ignore if player not yet ready
        }
      }

      const reportedDuration = liveDur > 10 ? liveDur : s.video.durationSec || 1800;
      logPlayerDebug('progress_save', videoId, {
        lastPositionSec: Math.round(livePos),
        watchedSec: Math.round(watchedSecRef.current),
        durationSec: Math.round(reportedDuration),
        stopped,
      });

      try {
        const res = await apiRequest<{
          progress: {
            lastPositionSec: number;
            watchedSec: number;
            completionPercent: number;
            isCompleted: boolean;
          };
        }>(`/api/student/videos/${videoId}/progress`, {
          method: 'POST',
          body: JSON.stringify({
            lastPositionSec: Math.round(livePos),
            watchedSec: Math.round(watchedSecRef.current),
            durationSec: Math.round(reportedDuration),
            stopped,
          }),
        });
        if (res.progress) {
          setCompletionPercent(res.progress.completionPercent);
          setIsCompleted(res.progress.isCompleted);
          setWatchedSec(res.progress.watchedSec);
          watchedSecRef.current = res.progress.watchedSec;
          onProgressUpdatedRef.current({
            videoId,
            lastPositionSec: res.progress.lastPositionSec,
            watchedSec: res.progress.watchedSec,
            completionPercent: res.progress.completionPercent,
            isCompleted: res.progress.isCompleted,
          });
        }
      } catch {
        // Never interrupt video playback on transient network errors during autosave
      }
    },
    [videoId],
  );

  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  // Primitive mount triggers so parent re-renders or progress saves NEVER recreate YT.Player
  const ytVideoId =
    session?.playback.provider === 'YOUTUBE' ? session.playback.youtubeVideoId : null;
  const isYouTubeReadyToMount =
    !loading && Boolean(manifest) && Boolean(ytVideoId) && !ytFallbackIframe;

  // 2. Mount Official YouTube IFrame Player API ONCE per (videoId, ytVideoId, ytRetryNonce)
  useEffect(() => {
    if (!isYouTubeReadyToMount || !ytVideoId) {
      return;
    }

    const nextIdentity: PlayerMountIdentity = {
      videoId,
      youtubeVideoId: ytVideoId,
      retryNonce: ytRetryNonce,
    };

    // Guard against duplicate instantiation if already mounted with identical identity
    if (ytPlayerRef.current && shouldPreservePlayerInstance(mountedIdentityRef.current, nextIdentity)) {
      return;
    }

    let cancelled = false;
    setYtError('');
    setYtReady(false);

    const startSec = resolveResumePositionSec({
      currentTimeSec: currentTimeRef.current,
      savedResumeSec: initialResumeSecRef.current,
      durationSec: durationRef.current,
    });

    logPlayerDebug('player_init', videoId, {
      youtubeVideoId: ytVideoId,
      startSec,
      retryNonce: ytRetryNonce,
    });

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !ytHostRef.current) return;

        // Destroy any stale instance before mounting the new one
        if (ytPlayerRef.current) {
          try {
            ytPlayerRef.current.destroy();
          } catch {
            // ignore
          }
          ytPlayerRef.current = null;
        }

        ytHostRef.current.innerHTML = '';
        const mountDiv = document.createElement('div');
        mountDiv.style.width = '100%';
        mountDiv.style.height = '100%';
        ytHostRef.current.appendChild(mountDiv);

        const playerVars: Record<string, string | number> = {
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          fs: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        };
        if (startSec >= 3) {
          playerVars.start = startSec;
        }

        const player = new YT.Player(mountDiv, {
          host: 'https://www.youtube-nocookie.com',
          videoId: ytVideoId,
          width: '100%',
          height: '100%',
          playerVars,
          events: {
            onReady: (ev) => {
              if (cancelled) return;
              const iframe = ev.target.getIframe?.() || ytHostRef.current?.querySelector('iframe');
              if (iframe) {
                iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
              }
              const d = Math.round(ev.target.getDuration() || 0);
              if (d > 0) {
                setDurationSec(d);
                durationRef.current = d;
              }
              setYtReady(true);
              logPlayerDebug('player_ready', videoId, {
                youtubeVideoId: ytVideoId,
                durationSec: d,
                startSec,
              });
            },
            onStateChange: (ev) => {
              if (cancelled) return;
              const stateNames: Record<number, string> = {
                [-1]: 'UNSTARTED',
                0: 'ENDED',
                1: 'PLAYING',
                2: 'PAUSED',
                3: 'BUFFERING',
                5: 'CUED',
              };
              const pos = Math.max(0, ev.target.getCurrentTime?.() || 0);
              const d = Math.round(ev.target.getDuration?.() || 0);
              if (d > 0) {
                setDurationSec(d);
                durationRef.current = d;
              }
              logPlayerDebug('state_change', videoId, {
                state: stateNames[ev.data] || String(ev.data),
                positionSec: Math.round(pos),
              });

              if (ev.data === YT.PlayerState.PLAYING) {
                if (pauseSaveTimerRef.current !== null) {
                  window.clearTimeout(pauseSaveTimerRef.current);
                  pauseSaveTimerRef.current = null;
                }
                setCurrentTime(pos);
                currentTimeRef.current = pos;
                setIsPlaying(true);
              } else if (ev.data === YT.PlayerState.BUFFERING) {
                // Keep tracking latest seek target while buffering without stopping or resetting
                if (pos > 0) {
                  setCurrentTime(pos);
                  currentTimeRef.current = pos;
                }
              } else if (ev.data === YT.PlayerState.PAUSED) {
                setIsPlaying(false);
                setCurrentTime(pos);
                currentTimeRef.current = pos;
                // Debounce pause save so scrubbing/seeking never spams saves mid-drag
                if (pauseSaveTimerRef.current !== null) {
                  window.clearTimeout(pauseSaveTimerRef.current);
                }
                pauseSaveTimerRef.current = window.setTimeout(() => {
                  pauseSaveTimerRef.current = null;
                  void saveProgressRef.current(false);
                }, 700);
              } else if (ev.data === YT.PlayerState.ENDED) {
                if (pauseSaveTimerRef.current !== null) {
                  window.clearTimeout(pauseSaveTimerRef.current);
                  pauseSaveTimerRef.current = null;
                }
                setIsPlaying(false);
                const endPos = d > 0 ? d : Math.round(pos);
                setCurrentTime(endPos);
                currentTimeRef.current = endPos;
                void saveProgressRef.current(false);
              }
            },
            onError: (ev) => {
              if (cancelled) return;
              // Preserve currentTimeRef.current on error so retry never resets to 00:00
              setIsPlaying(false);
              logPlayerDebug('player_error', videoId, {
                code: ev.data,
                preservedPositionSec: Math.round(currentTimeRef.current),
              });
              setYtError(getYouTubeErrorMessageAr(ev.data));
            },
          },
        });

        ytPlayerRef.current = player;
        mountedIdentityRef.current = nextIdentity;
        const createdIframe = ytHostRef.current?.querySelector('iframe');
        if (createdIframe) {
          createdIframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        }
      })
      .catch(() => {
        if (!cancelled) {
          logPlayerDebug('player_api_fallback', videoId, { youtubeVideoId: ytVideoId });
          setYtFallbackIframe(true);
        }
      });

    return () => {
      cancelled = true;
      if (pauseSaveTimerRef.current !== null) {
        window.clearTimeout(pauseSaveTimerRef.current);
        pauseSaveTimerRef.current = null;
      }
      if (ytPlayerRef.current) {
        logPlayerDebug('player_destroy', videoId, {
          youtubeVideoId: ytVideoId,
          lastPositionSec: Math.round(currentTimeRef.current),
        });
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
      }
      mountedIdentityRef.current = null;
      setYtReady(false);
    };
  }, [videoId, ytVideoId, isYouTubeReadyToMount, ytRetryNonce]);

  // 3. Verified Watch-Time Accumulation Ticker for YouTube Player (1s interval while actively PLAYING)
  useEffect(() => {
    if (!ytVideoId || !isPlaying) return;
    const tick = window.setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player) return;
      try {
        const pos = Math.max(0, player.getCurrentTime() || 0);
        const dur = Math.max(0, player.getDuration() || durationRef.current || 0);
        setCurrentTime(pos);
        currentTimeRef.current = pos;
        if (dur > 0) {
          setDurationSec(dur);
          durationRef.current = dur;
        }
        // Only increment real watched time by 1 genuine second per second of active playback
        setWatchedSec((prev) => {
          const next = dur > 0 ? Math.min(dur, prev + 1) : prev + 1;
          watchedSecRef.current = next;
          if (dur > 0) {
            const pct = Math.min(100, Math.round((next / dur) * 100));
            setCompletionPercent((oldPct) => Math.max(oldPct, pct));
            if (pct >= 85) setIsCompleted(true);
          }
          return next;
        });
      } catch {
        // ignore if player torn down
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [ytVideoId, isPlaying]);

  // 4. Silent periodic progress autosave every 15s while playing + on tab hide (never interrupts player)
  useEffect(() => {
    if (!ytVideoId && session?.playback.provider !== 'PROTECTED_CANVAS') return;
    const id = window.setInterval(() => {
      if (isPlayingRef.current) void saveProgressRef.current(false);
    }, 15000);
    const onVisChange = () => {
      if (document.visibilityState === 'hidden' && currentTimeRef.current > 0) {
        void saveProgressRef.current(false);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [ytVideoId, session?.playback.provider]);

  // Smooth custom YouTube player controls using official seekTo/playVideo/pauseVideo (no iframe reload)
  const handleYouTubeTogglePlay = () => {
    const player = ytPlayerRef.current;
    if (!player) return;
    try {
      if (isPlayingRef.current) {
        player.pauseVideo();
      } else {
        player.playVideo();
      }
    } catch {
      // ignore if player not ready
    }
  };

  const handleYouTubeSeekBy = (deltaSec: number) => {
    const player = ytPlayerRef.current;
    if (!player) return;
    try {
      const current = player.getCurrentTime?.() ?? currentTimeRef.current;
      const dur = player.getDuration?.() || durationRef.current || 0;
      const target = clampSeekTarget(current, deltaSec, dur);
      logPlayerDebug('seek', videoId, {
        fromSec: Math.round(current),
        deltaSec,
        toSec: Math.round(target),
      });
      player.seekTo(target, true);
      setCurrentTime(target);
      currentTimeRef.current = target;
    } catch {
      // ignore if player not ready
    }
  };

  // 5. Dynamic Moving Watermark (repositions every 4.5s)
  useEffect(() => {
    const id = window.setInterval(() => {
      setWatermarkPos({
        top: 10 + Math.floor(Math.random() * 68),
        left: 8 + Math.floor(Math.random() * 56),
      });
    }, 4500);
    return () => window.clearInterval(id);
  }, []);

  // 6. Legacy Protected Canvas fallback clock + visualizer (only when provider === PROTECTED_CANVAS)
  useEffect(() => {
    if (!isPlaying || !session || session.playback.provider !== 'PROTECTED_CANVAS') return;
    const dur = session.video.durationSec || 1800;
    const tick = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 0.5 * speed;
        if (next >= dur) {
          setIsPlaying(false);
          return dur;
        }
        return next;
      });
      setWatchedSec((prev) => Math.min(dur, prev + 0.5));
    }, 500);
    return () => window.clearInterval(tick);
  }, [isPlaying, speed, session]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !session || session.playback.provider !== 'PROTECTED_CANVAS') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#091326';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const midY = h * 0.56;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(48, midY);
    ctx.lineTo(w - 48, midY);
    ctx.moveTo(80, 50);
    ctx.lineTo(80, h - 50);
    ctx.stroke();

    const phase = currentTime * 1.6;
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 80; x <= w - 50; x += 3) {
      const t = (x - 80) / 55;
      const y = midY - Math.sin(t - phase) * 72 * Math.exp(-Math.abs(t - 5) * 0.03);
      if (x === 80) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [currentTime, session]);

  const handleClose = async () => {
    await saveProgress(true);
    onClose();
  };

  const handleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void playerContainerRef.current.requestFullscreen();
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setCommentError('');
    setSubmittingComment(true);
    try {
      const res = await apiRequest<{ comment: CommentItem }>(
        `/api/student/lessons/${lessonId}/comments`,
        { method: 'POST', body: JSON.stringify({ bodyAr: commentText }) },
      );
      setComments((prev) => [res.comment, ...prev]);
      setCommentText('');
    } catch (err) {
      setCommentError((err as Error).message);
    } finally {
      setSubmittingComment(false);
    }
  };

  const effectiveDuration = durationSec || session?.video.durationSec || 1800;
  const activeChapter = manifest?.chapters
    ? [...manifest.chapters].reverse().find((c) => currentTime >= c.timeSec) || manifest.chapters[0]
    : null;
  const allowedSpeeds = [0.75, 1, 1.25, 1.5, 1.75, 2].filter(
    (sp) => sp <= (session?.video.maxPlaybackSpeed || 2),
  );

  return (
    <div className="space-y-6" data-testid="lesson-video-page">
      {/* Lesson Breadcrumb & Back Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => void handleClose()}
          className="inline-flex items-center gap-2 text-sm font-bold text-[#0B162C] hover:text-[#2563EB]"
        >
          <ArrowRight className="h-4 w-4" />
          <span>العودة إلى مكتبة الدروس</span>
        </button>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {[trackNameAr, gradeNameAr, unitTitleAr, lessonTitleAr].filter(Boolean).join(' · ')}
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          جارٍ التحقق من الصلاحيات وتجهيز صفحة الدرس والمشغل الآمن...
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center space-y-3"
        >
          <AlertTriangle className="mx-auto h-8 w-8 text-red-600" />
          <div className="text-base font-bold text-red-900">{error}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#0B162C] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2563EB]"
          >
            العودة إلى الدروس
          </button>
        </div>
      )}

      {!loading && session && manifest && (
        <>
          {/* Dedicated Embedded Video Player Container */}
          <div
            ref={playerContainerRef}
            onContextMenu={(e) => e.preventDefault()}
            className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#091326] text-white shadow-lg"
            data-testid="secure-video-player"
          >
            {session.playback.provider === 'YOUTUBE' && session.playback.youtubeVideoId ? (
              <div className="relative aspect-video w-full bg-black">
                {ytFallbackIframe ? (
                  <iframe
                    key="yt-fallback-iframe"
                    title={session.video.titleAr}
                    src={buildPrivacyEnhancedEmbedUrl(
                      session.playback.youtubeVideoId,
                      resolveResumePositionSec({
                        currentTimeSec: currentTimeRef.current,
                        savedResumeSec: initialResumeSecRef.current,
                        durationSec: durationRef.current,
                      }),
                      window.location.origin,
                    )}
                    className="h-full w-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                    data-testid="youtube-embed-iframe"
                  />
                ) : (
                  <div
                    key="yt-api-host"
                    ref={ytHostRef}
                    className={`h-full w-full [&>iframe]:h-full [&>iframe]:w-full ${ytError ? 'invisible' : ''}`}
                    data-testid="youtube-api-container"
                  />
                )}

                {ytError && (
                  <div
                    key="yt-error-overlay"
                    role="alert"
                    className="absolute inset-0 z-30 flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0B162C]/95 p-6 text-center"
                  >
                    <AlertTriangle className="h-10 w-10 text-amber-400" />
                    <div className="max-w-lg text-sm font-bold leading-relaxed text-white">
                      {ytError}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setYtError('');
                        setYtRetryNonce((n) => n + 1);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>إعادة محاولة التحميل</span>
                    </button>
                  </div>
                )}

                {/* Dynamic Moving Watermark (non-blocking pointer-events-none) */}
                {!ytError && (
                  <div
                    data-testid="dynamic-watermark"
                    style={{ top: `${watermarkPos.top}%`, left: `${watermarkPos.left}%` }}
                    className="pointer-events-none absolute z-20 flex items-center gap-1.5 rounded bg-black/45 px-2.5 py-1 font-mono-num text-[11px] font-semibold text-white/75 transition-all duration-1000 select-none"
                  >
                    {manifest.watermarkText.split(' · ').map((part, idx) => (
                      <React.Fragment key={idx}>
                        {idx > 0 && <span className="opacity-50">·</span>}
                        <span dir={/[0-9]/.test(part) ? 'ltr' : 'rtl'}>{part}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Legacy Protected Canvas Fallback when a video has no YouTube ID */
              <>
                <div className="relative aspect-video w-full">
                  <canvas
                    ref={canvasRef}
                    width={960}
                    height={540}
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start justify-between p-5 sm:p-8">
                    <div className="max-w-xl rounded-xl border border-white/10 bg-[#0B162C]/80 px-4 py-3 backdrop-blur-sm">
                      <div className="text-xs text-[#93C5FD]">
                        {activeChapter?.titleAr || session.video.titleAr}
                      </div>
                      {activeChapter?.formula && (
                        <div className="mt-2 text-lg text-white">
                          <MathFormula formula={activeChapter.formula} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    data-testid="dynamic-watermark"
                    style={{ top: `${watermarkPos.top}%`, left: `${watermarkPos.left}%` }}
                    className="pointer-events-none absolute z-20 flex items-center gap-1.5 rounded bg-black/40 px-3 py-1 font-mono-num text-xs font-semibold text-white/75 transition-all duration-1000"
                  >
                    {manifest.watermarkText.split(' · ').map((part, idx) => (
                      <React.Fragment key={idx}>
                        {idx > 0 && <span className="opacity-50">·</span>}
                        <span dir={/[0-9]/.test(part) ? 'ltr' : 'rtl'}>{part}</span>
                      </React.Fragment>
                    ))}
                  </div>
                  {!isPlaying && (
                    <button
                      type="button"
                      aria-label="تشغيل المحاضرة"
                      onClick={() => setIsPlaying(true)}
                      className="absolute inset-0 z-10 flex items-center justify-center bg-black/30"
                    >
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2563EB] text-white shadow-lg">
                        <Play className="h-7 w-7 fill-current" />
                      </span>
                    </button>
                  )}
                </div>

                <div className="border-t border-white/10 bg-[#0B162C] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-xs text-slate-300">
                      {formatClock(currentTime)}
                    </span>
                    <input
                      type="range"
                      aria-label="شريط التقدم"
                      min={0}
                      max={effectiveDuration}
                      value={Math.min(effectiveDuration, Math.round(currentTime))}
                      onChange={(e) => setCurrentTime(Number(e.target.value))}
                      onMouseUp={() => void saveProgress(false)}
                      className="h-1.5 flex-1 cursor-pointer accent-[#2563EB]"
                    />
                    <span className="font-mono-num text-xs text-slate-300">
                      {formatClock(effectiveDuration)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
                        onClick={() => {
                          const next = !isPlaying;
                          setIsPlaying(next);
                          if (!next) void saveProgress(false);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                      >
                        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label="إرجاع 10 ثوانٍ"
                        onClick={() => setCurrentTime((t) => Math.max(0, t - 10))}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-200 hover:bg-white/10"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={muted ? 'إلغاء كتم الصوت' : 'كتم الصوت'}
                        onClick={() => setMuted((m) => !m)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-200 hover:bg-white/10"
                      >
                        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {session.video.allowSpeedChange && (
                        <select
                          aria-label="سرعة التشغيل"
                          value={speed}
                          onChange={(e) => setSpeed(Number(e.target.value))}
                          className="rounded-lg border border-white/15 bg-[#132240] px-2.5 py-1.5 font-mono-num text-xs text-white"
                        >
                          {allowedSpeeds.map((sp) => (
                            <option key={sp} value={sp}>
                              {sp}x
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        aria-label="جودة البث"
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                        className="rounded-lg border border-white/15 bg-[#132240] px-2.5 py-1.5 text-xs text-white"
                      >
                        {manifest.qualities.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="ملء الشاشة"
                        onClick={handleFullscreen}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-200 hover:bg-white/10"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Smooth Playback Controls + Verified Watch Progress Strip under Player */}
            <div className="border-t border-white/10 bg-[#0B162C] px-4 py-3 space-y-2.5">
              {session.playback.provider === 'YOUTUBE' && !ytError && !ytFallbackIframe && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!ytReady}
                      aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل الفيديو'}
                      data-testid="yt-toggle-play"
                      onClick={handleYouTubeTogglePlay}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      <span>{isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!ytReady}
                      aria-label="ترجيع 10 ثوانٍ"
                      data-testid="yt-seek-back"
                      onClick={() => handleYouTubeSeekBy(-10)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/15 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span className="font-mono-num">10- ث</span>
                    </button>
                    <button
                      type="button"
                      disabled={!ytReady}
                      aria-label="تقديم 10 ثوانٍ"
                      data-testid="yt-seek-forward"
                      onClick={() => handleYouTubeSeekBy(10)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/15 disabled:opacity-50"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span className="font-mono-num">10+ ث</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="ملء الشاشة"
                    data-testid="yt-fullscreen"
                    onClick={handleFullscreen}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/15"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span>ملء الشاشة</span>
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  {isCompleted ? (
                    <span className="inline-flex items-center gap-1.5 font-bold text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>تم إتمام مشاهدة الدرس بنجاح</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <Clock className="h-3.5 w-3.5 text-[#93C5FD]" />
                      <span>
                        نسبة المشاهدة الفعلية:{' '}
                        <strong className="font-mono-num text-white">{completionPercent}%</strong>{' '}
                        (يُحتسب الدرس مكتملًا عند مشاهدة 85% فعليًا)
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 font-mono-num text-slate-300">
                  <span data-testid="player-current-time">آخر نقطة: {formatClock(currentTime)}</span>
                  {effectiveDuration > 0 && <span>المدة: {formatDurationAr(effectiveDuration)}</span>}
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  style={{ width: `${completionPercent}%` }}
                  className={`h-full rounded-full transition-all ${
                    isCompleted ? 'bg-emerald-500' : 'bg-[#2563EB]'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Attached Lesson PDF from Google Drive (Independent Component — Zero Player Re-renders) */}
          <VideoPdfAttachmentSection videoId={videoId} />

          {/* Lesson Homework Assignments (Independent Component — Zero Player Re-renders) */}
          <VideoHomeworkSection videoId={videoId} />

          {/* Lesson Details, PDF Note & Protection Summary */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2 space-y-4">
              <div>
                <h1 className="text-xl font-extrabold text-[#0B162C]">{session.video.titleAr}</h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {session.video.descriptionAr || 'شرح مفصّل لدرس الفيزياء ضمن منهج المنصة.'}
                </p>
              </div>

              {pdfTitleAr && (
                <div className="rounded-xl border border-blue-100 bg-[#F7F9FC] p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#0B162C]">
                    <FileText className="h-4 w-4 text-[#2563EB]" />
                    <span>مرفق الدرس: {pdfTitleAr}</span>
                  </div>
                  {pdfContentSummary && (
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                      {pdfContentSummary}
                    </p>
                  )}
                </div>
              )}

              {session.playback.provider === 'PROTECTED_CANVAS' && manifest.chapters.length > 0 && (
                <div>
                  <h2 className="text-sm font-bold text-[#0B162C]">فصول المحاضرة</h2>
                  <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {manifest.chapters.map((ch, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setCurrentTime(ch.timeSec)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-800">
                          0{idx + 1}. {ch.titleAr}
                        </span>
                        <span className="font-mono-num text-xs text-[#2563EB] shrink-0">
                          {formatClock(ch.timeSec)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0B162C]">
                <ShieldCheck className="h-5 w-5 text-[#2563EB]" />
                <span>الحماية وتتبع التقدم</span>
              </div>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600">
                <li>• تحقق خادمي كامل من صلاحيات الحساب قبل تسليم الفيديو</li>
                <li>• مشغل يوتيوب معزز للخصوصية (youtube-nocookie.com)</li>
                <li>• حفظ تلقائي لنقطة المشاهدة واستكمال فوري عند العودة</li>
                <li>• علامة مائية ديناميكية ببيانات الطالب ورقمه</li>
                <li>• احتساب إتمام الدرس بناءً على المشاهدة الفعلية فقط</li>
              </ul>
              <p className="mt-4 rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs leading-relaxed text-slate-600">
                {session.playback.drmStatus.browserScreenCaptureLimitationNote}
              </p>
            </div>
          </div>

          {/* Lesson Q&A Comments */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-base font-bold text-[#0B162C]">
              <MessageSquare className="h-5 w-5 text-[#2563EB]" />
              <span>أسئلة الطلاب حول هذا الدرس</span>
            </div>

            {allowComments ? (
              <form onSubmit={handleCommentSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="اكتب سؤالك الفيزيائي هنا ليقوم المدرس أو المساعد بالرد عليه..."
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={submittingComment}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap shrink-0"
                >
                  <Send className="h-4 w-4" />
                  <span>إرسال السؤال</span>
                </button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-slate-500">التعليقات مغلقة لهذا الدرس من قِبل المدرس.</p>
            )}

            {commentError && (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {commentError}
              </p>
            )}

            <div className="mt-5 space-y-3">
              {comments.length === 0 ? (
                <p className="text-sm text-slate-500">لا توجد أسئلة بعد. كن أول من يسأل حول هذا الدرس.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-bold text-[#0B162C]">{c.authorName}</span>
                      <span>{formatDateTimeAr(c.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-800">{c.bodyAr}</p>
                    {c.replyAr && (
                      <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 text-sm text-slate-700">
                        <span className="font-bold text-[#2563EB]">رد المدرس: </span>
                        {c.replyAr}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
