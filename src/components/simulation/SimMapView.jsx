import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { getDriverTotal, driverColor, centroid, makeDriverIcon, makeUnassignedIcon } from '../../utils/helpers';

export default function SimMapView({
  sim,
  zones,
  realDrivers,
  simDrivers,
  selectedRealDriverId,
  selectedSimDriverId,
  setSelectedSimDriverId,
  splitView,
  onSimZoneToggle,
  onSaveSimDrivers,
}) {
  const containerRef       = useRef(null);
  const realMapRef         = useRef(null);
  const simMapRef          = useRef(null);
  const realInstance       = useRef(null);
  const simInstance        = useRef(null);

  const realDriverLayerRef = useRef(null);
  const realUnassignedRef  = useRef(null);
  const simDriverLayerRef  = useRef(null);
  const simUnassignedRef   = useRef(null);
  const simOverlayRef      = useRef(null);

  /* 최신값 참조용 ref (dragend 클로저에서 사용) */
  const onSimZoneToggleRef   = useRef(onSimZoneToggle);
  const simDriversRef        = useRef(simDrivers);
  const onSaveSimDriversRef  = useRef(onSaveSimDrivers);

  useEffect(() => { onSimZoneToggleRef.current  = onSimZoneToggle;   }, [onSimZoneToggle]);
  useEffect(() => { simDriversRef.current       = simDrivers;        }, [simDrivers]);
  useEffect(() => { onSaveSimDriversRef.current = onSaveSimDrivers;  }, [onSaveSimDrivers]);

  const [splitRatio, setSplitRatio] = useState(50);
  const isDragging = useRef(false);

  const scopeCamps = useMemo(() => new Set(sim?.scope?.camps || []), [sim]);
  const scopeZones = useMemo(() => zones.filter(z => scopeCamps.has(z.camp)), [zones, scopeCamps]);

  /* ── 드래그 구분선 ── */
  const onDividerMouseDown = (e) => { e.preventDefault(); isDragging.current = true; };
  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setSplitRatio(Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100)));
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  useEffect(() => {
    setTimeout(() => {
      realInstance.current?.invalidateSize();
      simInstance.current?.invalidateSize();
    }, 50);
  }, [splitRatio, splitView]);

  /* ── 유틸: centroid, getDriverTotal, driverColor, makeXxxIcon → utils/helpers.js ── */

  /* ── 지도 초기화 ── */
  useEffect(() => {
    if (!realInstance.current && realMapRef.current) {
      const map = L.map(realMapRef.current, { center:[36.5,127.8], zoom:7, doubleClickZoom:false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:'© OpenStreetMap contributors', maxZoom:19,
      }).addTo(map);
      realDriverLayerRef.current = L.layerGroup().addTo(map);
      realUnassignedRef.current  = L.layerGroup().addTo(map);
      realInstance.current = map;
    }
    if (!simInstance.current && simMapRef.current) {
      const map = L.map(simMapRef.current, { center:[36.5,127.8], zoom:7, doubleClickZoom:false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:'© OpenStreetMap contributors', maxZoom:19,
      }).addTo(map);
      simDriverLayerRef.current = L.layerGroup().addTo(map);
      simUnassignedRef.current  = L.layerGroup().addTo(map);
      simOverlayRef.current     = L.layerGroup().addTo(map);
      simInstance.current = map;
    }
  }, []);

  /* scope 변경 → 줌 맞추기 */
  useEffect(() => {
    if (!scopeZones.length) return;
    const allPts = scopeZones.flatMap(z => z.latlngs.map(p => [p.lat, p.lng]));
    try { realInstance.current?.fitBounds(L.latLngBounds(allPts), { padding:[40,40], animate:false }); } catch{}
    try { simInstance.current?.fitBounds(L.latLngBounds(allPts),  { padding:[40,40], animate:false }); } catch{}
  }, [scopeZones]);

  /* ── 실제 지도 갱신 ── */
  useEffect(() => {
    renderDriversOnMap(realInstance, realDriverLayerRef, realDrivers, scopeZones, selectedRealDriverId, false);
    renderUnassigned(realInstance, realUnassignedRef, realDrivers, scopeZones, false);
  }, [realDrivers, selectedRealDriverId, scopeZones]);

  /* ── 시뮬 지도 갱신 ── */
  useEffect(() => {
    renderDriversOnMap(simInstance, simDriverLayerRef, simDrivers, scopeZones, selectedSimDriverId, true);
    renderUnassigned(simInstance, simUnassignedRef, simDrivers, scopeZones, true);
    renderSimOverlay();
  }, [simDrivers, selectedSimDriverId, scopeZones]);

  /* ══════════════════════════════════════
     기사 렌더 (배송할당맵과 동일)
  ══════════════════════════════════════ */
  const renderDriversOnMap = (mapRef, layerRef, drivers, zoneList, selDriverId, isSim) => {
    const map = mapRef.current; if (!map) return;
    layerRef.current?.clearLayers();

    drivers.forEach(driver => {
      if (driver.type === 'backup' && driver.id !== selDriverId) return;
      const dZones = (driver.zones||[]).map(zid => zoneList.find(z => z.id === zid)).filter(Boolean);
      if (!dZones.length) return;

      const color   = driverColor(driver.id, drivers);
      const total   = getDriverTotal(driver, zoneList);
      const opacity = selDriverId ? (driver.id === selDriverId ? .4 : .1) : .3;
      const weight  = selDriverId ? (driver.id === selDriverId ? 3  : 1)  : 2;

      const addPoly = (lls) => {
        const poly = L.polygon(lls, { color, fillColor:color, fillOpacity:opacity, weight });
        if (isSim) poly.on('click', () => setSelectedSimDriverId(driver.id));
        layerRef.current.addLayer(poly);
      };

      const addLabel = (pos, driverId) => {
        const labelOpts = isSim
          ? { icon: makeDriverIcon(driver, total), draggable:true, zIndexOffset:1000 }
          : { icon: makeDriverIcon(driver, total), zIndexOffset:1000 };
        const label = L.marker(pos, labelOpts);

        if (isSim) {
          label.on('click', () => setSelectedSimDriverId(driverId));
          label.on('dragend', async () => {
            const p = label.getLatLng();
            const newDrivers = simDriversRef.current.map(d =>
              d.id === driverId ? { ...d, labelPos:{ lat:p.lat, lng:p.lng } } : d
            );
            await onSaveSimDriversRef.current?.(newDrivers);
          });
        }

        layerRef.current.addLayer(label);
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
            addLabel(pos, driver.id);
          }
        });
      } catch(e) {
        dZones.forEach(z => addPoly(z.latlngs.map(p => L.latLng(p.lat, p.lng))));
        const pos = driver.labelPos
          ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
          : centroid(dZones[0].latlngs);
        addLabel(pos, driver.id);
      }
    });
  };

  /* ══════════════════════════════════════
     미배정 구역 렌더 (배송할당맵과 동일)
  ══════════════════════════════════════ */
  const renderUnassigned = (mapRef, layerRef, drivers, zoneList, isSim) => {
    const map = mapRef.current; if (!map) return;
    layerRef.current?.clearLayers();

    const assignedIds = new Set(
      drivers.filter(d => d.type === 'fixed').flatMap(d => d.zones || [])
    );

    zoneList.forEach(z => {
      if (assignedIds.has(z.id)) return;
      const lls = z.latlngs.map(p => L.latLng(p.lat, p.lng));
      layerRef.current.addLayer(
        L.polygon(lls, { color:'#6b7280', fillColor:'#6b7280', fillOpacity:.15, weight:1.5, dashArray:'4,4' })
      );
      const labelPos = z.labelPos ? L.latLng(z.labelPos.lat, z.labelPos.lng) : centroid(z.latlngs);
      const label = L.marker(labelPos, { icon: makeUnassignedIcon(z), zIndexOffset:500 });
      if (isSim) {
        label.on('click', (e) => { L.DomEvent.stop(e); onSimZoneToggleRef.current?.(z.id); });
      }
      layerRef.current.addLayer(label);
    });
  };

  /* ══════════════════════════════════════
     시뮬 오버레이 (배정 구역 클릭 토글)
  ══════════════════════════════════════ */
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
        color:       isAssigned ? '#f97316' : '#ffffff',
        fillColor:   isAssigned ? '#f97316' : '#ffffff',
        fillOpacity: isAssigned ? 0.12 : 0.01,
        weight:      isAssigned ? 2.5  : 0,
        opacity:     isAssigned ? 1    : 0,
      });
      poly.on('click', (e) => { L.DomEvent.stop(e); onSimZoneToggleRef.current?.(z.id); });
      simOverlayRef.current.addLayer(poly);
    });
  }, [selectedSimDriverId, simDrivers, scopeZones]);

  useEffect(() => { renderSimOverlay(); }, [renderSimOverlay]);

  return (
    <div ref={containerRef} style={{ display:'flex', flex:1, position:'relative', overflow:'hidden' }}>

      {/* 실제 지도 */}
      <div style={{
        display:'flex', flexDirection:'column', position:'relative',
        visibility: splitView ? 'visible' : 'hidden',
        width: splitView ? `${splitRatio}%` : '0%',
        overflow:'hidden', flexShrink:0,
      }}>
        <div style={{
          position:'absolute', top:8, left:'50%', transform:'translateX(-50%)',
          background:'rgba(0,0,0,.55)', color:'#fff', fontSize:11, fontWeight:700,
          padding:'4px 12px', borderRadius:20, zIndex:1000, pointerEvents:'none',
        }}>📍 현재 배정</div>
        <div ref={realMapRef} style={{ flex:1, height:'100%' }} />
      </div>

      {/* 구분선 */}
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
