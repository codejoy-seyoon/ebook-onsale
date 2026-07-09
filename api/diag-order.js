// [임시 진단] Cafe24 Admin API 연결 + 마지막 웹훅 처리결과 점검. 검증 끝나면 삭제.
//
//  GET /api/diag-order?token=<TEST_TOKEN>                 -> 최근 주문 목록 + 마지막 웹훅 기록
//  GET /api/diag-order?token=<TEST_TOKEN>&order_id=XXXX   -> 단일 주문 필드명 확인(운영 경로)

import { getValidAccessToken, readLastWebhook } from '../lib/tokens.js';

const DIAG_VERSION = 6; // 배포 반영 확인용 마커
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

    // 주문 폴링 설계용 프로브: 최근 N일 주문을 embed=items,buyer 로 받아 상품번호/이메일 구조 확인
    if (req.query.probe === 'orders') {
      const days = Math.min(parseInt(req.query.days || '7', 10) || 7, 90);
      const s2 = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      const pr = await callCafe24(
        `/api/v2/admin/orders?start_date=${fmt(s2)}&end_date=${fmt(end)}&embed=items,buyer&limit=20`,
        accessToken
      );
      out.probe = { status: pr.status };
      try {
        const orders = JSON.parse(pr.body).orders || [];
        const mask = (e) => (e && e.includes('@') ? e.replace(/(.).*(@.*)/, '$1***$2') : e);
        out.probe.count = orders.length;
        out.probe.orders = orders.map((o) => ({
          order_id: o.order_id,
          shop_no: o.shop_no,
          paid: o.paid,
          buyer_email: mask(o.buyer?.email || null),
          items: (o.items || []).map((it) => ({ product_no: it.product_no, name: it.product_name })),
        }));
      } catch (e) {
        out.probe.parse_error = String(e);
        out.probe.raw = pr.body.slice(0, 800);
      }
    }

    // order_id 를 주면 단일 주문 조회. embed 로 연락처 포함 여부 확인.
    if (req.query.order_id) {
      const embed = req.query.embed ? `?embed=${encodeURIComponent(req.query.embed)}` : '';
      const single = await callCafe24(
        `/api/v2/admin/orders/${encodeURIComponent(req.query.order_id)}${embed}`,
        accessToken
      );
      out.single = { status: single.status, embed: req.query.embed || null };
      try {
        const parsed = JSON.parse(single.body);
        const order = parsed.order || {};
        out.single.top_level_keys = Object.keys(order);
        // 응답 전체에서 이메일('@' 포함 문자열)이 담긴 경로를 재귀로 찾는다
        const emails = [];
        const walk = (node, path) => {
          if (node == null) return;
          if (typeof node === 'string') {
            if (/@/.test(node) && /\./.test(node)) emails.push({ path, value: node });
          } else if (Array.isArray(node)) {
            node.forEach((v, i) => walk(v, `${path}[${i}]`));
          } else if (typeof node === 'object') {
            for (const k of Object.keys(node)) walk(node[k], path ? `${path}.${k}` : k);
          }
        };
        walk(parsed, '');
        out.single.emails_found = emails;
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
