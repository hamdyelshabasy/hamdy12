import express, { Router, type NextFunction, type Response } from 'express';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  courses,
  curriculumPlans,
  curriculumWeeks,
  curriculumWeekTasks,
  enrollments,
  examAttempts,
  exams,
  grades,
  homeworkAssignments,
  homeworkSubmissions,
  lectureSchedules,
  lessons,
  progressRecords,
  studentCurriculumTaskProgress,
  units,
  users,
  videos,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  hasAnyPermission,
  isStaffRole,
  requireActiveAccount,
  requireAuth,
  requireStaff,
  type AuthRequest,
} from '../../middleware/auth.ts';
import {
  addDaysToYmd,
  generateCurriculumWeekRanges,
  resolveCurrentCurriculumWeek,
  type CurriculumPlanRecord,
  type CurriculumTaskRecord,
  type CurriculumTaskType,
  type CurriculumWeekRecord,
} from '../../lib/academicPlanEngine.ts';
import { logAudit } from '../audit.ts';
import { curriculumPlanCache } from '../cache.ts';

function requireCurriculumPermission(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.authUser) return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً' });
  if (
    req.authUser.roleSlug === 'SUPER_ADMIN' ||
    hasAnyPermission(req.authUser, [
      PERMISSIONS.CONTENT_MANAGE,
      PERMISSIONS.SCHEDULE_MANAGE,
      PERMISSIONS.COURSES_MANAGE,
      PERMISSIONS.EXAMS_MANAGE,
      PERMISSIONS.HOMEWORK_MANAGE,
    ])
  ) {
    return next();
  }
  return res.status(403).json({ error: 'ليس لديك صلاحية إدارة خطة المنهج.' });
}

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const planCreateSchema = z.object({
  titleAr: z.string().trim().min(3, 'اسم خطة المنهج مطلوب (3 أحرف على الأقل)').max(160),
  trackId: z.coerce.number().int().positive(),
  gradeId: z.coerce.number().int().positive(),
  academicYearAr: z.string().trim().max(60).optional().default(''),
  descriptionAr: z.string().trim().max(2000).optional().default(''),
  startDate: z.string().regex(YMD_REGEX, 'تاريخ البداية غير صالح (YYYY-MM-DD)'),
  endDate: z.string().regex(YMD_REGEX, 'تاريخ النهاية غير صالح (YYYY-MM-DD)').optional(),
  totalWeeks: z.coerce.number().int().min(1).max(52).default(12),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional().default('DRAFT'),
  autoGenerateWeeks: z.boolean().optional().default(true),
});

