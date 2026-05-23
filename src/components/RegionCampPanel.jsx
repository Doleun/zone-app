import { useState, useMemo } from 'react';
import { addRegion, deleteRegion, addCamp, deleteCamp } from '../firebase/db';
import { saveData } from '../firebase/db';

export default function RegionCampPanel({ regions, camps, zones, drivers, setZones, setDrivers, onSave, showToast }) {
  const [selectedRegion, setSelectedRegion] = useState('');
  const [newRegionName,  setNewRegionName]  = useState('');
  const [newCampName,    setNewCampName]    = useState('');

  const filteredCamps = useMemo(() =>
    selectedRegion ? camps.filter(c=>c.region===selectedRegion) : camps,
    [camps, selectedRegion]);

  const handleAddRegion = async () => {
    const name = newRegionName.trim();
    if (!name) return;
    try {
      await addRegion(name, regions.length);
      setNewRegionName('');
      showToast('✅ 지역 추가: ' + name);
    } catch(e) { showToast('❌ 실패: ' + e.message); }
  };

  const handleDeleteRegion = async (id) => {
    const r = regions.find(r=>r.id===id);
    const relatedCamps   = camps.filter(c=>c.region===id);
    const relatedCampIds = new Set(relatedCamps.map(c=>c.id));

    /* 해당 지역 캠프에 속한 구역/기사 수 계산 */
    const affectedZones   = zones.filter(z => relatedCampIds.has(z.camp));
    const affectedDrivers = drivers.filter(d =>
      (d.type === 'fixed'  && relatedCampIds.has(d.camp)) ||
      (d.type === 'backup' && (d.camps||[]).some(c => relatedCampIds.has(c)))
    );

    let msg = `"${r?.name}" 지역을 삭제할까요?\n해당 지역 캠프도 모두 삭제됩니다.`;
    if (affectedZones.length || affectedDrivers.length) {
      msg += `\n\n구역 ${affectedZones.length}개는 미분류로 남고,\n기사 ${affectedDrivers.length}명의 캠프 배정이 해제됩니다.`;
    }
    if (!window.confirm(msg)) return;

    try {
      /* Firestore: 지역/캠프 삭제 */
      await deleteRegion(id);
      for (const c of relatedCamps) await deleteCamp(c.id);
      if (selectedRegion === id) setSelectedRegion('');

      /* zones: camp/region 비워서 미분류로 */
      const newZones = zones.map(z =>
        relatedCampIds.has(z.camp) ? { ...z, camp: '', region: '' } : z
      );

      /* drivers: 고정기사 camp 비움, 백업기사 camps에서 제거 */
      const newDrivers = drivers.map(d => {
        if (d.type === 'fixed' && relatedCampIds.has(d.camp))
          return { ...d, camp: '', region: '' };
        if (d.type === 'backup') {
          const newCamps = (d.camps||[]).filter(c => !relatedCampIds.has(c));
          if (newCamps.length === (d.camps||[]).length) return d;
          return { ...d, camps: newCamps };
        }
        return d;
      });

      setZones(newZones);
      setDrivers(newDrivers);
      await onSave(newZones, newDrivers);
      showToast('✅ 삭제 완료 (구역은 미분류로 남음)');
    } catch(e) { showToast('❌ 실패: ' + e.message); }
  };

  const handleAddCamp = async () => {
    const name = newCampName.trim();
    if (!selectedRegion) { showToast('지역을 먼저 선택하세요'); return; }
    if (!name) return;
    try {
      await addCamp(name, selectedRegion, filteredCamps.length);
      setNewCampName('');
      showToast('✅ 캠프 추가: ' + name);
    } catch(e) { showToast('❌ 실패: ' + e.message); }
  };

  const handleDeleteCamp = async (id) => {
    const c = camps.find(c=>c.id===id);
    const affectedZones   = zones.filter(z => z.camp === id);
    const affectedDrivers = drivers.filter(d =>
      (d.type === 'fixed'  && d.camp === id) ||
      (d.type === 'backup' && (d.camps||[]).includes(id))
    );

    let msg = `"${c?.name}" 캠프를 삭제할까요?`;
    if (affectedZones.length || affectedDrivers.length) {
      msg += `\n\n구역 ${affectedZones.length}개는 미분류로 남고,\n기사 ${affectedDrivers.length}명의 캠프 배정이 해제됩니다.`;
    }
    if (!window.confirm(msg)) return;

    try {
      await deleteCamp(id);

      /* zones: camp 비워서 미분류로 */
      const newZones = zones.map(z =>
        z.camp === id ? { ...z, camp: '' } : z
      );

      /* drivers: 고정기사 camp 비움, 백업기사 camps에서 제거 */
      const newDrivers = drivers.map(d => {
        if (d.type === 'fixed' && d.camp === id) return { ...d, camp: '' };
        if (d.type === 'backup') {
          const newCamps = (d.camps||[]).filter(c => c !== id);
          if (newCamps.length === (d.camps||[]).length) return d;
          return { ...d, camps: newCamps };
        }
        return d;
      });

      setZones(newZones);
      setDrivers(newDrivers);
      await onSave(newZones, newDrivers);
      showToast('✅ 삭제 완료 (구역은 미분류로 남음)');
    } catch(e) { showToast('❌ 실패: ' + e.message); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflowY:'auto' }}>
      <div style={{ padding:'12px 10px 6px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.8px', textTransform:'uppercase' }}>
          캠프 / 지역 관리
        </div>
      </div>

      {/* 지역 */}
      <div className="rc-section">
        <div className="rc-section-title">📍 지역</div>
        {regions.length === 0
          ? <div style={{ fontSize:12, color:'var(--text2)', padding:'4px 0' }}>지역이 없습니다</div>
          : regions.map(r => (
            <div key={r.id} className="rc-item">
              <span className="rc-item-name">📍 {r.name}</span>
              <button className="icon-btn red" onClick={()=>handleDeleteRegion(r.id)}>🗑️</button>
            </div>
          ))
        }
        <div className="rc-add-row">
          <input className="rc-input" value={newRegionName} placeholder="새 지역명 (예: 대구)"
            onChange={e=>setNewRegionName(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleAddRegion()} />
          <button className="rc-add-btn" onClick={handleAddRegion}>추가</button>
        </div>
      </div>

      <div className="rc-divider" />

      {/* 캠프 */}
      <div className="rc-section">
        <div className="rc-section-title">🏕️ 캠프</div>
        <div className="filter-row" style={{ marginBottom:8 }}>
          <select className="filter-select" value={selectedRegion} onChange={e=>setSelectedRegion(e.target.value)}>
            <option value="">지역 선택</option>
            {regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {!selectedRegion
          ? <div style={{ fontSize:12, color:'var(--text2)', padding:'4px 0' }}>지역을 선택하세요</div>
          : filteredCamps.length === 0
            ? <div style={{ fontSize:12, color:'var(--text2)', padding:'4px 0' }}>캠프가 없습니다</div>
            : filteredCamps.map(c => (
              <div key={c.id} className="rc-item">
                <span className="rc-item-name">🏕️ {c.name}</span>
                <button className="icon-btn red" onClick={()=>handleDeleteCamp(c.id)}>🗑️</button>
              </div>
            ))
        }
        <div className="rc-add-row">
          <input className="rc-input" value={newCampName} placeholder="새 캠프명 (예: 5캠프)"
            onChange={e=>setNewCampName(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleAddCamp()} />
          <button className="rc-add-btn" onClick={handleAddCamp}>추가</button>
        </div>
      </div>
    </div>
  );
}
