# 구역 관리 앱

구역별 배송 기사 배정을 관리하는 내부 웹 애플리케이션.

## 주요 기능

- 지도 위에서 구역 그리기 및 편집 (주간/야간 수량 관리)
- 고정기사 / 백업기사 등록 및 구역 배정
- 배정 시뮬레이션 (실제 데이터에 영향 없이 시나리오 테스트)
- 지역/캠프 마스터 데이터 관리
- Excel 내보내기/가져오기, 전체 백업/복원

## 기술 스택

| 분류 | 사용 기술 |
|------|----------|
| 프론트엔드 | React 19, Vite |
| 지도 | Leaflet, Turf.js |
| 백엔드/DB | Firebase Firestore, Firebase Auth (Google OAuth) |
| 배포 | Firebase Hosting |

## 실행 방법

```bash
# 의존성 설치 (최초 1회)
npm install

# 환경변수 설정 (최초 1회)
# .env.example을 복사해 .env.local 생성 후 Firebase 키값 입력
cp .env.example .env.local

# 개발 서버 실행
npm run dev
# → http://localhost:5173
```

## 배포 방법

```bash
# 프로덕션 빌드
npm run build

# Firebase Hosting 배포
firebase deploy
```

## 환경변수

`.env.local` 파일에 Firebase 프로젝트 설정값을 입력한다 (`.env.example` 참고).  
이 파일은 Git에서 제외되므로 직접 생성해야 한다.