const planUpdateSchema = z.object({
  titleAr: z.string().trim().min(3).max(160).optional(),
  trackId: z.coerce.number().int().positive().optional(),
  gradeId: z.coerce.number().int().positive().optional(),
  academicYearAr: z.string().trim().max(60).optional(),
  descriptionAr: z.string().trim().max(2000).optional(),
  startDate: z.string().regex(YMD_REGEX).optional(),
  endDate: z.string().regex(YMD_REGEX).optional(),
  totalWeeks: z.coerce.number().int().min(1).max(52).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

const weekSchema = z.object({
  weekNumber: z.coerce.number().int().min(1).max(60).optional(),
  titleAr: z.string().trim().min(2, 'عنوان الأسبوع مطلوب').max(160),
  descriptionAr: z.string().trim().max(2000).optional().default(''),
  objectivesAr: z.string().trim().max(2000).optional().default(''),
  teacherNotesAr: z.string().trim().max(2000).optional().default(''),
  startDate: z.string().regex(YMD_REGEX, 'تاريخ بداية الأسبوع غير صالح'),
  endDate: z.string().regex(YMD_REGEX, 'تاريخ نهاية الأسبوع غير صالح'),
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'POSTPONED']).optional().default('PLANNED'),
  displayOrder: z.coerce.number().int().min(0).optional(),
  unitIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  lessonIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

const taskSchema = z.object({
  taskType: z.enum(['VIDEO', 'HOMEWORK', 'EXAM', 'PDF', 'COURSE', 'LIVE_SESSION', 'CUSTOM']),
  entityId: z.coerce.number().int().positive().nullable().optional(),
  titleAr: z.string().trim().min(2, 'عنوان المهمة مطلوب').max(200),
  instructionsAr: z.string().trim().max(1500).optional().default(''),
  isRequired: z.boolean().optional().default(true),
  displayOrder: z.coerce.number().int().min(0).optional(),
  availableAt: z.string().datetime().nullable().optional().or(z.literal('')),
  dueAt: z.string().datetime().nullable().optional().or(z.literal('')),
});

function parseOptionalDate(val: string | null | undefined): Date | null {
  if (!val || !val.trim()) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function hydratePlanById(planId: number): Promise<CurriculumPlanRecord | null> {
  const [plan] = await db
    .select()
    .from(curriculumPlans)
    .where(eq(curriculumPlans.id, planId))
    .limit(1);
  if (!plan) return null;

  const [[track], [grade], weekRows] = await Promise.all([
    db.select().from(academicTracks).where(eq(academicTracks.id, plan.trackId)).limit(1),
    db.select().from(grades).where(eq(grades.id, plan.gradeId)).limit(1),
    db
      .select()
      .from(curriculumWeeks)
      .where(eq(curriculumWeeks.planId, plan.id))
      .orderBy(asc(curriculumWeeks.displayOrder), asc(curriculumWeeks.weekNumber), asc(curriculumWeeks.id)),
  ]);

  const weekIds = weekRows.map((w) => w.id);
  const taskRows =
    weekIds.length > 0
      ? await db
          .select()
          .from(curriculumWeekTasks)
          .where(inArray(curriculumWeekTasks.weekId, weekIds))
          .orderBy(asc(curriculumWeekTasks.displayOrder), asc(curriculumWeekTasks.id))
      : [];

  const tasksByWeek = new Map<number, CurriculumTaskRecord[]>();
  for (const t of taskRows) {
    const arr = tasksByWeek.get(t.weekId) || [];
    arr.push({
      id: t.id,
      weekId: t.weekId,
      taskType: t.taskType as CurriculumTaskType,
      entityId: t.entityId ?? null,
      titleAr: t.titleAr,
      instructionsAr: t.instructionsAr || '',
      isRequired: Boolean(t.isRequired),
      displayOrder: t.displayOrder,
      availableAt: t.availableAt ? t.availableAt.toISOString() : null,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    });
    tasksByWeek.set(t.weekId, arr);
  }

  const weeks: CurriculumWeekRecord[] = weekRows.map((w) => ({
    id: w.id,
    planId: w.planId,
    weekNumber: w.weekNumber,
    titleAr: w.titleAr,
    descriptionAr: w.descriptionAr || '',
    objectivesAr: w.objectivesAr || '',
    teacherNotesAr: w.teacherNotesAr || '',
    startDate: w.startDate,
    endDate: w.endDate,
    status: w.status as CurriculumWeekRecord['status'],
    displayOrder: w.displayOrder,
    unitIds: Array.isArray(w.unitIdsJson) ? w.unitIdsJson : [],
    lessonIds: Array.isArray(w.lessonIdsJson) ? w.lessonIdsJson : [],
    tasks: tasksByWeek.get(w.id) || [],
  }));

  return {
    id: plan.id,
    titleAr: plan.titleAr,
    trackId: plan.trackId,
    trackNameAr: track?.nameAr || '',
    gradeId: plan.gradeId,
    gradeNameAr: grade?.nameAr || '',
    academicYearAr: plan.academicYearAr || '',
    descriptionAr: plan.descriptionAr || '',
    startDate: plan.startDate,
    endDate: plan.endDate,
    totalWeeks: plan.totalWeeks,
    status: plan.status as CurriculumPlanRecord['status'],
    publishedAt: plan.publishedAt ? plan.publishedAt.toISOString() : null,
    weeks,
  };
}

/**
 * Shared loader for Student Dashboard, Student Curriculum Screen, and Parent Report.
 * Returns the active PUBLISHED curriculum plan for (trackId, gradeId) + student's manual checkoffs.
 */
export async function loadStudentCurriculumBundle(input: {
  studentId: number;
  trackId?: number | null;
  gradeId?: number | null;
}): Promise<{
  plan: CurriculumPlanRecord | null;
  manualReviewedTaskIds: Record<number, { isReviewed: boolean; reviewedAt: string | null }>;
}> {
  if (!input.gradeId) {
    return { plan: null, manualReviewedTaskIds: {} };
  }

  const cacheKey = `grade:${input.gradeId}:track:${input.trackId ?? 'any'}`;
  const plan = (await curriculumPlanCache.getOrLoad(cacheKey, async () => {
    const conditions = [
      eq(curriculumPlans.status, 'PUBLISHED'),
      eq(curriculumPlans.gradeId, input.gradeId!),
    ];
    if (input.trackId) {
      conditions.push(eq(curriculumPlans.trackId, input.trackId));
    }

    const [publishedPlan] = await db
      .select({ id: curriculumPlans.id })
      .from(curriculumPlans)
      .where(and(...conditions))
      .orderBy(desc(curriculumPlans.publishedAt), desc(curriculumPlans.updatedAt))
      .limit(1);

    if (!publishedPlan) return null;
    return hydratePlanById(publishedPlan.id);
  })) as CurriculumPlanRecord | null;

  if (!plan) {
    return { plan: null, manualReviewedTaskIds: {} };
  }

  const allTaskIds = plan.weeks.flatMap((w) => w.tasks.map((t) => t.id));
  const manualReviewedTaskIds: Record<number, { isReviewed: boolean; reviewedAt: string | null }> =
    {};

  if (allTaskIds.length > 0) {
    const progRows = await db
      .select()
      .from(studentCurriculumTaskProgress)
      .where(
        and(
          eq(studentCurriculumTaskProgress.studentId, input.studentId),
          inArray(studentCurriculumTaskProgress.taskId, allTaskIds),
        ),
      );
    for (const p of progRows) {
      manualReviewedTaskIds[p.taskId] = {
        isReviewed: Boolean(p.isReviewed),
        reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
      };
    }
  }

  return { plan, manualReviewedTaskIds };
}

/**
 * Computes a clean, real teacher-side adherence summary for a curriculum plan
 * based on active enrolled students in the plan's grade and their actual records.
 */
async function computeTeacherPlanAdherenceSummary(plan: CurriculumPlanRecord) {
  const activeEnr = await db
    .select({ studentId: enrollments.userId })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(
      and(
        eq(enrollments.gradeId, plan.gradeId),
        eq(enrollments.status, 'ACTIVE'),
        eq(users.status, 'ACTIVE'),
      ),
    );

  const studentIds = Array.from(new Set(activeEnr.map((e) => e.studentId)));
  const currentWeek = resolveCurrentCurriculumWeek(plan.weeks);

  if (studentIds.length === 0 || !currentWeek) {
    return {
      enrolledStudentsCount: studentIds.length,
      currentWeekNumber: currentWeek?.weekNumber ?? null,
      currentWeekTitleAr: currentWeek?.titleAr ?? null,
      averageWeeklyCompletionPercent: null as number | null,
      fullyCompletedStudentsCount: 0,
      studentsWithPendingRequiredCount: 0,
    };
  }

  const requiredTasks = currentWeek.tasks.filter((t) => t.isRequired);
  if (requiredTasks.length === 0) {
    return {
      enrolledStudentsCount: studentIds.length,
      currentWeekNumber: currentWeek.weekNumber,
      currentWeekTitleAr: currentWeek.titleAr,
      averageWeeklyCompletionPercent: null as number | null,
      fullyCompletedStudentsCount: 0,
      studentsWithPendingRequiredCount: 0,
    };
  }

  const videoIds = requiredTasks
    .filter((t) => t.taskType === 'VIDEO' && t.entityId)
    .map((t) => t.entityId!);
  const hwIds = requiredTasks
    .filter((t) => t.taskType === 'HOMEWORK' && t.entityId)
    .map((t) => t.entityId!);
  const examIds = requiredTasks
    .filter((t) => t.taskType === 'EXAM' && t.entityId)
    .map((t) => t.entityId!);
  const manualTaskIds = requiredTasks
    .filter((t) => t.taskType === 'PDF' || t.taskType === 'LIVE_SESSION' || t.taskType === 'CUSTOM')
    .map((t) => t.id);

  const [vRows, hwRows, exRows, mRows] = await Promise.all([
    videoIds.length > 0
      ? db
          .select({
            studentId: progressRecords.userId,
            videoId: progressRecords.videoId,
            isCompleted: progressRecords.isCompleted,
            percentComplete: progressRecords.completionPercent,
          })
          .from(progressRecords)
          .where(
            and(
              inArray(progressRecords.userId, studentIds),
              inArray(progressRecords.videoId, videoIds),
            ),
          )
      : Promise.resolve([]),
    hwIds.length > 0
      ? db
          .select({
            studentId: homeworkSubmissions.studentId,
            assignmentId: homeworkSubmissions.assignmentId,
            status: homeworkSubmissions.status,
          })
          .from(homeworkSubmissions)
          .where(
            and(
              inArray(homeworkSubmissions.studentId, studentIds),
              inArray(homeworkSubmissions.assignmentId, hwIds),
            ),
          )
      : Promise.resolve([]),
    examIds.length > 0
      ? db
          .select({
            studentId: examAttempts.userId,
            examId: examAttempts.examId,
            status: examAttempts.status,
          })
          .from(examAttempts)
          .where(
            and(
              inArray(examAttempts.userId, studentIds),
              inArray(examAttempts.examId, examIds),
            ),
          )
      : Promise.resolve([]),
    manualTaskIds.length > 0
      ? db
          .select({
            studentId: studentCurriculumTaskProgress.studentId,
            taskId: studentCurriculumTaskProgress.taskId,
            isReviewed: studentCurriculumTaskProgress.isReviewed,
          })
          .from(studentCurriculumTaskProgress)
          .where(
            and(
              inArray(studentCurriculumTaskProgress.studentId, studentIds),
              inArray(studentCurriculumTaskProgress.taskId, manualTaskIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const vDoneSet = new Set(
    vRows
      .filter((r) => r.isCompleted || (r.percentComplete ?? 0) >= 95)
      .map((r) => `${r.studentId}:${r.videoId}`),
  );
  const hwDoneSet = new Set(
    hwRows
      .filter((r) => ['SUBMITTED', 'SUBMITTED_LATE', 'UNDER_REVIEW', 'GRADED'].includes(r.status))
      .map((r) => `${r.studentId}:${r.assignmentId}`),
  );
  const exDoneSet = new Set(
    exRows
      .filter((r) => r.status !== 'IN_PROGRESS')
      .map((r) => `${r.studentId}:${r.examId}`),
  );
  const mDoneSet = new Set(
    mRows.filter((r) => r.isReviewed).map((r) => `${r.studentId}:${r.taskId}`),
  );

  let sumPct = 0;
  let fullCount = 0;
  let pendingCount = 0;

  for (const sid of studentIds) {
    let completed = 0;
    for (const t of requiredTasks) {
      if (t.taskType === 'VIDEO' && t.entityId && vDoneSet.has(`${sid}:${t.entityId}`)) {
        completed++;
      } else if (t.taskType === 'HOMEWORK' && t.entityId && hwDoneSet.has(`${sid}:${t.entityId}`)) {
        completed++;
      } else if (t.taskType === 'EXAM' && t.entityId && exDoneSet.has(`${sid}:${t.entityId}`)) {
        completed++;
      } else if (mDoneSet.has(`${sid}:${t.id}`)) {
        completed++;
      }
    }
    const pct = Math.round((completed / requiredTasks.length) * 100);
    sumPct += pct;
    if (completed === requiredTasks.length) fullCount++;
    else pendingCount++;
  }

  return {
    enrolledStudentsCount: studentIds.length,
    currentWeekNumber: currentWeek.weekNumber,
    currentWeekTitleAr: currentWeek.titleAr,
    averageWeeklyCompletionPercent: Math.round(sumPct / studentIds.length),
    fullyCompletedStudentsCount: fullCount,
    studentsWithPendingRequiredCount: pendingCount,
  };
}

// =========================================================================
// ADMIN CURRICULUM ROUTER (/api/admin/curriculum)
// =========================================================================
export const adminCurriculumRouter = Router();
adminCurriculumRouter.use(express.json({ limit: '2mb' }));
adminCurriculumRouter.use(
  requireAuth,
  requireActiveAccount,
  requireStaff(),
  requireCurriculumPermission,
);
adminCurriculumRouter.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400) curriculumPlanCache.clear();
    });
  }
  next();
});

adminCurriculumRouter.get('/', async (_req, res) => {
  try {
    const [planRows, trackRows, gradeRows, weekRows, taskRows] = await Promise.all([
      db
        .select()
        .from(curriculumPlans)
        .orderBy(desc(curriculumPlans.updatedAt), desc(curriculumPlans.id)),
      db.select().from(academicTracks),
      db.select().from(grades),
      db.select().from(curriculumWeeks),
      db.select({ id: curriculumWeekTasks.id, weekId: curriculumWeekTasks.weekId }).from(curriculumWeekTasks),
    ]);

    const trackMap = new Map(trackRows.map((t) => [t.id, t.nameAr]));
    const gradeMap = new Map(gradeRows.map((g) => [g.id, g.nameAr]));

    const weekIdsByPlan = new Map<number, number[]>();
    for (const w of weekRows) {
      const arr = weekIdsByPlan.get(w.planId) || [];
      arr.push(w.id);
      weekIdsByPlan.set(w.planId, arr);
    }

    const taskCountByWeek = new Map<number, number>();
    for (const t of taskRows) {
      taskCountByWeek.set(t.weekId, (taskCountByWeek.get(t.weekId) || 0) + 1);
    }

    return res.json({
      plans: planRows.map((p) => {
        const wIds = weekIdsByPlan.get(p.id) || [];
        const totalTasks = wIds.reduce((sum, wid) => sum + (taskCountByWeek.get(wid) || 0), 0);
        return {
          id: p.id,
          titleAr: p.titleAr,
          trackId: p.trackId,
          trackNameAr: trackMap.get(p.trackId) || '',
          gradeId: p.gradeId,
          gradeNameAr: gradeMap.get(p.gradeId) || '',
          academicYearAr: p.academicYearAr,
          descriptionAr: p.descriptionAr,
          startDate: p.startDate,
          endDate: p.endDate,
          totalWeeks: p.totalWeeks,
          actualWeeksCount: wIds.length,
          totalTasksCount: totalTasks,
          status: p.status,
          publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
          updatedAt: p.updatedAt.toISOString(),
        };
      }),
    });
  } catch (err) {
    console.error('Admin curriculum list error:', err);
    return res.status(500).json({ error: 'تعذر تحميل خطط المنهج' });
  }
});

adminCurriculumRouter.get('/catalog', async (req, res) => {
  try {
    const gradeId = req.query.gradeId ? Number(req.query.gradeId) : null;
    const [unitRows, lessonRows, videoRows, hwRows, examRows, courseRows, schedRows] =
      await Promise.all([
        gradeId
          ? db.select().from(units).where(eq(units.gradeId, gradeId)).orderBy(asc(units.sortOrder))
          : db.select().from(units).orderBy(asc(units.sortOrder)),
        db.select().from(lessons).orderBy(asc(lessons.sortOrder)),
        db.select().from(videos).orderBy(asc(videos.sortOrder), desc(videos.id)),
        gradeId
          ? db
              .select({
                id: homeworkAssignments.id,
                titleAr: homeworkAssignments.titleAr,
                gradeId: homeworkAssignments.gradeId,
                publicationStatus: homeworkAssignments.publicationStatus,
                deadline: homeworkAssignments.deadline,
              })
              .from(homeworkAssignments)
              .where(eq(homeworkAssignments.gradeId, gradeId))
              .orderBy(desc(homeworkAssignments.id))
          : db
              .select({
                id: homeworkAssignments.id,
                titleAr: homeworkAssignments.titleAr,
                gradeId: homeworkAssignments.gradeId,
                publicationStatus: homeworkAssignments.publicationStatus,
                deadline: homeworkAssignments.deadline,
              })
              .from(homeworkAssignments)
              .orderBy(desc(homeworkAssignments.id)),
        gradeId
          ? db
              .select({
                id: exams.id,
                titleAr: exams.titleAr,
                gradeId: exams.gradeId,
                isPublished: exams.isPublished,
                durationMinutes: exams.durationMin,
                startsAt: exams.startsAt,
                endsAt: exams.endsAt,
              })
              .from(exams)
              .where(eq(exams.gradeId, gradeId))
              .orderBy(desc(exams.id))
          : db
              .select({
                id: exams.id,
                titleAr: exams.titleAr,
                gradeId: exams.gradeId,
                isPublished: exams.isPublished,
                durationMinutes: exams.durationMin,
                startsAt: exams.startsAt,
                endsAt: exams.endsAt,
              })
              .from(exams)
              .orderBy(desc(exams.id)),
        gradeId
          ? db.select().from(courses).where(eq(courses.gradeId, gradeId)).orderBy(desc(courses.id))
          : db.select().from(courses).orderBy(desc(courses.id)),
        gradeId
          ? db
              .select()
              .from(lectureSchedules)
              .where(eq(lectureSchedules.gradeId, gradeId))
              .orderBy(desc(lectureSchedules.scheduledAt))
          : db.select().from(lectureSchedules).orderBy(desc(lectureSchedules.scheduledAt)),
      ]);

    const unitIdSet = new Set(unitRows.map((u) => u.id));
    const filteredLessons = gradeId ? lessonRows.filter((l) => unitIdSet.has(l.unitId)) : lessonRows;
    const lessonIdSet = new Set(filteredLessons.map((l) => l.id));
    const filteredVideos = gradeId ? videoRows.filter((v) => lessonIdSet.has(v.lessonId)) : videoRows;

    return res.json({
      units: unitRows.map((u) => ({ id: u.id, titleAr: u.titleAr })),
      lessons: filteredLessons.map((l) => ({
        id: l.id,
        unitId: l.unitId,
        titleAr: l.titleAr,
        hasPdf: Boolean(l.pdfUrl),
        pdfTitleAr: l.pdfTitleAr || l.titleAr,
      })),
      videos: filteredVideos.map((v) => ({
        id: v.id,
        lessonId: v.lessonId,
        titleAr: v.titleAr,
        durationSec: v.durationSec,
      })),
      homeworks: hwRows.map((h) => ({
        id: h.id,
        titleAr: h.titleAr,
        status: h.publicationStatus,
        deadline: h.deadline ? h.deadline.toISOString() : null,
      })),
      exams: examRows.map((e) => ({
        id: e.id,
        titleAr: e.titleAr,
        isPublished: e.isPublished,
        durationMinutes: e.durationMinutes,
        startsAt: e.startsAt ? e.startsAt.toISOString() : null,
        endsAt: e.endsAt ? e.endsAt.toISOString() : null,
      })),
      courses: courseRows.map((c) => ({ id: c.id, titleAr: c.titleAr })),
      scheduleEvents: schedRows.map((s) => ({
        id: s.id,
        titleAr: s.titleAr,
        startsAt: s.scheduledAt.toISOString(),
        endsAt: new Date(s.scheduledAt.getTime() + (s.durationMin || 60) * 60000).toISOString(),
      })),
    });
  } catch (err) {
    console.error('Admin curriculum catalog error:', err);
    return res.status(500).json({ error: 'تعذر تحميل قائمة المحتوى للربط بالخطة' });
  }
});

adminCurriculumRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الخطة غير صالح' });
    }
    const plan = await hydratePlanById(id);
    if (!plan) return res.status(404).json({ error: 'خطة المنهج غير موجودة' });

    const adherenceSummary = await computeTeacherPlanAdherenceSummary(plan);
    return res.json({ plan, adherenceSummary });
  } catch (err) {
    console.error('Admin curriculum detail error:', err);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل خطة المنهج' });
  }
});

adminCurriculumRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const parsed = planCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الخطة غير صالحة' });
    }
    const d = parsed.data;
    const computedEndDate = d.endDate || addDaysToYmd(d.startDate, d.totalWeeks * 7 - 1);

    const created = await db.transaction(async (tx) => {
      if (d.status === 'PUBLISHED') {
        await tx
          .update(curriculumPlans)
          .set({ status: 'ARCHIVED', updatedAt: new Date() })
          .where(
            and(
              eq(curriculumPlans.trackId, d.trackId),
              eq(curriculumPlans.gradeId, d.gradeId),
              eq(curriculumPlans.status, 'PUBLISHED'),
            ),
          );
      }

      const [plan] = await tx
        .insert(curriculumPlans)
        .values({
          titleAr: d.titleAr,
          trackId: d.trackId,
          gradeId: d.gradeId,
          academicYearAr: d.academicYearAr,
          descriptionAr: d.descriptionAr,
          startDate: d.startDate,
          endDate: computedEndDate,
          totalWeeks: d.totalWeeks,
          status: d.status,
          publishedAt: d.status === 'PUBLISHED' ? new Date() : null,
          createdById: req.authUser!.id,
        })
        .returning();

      if (d.autoGenerateWeeks) {
        const ranges = generateCurriculumWeekRanges(d.startDate, d.totalWeeks);
        await tx.insert(curriculumWeeks).values(
          ranges.map((r, idx) => ({
            planId: plan.id,
            weekNumber: r.weekNumber,
            titleAr: r.titleAr,
            startDate: r.startDate,
            endDate: r.endDate,
            status: idx === 0 ? 'ACTIVE' : 'PLANNED',
            displayOrder: idx,
          })),
        );
      }
      return plan;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'CURRICULUM_PLAN_CREATED',
      entityType: 'curriculum_plan',
      entityId: created.id,
      details: { titleAr: created.titleAr, status: created.status, totalWeeks: created.totalWeeks },
    });

    const fullPlan = await hydratePlanById(created.id);
    return res.status(201).json({ plan: fullPlan, message: 'تم إنشاء خطة المنهج بنجاح' });
  } catch (err) {
    console.error('Admin curriculum create error:', err);
    return res.status(500).json({ error: 'تعذر إنشاء خطة المنهج' });
  }
});

adminCurriculumRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الخطة غير صالح' });
    }
    const parsed = planUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات التحديث غير صالحة' });
    }
    const [existing] = await db
      .select()
      .from(curriculumPlans)
      .where(eq(curriculumPlans.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'خطة المنهج غير موجودة' });

    const d = parsed.data;
    const nextTrackId = d.trackId ?? existing.trackId;
    const nextGradeId = d.gradeId ?? existing.gradeId;

    await db.transaction(async (tx) => {
      if (d.status === 'PUBLISHED') {
        await tx
          .update(curriculumPlans)
          .set({ status: 'ARCHIVED', updatedAt: new Date() })
          .where(
            and(
              eq(curriculumPlans.trackId, nextTrackId),
              eq(curriculumPlans.gradeId, nextGradeId),
              eq(curriculumPlans.status, 'PUBLISHED'),
              ne(curriculumPlans.id, id),
            ),
          );
      }
      await tx
        .update(curriculumPlans)
        .set({
          ...(d.titleAr !== undefined ? { titleAr: d.titleAr } : {}),
          ...(d.trackId !== undefined ? { trackId: d.trackId } : {}),
          ...(d.gradeId !== undefined ? { gradeId: d.gradeId } : {}),
          ...(d.academicYearAr !== undefined ? { academicYearAr: d.academicYearAr } : {}),
          ...(d.descriptionAr !== undefined ? { descriptionAr: d.descriptionAr } : {}),
          ...(d.startDate !== undefined ? { startDate: d.startDate } : {}),
          ...(d.endDate !== undefined ? { endDate: d.endDate } : {}),
          ...(d.totalWeeks !== undefined ? { totalWeeks: d.totalWeeks } : {}),
          ...(d.status !== undefined
            ? {
                status: d.status,
                publishedAt: d.status === 'PUBLISHED' ? existing.publishedAt || new Date() : existing.publishedAt,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(curriculumPlans.id, id));
    });

    const fullPlan = await hydratePlanById(id);
    return res.json({ plan: fullPlan, message: 'تم تحديث خطة المنهج بنجاح' });
  } catch (err) {
    console.error('Admin curriculum update error:', err);
    return res.status(500).json({ error: 'تعذر تحديث خطة المنهج' });
  }
});

adminCurriculumRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الخطة غير صالح' });
    }
    await db.delete(curriculumPlans).where(eq(curriculumPlans.id, id));
    return res.json({ message: 'تم حذف خطة المنهج بنجاح' });
  } catch (err) {
    console.error('Admin curriculum delete error:', err);
    return res.status(500).json({ error: 'تعذر حذف خطة المنهج' });
  }
});

adminCurriculumRouter.post('/:id/weeks', async (req, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isInteger(planId) || planId <= 0) {
      return res.status(400).json({ error: 'معرّف الخطة غير صالح' });
    }
    const parsed = weekSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الأسبوع غير صالحة' });
    }
    const existingWeeks = await db
      .select({ id: curriculumWeeks.id, weekNumber: curriculumWeeks.weekNumber, displayOrder: curriculumWeeks.displayOrder })
      .from(curriculumWeeks)
      .where(eq(curriculumWeeks.planId, planId));

    const maxWeekNum = existingWeeks.reduce((m, w) => Math.max(m, w.weekNumber), 0);
    const maxOrder = existingWeeks.reduce((m, w) => Math.max(m, w.displayOrder), -1);

    const d = parsed.data;
    const [week] = await db
      .insert(curriculumWeeks)
      .values({
        planId,
        weekNumber: d.weekNumber ?? maxWeekNum + 1,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        objectivesAr: d.objectivesAr,
        teacherNotesAr: d.teacherNotesAr,
        startDate: d.startDate,
        endDate: d.endDate,
        status: d.status,
        displayOrder: d.displayOrder ?? maxOrder + 1,
        unitIdsJson: d.unitIds,
        lessonIdsJson: d.lessonIds,
      })
      .returning();

    return res.status(201).json({ week, message: 'تمت إضافة الأسبوع للخطة بنجاح' });
  } catch (err) {
    console.error('Admin curriculum add week error:', err);
    return res.status(500).json({ error: 'تعذر إضافة الأسبوع' });
  }
});

