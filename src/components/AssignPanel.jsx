import { useState, useMemo, useCallback } from 'react';

/* ══════════════════════════════════════
   AssignPanel
   - 교대별 그룹핑 + 배정/미배정 분리
   - 고정기사: 구역 체크박스 직접 배정
   - 백업기사: 고정기사 복수 선택 → 구역 자동 적용
   - 기사 선택 시 지도 하이라이트 (selectedDriverId)
══════════════════════════════════════ */
export default function AssignPanel({
  zones, setZones,
  drivers, setDrivers,
  regions, camps,
  onSave, showToast,
  selectedDriverId, setSelectedDriverId,
}) {
  /* ── 필터 ── */
  const [filterRegion, setFilterRegion] = useState('');
  const [filterCamp,   setFilterCamp]   = useState('');
  const [filterShift,  setFilterShift]  = useState('');
  const [sortMode,     setSortMode]     = useState('name');

  /* ── 필터링된 캠프 ── */
  const filteredCamps = useMemo(() =>
    filterRegion ? camps.filter(c=>c.region===filterRegion) : camps,
    [camps, filterRegion]);

  /* ── 교대 수량 계산 ── */
  const getQty = useCallback((zone, shift) => {
    if (!zone) return 0;
    const raw = shift === 'night'
      ? (zone.qtyNight != null ? zone.qtyNight : 0)
      : (zone.qtyDay   != null ? zone.qtyDay   : (zone.qty ?? 0));
    return parseInt(raw) || 0;
  }, []);

  /* ── 기사 합산 수량 ── */
  const getDriverTotal = useCallback((d) => {
    const shift = d.shift || 'day';
    const total = (d.zones||[]).reduce((s,zid) => {
      const z = zones.find(z=>z.id===zid);
      return s + getQty(z, shift);
    }, 0);
    if (d.type === 'backup' && (d.selectedFixed||[]).length > 0)
      return Math.round(total / d.selectedFixed.length);
    return total;
  }, [zones, getQty]);

  /* ── 필터링된 기사 ── */
  const filteredDrivers = useMemo(() => {
    return drivers.filter(d => {
      if (filterRegion && d.region !== filterRegion) return false;
      if (filterCamp) {
        if (d.type==='fixed')  return d.camp === filterCamp;
        if (d.type==='backup') return (d.camps||[]).includes(filterCamp);
      }
      if (filterShift && d.shift !== filterShift) return false;
      return true;
    });
  }, [drivers, filterRegion, filterCamp, filterShift]);

  /* ── 교대별 그룹핑 + 배정/미배정 분리 ── */
  const grouped = useMemo(() => {
    const g = { day:{ assigned:[], unassigned:[] }, night:{ assigned:[], unassigned:[] } };
    filteredDrivers.forEach(d => {
      const shift  = d.shift || 'day';
      const bucket = (d.zones||[]).length > 0 ? 'assigned' : 'unassigned';
      if (!g[shift]) g[shift] = { assigned:[], unassigned:[] };
      g[shift][bucket].push(d);
    });
    const sorter = (a,b) => sortMode==='qty'
      ? getDriverTotal(b)-getDriverTotal(a)
      : a.name.localeCompare(b.name,'ko');
    Object.keys(g).forEach(s => {
      g[s].assigned.sort(sorter);
      g[s].unassigned.sort(sorter);
    });
    return g;
  }, [filteredDrivers, sortMode, getDriverTotal]);

  /* ── 구역 체크 변경 ── */
  const onZoneCheck = (did, zid, checked) => {
    const newDrivers = drivers.map(d => {
      if (d.id !== did) return d;
      const zones = checked
        ? [...(d.zones||[]), zid]
        : (d.zones||[]).filter(id=>id!==zid);
      return { ...d, zones };
    });
    setDrivers(newDrivers);
  };

  /* ── 고정기사 배정 저장 ── */
  const saveAssign = async (did) => {
    await onSave(null, drivers);
    showToast('✅ 배송구역 저장 완료');
  };

  /* ── 백업기사 고정기사 선택 변경 ── */
  const onBackupFixedChange = (backupId, fixedId, checked) => {
    const newDrivers = drivers.map(d => {
      if (d.id !== backupId) return d;
      const sel = checked
        ? [...(d.selectedFixed||[]), fixedId]
        : (d.selectedFixed||[]).filter(id=>id!==fixedId);
      return { ...d, selectedFixed: sel };
    });
    setDrivers(newDrivers);
  };

  /* ── 백업기사 구역 적용 + 저장 ── */
  const applyAndSave = async (backupId) => {
    const backup = drivers.find(d=>d.id===backupId);
    const sel    = backup?.selectedFixed || [];
    if (!sel.length) { showToast('고정기사를 먼저 선택하세요'); return; }
    const allZoneIds = [...new Set(
      drivers.filter(d=>sel.includes(d.id)).flatMap(d=>d.zones||[])
    )];
    const newDrivers = drivers.map(d =>
      d.id === backupId ? { ...d, zones: allZoneIds } : d
    );
    setDrivers(newDrivers);
    await onSave(null, newDrivers);
    const names = sel.map(fid=>drivers.find(d=>d.id===fid)?.name).filter(Boolean).join(', ');
    showToast(`✅ ${names} 구역 적용 및 저장 완료`);
  };

  /* ── 기사 선택 토글 ── */
  const toggleDriver = (did) => {
    setSelectedDriverId(prev => prev === did ? null : did);
  };

  /* ── 기사 서브텍스트 ── */
  const driverSubText = (d) => {
    const total = getDriverTotal(d);
    if (d.type === 'backup') {
      const names = (d.selectedFixed||[])
        .map(fid=>drivers.find(dr=>dr.id===fid)?.name).filter(Boolean).join(', ');
      return names ? `${names} 백업 · 평균 ${total}개` : '고정기사 미선택';
    }
    const zoneNames = (d.zones||[])
      .map(zid=>zones.find(z=>z.id===zid)?.name).filter(Boolean).join(', ');
    return `${zoneNames||'구역 미배정'} · ${total}개`;
  };

  /* ── 배정 UI 빌드 ── */
  const buildAssignContent = (d) => {
    if (d.type === 'backup') {
      // 소속 캠프 고정기사 목록
      const campIds     = d.camps||[];
      const fixedInCamps= drivers.filter(fd =>
        fd.type==='fixed' && campIds.includes(fd.camp) && fd.shift===d.shift
      );
      const selFixed = d.selectedFixed||[];

      // 평균 수량 미리보기
      let avgBlock = null;
      if (selFixed.length > 0) {
        const allZoneIds = [...new Set(
          fixedInCamps.filter(fd=>selFixed.includes(fd.id)).flatMap(fd=>fd.zones||[])
        )];
        const total = allZoneIds.reduce((s,zid) => {
          const z = zones.find(z=>z.id===zid);
          return s + getQty(z, d.shift);
        }, 0);
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
            ? <div style={{ fontSize:11, color:'var(--text2)', marginBottom:8 }}>소속 캠프에 같은 교대 고정기사가 없습니다</div>
            : (
              <div className="backup-fixed-list">
                {fixedInCamps.map(fd => {
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
          <button className="btn btn-primary" style={{ fontSize:11, padding:6 }}
            onClick={()=>applyAndSave(d.id)}>
            ✅ 선택한 기사 구역 적용 및 저장
          </button>
        </div>
      );
    }

    // 고정기사 구역 체크박스
    const eligibleZones = zones.filter(z=>z.camp===d.camp)
      .sort((a,b)=>a.name.localeCompare(b.name,'ko'));

    // 같은 교대 다른 기사 배정 현황
    const assignedMap = {};
    drivers.forEach(od => {
      if (od.id===d.id || od.shift!==d.shift) return;
      (od.zones||[]).forEach(zid => { assignedMap[zid]=od.name; });
    });

    return (
      <div className="assign-zone-area" onClick={e=>e.stopPropagation()}>
        <div className="cb-list" style={{ maxHeight:140 }}>
          {eligibleZones.length === 0
            ? <div style={{ padding:8, fontSize:12, color:'var(--text2)' }}>배정 가능한 구역이 없습니다</div>
            : eligibleZones.map(z => {
              const checked  = (d.zones||[]).includes(z.id);
              const other    = assignedMap[z.id];
              const disabled = other && !checked;
              const qty      = getQty(z, d.shift);
              const icon     = d.shift==='night'?'🌙':'☀️';
              return (
                <label key={z.id} className="cb-item" style={{ opacity: disabled ? .4 : 1 }}>
                  <input type="checkbox" checked={checked} disabled={disabled}
                    onChange={e=>onZoneCheck(d.id, z.id, e.target.checked)}
                    style={{ accentColor:'var(--accent)', cursor: disabled?'not-allowed':'pointer' }} />
                  <div className="color-dot" style={{ background:z.color, width:9, height:9 }} />
                  <span>{z.name}</span>
                  {other
                    ? <span style={{ fontSize:10, color:'var(--red)', marginLeft:'auto' }}>{other}</span>
                    : <span className="cb-qty">{icon}{qty}개</span>
                  }
                </label>
              );
            })
          }
        </div>
        <button className="btn btn-primary" style={{ marginTop:8, fontSize:11, padding:6 }}
          onClick={()=>saveAssign(d.id)}>
          💾 배정 저장
        </button>
      </div>
    );
  };

  /* ── 기사 아이템 렌더 ── */
  const renderDriverItem = (d) => {
    const isSelected = selectedDriverId === d.id;
    const hidden     = false; // 가시성 기능은 추후
    return (
      <div key={d.id}
        className={`assign-driver-item ${isSelected?'active':''} ${hidden?'zone-hidden':''}`}
        onClick={()=>toggleDriver(d.id)}>
        <div className="assign-driver-header">
          <span className="assign-driver-name">
            {d.name}
            <span className={`badge badge-${d.type}`}>{d.type==='backup'?'백업':'고정'}</span>
            <span className={`badge badge-${d.shift==='night'?'night':'day'}`}>
              {d.shift==='night'?'🌙 야간':'☀️ 주간'}
            </span>
          </span>
          {/* 가시성 버튼 추후 추가 */}
        </div>
        <div className="assign-driver-sub">{driverSubText(d)}</div>
        {isSelected && buildAssignContent(d)}
      </div>
    );
  };

  /* ── 구분선 ── */
  const divider = (label, color) => (
    <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 8px', margin:'4px 0 2px' }}>
      <div style={{ flex:1, height:1, background:color, opacity:.4 }} />
      <span style={{ fontSize:11, color, fontWeight:700, whiteSpace:'nowrap' }}>{label}</span>
      <div style={{ flex:1, height:1, background:color, opacity:.4 }} />
    </div>
  );

  const shiftHeader = (shift, total, isFirst) => (
    <div style={{
      padding:'8px 8px 4px',
      marginTop: isFirst ? 0 : 8,
      fontSize:12, fontWeight:800, color:'var(--text)',
      borderTop: isFirst ? 'none' : '1px solid var(--border)',
      paddingTop: isFirst ? 4 : 12,
    }}>
      {shift==='day'?'☀️ 주간':'🌙 야간'}
      <span style={{ fontSize:11, fontWeight:400, color:'var(--text2)', marginLeft:6 }}>{total}명</span>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* 상단 */}
      <div style={{ padding:'10px 10px 8px', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:7 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.8px', textTransform:'uppercase' }}>기사별 배송구역</div>

        <div className="filter-row">
          <select className="filter-select" value={filterRegion} onChange={e=>{setFilterRegion(e.target.value);setFilterCamp('');}}>
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
      </div>

      {/* 목록 */}
      <div className="sb-list">
        {filteredDrivers.length === 0
          ? <div className="empty"><div className="empty-icon">👤</div><div className="empty-text">기사를 먼저 등록하세요.</div></div>
          : ['day','night'].map((shift, si) => {
            const g = grouped[shift];
            const total = (g?.assigned.length||0) + (g?.unassigned.length||0);
            if (!total) return null;
            return (
              <div key={shift}>
                {shiftHeader(shift, total, si===0)}
                {g.assigned.length>0 && <>
                  {divider(`✅ 배정 완료 ${g.assigned.length}명`, 'var(--green)')}
                  {g.assigned.map(renderDriverItem)}
                </>}
                {g.unassigned.length>0 && <>
                  {divider(`⬜ 미배정 ${g.unassigned.length}명`, 'var(--text2)')}
                  {g.unassigned.map(renderDriverItem)}
                </>}
              </div>
            );
          })
        }
      </div>
    </div>
  );
}
