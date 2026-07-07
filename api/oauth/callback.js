// OAuth 콜백 — Cafe24 가 동의 후 code 를 붙여 이 주소로 리다이렉트함
// code 를 access/refresh 토큰으로 교환하여 KV 에 저장
import { initFromCode } from '../../lib/tokens.js';

export default async function handler(req, res) {
  try {
    const { code, error, error_description } = req.query;

    if (error) {
      res.status(400).send(`OAuth 오류: ${error} - ${error_description || ''}`);
      return;
    }
    if (!code) {
      res.status(400).send('code 파라미터가 없습니다.');
      return;
    }

    await initFromCode(code);

    res
      .status(200)
      .send(
        '✅ Cafe24 앱 설치(인증) 완료. 토큰이 저장되었습니다. 이제 결제 완료 시 자동 발송이 동작합니다. 이 창은 닫아도 됩니다.'
      );
  } catch (e) {
    console.error('[oauth/callback] ', e);
    res.status(500).send('토큰 교환 실패: ' + e.message);
  }
}
