import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/* ══════════════════════════════════════
   Firebase 설정
   이전 시 localStorage 저장값 우선 적용
══════════════════════════════════════ */
const DEFAULT_CONFIG = {
  apiKey:            "AIzaSyAbUYtqA0u0i43TDPx2dpyHtIaoaoWpt3U",
  authDomain:        "th-zone-data.firebaseapp.com",
  projectId:         "th-zone-data",
  storageBucket:     "th-zone-data.firebasestorage.app",
  messagingSenderId: "343505822539",
  appId:             "1:343505822539:web:019ff20fef00b042033ece",
};

let firebaseConfig = DEFAULT_CONFIG;
try {
  const saved = localStorage.getItem('zone-firebase-config');
  if (saved) firebaseConfig = JSON.parse(saved);
} catch(e) {}

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export { DEFAULT_CONFIG };
