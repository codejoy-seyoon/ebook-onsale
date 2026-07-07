// 로컬 PDF 를 Vercel Blob(비공개)에 지정한 pathname 으로 업로드/덮어쓰기 하는 1회용 도구.
//
// 지금(임시 파일):
//   Windows PowerShell:
//     $env:BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."; node upload-blob.mjs ../ebook.pdf ebook.pdf
//   Git Bash / macOS / Linux:
//     BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... node upload-blob.mjs ../ebook.pdf ebook.pdf
//
// 나중(실제 이북 교체): 실제 파일 경로만 바꿔서 같은 pathname 으로 덮어쓰기
//     node upload-blob.mjs ../진짜이북.pdf ebook.pdf
//
// 토큰은 Vercel 대시보드 → Storage → (Blob 스토어) → ".env.local" 탭 또는
// 프로젝트 Settings → Environment Variables 의 BLOB_READ_WRITE_TOKEN 값입니다.
// ⚠️ 토큰은 본인이 직접 넣어 실행하세요. (여기 파일에 하드코딩 금지)

import { put } from '@vercel/blob';
import fs from 'node:fs';
import path from 'node:path';

const filePath = process.argv[2] || '../ebook.pdf';
const pathname = process.argv[3] || 'ebook.pdf';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('❌ BLOB_READ_WRITE_TOKEN 환경변수가 필요합니다. (Vercel Blob 스토어 토큰)');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error('❌ 파일을 찾을 수 없습니다: ' + path.resolve(filePath));
  process.exit(1);
}

const data = fs.readFileSync(filePath);

try {
  const blob = await put(pathname, data, {
    access: 'private',
    contentType: 'application/pdf',
    allowOverwrite: true, // 같은 pathname 재업로드 허용 (실제 이북으로 교체 시 필수)
  });
  console.log('✅ 업로드 완료');
  console.log('   pathname :', blob.pathname);
  console.log('   (mailer 는 PDF_BLOB_PATHNAME=' + blob.pathname + ' 로 이 파일을 읽습니다)');
} catch (e) {
  console.error('❌ 업로드 실패:', e.message);
  process.exit(1);
}
