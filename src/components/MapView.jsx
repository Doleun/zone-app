import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { ZONE_COLORS, DRIVER_COLORS } from '../App';

/* ══════════════════════════════════════
   MapView
   - 구역 관리 탭: 개별 구역 폴리곤 + 드래그 레이블 + 그리기
   - 배송구역 탭: 기사별 통합 폴리곤 + 미배정 구역 회색 표시
   - hiddenZones: 가시성 연동
══════════════════════════════════════ */
export default function MapView({
  curTab,
  zones, drivers,
  regions, camps,
  onSave, showToast, nextColor,
  setZones,
  selectedDriverId,
  setSelectedDriverId,
  drawMode,
  onDrawComplete,
  pendingLatlngs,
  hiddenZones,
}) {
  const mapRef                = useRef(null);
  const mapInstance           = useRef(null);
  const zoneLayersRef         = useRef({});
  const driverLayerRef        = useRef(null);
  const driverLabelMarkersRef = useRef([]);
  const unassignedLayerRef    = useRef(null);

  const drawClicksRef  = useRef([]);
  const drawDotsRef    = useRef([]);
  const drawLineRef    = useRef(null);
  const drawPreviewRef = useRef(null);

  const [drawCount, setDrawCount] = useState(0);

  /* ── 지도 초기화 ── */
  useEffect(() => {
    if (mapInstance.current) return;
    const map = L.map(mapRef.current, { center:[36.5,127.8], zoom:7, doubleClickZoom:false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'© OpenStreetMap contributors', maxZoom:19,
    }).addTo(map);
    driverLayerRef.current     = L.layerGroup().addTo(map);
    unassignedLayerRef.current = L.layerGroup().addTo(map);
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

  /* drawMode 전환 */
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

  /* ESC 취소 */
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { clearDrawingArtifacts(true); onDrawComplete(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, clearDrawingArtifacts, onDrawComplete]);

  /* pendingLatlngs null → 미리보기 제거 */
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

    const labelPos = zone.labelPos
      ? L.latLng(zone.labelPos.lat, zone.labelPos.lng)
      : centroid(zone.latlngs);
    const label = L.marker(labelPos, {
      icon: makeZoneIcon(zone), draggable:true, zIndexOffset:1000,
    }).addTo(map);

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

    if (curTab === 'assign') {
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        try { map.removeLayer(poly); map.removeLayer(label); } catch{}
      });
      renderDriversOnMap();
      renderUnassignedZones();
    } else {
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        try { map.addLayer(poly); map.addLayer(label); } catch{}
      });
      applyHiddenZones();
    }
  }, [curTab]);

  /* ══════════════════════════════════════
     미배정 구역 (배송구역 탭)
  ══════════════════════════════════════ */
  const renderUnassignedZones = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    unassignedLayerRef.current?.clearLayers();

    const assignedZoneIds = new Set(
      drivers.filter(d => d.type === 'fixed').flatMap(d => d.zones || [])
    );

    zones.forEach(z => {
      if (assignedZoneIds.has(z.id)) return;
      const lls  = z.latlngs.map(p => L.latLng(p.lat, p.lng));
      const poly = L.polygon(lls, {
        color:'#6b7280', fillColor:'#6b7280', fillOpacity:.15, weight:1.5, dashArray:'4,4',
      });
      const labelPos = z.labelPos
        ? L.latLng(z.labelPos.lat, z.labelPos.lng)
        : centroid(z.latlngs);
      const label = L.marker(labelPos, {
        icon: makeUnassignedIcon(z), zIndexOffset:500,
      });
      unassignedLayerRef.current.addLayer(poly);
      unassignedLayerRef.current.addLayer(label);
    });
  }, [zones, drivers]);

  /* ══════════════════════════════════════
     기사 뷰 렌더
  ══════════════════════════════════════ */
  const renderDriversOnMap = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    driverLayerRef.current?.clearLayers();
    driverLabelMarkersRef.current.forEach(m => { try { map.removeLayer(m); } catch{} });
    driverLabelMarkersRef.current = [];

    drivers.forEach(driver => {
      if (driver.type === 'backup' && driver.id !== selectedDriverId) return;
      const dZones = (driver.zones||[]).map(zid => zones.find(z => z.id === zid)).filter(Boolean);
      if (!dZones.length) return;

      const color   = driverColor(driver.id);
      const total   = getDriverTotal(driver);
      const opacity = selectedDriverId ? (driver.id === selectedDriverId ? .4 : .1) : .3;
      const weight  = selectedDriverId ? (driver.id === selectedDriverId ? 3  : 1)  : 2;

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
          driverLayerRef.current.addLayer(
            L.polygon(lls, { color, fillColor:color, fillOpacity:opacity, weight })
          );
          if (i === 0) {
            const pos = driver.labelPos
              ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
              : centroid(lls.map(p => ({ lat:p.lat, lng:p.lng })));
            const label = L.marker(pos, {
              icon: makeDriverIcon(driver, total), draggable:true, zIndexOffset:1000,
            }).addTo(map);
            driverLabelMarkersRef.current.push(label);
          }
        });
      } catch(e) {
        dZones.forEach(z => {
          driverLayerRef.current.addLayer(
            L.polygon(z.latlngs.map(p => L.latLng(p.lat, p.lng)), { color, fillColor:color, fillOpacity:opacity, weight })
          );
        });
        const pos = driver.labelPos
          ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
          : centroid(dZones[0].latlngs);
        driverLabelMarkersRef.current.push(
          L.marker(pos, { icon: makeDriverIcon(driver, total), draggable:true, zIndexOffset:1000 }).addTo(map)
        );
      }
    });
  }, [drivers, zones, selectedDriverId, driverColor, getDriverTotal]);

  useEffect(() => {
    if (curTab === 'assign') {
      renderDriversOnMap();
      renderUnassignedZones();
    }
  }, [drivers, selectedDriverId, curTab, renderUnassignedZones]);

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
