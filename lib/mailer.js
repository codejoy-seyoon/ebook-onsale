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

// HTML 이메일 본문에 값을 삽입하기 전 최소한의 이스케이프 (구매자 이름 등)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

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

  const passwordLineEn = hasPdf && password
    ? `\n• This PDF is password-protected. When the file asks for a password, enter: ${password}`
    : '';

  // 파일 유무에 따라 안내 문구를 다르게 구성 (해외 구매자 대상 — 영어로만 발송)
  const fileBlockEn = hasPdf
    ? `Your ebook is attached to this email as a PDF.
• File: C Coaching (PDF)${passwordLineEn}
• The file is for your personal reading only. Please do not share, copy, or redistribute it.`
    : `Your ebook is being finalized and will be delivered to this email address very shortly.
We'll send the PDF as soon as it's ready — no further action is needed on your side.`;

  const text =
`Hi ${buyer},

Thank you for purchasing C Coaching — Co-Elevate Your Community.
We're honored to have you join the movement.

${fileBlockEn}

If you have any trouble, just reply to this email.

Warmly,
John Yoon
Coachingtown`;

  const subject = hasPdf
    ? '[C Coaching] Your ebook is here'
    : '[C Coaching] Order confirmed';

  const html = buildHtml({ buyer, hasPdf, password });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to,
    subject,
    text,
    html,
    attachments: hasPdf ? [{ filename: 'C-Coaching.pdf', content: pdf }] : [],
  });

  return { attached: hasPdf, bytes: pdf ? pdf.length : 0 };
}

// 랜딩페이지(c-coachingtown.com) 컨셉의 HTML 이메일 템플릿.
// 한지 톤 배경 + 오렌지 포인트 + serif 제목. 이메일 클라이언트 호환을 위해
// 테이블 레이아웃 + 인라인 스타일로 작성. (해외 구매자 대상 — 영어)
export function buildHtml({ buyer, hasPdf, password }) {
  const safeBuyer = escapeHtml(buyer);
  const serif = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
  const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

  const passwordBox = hasPdf && password
    ? `
              <tr>
                <td style="padding:6px 0 4px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#fbeee6;border:1px solid #f0c9b3;border-radius:12px;padding:18px 22px;">
                        <div style="font-family:${sans};font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#cc4a12;font-weight:700;">🔒 PDF Password</div>
                        <div style="font-family:${serif};font-size:26px;font-weight:700;color:#211d17;letter-spacing:2px;margin-top:7px;">${escapeHtml(password)}</div>
                        <div style="font-family:${sans};font-size:13px;line-height:1.6;color:#4a443b;margin-top:7px;">Enter this password when the PDF asks for one to open the file.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : '';

  const bodyBlock = hasPdf
    ? `
              <tr>
                <td style="font-family:${sans};font-size:16px;line-height:1.7;color:#211d17;padding:0 0 18px;">
                  Your ebook is attached to this email as a PDF — <strong>C Coaching</strong>.
                </td>
              </tr>
              ${passwordBox}
              <tr>
                <td style="font-family:${sans};font-size:13px;line-height:1.7;color:#4a443b;padding:16px 0 4px;">
                  This file is for your personal reading only. Please do not share, copy, or redistribute it.
                </td>
              </tr>`
    : `
              <tr>
                <td style="font-family:${sans};font-size:16px;line-height:1.7;color:#211d17;padding:0 0 8px;">
                  Your ebook is being finalized and will be delivered to this email address very shortly.
                  We'll send the PDF as soon as it's ready — no further action is needed on your side.
                </td>
              </tr>`;

  const eyebrow = hasPdf ? 'Your ebook has arrived' : 'Order confirmed';
  const heading = hasPdf ? 'Welcome to the movement.' : 'Thank you for your order.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap" rel="stylesheet" />
<title>C Coaching</title>
</head>
<body style="margin:0;padding:0;background-color:#f4ecdd;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4ecdd;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

          <!-- Brand wordmark -->
          <tr>
            <td align="center" style="padding:8px 0 24px;">
              <span style="font-family:${serif};font-size:24px;font-weight:700;letter-spacing:4px;color:#211d17;">
                <span style="color:#e5571a;">C</span>&nbsp;COACHING
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#faf5ea;border:1px solid #e0d4bd;border-radius:16px;padding:40px 38px;box-shadow:0 24px 60px -24px rgba(40,30,10,.28);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <tr>
                  <td style="font-family:${sans};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#cc4a12;font-weight:700;padding:0 0 10px;">
                    ${eyebrow}
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${serif};font-size:32px;line-height:1.15;font-weight:700;color:#211d17;padding:0 0 18px;">
                    ${heading}
                  </td>
                </tr>

                <!-- Orange rule with diamond -->
                <tr>
                  <td style="padding:0 0 22px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                      <td style="width:44px;height:2px;background-color:#e5571a;font-size:0;line-height:0;">&nbsp;</td>
                      <td style="padding:0 8px;color:#e5571a;font-size:11px;">&#9670;</td>
                    </tr></table>
                  </td>
                </tr>

                <tr>
                  <td style="font-family:${sans};font-size:16px;line-height:1.7;color:#211d17;padding:0 0 18px;">
                    Hi ${safeBuyer},
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${sans};font-size:16px;line-height:1.7;color:#211d17;padding:0 0 20px;">
                    Thank you for purchasing <strong>C Coaching — Co-Elevate Your Community</strong>.
                    We're honored to have you join the movement.
                  </td>
                </tr>

                ${bodyBlock}

                <tr>
                  <td style="font-family:${sans};font-size:15px;line-height:1.7;color:#4a443b;padding:22px 0 0;border-top:1px solid #e0d4bd;margin-top:8px;">
                    If you have any trouble, just reply to this email — we're glad to help.
                  </td>
                </tr>

                <!-- Signature -->
                <tr>
                  <td style="padding:26px 0 0;">
                    <div style="font-family:${serif};font-size:22px;font-weight:700;color:#211d17;">John Yoon</div>
                    <div style="font-family:${sans};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#4a443b;padding-top:3px;">Coachingtown</div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="font-family:${sans};font-size:12px;color:#8a7f6d;padding:26px 0 8px;">
              &copy; 2026 Coachingtown &middot; C Coaching. All rights reserved.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
