# CLAUDE.md

## 나에 대해
- 코드를 모르는 기획자. 기술 용어는 쉽게 설명해줄 것
- 결과물이 어떻게 동작하는지 간단히 설명해줄 것
- 승인 없이 파일 삭제, 대규모 수정 금지. 먼저 물어볼 것

## 프로젝트 개요
- 택배 배송업체 구역/기사 배정 관리 내부 웹앱
- 사용자: 관리자(master), 직원(staff)
- 배포: Firebase Hosting (https://th-zone-data.web.app)

## 기술 스택
- React 19 + Vite
- Firebase (Firestore, Auth, Hosting)
- Leaflet (지도, 폴리곤 그리기)
- 환경변수: .env.local (VITE_FIREBASE_*)

## 프로젝트 구조 원칙
- 상태 관리: App.jsx 중심, Firestore 실시간 구독
- 공통 유틸: src/utils/helpers.js, src/utils/constants.js
- Firestore 저장 전 deepSanitize 필수 (undefined 방지)
- 백업기사 zones는 저장하지 않고 렌더 시 실시간 합산

## 작업 규칙
- 수정 전 반드시 관련 파일 먼저 읽을 것
- 작업 완료 후 npm run build로 빌드 확인
- 빌드 성공 확인 후 변경 파일 목록과 내용 요약해줄 것
- git commit/push는 내가 직접 함
- 배포(firebase deploy)는 내가 직접 함

## CLI/터미널 실행 원칙
- CLI나 터미널로 실행 가능한 작업은 직접 실행할 것
- 콘솔에서 해야 한다고 판단하기 전에 CLI 방법이 있는지 먼저 찾아볼 것
- 방법을 알려주기만 하고 나한테 떠넘기지 말 것
- 실행이 정말 불가능한 경우에만 이유를 설명하고 최소한의 단계로 안내할 것

## 검토/점검 원칙
- 나중에, 해도 그만 안해도 그만이라는 표현 사용 금지
- 문제가 발견되면 지금 바로 해결할 것
- 해결 방법이 없다고 판단하기 전에 다른 방법 먼저 찾아볼 것

## 주의사항
- MapView.jsx는 665줄 대형 컴포넌트. 수정 시 Leaflet 동작 영향 주의
- window.confirm 사용 중 (커스텀 모달 미적용)
- Firebase API 키는 .env.local로 분리됨
- firestore.rules, firestore.indexes.json이 git으로 관리됨
