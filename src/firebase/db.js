import { db } from './config';
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, onSnapshot,
  addDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';

/* ══════════════════════════════════════
   구역·기사 데이터
══════════════════════════════════════ */
export const subscribeData = (callback) =>
  onSnapshot(doc(db, 'data', 'main'), snapshot => {
    const d = snapshot.exists() ? snapshot.data() : {};
    callback({ zones: d.zones || [], drivers: d.drivers || [] });
  });

export const saveData = (zones, drivers) =>
  setDoc(doc(db, 'data', 'main'), { zones, drivers });

/* ══════════════════════════════════════
   지역
══════════════════════════════════════ */
export const subscribeRegions = (callback) =>
  onSnapshot(collection(db, 'regions'), snapshot => {
    const regions = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    callback(regions);
  });

export const addRegion = (name, order) =>
  setDoc(doc(db, 'regions', 'region_' + Date.now()), { name, order });

export const deleteRegion = (id) =>
  deleteDoc(doc(db, 'regions', id));

/* ══════════════════════════════════════
   캠프
══════════════════════════════════════ */
export const subscribeCamps = (callback) =>
  onSnapshot(collection(db, 'camps'), snapshot => {
    const camps = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    callback(camps);
  });

export const addCamp = (name, regionId, order) =>
  setDoc(doc(db, 'camps', 'camp_' + Date.now()), { name, region: regionId, order });

export const deleteCamp = (id) =>
  deleteDoc(doc(db, 'camps', id));

/* ══════════════════════════════════════
   사용자
══════════════════════════════════════ */
export const subscribeUsers = (callback) =>
  onSnapshot(collection(db, 'users'), snapshot => {
    callback(snapshot.docs.map(d => ({ email: d.id, ...d.data() })));
  });

export const getUserDoc = (email) =>
  getDoc(doc(db, 'users', email));

export const setUserDoc = (email, data) =>
  setDoc(doc(db, 'users', email), data);

export const deleteUserDoc = (email) =>
  deleteDoc(doc(db, 'users', email));

/* ══════════════════════════════════════
   백업/복원
══════════════════════════════════════ */
export const getAllForBackup = async () => {
  const [usersSnap, regSnap, campSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'regions')),
    getDocs(collection(db, 'camps')),
  ]);
  return {
    users:   usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    regions: regSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    camps:   campSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
};

export const restoreBackup = async (backup) => {
  await setDoc(doc(db, 'data', 'main'), { zones: backup.zones, drivers: backup.drivers });
  for (const u of (backup.users   || [])) { const { id, ...d } = u; await setDoc(doc(db, 'users',   id), d); }
  for (const r of (backup.regions || [])) { const { id, ...d } = r; await setDoc(doc(db, 'regions', id), d); }
  for (const c of (backup.camps   || [])) { const { id, ...d } = c; await setDoc(doc(db, 'camps',   id), d); }
};

/* ══════════════════════════════════════
   시뮬레이션
   simulations/{simId} → {
     name, scope: { regions[], camps[] },
     createdAt, createdBy,
     drivers[],   ← 시뮬 전용 기사 (추가/삭제 가능)
   }
══════════════════════════════════════ */

/** 시뮬 목록 실시간 구독 */
export const subscribeSimulations = (callback) =>
  onSnapshot(collection(db, 'simulations'), snapshot => {
    const sims = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta; // 최신순
      });
    callback(sims);
  });

/** 시뮬 생성 */
export const createSimulation = async ({ name, scope, createdBy }) => {
  const ref = await addDoc(collection(db, 'simulations'), {
    name,
    scope,        // { regions: [], camps: [] }
    drivers: [],  // 시뮬 전용 기사 목록
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
};

/** 시뮬 업데이트 (drivers 배정 등) */
export const updateSimulation = (simId, data) =>
  updateDoc(doc(db, 'simulations', simId), data);

/** 시뮬 삭제 */
export const deleteSimulation = (simId) =>
  deleteDoc(doc(db, 'simulations', simId));

/** 시뮬 단건 조회 */
export const getSimulation = (simId) =>
  getDoc(doc(db, 'simulations', simId));

/** 시뮬 → 실제 데이터 적용 (drivers만 scope 범위 내 교체) */
export const applySimulation = async (sim, realDrivers) => {
  const { scope, drivers: simDrivers } = sim;
  const scopeCamps = new Set(scope?.camps || []);

  // scope 범위 밖 실제 기사는 유지, 범위 안은 시뮬 기사로 교체
  const outsideDrivers = realDrivers.filter(d => {
    const driverCamp = d.type === 'fixed' ? d.camp : null;
    const driverCamps = d.type === 'backup' ? (d.camps || []) : [];
    if (d.type === 'fixed')  return !scopeCamps.has(driverCamp);
    if (d.type === 'backup') return !driverCamps.some(c => scopeCamps.has(c));
    return true;
  });

  const newDrivers = [...outsideDrivers, ...simDrivers];
  await setDoc(doc(db, 'data', 'main'), { zones: undefined }, { merge: true });
  await updateDoc(doc(db, 'data', 'main'), { drivers: newDrivers });
};
