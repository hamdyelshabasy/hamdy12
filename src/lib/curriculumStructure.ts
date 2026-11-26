export interface CurriculumTrackRef {
  id: number;
  nameAr: string;
}

export interface CurriculumGradeRef {
  id: number;
  trackId: number;
  nameAr: string;
}

export interface CurriculumUnitRecord {
  id: number;
  gradeId: number;
  titleAr: string;
  descriptionAr?: string | null;
  sortOrder?: number;
  isVisible?: boolean;
}

export interface CurriculumLessonRecord {
  id: number;
  unitId: number;
  titleAr: string;
  descriptionAr?: string | null;
  sortOrder?: number;
  isVisible?: boolean;
  pdfTitleAr?: string | null;
  pdfContentSummary?: string | null;
  allowPdfDownload?: boolean;
  allowComments?: boolean;
}

export interface CurriculumVideoRef {
  id: number;
  gradeId: number;
  unitId: number | null;
  lessonId: number;
}

export interface UnitInputValidationResult {
  valid: boolean;
  errorAr?: string;
  normalizedTitleAr?: string;
  normalizedDescriptionAr?: string;
}

export interface LessonInputValidationResult {
  valid: boolean;
  errorAr?: string;
  normalizedTitleAr?: string;
  normalizedDescriptionAr?: string;
  normalizedPdfTitleAr?: string | null;
}

export interface EnrichedUnitItem {
  unit: CurriculumUnitRecord;
  gradeNameAr: string;
  trackId: number;
  trackNameAr: string;
  lessonsCount: number;
  videosCount: number;
}

export interface EnrichedLessonItem {
  lesson: CurriculumLessonRecord;
  unitTitleAr: string;
  gradeId: number;
  gradeNameAr: string;
  trackId: number;
  videosCount: number;
}

export interface DeleteImpactSummary {
  lessonsCount: number;
  videosCount: number;
  warningAr: string;
}

export function validateUnitInput(input: {
  gradeId: number;
  titleAr: string;
  descriptionAr?: string | null;
}): UnitInputValidationResult {
  if (!Number.isInteger(input.gradeId) || input.gradeId <= 0) {
    return { valid: false, errorAr: 'يرجى اختيار الصف الدراسي التابع للوحدة' };
  }
  const normalizedTitleAr = (input.titleAr || '').trim();
  if (normalizedTitleAr.length < 2) {
    return { valid: false, errorAr: 'اسم الوحدة يجب أن يكون حرفين على الأقل' };
  }
  if (normalizedTitleAr.length > 160) {
    return { valid: false, errorAr: 'اسم الوحدة طويل جدًا (الحد الأقصى 160 حرفًا)' };
  }
  const normalizedDescriptionAr = (input.descriptionAr || '').trim();
  if (normalizedDescriptionAr.length > 600) {
    return { valid: false, errorAr: 'وصف الوحدة طويل جدًا (الحد الأقصى 600 حرف)' };
  }
  return {
    valid: true,
    normalizedTitleAr,
    normalizedDescriptionAr,
  };
}

export function validateLessonInput(input: {
  unitId: number;
  titleAr: string;
  descriptionAr?: string | null;
  pdfTitleAr?: string | null;
}): LessonInputValidationResult {
  if (!Number.isInteger(input.unitId) || input.unitId <= 0) {
    return { valid: false, errorAr: 'يرجى اختيار الوحدة الدراسية التابع لها الدرس' };
  }
  const normalizedTitleAr = (input.titleAr || '').trim();
  if (normalizedTitleAr.length < 2) {
    return { valid: false, errorAr: 'اسم الدرس يجب أن يكون حرفين على الأقل' };
  }
  if (normalizedTitleAr.length > 180) {
    return { valid: false, errorAr: 'اسم الدرس طويل جدًا (الحد الأقصى 180 حرفًا)' };
  }
  const normalizedDescriptionAr = (input.descriptionAr || '').trim();
  if (normalizedDescriptionAr.length > 800) {
    return { valid: false, errorAr: 'وصف الدرس طويل جدًا (الحد الأقصى 800 حرف)' };
  }
  const rawPdfTitle = (input.pdfTitleAr || '').trim();
  if (rawPdfTitle.length > 180) {
    return { valid: false, errorAr: 'عنوان مذكرة PDF طويل جدًا (الحد الأقصى 180 حرفًا)' };
  }
  return {
    valid: true,
    normalizedTitleAr,
    normalizedDescriptionAr,
    normalizedPdfTitleAr: rawPdfTitle || null,
  };
}

