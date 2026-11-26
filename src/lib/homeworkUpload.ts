import { apiRequest } from './api.ts';

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export function formatFileSizeAr(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.ب`;
}

export function formatRemainingTimeAr(
  deadlineIso: string | null | undefined,
  serverNowIso?: string | null,
): { text: string; isExpired: boolean; isUrgent: boolean } {
  if (!deadlineIso) {
    return { text: 'بدون موعد نهائي محدد', isExpired: false, isUrgent: false };
  }
  const nowMs = serverNowIso ? new Date(serverNowIso).getTime() : Date.now();
  const dlMs = new Date(deadlineIso).getTime();
  const diffMs = dlMs - nowMs;

  if (diffMs <= 0) {
    return { text: 'انتهى موعد التسليم', isExpired: true, isUrgent: false };
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;

  if (days > 0) {
    return {
      text: `متبقي ${days} يوم${hours > 0 ? ` و ${hours} ساعة` : ''}`,
      isExpired: false,
      isUrgent: days <= 1,
    };
  }
  if (hours > 0) {
    return {
      text: `متبقي ${hours} ساعة${mins > 0 ? ` و ${mins} دقيقة` : ''}`,
      isExpired: false,
      isUrgent: true,
    };
  }
  return {
    text: `متبقي ${Math.max(1, mins)} دقيقة`,
    isExpired: false,
    isUrgent: true,
  };
}

export function fileToBase64(file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.min(70, Math.round((ev.loaded / ev.total) * 70)));
      }
    };
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onProgress?.(80);
        resolve(reader.result);
      } else {
        reject(new Error('تعذر قراءة الملف المختار'));
      }
    };
    reader.onerror = () => reject(new Error('فشلت قراءة الملف من الجهاز'));
    reader.readAsDataURL(file);
  });
}

export interface UploadedHomeworkFileResult {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
}

export async function uploadHomeworkFile(
  endpoint: '/api/student/homework/upload-file' | '/api/admin/homework/upload-file',
  file: File,
  purpose?: 'ASSIGNMENT_ATTACHMENT' | 'MODEL_ANSWER' | 'SUBMISSION_FILE',
  onProgress?: (pct: number) => void,
): Promise<UploadedHomeworkFileResult> {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    throw new Error(
      `صيغة الملف "${file.name}" غير مدعومة. الصيغ المسموحة: JPG، JPEG، PNG، WEBP، PDF.`,
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`حجم الملف "${file.name}" يتجاوز الحد الأقصى المسموح (5 ميجابايت).`);
  }

  onProgress?.(15);
  const dataBase64 = await fileToBase64(file, onProgress);
  onProgress?.(85);

  const uploaded = await apiRequest<UploadedHomeworkFileResult>(endpoint, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      dataBase64,
      purpose,
    }),
  });
  onProgress?.(100);
  return uploaded;
}

export function getStudentStatusBadgeClass(code: string): string {
  switch (code) {
    case 'GRADED':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'SUBMITTED':
      return 'border-blue-200 bg-blue-50 text-[#2563EB]';
    case 'UNDER_REVIEW':
      return 'border-indigo-200 bg-indigo-50 text-indigo-700';
    case 'RETURNED_FOR_REVISION':
      return 'border-amber-300 bg-amber-50 text-amber-800';
    case 'LATE':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'DEADLINE_PASSED':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'IN_PROGRESS':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    default:
      return 'border-slate-200 bg-slate-100 text-slate-700';
  }
}
