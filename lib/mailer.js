// 구매자에게 이북 이메일 발송 (hq@joy-bnikorea.com / Gmail SMTP)
//
// PDF 정책 (둘 중 하나로 파일을 가져와 첨부):
//   1) PDF_BLOB_PATHNAME  → Vercel Blob(비공개)에서 get(pathname,{access:'private'}) 로 읽음 (권장)
//   2) PDF_SOURCE_URL     → 공개/직접다운로드 URL 을 fetch (대체 수단)
// 둘 다 없으면 첨부 없이 "곧 보내드립니다" 확인 메일만 발송한다.
// → 이북 파일 확정 전에도 "결제 → 이메일 발송" 파이프라인을 먼저 가동할 수 있고,
//   실제 이북이 나오면 Blob 파일만 교체(같은 pathname 로 재업로드)하면 된다.
//
// Vercel Blob 읽기에는 BLOB_READ_WRITE_TOKEN 이 필요하다 (Blob 스토어를 프로젝트에
// 연결하면 Vercel 이 자동 주입). 로컬 실행 시에는 환경변수로 직접 넣어야 한다.
import nodemailer from 'nodemailer';
import { get } from '@vercel/blob';

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.MAIL_PORT || 465),
  secure: Number(process.env.MAIL_PORT || 465) === 465, // 465=SSL
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS, // Gmail "앱 비밀번호"
  },
});

// 발송용 PDF 를 가져와 Buffer 로 반환 (없으면 null → 첨부 없이 진행)
async function fetchPdf() {
  // 1순위: Vercel Blob 비공개 파일 (pathname 으로 서버가 토큰으로 읽음)
  const pathname = process.env.PDF_BLOB_PATHNAME;
  if (pathname) {
    const result = await get(pathname, { access: 'private' });
    if (!result) throw new Error(`Blob 을 찾지 못함: ${pathname}`);
    const arrayBuf = await new Response(result.stream).arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // 2순위: 공개/직접다운로드 URL
  const url = process.env.PDF_SOURCE_URL;
  if (!url) return null; // 둘 다 미설정 = 아직 파일 없음 → 첨부 없이 진행
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF 다운로드 실패 (${res.status})`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function sendEbookEmail({ to, name }) {
  const buyer = name || 'there';
  const password = process.env.PDF_PASSWORD;
  const pdf = await fetchPdf();
  const hasPdf = !!pdf;

  const passwordLineEn = hasPdf && password ? `\n• PDF password: ${password}` : '';
  const passwordLineKo = hasPdf && password ? `\n• PDF 비밀번호: ${password}` : '';

  // 파일 유무에 따라 안내 문구를 다르게 구성
  const fileBlockEn = hasPdf
    ? `Your ebook is attached to this email as a PDF.
• File: C Coaching (PDF)${passwordLineEn}
• The file is for your personal reading only. Please do not share, copy, or redistribute it.`
    : `Your ebook is being finalized and will be delivered to this email address very shortly.
We'll send the PDF as soon as it's ready — no further action is needed on your side.`;

  const fileBlockKo = hasPdf
    ? `구매하신 이북 PDF 파일을 본 메일에 첨부해 드립니다.
• 파일: C Coaching (PDF)${passwordLineKo}
• 본 파일은 구매자 본인의 열람용입니다. 무단 복제·공유·배포를 삼가 주세요.`
    : `구매하신 이북 파일은 최종 준비 중이며, 준비되는 대로 이 이메일 주소로 곧 보내드리겠습니다.
별도로 하실 일은 없으며, 파일이 완성되면 자동으로 발송됩니다.`;

  const text =
`Hi ${buyer},

Thank you for purchasing C Coaching — Co-Elevate Your Community.
We're honored to have you join the movement.

${fileBlockEn}

If you have any trouble, just reply to this email.

Warmly,
John Yoon
Coachingtown

──────────────────────────────

${buyer}님, 안녕하세요.

『C Coaching — Co-Elevate Your Community』를 구매해 주셔서 진심으로 감사합니다.

${fileBlockKo}

문의사항이 있으시면 본 메일에 회신해 주세요.

감사합니다.
John Yoon 드림
Coachingtown`;

  const subject = hasPdf
    ? '[C Coaching] Your ebook is here — 이북 파일을 보내드립니다'
    : '[C Coaching] Order confirmed — 결제가 완료되었습니다';

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to,
    subject,
    text,
    attachments: hasPdf ? [{ filename: 'C-Coaching.pdf', content: pdf }] : [],
  });

  return { attached: hasPdf };
}
