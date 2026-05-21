import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { getQty, getDriverTotal, driverColor, centroid, makeZoneIcon, makeDriverIcon, makeUnassignedIcon } from '../utils/helpers';

export default function MapView({
  curTab,
  zones, drivers,
  onSave, showToast,
  setZones, setDrivers,
  selectedDriverId, setSelectedDriverId,
  drawMode, onDrawComplete, pendingLatlngs,
  hiddenZones,
  focusZoneId, setFocusZoneId,
  focusDriverId,
  onAssignZoneToggle,
  onBackupFixedToggle,
  assignShift = 'day',
  zoneShiftFilter  = '',
  zoneFilterRegion = '',
  zoneFilterCamp   = '',
  assignFilterRegion = '',
  assignFilterCamp   = '',
  drvregFilterRegion = '',
  drvregFilterCamp   = '',
  drvregFilterShift  = '',
}) {
  const mapRef                = useRef(null);
  const mapInstance           = useRef(null);
  const zoneLayersRef         = useRef({});
  const driverLayerRef        = useRef(null);
  const driverLabelMarkersRef = useRef([]);
  const driverPolysRef        = useRef({});
  const unassignedLayerRef    = useRef(null);
  const assignOverlayRef      = useRef(null);

  const drawClicksRef  = useRef([]);
  const drawDotsRef    = useRef([]);
  const drawLineRef    = useRef(null);
  const drawPreviewRef = useRef(null);

  /* 클릭 핸들러에서 최신값 참조용 ref */
  const drawModeRef            = useRef(false);
  const selectedDriverIdRef    = useRef(null);
  const driversRef             = useRef(drivers);
  const onAssignZoneToggleRef  = useRef(onAssignZoneToggle);
  const onBackupFixedToggleRef = useRef(onBackupFixedToggle);
  const assignShiftRef         = useRef(assignShift);
  const zoneShiftFilterRef     = useRef(zoneShiftFilter);
  const zoneFilterRegionRef   = useRef(zoneFilterRegion);
  const zoneFilterCampRef     = useRef(zoneFilterCamp);
  const assignFilterRegionRef = useRef(assignFilterRegion);
  const assignFilterCampRef   = useRef(assignFilterCamp);
  const drvregFilterRegionRef = useRef(drvregFilterRegion);
  const drvregFilterCampRef   = useRef(drvregFilterCamp);
  const drvregFilterShiftRef  = useRef(drvregFilterShift);

  const [drawCount, setDrawCount] = useState(0);

  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { selectedDriverIdRef.current = selectedDriverId; }, [selectedDriverId]);
  useEffect(() => { driversRef.current = drivers; }, [drivers]);
  useEffect(() => { onAssignZoneToggleRef.current = onAssignZoneToggle; }, [onAssignZoneToggle]);
  useEffect(() => { onBackupFixedToggleRef.current = onBackupFixedToggle; }, [onBackupFixedToggle]);
  useEffect(() => { assignShiftRef.current = assignShift; }, [assignShift]);
  useEffect(() => { zoneShiftFilterRef.current     = zoneShiftFilter;   }, [zoneShiftFilter]);
  useEffect(() => { zoneFilterRegionRef.current   = zoneFilterRegion;  }, [zoneFilterRegion]);
  useEffect(() => { zoneFilterCampRef.current     = zoneFilterCamp;    }, [zoneFilterCamp]);
  useEffect(() => { assignFilterRegionRef.current = assignFilterRegion; }, [assignFilterRegion]);
  useEffect(() => { assignFilterCampRef.current   = assignFilterCamp;   }, [assignFilterCamp]);
  useEffect(() => { drvregFilterRegionRef.current = drvregFilterRegion; }, [drvregFilterRegion]);
  useEffect(() => { drvregFilterCampRef.current   = drvregFilterCamp;   }, [drvregFilterCamp]);
  useEffect(() => { drvregFilterShiftRef.current  = drvregFilterShift;  }, [drvregFilterShift]);

  /* ── 지도 초기화 ── */
  useEffect(() => {
    if (mapInstance.current) return;
    const map = L.map(mapRef.current, { center:[36.5,127.8], zoom:7, doubleClickZoom:false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'© OpenStreetMap contributors', maxZoom:19,
    }).addTo(map);
    driverLayerRef.current    = L.layerGroup().addTo(map);
    unassignedLayerRef.current = L.layerGroup().addTo(map);
    assignOverlayRef.current  = L.layerGroup().addTo(map);
    mapInstance.current = map;
  }, []);

  /* ── 유틸: centroid, getQty, getDriverTotal, driverColor, makeXxxIcon → utils/helpers.js ── */

  /* ── 드라이버 클릭 핸들러 헬퍼 ── */
  const handleDriverClick = useCallback((driver) => {
    const curSel = selectedDriverIdRef.current;
    const curDriver = driversRef.current.find(d => d.id === curSel);
    if (curDriver?.type === 'backup' && driver.type === 'fixed') {
      onBackupFixedToggleRef.current?.(driver.id);
    } else {
      setSelectedDriverId(driver.id);
    }
  }, [setSelectedDriverId]);

  /* ══════════════════════════════════════
     구역 포커스 (줌 + 하이라이트 + 깜빡임)
  ══════════════════════════════════════ */
  useEffect(() => {
    if (!focusZoneId) return;
    const zid = focusZoneId.id;
    const map = mapInstance.current; if (!map) return;
    const zone = zones.find(z => z.id === zid);
    if (!zone || !zone.latlngs?.length) return;

    try {
      map.fitBounds(L.latLngBounds(zone.latlngs.map(p => [p.lat, p.lng])),
        { padding:[80,80], maxZoom:17, animate:true });
    } catch(e) {}

    Object.entries(zoneLayersRef.current).forEach(([id, { poly }]) => {
      const z = zones.find(z => z.id === id); if (!z) return;
      poly.setStyle(id === zid
        ? { color:z.color, fillColor:z.color, fillOpacity:.55, weight:4, opacity:1 }
        : { color:z.color, fillColor:z.color, fillOpacity:.06, weight:1, opacity:.3 }
      );
    });

    const selPoly = zoneLayersRef.current[zid]?.poly;
    if (selPoly) {
      let count = 0;
      const pulse = setInterval(() => {
        count++;
        selPoly.setStyle(count % 2 === 1 ? { fillOpacity:.1, weight:2 } : { fillOpacity:.55, weight:4 });
        if (count >= 6) {
          clearInterval(pulse);
          selPoly.setStyle({ color:zone.color, fillColor:zone.color, fillOpacity:.55, weight:4, opacity:1 });
        }
      }, 220);
    }

    const timer = setTimeout(() => {
      Object.entries(zoneLayersRef.current).forEach(([id, { poly }]) => {
        const z = zones.find(z => z.id === id); if (!z) return;
        poly.setStyle({ color:z.color, fillColor:z.color, fillOpacity:.22, weight:2, opacity:1 });
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [focusZoneId]);

  /* ══════════════════════════════════════
     드라이버 포커스 (줌 + 하이라이트 + 깜빡임)
  ══════════════════════════════════════ */
  useEffect(() => {
    if (!focusDriverId) return;
    const { id: did } = focusDriverId;
    const map = mapInstance.current; if (!map) return;

    const driver = drivers.find(d => d.id === did);
    if (!driver) return;

    const dZones = (driver.zones || []).map(zid => zones.find(z => z.id === zid)).filter(Boolean);
    if (dZones.length) {
      try {
        const bounds = L.latLngBounds(dZones.flatMap(z => z.latlngs.map(p => [p.lat, p.lng])));
        map.fitBounds(bounds, { padding:[80,80], maxZoom:17, animate:true });
      } catch(e) {}
    }

    let pulseInterval = null;
    let restoreTimer  = null;

    setTimeout(() => {
      Object.entries(driverPolysRef.current).forEach(([id, { polys }]) => {
        const isSel = id === did;
        polys.forEach(poly => poly.setStyle({
          fillOpacity: isSel ? .55 : .06,
          weight:      isSel ? 4   : 1,
          opacity:     isSel ? 1   : .3,
        }));
      });

      const selPolys = driverPolysRef.current[did]?.polys || [];
      if (selPolys.length) {
        let count = 0;
        pulseInterval = setInterval(() => {
          count++;
          selPolys.forEach(poly => poly.setStyle(
            count % 2 === 1 ? { fillOpacity:.1, weight:2 } : { fillOpacity:.55, weight:4 }
          ));
          if (count >= 6) {
            clearInterval(pulseInterval);
            selPolys.forEach(poly => poly.setStyle({ fillOpacity:.55, weight:4, opacity:1 }));
          }
        }, 220);
      }

      restoreTimer = setTimeout(() => {
        Object.entries(driverPolysRef.current).forEach(([id, { polys }]) => {
          const isSel = id === did;
          polys.forEach(poly => poly.setStyle({
            fillOpacity: isSel ? .4 : .1,
            weight:      isSel ? 3  : 1,
            opacity:     isSel ? 1  : .3,
          }));
        });
      }, 2000);
    }, 50);

    return () => {
      if (pulseInterval) clearInterval(pulseInterval);
      if (restoreTimer)  clearTimeout(restoreTimer);
    };
  }, [focusDriverId]);

  /* ══════════════════════════════════════
     그리기
  ══════════════════════════════════════ */
  const clearDrawingArtifacts = useCallback((clearPreview = false) => {
    const map = mapInstance.current; if (!map) return;
    drawDotsRef.current.forEach(d => { try { map.removeLayer(d); } catch{} });
    drawDotsRef.current = [];
    if (drawLineRef.current) { try { map.removeLayer(drawLineRef.current); } catch{} drawLineRef.current = null; }
    if (clearPreview && drawPreviewRef.current) {
      try { map.removeLayer(drawPreviewRef.current); } catch{}
      drawPreviewRef.current = null;
    }
    drawClicksRef.current = [];
    setDrawCount(0);
    map.getContainer().style.cursor = '';
  }, []);

  const refreshDrawLine = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    if (drawLineRef.current) { try { map.removeLayer(drawLineRef.current); } catch{} drawLineRef.current = null; }
    const pts = drawClicksRef.current;
    if (pts.length > 1) {
      drawLineRef.current = L.polyline(
        pts.map(p => [p.lat, p.lng]),
        { color:'#3b82f6', weight:2, dashArray:'5,5' }
      ).addTo(map);
    }
  }, []);

  const undoLastPoint = useCallback(() => {
    if (!drawClicksRef.current.length) return;
    const map = mapInstance.current; if (!map) return;
    drawClicksRef.current.pop();
    const lastDot = drawDotsRef.current.pop();
    if (lastDot) { try { map.removeLayer(lastDot); } catch{} }
    refreshDrawLine();
    setDrawCount(drawClicksRef.current.length);
  }, [refreshDrawLine]);

  const finishDraw = useCallback(() => {
    const pts = drawClicksRef.current;
    if (pts.length < 3) { showToast('최소 3개 점이 필요합니다'); return; }
    const map = mapInstance.current;
    if (drawPreviewRef.current) { try { map.removeLayer(drawPreviewRef.current); } catch{} }
    drawPreviewRef.current = L.polygon(
      pts.map(p => [p.lat, p.lng]),
      { color:'#3b82f6', fillColor:'#3b82f6', fillOpacity:.18, weight:2 }
    ).addTo(map);
    onDrawComplete([...pts]);
  }, [showToast, onDrawComplete]);

  useEffect(() => {
    const map = mapInstance.current; if (!map) return;
    if (!drawMode) {
      drawDotsRef.current.forEach(d => { try { map.removeLayer(d); } catch{} });
      drawDotsRef.current = [];
      if (drawLineRef.current) { try { map.removeLayer(drawLineRef.current); } catch{} drawLineRef.current = null; }
      drawClicksRef.current = [];
      setDrawCount(0);
      map.getContainer().style.cursor = '';
      return;
    }
    clearDrawingArtifacts(true);
    map.getContainer().style.cursor = 'crosshair';

    const onClick = (e) => {
      const { lat, lng } = e.latlng;
      drawClicksRef.current.push({ lat, lng });
      const dot = L.circleMarker([lat, lng], {
        radius:5, color:'#3b82f6', fillColor:'#3b82f6', fillOpacity:1, weight:2,
      }).addTo(map);
      drawDotsRef.current.push(dot);
      refreshDrawLine();
      setDrawCount(drawClicksRef.current.length);
    };
    const onDblClick = (e) => { L.DomEvent.stop(e); finishDraw(); };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    return () => { map.off('click', onClick); map.off('dblclick', onDblClick); };
  }, [drawMode, clearDrawingArtifacts, refreshDrawLine, finishDraw]);

  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { clearDrawingArtifacts(true); onDrawComplete(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, clearDrawingArtifacts, onDrawComplete]);

  useEffect(() => {
    if (!pendingLatlngs && drawPreviewRef.current) {
      try { mapInstance.current?.removeLayer(drawPreviewRef.current); } catch{}
      drawPreviewRef.current = null;
    }
  }, [pendingLatlngs]);

  /* ══════════════════════════════════════
     구역 레이어
  ══════════════════════════════════════ */
  const addZoneToMap = useCallback((zone) => {
    const map = mapInstance.current; if (!map) return;
    const existing = zoneLayersRef.current[zone.id];
    if (existing) { try { existing.poly.remove(); existing.label.remove(); } catch{} }

    const lls  = zone.latlngs.map(p => L.latLng(p.lat, p.lng));
    const poly = L.polygon(lls, {
      color: zone.color, fillColor: zone.color, fillOpacity:.22, weight:2,
    }).addTo(map);

    poly.on('click', () => {
      if (drawModeRef.current) return;
      setFocusZoneId?.({ id: zone.id, ts: Date.now() });
    });

    const labelPos = zone.labelPos
      ? L.latLng(zone.labelPos.lat, zone.labelPos.lng)
      : centroid(zone.latlngs);
    const label = L.marker(labelPos, {
      icon: makeZoneIcon(zone), draggable:true, zIndexOffset:1000,
    }).addTo(map);

    label.on('click', () => {
      if (drawModeRef.current) return;
      setFocusZoneId?.({ id: zone.id, ts: Date.now() });
    });

    label.on('dragend', async () => {
      const pos = label.getLatLng();
      const newZones = zones.map(z =>
        z.id === zone.id ? { ...z, labelPos:{ lat:pos.lat, lng:pos.lng } } : z
      );
      setZones(newZones);
      await onSave(newZones, drivers);
    });

    zoneLayersRef.current[zone.id] = { poly, label };
  }, [zones, drivers, onSave, setZones, setFocusZoneId]);

  const removeZoneFromMap = useCallback((zid) => {
    const layer = zoneLayersRef.current[zid]; if (!layer) return;
    try { layer.poly.remove(); layer.label.remove(); } catch{}
    delete zoneLayersRef.current[zid];
  }, []);

  useEffect(() => {
    const map = mapInstance.current; if (!map) return;
    const currentIds = new Set(Object.keys(zoneLayersRef.current));
    const newIds     = new Set(zones.map(z => z.id));
    currentIds.forEach(zid => { if (!newIds.has(zid)) removeZoneFromMap(zid); });
    zones.forEach(z => addZoneToMap(z));
    if (curTab === 'assign') {
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        try { map.removeLayer(poly); map.removeLayer(label); } catch{}
      });
      renderDriversOnMap();
      renderUnassignedZones();
    } else {
      applyHiddenZones();
    }
  }, [zones]);

  const applyHiddenZones = useCallback(() => {
    const map = mapInstance.current;
    if (!map || curTab === 'assign') return;
    /* zone 탭 필터 */
    const shiftFilter  = curTab === 'zone' ? zoneShiftFilterRef.current  : drvregFilterShiftRef.current;
    const regionFilter = curTab === 'zone' ? zoneFilterRegionRef.current : drvregFilterRegionRef.current;
    const campFilter   = curTab === 'zone' ? zoneFilterCampRef.current   : drvregFilterCampRef.current;

    Object.entries(zoneLayersRef.current).forEach(([zid, { poly, label }]) => {
      const zone = zones.find(z => z.id === zid);
      /* 교대 필터: 해당 교대 수량 0이면 숨김 */
      const shiftHidden = shiftFilter && zone && (
        shiftFilter === 'day'
          ? (parseInt(zone.qtyDay != null ? zone.qtyDay : (zone.qty ?? 0)) || 0) === 0
          : (parseInt(zone.qtyNight) || 0) === 0
      );
      /* 지역/캠프 필터 */
      const regionHidden = regionFilter && zone && zone.region !== regionFilter;
      const campHidden   = campFilter   && zone && zone.camp   !== campFilter;
      if (hiddenZones?.has(zid) || shiftHidden || regionHidden || campHidden) {
        try { map.removeLayer(poly); map.removeLayer(label); } catch{}
      } else {
        try { if (!map.hasLayer(poly))  map.addLayer(poly);  } catch{}
        try { if (!map.hasLayer(label)) map.addLayer(label); } catch{}
      }
    });
  }, [hiddenZones, curTab, zones, zoneFilterRegion, zoneFilterCamp, drvregFilterRegion, drvregFilterCamp, drvregFilterShift]);

  useEffect(() => { applyHiddenZones(); }, [hiddenZones, applyHiddenZones]);
  useEffect(() => { if (curTab === 'zone' || curTab === 'drvreg') applyHiddenZones(); }, [zoneShiftFilter]);
  useEffect(() => { if (curTab === 'zone' || curTab === 'drvreg') applyHiddenZones(); }, [zoneFilterRegion]);
  useEffect(() => { if (curTab === 'zone' || curTab === 'drvreg') applyHiddenZones(); }, [zoneFilterCamp]);
  useEffect(() => { if (curTab === 'drvreg') applyHiddenZones(); }, [drvregFilterRegion]);
  useEffect(() => { if (curTab === 'drvreg') applyHiddenZones(); }, [drvregFilterCamp]);
  useEffect(() => { if (curTab === 'drvreg') applyHiddenZones(); }, [drvregFilterShift]);

  /* ══════════════════════════════════════
     탭 전환
  ══════════════════════════════════════ */
  useEffect(() => {
    const map = mapInstance.current; if (!map) return;
    driverLayerRef.current?.clearLayers();
    driverLabelMarkersRef.current.forEach(m => { try { map.removeLayer(m); } catch{} });
    driverLabelMarkersRef.current = [];
    unassignedLayerRef.current?.clearLayers();
    assignOverlayRef.current?.clearLayers();

    if (curTab === 'assign') {
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        try { map.removeLayer(poly); map.removeLayer(label); } catch{}
      });
      renderDriversOnMap();
      renderUnassignedZones();
      renderAssignOverlay();
    } else {
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        try { map.addLayer(poly); map.addLayer(label); } catch{}
      });
      applyHiddenZones();
    }
  }, [curTab]);

  /* ══════════════════════════════════════
     미배정 구역 (해당 교대 qty=0이면 숨김)
  ══════════════════════════════════════ */
  const renderUnassignedZones = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    unassignedLayerRef.current?.clearLayers();

    const shift   = assignShiftRef.current;
    const aRegion = assignFilterRegionRef.current;
    const aCamp   = assignFilterCampRef.current;

    /* 현재 교대의 고정기사가 배정한 구역만 "배정됨"으로 처리 */
    const assignedZoneIds = new Set(
      drivers
        .filter(d => d.type === 'fixed' && (d.shift || 'day') === shift)
        .flatMap(d => d.zones || [])
    );

    zones.forEach(z => {
      if (assignedZoneIds.has(z.id)) return;

      /* 지역/캠프 필터 적용 */
      if (aRegion && z.region !== aRegion) return;
      if (aCamp   && z.camp   !== aCamp)   return;

      /* 해당 교대 수량이 0이면 완전히 숨김 */
      const qty = shift === 'night'
        ? (parseInt(z.qtyNight) || 0)
        : (parseInt(z.qtyDay != null ? z.qtyDay : (z.qty ?? 0)) || 0);
      if (qty === 0) return;

      const lls = z.latlngs.map(p => L.latLng(p.lat, p.lng));
      unassignedLayerRef.current.addLayer(
        L.polygon(lls, { color:'#6b7280', fillColor:'#6b7280', fillOpacity:.15, weight:1.5, dashArray:'4,4' })
      );
      const labelPos = z.labelPos ? L.latLng(z.labelPos.lat, z.labelPos.lng) : centroid(z.latlngs);
      const label = L.marker(labelPos, { icon: makeUnassignedIcon(z), zIndexOffset:500 });
      label.on('click', (e) => {
        L.DomEvent.stop(e);
        onAssignZoneToggleRef.current?.(z.id);
      });
      unassignedLayerRef.current.addLayer(label);
    });
  }, [zones, drivers]);

  /* ══════════════════════════════════════
     배정 오버레이 (클릭으로 구역 토글)
  ══════════════════════════════════════ */
  const renderAssignOverlay = useCallback(() => {
    assignOverlayRef.current?.clearLayers();
    if (!selectedDriverId || curTab !== 'assign') return;

    const driver = drivers.find(d => d.id === selectedDriverId);
    if (!driver) return;

    const assignedIds = new Set(driver.zones || []);

    zones.forEach(z => {
      const isAssigned = assignedIds.has(z.id);
      const lls = z.latlngs.map(p => L.latLng(p.lat, p.lng));
      const poly = L.polygon(lls, {
        color:       isAssigned ? '#f97316' : '#ffffff',
        fillColor:   isAssigned ? '#f97316' : '#ffffff',
        fillOpacity: isAssigned ? 0.12 : 0.01,
        weight:      isAssigned ? 2.5 : 0,
        opacity:     isAssigned ? 1   : 0,
      });
      poly.on('click', (e) => {
        L.DomEvent.stop(e);
        onAssignZoneToggleRef.current?.(z.id);
      });
      assignOverlayRef.current.addLayer(poly);
    });
  }, [selectedDriverId, drivers, zones, curTab]);

  /* ══════════════════════════════════════
     기사 렌더 (현재 교대만 표시)
  ══════════════════════════════════════ */
  const renderDriversOnMap = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    driverLayerRef.current?.clearLayers();
    driverLabelMarkersRef.current.forEach(m => { try { map.removeLayer(m); } catch{} });
    driverLabelMarkersRef.current = [];
    driverPolysRef.current = {};

    const shift = assignShiftRef.current;

    /* 현재 교대 + 지역/캠프 필터 기사만 렌더링 */
    const aRegion = assignFilterRegionRef.current;
    const aCamp   = assignFilterCampRef.current;
    const shiftDrivers = drivers.filter(d => {
      if ((d.shift || 'day') !== shift) return false;
      if (aRegion && d.region !== aRegion) return false;
      if (aCamp) {
        const match = d.type === 'fixed'
          ? d.camp === aCamp
          : (d.camps || []).includes(aCamp);
        if (!match) return false;
      }
      return true;
    });

    shiftDrivers.forEach(driver => {
      if (driver.type === 'backup' && driver.id !== selectedDriverId) return;

      /* 백업기사 zones → 백업 대상 고정기사 zones 실시간 합산 */
      const effectiveZoneIds = driver.type === 'backup'
        ? [...new Set(
            drivers
              .filter(d => (driver.selectedFixed || []).includes(d.id) && d.type === 'fixed')
              .flatMap(d => d.zones || [])
          )]
        : (driver.zones || []);

      const dZones = effectiveZoneIds.map(zid => zones.find(z => z.id === zid)).filter(Boolean);
      if (!dZones.length) return;

      const effectiveDriver = { ...driver, zones: effectiveZoneIds };
      const color   = driverColor(driver.id, drivers);
      const total   = getDriverTotal(effectiveDriver, zones);
      const opacity = selectedDriverId ? (driver.id === selectedDriverId ? .4 : .1) : .3;
      const weight  = selectedDriverId ? (driver.id === selectedDriverId ? 3  : 1)  : 2;
      driverPolysRef.current[driver.id] = { color, polys: [] };

      const addPoly = (lls) => {
        const poly = L.polygon(lls, { color, fillColor:color, fillOpacity:opacity, weight });
        poly.on('click', () => handleDriverClick(driver));
        driverLayerRef.current.addLayer(poly);
        driverPolysRef.current[driver.id].polys.push(poly);
      };

      const addLabel = (pos) => {
        const label = L.marker(pos, { icon: makeDriverIcon(driver, total), draggable:true, zIndexOffset:1000 }).addTo(map);
        label.on('click', () => handleDriverClick(driver));
        label.on('dragend', async () => {
          const p = label.getLatLng();
          const newDrivers = driversRef.current.map(d =>
            d.id === driver.id ? { ...d, labelPos:{ lat:p.lat, lng:p.lng } } : d
          );
          setDrivers(newDrivers);
          await onSave(null, newDrivers);
        });
        driverLabelMarkersRef.current.push(label);
      };

      try {
        const features = dZones.map(z => {
          const ring = z.latlngs.map(p => [p.lng, p.lat]);
          ring.push(ring[0]);
          return turf.polygon([ring]);
        });
        const unified = features.length === 1
          ? features[0]
          : features.reduce((acc, f) => turf.union(turf.featureCollection([acc, f])));

        const geom  = unified.geometry;
        const polys = geom.type === 'Polygon'
          ? [geom.coordinates[0].map(c => L.latLng(c[1], c[0]))]
          : geom.coordinates.map(p => p[0].map(c => L.latLng(c[1], c[0])));

        polys.forEach((lls, i) => {
          addPoly(lls);
          if (i === 0) {
            const pos = driver.labelPos
              ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
              : centroid(lls.map(p => ({ lat:p.lat, lng:p.lng })));
            addLabel(pos);
          }
        });
      } catch(e) {
        dZones.forEach(z => addPoly(z.latlngs.map(p => L.latLng(p.lat, p.lng))));
        const pos = driver.labelPos
          ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
          : centroid(dZones[0].latlngs);
        addLabel(pos);
      }
    });
  }, [drivers, zones, selectedDriverId, handleDriverClick, onSave, setDrivers]);

  /* assignShift 변경 시 지도 재렌더 */
  useEffect(() => {
    if (curTab !== 'assign') return;
    renderDriversOnMap();
    renderUnassignedZones();
    renderAssignOverlay();
  }, [assignShift]);
  useEffect(() => {
    if (curTab !== 'assign') return;
    renderDriversOnMap();
    renderUnassignedZones();
  }, [assignFilterRegion, assignFilterCamp]);

  useEffect(() => {
    if (curTab === 'assign') {
      renderDriversOnMap();
      renderUnassignedZones();
      renderAssignOverlay();
    }
  }, [drivers, selectedDriverId, curTab, renderUnassignedZones, renderAssignOverlay]);

  useEffect(() => {
    setTimeout(() => mapInstance.current?.invalidateSize(), 100);
  }, [curTab]);

  return (
    <div style={{ position:'relative', flex:1 }}>
      <div ref={mapRef} style={{ width:'100%', height:'100%', zIndex:1 }} />

      {drawMode && (
        <div className="draw-banner">
          <span>🖊️ 구역 그리기</span>
          <span className="draw-count">{drawCount}개</span>
          <div className="draw-btns">
            <button className="dbtn dbtn-undo" onClick={undoLastPoint} disabled={drawCount === 0}>
              ↩ 되돌리기
            </button>
            <button className="dbtn dbtn-ok" onClick={finishDraw} disabled={drawCount < 3}>
              ✓ 완료{drawCount < 3 ? ` (${3 - drawCount}개 더)` : ''}
            </button>
            <button className="dbtn dbtn-cancel" onClick={() => { clearDrawingArtifacts(true); onDrawComplete(null); }}>
              ✖ 취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
