// OAuth 토큰 영속 저장 + 발송 중복방지 — 저장소로 Vercel Blob(비공개) 재사용.
// (Vercel KV 지원종료 대응: 이미 연결된 Blob 스토어를 그대로 쓰므로 추가 스토어 불필요)
//
// Vercel 함수에서는 BLOB_STORE_ID 로 자동 인증되어 별도 토큰 없이 읽기/쓰기가 된다.
import { put, get } from '@vercel/blob';
import { exchangeCodeForTokens, refreshAccessToken } from './cafe24.js';

const TOKENS_PATH = 'cafe24/tokens.json';
// access_token 만료 60초 전이면 미리 갱신
const SKEW_MS = 60 * 1000;

async function readTokens() {
  const res = await get(TOKENS_PATH, { access: 'private' });
  if (!res) return null;
  const text = await new Response(res.stream).text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeTokens(record) {
  await put(TOKENS_PATH, JSON.stringify(record), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
  });
}

// 발급/갱신 응답을 저장 (만료 시각을 ms 로 계산)
async function persist(tokenResponse) {
  const now = Date.now();
  const record = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    access_expires_at: tokenResponse.expires_at
      ? Date.parse(tokenResponse.expires_at)
      : now + 2 * 60 * 60 * 1000, // 기본 2시간
    refresh_expires_at: tokenResponse.refresh_token_expires_at
      ? Date.parse(tokenResponse.refresh_token_expires_at)
      : now + 14 * 24 * 60 * 60 * 1000, // 기본 2주
    updated_at: now,
  };
  await writeTokens(record);
  return record;
}

// OAuth 콜백에서 최초 1회: code -> 토큰 저장
export async function initFromCode(code) {
  const tokenResponse = await exchangeCodeForTokens(code);
  return persist(tokenResponse);
}

// 웹훅 등에서 호출: 항상 유효한 access_token 반환 (필요하면 자동 갱신)
export async function getValidAccessToken() {
  const record = await readTokens();
  if (!record) {
    throw new Error(
      '저장된 Cafe24 토큰이 없습니다. 먼저 /api/oauth/authorize 로 앱 설치(인증)를 완료하세요.'
    );
  }
  if (Date.now() < record.access_expires_at - SKEW_MS) {
    return record.access_token;
  }
  const refreshed = await refreshAccessToken(record.refresh_token);
  const updated = await persist(refreshed);
  return updated.access_token;
}

// 발송 중복 방지: 주문당 1회만 발송하도록 표시
export async function markSent(orderId) {
  await put(`cafe24/sent/${orderId}`, String(Date.now()), {
    access: 'private',
    contentType: 'text/plain',
    allowOverwrite: true,
  });
}

export async function alreadySent(orderId) {
  const res = await get(`cafe24/sent/${orderId}`, { access: 'private' });
  return res !== null;
}

// [진단] 마지막 웹훅 처리 결과 저장/조회 — Vercel 로그 접근 없이 상태 확인용
const LAST_WEBHOOK_PATH = 'cafe24/last-webhook.json';

export async function saveLastWebhook(record) {
  await put(LAST_WEBHOOK_PATH, JSON.stringify(record), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
  });
}

export async function readLastWebhook() {
  const res = await get(LAST_WEBHOOK_PATH, { access: 'private' });
  if (!res) return null;
  const text = await new Response(res.stream).text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
