export interface PlatformSettings {
  platformName: string;
  teacherName: string;
  teacherTitle: string;
  teacherBio: string;
  teacherPhotoUrl: string;
  heroBannerUrl: string;
  heroHeadline: string;
  heroSubtitle: string;
  primaryColor: string;
  navyColor: string;
  accentGoldColor: string;
  contactPhone: string;
  whatsappNumber: string;
  contactEmail: string;
  facebookUrl: string;
  youtubeUrl: string;
  telegramUrl: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  sectionsOrder: string[];
  visibleSections: Record<string, boolean>;
  paymentConfig: {
    paymobEnabled: boolean;
    fawryEnabled: boolean;
    walletEnabled: boolean;
    bankTransferEnabled: boolean;
    vodafoneCashNumber: string;
    instaPayHandle: string;
    bankAccountInfo: string;
  };
  notificationConfig: {
    smsOtpEnabled: boolean;
    whatsappApiEnabled: boolean;
    emailEnabled: boolean;
  };
  faq: Array<{ q: string; a: string }>;
  privacyPolicy: string;
  termsOfService: string;
}

export interface GradeItem {
  id: number;
  trackId: number;
  slug: string;
  nameAr: string;
  descriptionAr: string;
  sortOrder: number;
  isVisible: boolean;
}

export interface TrackItem {
  id: number;
  slug: string;
  nameAr: string;
  subtitleAr: string;
  descriptionAr: string;
  accentColor: string;
  sortOrder: number;
  isVisible: boolean;
  grades: GradeItem[];
}

export interface DemoQuickAccount {
  labelAr: string;
  phone: string;
  password: string;
}

export interface BootstrapResponse {
  settings: PlatformSettings;
  tracks: TrackItem[];
  stats: {
    studentsTotal: number;
    videosTotal: number;
    coursesTotal: number;
    examsTotal: number;
  };
  demoAccountsEnabled: boolean;
  demoQuickAccounts?: DemoQuickAccount[];
}

export interface AuthUser {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | string;
  roleSlug: string;
  roleNameAr: string;
  permissions: string[];
}

export interface EnrollmentItem {
  id: number;
  trackId: number;
  gradeId: number;
  status: string;
  gradeNameAr: string;
  gradeSlug: string;
  trackNameAr: string;
}

export interface MeResponse {
  user: AuthUser;
  profile: {
    parentPhone: string;
    governorate: string;
    primaryTrackId: number | null;
    primaryGradeId: number | null;
    parentShareCode: string | null;
  } | null;
  enrollments: EnrollmentItem[];
  unreadNotifications: number;
  activeEntitlementsCount: number;
}

export interface StudentVideoItem {
  id: number;
  trackId: number | null;
  trackNameAr: string;
  lessonId: number;
  lessonTitleAr: string;
  unitId: number | null;
  unitTitleAr: string;
  gradeId: number;
  courseId: number | null;
  courseTitleAr: string | null;
  titleAr: string;
  descriptionAr: string;
  durationSec: number;
  thumbnailUrl: string;
  videoType: 'FREE' | 'PAID' | 'COURSE' | string;
  priceEgp: number;
  sortOrder: number;
  hasYouTubeVideo: boolean;
  hasPdfAttachment?: boolean;
  pdfTitle?: string | null;
  allowSpeedChange: boolean;
  maxPlaybackSpeed: number;
  viewsCount: number;
  hasAccess: boolean;
  accessReason: string;
  lockReasonAr: string | null;
  accessSource: string | null;
  accessExpiresAt: string | null;
  progress: {
    lastPositionSec: number;
    watchedSec: number;
    completionPercent: number;
    isCompleted: boolean;
    updatedAt: string | null;
  };
}

export interface StudentCourseItem {
  id: number;
  gradeId: number;
  titleAr: string;
  descriptionAr: string;
  thumbnailUrl: string;
  originalPriceEgp: number;
  discountPriceEgp: number;
  validityDays: number;
  hasFreePreview: boolean;
  hasCertificate: boolean;
  lessonsCount: number;
  videosCount: number;
  totalHours: number;
  progressPercent: number;
  isUnlocked: boolean;
  lessons: Array<{
    lessonId: number;
    titleAr: string;
    isFreePreview: boolean;
    videos: StudentVideoItem[];
  }>;
}

export interface StudentExamItem {
  id: number;
  gradeId: number;
  titleAr: string;
  descriptionAr: string;
  examType: string;
  durationMin: number;
  maxAttempts: number;
  passScorePercent: number;
  startsAt?: string | null;
  endsAt?: string | null;
  publicationStatus?: string;
  attemptsUsed: number;
  lockedByVideo: boolean;
  latestAttempt: {
    id: number;
    status: string;
    totalScore: number;
    maxScore: number;
    passed: boolean;
    resultPublished?: boolean;
    submittedAt: string | null;
  } | null;
}

