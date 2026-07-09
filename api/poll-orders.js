// ebook 자동발송 — 웹훅 대신 폴링 방식.
// Cafe24 영문몰(shop2)의 결제완료 주문 중 ebook(product_no 848)을 산 건에만,
// 아직 안 보낸 주문에 한해 ebook PDF 이메일을 발송한다. (주문당 1회, 멱등)
//
//  GET /api/poll-orders?token=<POLL_TOKEN>          -> 실제 발송
//  GET /api/poll-orders?token=<POLL_TOKEN>&dry=1    -> 대상만 표시(발송 안 함)
//
// 5분마다 외부 스케줄러(GitHub Actions 등)가 호출한다.

import { withCafe24Token, alreadySent, markSent } from '../lib/tokens.js';
import { getOrder } from '../lib/cafe24.js';
import { sendEbookEmail } from '../lib/mailer.js';

const MALL_ID = process.env.CAFE24_MALL_ID;
const API_VERSION = process.env.CAFE24_API_VERSION || '2026-03-01';
const BASE = `https://${MALL_ID}.cafe24api.com`;

const EBOOK_SHOP_NO = parseInt(process.env.EBOOK_SHOP_NO || '2', 10); // 영문몰
const EBOOK_PRODUCT_NO = parseInt(process.env.EBOOK_PRODUCT_NO || '848', 10); // ebook 상품
const SCAN_DAYS = parseInt(process.env.POLL_SCAN_DAYS || '3', 10); // 최근 N일 재스캔(멱등이라 중복발송 없음)

function isPaid(o) {
  return o?.paid === 'T' || o?.paid === true || o?.paid === 'Y';
}
function hasEbook(o) {
  return (o?.items || []).some((it) => parseInt(it.product_no, 10) === EBOOK_PRODUCT_NO);
}
function pickEmail(o) {
  return o?.buyer?.email || o?.buyer_email || o?.member_email || o?.order_email || null;
}
function pickName(o) {
  return o?.buyer?.name || o?.buyer_name || o?.billing_name || 'Customer';
}

async function listEbookOrders(accessToken, opts = {}) {
  const shopNo = opts.shop || EBOOK_SHOP_NO;
  const days = opts.days || SCAN_DAYS;
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000); // 타임존 여유로 +1일
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url =
    `${BASE}/api/v2/admin/orders?shop_no=${shopNo}` +
    `&start_date=${fmt(start)}&end_date=${fmt(end)}` +
    `&embed=items,buyer&limit=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Cafe24-Api-Version': API_VERSION,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`orders list failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text).orders || [];
}

export default async function handler(req, res) {
  const token = req.query.token || req.headers['x-poll-token'];
  const ok =
    (process.env.POLL_TOKEN && token === process.env.POLL_TOKEN) ||
    (process.env.TEST_TOKEN && token === process.env.TEST_TOKEN);
  if (!ok) {
    res.status(403).send('forbidden');
    return;
  }
  const dry = req.query.dry === '1' || req.query.dry === 'true';

  const summary = { at: new Date().toISOString(), dry, shop_no: EBOOK_SHOP_NO, product_no: EBOOK_PRODUCT_NO, scanned: 0, candidates: [], sent: [], skipped: [], errors: [] };

  try {
    // [검증용] 실제 결제완료 주문 1건을 조회해 전체 발송체인(주문조회→구매자확인→PDF발송)을
    // 실결제 없이 시험한다. to 를 주면 구매자 대신 그 주소로 보냄(실고객 미발송). markSent 안 함.
    if (req.query.test_order_id) {
      const order = await withCafe24Token((t) => getOrder(t, req.query.test_order_id));
      const to = req.query.to || pickEmail(order);
      const t = { order_id: req.query.test_order_id, paid: order?.paid, to: to ? to.replace(/(.).*(@.*)/, '$1***$2') : null };
      if (!isPaid(order)) { t.result = 'not paid (skip)'; }
      else if (!to) { t.result = 'no email'; }
      else if (dry) { t.result = 'dry-run (would send)'; }
      else { await sendEbookEmail({ to, name: pickName(order) }); t.result = 'sent'; }
      summary.test = t;
      res.status(200).json(summary);
      return;
    }

    // 테스트 override (토큰 보호): 넓은 기간/다른 몰 확인용. dry-run 에서만 의미.
    const opts = {};
    if (req.query.days) opts.days = Math.min(parseInt(req.query.days, 10) || SCAN_DAYS, 90);
    if (req.query.shop) opts.shop = parseInt(req.query.shop, 10) || EBOOK_SHOP_NO;
    const orders = await withCafe24Token((t) => listEbookOrders(t, opts));
    summary.scanned = orders.length;
    // 진단: ebook 필터 없이 전체 주문의 상품번호 분포도 보여줌(dry 전용)
    if (dry && req.query.debug === '1') {
      summary.all_orders = orders.slice(0, 30).map((o) => ({
        order_id: o.order_id, shop_no: o.shop_no, paid: o.paid,
        products: (o.items || []).map((it) => parseInt(it.product_no, 10)),
      }));
    }

    for (const o of orders) {
      if (!isPaid(o) || !hasEbook(o)) continue;
      const to = pickEmail(o);
      const entry = { order_id: o.order_id, email: to ? to.replace(/(.).*(@.*)/, '$1***$2') : null };
      summary.candidates.push(entry);

      if (!to) { summary.errors.push({ ...entry, why: 'no email' }); continue; }
      if (await alreadySent(o.order_id)) { summary.skipped.push({ ...entry, why: 'already sent' }); continue; }
      if (dry) { summary.skipped.push({ ...entry, why: 'dry-run (would send)' }); continue; }

      try {
        await sendEbookEmail({ to, name: pickName(o) });
        await markSent(o.order_id);
        summary.sent.push(entry);
      } catch (e) {
        summary.errors.push({ ...entry, why: String(e?.message || e) });
      }
    }

    res.status(200).json(summary);
  } catch (e) {
    summary.errors.push({ fatal: String(e?.message || e) });
    res.status(500).json(summary);
  }
}
