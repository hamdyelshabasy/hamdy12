import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Roles & Permissions (RBAC)
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(), // SUPER_ADMIN | CONTENT_MANAGER | TEACHING_ASSISTANT | SUPPORT | STUDENT
  nameAr: text('name_ar').notNull(),
  descriptionAr: text('description_ar').default(''),
  permissionsJson: jsonb('permissions_json').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Users (linked with Firebase Auth UID or Phone/Password local auth)
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').unique(), // Firebase Auth UID when linked with Google Sign-In
    email: text('email'),
    phone: text('phone').unique(),
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),
    status: text('status').notNull().default('PENDING_APPROVAL'), // PENDING_APPROVAL | ACTIVE | REJECTED | SUSPENDED
    maxDevices: integer('max_devices').notNull().default(2),
    allowConcurrent: boolean('allow_concurrent').notNull().default(false),
    isDemoAccount: boolean('is_demo_account').notNull().default(false),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('users_status_idx').on(t.status), index('users_role_idx').on(t.roleId)],
);

// 3. Academic Tracks (البكالوريا / التعليم الأزهري — editable from Admin)
export const academicTracks = pgTable('academic_tracks', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  subtitleAr: text('subtitle_ar').notNull().default(''),
  descriptionAr: text('description_ar').notNull().default(''),
  accentColor: text('accent_color').notNull().default('#2563EB'),
  sortOrder: integer('sort_order').notNull().default(0),
  isVisible: boolean('is_visible').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Grades (editable, reorderable, hideable from Admin)
export const grades = pgTable(
  'grades',
  {
    id: serial('id').primaryKey(),
    trackId: integer('track_id')
      .references(() => academicTracks.id, { onDelete: 'cascade' })
      .notNull(),
    slug: text('slug').notNull().unique(),
    nameAr: text('name_ar').notNull(),
    descriptionAr: text('description_ar').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isVisible: boolean('is_visible').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('grades_track_idx').on(t.trackId)],
);

// 5. Student Profiles
export const studentProfiles = pgTable(
  'student_profiles',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    parentPhone: text('parent_phone').notNull(),
    governorate: text('governorate').default(''),
    primaryTrackId: integer('primary_track_id').references(() => academicTracks.id),
    primaryGradeId: integer('primary_grade_id').references(() => grades.id),
    approvedById: integer('approved_by_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    decisionNote: text('decision_note').default(''),
    acceptedTermsAt: timestamp('accepted_terms_at').defaultNow().notNull(),
    parentShareCode: text('parent_share_code').unique(),
    parentAccessEnabled: boolean('parent_access_enabled').notNull().default(true),
  },
  (t) => [index('student_profiles_grade_idx').on(t.primaryGradeId)],
);

// 6. Enrollments (students can request joining additional grades subject to teacher approval)
export const enrollments = pgTable(
  'enrollments',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: integer('track_id')
      .references(() => academicTracks.id, { onDelete: 'cascade' })
      .notNull(),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('PENDING_APPROVAL'), // PENDING_APPROVAL | ACTIVE | REJECTED | SUSPENDED
    decidedById: integer('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at'),
    decisionNote: text('decision_note').default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('enrollments_user_grade_uidx').on(t.userId, t.gradeId),
    index('enrollments_status_idx').on(t.status),
  ],
);

// 7. Curriculum: Units
export const units = pgTable(
  'units',
  {
    id: serial('id').primaryKey(),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    titleAr: text('title_ar').notNull(),
    descriptionAr: text('description_ar').default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isVisible: boolean('is_visible').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('units_grade_idx').on(t.gradeId)],
);

// 8. Curriculum: Lessons & PDF Attachments
export const lessons = pgTable(
  'lessons',
  {
    id: serial('id').primaryKey(),
    unitId: integer('unit_id')
      .references(() => units.id, { onDelete: 'cascade' })
      .notNull(),
    titleAr: text('title_ar').notNull(),
    descriptionAr: text('description_ar').default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isVisible: boolean('is_visible').notNull().default(true),
    pdfTitleAr: text('pdf_title_ar'),
    pdfContentSummary: text('pdf_content_summary'),
    pdfUrl: text('pdf_url'),
    allowPdfDownload: boolean('allow_pdf_download').notNull().default(true),
    allowComments: boolean('allow_comments').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('lessons_unit_idx').on(t.unitId)],
);

