import { useState } from 'react';
import Modal from '../ui/Modal';

/* ══════════════════════════════════════
   SimPanel
   - 시뮬레이션 목록 표시
   - 생성 / 삭제 / 선택
   - 실제 데이터 적용 (백업 경고 포함)
══════════════════════════════════════ */
export default function SimPanel({
  simulations,
  activeSimId, setActiveSimId,
  activeSim,
  regions, camps,
  currentUser,
  onCreateSim,
  onDeleteSim,
  onApplySim,
  showToast,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', regions: [], camps: [], shifts: ['day', 'night'] });

  /* ── 생성 모달 ── */
  const openCreate = () => {
    setForm({ name: '', regions: [], camps: [], shifts: ['day', 'night'] });
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { showToast('시뮬레이션 이름을 입력하세요'); return; }
    if (!form.camps.length && !form.regions.length) {
      showToast('범위(지역/캠프)를 하나 이상 선택하세요'); return;
    }
    await onCreateSim({
      name: form.name.trim(),
      scope: { regions: form.regions, camps: form.camps, shifts: form.shifts },
      createdBy: currentUser?.email || '',
    });
    setShowCreate(false);
  };

  /* ── 지역 토글 ── */
  const toggleRegion = (rid) => {
    setForm(f => {
      const has = f.regions.includes(rid);
      // 지역 선택 시 해당 지역 캠프 전체 선택/해제
      const regionCamps = camps.filter(c => c.region === rid).map(c => c.id);
      return {
        ...f,
        regions: has ? f.regions.filter(r => r !== rid) : [...f.regions, rid],
        camps:   has
          ? f.camps.filter(c => !regionCamps.includes(c))
          : [...new Set([...f.camps, ...regionCamps])],
      };
    });
  };

  /* ── 캠프 토글 ── */
  const toggleCamp = (cid, regionId) => {
    setForm(f => {
      const hasCamp = f.camps.includes(cid);
      const newCamps = hasCamp ? f.camps.filter(c => c !== cid) : [...f.camps, cid];
      // 해당 지역 캠프 전체 선택 여부에 따라 지역도 토글
      const regionCamps = camps.filter(c => c.region === regionId).map(c => c.id);
      const allSelected = regionCamps.every(c => newCamps.includes(c));
      const newRegions  = allSelected
        ? [...new Set([...f.regions, regionId])]
        : f.regions.filter(r => r !== regionId);
      return { ...f, camps: newCamps, regions: newRegions };
    });
  };

  /* ── 범위 텍스트 ── */
  const scopeText = (sim) => {
    const cNames = (sim.scope?.camps || [])
      .map(cid => camps.find(c => c.id === cid)?.name).filter(Boolean);
    const shifts = sim.scope?.shifts || ['day', 'night'];
    const shiftText = shifts.length === 2 ? '주야간' : shifts[0] === 'day' ? '☀️ 주간' : '🌙 야간';
    return [cNames.length ? cNames.join(', ') : '전체', shiftText].join(' · ');
  };

  /* ── 날짜 포맷 ── */
  const fmtDate = (ts) => {
    if (!ts?.toDate) return '';
    const d = ts.toDate();
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* 상단 */}
      <div style={{ padding:'10px 10px 8px', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:7 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', letterSpacing:'.8px', textTransform:'uppercase' }}>
          시뮬레이션 목록
        </div>
        <button className="btn btn-primary" style={{ fontSize:12, padding:'7px 0' }} onClick={openCreate}>
          ＋ 새 시뮬레이션
        </button>
      </div>

      {/* 목록 */}
      <div className="sb-list">
        {simulations.length === 0
          ? (
            <div className="empty">
              <div className="empty-icon">🧪</div>
              <div className="empty-text">시뮬레이션이 없습니다.<br/>위 버튼으로 생성하세요.</div>
            </div>
          )
          : simulations.map(sim => {
            const isActive = sim.id === activeSimId;
            return (
              <div key={sim.id}
                className={`assign-driver-item ${isActive ? 'active' : ''}`}
                style={{ cursor:'pointer' }}
                onClick={() => setActiveSimId(isActive ? null : sim.id)}
              >
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="item-name" style={{ fontSize:13, fontWeight:700 }}>{sim.name}</div>
                    <div className="item-sub">{scopeText(sim)}</div>
                    <div className="item-sub" style={{ fontSize:10 }}>
                      {fmtDate(sim.createdAt)} · {sim.createdBy}
                    </div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                    {isActive && (
                      <button
                        className="btn btn-primary"
                        style={{ fontSize:10, padding:'4px 8px', whiteSpace:'nowrap' }}
                        onClick={e => { e.stopPropagation(); onApplySim(sim); }}
                      >
                        ✅ 적용
                      </button>
                    )}
                    <button
                      className="icon-btn red"
                      onClick={e => { e.stopPropagation(); onDeleteSim(sim.id); }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {/* 선택된 시뮬 기사 요약 */}
                {isActive && (
                  <div style={{ marginTop:8, fontSize:11, color:'var(--text2)', borderTop:'1px solid var(--border)', paddingTop:6 }}>
                    기사 {(sim.drivers || []).length}명 등록됨
                  </div>
                )}
              </div>
            );
          })
        }
      </div>

      {/* 생성 모달 */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} closeOnOverlay={false} maxWidth={440}>
          <div className="modal-title">🧪 새 시뮬레이션</div>

          <div className="field">
            <label className="field-label">이름</label>
            <input className="field-input" value={form.name}
              placeholder="예: 대구 5캠프 6월 조정"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          </div>

          <div className="field">
            <label className="field-label">교대</label>
            <div style={{ display:'flex', gap:10, padding:'6px 0' }}>
              {[{ val:'day', label:'☀️ 주간' }, { val:'night', label:'🌙 야간' }].map(({ val, label }) => (
                <label key={val} className="cb-item">
                  <input type="checkbox"
                    checked={form.shifts.includes(val)}
                    onChange={() => setForm(f => {
                      const has = f.shifts.includes(val);
                      const next = has ? f.shifts.filter(s => s !== val) : [...f.shifts, val];
                      return { ...f, shifts: next.length ? next : f.shifts }; // 최소 1개 유지
                    })}
                    style={{ accentColor:'var(--accent)' }} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">범위 (지역 / 캠프)</label>
            <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:240, overflowY:'auto',
              border:'1px solid var(--border)', borderRadius:6, padding:'8px 10px' }}>
              {regions.map(r => {
                const rCamps   = camps.filter(c => c.region === r.id);
                const rChecked = form.regions.includes(r.id);
                return (
                  <div key={r.id}>
                    {/* 지역 체크박스 */}
                    <label className="cb-item" style={{ fontWeight:700 }}>
                      <input type="checkbox" checked={rChecked}
                        onChange={() => toggleRegion(r.id)}
                        style={{ accentColor:'var(--accent)' }} />
                      <span>{r.name}</span>
                    </label>
                    {/* 캠프 체크박스 */}
                    <div style={{ marginLeft:20, display:'flex', flexDirection:'column', gap:3, marginTop:3 }}>
                      {rCamps.map(c => (
                        <label key={c.id} className="cb-item">
                          <input type="checkbox" checked={form.camps.includes(c.id)}
                            onChange={() => toggleCamp(c.id, r.id)}
                            style={{ accentColor:'var(--accent)' }} />
                          <span style={{ fontSize:11 }}>{c.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="modal-btns">
            <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>취소</button>
            <button className="btn btn-primary" onClick={handleCreate}>생성</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
