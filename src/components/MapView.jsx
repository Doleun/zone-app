import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { ZONE_COLORS, DRIVER_COLORS } from '../App';

export default function MapView({
  curTab,
  zones, drivers,
  regions, camps,
  onSave, showToast, nextColor,
  setZones,
  setDrivers,
  selectedDriverId,
  setSelectedDriverId,
  drawMode,
  onDrawComplete,
  pendingLatlngs,
  hiddenZones,
  focusZoneId,
  setFocusZoneId,
  focusDriverId,
  onAssignZoneToggle,
}) {
  const mapRef                = useRef(null);
  const mapInstance           = useRef(null);
  const zoneLayersRef         = useRef({});
  const driverLayerRef        = useRef(null);
  const driverLabelMarkersRef = useRef([]);
  const driverPolysRef        = useRef({}); // driverId → [poly, ...]
  const unassignedLayerRef    = useRef(null);
  const backupPreviewLayerRef = useRef(null);
  const assignOverlayRef      = useRef(null); // 배송구역 탭 클릭 오버레이

  const drawClicksRef  = useRef([]);
  const drawDotsRef    = useRef([]);
  const drawLineRef    = useRef(null);
  const drawPreviewRef = useRef(null);
  const drawModeRef    = useRef(false);
  const onAssignZoneToggleRef = useRef(onAssignZoneToggle); // 항상 최신 콜백 참조

  const [drawCount, setDrawCount] = useState(0);

  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { onAssignZoneToggleRef.current = onAssignZoneToggle; }, [onAssignZoneToggle]);

  /* ── 지도 초기화 ── */
  useEffect(() => {
    if (mapInstance.current) return;
    const map = L.map(mapRef.current, { center:[36.5,127.8], zoom:7, doubleClickZoom:false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'© OpenStreetMap contributors', maxZoom:19,
    }).addTo(map);
    driverLayerRef.current        = L.layerGroup().addTo(map);
    unassignedLayerRef.current    = L.layerGroup().addTo(map);
    backupPreviewLayerRef.current = L.layerGroup().addTo(map);
    assignOverlayRef.current      = L.layerGroup().addTo(map);
    mapInstance.current = map;
  }, []);

  /* ── 유틸 ── */
  const centroid = (latlngs) => {
    const pts = latlngs.filter(p => p && 'lat' in p);
    if (!pts.length) return L.latLng(36.5, 127.8);
    return L.latLng(
      pts.reduce((s,p) => s+p.lat, 0) / pts.length,
      pts.reduce((s,p) => s+p.lng, 0) / pts.length,
    );
  };

  const makeZoneIcon = (z) => {
    const day   = parseInt(z.qtyDay   != null ? z.qtyDay   : (z.qty ?? 0)) || 0;
    const night = parseInt(z.qtyNight != null ? z.qtyNight : 0)             || 0;
    return L.divIcon({
      className: 'zlabel',
      html: `<div class="zlabel-inner"><div>${z.name}</div><div class="zlabel-qty">☀️${day} / 🌙${night}</div></div>`,
      iconSize: null, iconAnchor: [0,0],
    });
  };

  const makeDriverIcon = (driver, total) => L.divIcon({
    className: 'zlabel',
    html: `<div class="zlabel-inner"><div>${driver.name}</div><div class="zlabel-qty">${total}개</div></div>`,
    iconSize: null, iconAnchor: [0,0],
  });

  const makeUnassignedIcon = (z) => L.divIcon({
    className: 'zlabel',
    html: `<div class="zlabel-inner" style="opacity:.55"><div>${z.name}</div><div class="zlabel-qty">미배정</div></div>`,
    iconSize: null, iconAnchor: [0,0],
  });

  const getDriverTotal = useCallback((d) => {
    const shift = d.shift || 'day';
    const total = (d.zones||[]).reduce((s, zid) => {
      const z = zones.find(z => z.id === zid); if (!z) return s;
      const raw = shift === 'night'
        ? (z.qtyNight != null ? z.qtyNight : 0)
        : (z.qtyDay   != null ? z.qtyDay   : (z.qty ?? 0));
      return s + (parseInt(raw) || 0);
    }, 0);
    if (d.type === 'backup' && (d.selectedFixed||[]).length > 0)
      return Math.round(total / d.selectedFixed.length);
    return total;
  }, [zones]);

  const driverColor = useCallback((did) => {
    const i = drivers.findIndex(d => d.id === did);
    return DRIVER_COLORS[i % DRIVER_COLORS.length];
  }, [drivers]);

  /* ══════════════════════════════════════
     구역 목록 클릭 시 자동 줌
  ══════════════════════════════════════ */
  useEffect(() => {
    if (!focusZoneId) return;
    const zid = focusZoneId.id;
    const map = mapInstance.current; if (!map) return;
    const zone = zones.find(z => z.id === zid);
    if (!zone || !zone.latlngs?.length) return;
    try {
      const bounds = L.latLngBounds(zone.latlngs.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding:[80, 80], maxZoom:17, animate:true });
    } catch(e) {}

    // A. 선택 구역 강조 + 나머지 흐리게
    Object.entries(zoneLayersRef.current).forEach(([id, { poly }]) => {
      const z = zones.find(z => z.id === id);
      if (!z) return;
      if (id === zid) {
        poly.setStyle({ color: z.color, fillColor: z.color, fillOpacity:.55, weight:4, opacity:1 });
      } else {
        poly.setStyle({ color: z.color, fillColor: z.color, fillOpacity:.06, weight:1, opacity:.3 });
      }
    });

    // B. 깜빡임 효과 (3회)
    const selPoly = zoneLayersRef.current[zid]?.poly;
    if (selPoly) {
      let count = 0;
      const pulse = setInterval(() => {
        count++;
        selPoly.setStyle(count % 2 === 1
          ? { fillOpacity:.1, weight:2 }
          : { fillOpacity:.55, weight:4 }
        );
        if (count >= 6) {
          clearInterval(pulse);
          selPoly.setStyle({ color: zone.color, fillColor: zone.color, fillOpacity:.55, weight:4, opacity:1 });
        }
      }, 220);
    }

    // 2초 후 원래 스타일로 복원
    const timer = setTimeout(() => {
      Object.entries(zoneLayersRef.current).forEach(([id, { poly }]) => {
        const z = zones.find(z => z.id === id);
        if (!z) return;
        poly.setStyle({ color: z.color, fillColor: z.color, fillOpacity:.22, weight:2, opacity:1 });
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [focusZoneId]);

  /* ══════════════════════════════════════
     기사 선택 시 자동 줌 + 하이라이트
  ══════════════════════════════════════ */
  useEffect(() => {
    if (!focusDriverId) return;
    const { id: did } = focusDriverId;
    const map = mapInstance.current; if (!map) return;

    const driver = drivers.find(d => d.id === did);
    if (!driver) return;

    const dZones = (driver.zones || [])
      .map(zid => zones.find(z => z.id === zid))
      .filter(Boolean);

    // 줌
    if (dZones.length) {
      const allLatlngs = dZones.flatMap(z => z.latlngs.map(p => [p.lat, p.lng]));
      try {
        map.fitBounds(L.latLngBounds(allLatlngs), { padding:[80,80], maxZoom:17, animate:true });
      } catch(e) {}
    }

    // renderDriversOnMap이 먼저 실행되도록 setTimeout
    setTimeout(() => {
      // A. 강조 + 흐리게
      Object.entries(driverPolysRef.current).forEach(([id, { polys }]) => {
        const isSel = id === did;
        polys.forEach(poly => poly.setStyle({
          fillOpacity: isSel ? .55 : .06,
          weight:      isSel ? 4   : 1,
          opacity:     isSel ? 1   : .3,
        }));
      });

      // B. 깜빡임 (3회)
      const selPolys = driverPolysRef.current[did]?.polys || [];
      if (selPolys.length) {
        let count = 0;
        const pulse = setInterval(() => {
          count++;
          selPolys.forEach(poly => poly.setStyle(
            count % 2 === 1 ? { fillOpacity:.1, weight:2 } : { fillOpacity:.55, weight:4 }
          ));
          if (count >= 6) {
            clearInterval(pulse);
            selPolys.forEach(poly => poly.setStyle({ fillOpacity:.55, weight:4, opacity:1 }));
          }
        }, 220);
      }

      // 2초 후 복원
      setTimeout(() => {
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
  }, [focusDriverId]);

  /* ══════════════════════════════════════
     백업기사 구역 미리보기
     - 백업기사 선택 + selectedFixed 변경 시
     - 선택된 고정기사들의 구역을 주황 점선으로 표시
  ══════════════════════════════════════ */
  const renderBackupPreview = useCallback(() => {
    backupPreviewLayerRef.current?.clearLayers();
    if (!selectedDriverId || curTab !== 'assign') return;

    const driver = drivers.find(d => d.id === selectedDriverId);
    if (!driver || driver.type !== 'backup') return;

    const selFixed = driver.selectedFixed || [];
    if (!selFixed.length) return;

    // 선택된 고정기사들의 구역 ID 수집
    const previewZoneIds = [...new Set(
      drivers.filter(d => selFixed.includes(d.id)).flatMap(d => d.zones || [])
    )];
    if (!previewZoneIds.length) return;

    const allLatlngs = [];

    previewZoneIds.forEach(zid => {
      const z = zones.find(z => z.id === zid);
      if (!z) return;
      const lls = z.latlngs.map(p => L.latLng(p.lat, p.lng));
      const poly = L.polygon(lls, {
        color:'#f97316', fillColor:'#f97316',
        fillOpacity:.22, weight:2.5, dashArray:'7,4',
      });
      backupPreviewLayerRef.current.addLayer(poly);
      z.latlngs.forEach(p => allLatlngs.push([p.lat, p.lng]));
    });

    // 미리보기 구역으로 자동 줌
    if (allLatlngs.length) {
      try {
        const map = mapInstance.current;
        map.fitBounds(L.latLngBounds(allLatlngs), { padding:[60,60], maxZoom:14, animate:true });
      } catch(e) {}
    }
  }, [selectedDriverId, drivers, zones, curTab]);

  useEffect(() => {
    if (curTab === 'assign') renderBackupPreview();
    else backupPreviewLayerRef.current?.clearLayers();
  }, [selectedDriverId, drivers, curTab, renderBackupPreview]);

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

    poly.on('click', () => { if (drawModeRef.current) return; setFocusZoneId?.({ id: zone.id, ts: Date.now() }); });

    const labelPos = zone.labelPos
      ? L.latLng(zone.labelPos.lat, zone.labelPos.lng)
      : centroid(zone.latlngs);
    const label = L.marker(labelPos, {
      icon: makeZoneIcon(zone), draggable:true, zIndexOffset:1000,
    }).addTo(map);

    label.on('click', () => { if (drawModeRef.current) return; setFocusZoneId?.({ id: zone.id, ts: Date.now() }); });

    label.on('dragend', async () => {
      const pos = label.getLatLng();
      const newZones = zones.map(z =>
        z.id === zone.id ? { ...z, labelPos:{ lat:pos.lat, lng:pos.lng } } : z
      );
      setZones(newZones);
      await onSave(newZones, drivers);
    });

    zoneLayersRef.current[zone.id] = { poly, label };
  }, [zones, drivers, onSave, setZones]);

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
    Object.entries(zoneLayersRef.current).forEach(([zid, { poly, label }]) => {
      if (hiddenZones?.has(zid)) {
        try { map.removeLayer(poly); map.removeLayer(label); } catch{}
      } else {
        try { if (!map.hasLayer(poly))  map.addLayer(poly);  } catch{}
        try { if (!map.hasLayer(label)) map.addLayer(label); } catch{}
      }
    });
  }, [hiddenZones, curTab]);

  useEffect(() => { applyHiddenZones(); }, [hiddenZones, applyHiddenZones]);

  /* ══════════════════════════════════════
     탭 전환
  ══════════════════════════════════════ */
  useEffect(() => {
    const map = mapInstance.current; if (!map) return;
    driverLayerRef.current?.clearLayers();
    driverLabelMarkersRef.current.forEach(m => { try { map.removeLayer(m); } catch{} });
    driverLabelMarkersRef.current = [];
    unassignedLayerRef.current?.clearLayers();
    backupPreviewLayerRef.current?.clearLayers();
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
     미배정 구역
  ══════════════════════════════════════ */
  const renderUnassignedZones = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    unassignedLayerRef.current?.clearLayers();

    const assignedZoneIds = new Set(
      drivers.filter(d => d.type === 'fixed').flatMap(d => d.zones || [])
    );

    zones.forEach(z => {
      if (assignedZoneIds.has(z.id)) return;
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
     배송구역 탭: 구역 클릭 오버레이
     (기사 선택 시 모든 구역 투명 클릭 가능)
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

      // 배정된 구역: 오렌지 테두리, 미배정: 완전 투명 (클릭만 가능)
      const poly = L.polygon(lls, {
        color:       isAssigned ? '#f97316' : '#ffffff',
        fillColor:   isAssigned ? '#f97316' : '#ffffff',
        fillOpacity: isAssigned ? 0.12 : 0.01,
        weight:      isAssigned ? 2.5 : 0,
        opacity:     isAssigned ? 1 : 0,
      });

      poly.on('click', (e) => {
        L.DomEvent.stop(e);
        onAssignZoneToggleRef.current?.(z.id);
      });

      assignOverlayRef.current.addLayer(poly);
    });
  }, [selectedDriverId, drivers, zones, curTab]);

  /* ══════════════════════════════════════
     기사 뷰 렌더
  ══════════════════════════════════════ */
  const renderDriversOnMap = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    driverLayerRef.current?.clearLayers();
    driverLabelMarkersRef.current.forEach(m => { try { map.removeLayer(m); } catch{} });
    driverLabelMarkersRef.current = [];
    driverPolysRef.current = {};

    drivers.forEach(driver => {
      if (driver.type === 'backup' && driver.id !== selectedDriverId) return;
      const dZones = (driver.zones||[]).map(zid => zones.find(z => z.id === zid)).filter(Boolean);
      if (!dZones.length) return;

      const color   = driverColor(driver.id);
      const total   = getDriverTotal(driver);
      const opacity = selectedDriverId ? (driver.id === selectedDriverId ? .4 : .1) : .3;
      const weight  = selectedDriverId ? (driver.id === selectedDriverId ? 3  : 1)  : 2;
      driverPolysRef.current[driver.id] = { color, polys: [] };

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
          const poly = L.polygon(lls, { color, fillColor:color, fillOpacity:opacity, weight });
          poly.on('click', () => {
            setSelectedDriverId(driver.id);
            // focusDriverId는 App에서 setSelectedDriverId 래퍼가 처리
          });
          driverLayerRef.current.addLayer(poly);
          driverPolysRef.current[driver.id]?.polys.push(poly);
          if (i === 0) {
            const pos = driver.labelPos
              ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
              : centroid(lls.map(p => ({ lat:p.lat, lng:p.lng })));
            const label = L.marker(pos, { icon: makeDriverIcon(driver, total), draggable:true, zIndexOffset:1000 }).addTo(map);
            label.on('click', () => setSelectedDriverId(driver.id));
            label.on('dragend', async () => {
              const p = label.getLatLng();
              const newDrivers = drivers.map(d =>
                d.id === driver.id ? { ...d, labelPos:{ lat:p.lat, lng:p.lng } } : d
              );
              setDrivers(newDrivers);
              await onSave(null, newDrivers);
            });
            driverLabelMarkersRef.current.push(label);
          }
        });
      } catch(e) {
        dZones.forEach(z => {
          const poly = L.polygon(z.latlngs.map(p => L.latLng(p.lat, p.lng)), { color, fillColor:color, fillOpacity:opacity, weight });
          poly.on('click', () => setSelectedDriverId(driver.id));
          driverLayerRef.current.addLayer(poly);
          driverPolysRef.current[driver.id]?.polys.push(poly);
        });
        const pos = driver.labelPos
          ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
          : centroid(dZones[0].latlngs);
        const label = L.marker(pos, { icon: makeDriverIcon(driver, total), draggable:true, zIndexOffset:1000 }).addTo(map);
        label.on('click', () => setSelectedDriverId(driver.id));
        label.on('dragend', async () => {
          const p = label.getLatLng();
          const newDrivers = drivers.map(d =>
            d.id === driver.id ? { ...d, labelPos:{ lat:p.lat, lng:p.lng } } : d
          );
          setDrivers(newDrivers);
          await onSave(null, newDrivers);
        });
        driverLabelMarkersRef.current.push(label);
      }
    });
  }, [drivers, zones, selectedDriverId, driverColor, getDriverTotal]);

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
