// Cafe24 주문/결제 웹훅 수신 → 결제완료 재검증 → 구매자에게 PDF 자동 발송
//
// 보안 원칙: 웹훅 본문을 그대로 믿지 않고, order_id 로 Admin API 를 다시 호출해
// 실제 "결제완료" 주문인지 재검증한 뒤에만 발송한다. (위조 웹훅 방어)

import { getValidAccessToken, markSent, alreadySent, saveLastWebhook } from '../lib/tokens.js';
import { getOrder } from '../lib/cafe24.js';
import { sendEbookEmail } from '../lib/mailer.js';

// 웹훅 본문에서 order_id 를 최대한 견고하게 추출
function extractOrderId(body) {
  if (!body) return null;
  const r = body.resource || body;
  return (
    r.order_id ||
    r.order_number ||
    (Array.isArray(r.orders) && r.orders[0]?.order_id) ||
    null
  );
}

// Cafe24 주문 응답은 회원/비회원/버전에 따라 이메일·이름 필드명이 다르다.
// (member_email, buyer_email, order_email, receivers[].email 등) → 후보를 모두 시도.
function pickEmail(order) {
  if (!order) return null;
  const first = (arr, key) =>
    Array.isArray(arr) ? arr.map((x) => x?.[key]).find(Boolean) : null;
  return (
    order.buyer?.email || // embed=buyer 로 오는 실제 구매자 이메일 (주 경로)
    order.buyer_email ||
    order.member_email ||
    order.order_email ||
    order.email ||
    first(order.receivers, 'email') ||
    null
  );
}

function pickName(order) {
  if (!order) return 'Customer';
  const first = (arr, key) =>
    Array.isArray(arr) ? arr.map((x) => x?.[key]).find(Boolean) : null;
  return (
    order.buyer?.name ||
    order.buyer_name ||
    order.billing_name ||
    order.member_name ||
    first(order.receivers, 'name') ||
    'Customer'
  );
}

// 결제완료 여부 (회원/비회원·버전별 표현 차이 흡수)
function isPaid(order) {
  return order?.paid === 'T' || order?.paid === true || order?.paid === 'Y';
}

export default async function handler(req, res) {
  // Cafe24 는 결제 이벤트를 POST 로 보낸다.
  // 단, 등록 시 URL 검증(GET/HEAD)이나 브라우저 접속에는 200 으로 응답해
  // "Method Not Allowed" 로 등록이 막히지 않게 한다. (실제 발송은 POST 에서만)
  if (req.method !== 'POST') {
    res.status(200).send('cafe24-webhook alive (POST only for events)');
    return;
  }

  // 본문 파싱 (Vercel 이 JSON 자동 파싱하지만, 문자열로 올 경우도 대비)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // 최초 연동 시 실제 payload 구조 확인용 로그 (Vercel > 함수 로그에서 확인)
  console.log('[cafe24-webhook] payload:', JSON.stringify(body));

  // Vercel 로그 접근 없이도 마지막 처리 결과를 확인할 수 있도록 Blob 에 진단 기록을 남긴다.
  // (이메일은 마스킹, 원문 payload 키만 저장 → 민감정보 최소화)
  const debug = {
    at: new Date().toISOString(),
    method: req.method,
    payload_keys: body && typeof body === 'object' ? Object.keys(body) : [],
    resource_keys:
      body?.resource && typeof body.resource === 'object'
        ? Object.keys(body.resource)
        : [],
  };
  const mask = (e) =>
    typeof e === 'string' && e.includes('@')
      ? e.replace(/(.).*(@.*)/, '$1***$2')
      : e;
  const finish = async (status, note) => {
    debug.result = note;
    try {
      await saveLastWebhook(debug);
    } catch (_) {}
    res.status(status).send(note);
  };

  try {
    const orderId = extractOrderId(body);
    debug.order_id = orderId;
    if (!orderId) {
      console.warn('[cafe24-webhook] order_id 를 찾지 못함');
      await finish(200, 'no order_id');
      return;
    }

    if (await alreadySent(orderId)) {
      console.log(`[cafe24-webhook] 이미 발송된 주문: ${orderId}`);
      await finish(200, 'already sent');
      return;
    }

    // ── 재검증: Admin API 로 주문 조회 ──
    const accessToken = await getValidAccessToken();
    const order = await getOrder(accessToken, orderId);
    debug.order_keys = order ? Object.keys(order) : null;
    debug.paid = order?.paid;

    if (!isPaid(order)) {
      console.log(`[cafe24-webhook] 미결제 주문(스킵): ${orderId}, paid=${order?.paid}`);
      await finish(200, 'not paid');
      return;
    }

    const to = pickEmail(order);
    const name = pickName(order);
    debug.email_found = mask(to);
    debug.name_found = name;
    if (!to) {
      console.error(`[cafe24-webhook] 구매자 이메일 없음: ${orderId}`);
      await finish(200, 'no buyer email');
      return;
    }

    await sendEbookEmail({ to, name });
    await markSent(orderId);
    console.log(`[cafe24-webhook] 발송 완료: ${orderId} -> ${to}`);

    await finish(200, 'ok');
  } catch (e) {
    console.error('[cafe24-webhook] 처리 실패:', e);
    debug.error = String(e?.message || e);
    // 200 을 주면 Cafe24 재전송이 멈추므로, 실패 시 500 으로 재전송 유도
    await finish(500, 'error: ' + (e?.message || e));
  }
}