export function getNextSortOrder(items: ReadonlyArray<{ sortOrder?: number | null }>): number {
  let maxOrder = 0;
  for (const item of items) {
    const val = Number(item.sortOrder ?? 0);
    if (Number.isFinite(val) && val > maxOrder) {
      maxOrder = Math.floor(val);
    }
  }
  return maxOrder + 1;
}

export function computeUnitDeleteImpact(
  unitId: number,
  lessons: readonly CurriculumLessonRecord[],
  videos: readonly CurriculumVideoRef[],
): DeleteImpactSummary {
  const unitLessonIds = new Set<number>();
  for (const lesson of lessons) {
    if (lesson.unitId === unitId) {
      unitLessonIds.add(lesson.id);
    }
  }
  let videosCount = 0;
  for (const video of videos) {
    if (unitLessonIds.has(video.lessonId)) {
      videosCount++;
    }
  }
  const lessonsCount = unitLessonIds.size;

  if (lessonsCount === 0 && videosCount === 0) {
    return {
      lessonsCount: 0,
      videosCount: 0,
      warningAr: 'هذه الوحدة فارغة حاليًا ولن يتأثر أي درس أو فيديو عند حذفها.',
    };
  }
  if (videosCount === 0) {
    return {
      lessonsCount,
      videosCount: 0,
      warningAr: `سيتم حذف هذه الوحدة مع ${lessonsCount} ${lessonsCount === 1 ? 'درس مرتبط' : 'دروس مرتبطة'} بها دون التأثير على بيانات الطلاب أو الامتحانات.`,
    };
  }
  return {
    lessonsCount,
    videosCount,
    warningAr: `تنبيه مهم: تحتوي هذه الوحدة على ${lessonsCount} ${lessonsCount === 1 ? 'درس' : 'دروس'} و${videosCount} ${videosCount === 1 ? 'فيديو' : 'فيديوهات'}. حذفها سيحذف الدروس والفيديوهات التابعة لها مع الحفاظ على حسابات الطلاب والامتحانات والمشتريات.`,
  };
}

export function computeLessonDeleteImpact(
  lessonId: number,
  videos: readonly CurriculumVideoRef[],
): DeleteImpactSummary {
  let videosCount = 0;
  for (const video of videos) {
    if (video.lessonId === lessonId) {
      videosCount++;
    }
  }
  if (videosCount === 0) {
    return {
      lessonsCount: 0,
      videosCount: 0,
      warningAr: 'لا توجد فيديوهات مرتبطة بهذا الدرس حاليًا؛ يمكن حذفه بأمان.',
    };
  }
  return {
    lessonsCount: 0,
    videosCount,
    warningAr: `تنبيه مهم: يحتوي هذا الدرس على ${videosCount} ${videosCount === 1 ? 'فيديو مرتبط' : 'فيديوهات مرتبطة'}. حذف الدرس سيحذف هذه الفيديوهات دون التأثير على حسابات الطلاب أو الامتحانات.`,
  };
}

