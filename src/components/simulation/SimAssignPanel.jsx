import { useState, useMemo, useCallback } from 'react';
import CollapsibleSection from '../ui/CollapsibleSection';
import { getQty, getDriverTotal } from '../../utils/helpers';

export default function SimAssignPanel({
  sim,
  zones,
  regions, camps,
  realDrivers,
  onSaveDrivers,
  showToast,
  selectedDriverId, setSelectedDriverId,
}) {
  const simDrivers  = sim?.drivers || [];
  const scopeCamps  = new Set(sim?.scope?.camps  || []);
  const scopeShifts = new Set(sim?.scope?.shifts || ['day', 'night']);

  const scopeZones = useMemo(() =>
    zones.filter(z => scopeCamps.has(z.camp)),
    [zones, sim?.scope?.camps]
  );

  const [filterCamp,  setFilterCamp]  = useState('');
  const [filterShift, setFilterShift] = useState('');
  const [filterType,  setFilterType]  = useState('fixed');
  const [sortMode,    setSortMode]    = useState('name');

  const [showDriverModal, setShowDriverModal] = useState(false);
  const [editDriverId,    setEditDriverId]    = useState(null);
  const [driverForm, setDriverForm] = useState({ name:'', type:'fixed', shift:'day', camp:'', camps:[] });
  const [bulkMode,   setBulkMode]   = useState(false);
  const [bulkCount,  setBulkCount]  = useState(5);
  const [bulkPrefix, setBulkPrefix] = useState('');
  const [bulkStart,  setBulkStart]  = useState('A');

  const scopeCampList = useMemo(() =>
    camps.filter(c => scopeCamps.has(c.id)),
    [camps, sim?.scope?.camps]
  );

  const filteredDrivers = useMemo(() => {
    return simDrivers.filter(d => {
      if (d.type !== filterType) return false;
      if (filterCamp) {
        const match = d.type === 'fixed'
          ? d.camp === filterCamp
          : (d.camps||[]).includes(filterCamp);
        if (!match) return false;
      }
      if (filterShift && (d.shift || 'day') !== filterShift) return false;
      return true;
    });
  }, [simDrivers, filterType, filterCamp, filterShift]);

  const saveDrivers = useCallback(async (newDrivers) => {
    await onSaveDrivers(sim.id, newDrivers);
  }, [sim?.id, onSaveDrivers]);

  /* ── 기사 추가/편집 모달 열기 ── */
  const openDriverModal = (driver = null) => {
    if (driver) {
      /* 편집: 기존 값 그대로 */
      setDriverForm({
        name:  driver.name,
        type:  driver.type  || 'fixed',
        shift: driver.shift || 'day',
        camp:  driver.camp  || '',
        camps: driver.camps || [],
      });
      setEditDriverId(driver.id);
    } else {
      /* 신규: scope 기반 기본값 */
      const defaultShift = scopeShifts.size === 1 ? [...scopeShifts][0] : 'day';
      const defaultCamp  = scopeCampList.length === 1 ? scopeCampList[0].id : '';
      const defaultCamps = scopeCampList.map(c => c.id);
      setDriverForm({ name:'', type:'fixed', shift:defaultShift, camp:defaultCamp, camps:defaultCamps });
      setEditDriverId(null);
      setBulkMode(false);
      setBulkCount(5);
      setBulkPrefix('');
      setBulkStart('A');
    }
    setShowDriverModal(true);
  };

  /* 알파벳 시퀀스 생성 (A=0 기준) */
  const genNames = () => {
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const startIdx = ALPHA.indexOf(bulkStart.toUpperCase());
    const names = [];
    for (let i = 0; i < bulkCount; i++) {
      const idx = (startIdx + i) % 26;
      const cycle = Math.floor((startIdx + i) / 26);
      const suffix = cycle > 0 ? ALPHA[idx] + cycle : ALPHA[idx];
      names.push((bulkPrefix.trim() ? bulkPrefix.trim() : '') + suffix);
    }
    return names;
  };

  const saveDriver = async () => {
    /* 편집 모드 */
    if (editDriverId) {
      if (!driverForm.name.trim()) { showToast('기사 이름을 입력하세요'); return; }
      const newDrivers = simDrivers.map(d => d.id === editDriverId
        ? { ...d, name:driverForm.name.trim(), type:driverForm.type, shift:driverForm.shift, camp:driverForm.camp, camps:driverForm.camps }
        : d
      );
      await saveDrivers(newDrivers);
      setShowDriverModal(false);
      showToast('✅ 저장 완료');
      return;
    }

    /* 일괄 생성 */
    if (bulkMode) {
      if (bulkCount < 1 || bulkCount > 50) { showToast('인원수는 1~50명 사이로 입력하세요'); return; }
      if (!bulkStart.match(/^[A-Za-z]$/)) { showToast('시작 알파벳을 한 글자(A-Z)로 입력하세요'); return; }
      const names = genNames();
      const now = Date.now();
      const added = names.map((name, i) => ({
        id:    'sim_d_' + (now + i),
        name,
        type:  driverForm.type,
        shift: driverForm.shift,
        camp:  driverForm.camp,
        camps: driverForm.camps,
        zones: [],
        labelPos: null,
        selectedFixed: [],
      }));
      await saveDrivers([...simDrivers, ...added]);
      setShowDriverModal(false);
      showToast(`✅ ${added.length}명 생성 완료`);
      return;
    }

    /* 단건 생성 */
    if (!driverForm.name.trim()) { showToast('기사 이름을 입력하세요'); return; }
    const newDrivers = [...simDrivers, {
      id:    'sim_d_' + Date.now(),
      name:  driverForm.name.trim(),
      type:  driverForm.type,
      shift: driverForm.shift,
      camp:  driverForm.camp,
      camps: driverForm.camps,
      zones: [],
      labelPos: null,
      selectedFixed: [],
    }];
    await saveDrivers(newDrivers);
    setShowDriverModal(false);
    showToast('✅ 저장 완료');
  };

  const deleteDriver = async (did) => {
    if (!window.confirm('이 기사를 삭제할까요?')) return;
    const remaining = simDrivers.filter(d => d.id !== did);
    const newDrivers = remaining.map(d => {
      if (d.type !== 'backup') return d;
      const newSel = (d.selectedFixed||[]).filter(id => id !== did);
      if (newSel.length === (d.selectedFixed||[]).length) return d;
      const allZoneIds = newSel.length > 0
        ? [...new Set(remaining.filter(fd => newSel.includes(fd.id)).flatMap(fd => fd.zones||[]))]
        : [];
      return { ...d, selectedFixed: newSel, zones: allZoneIds, labelPos: allZoneIds.length === 0 ? null : d.labelPos };
    });
    await saveDrivers(newDrivers);
    showToast('✅ 삭제 완료');
  };

  const onZoneCheck = async (did, zid, checked) => {
    const newDrivers = simDrivers.map(d => {
      if (d.id !== did) return d;
      const newZones = checked
        ? [...(d.zones||[]), zid]
        : (d.zones||[]).filter(id => id !== zid);
      return { ...d, zones: newZones, labelPos: newZones.length === 0 ? null : d.labelPos };
    });
    await saveDrivers(newDrivers);
  };

  const onBackupFixedChange = async (backupId, fixedId, checked) => {
    const backup = simDrivers.find(d => d.id === backupId);
    const sel = checked
      ? [...(backup?.selectedFixed||[]), fixedId]
      : (backup?.selectedFixed||[]).filter(id => id !== fixedId);
    const allZoneIds = sel.length > 0
      ? [...new Set(simDrivers.filter(d => sel.includes(d.id)).flatMap(d => d.zones||[]))]
      : [];
    const newDrivers = simDrivers.map(d =>
      d.id === backupId ? { ...d, selectedFixed: sel, zones: allZoneIds } : d
    );
    await saveDrivers(newDrivers);
  };

  const toggleDriver = (did) => {
    setSelectedDriverId(selectedDriverId === did ? null : did);
  };

  const driverSubText = (d) => {
    const total = getDriverTotal(d, scopeZones);
    if (d.type === 'backup') {
      const names = (d.selectedFixed||[])
        .map(fid => simDrivers.find(dr => dr.id === fid)?.name).filter(Boolean).join(', ');
      return names ? `${names} 백업 · 평균 ${total}개` : '고정기사 미선택';
    }
    const zoneNames = (d.zones||[])
      .map(zid => scopeZones.find(z => z.id === zid)?.name).filter(Boolean)
      .sort((a,b) => a.localeCompare(b,'ko')).join(', ');
    return `${zoneNames||'구역 미배정'} · ${total}개`;
  };

  const buildAssignContent = (d) => {
    if (d.type === 'backup') {
      const campIds      = d.camps||[];
      const fixedInCamps = simDrivers.filter(fd => fd.type==='fixed' && campIds.includes(fd.camp) && fd.shift===d.shift);
      const selFixed     = d.selectedFixed||[];

      let avgBlock = null;
      if (selFixed.length > 0) {
        const allZoneIds = [...new Set(fixedInCamps.filter(fd=>selFixed.includes(fd.id)).flatMap(fd=>fd.zones||[]))];
        const total = allZoneIds.reduce((s,zid) => s + getQty(scopeZones.find(z=>z.id===zid), d.shift), 0);
        const avg = Math.round(total / selFixed.length);
        avgBlock = (
          <div style={{ background:'var(--surface2)', borderRadius:6, padding:'8px 10px', margin:'6px 0', fontSize:11 }}>
            <div style={{ color:'var(--text2)', marginBottom:4 }}>예상 평균 수량</div>
            <div style={{ fontSize:18, fontWeight:900, color:'var(--accent)' }}>
              {avg}개 <span style={{ fontSize:11, fontWeight:400, color:'var(--text2)' }}>/ 일 ({selFixed.length}명 평균)</span>
            </div>
            <div style={{ color:'var(--text3)', marginTop:3, fontSize:10 }}>총 {total}개 ÷ {selFixed.length}명</div>
          </div>
        );
      }

      return (
        <div className="assign-zone-area" onClick={e=>e.stopPropagation()}>
          <div className="assign-backup-label">대신할 고정기사 선택 (복수 가능)</div>
          {fixedInCamps.length === 0
            ? <div style={{ fontSize:11, color:'var(--text2)' }}>소속 캠프에 같은 교대 고정기사가 없습니다</div>
            : (
              <div className="backup-fixed-list">
                {fixedInCamps.slice().sort((a,b) => {
                  const ac = selFixed.includes(a.id), bc = selFixed.includes(b.id);
                  if (ac !== bc) return ac ? -1 : 1;
                  return a.name.localeCompare(b.name,'ko');
                }).map(fd => {
                  const cName   = camps.find(c=>c.id===fd.camp)?.name||'';
                  const checked = selFixed.includes(fd.id);
                  return (
                    <label key={fd.id} className={`backup-fixed-btn ${checked?'selected':''}`}>
                      <input type="checkbox" checked={checked}
                        onChange={e=>onBackupFixedChange(d.id, fd.id, e.target.checked)}
                        style={{ accentColor:'var(--blue)', cursor:'pointer' }} />
                      {fd.name} <span style={{ color:'var(--text2)', fontWeight:400 }}>{cName}</span>
                    </label>
                  );
                })}
              </div>
            )
          }
          {avgBlock}
        </div>
      );
    }

    const assignedZoneIds = new Set(d.zones||[]);
    const assignedMap = {};
    simDrivers.forEach(od => {
      if (od.id===d.id || od.shift!==d.shift) return;
      (od.zones||[]).forEach(zid => { assignedMap[zid]=od.name; });
    });
    const eligibleZones = scopeZones.filter(z => z.camp === d.camp)
      .sort((a,b) => {
        const aMe = assignedZoneIds.has(a.id), bMe = assignedZoneIds.has(b.id);
        const aOther = !aMe && !!assignedMap[a.id], bOther = !bMe && !!assignedMap[b.id];
        const rank = z => z.me ? 0 : z.other ? 2 : 1;
        const rA = rank({ me:aMe, other:aOther }), rB = rank({ me:bMe, other:bOther });
        if (rA !== rB) return rA - rB;
        return a.name.localeCompare(b.name,'ko');
      });

    return (
      <div className="assign-zone-area" onClick={e=>e.stopPropagation()}>
        <div className="cb-list" style={{ maxHeight:140 }}>
          {eligibleZones.length === 0
            ? <div style={{ padding:8, fontSize:12, color:'var(--text2)' }}>배정 가능한 구역이 없습니다</div>
            : eligibleZones.map(z => {
              const checked  = assignedZoneIds.has(z.id);
              const other    = assignedMap[z.id];
              const disabled = other && !checked;
              return (
                <label key={z.id} className="cb-item" style={{ opacity: disabled ? .4 : 1 }}>
                  <input type="checkbox" checked={checked} disabled={disabled}
                    onChange={e=>onZoneCheck(d.id, z.id, e.target.checked)}
                    style={{ accentColor:'var(--accent)', cursor: disabled?'not-allowed':'pointer' }} />
                  <div className="color-dot" style={{ background:z.color, width:9, height:9 }} />
                  <span>{z.name}</span>
                  {other
                    ? <span style={{ fontSize:10, color:'var(--red)', marginLeft:'auto' }}>{other}</span>
                    : <span className="cb-qty">{d.shift==='night'?'🌙':'☀️'}{getQty(z, d.shift)}개</span>
                  }
                </label>
              );
            })
          }
        </div>
      </div>
    );
  };

  const renderDriverItem = (d) => {
    const isSelected = selectedDriverId === d.id;
    return (
      <div key={d.id}
        className={`assign-driver-item ${isSelected?'active':''}`}
        onClick={() => toggleDriver(d.id)}
      >
        <div className="assign-driver-header">
          <span className="assign-driver-name">
            {d.name}
            <span className={`badge badge-${d.type}`}>{d.type==='backup'?'백업':'고정'}</span>
            <span className={`badge badge-${d.shift==='night'?'night':'day'}`}>
              {d.shift==='night'?'🌙 야간':'☀️ 주간'}
            </span>
          </span>
          <div className="item-actions" onClick={e=>e.stopPropagation()}>
            <button className="icon-btn" onClick={()=>openDriverModal(d)}>✏️</button>
            <button className="icon-btn red" onClick={()=>deleteDriver(d.id)}>🗑️</button>
          </div>
        </div>
        <div className="assign-driver-sub">{driverSubText(d)}</div>
        {isSelected && buildAssignContent(d)}
      </div>
    );
  };

  const sortDrivers = (arr) => arr.slice().sort((a,b) =>
    sortMode === 'qty'
      ? getDriverTotal(b) - getDriverTotal(a)
      : a.name.localeCompare(b.name,'ko')
  );

  const pinned     = selectedDriverId ? filteredDrivers.filter(d => d.id === selectedDriverId) : [];
  const rest       = filteredDrivers.filter(d => d.id !== selectedDriverId);
  const unassigned = rest.filter(d => !(d.zones||[]).length);
  const assigned   = rest.filter(d =>  (d.zones||[]).length > 0);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ padding:'10px 10px 8px', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:7 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.8px', textTransform:'uppercase' }}>
          시뮬 배정
        </div>

        <div className="filter-row">
          <select className="filter-select" value={filterCamp} onChange={e=>setFilterCamp(e.target.value)}>
            <option value="">전체 캠프</option>
            {scopeCampList.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="filter-select" value={filterShift} onChange={e=>setFilterShift(e.target.value)}>
            <option value="">전체 교대</option>
            <option value="day">☀️ 주간</option>
            <option value="night">🌙 야간</option>
          </select>
        </div>

        <div className="layer-ctrl-row">
          <button className="lbtn" onClick={()=>setSelectedDriverId(null)}>🗺️ 전체보기</button>
        </div>

        <div className="sort-row">
          <button className={`sort-btn ${sortMode==='name'?'active':''}`} onClick={()=>setSortMode('name')}>가나다순</button>
          <button className={`sort-btn ${sortMode==='qty'?'active':''}`}  onClick={()=>setSortMode('qty')}>수량순</button>
        </div>
        <div className="sort-row">
          <button className={`sort-btn ${filterType==='fixed'?'active':''}`}  onClick={()=>setFilterType('fixed')}>고정기사</button>
          <button className={`sort-btn ${filterType==='backup'?'active':''}`} onClick={()=>setFilterType('backup')}>백업기사</button>
        </div>

        <button className="btn btn-primary" style={{ fontSize:12, padding:'7px 0' }} onClick={()=>openDriverModal()}>
          👤 기사 추가
        </button>

        <button className="btn btn-secondary" style={{ fontSize:12, padding:'7px 0' }}
          onClick={async () => {
            if (!realDrivers?.length) { showToast('불러올 기사가 없습니다'); return; }
            const toImport = realDrivers.filter(d => {
              const campMatch = d.type === 'fixed'
                ? scopeCamps.has(d.camp)
                : (d.camps||[]).some(c => scopeCamps.has(c));
              const shiftMatch = scopeShifts.has(d.shift || 'day');
              return campMatch && shiftMatch;
            }).map(d => ({ ...d, id: 'sim_' + d.id, zones: [] }));
            if (!toImport.length) { showToast('조건에 맞는 기사가 없습니다'); return; }
            const confirmed = window.confirm(`${toImport.length}명을 불러옵니다. 기존 시뮬 기사는 덮어씌워집니다.`);
            if (!confirmed) return;
            await onSaveDrivers(sim.id, toImport);
            showToast(`✅ ${toImport.length}명 불러오기 완료`);
          }}>
          📋 실제 기사 불러오기
        </button>
      </div>

      <div className="sb-list">
        {filteredDrivers.length === 0
          ? <div className="empty"><div className="empty-icon">👤</div><div className="empty-text">기사를 추가하세요.</div></div>
          : (<>
            {pinned.map(renderDriverItem)}
            {unassigned.length > 0 &&
              <CollapsibleSection label={`⬜ 미배정 ${unassigned.length}명`} color="var(--text2)">
                {sortDrivers(unassigned).map(renderDriverItem)}
              </CollapsibleSection>
            }
            {assigned.length > 0 &&
              <CollapsibleSection label={`✅ 배정 완료 ${assigned.length}명`} color="var(--green)">
                {sortDrivers(assigned).map(renderDriverItem)}
              </CollapsibleSection>
            }
          </>)
        }
      </div>

      {showDriverModal && (
        <div className="overlay" onClick={() => setShowDriverModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{editDriverId ? '기사 편집' : '기사 추가'}</div>

            {/* 일괄 생성 토글 (신규 추가 시만) */}
            {!editDriverId && (
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'var(--text2)' }}>
                  <input type="checkbox" checked={bulkMode} onChange={e => setBulkMode(e.target.checked)}
                    style={{ accentColor:'var(--accent)', cursor:'pointer' }} />
                  일괄 생성 모드
                </label>
                {bulkMode && <span style={{ fontSize:11, color:'var(--accent)' }}>알파벳 시퀀스로 여러 명 생성</span>}
              </div>
            )}

            {/* 일괄 생성 입력 */}
            {!editDriverId && bulkMode ? (<>
              <div className="field">
                <label className="field-label">이름 앞자리 (선택)</label>
                <input className="field-input" value={bulkPrefix} placeholder="예: 기사 → 기사A, 기사B..."
                  onChange={e => setBulkPrefix(e.target.value)} />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <div className="field" style={{ flex:1 }}>
                  <label className="field-label">시작 알파벳</label>
                  <input className="field-input" value={bulkStart} maxLength={1} placeholder="A"
                    onChange={e => setBulkStart(e.target.value.toUpperCase())}
                    style={{ textTransform:'uppercase' }} />
                </div>
                <div className="field" style={{ flex:1 }}>
                  <label className="field-label">인원수</label>
                  <input className="field-input" type="number" min={1} max={50} value={bulkCount}
                    onChange={e => setBulkCount(parseInt(e.target.value)||1)} />
                </div>
              </div>
              {bulkStart.match(/^[A-Za-z]$/) && bulkCount > 0 && (
                <div style={{ background:'var(--surface2)', borderRadius:6, padding:'6px 10px', fontSize:11, color:'var(--text2)', marginBottom:8 }}>
                  미리보기: {(() => {
                    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                    const si = ALPHA.indexOf(bulkStart.toUpperCase());
                    const names = Array.from({ length: Math.min(bulkCount, 5) }, (_, i) => {
                      const idx = (si + i) % 26;
                      const cycle = Math.floor((si + i) / 26);
                      return (bulkPrefix.trim() || '') + (cycle > 0 ? ALPHA[idx] + cycle : ALPHA[idx]);
                    });
                    return names.join(', ') + (bulkCount > 5 ? ` ... (총 ${bulkCount}명)` : ` (총 ${bulkCount}명)`);
                  })()}
                </div>
              )}
            </>) : (
            <div className="field">
              <label className="field-label">기사명</label>
              <input className="field-input" value={driverForm.name} placeholder="이름 입력"
                onChange={e=>setDriverForm(f=>({...f,name:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&saveDriver()} />
            </div>
            )}
            <div className="field">
              <label className="field-label">유형</label>
              <select className="field-input" value={driverForm.type}
                onChange={e=>setDriverForm(f=>({...f,type:e.target.value,camp:'',camps:scopeCampList.map(c=>c.id)}))}>
                <option value="fixed">고정</option>
                <option value="backup">백업</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">교대</label>
              <select className="field-input" value={driverForm.shift}
                onChange={e=>setDriverForm(f=>({...f,shift:e.target.value}))}>
                {scopeShifts.has('day')   && <option value="day">☀️ 주간</option>}
                {scopeShifts.has('night') && <option value="night">🌙 야간</option>}
              </select>
            </div>

            {driverForm.type === 'fixed' && (
              <div className="field">
                <label className="field-label">캠프</label>
                <select className="field-input" value={driverForm.camp}
                  onChange={e=>setDriverForm(f=>({...f,camp:e.target.value}))}>
                  <option value="">캠프 선택</option>
                  {scopeCampList.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {driverForm.type === 'backup' && (
              <div className="field">
                <label className="field-label">담당 캠프 (복수 선택)</label>
                <div className="cb-list">
                  {scopeCampList.map(c=>(
                    <label key={c.id} className="cb-item">
                      <input type="checkbox" checked={driverForm.camps.includes(c.id)}
                        onChange={() => setDriverForm(f => ({
                          ...f,
                          camps: f.camps.includes(c.id) ? f.camps.filter(x=>x!==c.id) : [...f.camps, c.id]
                        }))}
                        style={{accentColor:'var(--accent)',cursor:'pointer'}} />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-btns">
              <button className="btn btn-secondary" onClick={()=>setShowDriverModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={saveDriver}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
