// 앱 설치(OAuth 인증) 시작 — 이 URL 로 접속하면 Cafe24 동의 화면으로 이동
// 브라우저에서 https://<도메인>/api/oauth/authorize 접속 → 운영자 동의 → callback 으로 code 전달
const MALL_ID = process.env.CAFE24_MALL_ID;
const CLIENT_ID = process.env.CAFE24_CLIENT_ID;
const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI;
const SCOPES = 'mall.read_order,mall.read_customer';

export default function handler(req, res) {
  const state = Math.random().toString(36).slice(2); // CSRF 방지용 (간이)
  const url =
    `https://${MALL_ID}.cafe24api.com/api/v2/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&state=${state}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}`;

  res.writeHead(302, { Location: url });
  res.end();
}
