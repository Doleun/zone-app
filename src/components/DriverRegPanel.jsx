import { useState, useMemo } from 'react';

export default function DriverRegPanel({
  drivers, setDrivers,
  regions, camps,
  onSave, showToast,
  filterRegion, setFilterRegion,
  filterCamp,   setFilterCamp,
  filterShift,  setFilterShift,
}) {
  const [filterType,   setFilterType]   = useState('all');
  const [showModal,    setShowModal]    = useState(false);
  const [editId,       setEditId]       = useState(null);
  const [form, setForm] = useState({ name:'', type:'fixed', shift:'day', region:'', camp:'', camps:[] });

  const filteredCamps = useMemo(() =>
    filterRegion ? camps.filter(c=>c.region===filterRegion) : camps,
    [camps, filterRegion]);

  const filteredDrivers = useMemo(() => {
    return [...drivers].filter(d => {
      if (filterType !== 'all' && d.type !== filterType) return false;
      if (filterRegion && d.region !== filterRegion) return false;
      if (filterCamp) {
        const campMatch = d.type === 'fixed'
          ? d.camp === filterCamp
          : (d.camps||[]).includes(filterCamp);
        if (!campMatch) return false;
      }
      if (filterShift && d.shift !== filterShift) return false;
      return true;
    }).sort((a,b) => a.name.localeCompare(b.name,'ko'));
  }, [drivers, filterType, filterRegion, filterCamp, filterShift]);

  const modalCamps = useMemo(() =>
    form.region ? camps.filter(c=>c.region===form.region) : [],
    [camps, form.region]);

  const openModal = (driver=null) => {
    if (driver) {
      /* 편집: 기존 값 그대로 */
      setForm({
        name:   driver.name,
        type:   driver.type  || 'fixed',
        shift:  driver.shift || 'day',
        region: driver.region|| '',
        camp:   driver.camp  || '',
        camps:  driver.camps || [],
      });
      setEditId(driver.id);
    } else {
      /* 신규: 현재 필터값을 기본값으로 */
      const defaultShift  = filterShift  || 'day';
      const defaultRegion = filterRegion || '';
      const defaultCamp   = filterCamp   || '';
      const defaultType   = filterType === 'all' ? 'fixed' : filterType;
      const defaultCamps  = defaultCamp ? [defaultCamp] : [];
      setForm({
        name:   '',
        type:   defaultType,
        shift:  defaultShift,
        region: defaultRegion,
        camp:   defaultType === 'fixed' ? defaultCamp : '',
        camps:  defaultType === 'backup' ? defaultCamps : [],
      });
      setEditId(null);
    }
    setShowModal(true);
  };

  const saveDriver = async () => {
    if (!form.name.trim()) { showToast('기사 이름을 입력하세요'); return; }
    let newDrivers;
    if (editId) {
      newDrivers = drivers.map(d => d.id === editId
        ? { ...d, name:form.name.trim(), type:form.type, shift:form.shift,
            region:form.region, camp:form.camp, camps:form.camps }
        : d);
    } else {
      newDrivers = [...drivers, {
        id:     'd' + Date.now(),
        name:   form.name.trim(),
        type:   form.type,
        shift:  form.shift,
        region: form.region,
        camp:   form.camp,
        camps:  form.camps,
        zones:  [],
      }];
    }
    setDrivers(newDrivers);
    await onSave(null, newDrivers);
    setShowModal(false);
    showToast('✅ 저장 완료');
  };

  /* ── 삭제: 백업기사 selectedFixed 정리 ── */
  const deleteDriver = async (did) => {
    if (!window.confirm('이 기사를 삭제할까요?')) return;
    const remaining = drivers.filter(d => d.id !== did);
    const newDrivers = remaining.map(d => {
      if (d.type !== 'backup') return d;
      const newSel = (d.selectedFixed || []).filter(id => id !== did);
      if (newSel.length === (d.selectedFixed || []).length) return d;
      return { ...d, selectedFixed: newSel };
    });
    setDrivers(newDrivers);
    await onSave(null, newDrivers);
    showToast('✅ 삭제 완료');
  };

  const toggleBackupCamp = (campId) => {
    setForm(f => ({
      ...f,
      camps: f.camps.includes(campId) ? f.camps.filter(c=>c!==campId) : [...f.camps, campId],
    }));
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ padding:'10px 10px 8px', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:7 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.8px', textTransform:'uppercase' }}>기사 등록</div>

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

        <div className="sort-row">
          <button className={`sort-btn ${filterType==='all'?'active':''}`}    onClick={()=>setFilterType('all')}>전체</button>
          <button className={`sort-btn ${filterType==='fixed'?'active':''}`}  onClick={()=>setFilterType('fixed')}>고정기사</button>
          <button className={`sort-btn ${filterType==='backup'?'active':''}`} onClick={()=>setFilterType('backup')}>백업기사</button>
        </div>

        <button className="btn btn-primary" onClick={()=>openModal()}>👤 기사 등록</button>
      </div>

      <div className="sb-list">
        {filteredDrivers.length === 0
          ? <div className="empty"><div className="empty-icon">👤</div><div className="empty-text">등록된 기사가 없습니다.<br/>"기사 등록"으로 추가하세요.</div></div>
          : (() => {
            const renderItem = (d) => {
              const rName   = regions.find(r=>r.id===d.region)?.name||'';
              const campStr = d.type==='fixed'
                ? camps.find(c=>c.id===d.camp)?.name||''
                : (d.camps||[]).map(cid=>camps.find(c=>c.id===cid)?.name).filter(Boolean).join(', ');
              return (
                <div key={d.id} className="item">
                  <div className="item-body">
                    <div className="item-name">
                      {d.name}
                      <span className={`badge badge-${d.type}`}>{d.type==='backup'?'백업':'고정'}</span>
                      <span className={`badge badge-${d.shift==='night'?'night':'day'}`}>
                        {d.shift==='night'?'🌙 야간':'☀️ 주간'}
                      </span>
                    </div>
                    <div className="item-sub">{[rName,campStr].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="item-actions">
                    <button className="icon-btn" onClick={()=>openModal(d)}>✏️</button>
                    <button className="icon-btn red" onClick={()=>deleteDriver(d.id)}>🗑️</button>
                  </div>
                </div>
              );
            };

            const fixed  = filteredDrivers.filter(d => d.type === 'fixed');
            const backup = filteredDrivers.filter(d => d.type === 'backup');

            return (<>
              {fixed.length > 0 && (<>
                <div style={{ padding:'6px 10px 4px', fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.6px', background:'var(--surface2)', borderBottom:'1px solid var(--border)' }}>
                  고정기사 {fixed.length}명
                </div>
                {fixed.map(renderItem)}
              </>)}
              {backup.length > 0 && (<>
                <div style={{ padding:'6px 10px 4px', fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.6px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', borderTop: fixed.length > 0 ? '2px solid var(--border)' : 'none' }}>
                  백업기사 {backup.length}명
                </div>
                {backup.map(renderItem)}
              </>)}
            </>);
          })()
        }
      </div>

      {showModal && (
        <div className="overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">{editId ? '기사 정보 편집' : '기사 등록'}</div>

            <div className="field">
              <label className="field-label">기사명</label>
              <input className="field-input" value={form.name} placeholder="이름 입력"
                onChange={e=>setForm(f=>({...f,name:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&saveDriver()} />
            </div>
            <div className="field">
              <label className="field-label">유형</label>
              <select className="field-input" value={form.type}
                onChange={e=>setForm(f=>({...f,type:e.target.value,camp:'',camps: filterCamp ? [filterCamp] : []}))}>
                <option value="fixed">고정</option>
                <option value="backup">백업</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">교대</label>
              <select className="field-input" value={form.shift}
                onChange={e=>setForm(f=>({...f,shift:e.target.value}))}>
                <option value="day">☀️ 주간</option>
                <option value="night">🌙 야간</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">지역</label>
              <select className="field-input" value={form.region}
                onChange={e=>setForm(f=>({...f,region:e.target.value,camp:'',camps:[]}))}>
                <option value="">지역 선택</option>
                {regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            {form.type === 'fixed' && (
              <div className="field">
                <label className="field-label">캠프</label>
                <select className="field-input" value={form.camp}
                  onChange={e=>setForm(f=>({...f,camp:e.target.value}))}>
                  <option value="">캠프 선택</option>
                  {modalCamps.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {form.type === 'backup' && (
              <div className="field">
                <label className="field-label">담당 캠프 (복수 선택)</label>
                <div className="cb-list">
                  {modalCamps.length === 0
                    ? <div style={{padding:8,fontSize:12,color:'var(--text2)'}}>지역을 먼저 선택하세요</div>
                    : modalCamps.map(c=>(
                      <label key={c.id} className="cb-item">
                        <input type="checkbox" checked={form.camps.includes(c.id)}
                          onChange={()=>toggleBackupCamp(c.id)}
                          style={{accentColor:'var(--accent)',cursor:'pointer'}} />
                        <span>{c.name}</span>
                      </label>
                    ))
                  }
                </div>
              </div>
            )}

            <div className="modal-btns">
              <button className="btn btn-secondary" onClick={()=>setShowModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={saveDriver}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