export function filterAndEnrichUnits(params: {
  tracks: readonly CurriculumTrackRef[];
  grades: readonly CurriculumGradeRef[];
  units: readonly CurriculumUnitRecord[];
  lessons: readonly CurriculumLessonRecord[];
  videos: readonly CurriculumVideoRef[];
  trackId?: number;
  gradeId?: number;
  searchQuery?: string;
}): EnrichedUnitItem[] {
  const trackById = new Map(params.tracks.map((t) => [t.id, t]));
  const gradeById = new Map(params.grades.map((g) => [g.id, g]));

  const lessonsCountByUnit = new Map<number, number>();
  const lessonToUnit = new Map<number, number>();
  for (const l of params.lessons) {
    lessonsCountByUnit.set(l.unitId, (lessonsCountByUnit.get(l.unitId) || 0) + 1);
    lessonToUnit.set(l.id, l.unitId);
  }

  const videosCountByUnit = new Map<number, number>();
  for (const v of params.videos) {
    const resolvedUnitId = lessonToUnit.get(v.lessonId) ?? v.unitId ?? 0;
    if (resolvedUnitId) {
      videosCountByUnit.set(resolvedUnitId, (videosCountByUnit.get(resolvedUnitId) || 0) + 1);
    }
  }

  const q = (params.searchQuery || '').trim().toLowerCase();

  return params.units
    .map((unit) => {
      const grade = gradeById.get(unit.gradeId);
      const track = grade ? trackById.get(grade.trackId) : undefined;
      return {
        unit,
        gradeNameAr: grade?.nameAr || 'صف غير محدد',
        trackId: grade?.trackId || 0,
        trackNameAr: track?.nameAr || '',
        lessonsCount: lessonsCountByUnit.get(unit.id) || 0,
        videosCount: videosCountByUnit.get(unit.id) || 0,
      };
    })
    .filter((item) => {
      if (params.trackId && item.trackId !== params.trackId) return false;
      if (params.gradeId && item.unit.gradeId !== params.gradeId) return false;
      if (q) {
        const haystack =
          `${item.unit.titleAr} ${item.unit.descriptionAr || ''} ${item.gradeNameAr}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const orderDiff = (a.unit.sortOrder ?? 0) - (b.unit.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.unit.id - b.unit.id;
    });
}

export function filterAndEnrichLessons(params: {
  grades: readonly CurriculumGradeRef[];
  units: readonly CurriculumUnitRecord[];
  lessons: readonly CurriculumLessonRecord[];
  videos: readonly CurriculumVideoRef[];
  trackId?: number;
  gradeId?: number;
  unitId?: number;
  searchQuery?: string;
}): EnrichedLessonItem[] {
  const gradeById = new Map(params.grades.map((g) => [g.id, g]));
  const unitById = new Map(params.units.map((u) => [u.id, u]));

  const videosCountByLesson = new Map<number, number>();
  for (const v of params.videos) {
    videosCountByLesson.set(v.lessonId, (videosCountByLesson.get(v.lessonId) || 0) + 1);
  }

  const q = (params.searchQuery || '').trim().toLowerCase();

  return params.lessons
    .map((lesson) => {
      const unit = unitById.get(lesson.unitId);
      const grade = unit ? gradeById.get(unit.gradeId) : undefined;
      return {
        lesson,
        unitTitleAr: unit?.titleAr || 'وحدة غير محددة',
        gradeId: unit?.gradeId || 0,
        gradeNameAr: grade?.nameAr || 'صف غير محدد',
        trackId: grade?.trackId || 0,
        videosCount: videosCountByLesson.get(lesson.id) || 0,
      };
    })
    .filter((item) => {
      if (params.trackId && item.trackId !== params.trackId) return false;
      if (params.gradeId && item.gradeId !== params.gradeId) return false;
      if (params.unitId && item.lesson.unitId !== params.unitId) return false;
      if (q) {
        const haystack =
          `${item.lesson.titleAr} ${item.lesson.pdfTitleAr || ''} ${item.unitTitleAr} ${item.gradeNameAr}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const orderDiff = (a.lesson.sortOrder ?? 0) - (b.lesson.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.lesson.id - b.lesson.id;
    });
}