// 9. Videos (Protected stream asset key & YouTube ID never exposed to unauthorized students)
export const videos = pgTable(
  'videos',
  {
    id: serial('id').primaryKey(),
    trackId: integer('track_id').references(() => academicTracks.id, { onDelete: 'set null' }),
    lessonId: integer('lesson_id')
      .references(() => lessons.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
    titleAr: text('title_ar').notNull(),
    descriptionAr: text('description_ar').default(''),
    youtubeUrl: text('youtube_url').default(''),
    youtubeVideoId: text('youtube_video_id').default(''),
    durationSec: integer('duration_sec').notNull().default(1800),
    thumbnailUrl: text('thumbnail_url').default(''),
    videoType: text('video_type').notNull().default('FREE'), // FREE | PAID | COURSE
    priceEgp: integer('price_egp').notNull().default(0),
    streamAssetKey: text('stream_asset_key').notNull(), // internal key only, never returned in public catalog
    allowSpeedChange: boolean('allow_speed_change').notNull().default(true),
    maxPlaybackSpeed: numeric('max_playback_speed', { precision: 3, scale: 2 }).default('2.00'),
    publicationStatus: text('publication_status').notNull().default('PUBLISHED'), // PUBLISHED | DRAFT | HIDDEN
    isPublished: boolean('is_published').notNull().default(true),
    scheduledAt: timestamp('scheduled_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    viewsCount: integer('views_count').notNull().default(0),
    pdfDriveUrl: text('pdf_drive_url'),
    pdfDriveFileId: text('pdf_drive_file_id'),
    pdfTitle: text('pdf_title'),
    pdfDescription: text('pdf_description'),
    pdfAttachedAt: timestamp('pdf_attached_at'),
    maxOpens: integer('max_opens'), // null = inherit course default or unlimited
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('videos_grade_idx').on(t.gradeId),
    index('videos_lesson_idx').on(t.lessonId),
    index('videos_course_idx').on(t.courseId),
    index('videos_status_idx').on(t.publicationStatus),
  ],
);

// 10. Courses
export const courses = pgTable(
  'courses',
  {
    id: serial('id').primaryKey(),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    titleAr: text('title_ar').notNull(),
    descriptionAr: text('description_ar').default(''),
    thumbnailUrl: text('thumbnail_url').default(''),
    originalPriceEgp: integer('original_price_egp').notNull().default(0),
    discountPriceEgp: integer('discount_price_egp').notNull().default(0),
    validityDays: integer('validity_days').notNull().default(120),
    hasFreePreview: boolean('has_free_preview').notNull().default(true),
    hasCertificate: boolean('has_certificate').notNull().default(true),
    publicationStatus: text('publication_status').notNull().default('PUBLISHED'), // DRAFT | PUBLISHED | HIDDEN | ARCHIVED | REMOVED
    isPublished: boolean('is_published').notNull().default(true),
    defaultVideoMaxOpens: integer('default_video_max_opens'), // null = unlimited
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at'),
    removedAt: timestamp('removed_at'),
    removedById: integer('removed_by_id').references(() => users.id, { onDelete: 'set null' }),
    removalReason: text('removal_reason').default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('courses_grade_idx').on(t.gradeId)],
);

// 10b. Per-Course Student Access Blocks (blocks student from ONLY this course without affecting other courses or account)
export const courseStudentBlocks = pgTable(
  'course_student_blocks',
  {
    id: serial('id').primaryKey(),
    courseId: integer('course_id')
      .references(() => courses.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    reason: text('reason').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    blockedById: integer('blocked_by_id').references(() => users.id, { onDelete: 'set null' }),
    blockedAt: timestamp('blocked_at').defaultNow().notNull(),
    restoredById: integer('restored_by_id').references(() => users.id, { onDelete: 'set null' }),
    restoredAt: timestamp('restored_at'),
  },
  (t) => [
    uniqueIndex('course_student_blocks_uidx').on(t.courseId, t.userId),
    index('course_student_blocks_user_idx').on(t.userId),
  ],
);

// 11. Course Lessons Mapping
export const courseLessons = pgTable(
  'course_lessons',
  {
    id: serial('id').primaryKey(),
    courseId: integer('course_id')
      .references(() => courses.id, { onDelete: 'cascade' })
      .notNull(),
    lessonId: integer('lesson_id')
      .references(() => lessons.id, { onDelete: 'cascade' })
      .notNull(),
    isFreePreview: boolean('is_free_preview').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('course_lessons_uidx').on(t.courseId, t.lessonId)],
);

// 12. Subscription Plans
export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  gradeId: integer('grade_id')
    .references(() => grades.id, { onDelete: 'cascade' })
    .notNull(),
  nameAr: text('name_ar').notNull(),
  descriptionAr: text('description_ar').default(''),
  billingCycle: text('billing_cycle').notNull().default('MONTHLY'), // MONTHLY | TERM | YEARLY
  priceEgp: integer('price_egp').notNull().default(0),
  durationDays: integer('duration_days').notNull().default(30),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 13. Subscriptions
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    planId: integer('plan_id').references(() => plans.id),
    courseId: integer('course_id').references(() => courses.id),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | FROZEN | EXPIRED | CANCELLED
    startsAt: timestamp('starts_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('subscriptions_user_idx').on(t.userId)],
);

// 14. Unified Entitlements Engine (Priority: MANUAL_GRANT > SUBSCRIPTION > PURCHASE > ACTIVATION_CODE)
export const entitlements = pgTable(
  'entitlements',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    targetType: text('target_type').notNull(), // VIDEO | COURSE | GRADE_ALL
    targetId: integer('target_id').notNull(),
    source: text('source').notNull(), // PURCHASE | SUBSCRIPTION | ACTIVATION_CODE | MANUAL_GRANT
    priority: integer('priority').notNull().default(50),
    startsAt: timestamp('starts_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'), // null = permanent
    isRevoked: boolean('is_revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at'),
    grantedById: integer('granted_by_id').references(() => users.id),
    note: text('note').default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('entitlements_user_target_idx').on(t.userId, t.targetType, t.targetId),
    index('entitlements_source_idx').on(t.source),
  ],
);

// 15. Activation Codes (Hashed SHA-256 + Pepper; never stored plaintext)
export const accessCodes = pgTable(
  'access_codes',
  {
    id: serial('id').primaryKey(),
    codeHash: text('code_hash').notNull().unique(),
    codePrefix: text('code_prefix').notNull(), // masked display e.g. PHY-8X2K-****
    targetType: text('target_type').notNull(), // VIDEO | COURSE | GRADE_ALL
    targetId: integer('target_id').notNull(),
    trackId: integer('track_id').references(() => academicTracks.id),
    gradeId: integer('grade_id').references(() => grades.id),
    durationDays: integer('duration_days').notNull().default(30),
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at'),
    boundUserId: integer('bound_user_id').references(() => users.id),
    status: text('status').notNull().default('AVAILABLE'), // AVAILABLE | REDEEMED | EXPIRED | REVOKED | DISABLED | CANCELLED
    codeCategory: text('code_category').notNull().default('CONTENT'), // CONTENT | PLATFORM
    disabledUntil: timestamp('disabled_until'),
    cancelledAt: timestamp('cancelled_at'),
    statusNote: text('status_note').notNull().default(''),
    batchLabel: text('batch_label').default(''),
    createdById: integer('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('access_codes_status_idx').on(t.status),
    index('access_codes_category_idx').on(t.codeCategory),
  ],
);

export const codeRedemptions = pgTable(
  'code_redemptions',
  {
    id: serial('id').primaryKey(),
    codeId: integer('code_id')
      .references(() => accessCodes.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    entitlementId: integer('entitlement_id').references(() => entitlements.id),
    redeemedAt: timestamp('redeemed_at').defaultNow().notNull(),
  },
  (t) => [index('code_redemptions_code_idx').on(t.codeId)],
);

// 15b. Platform Subscriptions (Section A: time-limited platform access codes, strictly separate from paid courses/videos)
export const platformSubscriptions = pgTable(
  'platform_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    accessCodeId: integer('access_code_id').references(() => accessCodes.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    durationDays: integer('duration_days').notNull().default(30),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | EXPIRED | REVOKED
    accessScope: text('access_scope').notNull().default('PLATFORM_ACCESS'),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('platform_subscriptions_user_idx').on(t.userId),
    index('platform_subscriptions_status_idx').on(t.status),
  ],
);

// 16. Discount Coupons
export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  discountType: text('discount_type').notNull().default('PERCENT'), // PERCENT | FIXED
  discountPercent: integer('discount_percent').notNull().default(0),
  discountAmountEgp: integer('discount_amount_egp').notNull().default(0),
  maxUses: integer('max_uses').notNull().default(100),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: timestamp('expires_at'),
  eligibleCourseIdsJson: jsonb('eligible_course_ids_json').$type<number[]>().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 17. Orders & Payments (Separated from Subscriptions/Entitlements)
export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    targetType: text('target_type').notNull(), // VIDEO | COURSE | PLAN
    targetId: integer('target_id').notNull(),
    targetTitleAr: text('target_title_ar').notNull(),
    amountEgp: integer('amount_egp').notNull(),
    discountEgp: integer('discount_egp').notNull().default(0),
    finalAmountEgp: integer('final_amount_egp').notNull(),
    couponCode: text('coupon_code'),
    paymentMethod: text('payment_method').notNull(), // PAYMOB | WALLET | FAWRY | BANK_TRANSFER | MANUAL
    status: text('status').notNull().default('PENDING'), // PENDING | UNDER_REVIEW | PAID | FAILED | REFUNDED
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('orders_user_idx').on(t.userId), index('orders_status_idx').on(t.status)],
);

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    amountEgp: integer('amount_egp').notNull(),
    receiptNote: text('receipt_note').default(''),
    receiptImageData: text('receipt_image_data'),
    status: text('status').notNull().default('PENDING'), // PENDING | VERIFIED | REJECTED | REFUNDED
    verifiedById: integer('verified_by_id').references(() => users.id),
    verifiedAt: timestamp('verified_at'),
    webhookPayloadJson: jsonb('webhook_payload_json'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('payments_order_idx').on(t.orderId)],
);

