import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { DRIVER_COLORS } from '../../App';

/* ══════════════════════════════════════
   SimMapView
   - 좌: 실제 배정 지도
   - 우: 시뮬 배정 지도
   - 드래그로 비율 조절
   - 같이보기 / 따로보기 토글
   - scope 범위 내 구역만 표시
══════════════════════════════════════ */
export default function SimMapView({
  sim,
  zones,              // 실제 구역 (scope 필터링은 내부에서)
  realDrivers,        // 실제 기사 배정
  simDrivers,         // 시뮬 기사 배정
  selectedRealDriverId,
  selectedSimDriverId,
  setSelectedSimDriverId,
  splitView,          // true: 분할, false: 시뮬만
  onSimZoneToggle,    // 시뮬 지도에서 구역 클릭 배정
}) {
  /* ── 컨테이너 ref ── */
  const containerRef  = useRef(null);
  const realMapRef    = useRef(null);
  const simMapRef     = useRef(null);
  const realInstance  = useRef(null);
  const simInstance   = useRef(null);

  /* ── 레이어 ref ── */
  const realZoneLayersRef = useRef({});
  const simZoneLayersRef  = useRef({});
  const realDriverLayerRef = useRef(null);
  const simDriverLayerRef  = useRef(null);
  const simOverlayRef      = useRef(null);

  /* ── 드래그 비율 ── */
  const [splitRatio, setSplitRatio] = useState(50); // 좌측 % 비율
  const isDragging = useRef(false);

  /* ── scope 범위 구역 ── */
  const scopeCamps = new Set(sim?.scope?.camps || []);
  const scopeZones = zones.filter(z => scopeCamps.has(z.camp));

  /* ── 드래그 핸들러 ── */
  const onDividerMouseDown = (e) => {
    e.preventDefault();
    isDragging.current = true;
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.min(80, Math.max(20, ratio)));
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  /* 비율 변경 시 지도 크기 갱신 */
  useEffect(() => {
    setTimeout(() => {
      realInstance.current?.invalidateSize();
      simInstance.current?.invalidateSize();
    }, 50);
  }, [splitRatio, splitView]);

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
    const day   = parseInt(z.qtyDay   ?? (z.qty ?? 0)) || 0;
    const night = parseInt(z.qtyNight ?? 0)             || 0;
    return L.divIcon({
      className:'zlabel',
      html:`<div class="zlabel-inner"><div>${z.name}</div><div class="zlabel-qty">☀️${day}/🌙${night}</div></div>`,
      iconSize:null, iconAnchor:[0,0],
    });
  };

  const makeDriverIcon = (driver, total) => L.divIcon({
    className:'zlabel',
    html:`<div class="zlabel-inner"><div>${driver.name}</div><div class="zlabel-qty">${total}개</div></div>`,
    iconSize:null, iconAnchor:[0,0],
  });

  const getDriverTotal = (d, zoneList) => {
    const shift = d.shift || 'day';
    const total = (d.zones||[]).reduce((s, zid) => {
      const z = zoneList.find(z => z.id === zid); if (!z) return s;
      const raw = shift === 'night' ? (z.qtyNight ?? 0) : (z.qtyDay ?? (z.qty ?? 0));
      return s + (parseInt(raw) || 0);
    }, 0);
    if (d.type === 'backup' && (d.selectedFixed||[]).length > 0)
      return Math.round(total / d.selectedFixed.length);
    return total;
  };

  const driverColorFor = (did, drivers) => {
    const i = drivers.findIndex(d => d.id === did);
    return DRIVER_COLORS[i % DRIVER_COLORS.length];
  };

  /* ── 지도 초기화 ── */
  const initMap = (ref, instanceRef, layerGroupRefs) => {
    if (instanceRef.current || !ref.current) return;
    const map = L.map(ref.current, { center:[36.5,127.8], zoom:7, doubleClickZoom:false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'© OpenStreetMap contributors', maxZoom:19,
    }).addTo(map);
    layerGroupRefs.forEach(ref => {
      ref.current = L.layerGroup().addTo(map);
    });
    instanceRef.current = map;
  };

  useEffect(() => {
    initMap(realMapRef, realInstance, [realDriverLayerRef]);
    initMap(simMapRef,  simInstance,  [simDriverLayerRef, simOverlayRef]);
  }, []);

  /* scope 구역 변경 시 시뮬 지도만 구역 레이어 갱신 */
  useEffect(() => {
    renderZones(simInstance, simZoneLayersRef);
  }, [scopeZones.length, sim?.id]);

  /* 실제 기사 변경 시 */
  useEffect(() => {
    renderDrivers(realInstance, realDriverLayerRef, realDrivers, scopeZones, selectedRealDriverId, false);
  }, [realDrivers, selectedRealDriverId]);

  /* 시뮬 기사 변경 시 */
  useEffect(() => {
    renderDrivers(simInstance, simDriverLayerRef, simDrivers, scopeZones, selectedSimDriverId, true);
    renderSimOverlay();
  }, [simDrivers, selectedSimDriverId]);

  /* ── 구역 레이어 렌더 (시뮬 지도 전용) ── */
  const renderZones = (mapRef, layersRef) => {
    const map = mapRef.current; if (!map) return;

    Object.values(layersRef.current).forEach(({ poly, label }) => {
      try { map.removeLayer(poly); map.removeLayer(label); } catch{}
    });
    layersRef.current = {};

    scopeZones.forEach(z => {
      const lls  = z.latlngs.map(p => L.latLng(p.lat, p.lng));
      const poly = L.polygon(lls, {
        color: z.color, fillColor: z.color, fillOpacity:.2, weight:2,
      }).addTo(map);

      const labelPos = z.labelPos ? L.latLng(z.labelPos.lat, z.labelPos.lng) : centroid(z.latlngs);
      const label = L.marker(labelPos, {
        icon: makeZoneIcon(z), zIndexOffset:1000,
      }).addTo(map);

      layersRef.current[z.id] = { poly, label };
    });

    if (scopeZones.length > 0) {
      try {
        const allPts = scopeZones.flatMap(z => z.latlngs.map(p => [p.lat, p.lng]));
        map.fitBounds(L.latLngBounds(allPts), { padding:[40,40], animate:false });
      } catch(e) {}
    }
  };

  /* 실제 지도 scope 기준 초기 줌 */
  useEffect(() => {
    if (!scopeZones.length || !realInstance.current) return;
    try {
      const allPts = scopeZones.flatMap(z => z.latlngs.map(p => [p.lat, p.lng]));
      realInstance.current.fitBounds(L.latLngBounds(allPts), { padding:[40,40], animate:false });
    } catch(e) {}
  }, [scopeZones.length, sim?.id]);

  /* ── 기사 레이어 렌더 ── */
  const renderDrivers = (mapRef, layerRef, drivers, zoneList, selDriverId, isSim) => {
    const map = mapRef.current; if (!map) return;
    layerRef.current?.clearLayers();

    drivers.forEach(driver => {
      if (driver.type === 'backup' && driver.id !== selDriverId) return;
      const dZones = (driver.zones||[]).map(zid => zoneList.find(z => z.id === zid)).filter(Boolean);
      if (!dZones.length) return;

      const color   = driverColorFor(driver.id, drivers);
      const total   = getDriverTotal(driver, zoneList);
      const opacity = selDriverId ? (driver.id === selDriverId ? .45 : .1) : .3;
      const weight  = selDriverId ? (driver.id === selDriverId ? 3   : 1)  : 2;

      const addPoly = (lls) => {
        const poly = L.polygon(lls, { color, fillColor:color, fillOpacity:opacity, weight });
        if (isSim) poly.on('click', () => setSelectedSimDriverId(driver.id));
        layerRef.current.addLayer(poly);
      };

      try {
        const features = dZones.map(z => {
          const ring = z.latlngs.map(p => [p.lng, p.lat]); ring.push(ring[0]);
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
            const label = L.marker(pos, {
              icon: makeDriverIcon(driver, total), zIndexOffset:1000,
            });
            if (isSim) label.on('click', () => setSelectedSimDriverId(driver.id));
            layerRef.current.addLayer(label);
          }
        });
      } catch(e) {
        dZones.forEach(z => addPoly(z.latlngs.map(p => L.latLng(p.lat, p.lng))));
        const pos = driver.labelPos
          ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
          : centroid(dZones[0].latlngs);
        const label = L.marker(pos, { icon: makeDriverIcon(driver, total), zIndexOffset:1000 });
        if (isSim) label.on('click', () => setSelectedSimDriverId(driver.id));
        layerRef.current.addLayer(label);
      }
    });
  };

  /* ── 시뮬 오버레이 (구역 클릭 배정) ── */
  const renderSimOverlay = useCallback(() => {
    simOverlayRef.current?.clearLayers();
    if (!selectedSimDriverId) return;

    const driver = simDrivers.find(d => d.id === selectedSimDriverId);
    if (!driver) return;

    const assignedIds = new Set(driver.zones || []);

    scopeZones.forEach(z => {
      const isAssigned = assignedIds.has(z.id);
      const lls = z.latlngs.map(p => L.latLng(p.lat, p.lng));
      const poly = L.polygon(lls, {
        color:       isAssigned ? '#f97316' : '#fff',
        fillColor:   isAssigned ? '#f97316' : '#fff',
        fillOpacity: isAssigned ? .15 : .01,
        weight:      isAssigned ? 2.5 : 0,
        opacity:     isAssigned ? 1   : 0,
      });
      poly.on('click', (e) => { L.DomEvent.stop(e); onSimZoneToggle?.(z.id); });
      simOverlayRef.current.addLayer(poly);
    });
  }, [selectedSimDriverId, simDrivers, scopeZones, onSimZoneToggle]);

  useEffect(() => { renderSimOverlay(); }, [renderSimOverlay]);

  /* ── 지도 크기 갱신 ── */
  useEffect(() => {
    setTimeout(() => {
      realInstance.current?.invalidateSize();
      simInstance.current?.invalidateSize();
    }, 100);
  }, [splitView]);

  return (
    <div ref={containerRef} style={{ display:'flex', flex:1, position:'relative', overflow:'hidden' }}>

      {/* 실제 지도 (splitView일 때만 보임) */}
      <div style={{ display:'flex', flexDirection:'column', width:`${splitRatio}%`, position:'relative',
        visibility: splitView ? 'visible' : 'hidden',
        width: splitView ? `${splitRatio}%` : '0%',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
          background:'rgba(0,0,0,.55)', color:'#fff', fontSize:11, fontWeight:700,
          padding:'4px 12px', borderRadius:20, zIndex:1000, pointerEvents:'none',
        }}>📍 현재 배정</div>
        <div ref={realMapRef} style={{ flex:1, height:'100%' }} />
      </div>

      {/* 구분선 드래그 핸들 */}
      {splitView && (
        <div
          onMouseDown={onDividerMouseDown}
          style={{
            width:6, background:'var(--border)', cursor:'col-resize',
            flexShrink:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center',
          }}
        >
          <div style={{ width:2, height:40, background:'var(--text2)', borderRadius:2, opacity:.5 }} />
        </div>
      )}

      {/* 시뮬 지도 */}
      <div style={{ display:'flex', flexDirection:'column', flex:1, position:'relative' }}>
        <div style={{
          position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
          background:'rgba(59,130,246,.8)', color:'#fff', fontSize:11, fontWeight:700,
          padding:'4px 12px', borderRadius:20, zIndex:1000, pointerEvents:'none',
        }}>🧪 {sim?.name || '시뮬레이션'}</div>
        <div ref={simMapRef} style={{ flex:1 }} />
      </div>
    </div>
  );
}
