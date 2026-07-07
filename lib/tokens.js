// OAuth 토큰 영속 저장 (Vercel KV) + 유효한 access_token 확보
// Vercel 대시보드에서 KV 스토어를 프로젝트에 연결하면 자동으로 동작합니다.

import { kv } from '@vercel/kv';
import { exchangeCodeForTokens, refreshAccessToken } from './cafe24.js';

const KEY = `cafe24:tokens:${process.env.CAFE24_MALL_ID}`;
// access_token 만료 60초 전이면 미리 갱신
const SKEW_MS = 60 * 1000;

// 토큰 저장 (발급/갱신 응답을 그대로 저장하되 만료 시각을 ms 로 계산)
async function persist(tokenResponse) {
  const now = Date.now();
  const record = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    // Cafe24 는 expires_at(ISO) 를 주지만, 안전하게 2시간(access) 기본값도 대비
    access_expires_at: tokenResponse.expires_at
      ? Date.parse(tokenResponse.expires_at)
      : now + 2 * 60 * 60 * 1000,
    refresh_expires_at: tokenResponse.refresh_token_expires_at
      ? Date.parse(tokenResponse.refresh_token_expires_at)
      : now + 14 * 24 * 60 * 60 * 1000,
    updated_at: now,
  };
  await kv.set(KEY, record);
  return record;
}

// OAuth 콜백에서 최초 1회: code -> 토큰 저장
export async function initFromCode(code) {
  const tokenResponse = await exchangeCodeForTokens(code);
  return persist(tokenResponse);
}

// 웹훅 등에서 호출: 항상 유효한 access_token 을 반환 (필요하면 자동 갱신)
export async function getValidAccessToken() {
  const record = await kv.get(KEY);
  if (!record) {
    throw new Error(
      '저장된 Cafe24 토큰이 없습니다. 먼저 /api/oauth/authorize 로 앱 설치(인증)를 완료하세요.'
    );
  }

  if (Date.now() < record.access_expires_at - SKEW_MS) {
    return record.access_token; // 아직 유효
  }

  // 만료(임박) → refresh
  const refreshed = await refreshAccessToken(record.refresh_token);
  const updated = await persist(refreshed);
  return updated.access_token;
}

// 발송 중복 방지: 주문당 1회만 발송하도록 표시
export async function markSent(orderId) {
  // 90일 보관
  await kv.set(`cafe24:sent:${orderId}`, Date.now(), { ex: 60 * 60 * 24 * 90 });
}

export async function alreadySent(orderId) {
  return (await kv.get(`cafe24:sent:${orderId}`)) != null;
}
