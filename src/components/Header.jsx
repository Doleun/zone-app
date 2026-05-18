import { useState } from 'react';
import * as XLSX from 'xlsx';
import { getAllForBackup, restoreBackup, setUserDoc, deleteUserDoc, getUserDoc } from '../firebase/db';

export default function Header({
  curTab, setCurTab,
  currentUser, currentRole,
  saveState,
  zones, drivers, regions, camps, users,
  onSave, showToast, logout,
}) {
  const isMaster = currentRole === 'master';

  const [showUserMgmt,  setShowUserMgmt]  = useState(false);
  const [showManual,    setShowManual]    = useState(false);
  const [inviteEmail,   setInviteEmail]   = useState('');
  const [inviteRole,    setInviteRole]    = useState('staff');

  /* ── Excel 내보내기 ── */
  const exportExcel = () => {
    if (!zones.length) { showToast('내보낼 구역 데이터가 없습니다'); return; }
    const rows = zones.map(z => ({
      '구역ID':   z.id,
      '지역':     regions.find(r => r.id === z.region)?.name || '',
      '캠프':     camps.find(c => c.id === z.camp)?.name     || '',
      '구역명':   z.name,
      '주간수량': z.qtyDay   != null ? z.qtyDay   : (z.qty ?? 0),
      '야간수량': z.qtyNight != null ? z.qtyNight : 0,
      '색상':     z.color,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:18},{wch:10},{wch:10},{wch:12},{wch:8},{wch:8},{wch:10}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '구역목록');
    XLSX.writeFile(wb, '구역데이터.xlsx');
    showToast('✅ Excel 내보내기 완료 (구역ID는 수정하지 마세요)');
  };

  /* ── Excel 가져오기 ── */
  const importExcel = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb   = XLSX.read(ev.target.result, { type: 'binary' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        if (!rows.length) { showToast('❌ 데이터가 없습니다'); return; }
        if (!('구역ID' in rows[0])) { showToast('❌ 구역ID 컬럼이 없습니다. 먼저 내보내기 후 수정하세요'); return; }
        let updated = 0, notFound = [];
        const newZones = zones.map(z => {
          const row = rows.find(r => String(r['구역ID'] || '').trim() === z.id);
          if (!row) { notFound.push(z.name); return z; }
          updated++;
          return {
            ...z,
            name:     String(row['구역명'] || z.name).trim(),
            qtyDay:   parseInt(row['주간수량']) || 0,
            qtyNight: parseInt(row['야간수량']) || 0,
            color:    /^#[0-9A-Fa-f]{6}$/.test(String(row['색상']||'').trim())
                        ? String(row['색상']).trim() : z.color,
          };
        });
        await onSave(newZones, drivers);
        let msg = `✅ ${updated}개 업데이트 완료`;
        if (notFound.length) msg += ` / 미매칭 ${notFound.length}개`;
        showToast(msg);
      } catch(err) { showToast('❌ 파일 오류: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsBinaryString(file);
  };

  /* ── 백업 ── */
  const exportBackup = async () => {
    try {
      const { users: u, regions: r, camps: c } = await getAllForBackup();
      const backup = { exportedAt: new Date().toISOString(), zones, drivers, users: u, regions: r, camps: c };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type:'application/json' }));
      a.download = `backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      showToast('✅ 백업 완료');
    } catch(e) { showToast('❌ 백업 실패: ' + e.message); }
  };

  /* ── 복원 ── */
  const importBackup = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.confirm('⚠️ 모든 데이터가 백업 파일로 덮어씌워집니다. 계속할까요?')) { e.target.value=''; return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const b = JSON.parse(ev.target.result);
        if (!b.zones || !b.drivers) throw new Error('올바른 백업 파일이 아닙니다');
        await restoreBackup(b);
        showToast('✅ 복원 완료 — 새로고침합니다');
        setTimeout(() => location.reload(), 1500);
      } catch(err) { showToast('❌ 복원 실패: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  /* ── 사용자 초대 ── */
  const inviteUser = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) { showToast('이메일을 입력하세요'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('올바른 이메일 형식이 아닙니다'); return; }
    if (users.find(u => u.email === email)) { showToast('이미 등록된 사용자입니다'); return; }
    try {
      await setUserDoc(email, { role: inviteRole, name: email });
      setInviteEmail('');
      showToast('✅ 초대 완료: ' + email);
    } catch(e) { showToast('❌ 초대 실패: ' + e.message); }
  };

  /* ── 권한 변경 ── */
  const changeRole = async (email, newRole) => {
    if (email === currentUser?.email && newRole !== 'master') {
      if (!window.confirm('본인 권한을 변경하면 사용자 관리 기능을 잃습니다. 계속할까요?')) return;
    }
    try {
      const snap = await getUserDoc(email);
      await setUserDoc(email, { ...snap.data(), role: newRole });
      showToast('✅ 권한 변경 완료');
    } catch(e) { showToast('❌ 변경 실패: ' + e.message); }
  };

  /* ── 사용자 삭제 ── */
  const removeUser = async (email) => {
    if (email === currentUser?.email) { showToast('본인 계정은 삭제할 수 없습니다'); return; }
    if (!window.confirm(email + ' 을 삭제할까요?')) return;
    try { await deleteUserDoc(email); showToast('✅ 삭제 완료'); }
    catch(e) { showToast('❌ 삭제 실패: ' + e.message); }
  };

  const saveText = saveState === 'saving' ? '● 저장 중...' : saveState === 'saved' ? '● 저장됨' : '●';

  const tabStyle = (key) => ({
    padding:'6px 13px', borderRadius:7, border:'none',
    background: curTab === key ? 'var(--accent)' : 'transparent',
    color: curTab === key ? '#fff' : 'var(--text2)',
    fontFamily:'Noto Sans KR, sans-serif', fontSize:12,
    fontWeight:600, cursor:'pointer', whiteSpace:'nowrap',
  });

  return (
    <>
      <div style={{
        background:'var(--sidebar)', borderBottom:'1px solid var(--border)',
        height:50, display:'flex', alignItems:'center',
        padding:'0 14px', gap:6, flexShrink:0, overflowX:'auto',
      }}>
        <span style={{ fontWeight:900, fontSize:15, color:'var(--accent)', whiteSpace:'nowrap', letterSpacing:'-.5px' }}>
          📦 구역 관리
        </span>
        <span className={`save-indicator ${saveState}`}>{saveText}</span>

        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <img src={currentUser?.photoURL || ''} alt=""
            style={{ width:28, height:28, borderRadius:'50%', border:'2px solid var(--border)', objectFit:'cover' }} />
          <span className="user-name" style={{ fontSize:11, color:'var(--text3)', maxWidth:80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {currentUser?.displayName || currentUser?.email}
          </span>

          {isMaster && <>
            <button className="hbtn" onClick={() => setShowUserMgmt(true)}>👥 사용자</button>
            <button className="hbtn" onClick={exportBackup}>💾 백업</button>
            <label className="hbtn" style={{ cursor:'pointer' }}>
              📂 복원<input type="file" accept=".json" onChange={importBackup} style={{ display:'none' }} />
            </label>
            <button className="hbtn" onClick={() => setShowManual(true)}>📋 매뉴얼</button>
          </>}

          <button className="hbtn" onClick={exportExcel}>📥 Excel 내보내기</button>
          <label className="hbtn" style={{ cursor:'pointer' }}>
            📤 Excel 가져오기<input type="file" accept=".xlsx,.xls" onChange={importExcel} style={{ display:'none' }} />
          </label>
          <button className="logout-btn" onClick={logout}>로그아웃</button>
        </div>

        {/* 탭 — 등록 그룹 | 구분선 | 할당 그룹 */}
        <div style={{ display:'flex', gap:3, marginLeft:'auto', flexShrink:0, alignItems:'center' }}>
          {isMaster && <button style={tabStyle('rc')}     onClick={() => setCurTab('rc')}>캠프/지역</button>}
          <button style={tabStyle('drvreg')} onClick={() => setCurTab('drvreg')}>기사</button>
          <button style={tabStyle('zone')}   onClick={() => setCurTab('zone')}>구역</button>
          <div style={{ width:1, height:20, background:'var(--border)', margin:'0 8px', opacity:.6 }} />
          <button style={tabStyle('assign')} onClick={() => setCurTab('assign')}>배송할당</button>
        </div>
      </div>

      {/* 사용자 관리 모달 */}
      {showUserMgmt && (
        <div className="overlay" onClick={() => setShowUserMgmt(false)}>
          <div className="modal" style={{ maxWidth:420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">👥 사용자 관리</div>
            <div style={{ marginBottom:16, maxHeight:220, overflowY:'auto', border:'1px solid var(--border)', borderRadius:7, padding:4 }}>
              {users.length === 0
                ? <div style={{ padding:10, fontSize:12, color:'var(--text2)', textAlign:'center' }}>사용자 없음</div>
                : users.map(u => (
                  <div key={u.email} className="item" style={{ cursor:'default' }}>
                    <div className="item-body">
                      <div className="item-name" style={{ fontSize:12 }}>{u.email}</div>
                      <div className="item-sub">
                        {u.role === 'master' ? '👑 master' : '👤 staff'}
                        {u.email === currentUser?.email ? ' (나)' : ''}
                      </div>
                    </div>
                    {u.email !== currentUser?.email && (
                      <div className="item-actions">
                        <button className="icon-btn" onClick={() => changeRole(u.email, u.role === 'master' ? 'staff' : 'master')}>
                          {u.role === 'master' ? '👤' : '👑'}
                        </button>
                        <button className="icon-btn red" onClick={() => removeUser(u.email)}>🗑️</button>
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:14 }}>
              <div className="field-label" style={{ display:'block', marginBottom:8 }}>새 사용자 초대</div>
              <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                <input className="field-input" style={{ flex:1 }} placeholder="Google 이메일"
                  value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && inviteUser()} />
                <select className="field-input" style={{ width:90, flexShrink:0 }}
                  value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                  <option value="staff">staff</option>
                  <option value="master">master</option>
                </select>
              </div>
              <button className="btn btn-primary" onClick={inviteUser}>초대</button>
            </div>
            <div className="modal-btns">
              <button className="btn btn-secondary" onClick={() => setShowUserMgmt(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {/* 서버 매뉴얼 모달 */}
      {showManual && (
        <div className="overlay" onClick={() => setShowManual(false)}>
          <div className="modal" style={{ maxWidth:480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">📋 서버 매뉴얼</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14, fontSize:12 }}>

              <div>
                <div style={{ fontWeight:700, color:'var(--accent)', marginBottom:6 }}>🚀 개발 서버 실행</div>
                <pre style={{ background:'var(--surface2)', borderRadius:6, padding:'10px 12px', margin:0, fontSize:11, lineHeight:1.8, overflowX:'auto' }}>
{`cd C:\\zone-app
npm run dev`}
                </pre>
              </div>

              <div>
                <div style={{ fontWeight:700, color:'var(--accent)', marginBottom:6 }}>💾 작업 후 저장 (Push)</div>
                <pre style={{ background:'var(--surface2)', borderRadius:6, padding:'10px 12px', margin:0, fontSize:11, lineHeight:1.8, overflowX:'auto' }}>
{`git add .
git commit -m "작업내용"
git push`}
                </pre>
              </div>

              <div>
                <div style={{ fontWeight:700, color:'var(--accent)', marginBottom:6 }}>📥 다른 PC에서 최신 받기 (Pull)</div>
                <pre style={{ background:'var(--surface2)', borderRadius:6, padding:'10px 12px', margin:0, fontSize:11, lineHeight:1.8, overflowX:'auto' }}>
{`cd C:\\zone-app
git pull`}
                </pre>
              </div>

              <div>
                <div style={{ fontWeight:700, color:'var(--accent)', marginBottom:6 }}>🌐 배포</div>
                <pre style={{ background:'var(--surface2)', borderRadius:6, padding:'10px 12px', margin:0, fontSize:11, lineHeight:1.8, overflowX:'auto' }}>
{`npm run build
firebase deploy`}
                </pre>
              </div>

            </div>
            <div className="modal-btns">
              <button className="btn btn-secondary" onClick={() => setShowManual(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
