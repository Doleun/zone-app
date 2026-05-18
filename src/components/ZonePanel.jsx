import { useState, useMemo, useEffect } from 'react';

/* ══════════════════════════════════════
   ZonePanel
   - 지역/캠프/교대 필터
   - 구역 목록 (지역>캠프 그룹, 가나다순)
   - 구역 추가(지도 그리기) / 편집 / 삭제
   - 레이어 전체보기/해제, 개별 가시성
══════════════════════════════════════ */
export default function ZonePanel({
  zones, setZones, drivers,
  regions, camps,
  onSave, showToast, nextColor,
  // 그리기
  drawMode, setDrawMode,
  pendingLatlngs, setPendingLatlngs,
  // 가시성
  hiddenZones, setHiddenZones,
  // 지도 포커스
  setFocusZoneId,
}) {
  /* ── 필터 ── */
  const [filterRegion, setFilterRegion] = useState('');
  const [filterCamp,   setFilterCamp]   = useState('');
  const [filterShift,  setFilterShift]  = useState('');

  /* ── UI 상태 ── */
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [editZone,        setEditZone]        = useState(null);
  const [showModal,       setShowModal]       = useState(false);

  /* ── 모달 폼 ── */
  const [form, setForm] = useState({ region:'', camp:'', name:'', qtyDay:0, qtyNight:0 });

  /* ── pendingLatlngs 완료 시 자동으로 모달 열기 ── */
  useEffect(() => {
    if (pendingLatlngs) {
      setForm({ region:'', camp:'', name:'', qtyDay:0, qtyNight:0 });
      setEditZone(null);
      setShowModal(true);
    }
  }, [pendingLatlngs]);

  /* ── 필터링된 구역 ── */
  const filteredZones = useMemo(() => zones.filter(z => {
    if (filterRegion && z.region !== filterRegion) return false;
    if (filterCamp   && z.camp   !== filterCamp)   return false;
    if (filterShift === 'day'   && (parseInt(z.qtyDay)  ||0) === 0) return false;
    if (filterShift === 'night' && (parseInt(z.qtyNight)||0) === 0) return false;
    return true;
  }), [zones, filterRegion, filterCamp, filterShift]);

  /* ── 필터링된 캠프 ── */
  const filteredCamps = useMemo(() =>
    filterRegion ? camps.filter(c => c.region === filterRegion) : camps,
    [camps, filterRegion]);

  /* ── 그룹 구조 ── */
  const groupedZones = useMemo(() => {
    const grouped = {};
    filteredZones.forEach(z => {
      const key = `${z.region||''}_${z.camp||''}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(z);
    });
    Object.values(grouped).forEach(arr => arr.sort((a,b) => a.name.localeCompare(b.name, 'ko')));
    const sortedKeys = Object.keys(grouped).sort((a,b) => {
      const za = grouped[a][0], zb = grouped[b][0];
      const rA = regions.find(r=>r.id===za.region)?.name||'z';
      const rB = regions.find(r=>r.id===zb.region)?.name||'z';
      if (rA !== rB) return rA.localeCompare(rB,'ko');
      const cA = camps.find(c=>c.id===za.camp)?.name||'z';
      const cB = camps.find(c=>c.id===zb.camp)?.name||'z';
      return cA.localeCompare(cB,'ko');
    });
    return { grouped, sortedKeys };
  }, [filteredZones, regions, camps]);

  /* ── 그룹 레이블 ── */
  const groupLabel = (z) => {
    const rName = regions.find(r=>r.id===z.region)?.name || '미분류';
    const cName = camps.find(c=>c.id===z.camp)?.name     || '미분류';
    return `${rName} > ${cName}`;
  };

  /* ── 가시성 ── */
  const toggleVisibility = (zid) => {
    setHiddenZones(prev => {
      const next = new Set(prev);
      next.has(zid) ? next.delete(zid) : next.add(zid);
      return next;
    });
  };
  const toggleGroupVisibility = (key) => {
    const gZones = groupedZones.grouped[key] || [];
    const allVisible = gZones.every(z => !hiddenZones.has(z.id));
    setHiddenZones(prev => {
      const next = new Set(prev);
      gZones.forEach(z => allVisible ? next.add(z.id) : next.delete(z.id));
      return next;
    });
  };
  const setAllVisibility = (visible) => {
    setHiddenZones(visible ? new Set() : new Set(zones.map(z=>z.id)));
  };

  /* ── 그룹 접기 ── */
  const toggleGroup = (key) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  /* ── 그리기 시작 ── */
  const startDraw = () => {
    if (drawMode) {
      // 그리기 취소
      setDrawMode(false);
      setPendingLatlngs(null);
      showToast('그리기 취소됨');
    } else {
      setPendingLatlngs(null);
      setDrawMode(true);
      showToast('🖊️ 지도에서 클릭하여 점을 추가하세요. 더블클릭으로 완료.');
    }
  };

  /* ── 편집 모달 열기 ── */
  const openEdit = (zone) => {
    setForm({
      region:   zone.region   || '',
      camp:     zone.camp     || '',
      name:     zone.name,
      qtyDay:   zone.qtyDay   != null ? zone.qtyDay   : (zone.qty ?? 0),
      qtyNight: zone.qtyNight != null ? zone.qtyNight : 0,
    });
    setEditZone(zone);
    setShowModal(true);
  };

  /* ── 모달 닫기 ── */
  const closeModal = () => {
    setShowModal(false);
    setEditZone(null);
    // 신규 구역 그리기 취소 시 pendingLatlngs 초기화
    if (!editZone) {
      setPendingLatlngs(null);
    }
  };

  /* ── 저장 ── */
  const saveZone = async () => {
    if (!form.name.trim()) { showToast('구역명을 입력하세요'); return; }
    let newZones;

    if (editZone) {
      /* 편집 */
      newZones = zones.map(z => z.id === editZone.id
        ? { ...z,
            region:   form.region,
            camp:     form.camp,
            name:     form.name.trim(),
            qtyDay:   parseInt(form.qtyDay)   || 0,
            qtyNight: parseInt(form.qtyNight) || 0,
          }
        : z
      );
    } else {
      /* 신규 */
      if (!pendingLatlngs) { showToast('구역을 먼저 지도에서 그려주세요'); return; }
      const newZone = {
        id:       crypto.randomUUID(),
        region:   form.region,
        camp:     form.camp,
        name:     form.name.trim(),
        qtyDay:   parseInt(form.qtyDay)   || 0,
        qtyNight: parseInt(form.qtyNight) || 0,
        color:    nextColor(),
        latlngs:  pendingLatlngs,
      };
      newZones = [...zones, newZone];
      setPendingLatlngs(null);
    }

    setZones(newZones);
    await onSave(newZones, null);
    setShowModal(false);
    setEditZone(null);
    showToast('✅ 저장 완료');
  };

  /* ── 삭제 ── */
  const deleteZone = async (zid) => {
    if (!window.confirm('이 구역을 삭제할까요?')) return;
    const newZones = zones.filter(z => z.id !== zid);
    setZones(newZones);
    await onSave(newZones, null);
    showToast('✅ 삭제 완료');
  };

  /* ── 캠프 옵션 (모달용) ── */
  const modalCamps = form.region ? camps.filter(c=>c.region===form.region) : [];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* 상단 */}
      <div style={{ padding:'10px 10px 8px', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:7 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.8px', textTransform:'uppercase' }}>구역 목록</div>

        {/* 필터 */}
        <div className="filter-row">
          <select className="filter-select" value={filterRegion} onChange={e=>{ setFilterRegion(e.target.value); setFilterCamp(''); }}>
            <option value="">전체 지역</option>
            {regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="filter-select" value={filterCamp} onChange={e=>setFilterCamp(e.target.value)}>
            <option value="">전체 캠프</option>
            {filteredCamps.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="filter-row">
          <select className="filter-select" value={filterShift} onChange={e=>setFilterShift(e.target.value)}>
            <option value="">전체 교대</option>
            <option value="day">☀️ 주간만</option>
            <option value="night">🌙 야간만</option>
          </select>
        </div>

        {/* 레이어 제어 */}
        <div className="layer-ctrl-row">
          <button className="lbtn" onClick={()=>setAllVisibility(true)}>👁 전체보기</button>
          <button className="lbtn" onClick={()=>setAllVisibility(false)}>🚫 전체해제</button>
        </div>

        {/* 구역 그리기 버튼 */}
        <button
          className={`btn ${drawMode ? 'btn-danger' : 'btn-primary'}`}
          style={{ fontSize:12, padding:'7px 0' }}
          onClick={startDraw}
        >
          {drawMode ? '✖ 그리기 취소' : '🖊️ 새 구역 그리기'}
        </button>
      </div>

      {/* 목록 */}
      <div className="sb-list">
        {groupedZones.sortedKeys.length === 0
          ? (
            <div className="empty">
              <div className="empty-icon">🗺️</div>
              <div className="empty-text">구역이 없습니다.<br/>아래 버튼으로 그려주세요.</div>
            </div>
          )
          : groupedZones.sortedKeys.map(key => {
            const gZones  = groupedZones.grouped[key];
            const isOpen  = collapsedGroups[key] !== true;
            const allVis  = gZones.every(z=>!hiddenZones.has(z.id));
            return (
              <div key={key}>
                <div className="group-header" onClick={()=>toggleGroup(key)}>
                  <span className={`group-arrow ${isOpen?'open':''}`}>▶</span>
                  <span className="group-name">📁 {groupLabel(gZones[0])}</span>
                  <span className="group-count">{gZones.length}</span>
                  <button className="group-eye" onClick={e=>{e.stopPropagation();toggleGroupVisibility(key);}}>
                    {allVis?'👁':'🚫'}
                  </button>
                </div>
                {isOpen && (
                  <div className="group-body">
                    {gZones.map(z => {
                      const hidden = hiddenZones.has(z.id);
                      const day    = parseInt(z.qtyDay   != null ? z.qtyDay   : (z.qty??0))||0;
                      const night  = parseInt(z.qtyNight != null ? z.qtyNight : 0)||0;
                      return (
                        <div key={z.id} className={`item${hidden?' zone-hidden':''}`}
                          onClick={() => setFocusZoneId({ id: z.id, ts: Date.now() })}
                          style={{ cursor:'pointer' }}
                        >
                          <div className="color-dot" style={{ background:z.color }} />
                          <div className="item-body">
                            <div className="item-name">{z.name}</div>
                            <div className="item-sub">☀️{day} / 🌙{night}</div>
                          </div>
                          <div className="item-actions">
                            <button className="icon-btn" onClick={()=>toggleVisibility(z.id)}>
                              {hidden?'🚫':'👁'}
                            </button>
                            <button className="icon-btn" onClick={()=>openEdit(z)}>✏️</button>
                            <button className="icon-btn red" onClick={()=>deleteZone(z.id)}>🗑️</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        }
      </div>

      {/* 구역 모달 (편집 / 신규) */}
      {showModal && (
        <div className="overlay">
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">{editZone ? '구역 편집' : '새 구역 정보 입력'}</div>

            {!editZone && (
              <div style={{ background:'var(--surface2)', borderRadius:6, padding:'8px 10px', fontSize:11, color:'var(--text2)', marginBottom:10, lineHeight:1.6 }}>
                ✅ 폴리곤 그리기 완료. 구역 정보를 입력하고 저장하세요.
              </div>
            )}

            <div className="field">
              <label className="field-label">지역</label>
              <select className="field-input" value={form.region}
                onChange={e=>setForm(f=>({...f, region:e.target.value, camp:''}))}>
                <option value="">지역 선택</option>
                {regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            <div className="field">
              <label className="field-label">캠프</label>
              <select className="field-input" value={form.camp}
                onChange={e=>setForm(f=>({...f, camp:e.target.value}))}>
                <option value="">캠프 선택</option>
                {modalCamps.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="field">
              <label className="field-label">구역명</label>
              <input className="field-input" value={form.name} placeholder="예: 103A"
                onChange={e=>setForm(f=>({...f,name:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&saveZone()} />
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <div className="field" style={{ flex:1 }}>
                <label className="field-label">☀️ 주간 수량</label>
                <input className="field-input" type="number" min="0" value={form.qtyDay}
                  onChange={e=>setForm(f=>({...f,qtyDay:e.target.value}))} />
              </div>
              <div className="field" style={{ flex:1 }}>
                <label className="field-label">🌙 야간 수량</label>
                <input className="field-input" type="number" min="0" value={form.qtyNight}
                  onChange={e=>setForm(f=>({...f,qtyNight:e.target.value}))} />
              </div>
            </div>

            <div className="modal-btns">
              <button className="btn btn-secondary" onClick={closeModal}>취소</button>
              <button className="btn btn-primary" onClick={saveZone}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