// 18. Student Groups
export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  gradeId: integer('grade_id')
    .references(() => grades.id, { onDelete: 'cascade' })
    .notNull(),
  nameAr: text('name_ar').notNull(),
  scheduleTextAr: text('schedule_text_ar').default(''),
  descriptionAr: text('description_ar').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .references(() => groups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('group_members_uidx').on(t.groupId, t.userId)],
);

// 19. Exams, Questions, Choices, Assignments, Attempts & Answers
export const exams = pgTable(
  'exams',
  {
    id: serial('id').primaryKey(),
    trackId: integer('track_id').references(() => academicTracks.id, { onDelete: 'set null' }),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
    lessonId: integer('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
    courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
    groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
    assignedUserId: integer('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    titleAr: text('title_ar').notNull(),
    descriptionAr: text('description_ar').default(''),
    instructionsAr: text('instructions_ar').default(''),
    examType: text('exam_type').notNull().default('LESSON_QUIZ'), // LESSON_QUIZ | UNIT_EXAM | MONTHLY | COMPREHENSIVE | FINAL_SIMULATION | HOMEWORK
    durationMin: integer('duration_min').notNull().default(30),
    totalMarks: numeric('total_marks', { precision: 8, scale: 2 }).notNull().default('0'),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    maxAttempts: integer('max_attempts').notNull().default(2),
    passScorePercent: integer('pass_score_percent').notNull().default(60),
    shuffleQuestions: boolean('shuffle_questions').notNull().default(false),
    shuffleChoices: boolean('shuffle_choices').notNull().default(false),
    allowNavigation: boolean('allow_navigation').notNull().default(true),
    allowReviewBeforeSubmit: boolean('allow_review_before_submit').notNull().default(true),
    allowStudentReview: boolean('allow_student_review').notNull().default(true),
    showResultImmediately: boolean('show_result_immediately').notNull().default(true),
    showCorrectAnswers: boolean('show_correct_answers').notNull().default(true),
    showExplanations: boolean('show_explanations').notNull().default(true),
    allowNegativeMarking: boolean('allow_negative_marking').notNull().default(false),
    assignmentScope: text('assignment_scope').notNull().default('GRADE'), // GRADE | GROUP | STUDENTS
    publicationStatus: text('publication_status').notNull().default('PUBLISHED'), // PUBLISHED | DRAFT | SCHEDULED | HIDDEN | ARCHIVED
    requiredVideoId: integer('required_video_id').references(() => videos.id, { onDelete: 'set null' }),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('exams_grade_idx').on(t.gradeId),
    index('exams_status_idx').on(t.publicationStatus),
  ],
);

export const examAssignments = pgTable(
  'exam_assignments',
  {
    id: serial('id').primaryKey(),
    examId: integer('exam_id')
      .references(() => exams.id, { onDelete: 'cascade' })
      .notNull(),
    studentId: integer('student_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (t) => [
    index('exam_assignments_exam_idx').on(t.examId),
    index('exam_assignments_student_idx').on(t.studentId),
    index('exam_assignments_group_idx').on(t.groupId),
  ],
);

export const questions = pgTable(
  'questions',
  {
    id: serial('id').primaryKey(),
    bankCode: text('bank_code'),
    trackId: integer('track_id').references(() => academicTracks.id, { onDelete: 'set null' }),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
    lessonId: integer('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
    topicAr: text('topic_ar').default('').notNull(),
    questionType: text('question_type').notNull(), // MCQ | TRUE_FALSE | NUMERIC | SHORT_ANSWER | ESSAY | PHYSICS_PROBLEM | IMAGE_DIAGRAM | FILE_UPLOAD
    difficulty: text('difficulty').notNull().default('MEDIUM'), // EASY | MEDIUM | HARD
    promptAr: text('prompt_ar').notNull(),
    latexFormula: text('latex_formula'),
    imageUrl: text('image_url'),
    points: integer('points').notNull().default(2),
    negativePoints: numeric('negative_points', { precision: 8, scale: 2 }).notNull().default('0'),
    numericAnswer: numeric('numeric_answer', { precision: 12, scale: 4 }),
    numericTolerance: numeric('numeric_tolerance', { precision: 10, scale: 4 }).default('0.05'),
    numericUnit: text('numeric_unit').default(''),
    shortAnswerRulesJson: jsonb('short_answer_rules_json').$type<string[]>().default([]),
    modelAnswerAr: text('model_answer_ar').default(''),
    explanationAr: text('explanation_ar').default(''),
    sourceAr: text('source_ar').default('').notNull(),
    teacherNotesAr: text('teacher_notes_ar').default('').notNull(),
    tagsJson: jsonb('tags_json').$type<string[]>().default([]).notNull(),
    isBankItem: boolean('is_bank_item').notNull().default(true),
    sourceBankQuestionId: integer('source_bank_question_id'),
    approvalStatus: text('approval_status').notNull().default('APPROVED'), // DRAFT | PENDING_REVIEW | APPROVED | RETURNED | ARCHIVED
    reviewFeedbackAr: text('review_feedback_ar').default('').notNull(),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedById: integer('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    version: integer('version').notNull().default(1),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('questions_grade_idx').on(t.gradeId),
    index('questions_bank_status_idx').on(t.isBankItem, t.approvalStatus, t.isArchived),
    index('questions_source_bank_idx').on(t.sourceBankQuestionId),
    index('questions_creator_idx').on(t.createdById),
  ],
);

export const examQuestions = pgTable(
  'exam_questions',
  {
    id: serial('id').primaryKey(),
    examId: integer('exam_id')
      .references(() => exams.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: integer('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    pointsOverride: integer('points_override'),
  },
  (t) => [uniqueIndex('exam_questions_uidx').on(t.examId, t.questionId)],
);

export const choices = pgTable(
  'choices',
  {
    id: serial('id').primaryKey(),
    questionId: integer('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    labelAr: text('label_ar').notNull(),
    latexFormula: text('latex_formula'),
    isCorrect: boolean('is_correct').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('choices_question_idx').on(t.questionId)],
);

export const examAttempts = pgTable(
  'exam_attempts',
  {
    id: serial('id').primaryKey(),
    examId: integer('exam_id')
      .references(() => exams.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    status: text('status').notNull().default('IN_PROGRESS'), // IN_PROGRESS | SUBMITTED | AUTO_SUBMITTED | AWAITING_MANUAL_GRADING | GRADED
    startedAt: timestamp('started_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
    submittedAt: timestamp('submitted_at'),
    questionOrderJson: jsonb('question_order_json').$type<number[]>().default([]),
    choiceOrderJson: jsonb('choice_order_json').$type<Record<string, number[]>>().default({}),
    flaggedQuestionsJson: jsonb('flagged_questions_json').$type<number[]>().default([]),
    autoScore: numeric('auto_score', { precision: 8, scale: 2 }).notNull().default('0'),
    manualScore: numeric('manual_score', { precision: 8, scale: 2 }).notNull().default('0'),
    totalScore: numeric('total_score', { precision: 8, scale: 2 }).notNull().default('0'),
    maxScore: numeric('max_score', { precision: 8, scale: 2 }).notNull().default('0'),
    passed: boolean('passed').notNull().default(false),
    generalFeedback: text('general_feedback').default(''),
    resultPublished: boolean('result_published').notNull().default(true),
    gradedAt: timestamp('graded_at'),
    gradedById: integer('graded_by_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('exam_attempts_user_exam_idx').on(t.userId, t.examId)],
);

export const studentAnswers = pgTable(
  'student_answers',
  {
    id: serial('id').primaryKey(),
    attemptId: integer('attempt_id')
      .references(() => examAttempts.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: integer('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    selectedChoiceId: integer('selected_choice_id').references(() => choices.id, { onDelete: 'set null' }),
    textAnswer: text('text_answer'),
    numericAnswer: text('numeric_answer'),
    uploadedFileName: text('uploaded_file_name'),
    uploadedFileData: text('uploaded_file_data'),
    isCorrect: boolean('is_correct'),
    awardedPoints: numeric('awarded_points', { precision: 8, scale: 2 }).notNull().default('0'),
    needsManualGrading: boolean('needs_manual_grading').notNull().default(false),
    graderFeedback: text('grader_feedback').default(''),
    gradedById: integer('graded_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('student_answers_attempt_q_uidx').on(t.attemptId, t.questionId)],
);

// 20. Progress Records & Watch Activity
export const progressRecords = pgTable(
  'progress_records',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    videoId: integer('video_id')
      .references(() => videos.id, { onDelete: 'cascade' })
      .notNull(),
    lastPositionSec: integer('last_position_sec').notNull().default(0),
    watchedSec: integer('watched_sec').notNull().default(0),
    completionPercent: integer('completion_percent').notNull().default(0),
    isCompleted: boolean('is_completed').notNull().default(false),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('progress_records_user_video_uidx').on(t.userId, t.videoId)],
);

// 20b. Video Access & Open-Limit Counters (Backend-only idempotent session accounting)
export const videoAccessCounters = pgTable(
  'video_access_counters',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    videoId: integer('video_id')
      .references(() => videos.id, { onDelete: 'cascade' })
      .notNull(),
    countedOpens: integer('counted_opens').notNull().default(0),
    maxOpensOverride: integer('max_opens_override'), // null = inherit video/course; -1 = explicitly unlimited; >0 = custom cap
    bonusOpens: integer('bonus_opens').notNull().default(0),
    lastSessionId: integer('last_session_id'),
    lastCountedAt: timestamp('last_counted_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('video_access_counters_user_video_uidx').on(t.userId, t.videoId)],
);

// 21. Device Sessions (Security, Device Limits, Concurrent Playback Control, Remote Logout)
export const deviceSessions = pgTable(
  'device_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    sessionTokenHash: text('session_token_hash').notNull().unique(),
    deviceFingerprint: text('device_fingerprint').notNull(),
    deviceLabel: text('device_label').notNull().default('متصفح ويب'),
    userAgent: text('user_agent').default(''),
    ipAddress: text('ip_address').default(''),
    isRevoked: boolean('is_revoked').notNull().default(false),
    isBlocked: boolean('is_blocked').notNull().default(false),
    activeVideoId: integer('active_video_id'),
    lastHeartbeatAt: timestamp('last_heartbeat_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('device_sessions_user_idx').on(t.userId)],
);

// 22. Lecture Schedule & Live Sessions
export const lectureSchedules = pgTable('lecture_schedules', {
  id: serial('id').primaryKey(),
  gradeId: integer('grade_id')
    .references(() => grades.id, { onDelete: 'cascade' })
    .notNull(),
  groupId: integer('group_id').references(() => groups.id),
  titleAr: text('title_ar').notNull(),
  descriptionAr: text('description_ar').default(''),
  scheduledAt: timestamp('scheduled_at').notNull(),
  durationMin: integer('duration_min').notNull().default(90),
  sessionType: text('session_type').notNull().default('LIVE'), // RECORDED | LIVE | REVISION
  liveProvider: text('live_provider').default('ZOOM'), // ZOOM | MEET | YOUTUBE_LIVE | CUSTOM
  joinUrl: text('join_url').default(''),
  isPublished: boolean('is_published').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 23. Lesson Q&A Comments (with moderation)
export const lessonComments = pgTable(
  'lesson_comments',
  {
    id: serial('id').primaryKey(),
    lessonId: integer('lesson_id')
      .references(() => lessons.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    bodyAr: text('body_ar').notNull(),
    replyAr: text('reply_ar'),
    repliedById: integer('replied_by_id').references(() => users.id),
    status: text('status').notNull().default('APPROVED'), // PENDING | APPROVED | HIDDEN
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('lesson_comments_lesson_idx').on(t.lessonId)],
);

// 24. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    gradeId: integer('grade_id').references(() => grades.id, { onDelete: 'cascade' }),
    titleAr: text('title_ar').notNull(),
    bodyAr: text('body_ar').notNull(),
    type: text('type').notNull().default('GENERAL'), // APPROVAL | NEW_VIDEO | NEW_EXAM | SUBSCRIPTION_EXPIRY | EXAM_RESULT | HOMEWORK | QUESTION_BANK | GENERAL
    targetType: text('target_type'), // HOMEWORK | EXAM | EXAM_RESULT | QUESTION_BANK | STUDENT_APPROVAL | COURSE | VIDEO | CODES | DEVICES | GENERAL
    targetId: integer('target_id'),
    targetMetaJson: jsonb('target_meta_json').$type<Record<string, unknown>>(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('notifications_user_idx').on(t.userId)],
);

// 25. Platform Settings (CMS — branding, teacher info, colors, FAQ, maintenance mode, payment/SMS config)
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 26. Audit Logs (Immutable trail of admin/teacher/security actions)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id),
    actorName: text('actor_name').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').default(''),
    detailsJson: jsonb('details_json'),
    ipAddress: text('ip_address').default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt)],
);

// Relations
export const academicTracksRelations = relations(academicTracks, ({ many }) => ({
  grades: many(grades),
}));

export const gradesRelations = relations(grades, ({ one, many }) => ({
  track: one(academicTracks, { fields: [grades.trackId], references: [academicTracks.id] }),
  units: many(units),
  courses: many(courses),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  studentProfile: one(studentProfiles, { fields: [users.id], references: [studentProfiles.userId] }),
  enrollments: many(enrollments),
  entitlements: many(entitlements),
  sessions: many(deviceSessions),
}));

// ============================================================
// PHASE 3: HOMEWORK, ASSIGNMENTS, SUBMISSIONS & MODEL ANSWERS
// ============================================================

// 27. Private Stored Files for Homework (isolated from list queries, persistent in Cloud SQL)
export const homeworkStoredFiles = pgTable(
  'homework_stored_files',
  {
    id: serial('id').primaryKey(),
    storageKey: text('storage_key').notNull().unique(),
    ownerUserId: integer('owner_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(), // ASSIGNMENT_ATTACHMENT | SUBMISSION_FILE | MODEL_ANSWER
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    dataBase64: text('data_base64').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('homework_stored_files_owner_idx').on(t.ownerUserId),
    index('homework_stored_files_purpose_idx').on(t.purpose),
  ],
);

// 28. Homework Assignments
export const homeworkAssignments = pgTable(
  'homework_assignments',
  {
    id: serial('id').primaryKey(),
    titleAr: text('title_ar').notNull(),
    descriptionAr: text('description_ar').default('').notNull(),
    instructionsAr: text('instructions_ar').default('').notNull(),
    trackId: integer('track_id')
      .references(() => academicTracks.id, { onDelete: 'cascade' })
      .notNull(),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
    lessonId: integer('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
    videoId: integer('video_id').references(() => videos.id, { onDelete: 'set null' }),
    courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
    maximumGrade: numeric('maximum_grade', { precision: 8, scale: 2 }).notNull().default('10'),
    rubricJson: jsonb('rubric_json')
      .$type<Array<{ id: string; labelAr: string; maxPoints: number }>>()
      .notNull()
      .default([]),
    assignmentScope: text('assignment_scope').notNull().default('GRADE'), // GRADE | GROUP | STUDENTS | COURSE
    publicationStatus: text('publication_status').notNull().default('DRAFT'), // DRAFT | PUBLISHED | SCHEDULED | HIDDEN | ARCHIVED
    publishedAt: timestamp('published_at'),
    deadline: timestamp('deadline'),
    allowLateSubmission: boolean('allow_late_submission').notNull().default(false),
    allowResubmission: boolean('allow_resubmission').notNull().default(false),
    maximumSubmissions: integer('maximum_submissions').notNull().default(1),
    allowReopenAfterGrading: boolean('allow_reopen_after_grading').notNull().default(false),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('homework_assignments_grade_idx').on(t.gradeId),
    index('homework_assignments_video_idx').on(t.videoId),
    index('homework_assignments_course_idx').on(t.courseId),
    index('homework_assignments_status_idx').on(t.publicationStatus),
  ],
);

// 29. Homework Targets (Specific Students or Groups)
export const homeworkTargets = pgTable(
  'homework_targets',
  {
    id: serial('id').primaryKey(),
    assignmentId: integer('assignment_id')
      .references(() => homeworkAssignments.id, { onDelete: 'cascade' })
      .notNull(),
    studentId: integer('student_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (t) => [
    index('homework_targets_assignment_idx').on(t.assignmentId),
    index('homework_targets_student_idx').on(t.studentId),
    index('homework_targets_group_idx').on(t.groupId),
  ],
);

// 30. Homework Question / Instruction Attachments (Independent from Video Lesson PDF)
export const homeworkAttachments = pgTable(
  'homework_attachments',
  {
    id: serial('id').primaryKey(),
    assignmentId: integer('assignment_id')
      .references(() => homeworkAssignments.id, { onDelete: 'cascade' })
      .notNull(),
    attachmentType: text('attachment_type').notNull().default('FILE'), // FILE | GOOGLE_DRIVE_PDF
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull().default('application/pdf'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    storageKey: text('storage_key'),
    driveUrl: text('drive_url'),
    driveFileId: text('drive_file_id'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('homework_attachments_assignment_idx').on(t.assignmentId)],
);

// 31. Homework Submissions (Versioned — older versions are never overwritten)
export const homeworkSubmissions = pgTable(
  'homework_submissions',
  {
    id: serial('id').primaryKey(),
    assignmentId: integer('assignment_id')
      .references(() => homeworkAssignments.id, { onDelete: 'cascade' })
      .notNull(),
    studentId: integer('student_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull().default(1),
    clientSubmissionKey: text('client_submission_key'),
    writtenAnswer: text('written_answer').default('').notNull(),
    submittedAt: timestamp('submitted_at'),
    isLate: boolean('is_late').notNull().default(false),
    status: text('status').notNull().default('SUBMITTED'), // DRAFT | SUBMITTED | SUBMITTED_LATE | UNDER_REVIEW | RETURNED_FOR_REVISION | GRADED
    awardedGrade: numeric('awarded_grade', { precision: 8, scale: 2 }),
    gradingMode: text('grading_mode').notNull().default('DIRECT'), // DIRECT | RUBRIC | QUESTION_BY_QUESTION
    questionTotalGrade: numeric('question_total_grade', { precision: 8, scale: 2 }),
    isManualOverride: boolean('is_manual_override').notNull().default(false),
    overrideReason: text('override_reason').default('').notNull(),
    rubricScoresJson: jsonb('rubric_scores_json')
      .$type<Array<{ id: string; labelAr: string; maxPoints: number; awardedPoints: number }>>()
      .notNull()
      .default([]),
    structuredAnswersJson: jsonb('structured_answers_json')
      .$type<
        Array<{
          questionId: number;
          selectedChoiceId?: string | null;
          textAnswer?: string;
        }>
      >()
      .notNull()
      .default([]),
    teacherFeedback: text('teacher_feedback').default('').notNull(),
    revisionInstructions: text('revision_instructions').default('').notNull(),
    isGradePublished: boolean('is_grade_published').notNull().default(false),
    gradedById: integer('graded_by_id').references(() => users.id, { onDelete: 'set null' }),
    gradedAt: timestamp('graded_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('homework_submissions_assignment_student_ver_uidx').on(
      t.assignmentId,
      t.studentId,
      t.version,
    ),
    index('homework_submissions_assignment_idx').on(t.assignmentId),
    index('homework_submissions_student_idx').on(t.studentId),
    index('homework_submissions_status_idx').on(t.status),
  ],
);

// 32. Homework Submission Files (Ordered solution pages / PDFs)
export const homeworkSubmissionFiles = pgTable(
  'homework_submission_files',
  {
    id: serial('id').primaryKey(),
    submissionId: integer('submission_id')
      .references(() => homeworkSubmissions.id, { onDelete: 'cascade' })
      .notNull(),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('homework_submission_files_sub_idx').on(t.submissionId)],
);

// 33. Homework Model Answers (Strict Backend-Enforced Release Rules)
export const homeworkModelAnswers = pgTable(
  'homework_model_answers',
  {
    id: serial('id').primaryKey(),
    assignmentId: integer('assignment_id')
      .references(() => homeworkAssignments.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    titleAr: text('title_ar').notNull().default('نموذج الإجابة'),
    notesAr: text('notes_ar').default('').notNull(),
    sourceType: text('source_type').notNull().default('UPLOADED_FILES'), // UPLOADED_FILES | GOOGLE_DRIVE_PDF | MIXED
    driveUrl: text('drive_url'),
    driveFileId: text('drive_file_id'),
    filesJson: jsonb('files_json')
      .$type<
        Array<{
          storageKey: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
          displayOrder: number;
        }>
      >()
      .notNull()
      .default([]),
    visibilityPolicy: text('visibility_policy').notNull().default('HIDDEN'), // HIDDEN | AFTER_DEADLINE | AFTER_SUBMISSION | AFTER_GRADING | MANUAL_RELEASE | SCHEDULED_RELEASE
    releaseAt: timestamp('release_at'),
    manuallyReleased: boolean('manually_released').notNull().default(false),
    manuallyReleasedAt: timestamp('manually_released_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('homework_model_answers_policy_idx').on(t.visibilityPolicy)],
);

// 34. Homework Question Breakdown Definitions (Assignment-Level Question Weights + Immutable Bank Snapshots)
export const homeworkQuestions = pgTable(
  'homework_questions',
  {
    id: serial('id').primaryKey(),
    assignmentId: integer('assignment_id')
      .references(() => homeworkAssignments.id, { onDelete: 'cascade' })
      .notNull(),
    bankQuestionId: integer('bank_question_id').references(() => questions.id, { onDelete: 'set null' }),
    bankQuestionVersion: integer('bank_question_version'),
    questionType: text('question_type'),
    questionNumber: integer('question_number').notNull().default(1),
    labelAr: text('label_ar').notNull(),
    descriptionAr: text('description_ar').default('').notNull(),
    promptSnapshotAr: text('prompt_snapshot_ar').default('').notNull(),
    questionImagesJson: jsonb('question_images_json')
      .$type<
        Array<{
          storageKey: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
          displayOrder: number;
        }>
      >()
      .default([])
      .notNull(),
    modelAnswerTextSnapshot: text('model_answer_text_snapshot').default('').notNull(),
    modelAnswerFilesJson: jsonb('model_answer_files_json')
      .$type<
        Array<{
          storageKey: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
          displayOrder: number;
        }>
      >()
      .default([])
      .notNull(),
    choicesSnapshotJson: jsonb('choices_snapshot_json')
      .$type<
        Array<{
          id: string;
          labelAr: string;
          imageUrl?: string | null;
          isCorrect: boolean;
          displayOrder: number;
        }>
      >()
      .default([])
      .notNull(),
    maxGrade: numeric('max_grade', { precision: 8, scale: 2 }).notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('homework_questions_assignment_idx').on(t.assignmentId),
    index('homework_questions_order_idx').on(t.assignmentId, t.displayOrder),
    index('homework_questions_bank_idx').on(t.bankQuestionId),
  ],
);

// 35. Per-Question Submission Grades & Individual Teacher Comments (Version-Scoped)
export const homeworkSubmissionQuestionGrades = pgTable(
  'homework_submission_question_grades',
  {
    id: serial('id').primaryKey(),
    submissionId: integer('submission_id')
      .references(() => homeworkSubmissions.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: integer('question_id')
      .references(() => homeworkQuestions.id, { onDelete: 'restrict' })
      .notNull(),
    awardedGrade: numeric('awarded_grade', { precision: 8, scale: 2 }).notNull(),
    teacherComment: text('teacher_comment').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('hw_sub_q_grades_sub_question_uidx').on(t.submissionId, t.questionId),
    index('hw_sub_q_grades_sub_idx').on(t.submissionId),
    index('hw_sub_q_grades_question_idx').on(t.questionId),
  ],
);

// 36. Central Question Bank — Private Immutable File Storage (Isolated from List Queries)
export const questionBankFiles = pgTable(
  'question_bank_files',
  {
    id: serial('id').primaryKey(),
    storageKey: text('storage_key').notNull().unique(),
    uploadedById: integer('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(), // QUESTION_IMAGE | MODEL_ANSWER_FILE
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    dataBase64: text('data_base64').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('qb_files_hash_idx').on(t.sha256Hash),
    index('qb_files_uploader_idx').on(t.uploadedById),
  ],
);

// 37. Central Question Bank — Ordered Multi-Image & Model-Answer Attachments
export const questionAttachments = pgTable(
  'question_attachments',
  {
    id: serial('id').primaryKey(),
    questionId: integer('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    attachmentRole: text('attachment_role').notNull(), // QUESTION_IMAGE | MODEL_ANSWER_IMAGE | MODEL_ANSWER_PDF
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    captionAr: text('caption_ar').default('').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('qb_attachments_question_idx').on(t.questionId),
    index('qb_attachments_storage_idx').on(t.storageKey),
  ],
);

// 38. Central Question Bank — Edit & Review Audit History
export const questionRevisions = pgTable(
  'question_revisions',
  {
    id: serial('id').primaryKey(),
    questionId: integer('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull().default(1),
    changedById: integer('changed_by_id').references(() => users.id, { onDelete: 'set null' }),
    changedByName: text('changed_by_name').notNull(),
    action: text('action').notNull(), // CREATED | UPDATED | SUBMITTED | APPROVED | RETURNED | ARCHIVED | RESTORED
    noteAr: text('note_ar').default('').notNull(),
    snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('qb_revisions_question_idx').on(t.questionId),
    index('qb_revisions_created_idx').on(t.createdAt),
  ],
);

// 39. Teacher-Managed Curriculum Plans (Single Source of Truth for Weekly Plan, Progression & Adherence)
export const curriculumPlans = pgTable(
  'curriculum_plans',
  {
    id: serial('id').primaryKey(),
    titleAr: text('title_ar').notNull(),
    trackId: integer('track_id')
      .references(() => academicTracks.id, { onDelete: 'cascade' })
      .notNull(),
    gradeId: integer('grade_id')
      .references(() => grades.id, { onDelete: 'cascade' })
      .notNull(),
    academicYearAr: text('academic_year_ar').default('').notNull(),
    descriptionAr: text('description_ar').default('').notNull(),
    startDate: text('start_date').notNull(), // YYYY-MM-DD (Cairo calendar date)
    endDate: text('end_date').notNull(), // YYYY-MM-DD
    totalWeeks: integer('total_weeks').notNull().default(12),
    status: text('status').notNull().default('DRAFT'), // DRAFT | PUBLISHED | ARCHIVED
    publishedAt: timestamp('published_at'),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('curriculum_plans_track_grade_idx').on(t.trackId, t.gradeId),
    index('curriculum_plans_status_idx').on(t.status),
  ],
);

// 40. Curriculum Plan Weeks
export const curriculumWeeks = pgTable(
  'curriculum_weeks',
  {
    id: serial('id').primaryKey(),
    planId: integer('plan_id')
      .references(() => curriculumPlans.id, { onDelete: 'cascade' })
      .notNull(),
    weekNumber: integer('week_number').notNull(),
    titleAr: text('title_ar').notNull(),
    descriptionAr: text('description_ar').default('').notNull(),
    objectivesAr: text('objectives_ar').default('').notNull(),
    teacherNotesAr: text('teacher_notes_ar').default('').notNull(),
    startDate: text('start_date').notNull(), // YYYY-MM-DD
    endDate: text('end_date').notNull(), // YYYY-MM-DD
    status: text('status').notNull().default('PLANNED'), // PLANNED | ACTIVE | COMPLETED | POSTPONED
    displayOrder: integer('display_order').notNull().default(0),
    unitIdsJson: jsonb('unit_ids_json').$type<number[]>().default([]).notNull(),
    lessonIdsJson: jsonb('lesson_ids_json').$type<number[]>().default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('curriculum_weeks_plan_idx').on(t.planId),
    index('curriculum_weeks_order_idx').on(t.planId, t.displayOrder),
  ],
);

// 41. Curriculum Week Tasks (Linked directly to real Videos, Homework, Exams, PDFs, Courses, Live Sessions)
export const curriculumWeekTasks = pgTable(
  'curriculum_week_tasks',
  {
    id: serial('id').primaryKey(),
    weekId: integer('week_id')
      .references(() => curriculumWeeks.id, { onDelete: 'cascade' })
      .notNull(),
    taskType: text('task_type').notNull(), // VIDEO | HOMEWORK | EXAM | PDF | COURSE | LIVE_SESSION | CUSTOM
    entityId: integer('entity_id'), // ID of existing video, homeworkAssignment, exam, lesson (PDF), course, or scheduleEvent
    titleAr: text('title_ar').notNull(),
    instructionsAr: text('instructions_ar').default('').notNull(),
    isRequired: boolean('is_required').notNull().default(true),
    displayOrder: integer('display_order').notNull().default(0),
    availableAt: timestamp('available_at'),
    dueAt: timestamp('due_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('curriculum_tasks_week_idx').on(t.weekId),
    index('curriculum_tasks_order_idx').on(t.weekId, t.displayOrder),
    index('curriculum_tasks_type_entity_idx').on(t.taskType, t.entityId),
  ],
);

// 42. Student Manual Review Progress for Curriculum Tasks (PDFs, Notes, Custom Review Items)
export const studentCurriculumTaskProgress = pgTable(
  'student_curriculum_task_progress',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    taskId: integer('task_id')
      .references(() => curriculumWeekTasks.id, { onDelete: 'cascade' })
      .notNull(),
    isReviewed: boolean('is_reviewed').notNull().default(false),
    reviewedAt: timestamp('reviewed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('student_curr_task_progress_uidx').on(t.studentId, t.taskId),
    index('student_curr_task_progress_student_idx').on(t.studentId),
  ],
);

// 43. Teacher Announcement Media Storage (Isolated binary payload table for fast list queries)
export const announcementStoredFiles = pgTable(
  'announcement_stored_files',
  {
    id: serial('id').primaryKey(),
    storageKey: text('storage_key').notNull().unique(),
    uploadedById: integer('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    dataBase64: text('data_base64').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('announcement_files_uploader_idx').on(t.uploadedById)],
);

// 44. Teacher-Controlled Student Announcements
export const announcements = pgTable(
  'announcements',
  {
    id: serial('id').primaryKey(),
    titleAr: text('title_ar').notNull(),
    bodyAr: text('body_ar').default('').notNull(),
    mediaType: text('media_type').notNull().default('NONE'), // NONE | IMAGE | GIF | VIDEO_UPLOAD | EXTERNAL_VIDEO
    storageKey: text('storage_key'),
    mediaFileName: text('media_file_name'),
    mediaMimeType: text('media_mime_type'),
    externalVideoUrl: text('external_video_url'),
    ctaLabelAr: text('cta_label_ar').default('').notNull(),
    ctaTargetType: text('cta_target_type').notNull().default('NONE'), // NONE | VIDEO | COURSE | HOMEWORK | EXAM | PDF | SCHEDULE | CURRICULUM | BILLING | EXTERNAL_URL
    ctaTargetId: integer('cta_target_id'),
    ctaExternalUrl: text('cta_external_url'),
    targetScope: text('target_scope').notNull().default('ALL'), // ALL | TRACK | GRADE | GROUP
    targetTrackId: integer('target_track_id').references(() => academicTracks.id, { onDelete: 'set null' }),
    targetGradeId: integer('target_grade_id').references(() => grades.id, { onDelete: 'set null' }),
    targetGroupId: integer('target_group_id').references(() => groups.id, { onDelete: 'set null' }),
    priority: integer('priority').notNull().default(0),
    status: text('status').notNull().default('DRAFT'), // DRAFT | PUBLISHED | PAUSED | ARCHIVED
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('announcements_status_idx').on(t.status),
    index('announcements_scope_idx').on(t.targetScope, t.targetTrackId, t.targetGradeId, t.targetGroupId),
    index('announcements_priority_idx').on(t.priority),
  ],
);