export interface StudentDashboardHomeworkItem {
  id: number;
  titleAr: string;
  deadline: string | null;
  maximumGrade: number;
  submissionStatus: string | null;
  awardedGrade: number | null;
  isGradePublished: boolean;
  submittedAt: string | null;
  gradedAt: string | null;
}

export interface StudentDashboardData {
  activeGrade: {
    id: number;
    nameAr: string;
    descriptionAr: string;
    trackId: number;
    trackNameAr: string;
  } | null;
  parentShareCode: string | null;
  overallProgressPercent: number;
  lastWatchedVideo: StudentVideoItem | null;
  units: Array<{ id: number; titleAr: string; descriptionAr: string }>;
  lessons: Array<{
    id: number;
    unitId: number;
    unitTitleAr: string;
    titleAr: string;
    descriptionAr: string;
    pdfTitleAr: string | null;
    pdfContentSummary: string | null;
    pdfUrl: string | null;
    allowPdfDownload: boolean;
    allowComments: boolean;
    comments: Array<{
      id: number;
      authorName: string;
      bodyAr: string;
      replyAr: string | null;
      createdAt: string;
    }>;
  }>;
  videos: StudentVideoItem[];
  courses: StudentCourseItem[];
  plans: Array<{
    id: number;
    nameAr: string;
    descriptionAr: string;
    billingCycle: string;
    priceEgp: number;
    durationDays: number;
  }>;
  exams: StudentExamItem[];
  recentAttempts: Array<{
    id: number;
    examId: number;
    examTitleAr: string;
    status: string;
    totalScore: number;
    maxScore: number;
    passed: boolean;
    resultPublished?: boolean;
    submittedAt: string | null;
  }>;
  homeworkSummary?: {
    totalCount: number;
    completedCount: number;
    items: StudentDashboardHomeworkItem[];
  };
  studyActivityDates?: string[];
  schedules: Array<{
    id: number;
    titleAr: string;
    descriptionAr: string;
    scheduledAt: string;
    durationMin: number;
    sessionType: string;
    liveProvider: string;
    joinUrl: string;
  }>;
  groups: Array<{ id: number; nameAr: string; scheduleTextAr: string; descriptionAr: string }>;
  notifications: Array<{
    id: number;
    titleAr: string;
    bodyAr: string;
    type: string;
    targetType?: string | null;
    targetId?: number | null;
    targetMetaJson?: Record<string, unknown> | null;
    isRead: boolean;
    createdAt: string;
  }>;
  orders: Array<{
    id: number;
    orderNumber: string;
    targetTitleAr: string;
    finalAmountEgp: number;
    paymentMethod: string;
    status: string;
    createdAt: string;
  }>;
  platformSubscription?: {
    id: number;
    startsAt: string;
    expiresAt: string;
    durationDays: number;
    accessScope: string;
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | string;
    isActive: boolean;
    remainingDays: number;
    scopeNoteAr: string;
  } | null;
  curriculumPlan?: import('../lib/academicPlanEngine.ts').CurriculumPlanRecord | null;
  curriculumManualProgress?: Record<number, { isReviewed: boolean; reviewedAt: string | null }>;
  announcements?: StudentAnnouncementItem[];
}

export interface StudentAnnouncementItem {
  id: number;
  titleAr: string;
  bodyAr: string;
  mediaType: 'NONE' | 'IMAGE' | 'GIF' | 'VIDEO_UPLOAD' | 'EXTERNAL_VIDEO';
  mediaUrl: string | null;
  mediaMimeType: string | null;
  externalVideoUrl: string | null;
  ctaLabelAr: string;
  ctaTargetType:
    | 'NONE'
    | 'VIDEO'
    | 'COURSE'
    | 'HOMEWORK'
    | 'EXAM'
    | 'PDF'
    | 'SCHEDULE'
    | 'CURRICULUM'
    | 'BILLING'
    | 'EXTERNAL_URL';
  ctaTargetId: number | null;
  ctaExternalUrl: string | null;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface StudentDeepLinkTarget {
  type:
    | 'VIDEO'
    | 'COURSE'
    | 'HOMEWORK'
    | 'EXAM'
    | 'PDF'
    | 'SCHEDULE'
    | 'CURRICULUM'
    | 'RESULTS'
    | 'BILLING'
    | 'DEVICES'
    | 'NOTIFICATIONS'
    | 'SETTINGS'
    | 'PRACTICE'
    | 'EXTERNAL_URL';
  entityId?: number | null;
  externalUrl?: string | null;
  weekId?: number | null;
  curriculumFilter?: 'ALL' | 'CURRENT' | 'OVERDUE';
}

