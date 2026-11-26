import { Router } from 'express';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  examAttempts,
  exams,
  grades,
  homeworkAssignments,
  homeworkSubmissions,
  lessons,
  progressRecords,
  settings,
  studentProfiles,
  units,
  users,
  videos,
} from '../../db/schema.ts';
import { DEFAULT_PLATFORM_SETTINGS } from '../../db/seed.ts';
import {
  computeAcademicAdherence,
  evaluateWeekSummary,
  resolveCurrentCurriculumWeek,
  type StudentAcademicSignals,
} from '../../lib/academicPlanEngine.ts';
import { loadStudentCurriculumBundle } from './curriculum.ts';
import { createRateLimiter } from '../domain/security.ts';
import {
  computePublishedExamAverage,
  escapeHtml,
  filterPublishedParentExamAttempts,
  isDemoModeEnabled,
} from '../domain/securityHardening.ts';

export const publicRouter = Router();

const parentReportLimiter = createRateLimiter(25, 10 * 60 * 1000);

const BOOTSTRAP_CACHE_TTL_MS = 15_000;
let bootstrapCache: { payload: Record<string, unknown>; expiresAt: number } | null = null;

export function invalidatePublicBootstrapCache(): void {
  bootstrapCache = null;
}

publicRouter.get('/bootstrap', async (_req, res) => {
  try {
    const now = Date.now();
    if (bootstrapCache && bootstrapCache.expiresAt > now) {
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
      return res.json(bootstrapCache.payload);
    }

    const [cfgRows, tracks, visibleGrades, statsRes] = await Promise.all([
      db.select().from(settings).where(eq(settings.key, 'platform_config')).limit(1),
      db
        .select()
        .from(academicTracks)
        .where(eq(academicTracks.isVisible, true))
        .orderBy(asc(academicTracks.sortOrder), asc(academicTracks.id)),
      db
        .select()
        .from(grades)
        .where(eq(grades.isVisible, true))
        .orderBy(asc(grades.sortOrder), asc(grades.id)),
      db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM student_profiles) AS students_total,
          (SELECT COUNT(*)::int FROM videos WHERE is_published = true) AS videos_total,
          (SELECT COUNT(*)::int FROM courses WHERE is_published = true) AS courses_total,
          (SELECT COUNT(*)::int FROM exams WHERE is_published = true) AS exams_total
      `),
    ]);

    const cfgRow = cfgRows[0];
    const statsRow = ((statsRes.rows || [])[0] || {}) as Record<string, unknown>;
    const gradesByTrack = new Map<number, typeof visibleGrades>();
    for (const g of visibleGrades) {
      const list = gradesByTrack.get(g.trackId) || [];
      list.push(g);
      gradesByTrack.set(g.trackId, list);
    }

    const tracksWithGrades = tracks.map((track) => ({
      ...track,
      grades: gradesByTrack.get(track.id) || [],
    }));

    const demoAccountsEnabled = isDemoModeEnabled();
    const demoQuickAccounts = demoAccountsEnabled
      ? [
          {
            labelAr: 'تعبئة حساب المدرس (Admin)',
            phone: '01000000001',
            password: 'Admin@2026',
          },
          {
            labelAr: 'تعبئة طالب مفعّل (3 بكالوريا)',
            phone: '01012345678',
            password: 'Student@123',
          },
          {
            labelAr: 'تعبئة طالب قيد الموافقة',
            phone: '01122334455',
            password: 'Student@123',
          },
        ]
      : [];

    const payload = {
      settings: {
        ...DEFAULT_PLATFORM_SETTINGS,
        ...((cfgRow?.valueJson as Record<string, unknown>) || {}),
      },
      tracks: tracksWithGrades,
      stats: {
        studentsTotal: Number(statsRow.students_total || 0),
        videosTotal: Number(statsRow.videos_total || 0),
        coursesTotal: Number(statsRow.courses_total || 0),
        examsTotal: Number(statsRow.exams_total || 0),
      },
      demoAccountsEnabled,
      ...(demoAccountsEnabled ? { demoQuickAccounts } : {}),
    };

    bootstrapCache = { payload, expiresAt: now + BOOTSTRAP_CACHE_TTL_MS };
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    return res.json(payload);
  } catch (error) {
    console.error('Public bootstrap failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل بيانات المنصة حاليًا' });
  }
});

// Privacy-scoped Parent Report (shows ONLY the student matching the unique share code)
publicRouter.get('/parent-report/:shareCode', async (req, res) => {
  try {
    const rate = parentReportLimiter.check(`parent:${req.ip || 'unknown'}`);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `تم تجاوز عدد محاولات الاستعلام المسموح بها. يرجى المحاولة بعد ${rate.retryAfterSec} ثانية.`,
      });
    }

    const shareCode = (req.params.shareCode || '').trim().toUpperCase();
    if (!shareCode || shareCode.length < 6 || shareCode.length > 32) {
      return res.status(400).json({ error: 'كود متابعة ولي الأمر غير صالح' });
    }

    const rows = await db
      .select({
        profile: studentProfiles,
        user: users,
        grade: grades,
        track: academicTracks,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .leftJoin(grades, eq(studentProfiles.primaryGradeId, grades.id))
      .leftJoin(academicTracks, eq(studentProfiles.primaryTrackId, academicTracks.id))
      .where(eq(studentProfiles.parentShareCode, shareCode))
      .limit(1);

    if (!rows.length) {
      return res.status(404).json({ error: 'لم يتم العثور على تقرير مطابق لهذا الكود' });
    }

    const { profile, user, grade, track } = rows[0];
    if (user.status === 'ARCHIVED' || user.status === 'REJECTED') {
      return res.status(404).json({ error: 'لم يتم العثور على تقرير مطابق لهذا الكود' });
    }
    if (!profile.parentAccessEnabled) {
      return res.status(403).json({ error: 'تقرير ولي الأمر غير مفعّل لهذا الحساب حاليًا' });
    }

    const watchRows = await db
      .select({
        progress: progressRecords,
        videoTitleAr: videos.titleAr,
        durationSec: videos.durationSec,
      })
      .from(progressRecords)
      .innerJoin(videos, eq(progressRecords.videoId, videos.id))
      .where(eq(progressRecords.userId, user.id))
      .orderBy(desc(progressRecords.updatedAt));

    const attemptRows = await db
      .select({
        attempt: examAttempts,
        examTitleAr: exams.titleAr,
        examType: exams.examType,
      })
      .from(examAttempts)
      .innerJoin(exams, eq(examAttempts.examId, exams.id))
      .where(eq(examAttempts.userId, user.id))
      .orderBy(desc(examAttempts.submittedAt));

    const completedVideos = watchRows.filter((w) => w.progress.isCompleted).length;
    const avgCompletion =
      watchRows.length > 0
        ? Math.round(watchRows.reduce((s, r) => s + r.progress.completionPercent, 0) / watchRows.length)
        : 0;

    const publishedAttemptRows = filterPublishedParentExamAttempts(
      attemptRows.map((r) => {
        const max = Number(r.attempt.maxScore) || 1;
        return {
          ...r,
          status: r.attempt.status,
          resultPublished: r.attempt.resultPublished !== false,
          percentScore: (Number(r.attempt.totalScore) / max) * 100,
        };
      }),
    );

    const avgExamPercent = computePublishedExamAverage(publishedAttemptRows);

    // Safe Academic Adherence Summary (NEVER exposes unpublished grades)
    let academicAdherence: {
      hasPlan: boolean;
      planTitleAr: string | null;
      currentWeekTitleAr: string | null;
      weeklyCompletionPercent: number;
      onTimeAdherencePercent: number | null;
      completedTasksCount: number;
      overdueRequiredCount: number;
      encouragementAr: string;
    } | null = null;

    try {
      const bundle = await loadStudentCurriculumBundle({
        studentId: user.id,
        trackId: profile.primaryTrackId ?? null,
        gradeId: profile.primaryGradeId ?? null,
      });
      if (bundle.plan) {
        const hwSubs = await db
          .select({
            assignmentId: homeworkSubmissions.assignmentId,
            status: homeworkSubmissions.status,
            submittedAt: homeworkSubmissions.submittedAt,
          })
          .from(homeworkSubmissions)
          .where(eq(homeworkSubmissions.studentId, user.id));

        const hwAssignments = profile.primaryGradeId
          ? await db
              .select({
                id: homeworkAssignments.id,
                titleAr: homeworkAssignments.titleAr,
                deadline: homeworkAssignments.deadline,
              })
              .from(homeworkAssignments)
              .where(eq(homeworkAssignments.gradeId, profile.primaryGradeId))
          : [];

        const signals: StudentAcademicSignals = {
          videosById: Object.fromEntries(
            watchRows.map((w) => [
              w.progress.videoId,
              {
                id: w.progress.videoId,
                titleAr: w.videoTitleAr,
                percentComplete: w.progress.completionPercent,
                isCompleted: w.progress.isCompleted,
                updatedAt: w.progress.updatedAt ? w.progress.updatedAt.toISOString() : null,
              },
            ]),
          ),
          homeworkById: Object.fromEntries(
            hwAssignments.map((a) => {
              const subs = hwSubs.filter((s) => s.assignmentId === a.id && s.status !== 'DRAFT');
              return [
                a.id,
                {
                  id: a.id,
                  titleAr: a.titleAr,
                  deadline: a.deadline ? a.deadline.toISOString() : null,
                  statusCode: subs[0]?.status || 'NOT_STARTED',
                  submittedVersionsCount: subs.length,
                  latestSubmittedAt: subs[0]?.submittedAt ? subs[0].submittedAt.toISOString() : null,
                },
              ];
            }),
          ),
          examsById: Object.fromEntries(
            attemptRows.map((a) => [
              a.attempt.examId,
              {
                id: a.attempt.examId,
                titleAr: a.examTitleAr,
                statusCode: a.attempt.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'COMPLETED',
                attemptsUsed: 1,
                hasInProgressAttempt: a.attempt.status === 'IN_PROGRESS',
                lastSubmittedAt: a.attempt.submittedAt
                  ? a.attempt.submittedAt.toISOString()
                  : null,
              },
            ]),
          ),
          pdfsById: {},
          coursesById: {},
          scheduleById: {},
          manualReviewedTaskIds: bundle.manualReviewedTaskIds,
        };

        const now = new Date();
        const allWeekSummaries = bundle.plan.weeks.map((w) =>
          evaluateWeekSummary(w, signals, now),
        );
        const curWeek = resolveCurrentCurriculumWeek(bundle.plan.weeks, now);
        const curSummary = curWeek
          ? allWeekSummaries.find((ws) => ws.week.id === curWeek.id) || null
          : null;
        const adh = computeAcademicAdherence(bundle.plan, allWeekSummaries, curSummary);
        academicAdherence = {
          hasPlan: adh.hasPlan,
          planTitleAr: bundle.plan.titleAr,
          currentWeekTitleAr: curWeek?.titleAr || null,
          weeklyCompletionPercent: adh.weeklyCompletionPercent,
          onTimeAdherencePercent: adh.onTimeAdherencePercent,
          completedTasksCount: adh.completedTasksCount,
          overdueRequiredCount: adh.overdueRequiredCount,
          encouragementAr: adh.encouragementAr,
        };
      }
    } catch (adhErr) {
      console.error('Parent report adherence compute warning:', adhErr);
    }

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.json({
      student: {
        fullName: user.fullName,
        status: user.status,
        trackNameAr: track?.nameAr || '',
        gradeNameAr: grade?.nameAr || '',
        lastLoginAt: user.lastLoginAt,
      },
      summary: {
        watchedVideosCount: watchRows.length,
        completedVideosCount: completedVideos,
        avgCompletionPercent: avgCompletion,
        examsTakenCount: publishedAttemptRows.length,
        avgExamPercent,
      },
      academicAdherence,
      watchHistory: watchRows.map((w) => ({
        videoTitleAr: w.videoTitleAr,
        completionPercent: w.progress.completionPercent,
        isCompleted: w.progress.isCompleted,
        updatedAt: w.progress.updatedAt,
      })),
      examResults: publishedAttemptRows.map((a) => ({
        examTitleAr: a.examTitleAr,
        examType: a.examType,
        totalScore: Number(a.attempt.totalScore),
        maxScore: Number(a.attempt.maxScore),
        passed: a.attempt.passed,
        status: a.attempt.status,
        submittedAt: a.attempt.submittedAt,
      })),
    });
  } catch (error) {
    console.error('Parent report failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل تقرير ولي الأمر' });
  }
});

// Safe printable Physics Summary Sheet for PDF Library viewer
publicRouter.get('/pdf-note/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const targetUrl = `/api/public/pdf-note/${slug}`;
    const [lessonRow] = await db
      .select({
        lesson: lessons,
        unitTitleAr: units.titleAr,
      })
      .from(lessons)
      .innerJoin(units, eq(lessons.unitId, units.id))
      .where(eq(lessons.pdfUrl, targetUrl))
      .limit(1);

    const title = escapeHtml(lessonRow?.lesson.pdfTitleAr || 'مذكرة الفيزياء — منصة أستاذ / حمدى الشباسي');
    const summary = escapeHtml(
      lessonRow?.lesson.pdfContentSummary ||
        'ملخص شامل للقوانين الأساسية ومسائل الفيزياء التدريبية المعتمدة.',
    );
    const unitTitle = escapeHtml(lessonRow?.unitTitleAr || 'منهج الفيزياء');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
    return res.send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; max-width: 820px; margin: 32px auto; padding: 32px; color: #0B162C; line-height: 1.9; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; }
    h1 { color: #0B162C; border-bottom: 2px solid #2563EB; padding-bottom: 12px; }
    .meta { color: #475569; font-size: 14px; margin-bottom: 20px; }
    .box { background: #F8FAFC; border: 1px solid #CBD5E1; padding: 18px; border-radius: 8px; margin: 16px 0; white-space: pre-wrap; }
    .formula { font-family: monospace; direction: ltr; text-align: center; font-size: 18px; font-weight: bold; color: #1E40AF; padding: 12px; background: #EFF6FF; border-radius: 6px; margin: 14px 0; }
    .print-hint { color: #475569; font-size: 13px; background: #F1F5F9; border-radius: 8px; padding: 10px 14px; }
    @media print { .no-print { display: none; } body { border: none; margin: 0; } }
  </style>
</head>
<body>
  <div class="meta">منصة الشباسي في الفيزياء · ${unitTitle}</div>
  <h1>${title}</h1>
  <div class="box">${summary}</div>
  <h3>القوانين الأساسية للمراجعة السريعة</h3>
  <div class="formula">I = Q / t &nbsp;|&nbsp; V = I · R &nbsp;|&nbsp; V_B = I · (R + r) &nbsp;|&nbsp; P = I² · R = V² / R</div>
  <div class="formula">emf = -N · (ΔΦ_m / Δt) &nbsp;|&nbsp; E = h · ν &nbsp;|&nbsp; K.E_max = h · ν - E_w</div>
  <p class="no-print print-hint">للطباعة أو الحفظ بصيغة PDF: استخدم اختصار المتصفح Ctrl+P أو Cmd+P.</p>
</body>
</html>`);
  } catch (error) {
    console.error('PDF note render failed:', error);
    return res.status(500).send('تعذر تحميل المذكرة');
  }
});
