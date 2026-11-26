import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleDrivePreviewUrl,
  buildGoogleDriveViewUrl,
  extractGoogleDriveFileId,
} from './googleDrive.ts';

test('extractGoogleDriveFileId supports all standard Google Drive PDF sharing URL formats', () => {
  const fileId = '1A2B3C4D5E6F7G8H9I0J_abc-DEF12345';
  const urls = [
    `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
    `https://drive.google.com/file/d/${fileId}/view?usp=drive_link`,
    `https://drive.google.com/file/d/${fileId}/preview`,
    `https://drive.google.com/file/d/${fileId}/edit`,
    `https://drive.google.com/file/u/0/d/${fileId}/view`,
    `https://drive.google.com/open?id=${fileId}`,
    `https://drive.google.com/uc?id=${fileId}&export=download`,
    `https://drive.google.com/uc?export=view&id=${fileId}`,
    `https://docs.google.com/file/d/${fileId}/preview`,
    `drive.google.com/file/d/${fileId}/view`,
  ];

  for (const url of urls) {
    const parsed = extractGoogleDriveFileId(url);
    assert.equal(parsed.valid, true, `Expected valid Google Drive URL: ${url}`);
    assert.equal(parsed.fileId, fileId, `Expected fileId ${fileId} for ${url}`);
    assert.equal(parsed.previewUrl, buildGoogleDrivePreviewUrl(fileId));
    assert.equal(parsed.viewUrl, buildGoogleDriveViewUrl(fileId));
  }
});

test('extractGoogleDriveFileId rejects folders, non-Drive domains, empty strings, and malformed IDs', () => {
  const invalidUrls = [
    '',
    'not-a-valid-url',
    'https://example.com/file/d/1A2B3C4D5E6F7G8H9I0J_abc-DEF12345/view',
    'https://dropbox.com/s/abcdef1234567890/lesson.pdf',
    'https://drive.google.com/drive/folders/1A2B3C4D5E6F7G8H9I0J_abc-DEF12345?usp=sharing',
    'https://drive.google.com/file/d/short/view',
    'https://drive.google.com/drive/my-drive',
    'https://evil-drive.google.com.attacker.com/file/d/1A2B3C4D5E6F7G8H9I0J_abc-DEF12345/view',
  ];

  for (const url of invalidUrls) {
    const parsed = extractGoogleDriveFileId(url);
    assert.equal(parsed.valid, false, `Expected invalid URL: ${url}`);
    assert.equal(parsed.fileId, null);
    assert.equal(parsed.previewUrl, null);
    assert.ok(parsed.errorAr && parsed.errorAr.length > 5);
  }

  const folderRes = extractGoogleDriveFileId(
    'https://drive.google.com/drive/folders/1A2B3C4D5E6F7G8H9I0J_abc-DEF12345',
  );
  assert.ok(folderRes.errorAr?.includes('مجلد'));
});
