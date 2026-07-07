# C Coaching — 배포 & 자동 발송 연동 가이드

랜딩페이지 + Cafe24 결제완료 → PDF 자동 이메일 발송.

```
landing/
├─ index.html            랜딩페이지 (정적)
├─ assets/               커버·목업 이미지
├─ api/
│  ├─ oauth/authorize.js  앱 설치(인증) 시작
│  ├─ oauth/callback.js   토큰 교환·저장
│  └─ cafe24-webhook.js   결제완료 수신 → 재검증 → PDF 발송
├─ lib/                  cafe24 / tokens(KV) / mailer
└─ .env.example          환경변수 목록
```

---

## A. 랜딩페이지만 먼저 띄우기 (금요일 최소 목표)

1. https://vercel.com 가입 (GitHub 계정 연동 권장)
2. 이 `landing/` 폴더를 **New Project → 폴더 업로드/Import**
3. 배포 → `https://<프로젝트>.vercel.app` 생성
4. 끝. CTA 버튼은 이미 `https://global.bnikoreastore.com/surl/O/848` 로 연결됨.

> ⚠️ 이 단계까지만 해도 **금요일 발표 + 반자동 발송**(fulfillment 키트)으로 판매 가능.

---

## B. 자동 발송까지 켜기 (선택 · PDF 확정 후)

### 1) 외부 준비물 3가지

- **Vercel KV 스토어**: Vercel 프로젝트 → Storage → KV 생성·연결 (토큰/발송기록 저장). 연결하면 `KV_*` 환경변수 자동 주입.
- **Gmail 앱 비밀번호**: `hq@joy-bnikorea.com` 에서 2단계인증 켜고 **앱 비밀번호**(16자리) 발급 → `MAIL_PASS`.
- **PDF 비공개 URL**: 최종 PDF 를 공개 웹루트 밖(Vercel Blob 비공개 / 구글드라이브 등)에 올리고 그 URL → `PDF_SOURCE_URL`.
  - **주의**: PDF 를 `landing/` 안에 넣으면 누구나 다운로드됨. 절대 넣지 말 것.

### 2) 환경변수 등록

Vercel 프로젝트 → Settings → Environment Variables 에 `.env.example` 항목을 모두 입력.
(`CAFE24_CLIENT_SECRET`, `MAIL_PASS` 등 민감값은 여기에만.)

### 3) Cafe24 Redirect URI / Webhook URL 을 실제 도메인으로 수정

Cafe24 개발자센터 → App 관리 → C-Coaching Fulfillment:
- **Redirect URI**: `https://<프로젝트>.vercel.app/api/oauth/callback`
- **이벤트(Webhook) 등록**: `등록` → 결제완료 관련 이벤트 선택 → 수신 URL
  `https://<프로젝트>.vercel.app/api/cafe24-webhook`
- **저장**

### 4) 앱 설치(OAuth 인증) — 최초 1회

브라우저로 접속: `https://<프로젝트>.vercel.app/api/oauth/authorize`
→ 운영자 동의 → "✅ 인증 완료" 화면이 뜨면 토큰이 KV 에 저장됨.

### 5) 테스트

- Cafe24 개발자센터 Webhook 화면의 **TEST** 로 샘플 이벤트 전송 →
  Vercel 함수 로그(`[cafe24-webhook] payload:`)에서 실제 구조 확인.
- 필요하면 `api/cafe24-webhook.js` 의 `extractOrderId` / `paid` 판정 필드를 실제 payload 에 맞게 미세조정.
- 소액 실제 주문 1건으로 end-to-end 확인.

---

## 아직 필요한 입력 (미확정)

- [ ] **최종 PDF** (Mae Anne) → 보안(비밀번호+제한) 적용 후 `PDF_SOURCE_URL`
- [ ] **Gmail 앱 비밀번호** (`hq@joy-bnikorea.com`)
- [ ] **Vercel KV** 스토어 연결
- [ ] Cafe24 **결제완료 이벤트명** 확정 (Webhook 등록 화면에서 선택)

## 참고: 자동/반자동 관계

자동 연동이 켜지기 전까지는 `../fulfillment/` 의 반자동 키트(이메일 템플릿 + 발송 대장)로
운영합니다. 자동이 켜지면 반자동은 **장애 시 백업**으로 유지하세요.
