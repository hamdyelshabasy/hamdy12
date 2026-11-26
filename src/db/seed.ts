import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  academicTracks,
  accessCodes,
  auditLogs,
  choices,
  coupons,
  courseLessons,
  courses,
  enrollments,
  entitlements,
  examAttempts,
  examQuestions,
  exams,
  grades,
  groupMembers,
  groups,
  lectureSchedules,
  lessonComments,
  lessons,
  notifications,
  orders,
  payments,
  plans,
  progressRecords,
  questions,
  roles,
  settings,
  studentAnswers,
  studentProfiles,
  subscriptions,
  units,
  users,
  videos,
} from './schema.ts';
import { hashPassword } from '../server/domain/security.ts';
import { getSourcePriority } from '../server/domain/entitlements.ts';
import { hashActivationCode, maskActivationCode } from '../server/domain/codes.ts';
import { DEFAULT_ROLE_PERMISSIONS } from '../lib/permissions.ts';
import { isDemoModeEnabled } from '../server/domain/securityHardening.ts';

export const PLATFORM_ASSET_URLS = {
  teacherPortrait: '/assets/aistudio/______________________________df0d6a67.png',
  heroWaves: '/src/assets/images/hero_physics_waves_1795161648069.jpg',
  mechanics: '/src/assets/images/course_mechanics_1795161650057.jpg',
  electricity: '/src/assets/images/course_electricity_1795161648586.jpg',
  modernPhysics: '/src/assets/images/course_modern_physics_1795161647912.jpg',
};

export const DEFAULT_PLATFORM_SETTINGS = {
  platformName: 'منصة الشباسي في الفيزياء',
  teacherName: 'أستاذ / حمدى الشباسي',
  teacherTitle: 'أستاذ الفيزياء للمرحلة الثانوية — البكالوريا والتعليم الأزهري',
  teacherBio:
    'خبرة واسعة في تبسيط مناهج الفيزياء للثانوية العامة (نظام البكالوريا) والثانوية الأزهرية في مصر، بأسلوب يربط القوانين بالتطبيقات العملية وتدريب مستمر على أفكار الامتحانات الحديثة.',
  teacherPhotoUrl: PLATFORM_ASSET_URLS.teacherPortrait,
  heroBannerUrl: PLATFORM_ASSET_URLS.heroWaves,
  heroHeadline: 'افهم الفيزياء بعمق، وتفوّق في امتحانات البكالوريا والأزهر بثقة',
  heroSubtitle:
    'محاضرات مصوّرة بجودة فائقة، بنك أسئلة تفاعلي بمعادلات دقيقة، متابعة أسبوعية لولي الأمر، وحماية كاملة لمحتواك التعليمي من أي مكان في مصر.',
  primaryColor: '#2563EB',
  navyColor: '#0B162C',
  accentGoldColor: '#D97706',
  contactPhone: '01098765432',
  whatsappNumber: '201098765432',
  contactEmail: 'hamdyelshabasy@gmail.com',
  facebookUrl: 'https://facebook.com',
  youtubeUrl: 'https://youtube.com',
  telegramUrl: 'https://t.me',
  maintenanceMode: false,
  maintenanceMessage: 'نجري حاليًا تحديثًا مجدولًا لتحسين سرعة البث والامتحانات. سنعود خلال دقائق.',
  sectionsOrder: ['hero', 'tracks', 'features', 'about', 'faq'],
  visibleSections: {
    hero: true,
    tracks: true,
    features: true,
    about: true,
    faq: true,
  },
  paymentConfig: {
    paymobEnabled: false,
    fawryEnabled: false,
    walletEnabled: true,
    bankTransferEnabled: true,
    vodafoneCashNumber: '01098765432',
    instaPayHandle: 'elshabasy.physics@instapay',
    bankAccountInfo: 'البنك الأهلي المصري — حساب رقم 19403011223344 — باسم أستاذ / حمدى الشباسي',
  },
  notificationConfig: {
    smsOtpEnabled: false,
    whatsappApiEnabled: false,
    emailEnabled: false,
  },
  faq: [
    {
      q: 'كيف يتم تفعيل حسابي بعد التسجيل في المنصة؟',
      a: 'بمجرد إنشاء حسابك واختيار المسار والصف الدراسي، يصل طلبك فورًا إلى لوحة تحكم المدرس وفريق المتابعة، وبعد مراجعة البيانات يتم اعتماد الحساب وإرسال إشعار فوري بالتفعيل.',
    },
    {
      q: 'ما الفرق بين مسار البكالوريا ومسار التعليم الأزهري على المنصة؟',
      a: 'تم فصل محتوى كل مسار بالكامل بما يشمل الدروس والمذكرات وبنك الأسئلة ونماذج الامتحانات، ليحصل كل طالب على المنهج المطابق لمواصفات امتحانه بدقة.',
    },
    {
      q: 'كيف أفتح الفيديوهات والكورسات المدفوعة؟',
      a: 'يمكنك الفتح عبر إدخال كود تفعيل من السنتر أو الموزع المعتمد، أو الشراء المباشر بالتحويل البنكي / المحفظة الإلكترونية ورفع الإيصال للمراجعة، أو عبر منح الصلاحية مباشرة من المدرس.',
    },
    {
      q: 'هل يمكن متابعة مستوى الطالب من قبل ولي الأمر؟',
      a: 'نعم، يوفر النظام رابطًا خاصًا لولي الأمر يعرض نسبة مشاهدة الدروس ونتائج الامتحانات ونقاط القوة والضعف للطالب فقط مع كامل الخصوصية.',
    },
  ],
  privacyPolicy:
    'تلتزم منصة الشباسي في الفيزياء بحماية خصوصية بيانات الطلاب وأولياء الأمور وعدم مشاركتها مع أي طرف ثالث. تُستخدم أرقام الهواتف فقط للتواصل التعليمي وإرسال تقارير المتابعة وحماية حقوق المحتوى عبر العلامة المائية الديناميكية.',
  termsOfService:
    'الحساب شخصي ولا يجوز مشاركته مع آخرين. يُمنع تسجيل أو إعادة نشر المحاضرات بأي وسيلة. يحتفظ المدرس بحق تعليق الحساب أو حظر الأجهزة عند رصد نشاط غير طبيعي أو مشاركة غير مصرح بها.',
};

let seedPromise: Promise<void> | null = null;

export function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeedIfNeeded().catch((err) => {
      seedPromise = null;
      console.error('Database seed failed:', err);
      throw err;
    });
  }
  return seedPromise;
}

async function syncAdditiveQuestionBankRolePermissions() {
  const additiveMap: Array<{ slug: 'TEACHING_ASSISTANT' | 'CONTENT_MANAGER'; perms: string[] }> = [
    { slug: 'TEACHING_ASSISTANT', perms: ['question_bank:view', 'question_bank:contribute'] },
    { slug: 'CONTENT_MANAGER', perms: ['question_bank:view', 'question_bank:contribute'] },
  ];

  for (const item of additiveMap) {
    const [row] = await db.select().from(roles).where(eq(roles.slug, item.slug)).limit(1);
    if (!row) continue;
    const current = Array.isArray(row.permissionsJson) ? row.permissionsJson : [];
    const missing = item.perms.filter((p) => !current.includes(p));
    if (missing.length > 0) {
      await db
        .update(roles)
        .set({ permissionsJson: [...current, ...missing] })
        .where(eq(roles.id, row.id));
    }
  }
}

