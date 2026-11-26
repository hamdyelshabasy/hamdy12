const GOOGLE_DRIVE_FILE_ID_REGEX = /^[A-Za-z0-9_-]{15,80}$/;

const ALLOWED_DRIVE_HOSTS = new Set([
  'drive.google.com',
  'www.drive.google.com',
  'docs.google.com',
  'www.docs.google.com',
]);

export interface ParsedGoogleDrivePdf {
  valid: boolean;
  fileId: string | null;
  previewUrl: string | null;
  viewUrl: string | null;
  errorAr?: string;
}

export function buildGoogleDrivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function buildGoogleDriveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Extracts and validates a Google Drive file ID from standard Google Drive sharing links.
 * Supports:
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/file/d/FILE_ID/preview
 * - https://drive.google.com/file/u/0/d/FILE_ID/view
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID&export=download
 * - https://docs.google.com/file/d/FILE_ID/edit
 */
export function extractGoogleDriveFileId(rawInput: string): ParsedGoogleDrivePdf {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      fileId: null,
      previewUrl: null,
      viewUrl: null,
      errorAr: 'يرجى إدخال رابط ملف PDF من Google Drive.',
    };
  }

  let normalized = trimmed;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      valid: false,
      fileId: null,
      previewUrl: null,
      viewUrl: null,
      errorAr: 'صيغة الرابط غير صالحة. يرجى لصق رابط مشاركة Google Drive كامل وصحيح.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_DRIVE_HOSTS.has(host)) {
    return {
      valid: false,
      fileId: null,
      previewUrl: null,
      viewUrl: null,
      errorAr: 'الرابط المدخل ليس رابط Google Drive معتمدًا (يجب أن يبدأ بـ drive.google.com).',
    };
  }

  const path = parsed.pathname;

  // Reject Google Drive folder links explicitly with a helpful Arabic message
  if (/\/folders\//i.test(path)) {
    return {
      valid: false,
      fileId: null,
      previewUrl: null,
      viewUrl: null,
      errorAr:
        'الرابط المدخل هو رابط مجلد Google Drive وليس رابط ملف PDF. يرجى نسخ رابط ملف الـ PDF نفسه.',
    };
  }

  let candidateId: string | null = null;

  // Pattern 1: /file/d/<FILE_ID>/... or /file/u/0/d/<FILE_ID>/...
  const fileDMatch = path.match(/\/file\/(?:u\/\d+\/)?d\/([^/?#]+)/i);
  if (fileDMatch?.[1]) {
    candidateId = fileDMatch[1];
  }

  // Pattern 2: /d/<FILE_ID>/... (generic drive/docs file path)
  if (!candidateId) {
    const genericDMatch = path.match(/\/d\/([^/?#]+)/i);
    if (genericDMatch?.[1] && !/\/(spreadsheets|presentation|forms)\//i.test(path)) {
      candidateId = genericDMatch[1];
    }
  }

  // Pattern 3: /open?id=<FILE_ID> or /uc?id=<FILE_ID> or ?id=<FILE_ID>
  if (!candidateId) {
    const queryId = parsed.searchParams.get('id');
    if (queryId) {
      candidateId = queryId.trim();
    }
  }

  if (!candidateId || !GOOGLE_DRIVE_FILE_ID_REGEX.test(candidateId)) {
    return {
      valid: false,
      fileId: null,
      previewUrl: null,
      viewUrl: null,
      errorAr:
        'تعذر استخراج معرّف ملف Google Drive صالح من الرابط. تأكد من نسخ رابط المشاركة الصحيح لملف الـ PDF.',
    };
  }

  return {
    valid: true,
    fileId: candidateId,
    previewUrl: buildGoogleDrivePreviewUrl(candidateId),
    viewUrl: buildGoogleDriveViewUrl(candidateId),
  };
}