adminCurriculumRouter.put('/weeks/:weekId', async (req, res) => {
  try {
    const weekId = Number(req.params.weekId);
    if (!Number.isInteger(weekId) || weekId <= 0) {
      return res.status(400).json({ error: 'معرّف الأسبوع غير صالح' });
    }
    const parsed = weekSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات تحديث الأسبوع غير صالحة' });
    }
    const d = parsed.data;
    const [updated] = await db
      .update(curriculumWeeks)
      .set({
        ...(d.weekNumber !== undefined ? { weekNumber: d.weekNumber } : {}),
        ...(d.titleAr !== undefined ? { titleAr: d.titleAr } : {}),
        ...(d.descriptionAr !== undefined ? { descriptionAr: d.descriptionAr } : {}),
        ...(d.objectivesAr !== undefined ? { objectivesAr: d.objectivesAr } : {}),
        ...(d.teacherNotesAr !== undefined ? { teacherNotesAr: d.teacherNotesAr } : {}),
        ...(d.startDate !== undefined ? { startDate: d.startDate } : {}),
        ...(d.endDate !== undefined ? { endDate: d.endDate } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.displayOrder !== undefined ? { displayOrder: d.displayOrder } : {}),
        ...(d.unitIds !== undefined ? { unitIdsJson: d.unitIds } : {}),
        ...(d.lessonIds !== undefined ? { lessonIdsJson: d.lessonIds } : {}),
        updatedAt: new Date(),
      })
      .where(eq(curriculumWeeks.id, weekId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'الأسبوع غير موجود' });
    return res.json({ week: updated, message: 'تم حفظ تعديلات الأسبوع بنجاح' });
  } catch (err) {
    console.error('Admin curriculum update week error:', err);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الأسبوع' });
  }
});

