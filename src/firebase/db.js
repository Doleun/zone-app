import { db } from './config';
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, onSnapshot,
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
