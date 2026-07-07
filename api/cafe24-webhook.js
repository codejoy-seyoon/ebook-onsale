// Cafe24 주문/결제 웹훅 수신 → 결제완료 재검증 → 구매자에게 PDF 자동 발송
//
// 보안 원칙: 웹훅 본문을 그대로 믿지 않고, order_id 로 Admin API 를 다시 호출해
// 실제 "결제완료" 주문인지 재검증한 뒤에만 발송한다. (위조 웹훅 방어)

import { getValidAccessToken, markSent, alreadySent } from '../../lib/tokens.js';
import { getOrder } from '../../lib/cafe24.js';
import { sendEbookEmail } from '../../lib/mailer.js';

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

export default async function handler(req, res) {
  // Cafe24 는 POST 로 이벤트를 보냄
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // 본문 파싱 (Vercel 이 JSON 자동 파싱하지만, 문자열로 올 경우도 대비)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // 최초 연동 시 실제 payload 구조 확인용 로그 (Vercel > 함수 로그에서 확인)
  console.log('[cafe24-webhook] payload:', JSON.stringify(body));

  // Cafe24 는 재전송을 하므로, 무거운 작업 실패해도 200 을 빠르게 주는 편이 안전.
  // 단, 발송 성공/실패는 로그로 남긴다.
  try {
    const orderId = extractOrderId(body);
    if (!orderId) {
      console.warn('[cafe24-webhook] order_id 를 찾지 못함');
      res.status(200).send('no order_id');
      return;
    }

    if (await alreadySent(orderId)) {
      console.log(`[cafe24-webhook] 이미 발송된 주문: ${orderId}`);
      res.status(200).send('already sent');
      return;
    }

    // ── 재검증: Admin API 로 주문 조회 ──
    const accessToken = await getValidAccessToken();
    const order = await getOrder(accessToken, orderId);

    // 결제완료 여부 확인 (실 payload 로 필드 확정 후 필요시 조정)
    const paid = order?.paid === 'T' || order?.paid === true;
    if (!paid) {
      console.log(`[cafe24-webhook] 미결제 주문(스킵): ${orderId}, paid=${order?.paid}`);
      res.status(200).send('not paid');
      return;
    }

    const to = order.buyer_email;
    const name = order.buyer_name;
    if (!to) {
      console.error(`[cafe24-webhook] 구매자 이메일 없음: ${orderId}`);
      res.status(200).send('no buyer email');
      return;
    }

    await sendEbookEmail({ to, name });
    await markSent(orderId);
    console.log(`[cafe24-webhook] 발송 완료: ${orderId} -> ${to}`);

    res.status(200).send('ok');
  } catch (e) {
    console.error('[cafe24-webhook] 처리 실패:', e);
    // 200 을 주면 Cafe24 재전송이 멈추므로, 실패 시 500 으로 재전송 유도
    res.status(500).send('error: ' + e.message);
  }
}