adminCurriculumRouter.delete('/weeks/:weekId', async (req, res) => {
  try {
    const weekId = Number(req.params.weekId);
    if (!Number.isInteger(weekId) || weekId <= 0) {
      return res.status(400).json({ error: 'معرّف الأسبوع غير صالح' });
    }
    await db.delete(curriculumWeeks).where(eq(curriculumWeeks.id, weekId));
    return res.json({ message: 'تم حذف الأسبوع من الخطة' });
  } catch (err) {
    console.error('Admin curriculum delete week error:', err);
    return res.status(500).json({ error: 'تعذر حذف الأسبوع' });
  }
});

adminCurriculumRouter.post('/weeks/:weekId/tasks', async (req, res) => {
  try {
    const weekId = Number(req.params.weekId);
    if (!Number.isInteger(weekId) || weekId <= 0) {
      return res.status(400).json({ error: 'معرّف الأسبوع غير صالح' });
    }
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات المهمة غير صالحة' });
    }
    const d = parsed.data;
    const existingTasks = await db
      .select({ displayOrder: curriculumWeekTasks.displayOrder })
      .from(curriculumWeekTasks)
      .where(eq(curriculumWeekTasks.weekId, weekId));
    const maxOrder = existingTasks.reduce((m, t) => Math.max(m, t.displayOrder), -1);

    const [created] = await db
      .insert(curriculumWeekTasks)
      .values({
        weekId,
        taskType: d.taskType,
        entityId: d.entityId ?? null,
        titleAr: d.titleAr,
        instructionsAr: d.instructionsAr,
        isRequired: d.isRequired,
        displayOrder: d.displayOrder ?? maxOrder + 1,
        availableAt: parseOptionalDate(d.availableAt),
        dueAt: parseOptionalDate(d.dueAt),
      })
      .returning();

    return res.status(201).json({ task: created, message: 'تمت إضافة المهمة للأسبوع بنجاح' });
  } catch (err) {
    console.error('Admin curriculum add task error:', err);
    return res.status(500).json({ error: 'تعذر إضافة المهمة' });
  }
});