async function runSeedIfNeeded() {
  const [{ value: roleCount }] = await db.select({ value: count() }).from(roles);
  if (roleCount > 0) {
    await syncAdditiveQuestionBankRolePermissions();
    return;
  }

  // 1. Roles
  const insertedRoles = await db
    .insert(roles)
    .values([
      {
        slug: 'SUPER_ADMIN',
        nameAr: 'المدير العام (المدرس)',
        descriptionAr: 'تحكم كامل في جميع أجزاء المنصة والإعدادات والطلاب والماليات.',
        permissionsJson: DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN,
      },
      {
        slug: 'CONTENT_MANAGER',
        nameAr: 'مدير المحتوى',
        descriptionAr: 'إدارة الصفوف والوحدات والفيديوهات والكورسات والامتحانات والواجبات والمواعيد.',
        permissionsJson: DEFAULT_ROLE_PERMISSIONS.CONTENT_MANAGER,
      },
      {
        slug: 'TEACHING_ASSISTANT',
        nameAr: 'مساعد المدرس',
        descriptionAr: 'عرض الطلاب وقبول طلبات التسجيل وتصحيح الامتحانات والواجبات والرد على الأسئلة وإدارة المجموعات.',
        permissionsJson: DEFAULT_ROLE_PERMISSIONS.TEACHING_ASSISTANT,
      },
      {
        slug: 'SUPPORT',
        nameAr: 'الدعم الفني والاشتراكات',
        descriptionAr: 'عرض بيانات الطلاب والطلبات والأكواد المقنّعة ومساعدة الطلاب في مشكلات الجلسات والأجهزة.',
        permissionsJson: DEFAULT_ROLE_PERMISSIONS.SUPPORT,
      },
      {
        slug: 'STUDENT',
        nameAr: 'طالب',
        descriptionAr: 'الوصول للوحة الطالب والدروس والامتحانات وفق الصلاحيات المعتمدة.',
        permissionsJson: DEFAULT_ROLE_PERMISSIONS.STUDENT,
      },
    ])
    .returning();

  const roleMap = new Map(insertedRoles.map((r) => [r.slug, r.id]));

  // 2. Settings
  await db
    .insert(settings)
    .values({
      key: 'platform_config',
      valueJson: DEFAULT_PLATFORM_SETTINGS,
    })
    .onConflictDoNothing();

  // 3. Academic Tracks (البكالوريا & التعليم الأزهري)
  const [bacTrack, azharTrack] = await db
    .insert(academicTracks)
    .values([
      {
        slug: 'baccalaureate',
        nameAr: 'البكالوريا',
        subtitleAr: 'النظام الحديث للثانوية العامة المصرية',
        descriptionAr:
          'منهج متكامل يركّز على الفهم العميق، مسائل المستويات العليا، والمحاكاة الكاملة لامتحانات البكالوريا المصرية.',
        accentColor: '#2563EB',
        sortOrder: 1,
        isVisible: true,
      },
      {
        slug: 'azhar',
        nameAr: 'التعليم الأزهري',
        subtitleAr: 'منهج الثانوية الأزهرية المعتمد',
        descriptionAr:
          'شرح وافٍ ومخصص لمقررات الفيزياء الأزهرية مع تدريبات دقيقة على الأسئلة المقالية والمسائل ونماذج البوكليت الأزهري.',
        accentColor: '#0F766E',
        sortOrder: 2,
        isVisible: true,
      },
    ])
    .returning();

  // 4. Grades (3 per track = 6 grades)
  const insertedGrades = await db
    .insert(grades)
    .values([
      {
        trackId: bacTrack.id,
        slug: 'bac-1',
        nameAr: 'الصف الأول بكالوريا',
        descriptionAr: 'القياس الفيزيائي، الحركة الخطية، قوانين نيوتن، والشغل والطاقة.',
        sortOrder: 1,
        isVisible: true,
      },
      {
        trackId: bacTrack.id,
        slug: 'bac-2',
        nameAr: 'الصف الثاني بكالوريا',
        descriptionAr: 'الموجات والضوء، الانعكاس والانكسار، والموائع الساكنة والمتحركة.',
        sortOrder: 2,
        isVisible: true,
      },
      {
        trackId: bacTrack.id,
        slug: 'bac-3',
        nameAr: 'الصف الثالث بكالوريا',
        descriptionAr: 'الكهربية التيارية، الحث الكهرومغناطيسي، والتيار المتردد والفيزياء الحديثة.',
        sortOrder: 3,
        isVisible: true,
      },
      {
        trackId: azharTrack.id,
        slug: 'azhar-1',
        nameAr: 'الصف الأول الثانوي الأزهري',
        descriptionAr: 'أساسيات القياس الفيزيائي، الكميات المتجهة، وقوانين الحركة لطلاب الأزهر.',
        sortOrder: 1,
        isVisible: true,
      },
      {
        trackId: azharTrack.id,
        slug: 'azhar-2',
        nameAr: 'الصف الثاني الثانوي الأزهري',
        descriptionAr: 'الحركة الموجية، الصوت والضوء، وخواص الموائع المقررة بالثانوية الأزهرية.',
        sortOrder: 2,
        isVisible: true,
      },
      {
        trackId: azharTrack.id,
        slug: 'azhar-3',
        nameAr: 'الصف الثالث الثانوي الأزهري',
        descriptionAr: 'الكهربية والمغناطيسية والفيزياء الحديثة وفق مواصفات بوكليت الثانوية الأزهرية.',
        sortOrder: 3,
        isVisible: true,
      },
    ])
    .returning();

  const gradeBySlug = new Map(insertedGrades.map((g) => [g.slug, g]));
  const bac3 = gradeBySlug.get('bac-3')!;
  const bac2 = gradeBySlug.get('bac-2')!;
  const bac1 = gradeBySlug.get('bac-1')!;
  const azhar3 = gradeBySlug.get('azhar-3')!;
  const azhar2 = gradeBySlug.get('azhar-2')!;
  const azhar1 = gradeBySlug.get('azhar-1')!;

  // 5. Primary Admin + Demo Staff + Demo Students (Env-driven admin credentials when provided)
  const adminPhone = process.env.INITIAL_ADMIN_PHONE || '01000000001';
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'hamdyelshabasy@gmail.com';
  const adminName = process.env.INITIAL_ADMIN_NAME || 'أستاذ / حمدى الشباسي';
  const adminInitialPass = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@2026';
  const enableDemo = isDemoModeEnabled();

  const [adminUser] = await db
    .insert(users)
    .values({
      fullName: adminName,
      phone: adminPhone,
      email: adminEmail,
      passwordHash: hashPassword(adminInitialPass),
      roleId: roleMap.get('SUPER_ADMIN')!,
      status: 'ACTIVE',
      maxDevices: 5,
      allowConcurrent: true,
      isDemoAccount: !process.env.INITIAL_ADMIN_PASSWORD,
    })
    .returning();

  let studentActiveId: number | null = null;
  let studentPendingId: number | null = null;
  let studentBac2Id: number | null = null;

  if (enableDemo) {
    const [taUser, student1, student2, student3] = await db
      .insert(users)
      .values([
        {
          fullName: 'م. عمر الشافعي (مساعد المدرس)',
          phone: '01000000002',
          email: 'ta@elminshawy-physics.eg',
          passwordHash: hashPassword('Staff@2026'),
          roleId: roleMap.get('TEACHING_ASSISTANT')!,
          status: 'ACTIVE',
          maxDevices: 3,
          allowConcurrent: true,
          isDemoAccount: true,
        },
        {
          fullName: 'يوسف محمد عبد الرحمن',
          phone: '01012345678',
          email: 'youssef.student@example.eg',
          passwordHash: hashPassword('Student@123'),
          roleId: roleMap.get('STUDENT')!,
          status: 'ACTIVE',
          maxDevices: 2,
          allowConcurrent: false,
          isDemoAccount: true,
          lastLoginAt: new Date(),
        },
        {
          fullName: 'مريم طارق حسن',
          phone: '01122334455',
          email: 'mariam.azhar@example.eg',
          passwordHash: hashPassword('Student@123'),
          roleId: roleMap.get('STUDENT')!,
          status: 'PENDING_APPROVAL',
          maxDevices: 2,
          allowConcurrent: false,
          isDemoAccount: true,
        },
        {
          fullName: 'كريم خالد محمود',
          phone: '01233445566',
          email: 'karim.bac2@example.eg',
          passwordHash: hashPassword('Student@123'),
          roleId: roleMap.get('STUDENT')!,
          status: 'ACTIVE',
          maxDevices: 2,
          allowConcurrent: false,
          isDemoAccount: true,
          lastLoginAt: new Date(Date.now() - 86400_000),
        },
      ])
      .returning();

    void taUser;
    studentActiveId = student1.id;
    studentPendingId = student2.id;
    studentBac2Id = student3.id;

    await db.insert(studentProfiles).values([
      {
        userId: student1.id,
        parentPhone: '01099887766',
        governorate: 'القاهرة',
        primaryTrackId: bacTrack.id,
        primaryGradeId: bac3.id,
        approvedById: adminUser.id,
        approvedAt: new Date(Date.now() - 10 * 86400_000),
        parentShareCode: 'PAR-YOUSSEF-2026',
        parentAccessEnabled: true,
      },
      {
        userId: student2.id,
        parentPhone: '01188776655',
        governorate: 'الجيزة',
        primaryTrackId: azharTrack.id,
        primaryGradeId: azhar3.id,
        parentShareCode: 'PAR-MARIAM-2026',
        parentAccessEnabled: true,
      },
      {
        userId: student3.id,
        parentPhone: '01277665544',
        governorate: 'الإسكندرية',
        primaryTrackId: bacTrack.id,
        primaryGradeId: bac2.id,
        approvedById: adminUser.id,
        approvedAt: new Date(Date.now() - 14 * 86400_000),
        parentShareCode: 'PAR-KARIM-2026',
        parentAccessEnabled: true,
      },
    ]);

    await db.insert(enrollments).values([
      {
        userId: student1.id,
        trackId: bacTrack.id,
        gradeId: bac3.id,
        status: 'ACTIVE',
        decidedById: adminUser.id,
        decidedAt: new Date(Date.now() - 10 * 86400_000),
        decisionNote: 'تم القبول في دفعة البكالوريا 2026',
      },
      {
        userId: student2.id,
        trackId: azharTrack.id,
        gradeId: azhar3.id,
        status: 'PENDING_APPROVAL',
      },
      {
        userId: student3.id,
        trackId: bacTrack.id,
        gradeId: bac2.id,
        status: 'ACTIVE',
        decidedById: adminUser.id,
        decidedAt: new Date(Date.now() - 14 * 86400_000),
      },
    ]);
  }

  // 6. Units, Lessons & Videos across all 6 grades (richest in bac-3 and azhar-3)
  const [uBac3Ch1, uBac3Ch2, uBac3Ch3, uAzhar3Ch1, uBac2Ch1, uBac1Ch1, uAzhar1Ch1, uAzhar2Ch1] =
    await db
      .insert(units)
      .values([
        {
          gradeId: bac3.id,
          titleAr: 'الوحدة الأولى: التيار الكهربي وقانون أوم وقانونا كيرشوف',
          descriptionAr: 'تأسيس كامل للكهربية التيارية وتحليل الدوائر المعقدة.',
          sortOrder: 1,
        },
        {
          gradeId: bac3.id,
          titleAr: 'الوحدة الثانية: التأثير المغناطيسي للتيار والحث الكهرومغناطيسي',
          descriptionAr: 'قانون فاراداي، قاعدة لينز، الدينامو والمحول الكهربي.',
          sortOrder: 2,
        },
        {
          gradeId: bac3.id,
          titleAr: 'الوحدة الثالثة: الفيزياء الحديثة والأطياف الذرية',
          descriptionAr: 'إشعاع الجسم الأسود، التأثير الكهروضوئي، نموذج بور والليزر.',
          sortOrder: 3,
        },
        {
          gradeId: azhar3.id,
          titleAr: 'الفصل الأول (أزهر): التيار الكهربي وقانونا كيرشوف',
          descriptionAr: 'شرح مطابق لكتاب المعهد الأزهري مع مسائل البوكليت.',
          sortOrder: 1,
        },
        {
          gradeId: bac2.id,
          titleAr: 'الوحدة الأولى: الحركة الموجية وخواص الضوء',
          descriptionAr: 'الانعكاس والانكسار والتداخل والحيود في الضوء.',
          sortOrder: 1,
        },
        {
          gradeId: bac1.id,
          titleAr: 'الوحدة الأولى: القياس الفيزيائي والكميات المتجهة',
          descriptionAr: 'أبعاد الكميات الفيزيائية وخطأ القياس وحساب المحصلة.',
          sortOrder: 1,
        },
        {
          gradeId: azhar1.id,
          titleAr: 'الباب الأول (أزهر): القياس الفيزيائي والحركة',
          descriptionAr: 'أساسيات القياس الفيزيائي وقوانين الحركة الخطية لطلاب الأزهر.',
          sortOrder: 1,
        },
        {
          gradeId: azhar2.id,
          titleAr: 'الباب الأول (أزهر): الموجات والضوء الهندسي',
          descriptionAr: 'خواص الموجات والانكسار في المنشور الثلاثي.',
          sortOrder: 1,
        },
      ])
      .returning();

  const [
    lBac3Ohm,
    lBac3Kirchhoff,
    lBac3Faraday,
    lBac3Quantum,
    lAzhar3Ohm,
    lAzhar3Kirchhoff,
    lBac2Waves,
    lBac1Measure,
    lAzhar1Measure,
    lAzhar2Waves,
  ] = await db
    .insert(lessons)
    .values([
      {
        unitId: uBac3Ch1.id,
        titleAr: 'الدرس الأول: شدة التيار وفرق الجهد وقانون أوم للدائرة المغلقة',
        descriptionAr: 'شرح مفصل للعلاقة بين القوة الدافعة الكهربية والمقاومة الداخلية وقراءة الفولتميتر.',
        sortOrder: 1,
        pdfTitleAr: 'ملخص قوانين التيار الكهربي وقانون أوم (PDF)',
        pdfContentSummary:
          'يتضمن جميع قوانين شدة التيار I = Q/t، المقاومة النوعية، توصيل المقاومات على التوالي والتوازي، وقانون أوم للدائرة المغلقة V_B = I(R + r) مع 15 مسألة محلولة.',
        pdfUrl: '/api/public/pdf-note/ohm-law',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uBac3Ch1.id,
        titleAr: 'الدرس الثاني: قانونا كيرشوف وتحليل الدوائر الكهربية المعقدة',
        descriptionAr: 'طريقة منظمة لتكوين المعادلات وحل مسائل كيرشوف بسرعة ودقة في الامتحان.',
        sortOrder: 2,
        pdfTitleAr: 'مذكرة أفكار ومسائل كيرشوف العليا (PDF)',
        pdfContentSummary:
          'خطوات تطبيق قانون كيرشوف الأول (حفظ الشحنة) والثاني (حفظ الطاقة) مع 20 دائرة متدرجة الصعوبة.',
        pdfUrl: '/api/public/pdf-note/kirchhoff',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uBac3Ch2.id,
        titleAr: 'الدرس الأول: قانون فاراداي للحث الكهرومغناطيسي وقاعدة لينز',
        descriptionAr: 'فهم القوة الدافعة المستحثة وتحديد اتجاه التيار المستحث في كل الحالات.',
        sortOrder: 1,
        pdfTitleAr: 'خريطة ذهنية لقانون فاراداي وقاعدة لينز (PDF)',
        pdfContentSummary:
          'تجميع كامل لتطبيقات الحث الذاتي والمتبادل والدينامو والمحول الكهربي مع مقارنات شاملة.',
        pdfUrl: '/api/public/pdf-note/faraday',
        allowPdfDownload: false,
        allowComments: true,
      },
      {
        unitId: uBac3Ch3.id,
        titleAr: 'الدرس الأول: التأثير الكهروضوئي ومعادلة أينشتاين',
        descriptionAr: 'تفسير أينشتاين للفوتونات ودالة الشغل وتردد العتبة والرسوم البيانية.',
        sortOrder: 1,
        pdfTitleAr: 'مذكرة الفيزياء الحديثة والأطياف (PDF)',
        pdfContentSummary:
          'ملخص شامل لمعادلة بلانك E = hν وتأثير كومتون وعلاقة دي برولي مع أسئلة مستويات عليا.',
        pdfUrl: '/api/public/pdf-note/modern',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uAzhar3Ch1.id,
        titleAr: 'الدرس الأول (أزهر): التيار الكهربي والمقاومة وتوصيل المقاومات',
        descriptionAr: 'شرح تفصيلي يغطي التعليلات المقالية ومسائل امتحانات الأزهر السابقة.',
        sortOrder: 1,
        pdfTitleAr: 'مذكرة الفيزياء الأزهرية — الفصل الأول (PDF)',
        pdfContentSummary: 'أهم التعليلات والمقارنات ومسائل البوكليت الأزهري للأعوام 2019–2025.',
        pdfUrl: '/api/public/pdf-note/azhar-ch1',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uAzhar3Ch1.id,
        titleAr: 'الدرس الثاني (أزهر): قانون أوم للدائرة المغلقة وكيرشوف',
        descriptionAr: 'حل نماذج بوكليت الأزهر على كيرشوف وقراءة الأجهزة.',
        sortOrder: 2,
        pdfTitleAr: 'مراجعة مسائل كيرشوف — أزهر (PDF)',
        pdfContentSummary: 'خطوات الحل النموذجي المعتمدة في تصحيح الثانوية الأزهرية.',
        pdfUrl: '/api/public/pdf-note/azhar-kirchhoff',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uBac2Ch1.id,
        titleAr: 'الدرس الأول: الحركة الموجية وسرعة انتشار الموجات',
        descriptionAr: 'العلاقة بين التردد والطول الموجي وحل مسائل التمثيل البياني للموجات.',
        sortOrder: 1,
        pdfTitleAr: 'ملخص الموجات والضوء — ثانية بكالوريا (PDF)',
        pdfContentSummary: 'قوانين الحركة الاهتزازية والموجية والانكسار وقانون سنل.',
        pdfUrl: '/api/public/pdf-note/bac2-waves',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uBac1Ch1.id,
        titleAr: 'الدرس الأول: القياس الفيزيائي وصيغة الأبعاد',
        descriptionAr: 'النظام الدولي للوحدات والتحويلات وصيغ الأبعاد واختبار صحة القوانين.',
        sortOrder: 1,
        pdfTitleAr: 'دليل القياس الفيزيائي — أولى بكالوريا (PDF)',
        pdfContentSummary: 'جدول صيغ الأبعاد الشامل وقواعد حساب الخطأ المطلق والنسبي.',
        pdfUrl: '/api/public/pdf-note/bac1-measure',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uAzhar1Ch1.id,
        titleAr: 'الدرس الأول (أزهر): عناصر القياس الفيزيائي والوحدات',
        descriptionAr: 'شرح ميسر لطلاب الصف الأول الثانوي الأزهري مع تدريبات الكتاب.',
        sortOrder: 1,
        pdfTitleAr: 'ملخص القياس — أولى أزهر (PDF)',
        pdfContentSummary: 'التعريفات الأساسية ومسائل التحويلات والكميات القياسية والمتجهة.',
        pdfUrl: '/api/public/pdf-note/azhar1-measure',
        allowPdfDownload: true,
        allowComments: true,
      },
      {
        unitId: uAzhar2Ch1.id,
        titleAr: 'الدرس الأول (أزهر): الموجات الطولية والمستعرضة',
        descriptionAr: 'شرح مفصل لأنواع الموجات وتطبيقاتها في الصوت والضوء.',
        sortOrder: 1,
        pdfTitleAr: 'مذكرة الموجات — ثانية أزهر (PDF)',
        pdfContentSummary: 'المقارنات الهامة والمسائل المتوقعة في امتحان الأزهر.',
        pdfUrl: '/api/public/pdf-note/azhar2-waves',
        allowPdfDownload: true,
        allowComments: true,
      },
    ])
    .returning();

  const [vBac3Free1, vBac3Paid1, vBac3Course1, vBac3Paid2, vAzharFree1, vAzharPaid1, vBac2Free1, vBac1Free1] =
    await db
      .insert(videos)
      .values([
        {
          trackId: bacTrack.id,
          unitId: uBac3Ch1.id,
          lessonId: lBac3Ohm.id,
          gradeId: bac3.id,
          titleAr: 'محاضرة مجانية: تأسيس الكهربية وقانون أوم للدائرة المغلقة',
          descriptionAr: 'شرح تأسيسي شامل لكيفية حساب المقاومة المكافئة وقراءة الأميتر والفولتميتر.',
          youtubeUrl: 'https://www.youtube.com/watch?v=mc979OhitAg',
          youtubeVideoId: 'mc979OhitAg',
          durationSec: 2640,
          thumbnailUrl: PLATFORM_ASSET_URLS.electricity,
          videoType: 'FREE',
          priceEgp: 0,
          streamAssetKey: 'protected/bac3/ohm-law-master-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '2.00',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 1,
          viewsCount: 418,
        },
        {
          trackId: bacTrack.id,
          unitId: uBac3Ch1.id,
          lessonId: lBac3Kirchhoff.id,
          gradeId: bac3.id,
          titleAr: 'المحاضرة المتقدمة: إتقان قانوني كيرشوف وحل 25 فكرة امتحانية',
          descriptionAr: 'تطبيق عملي مباشر على أصعب دوائر كيرشوف واستخدام الآلة الحاسبة للتحقق.',
          youtubeUrl: 'https://www.youtube.com/watch?v=bHIhgxav9LY',
          youtubeVideoId: 'bHIhgxav9LY',
          durationSec: 3420,
          thumbnailUrl: PLATFORM_ASSET_URLS.electricity,
          videoType: 'PAID',
          priceEgp: 95,
          streamAssetKey: 'protected/bac3/kirchhoff-advanced-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '1.75',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 2,
          viewsCount: 289,
        },
        {
          trackId: bacTrack.id,
          unitId: uBac3Ch2.id,
          lessonId: lBac3Faraday.id,
          gradeId: bac3.id,
          titleAr: 'الحث الكهرومغناطيسي: قانون فاراداي وقاعدة لينز بالتجارب',
          descriptionAr: 'شرح تفصيلي لملفات الحث والفيض المغناطيسي واتجاه التيار المستحث.',
          youtubeUrl: 'https://www.youtube.com/watch?v=hFAOXdXZ5TM',
          youtubeVideoId: 'hFAOXdXZ5TM',
          durationSec: 3900,
          thumbnailUrl: PLATFORM_ASSET_URLS.heroWaves,
          videoType: 'COURSE',
          priceEgp: 120,
          streamAssetKey: 'protected/bac3/faraday-lenz-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '2.00',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 3,
          viewsCount: 312,
        },
        {
          trackId: bacTrack.id,
          unitId: uBac3Ch3.id,
          lessonId: lBac3Quantum.id,
          gradeId: bac3.id,
          titleAr: 'الفيزياء الحديثة: التأثير الكهروضوئي ومعادلة أينشتاين',
          descriptionAr: 'تحليل كامل للمنحنيات البيانية للخلية الكهروضوئية وأسئلة الوزارة.',
          youtubeUrl: 'https://www.youtube.com/watch?v=J4Vq-xHqUo8',
          youtubeVideoId: 'J4Vq-xHqUo8',
          durationSec: 3180,
          thumbnailUrl: PLATFORM_ASSET_URLS.modernPhysics,
          videoType: 'PAID',
          priceEgp: 110,
          streamAssetKey: 'protected/bac3/photoelectric-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '2.00',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 4,
          viewsCount: 194,
        },
        {
          trackId: azharTrack.id,
          unitId: uAzhar3Ch1.id,
          lessonId: lAzhar3Ohm.id,
          gradeId: azhar3.id,
          titleAr: 'محاضرة مجانية (أزهر): مدخل الكهربية وتوصيل المقاومات',
          descriptionAr: 'شرح مطابق لمنهج الثانوية الأزهرية مع حل أسئلة الكتاب المدرسي.',
          youtubeUrl: 'https://www.youtube.com/watch?v=mc979OhitAg',
          youtubeVideoId: 'mc979OhitAg',
          durationSec: 2520,
          thumbnailUrl: PLATFORM_ASSET_URLS.electricity,
          videoType: 'FREE',
          priceEgp: 0,
          streamAssetKey: 'protected/azhar3/ohm-intro-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '2.00',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 1,
          viewsCount: 245,
        },
        {
          trackId: azharTrack.id,
          unitId: uAzhar3Ch1.id,
          lessonId: lAzhar3Kirchhoff.id,
          gradeId: azhar3.id,
          titleAr: 'مراجعة بوكليت الأزهر: مسائل كيرشوف والدائرة المغلقة',
          descriptionAr: 'حل تفصيلي لجميع مسائل امتحانات الثانوية الأزهرية من 2019 حتى 2025.',
          youtubeUrl: 'https://www.youtube.com/watch?v=bHIhgxav9LY',
          youtubeVideoId: 'bHIhgxav9LY',
          durationSec: 3300,
          thumbnailUrl: PLATFORM_ASSET_URLS.modernPhysics,
          videoType: 'PAID',
          priceEgp: 90,
          streamAssetKey: 'protected/azhar3/kirchhoff-booklet-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '2.00',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 2,
          viewsCount: 162,
        },
        {
          trackId: bacTrack.id,
          unitId: uBac2Ch1.id,
          lessonId: lBac2Waves.id,
          gradeId: bac2.id,
          titleAr: 'أساسيات الحركة الموجية وحساب الطول الموجي والتردد',
          descriptionAr: 'تأسيس ممتاز للوحدة الأولى للصف الثاني بكالوريا مع رسوم متحركة.',
          youtubeUrl: 'https://www.youtube.com/watch?v=ZM8ECpBuQYE',
          youtubeVideoId: 'ZM8ECpBuQYE',
          durationSec: 2280,
          thumbnailUrl: PLATFORM_ASSET_URLS.mechanics,
          videoType: 'FREE',
          priceEgp: 0,
          streamAssetKey: 'protected/bac2/waves-intro-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '2.00',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 1,
          viewsCount: 184,
        },
        {
          trackId: bacTrack.id,
          unitId: uBac1Ch1.id,
          lessonId: lBac1Measure.id,
          gradeId: bac1.id,
          titleAr: 'القياس الفيزيائي وصيغ الأبعاد من الصفر للاحتراف',
          descriptionAr: 'شرح تفاعلي للوحدة الأولى للصف الأول بكالوريا.',
          youtubeUrl: 'https://www.youtube.com/watch?v=ZM8ECpBuQYE',
          youtubeVideoId: 'ZM8ECpBuQYE',
          durationSec: 2100,
          thumbnailUrl: PLATFORM_ASSET_URLS.mechanics,
          videoType: 'FREE',
          priceEgp: 0,
          streamAssetKey: 'protected/bac1/measurement-hls',
          allowSpeedChange: true,
          maxPlaybackSpeed: '2.00',
          publicationStatus: 'PUBLISHED',
          isPublished: true,
          sortOrder: 1,
          viewsCount: 210,
        },
      ])
      .returning();

  // Add videos for Azhar 1 and Azhar 2
  await db.insert(videos).values([
    {
      trackId: azharTrack.id,
      unitId: uAzhar1Ch1.id,
      lessonId: lAzhar1Measure.id,
      gradeId: azhar1.id,
      titleAr: 'القياس الفيزيائي — الصف الأول الثانوي الأزهري',
      descriptionAr: 'شرح الدرس الأول كاملًا مع تدريبات المعهد الأزهري.',
      youtubeUrl: 'https://www.youtube.com/watch?v=ZM8ECpBuQYE',
      youtubeVideoId: 'ZM8ECpBuQYE',
      durationSec: 1980,
      thumbnailUrl: PLATFORM_ASSET_URLS.mechanics,
      videoType: 'FREE',
      priceEgp: 0,
      streamAssetKey: 'protected/azhar1/measure-hls',
      publicationStatus: 'PUBLISHED',
      isPublished: true,
      sortOrder: 1,
      viewsCount: 95,
    },
    {
      trackId: azharTrack.id,
      unitId: uAzhar2Ch1.id,
      lessonId: lAzhar2Waves.id,
      gradeId: azhar2.id,
      titleAr: 'الحركة الموجية — الصف الثاني الثانوي الأزهري',
      descriptionAr: 'شرح شامل لأنواع الموجات ومسائلها.',
      youtubeUrl: 'https://www.youtube.com/watch?v=ZM8ECpBuQYE',
      youtubeVideoId: 'ZM8ECpBuQYE',
      durationSec: 2340,
      thumbnailUrl: PLATFORM_ASSET_URLS.heroWaves,
      videoType: 'FREE',
      priceEgp: 0,
      streamAssetKey: 'protected/azhar2/waves-hls',
      publicationStatus: 'PUBLISHED',
      isPublished: true,
      sortOrder: 1,
      viewsCount: 112,
    },
  ]);

  // 7. Full Courses & Plans
  const [cBac3Electromag, cBac3Modern, cAzhar3Full] = await db
    .insert(courses)
    .values([
      {
        gradeId: bac3.id,
        titleAr: 'الكورس الشامل: الكهربية والمغناطيسية (الوحدة 1 و 2)',
        descriptionAr:
          'تغطية كاملة للكهربية التيارية وقانونا كيرشوف والحث الكهرومغناطيسي مع 40 ساعة شرح، مذكرات PDF، و6 امتحانات شاملة.',
        thumbnailUrl: PLATFORM_ASSET_URLS.electricity,
        originalPriceEgp: 650,
        discountPriceEgp: 450,
        validityDays: 120,
        hasFreePreview: true,
        hasCertificate: true,
        isPublished: true,
        sortOrder: 1,
      },
      {
        gradeId: bac3.id,
        titleAr: 'كورس الفيزياء الحديثة والمراجعة النهائية 2026',
        descriptionAr:
          'إتقان الفيزياء الحديثة والأطياف والليزر والإلكترونيات مع 10 نماذج محاكاة للامتحان النهائي.',
        thumbnailUrl: PLATFORM_ASSET_URLS.modernPhysics,
        originalPriceEgp: 500,
        discountPriceEgp: 360,
        validityDays: 90,
        hasFreePreview: true,
        hasCertificate: true,
        isPublished: true,
        sortOrder: 2,
      },
      {
        gradeId: azhar3.id,
        titleAr: 'الكورس الأزهري الشامل: الكهربية وبوكليت الامتحانات',
        descriptionAr:
          'منهج الثانوية الأزهرية كاملًا مع تدريب عملي على الأسئلة المقالية والتعليلات ومسائل البوكليت.',
        thumbnailUrl: PLATFORM_ASSET_URLS.heroWaves,
        originalPriceEgp: 550,
        discountPriceEgp: 390,
        validityDays: 120,
        hasFreePreview: true,
        hasCertificate: true,
        isPublished: true,
        sortOrder: 1,
      },
    ])
    .returning();

  await db.insert(courseLessons).values([
    { courseId: cBac3Electromag.id, lessonId: lBac3Ohm.id, isFreePreview: true, sortOrder: 1 },
    { courseId: cBac3Electromag.id, lessonId: lBac3Kirchhoff.id, isFreePreview: false, sortOrder: 2 },
    { courseId: cBac3Electromag.id, lessonId: lBac3Faraday.id, isFreePreview: false, sortOrder: 3 },
    { courseId: cBac3Modern.id, lessonId: lBac3Quantum.id, isFreePreview: false, sortOrder: 1 },
    { courseId: cAzhar3Full.id, lessonId: lAzhar3Ohm.id, isFreePreview: true, sortOrder: 1 },
    { courseId: cAzhar3Full.id, lessonId: lAzhar3Kirchhoff.id, isFreePreview: false, sortOrder: 2 },
  ]);

  const [planMonthlyBac3, planTermBac3] = await db
    .insert(plans)
    .values([
      {
        gradeId: bac3.id,
        nameAr: 'الباقة الشهرية — الصف الثالث بكالوريا',
        descriptionAr: 'وصول كامل لجميع محاضرات وامتحانات ومذكرات الصف لمدة 30 يومًا.',
        billingCycle: 'MONTHLY',
        priceEgp: 220,
        durationDays: 30,
        isActive: true,
      },
      {
        gradeId: bac3.id,
        nameAr: 'الباقة الفصلية — الصف الثالث بكالوريا',
        descriptionAr: 'اشتراك فصل دراسي كامل لمدة 120 يومًا مع توفير 25%.',
        billingCycle: 'TERM',
        priceEgp: 660,
        durationDays: 120,
        isActive: true,
      },
      {
        gradeId: azhar3.id,
        nameAr: 'الباقة الشهرية — الثالث الثانوي الأزهري',
        descriptionAr: 'وصول شامل لمحتوى الأزهر وبنك أسئلة البوكليت لمدة 30 يومًا.',
        billingCycle: 'MONTHLY',
        priceEgp: 200,
        durationDays: 30,
        isActive: true,
      },
    ])
    .returning();

  // 8. Coupons
  await db.insert(coupons).values([
    { code: 'PHYS20', discountPercent: 20, maxUses: 200, usedCount: 14, isActive: true },
    { code: 'AZHAR15', discountPercent: 15, maxUses: 150, usedCount: 9, isActive: true },
  ]);

  // 9. Groups & Live Schedules
  const [grpSat, grpFinal] = await db
    .insert(groups)
    .values([
      {
        gradeId: bac3.id,
        nameAr: 'مجموعة السبت والثلاثاء (أونلاين)',
        scheduleTextAr: 'السبت والثلاثاء الساعة 7:00 مساءً بتوقيت القاهرة',
        descriptionAr: 'متابعة أسبوعية مباشرة وحل واجبات منتظم لطلاب الصف الثالث بكالوريا.',
      },
      {
        gradeId: bac3.id,
        nameAr: 'مجموعة المراجعة النهائية — بكالوريا',
        scheduleTextAr: 'الخميس الساعة 8:00 مساءً',
        descriptionAr: 'حل امتحانات شاملة ومراجعات مكثفة على أفكار الوزارة.',
      },
      {
        gradeId: azhar3.id,
        nameAr: 'مجموعة الثانوية الأزهرية — الأحد والأربعاء',
        scheduleTextAr: 'الأحد والأربعاء الساعة 6:30 مساءً',
        descriptionAr: 'مجموعة متخصصة في مسائل وتعليلات البوكليت الأزهري.',
      },
    ])
    .returning();

  await db.insert(lectureSchedules).values([
    {
      gradeId: bac3.id,
      groupId: grpSat.id,
      titleAr: 'حصة مباشرة: تطبيقات وحل مسائل متقدمة على قانونا كيرشوف',
      descriptionAr: 'مناقشة تفاعلية لأصعب مسائل الامتحانات السابقة والإجابة على استفسارات الطلاب.',
      scheduledAt: new Date(Date.now() + 2 * 86400_000),
      durationMin: 90,
      sessionType: 'LIVE',
      liveProvider: 'ZOOM',
      joinUrl: 'https://zoom.us/j/physics-bac3-live',
      isPublished: true,
    },
    {
      gradeId: bac3.id,
      groupId: grpFinal.id,
      titleAr: 'ورشة مراجعة شاملة: الحث الكهرومغناطيسي وقاعدة لينز',
      descriptionAr: 'مراجعة مكثفة قبل الامتحان الشهري مع ملزمة مسائل مختارة.',
      scheduledAt: new Date(Date.now() + 5 * 86400_000),
      durationMin: 120,
      sessionType: 'REVISION',
      liveProvider: 'MEET',
      joinUrl: 'https://meet.google.com/physics-revision',
      isPublished: true,
    },
    {
      gradeId: azhar3.id,
      titleAr: 'بث مباشر (أزهر): حل نموذج بوكليت شامل على الفصل الأول',
      descriptionAr: 'التدريب على توزيع الوقت وصياغة الإجابات المقالية النموذجية.',
      scheduledAt: new Date(Date.now() + 3 * 86400_000),
      durationMin: 90,
      sessionType: 'LIVE',
      liveProvider: 'ZOOM',
      joinUrl: 'https://zoom.us/j/physics-azhar3-live',
      isPublished: true,
    },
  ]);

  // 10. Question Bank (with LaTeX Physics Equations!) & Exams
  const [q1, q2, q3, q4, q5] = await db
    .insert(questions)
    .values([
      {
        gradeId: bac3.id,
        unitId: uBac3Ch1.id,
        lessonId: lBac3Ohm.id,
        questionType: 'MCQ',
        difficulty: 'MEDIUM',
        promptAr:
          'بطارية قوتها الدافعة الكهربية 12 فولت ومقاومتها الداخلية 1 أوم، وُصلت بمقاومة خارجية 5 أوم. احسب شدة التيار المار في الدائرة:',
        latexFormula: 'I = \\frac{V_B}{R + r} = \\frac{12}{5 + 1}',
        points: 4,
        modelAnswerAr: '2 أمبير',
        explanationAr: 'بتطبيق قانون أوم للدائرة المغلقة: I = 12 / (5 + 1) = 2 A.',
      },
      {
        gradeId: bac3.id,
        unitId: uBac3Ch1.id,
        lessonId: lBac3Ohm.id,
        questionType: 'TRUE_FALSE',
        difficulty: 'EASY',
        promptAr:
          'تزداد قراءة الفولتميتر المتصل بين طرفي بطارية لها مقاومة داخلية غير مهملة كلما زادت المقاومة الخارجية للدائرة.',
        latexFormula: 'V = V_B - I \\cdot r',
        points: 2,
        modelAnswerAr: 'صواب',
        explanationAr: 'بزيادة المقاومة الخارجية تقل شدة التيار I فيقل المقدار I·r وتزداد قراءة V.',
      },
      {
        gradeId: bac3.id,
        unitId: uBac3Ch1.id,
        lessonId: lBac3Kirchhoff.id,
        questionType: 'NUMERIC',
        difficulty: 'HARD',
        promptAr:
          'سلك مقاومته 8 أوم ويمر به تيار شدته 2.5 أمبير. احسب القدرة الكهربية المستهلكة في السلك بوحدة الوات (أدخل الرقم فقط):',
        latexFormula: 'P = I^2 \\cdot R',
        points: 4,
        numericAnswer: '50.0000',
        numericTolerance: '0.5000',
        modelAnswerAr: '50 وات',
        explanationAr: 'P = (2.5)^2 × 8 = 6.25 × 8 = 50 W.',
      },
      {
        gradeId: bac3.id,
        unitId: uBac3Ch1.id,
        lessonId: lBac3Kirchhoff.id,
        questionType: 'ESSAY',
        difficulty: 'MEDIUM',
        promptAr:
          'اشرح الأساس العلمي لكل من قانون كيرشوف الأول وقانون كيرشوف الثاني مع كتابة الصيغة الرياضية لكل منهما:',
        latexFormula: '\\sum I_{in} = \\sum I_{out}, \\quad \\sum V_B = \\sum (I \\cdot R)',
        points: 5,
        modelAnswerAr:
          'قانون كيرشوف الأول يعتمد على قانون حفظ الشحنة الكهربية، بينما قانون كيرشوف الثاني يعتمد على قانون حفظ الطاقة.',
        explanationAr: 'يصححه المدرس يدويًا لتقييم دقة الصياغة العلمية.',
      },
      {
        gradeId: azhar3.id,
        unitId: uAzhar3Ch1.id,
        lessonId: lAzhar3Ohm.id,
        questionType: 'MCQ',
        difficulty: 'EASY',
        promptAr: 'وحدة قياس المقاومة النوعية لمادة موصل في النظام الدولي هي:',
        latexFormula: '\\rho_e = \\frac{R \\cdot A}{L}',
        points: 3,
        modelAnswerAr: 'أوم . متر',
        explanationAr: 'من العلاقة ρ = R·A/L تكون الوحدة Ω·m²/m = Ω·m.',
      },
    ])
    .returning();

  const [c1a] = await db
    .insert(choices)
    .values([
      { questionId: q1.id, labelAr: '2 أمبير', latexFormula: '2\\text{ A}', isCorrect: true, sortOrder: 1 },
      { questionId: q1.id, labelAr: '2.4 أمبير', latexFormula: '2.4\\text{ A}', isCorrect: false, sortOrder: 2 },
      { questionId: q1.id, labelAr: '1.5 أمبير', latexFormula: '1.5\\text{ A}', isCorrect: false, sortOrder: 3 },
      { questionId: q1.id, labelAr: '3 أمبير', latexFormula: '3\\text{ A}', isCorrect: false, sortOrder: 4 },
      { questionId: q2.id, labelAr: 'صواب', isCorrect: true, sortOrder: 1 },
      { questionId: q2.id, labelAr: 'خطأ', isCorrect: false, sortOrder: 2 },
      { questionId: q5.id, labelAr: 'أوم . متر', latexFormula: '\\Omega \\cdot m', isCorrect: true, sortOrder: 1 },
      { questionId: q5.id, labelAr: 'أوم / متر', latexFormula: '\\Omega / m', isCorrect: false, sortOrder: 2 },
      { questionId: q5.id, labelAr: 'أوم⁻¹ . متر⁻¹', latexFormula: '\\Omega^{-1} \\cdot m^{-1}', isCorrect: false, sortOrder: 3 },
      { questionId: q5.id, labelAr: 'فولت . أمبير', latexFormula: 'V \\cdot A', isCorrect: false, sortOrder: 4 },
    ])
    .returning();

  const [examBac3Quiz, examBac3Unit, examAzharQuiz] = await db
    .insert(exams)
    .values([
      {
        gradeId: bac3.id,
        unitId: uBac3Ch1.id,
        lessonId: lBac3Ohm.id,
        titleAr: 'اختبار الدرس الأول والثاني: قانون أوم وقانونا كيرشوف',
        descriptionAr: 'امتحان متكامل يجمع بين الاختيار من متعدد والأسئلة الحسابية وسؤال مقالي لتصحيح المدرس.',
        examType: 'UNIT_EXAM',
        durationMin: 25,
        maxAttempts: 3,
        passScorePercent: 60,
        shuffleQuestions: false,
        shuffleChoices: false,
        showResultImmediately: true,
        showCorrectAnswers: true,
        isPublished: true,
      },
      {
        gradeId: bac3.id,
        unitId: uBac3Ch2.id,
        titleAr: 'امتحان محاكاة الوحدة الثانية (مقفل لحين إتمام محاضرة فاراداي)',
        descriptionAr: 'يفتح تلقائيًا فور إتمام مشاهدة محاضرة قانون فاراداي بنسبة 70% فأكثر.',
        examType: 'FINAL_SIMULATION',
        durationMin: 40,
        maxAttempts: 2,
        passScorePercent: 70,
        requiredVideoId: vBac3Course1.id,
        isPublished: true,
      },
      {
        gradeId: azhar3.id,
        unitId: uAzhar3Ch1.id,
        titleAr: 'اختبار بوكليت الأزهر — الفصل الأول',
        descriptionAr: 'تقييم قصير لطلاب الصف الثالث الثانوي الأزهري.',
        examType: 'LESSON_QUIZ',
        durationMin: 15,
        maxAttempts: 3,
        passScorePercent: 60,
        isPublished: true,
      },
    ])
    .returning();

  await db.insert(examQuestions).values([
    { examId: examBac3Quiz.id, questionId: q1.id, sortOrder: 1 },
    { examId: examBac3Quiz.id, questionId: q2.id, sortOrder: 2 },
    { examId: examBac3Quiz.id, questionId: q3.id, sortOrder: 3 },
    { examId: examBac3Quiz.id, questionId: q4.id, sortOrder: 4 },
    { examId: examBac3Unit.id, questionId: q1.id, sortOrder: 1 },
    { examId: examAzharQuiz.id, questionId: q5.id, sortOrder: 1 },
  ]);

  // 11. Sample Activation Code (hashed! Demo code for testing: PHY-DEMO-2026-KIRC unlocks vBac3Paid1)
  const demoPlainCode = 'PHY-DEMO-2026-KIRC';
  await db.insert(accessCodes).values([
    {
      codeHash: hashActivationCode(demoPlainCode),
      codePrefix: maskActivationCode(demoPlainCode),
      targetType: 'VIDEO',
      targetId: vBac3Paid1.id,
      trackId: bacTrack.id,
      gradeId: bac3.id,
      durationDays: 60,
      maxUses: 5,
      usedCount: 0,
      status: 'AVAILABLE',
      batchLabel: 'دفعة تجريبية — كيرشوف',
      createdById: adminUser.id,
    },
    {
      codeHash: hashActivationCode('PHY-CRSE-2026-ELEC'),
      codePrefix: maskActivationCode('PHY-CRSE-2026-ELEC'),
      targetType: 'COURSE',
      targetId: cBac3Electromag.id,
      trackId: bacTrack.id,
      gradeId: bac3.id,
      durationDays: 120,
      maxUses: 5,
      usedCount: 0,
      status: 'AVAILABLE',
      batchLabel: 'كورس الكهربية الشامل',
      createdById: adminUser.id,
    },
  ]);

  // 12. Student Progress, Entitlements, Orders, Payments, Comments, Notifications
  if (studentActiveId && studentBac2Id && studentPendingId) {
    await db.insert(groupMembers).values({
      groupId: grpSat.id,
      userId: studentActiveId,
    });

    // Give active demo student progress on free video
    await db.insert(progressRecords).values({
      userId: studentActiveId,
      videoId: vBac3Free1.id,
      lastPositionSec: 1580,
      watchedSec: 1920,
      completionPercent: 73,
      isCompleted: false,
    });

    // Give active demo student 1 manual grant for vBac3Paid2 so we can test both unlocked & locked paid videos!
    await db.insert(entitlements).values({
      userId: studentActiveId,
      targetType: 'VIDEO',
      targetId: vBac3Paid2.id,
      source: 'MANUAL_GRANT',
      priority: getSourcePriority('MANUAL_GRANT'),
      expiresAt: new Date(Date.now() + 45 * 86400_000),
      grantedById: adminUser.id,
      note: 'منحة تشجيعية للتفوق في الاختبار الأسبوعي',
    });

    // Subscription + Paid Order + Under-Review Bank Transfer Order
    await db.insert(subscriptions).values({
      userId: studentBac2Id,
      planId: planMonthlyBac3.id,
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 5 * 86400_000),
      expiresAt: new Date(Date.now() + 25 * 86400_000),
    });

    const [ord1, ord2] = await db
      .insert(orders)
      .values([
        {
          orderNumber: 'ORD-2026-1001',
          userId: studentBac2Id,
          targetType: 'COURSE',
          targetId: cBac3Electromag.id,
          targetTitleAr: cBac3Electromag.titleAr,
          amountEgp: 450,
          discountEgp: 0,
          finalAmountEgp: 450,
          paymentMethod: 'BANK_TRANSFER',
          status: 'PAID',
        },
        {
          orderNumber: 'ORD-2026-1002',
          userId: studentActiveId,
          targetType: 'COURSE',
          targetId: cBac3Electromag.id,
          targetTitleAr: cBac3Electromag.titleAr,
          amountEgp: 450,
          discountEgp: 90,
          finalAmountEgp: 360,
          couponCode: 'PHYS20',
          paymentMethod: 'WALLET',
          status: 'UNDER_REVIEW',
        },
      ])
      .returning();

    await db.insert(payments).values([
      {
        orderId: ord1.id,
        provider: 'BANK_TRANSFER',
        providerRef: 'NBE-884120',
        amountEgp: 450,
        receiptNote: 'تحويل إنستا باي مؤكد',
        status: 'VERIFIED',
        verifiedById: adminUser.id,
        verifiedAt: new Date(Date.now() - 3 * 86400_000),
      },
      {
        orderId: ord2.id,
        provider: 'WALLET',
        providerRef: 'VF-CASH-99214',
        amountEgp: 360,
        receiptNote: 'تحويل فودافون كاش من رقم ولي الأمر 01099887766 — بانتظار المراجعة',
        status: 'PENDING',
      },
    ]);

    // Seed 1 historical exam attempt with 1 essay awaiting manual grading
    const [attempt] = await db
      .insert(examAttempts)
      .values({
        examId: examBac3Quiz.id,
        userId: studentActiveId,
        attemptNumber: 1,
        status: 'SUBMITTED',
        startedAt: new Date(Date.now() - 2 * 86400_000),
        submittedAt: new Date(Date.now() - 2 * 86400_000 + 18 * 60_000),
        autoScore: '8.00',
        manualScore: '0.00',
        totalScore: '8.00',
        maxScore: '15.00',
        passed: false,
      })
      .returning();

    await db.insert(studentAnswers).values([
      {
        attemptId: attempt.id,
        questionId: q1.id,
        selectedChoiceId: c1a.id,
        isCorrect: true,
        awardedPoints: '4.00',
        needsManualGrading: false,
      },
      {
        attemptId: attempt.id,
        questionId: q4.id,
        textAnswer: 'قانون كيرشوف الأول يطبق مبدأ حفظ الشحنة الكهربية عند أي عقدة، والقانون الثاني يطبق مبدأ حفظ الطاقة في المسار المغلق.',
        isCorrect: null,
        awardedPoints: '0.00',
        needsManualGrading: true,
      },
    ]);

    await db.insert(lessonComments).values({
      lessonId: lBac3Ohm.id,
      userId: studentActiveId,
      bodyAr: 'يا دكتور، لو المقاومة الداخلية r = 0 هل تظل قراءة الفولتميتر ثابتة مهما تغيرت المقاومة الخارجية؟',
      replyAr: 'نعم يا يوسف ممتاز! عندما تكون r = 0 فإن V = V_B وتظل ثابتة تمامًا.',
      repliedById: adminUser.id,
      status: 'APPROVED',
    });

    await db.insert(notifications).values([
      {
        userId: studentActiveId,
        titleAr: 'تم قبول حسابك في الصف الثالث بكالوريا',
        bodyAr: 'أهلًا بك يا يوسف في منصة أستاذ / حمدى الشباسي للفيزياء. يمكنك الآن البدء بمشاهدة المحاضرات وحل الاختبارات.',
        type: 'APPROVAL',
        isRead: false,
      },
      {
        gradeId: bac3.id,
        titleAr: 'موعد حصة المراجعة المباشرة',
        bodyAr: 'تذكير: حصة المراجعة المباشرة لقانوني كيرشوف بعد يومين الساعة 7:00 مساءً.',
        type: 'GENERAL',
        isRead: false,
      },
    ]);

    await db.insert(auditLogs).values([
      {
        actorId: adminUser.id,
        actorName: adminUser.fullName,
        action: 'STUDENT_APPROVED',
        entityType: 'user',
        entityId: String(studentActiveId),
        detailsJson: { studentName: 'يوسف محمد عبد الرحمن', grade: 'الصف الثالث بكالوريا' },
      },
      {
        actorId: adminUser.id,
        actorName: adminUser.fullName,
        action: 'DIRECT_VIDEO_GRANTED',
        entityType: 'entitlement',
        entityId: String(vBac3Paid2.id),
        detailsJson: { studentName: 'يوسف محمد عبد الرحمن', videoTitle: vBac3Paid2.titleAr },
      },
    ]);
  }

  void planTermBac3;
  void vAzharFree1;
  void vAzharPaid1;
  void vBac2Free1;
  void vBac1Free1;
  void cBac3Modern;
  void cAzhar3Full;
  void eq;
}
