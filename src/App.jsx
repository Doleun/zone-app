import { useState, useEffect, useCallback } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase/config';
import {
  subscribeData, saveData,
  subscribeRegions, subscribeCamps,
  subscribeUsers, getUserDoc,
} from './firebase/db';
import Header from './components/Header';
import ZonePanel from './components/ZonePanel';
import DriverRegPanel from './components/DriverRegPanel';
import AssignPanel from './components/AssignPanel';
import RegionCampPanel from './components/RegionCampPanel';
import MapView from './components/MapView';
import Toast from './components/Toast';
import './index.css';

/* ══════════════════════════════════════
   색상 팔레트
══════════════════════════════════════ */
export const ZONE_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#06b6d4','#a3e635',
  '#f43f5e','#fb923c','#10b981','#38bdf8','#a78bfa',
];
export const DRIVER_COLORS = [
  '#f97316','#3b82f6','#22c55e','#ec4899',
  '#8b5cf6','#14b8a6','#eab308','#ef4444',
];

export default function App() {
  /* ── 인증 상태 ── */
  const [authState, setAuthState] = useState('loading');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState(null);

  /* ── 데이터 ── */
  const [zones,   setZones]   = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [camps,   setCamps]   = useState([]);
  const [users,   setUsers]   = useState([]);

  /* ── UI 상태 ── */
  const [curTab,           setCurTab]           = useState('zone');
  const [saveState,        setSaveState]        = useState('');
  const [toast,            setToast]            = useState(null);
  const [colorIndex,       setColorIndex]       = useState(0);
  const [selectedDriverId, setSelectedDriverId] = useState(null);

  /* ── 구역 그리기 상태 ── */
  const [drawMode,       setDrawMode]       = useState(false);
  const [pendingLatlngs, setPendingLatlngs] = useState(null); // 완료된 폴리곤 좌표

  /* ── 구역 가시성 ── */
  const [hiddenZones, setHiddenZones] = useState(new Set());

  /* ── 구역 포커스 (목록 클릭 시 지도 이동) ── */
  const [focusZoneId, setFocusZoneId] = useState(null);

  /* ── 기사 포커스 (하이라이트 트리거) ── */
  const [focusDriverId, setFocusDriverId] = useState(null);

  /* ── 인증 ── */
  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (!user) { setAuthState('login'); return; }
      const snap = await getUserDoc(user.email);
      if (!snap.exists()) { setAuthState('denied'); return; }
      const role = snap.data().role;
      setCurrentUser(user);
      setCurrentRole(role);
      setAuthState('app');
    });
  }, []);

  /* ── 데이터 구독 ── */
  useEffect(() => {
    if (authState !== 'app') return;
    const unsub1 = subscribeData(({ zones: z, drivers: d }) => {
      setZones(z);
      setDrivers(d);
      setColorIndex(z.length);
      setSaveState('saved');
    });
    const unsub2 = subscribeRegions(setRegions);
    const unsub3 = subscribeCamps(setCamps);
    const unsub4 = subscribeUsers(setUsers);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [authState]);

  /* ── 저장 ── */
  const handleSave = useCallback(async (newZones, newDrivers) => {
    setSaveState('saving');
    try {
      await saveData(newZones ?? zones, newDrivers ?? drivers);
    } catch(e) {
      showToast('❌ 저장 실패: ' + e.message);
      setSaveState('');
    }
  }, [zones, drivers]);

  /* ── 토스트 ── */
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  /* ── 다음 색상 ── */
  const nextColor = useCallback(() => {
    const color = ZONE_COLORS[colorIndex % ZONE_COLORS.length];
    setColorIndex(prev => prev + 1);
    return color;
  }, [colorIndex]);

  /* ── 그리기 완료 콜백 ── */
  const handleDrawComplete = useCallback((latlngs) => {
    setPendingLatlngs(latlngs);
    setDrawMode(false);
  }, []);

  /* ── 배송구역 탭: 지도에서 구역 토글 ── */
  const handleAssignZoneToggle = useCallback(async (zoneId) => {
    if (!selectedDriverId) return;
    const currentDriver = drivers.find(d => d.id === selectedDriverId);
    const isAssigned = (currentDriver?.zones || []).includes(zoneId);

    // 미배정 → 다른 기사가 이미 배정한 구역이면 차단
    if (!isAssigned) {
      const otherDriver = drivers.find(d =>
        d.id !== selectedDriverId &&
        d.type === 'fixed' &&
        d.shift === currentDriver?.shift &&
        (d.zones || []).includes(zoneId)
      );
      if (otherDriver) {
        showToast(`❌ ${otherDriver.name}에게 배정된 구역입니다`);
        return;
      }
    }

    const newDrivers = drivers.map(d => {
      if (d.id !== selectedDriverId) return d;
      const newZones = isAssigned
        ? (d.zones || []).filter(id => id !== zoneId)
        : [...(d.zones || []), zoneId];
      // 구역 전부 해제되면 레이블 위치 초기화
      const labelPos = newZones.length === 0 ? null : d.labelPos;
      return { ...d, zones: newZones, labelPos };
    });
    setDrivers(newDrivers);
    await handleSave(null, newDrivers);
  }, [selectedDriverId, drivers, handleSave, showToast]);

  /* ── 탭 전환 시 그리기 모드 해제 ── */
  useEffect(() => {
    if (drawMode) {
      setDrawMode(false);
      setPendingLatlngs(null);
    }
  }, [curTab]);

  /* ── 로그인/로그아웃 ── */
  const googleLogin = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch(e) { if (e.code !== 'auth/popup-closed-by-user') showToast('❌ 로그인 실패'); }
  };
  const logout = () => signOut(auth);

  /* ── 공통 props ── */
  const commonProps = {
    zones, setZones, drivers, setDrivers,
    regions, camps, users,
    currentUser, currentRole,
    onSave: handleSave,
    showToast, nextColor,
    DRIVER_COLORS,
  };

  /* ── 로딩 ── */
  if (authState === 'loading') return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <div style={{ fontSize:12, color:'var(--text2)' }}>로딩 중...</div>
    </div>
  );

  /* ── 로그인 ── */
  if (authState === 'login') return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">📦</div>
        <div className="login-title">구역 관리</div>
        <div className="login-sub">Google 계정으로 로그인하세요.</div>
        <button className="google-btn" onClick={googleLogin}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google로 로그인
        </button>
      </div>
    </div>
  );

  /* ── 접근 거부 ── */
  if (authState === 'denied') return (
    <div className="denied-screen">
      <div className="denied-box">
        <div style={{ fontSize:40, marginBottom:14 }}>🚫</div>
        <div style={{ fontSize:16, fontWeight:800, marginBottom:8 }}>접근 권한 없음</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:20 }}>
          허가된 계정만 사용할 수 있습니다.
        </div>
        <button className="btn btn-secondary" style={{ width:'auto', padding:'8px 20px' }} onClick={logout}>
          다른 계정으로 로그인
        </button>
      </div>
    </div>
  );

  /* ── 메인 앱 ── */
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh' }}>
      <Header
        curTab={curTab}
        setCurTab={setCurTab}
        currentUser={currentUser}
        currentRole={currentRole}
        saveState={saveState}
        zones={zones}
        drivers={drivers}
        regions={regions}
        camps={camps}
        users={users}
        onSave={handleSave}
        showToast={showToast}
        logout={logout}
      />

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {/* 사이드바 */}
        <div style={{
          width:290, background:'var(--sidebar)',
          borderRight:'1px solid var(--border)',
          display:'flex', flexDirection:'column',
          flexShrink:0, overflow:'hidden',
        }}>
          {curTab === 'zone'   && <ZonePanel
            {...commonProps}
            drawMode={drawMode}
            setDrawMode={setDrawMode}
            pendingLatlngs={pendingLatlngs}
            setPendingLatlngs={setPendingLatlngs}
            hiddenZones={hiddenZones}
            setHiddenZones={setHiddenZones}
            setFocusZoneId={setFocusZoneId}
          />}
          {curTab === 'drvreg' && <DriverRegPanel    {...commonProps} />}
          {curTab === 'assign' && <AssignPanel
            {...commonProps}
            selectedDriverId={selectedDriverId}
            setSelectedDriverId={(id) => {
              setSelectedDriverId(id);
              if (id) setFocusDriverId({ id, ts: Date.now() });
            }}
          />}
          {curTab === 'rc'     && <RegionCampPanel   {...commonProps} />}
        </div>

        {/* 지도 */}
        <MapView
          curTab={curTab}
          zones={zones}
          drivers={drivers}
          regions={regions}
          camps={camps}
          onSave={handleSave}
          showToast={showToast}
          nextColor={nextColor}
          setZones={setZones}
          setDrivers={setDrivers}
          selectedDriverId={selectedDriverId}
          setSelectedDriverId={(id) => {
              setSelectedDriverId(id);
              if (id) setFocusDriverId({ id, ts: Date.now() });
            }}
          drawMode={drawMode}
          onDrawComplete={handleDrawComplete}
          pendingLatlngs={pendingLatlngs}
          hiddenZones={hiddenZones}
          focusZoneId={focusZoneId}
          setFocusZoneId={setFocusZoneId}
          focusDriverId={focusDriverId}
          onAssignZoneToggle={handleAssignZoneToggle}
        />
      </div>

      {toast && <Toast msg={toast} />}
    </div>
  );
}
