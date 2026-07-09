// [임시 진단] Cafe24 Admin API 연결 점검 — 실제 결제 전, 토큰/스코프/버전/엔드포인트가
// 모두 맞는지 order_id 없이도 확인한다. 검증이 끝나면 이 파일은 삭제한다.
//
// 사용:  GET /api/diag-order?token=<TEST_TOKEN>                 -> 최근 주문 목록 조회
//        GET /api/diag-order?token=<TEST_TOKEN>&order_id=XXXX   -> 단일 주문 조회(운영 경로와 동일)

import { getValidAccessToken } from '../lib/tokens.js';

const MALL_ID = process.env.CAFE24_MALL_ID;
const API_VERSION = process.env.CAFE24_API_VERSION || '2026-03-01';
const BASE = `https://${MALL_ID}.cafe24api.com`;

async function callCafe24(path, accessToken) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Cafe24-Api-Version': API_VERSION,
    },
  });
  const text = await res.text();
  return { path, status: res.status, body: text.slice(0, 2000) };
}

export default async function handler(req, res) {
  const token = req.query.token || req.headers['x-test-token'];
  if (!process.env.TEST_TOKEN || token !== process.env.TEST_TOKEN) {
    res.status(403).send('forbidden');
    return;
  }

  try {
    const accessToken = await getValidAccessToken();
    const out = { mall: MALL_ID, api_version: API_VERSION };

    // 1) 최근 30일 주문 목록 — order_id 와 무관하게 엔드포인트/스코프/버전 검증
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    out.list = await callCafe24(
      `/api/v2/admin/orders?start_date=${fmt(start)}&end_date=${fmt(end)}&limit=3`,
      accessToken
    );

    // 2) order_id 를 주면 운영 경로(단일 주문 조회)를 그대로 시험
    if (req.query.order_id) {
      out.single = await callCafe24(
        `/api/v2/admin/orders/${encodeURIComponent(req.query.order_id)}`,
        accessToken
      );
    }

    res.status(200).json(out);
  } catch (e) {
    console.error('[diag-order] 실패:', e);
    res.status(500).send('diag error: ' + e.message);
  }
}
