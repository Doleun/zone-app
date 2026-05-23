import { useState, useEffect, useCallback } from 'react';
import {
  subscribeSimulations,
  createSimulation,
  updateSimulation,
  deleteSimulation,
  applySimulation,
} from '../firebase/db';

export function useSimulation({ realDrivers, showToast, authReady }) {
  const [simulations, setSimulations] = useState([]);
  const [activeSimId, setActiveSimId] = useState(null);

  useEffect(() => {
    if (!authReady) return;
    const unsub = subscribeSimulations(setSimulations);
    return () => unsub();
  }, [authReady]);

  const activeSim = simulations.find(s => s.id === activeSimId) || null;

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

  /** 시뮬 기사 배열 저장 */
  const saveSimDrivers = useCallback(async (simId, drivers) => {
    try {
      await updateSimulation(simId, { drivers });
    } catch(e) {
      showToast('❌ 저장 실패: ' + e.message);
    }
  }, [showToast]);

  /** 시뮬 지도에서 구역 배정/해제 토글 (중복 배정 검증 포함) */
  const toggleSimZone = useCallback(async (sim, selectedDriverId, zoneId) => {
    if (!selectedDriverId || !sim) return;
    const cur = (sim.drivers || []).find(d => d.id === selectedDriverId);
    if (!cur) return;
    const isAssigned = (cur.zones || []).includes(zoneId);

    /* 신규 배정 시 같은 교대 고정기사 중복 검증 */
    if (!isAssigned && cur.type === 'fixed') {
      const other = (sim.drivers || []).find(d =>
        d.id !== selectedDriverId &&
        d.type === 'fixed' &&
        (d.shift || 'day') === (cur.shift || 'day') &&
        (d.zones || []).includes(zoneId)
      );
      if (other) {
        showToast(`❌ ${other.name}에게 이미 배정된 구역입니다`);
        return;
      }
    }

    const newDrivers = (sim.drivers || []).map(d => {
      if (d.id !== selectedDriverId) return d;
      const newZones = isAssigned
        ? (d.zones || []).filter(id => id !== zoneId)
        : [...(d.zones || []), zoneId];
      return { ...d, zones: newZones };
    });
    await saveSimDrivers(sim.id, newDrivers);
  }, [saveSimDrivers, showToast]);

  const applySim = useCallback(async (sim) => {
    const confirmed = window.confirm(
      '⚠️ 실제 배정 데이터를 시뮬레이션 결과로 덮어씁니다.\n' +
      '적용 전 반드시 백업을 완료하세요.\n\n계속하시겠습니까?'
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
    toggleSimZone,
    applySim,
  };
}
