import { useState, useEffect, useCallback } from 'react';
import {
  subscribeSimulations,
  createSimulation,
  updateSimulation,
  deleteSimulation,
  applySimulation,
} from '../firebase/db';

/* ══════════════════════════════════════
   useSimulation
   - 시뮬 목록 구독
   - 현재 선택된 시뮬 관리
   - 시뮬 내 기사 CRUD
   - 실제 데이터 적용
══════════════════════════════════════ */
export function useSimulation({ realDrivers, showToast }) {
  const [simulations,    setSimulations]    = useState([]);
  const [activeSimId,    setActiveSimId]    = useState(null);

  /* 목록 구독 */
  useEffect(() => {
    const unsub = subscribeSimulations(setSimulations);
    return () => unsub();
  }, []);

  /* 현재 활성 시뮬 객체 */
  const activeSim = simulations.find(s => s.id === activeSimId) || null;

  /* ── 시뮬 생성 ── */
  const createSim = useCallback(async ({ name, scope, createdBy }) => {
    if (!name.trim()) { showToast('시뮬레이션 이름을 입력하세요'); return null; }
    try {
      const id = await createSimulation({ name: name.trim(), scope, createdBy });
      setActiveSimId(id);
      showToast('✅ 시뮬레이션 생성 완료');
      return id;
    } catch(e) {
      showToast('❌ 생성 실패: ' + e.message);
      return null;
    }
  }, [showToast]);

  /* ── 시뮬 삭제 ── */
  const deleteSim = useCallback(async (simId) => {
    if (!window.confirm('이 시뮬레이션을 삭제할까요?')) return;
    try {
      await deleteSimulation(simId);
      if (activeSimId === simId) setActiveSimId(null);
      showToast('✅ 삭제 완료');
    } catch(e) {
      showToast('❌ 삭제 실패: ' + e.message);
    }
  }, [activeSimId, showToast]);

  /* ── 시뮬 기사 저장 ── */
  const saveSimDrivers = useCallback(async (simId, drivers) => {
    try {
      await updateSimulation(simId, { drivers });
    } catch(e) {
      showToast('❌ 저장 실패: ' + e.message);
    }
  }, [showToast]);

  /* ── 실제 데이터 적용 ── */
  const applySim = useCallback(async (sim) => {
    const confirmed = window.confirm(
      '⚠️ 실제 배정 데이터를 시뮬레이션 결과로 덮어씁니다.\n' +
      '적용 전 반드시 백업을 완료하세요.\n\n' +
      '계속하시겠습니까?'
    );
    if (!confirmed) return;
    try {
      await applySimulation(sim, realDrivers);
      showToast('✅ 시뮬레이션 적용 완료');
    } catch(e) {
      showToast('❌ 적용 실패: ' + e.message);
    }
  }, [realDrivers, showToast]);

  return {
    simulations,
    activeSimId, setActiveSimId,
    activeSim,
    createSim,
    deleteSim,
    saveSimDrivers,
    applySim,
  };
}
