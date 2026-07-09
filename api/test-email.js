// 발송 점검용 엔드포인트 — 실제 결제 없이 운영 mailer(sendEbookEmail)를 그대로 실행한다.
// Blob(비공개 ebook.pdf) 읽기 → 첨부 → Gmail SMTP 발송까지 실제 경로를 검증한다.
//
// 사용:  GET /api/test-email?token=<TEST_TOKEN>&to=you@example.com&name=YourName
// 보안:  TEST_TOKEN 환경변수와 일치해야만 동작. 미설정이면 항상 차단.
//        검증이 끝나면 TEST_TOKEN 을 지우거나 이 파일을 삭제하세요.

import { sendEbookEmail } from '../lib/mailer.js';

export default async function handler(req, res) {
  const token = req.query.token || req.headers['x-test-token'];
  if (!process.env.TEST_TOKEN || token !== process.env.TEST_TOKEN) {
    res.status(403).send('forbidden');
    return;
  }

  const to = req.query.to;
  if (!to) {
    res
      .status(400)
      .send('to 파라미터가 필요합니다. 예: /api/test-email?token=...&to=you@example.com');
    return;
  }

  try {
    const result = await sendEbookEmail({ to, name: req.query.name || 'Test' });
    const kb = Math.round((result.bytes || 0) / 1024);
    const diag =
      `\n--- 진단 ---` +
      `\nPDF_BLOB_PATHNAME = ${JSON.stringify(process.env.PDF_BLOB_PATHNAME || null)}` +
      `\nPDF_SOURCE_URL 설정됨? ${process.env.PDF_SOURCE_URL ? 'YES → ' + process.env.PDF_SOURCE_URL : 'no'}` +
      `\n첨부 크기 = ${kb} KB (${result.bytes || 0} bytes)  [옛 파일≈473KB / 새 파일≈2390KB]`;
    res
      .status(200)
      .send(
        `✅ 발송 완료 → ${to} (PDF 첨부: ${result.attached ? '있음' : '없음 — PDF_BLOB_PATHNAME/PDF_SOURCE_URL 미설정'})${diag}`
      );
  } catch (e) {
    console.error('[test-email] 발송 실패:', e);
    res.status(500).send('발송 실패: ' + e.message);
  }
}