adminCurriculumRouter.put('/tasks/:taskId', async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'معرّف المهمة غير صالح' });
    }
    const parsed = taskSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات تحديث المهمة غير صالحة' });
    }
    const d = parsed.data;
    const [updated] = await db
      .update(curriculumWeekTasks)
      .set({
        ...(d.taskType !== undefined ? { taskType: d.taskType } : {}),
        ...(d.entityId !== undefined ? { entityId: d.entityId ?? null } : {}),
        ...(d.titleAr !== undefined ? { titleAr: d.titleAr } : {}),
        ...(d.instructionsAr !== undefined ? { instructionsAr: d.instructionsAr } : {}),
        ...(d.isRequired !== undefined ? { isRequired: d.isRequired } : {}),
        ...(d.displayOrder !== undefined ? { displayOrder: d.displayOrder } : {}),
        ...(d.availableAt !== undefined ? { availableAt: parseOptionalDate(d.availableAt) } : {}),
        ...(d.dueAt !== undefined ? { dueAt: parseOptionalDate(d.dueAt) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(curriculumWeekTasks.id, taskId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'المهمة غير موجودة' });
    return res.json({ task: updated, message: 'تم تحديث المهمة بنجاح' });
  } catch (err) {
    console.error('Admin curriculum update task error:', err);
    return res.status(500).json({ error: 'تعذر تحديث المهمة' });
  }
});

adminCurriculumRouter.delete('/tasks/:taskId', async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'معرّف المهمة غير صالح' });
    }
    await db.delete(curriculumWeekTasks).where(eq(curriculumWeekTasks.id, taskId));
    return res.json({ message: 'تم حذف المهمة من الأسبوع' });
  } catch (err) {
    console.error('Admin curriculum delete task error:', err);
    return res.status(500).json({ error: 'تعذر حذف المهمة' });
  }
});

// =========================================================================
// STUDENT CURRICULUM ROUTER (/api/student/curriculum)
// =========================================================================
export const studentCurriculumRouter = Router();
studentCurriculumRouter.use(express.json({ limit: '512kb' }));
studentCurriculumRouter.use(requireAuth, requireActiveAccount);

studentCurriculumRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const [enr] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, u.id), eq(enrollments.status, 'ACTIVE')))
      .orderBy(desc(enrollments.id))
      .limit(1);

    const bundle = await loadStudentCurriculumBundle({
      studentId: u.id,
      trackId: enr?.trackId ?? null,
      gradeId: enr?.gradeId ?? null,
    });
    return res.json(bundle);
  } catch (err) {
    console.error('Student curriculum fetch error:', err);
    return res.status(500).json({ error: 'تعذر تحميل خطة المنهج' });
  }
});

studentCurriculumRouter.post('/tasks/:taskId/review', async (req: AuthRequest, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'معرّف المهمة غير صالح' });
    }
    const parsed = z.object({ isReviewed: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'قيمة الحالة غير صالحة' });
    }

    const [taskRow] = await db
      .select({
        id: curriculumWeekTasks.id,
        taskType: curriculumWeekTasks.taskType,
        planStatus: curriculumPlans.status,
        planGradeId: curriculumPlans.gradeId,
      })
      .from(curriculumWeekTasks)
      .innerJoin(curriculumWeeks, eq(curriculumWeeks.id, curriculumWeekTasks.weekId))
      .innerJoin(curriculumPlans, eq(curriculumPlans.id, curriculumWeeks.planId))
      .where(eq(curriculumWeekTasks.id, taskId))
      .limit(1);

    if (!taskRow || taskRow.planStatus !== 'PUBLISHED') {
      return res.status(404).json({ error: 'المهمة غير موجودة أو غير منشورة' });
    }

    if (!['PDF', 'LIVE_SESSION', 'CUSTOM'].includes(taskRow.taskType)) {
      return res.status(400).json({
        error: 'يتم احتساب إتمام المحاضرات والواجبات والامتحانات تلقائيًا من نشاطك الفعلي.',
      });
    }

    const u = req.authUser!;
    if (!isStaffRole(u.roleSlug)) {
      const [approvedEnrollment] = await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.userId, u.id),
            eq(enrollments.gradeId, taskRow.planGradeId),
            eq(enrollments.status, 'APPROVED'),
          ),
        )
        .limit(1);
      if (!approvedEnrollment) {
        return res.status(403).json({ error: 'غير مصرح لك بتحديث مهام خطة صف دراسي غير مشترك به' });
      }
    }

    const now = new Date();
    const reviewedAt = parsed.data.isReviewed ? now : null;

    await db
      .insert(studentCurriculumTaskProgress)
      .values({
        studentId: u.id,
        taskId,
        isReviewed: parsed.data.isReviewed,
        reviewedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [studentCurriculumTaskProgress.studentId, studentCurriculumTaskProgress.taskId],
        set: {
          isReviewed: parsed.data.isReviewed,
          reviewedAt,
          updatedAt: now,
        },
      });

    return res.json({
      taskId,
      isReviewed: parsed.data.isReviewed,
      reviewedAt: reviewedAt ? reviewedAt.toISOString() : null,
      message: parsed.data.isReviewed ? 'تم تسجيل المراجعة بنجاح' : 'تم إلغاء علامة المراجعة',
    });
  } catch (err) {
    console.error('Student curriculum task review toggle error:', err);
    return res.status(500).json({ error: 'تعذر حفظ حالة المراجعة' });
  }
});
