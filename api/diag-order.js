// [임시 진단] Cafe24 Admin API 연결 + 마지막 웹훅 처리결과 점검. 검증 끝나면 삭제.
//
//  GET /api/diag-order?token=<TEST_TOKEN>                 -> 최근 주문 목록 + 마지막 웹훅 기록
//  GET /api/diag-order?token=<TEST_TOKEN>&order_id=XXXX   -> 단일 주문 필드명 확인(운영 경로)

import { getValidAccessToken, readLastWebhook } from '../lib/tokens.js';

const DIAG_VERSION = 4; // 배포 반영 확인용 마커
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
  return { path, status: res.status, body: text };
}

export default async function handler(req, res) {
  const token = req.query.token || req.headers['x-test-token'];
  if (!process.env.TEST_TOKEN || token !== process.env.TEST_TOKEN) {
    res.status(403).send('forbidden');
    return;
  }

  try {
    const out = { diag_version: DIAG_VERSION, mall: MALL_ID, api_version: API_VERSION };

    // 마지막 웹훅 처리 결과 (실제 테스트 주문 후 여기서 확인)
    out.last_webhook = await readLastWebhook();

    const accessToken = await getValidAccessToken();

    // 최근 30일 주문 목록 — 엔드포인트/스코프/버전 검증
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const listRes = await callCafe24(
      `/api/v2/admin/orders?start_date=${fmt(start)}&end_date=${fmt(end)}&limit=1`,
      accessToken
    );
    out.list = { status: listRes.status, body: listRes.body.slice(0, 400) };

    // order_id 를 주면 단일 주문의 실제 필드명을 추려서 반환
    if (req.query.order_id) {
      const single = await callCafe24(
        `/api/v2/admin/orders/${encodeURIComponent(req.query.order_id)}`,
        accessToken
      );
      out.single = { status: single.status };
      try {
        const order = JSON.parse(single.body).order || {};
        out.single.all_keys = Object.keys(order);
        const picked = {};
        for (const k of Object.keys(order)) {
          if (/email|name|buyer|receiver|orderer|paid|order_id|member/i.test(k)) {
            picked[k] = order[k];
          }
        }
        out.single.candidate_fields = picked;
      } catch (e) {
        out.single.parse_error = String(e);
        out.single.raw = single.body.slice(0, 1500);
      }
    }

    res.status(200).json(out);
  } catch (e) {
    console.error('[diag-order] 실패:', e);
    res.status(500).send('diag error: ' + e.message);
  }
}
