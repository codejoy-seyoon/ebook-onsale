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
    // Cafe24 access_token 은 2시간 유효. expires_at 문자열은 타임존 파싱 이슈로
    // 어긋날 수 있어 신뢰하지 않고, 항상 발급시각+2시간(보수적)으로 저장한다.
    access_expires_at: now + 2 * 60 * 60 * 1000,
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

// 항상 유효한 access_token 반환 (필요하면 자동 갱신).
// force=true 면 만료시각과 무관하게 강제 갱신 (API 401 재시도용).
export async function getValidAccessToken(force = false) {
  const record = await readTokens();
  if (!record) {
    throw new Error(
      '저장된 Cafe24 토큰이 없습니다. 먼저 /api/oauth/authorize 로 앱 설치(인증)를 완료하세요.'
    );
  }
  if (!force && Date.now() < record.access_expires_at - SKEW_MS) {
    return record.access_token;
  }
  const refreshed = await refreshAccessToken(record.refresh_token);
  const updated = await persist(refreshed);
  return updated.access_token;
}

// Cafe24 API 호출을 유효토큰으로 실행하고, 401(만료)면 강제 갱신 후 1회 재시도.
export async function withCafe24Token(fn) {
  let token = await getValidAccessToken();
  try {
    return await fn(token);
  } catch (e) {
    if (String(e?.message || e).includes('(401)')) {
      token = await getValidAccessToken(true);
      return await fn(token);
    }
    throw e;
  }
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
