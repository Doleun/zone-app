import { useState, useMemo, useCallback } from 'react';
import CollapsibleSection from './ui/CollapsibleSection';
import { getQty, getDriverTotal } from '../utils/helpers';

export default function AssignPanel({
  zones, setZones,
  drivers, setDrivers,
  regions, camps,
  onSave, showToast,
  selectedDriverId, setSelectedDriverId,
  assignShift, setAssignShift,
}) {
  const [filterRegion, setFilterRegion] = useState('');
  const [filterCamp,   setFilterCamp]   = useState('');
  const [sortMode,     setSortMode]     = useState('name');
  const [filterType,   setFilterType]   = useState('fixed');

  const filteredCamps = useMemo(() =>
    filterRegion ? camps.filter(c=>c.region===filterRegion) : camps,
    [camps, filterRegion]);

  const filteredDrivers = useMemo(() => {
    return drivers.filter(d => {
      if (d.type !== filterType) return false;
      if ((d.shift || 'day') !== assignShift) return false;
      if (filterRegion && d.region !== filterRegion) return false;
      if (filterCamp) {
        const campMatch = d.type==='fixed'
          ? d.camp === filterCamp
          : (d.camps||[]).includes(filterCamp);
        if (!campMatch) return false;
      }
      return true;
    });
  }, [drivers, filterRegion, filterCamp, assignShift, filterType]);

  const onZoneCheck = async (did, zid, checked) => {
    const newDrivers = drivers.map(d => {
      if (d.id !== did) return d;
      const newZones = checked
        ? [...(d.zones||[]), zid]
        : (d.zones||[]).filter(id=>id!==zid);
      return { ...d, zones: newZones, labelPos: newZones.length === 0 ? null : d.labelPos };
    });
    setDrivers(newDrivers);
    await onSave(null, newDrivers);
  };

  const onBackupFixedChange = async (backupId, fixedId, checked) => {
    const backup = drivers.find(d => d.id === backupId);
    const sel = checked
      ? [...(backup?.selectedFixed||[]), fixedId]
      : (backup?.selectedFixed||[]).filter(id => id !== fixedId);
    const allZoneIds = sel.length > 0
      ? [...new Set(drivers.filter(d => sel.includes(d.id)).flatMap(d => d.zones||[]))]
      : [];
    const newDrivers = drivers.map(d =>
      d.id === backupId ? { ...d, selectedFixed: sel, zones: allZoneIds } : d
    );
    setDrivers(newDrivers);
    await onSave(null, newDrivers);
  };

  const toggleDriver = (did) => {
    setSelectedDriverId(selectedDriverId === did ? null : did);
  };

  const driverSubText = (d) => {
    const total = getDriverTotal(d, zones);
    if (d.type === 'backup') {
      const names = (d.selectedFixed||[])
        .map(fid=>drivers.find(dr=>dr.id===fid)?.name).filter(Boolean).join(', ');
      return names ? `${names} 백업 · 평균 ${total}개` : '고정기사 미선택';
    }
    const zoneNames = (d.zones||[])
      .map(zid=>zones.find(z=>z.id===zid)?.name).filter(Boolean)
      .sort((a,b)=>a.localeCompare(b,'ko'))
      .join(', ');
    return `${zoneNames||'구역 미배정'} · ${total}개`;
  };

  const buildAssignContent = (d) => {
    if (d.type === 'backup') {
      const campIds      = d.camps||[];
      const fixedInCamps = drivers.filter(fd =>
        fd.type==='fixed' && campIds.includes(fd.camp) && fd.shift===d.shift
      );
      const selFixed = d.selectedFixed||[];

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
                {fixedInCamps
                  .slice()
                  .sort((a,b) => {
                    const aChecked = selFixed.includes(a.id);
                    const bChecked = selFixed.includes(b.id);
                    if (aChecked !== bChecked) return aChecked ? -1 : 1;
                    return a.name.localeCompare(b.name, 'ko');
                  })
                  .map(fd => {
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

    const assignedZoneIds = new Set(d.zones || []);
    const assignedMap = {};
    drivers.forEach(od => {
      if (od.id===d.id || od.shift!==d.shift) return;
      (od.zones||[]).forEach(zid => { assignedMap[zid]=od.name; });
    });

    const campZones  = zones.filter(z => z.camp === d.camp);
    const extraZones = zones.filter(z => assignedZoneIds.has(z.id) && z.camp !== d.camp);
    const eligibleZones = [...campZones, ...extraZones]
      .sort((a,b) => {
        const aMe    = assignedZoneIds.has(a.id);
        const bMe    = assignedZoneIds.has(b.id);
        const aOther = !aMe && !!assignedMap[a.id];
        const bOther = !bMe && !!assignedMap[b.id];
        const rank = z => z.me ? 0 : z.other ? 2 : 1;
        const rA = rank({ me: aMe, other: aOther });
        const rB = rank({ me: bMe, other: bOther });
        if (rA !== rB) return rA - rB;
        return a.name.localeCompare(b.name, 'ko');
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
              const qty      = getQty(z, d.shift);
              const icon     = d.shift==='night'?'🌙':'☀️';
              const isExtra  = z.camp !== d.camp;
              return (
                <label key={z.id} className="cb-item" style={{ opacity: disabled ? .4 : 1 }}>
                  <input type="checkbox" checked={checked} disabled={disabled}
                    onChange={e=>onZoneCheck(d.id, z.id, e.target.checked)}
                    style={{ accentColor:'var(--accent)', cursor: disabled?'not-allowed':'pointer' }} />
                  <div className="color-dot" style={{ background:z.color, width:9, height:9 }} />
                  <span>{z.name}{isExtra && <span style={{ fontSize:9, color:'var(--text2)', marginLeft:3 }}>↗</span>}</span>
                  {other
                    ? <span style={{ fontSize:10, color:'var(--red)', marginLeft:'auto' }}>{other}</span>
                    : <span className="cb-qty">{icon}{qty}개</span>
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
        onClick={()=>toggleDriver(d.id)}>
        <div className="assign-driver-header">
          <span className="assign-driver-name">
            {d.name}
            <span className={`badge badge-${d.type}`}>{d.type==='backup'?'백업':'고정'}</span>
          </span>
        </div>
        <div className="assign-driver-sub">{driverSubText(d)}</div>
        {isSelected && buildAssignContent(d)}
      </div>
    );
  };

  const sortDrivers = (arr) => arr.slice().sort((a,b) =>
    sortMode==='qty'
      ? getDriverTotal(b, zones) - getDriverTotal(a, zones)
      : a.name.localeCompare(b.name,'ko')
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* ── 주/야간 탭 ── */}
      <div style={{ display:'flex', flexShrink:0, borderBottom:'2px solid var(--border)' }}>
        <button
          onClick={() => { setAssignShift('day'); setSelectedDriverId(null); }}
          style={{
            flex:1, padding:'10px 0', fontSize:13, fontWeight:700,
            border:'none', cursor:'pointer', transition:'all .15s',
            background: assignShift === 'day' ? 'var(--accent)' : 'var(--sidebar)',
            color:       assignShift === 'day' ? '#fff'         : 'var(--text2)',
            borderBottom: assignShift === 'day' ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -2,
          }}
        >☀️ 주간</button>
        <button
          onClick={() => { setAssignShift('night'); setSelectedDriverId(null); }}
          style={{
            flex:1, padding:'10px 0', fontSize:13, fontWeight:700,
            border:'none', cursor:'pointer', transition:'all .15s',
            background: assignShift === 'night' ? '#3730a3' : 'var(--sidebar)',
            color:       assignShift === 'night' ? '#fff'    : 'var(--text2)',
            borderBottom: assignShift === 'night' ? '2px solid #6366f1' : '2px solid transparent',
            marginBottom: -2,
          }}
        >🌙 야간</button>
      </div>

      {/* ── 필터/정렬 헤더 ── */}
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

        <div className="layer-ctrl-row">
          <button className="lbtn" onClick={()=>setSelectedDriverId(null)}>🗺️ 전체보기</button>
        </div>

        <div className="sort-row">
          <button className={`sort-btn ${sortMode==='name'?'active':''}`} onClick={()=>setSortMode('name')}>가나다순</button>
          <button className={`sort-btn ${sortMode==='qty'?'active':''}`}  onClick={()=>setSortMode('qty')}>수량순</button>
        </div>
        <div className="sort-row">
          <button className={`sort-btn ${filterType==='fixed'?'active':''}`} onClick={()=>setFilterType('fixed')}>고정기사</button>
          <button className={`sort-btn ${filterType==='backup'?'active':''}`} onClick={()=>setFilterType('backup')}>백업기사</button>
        </div>
      </div>

      <div className="sb-list">
        {filteredDrivers.length === 0
          ? <div className="empty"><div className="empty-icon">👤</div><div className="empty-text">기사를 먼저 등록하세요.</div></div>
          : (() => {
            const pinned     = selectedDriverId ? filteredDrivers.filter(d => d.id === selectedDriverId) : [];
            const rest       = filteredDrivers.filter(d => d.id !== selectedDriverId);
            const unassigned = rest.filter(d => !(d.zones||[]).length);
            const assigned   = rest.filter(d =>  (d.zones||[]).length > 0);
            return (<>
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
            </>);
          })()
        }
      </div>
    </div>
  );
}
