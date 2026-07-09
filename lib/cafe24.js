// Cafe24 Admin API 클라이언트 — OAuth 토큰 발급/갱신, 주문 조회
// 문서: https://developers.cafe24.com/docs/api/admin/

const MALL_ID = process.env.CAFE24_MALL_ID;
const CLIENT_ID = process.env.CAFE24_CLIENT_ID;
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET;
const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI;
const API_VERSION = process.env.CAFE24_API_VERSION || '2026-03-01';

const BASE = `https://${MALL_ID}.cafe24api.com`;

// client_id:client_secret 를 base64 로 인코딩한 Basic 인증 헤더
function basicAuthHeader() {
  const raw = `${CLIENT_ID}:${CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

// authorization_code -> access_token / refresh_token 교환
export async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch(`${BASE}/api/v2/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cafe24 token exchange failed (${res.status}): ${text}`);
  }
  return res.json(); // { access_token, refresh_token, expires_at, refresh_token_expires_at, ... }
}

// refresh_token 으로 access_token 재발급 (사용 시 refresh_token 도 갱신됨)
export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(`${BASE}/api/v2/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cafe24 token refresh failed (${res.status}): ${text}`);
  }
  return res.json();
}

// 단일 주문 조회 — 결제상태/구매자 정보 재검증용.
// ⚠️ 구매자 이메일(order.buyer.email)은 embed=buyer 를 붙여야만 응답에 포함된다.
export async function getOrder(accessToken, orderId) {
  const res = await fetch(
    `${BASE}/api/v2/admin/orders/${encodeURIComponent(orderId)}?embed=buyer`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Cafe24-Api-Version': API_VERSION,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cafe24 getOrder failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.order; // { order_id, paid, buyer_email, buyer_name, ... }
}
