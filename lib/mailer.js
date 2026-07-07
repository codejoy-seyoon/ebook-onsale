// 구매자에게 이북 PDF 이메일 발송 (hq@joy-bnikorea.com / Gmail SMTP)
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.MAIL_PORT || 465),
  secure: Number(process.env.MAIL_PORT || 465) === 465, // 465=SSL
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS, // Gmail "앱 비밀번호"
  },
});

// 발송용 PDF 를 비공개 URL 에서 내려받아 Buffer 로 반환
async function fetchPdf() {
  const url = process.env.PDF_SOURCE_URL;
  if (!url) throw new Error('PDF_SOURCE_URL 이 설정되지 않았습니다.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF 다운로드 실패 (${res.status})`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function sendEbookEmail({ to, name }) {
  const buyer = name || 'there';
  const password = process.env.PDF_PASSWORD;
  const pdf = await fetchPdf();

  const passwordLineEn = password
    ? `\n• PDF password: ${password}`
    : '';
  const passwordLineKo = password
    ? `\n• PDF 비밀번호: ${password}`
    : '';

  const text =
`Hi ${buyer},

Thank you for purchasing C Coaching — Co-Elevate Your Community.
We're honored to have you join the movement.

Your ebook is attached to this email as a PDF.
• File: C Coaching (PDF)${passwordLineEn}
• The file is for your personal reading only. Please do not share, copy, or redistribute it.

If you have any trouble opening the file, just reply to this email.

Warmly,
John Yoon
Coachingtown

──────────────────────────────

${buyer}님, 안녕하세요.

『C Coaching — Co-Elevate Your Community』를 구매해 주셔서 진심으로 감사합니다.

구매하신 이북 PDF 파일을 본 메일에 첨부해 드립니다.
• 파일: C Coaching (PDF)${passwordLineKo}
• 본 파일은 구매자 본인의 열람용입니다. 무단 복제·공유·배포를 삼가 주세요.

파일 열람에 문제가 있으시면 본 메일에 회신해 주세요.

감사합니다.
John Yoon 드림
Coachingtown`;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to,
    subject: '[C Coaching] Your ebook is here — 이북 파일을 보내드립니다',
    text,
    attachments: [{ filename: 'C-Coaching.pdf', content: pdf }],
  });
}
