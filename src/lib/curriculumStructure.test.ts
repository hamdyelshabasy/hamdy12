import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLessonDeleteImpact,
  computeUnitDeleteImpact,
  filterAndEnrichLessons,
  filterAndEnrichUnits,
  getNextSortOrder,
  validateLessonInput,
  validateUnitInput,
} from './curriculumStructure';

test('validateUnitInput rejects invalid grade or short/long title and trims valid inputs', () => {
  assert.equal(validateUnitInput({ gradeId: 0, titleAr: 'الفصل الأول' }).valid, false);
  assert.equal(validateUnitInput({ gradeId: 2, titleAr: ' أ ' }).valid, false);
  assert.equal(validateUnitInput({ gradeId: 2, titleAr: 'و'.repeat(161) }).valid, false);

  const ok = validateUnitInput({
    gradeId: 3,
    titleAr: '  الوحدة الأولى: التيار الكهربي  ',
    descriptionAr: '  شرح شامل لقانون أوم  ',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.normalizedTitleAr, 'الوحدة الأولى: التيار الكهربي');
  assert.equal(ok.normalizedDescriptionAr, 'شرح شامل لقانون أوم');
});

test('validateLessonInput rejects invalid unit or title and normalizes optional pdf title', () => {
  assert.equal(validateLessonInput({ unitId: -1, titleAr: 'الدرس الأول' }).valid, false);
  assert.equal(validateLessonInput({ unitId: 5, titleAr: ' ' }).valid, false);

  const okNoPdf = validateLessonInput({ unitId: 5, titleAr: '  قانون أوم للدائرة المغلقة ', pdfTitleAr: '   ' });
  assert.equal(okNoPdf.valid, true);
  assert.equal(okNoPdf.normalizedTitleAr, 'قانون أوم للدائرة المغلقة');
  assert.equal(okNoPdf.normalizedPdfTitleAr, null);

  const okWithPdf = validateLessonInput({
    unitId: 5,
    titleAr: 'قانونا كيرشوف',
    pdfTitleAr: '  ملخص مسائل كيرشوف  ',
  });
  assert.equal(okWithPdf.valid, true);
  assert.equal(okWithPdf.normalizedPdfTitleAr, 'ملخص مسائل كيرشوف');
});

test('getNextSortOrder returns max + 1 or 1 when empty', () => {
  assert.equal(getNextSortOrder([]), 1);
  assert.equal(getNextSortOrder([{ sortOrder: 2 }, { sortOrder: 7 }, { sortOrder: 4 }]), 8);
});

test('computeUnitDeleteImpact and computeLessonDeleteImpact report accurate dependent counts', () => {
  const lessons = [
    { id: 10, unitId: 1, titleAr: 'درس 1' },
    { id: 11, unitId: 1, titleAr: 'درس 2' },
    { id: 12, unitId: 2, titleAr: 'درس 3' },
  ];
  const videos = [
    { id: 100, gradeId: 3, unitId: 1, lessonId: 10 },
    { id: 101, gradeId: 3, unitId: 1, lessonId: 11 },
    { id: 102, gradeId: 3, unitId: null, lessonId: 11 },
  ];

  const unit1Impact = computeUnitDeleteImpact(1, lessons, videos);
  assert.equal(unit1Impact.lessonsCount, 2);
  assert.equal(unit1Impact.videosCount, 3);
  assert.match(unit1Impact.warningAr, /2/);
  assert.match(unit1Impact.warningAr, /3/);

  const emptyUnitImpact = computeUnitDeleteImpact(99, lessons, videos);
  assert.equal(emptyUnitImpact.lessonsCount, 0);
  assert.equal(emptyUnitImpact.videosCount, 0);

  const lesson11Impact = computeLessonDeleteImpact(11, videos);
  assert.equal(lesson11Impact.videosCount, 2);

  const lesson12Impact = computeLessonDeleteImpact(12, videos);
  assert.equal(lesson12Impact.videosCount, 0);
});

test('filterAndEnrichUnits and filterAndEnrichLessons filter by track, grade, unit, and search query', () => {
  const tracks = [
    { id: 1, nameAr: 'الثانوية العامة' },
    { id: 2, nameAr: 'الأزهر الشريف' },
  ];
  const grades = [
    { id: 10, trackId: 1, nameAr: 'الصف الثالث الثانوي' },
    { id: 20, trackId: 2, nameAr: 'الثالث الثانوي أزهر' },
  ];
  const units = [
    { id: 100, gradeId: 10, titleAr: 'الكهربية التيارية', sortOrder: 2 },
    { id: 101, gradeId: 10, titleAr: 'الفيزياء الحديثة', sortOrder: 1 },
    { id: 200, gradeId: 20, titleAr: 'الحث الكهرومغناطيسي', sortOrder: 1 },
  ];
  const lessons = [
    { id: 1000, unitId: 100, titleAr: 'شدة التيار وفرق الجهد', sortOrder: 1, pdfTitleAr: 'مذكرة أوم' },
    { id: 1001, unitId: 101, titleAr: 'إشعاع الجسم الأسود', sortOrder: 1, pdfTitleAr: null },
    { id: 2000, unitId: 200, titleAr: 'قانون فاراداي', sortOrder: 1, pdfTitleAr: null },
  ];
  const videos = [
    { id: 1, gradeId: 10, unitId: 100, lessonId: 1000 },
    { id: 2, gradeId: 10, unitId: 100, lessonId: 1000 },
  ];

  const track1Units = filterAndEnrichUnits({ tracks, grades, units, lessons, videos, trackId: 1 });
  assert.equal(track1Units.length, 2);
  assert.equal(track1Units[0].unit.id, 101); // sortOrder 1 before 2
  assert.equal(track1Units[1].lessonsCount, 1);
  assert.equal(track1Units[1].videosCount, 2);

  const searchUnits = filterAndEnrichUnits({
    tracks,
    grades,
    units,
    lessons,
    videos,
    searchQuery: 'فاراداي',
  });
  assert.equal(searchUnits.length, 0);

  const searchLessons = filterAndEnrichLessons({
    grades,
    units,
    lessons,
    videos,
    searchQuery: 'فاراداي',
  });
  assert.equal(searchLessons.length, 1);
  assert.equal(searchLessons[0].lesson.id, 2000);
  assert.equal(searchLessons[0].gradeId, 20);
});
