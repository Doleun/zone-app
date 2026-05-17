import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { ZONE_COLORS, DRIVER_COLORS } from '../App';

/* ══════════════════════════════════════
   MapView
   - 구역 관리/기사 등록 탭: 개별 구역 폴리곤 + 드래그 레이블
   - 배송구역 탭:
     · 기본: 미배정 구역 폴리곤 표시
     · 기사 선택 시: 해당 기사 구역만 하이라이트
     · 고정기사 배정 구역은 항상 표시
     · 백업기사 구역은 선택 시만 표시
   - 지도에서 폴리곤 다중 선택 → 기사 배정 지원
══════════════════════════════════════ */
export default function MapView({
  curTab,
  zones, drivers,
  regions, camps,
  onSave, showToast, nextColor,
  setZones,
  // 배송구역 탭에서 전달
  selectedDriverId,
  drawMode, setDrawMode,
  pendingPoints, setPendingPoints,
  onZoneClick,
}) {
  const mapRef       = useRef(null);
  const mapInstance  = useRef(null);
  const zoneLayersRef= useRef({});  // zoneId → { poly, label }
  const driverLayerRef = useRef(null);
  const driverLabelMarkersRef = useRef([]);
  const drawLayerRef = useRef({ dots:[], line:null, poly:null });

  /* ── 지도 초기화 ── */
  useEffect(() => {
    if (mapInstance.current) return;
    const map = L.map(mapRef.current, { center:[36.5,127.8], zoom:7, doubleClickZoom:false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'© OpenStreetMap contributors', maxZoom:19,
    }).addTo(map);
    driverLayerRef.current = L.layerGroup().addTo(map);
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

  const getDriverTotal = useCallback((d) => {
    const shift = d.shift || 'day';
    const zoneTotal = (d.zones||[]).reduce((s, zid) => {
      const z = zones.find(z => z.id === zid); if (!z) return s;
      const raw = shift === 'night'
        ? (z.qtyNight != null ? z.qtyNight : 0)
        : (z.qtyDay   != null ? z.qtyDay   : (z.qty ?? 0));
      return s + (parseInt(raw) || 0);
    }, 0);
    if (d.type === 'backup' && (d.selectedFixed||[]).length > 0)
      return Math.round(zoneTotal / d.selectedFixed.length);
    return zoneTotal;
  }, [zones]);

  const driverColor = useCallback((did) => {
    const i = drivers.findIndex(d => d.id === did);
    return DRIVER_COLORS[i % DRIVER_COLORS.length];
  }, [drivers]);

  /* ── 구역 레이어 추가/제거 ── */
  const addZoneToMap = useCallback((zone) => {
    const map = mapInstance.current; if (!map) return;
    const existing = zoneLayersRef.current[zone.id];
    if (existing) { existing.poly.remove(); existing.label.remove(); }

    const lls  = zone.latlngs.map(p => L.latLng(p.lat, p.lng));
    const poly = L.polygon(lls, {
      color: zone.color, fillColor: zone.color, fillOpacity:.22, weight:2,
    }).addTo(map);

    if (onZoneClick) poly.on('click', () => onZoneClick(zone.id));

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
  }, [zones, drivers, onSave, setZones, onZoneClick]);

  const removeZoneFromMap = useCallback((zid) => {
    const layer = zoneLayersRef.current[zid]; if (!layer) return;
    layer.poly.remove(); layer.label.remove();
    delete zoneLayersRef.current[zid];
  }, []);

  /* ── 탭 전환 시 레이어 전환 ── */
  useEffect(() => {
    const map = mapInstance.current; if (!map) return;

    // 기사 레이어 초기화
    driverLayerRef.current?.clearLayers();
    driverLabelMarkersRef.current.forEach(m => map.removeLayer(m));
    driverLabelMarkersRef.current = [];

    if (curTab === 'assign') {
      // 배송구역 탭: 개별 구역 숨기고 기사 뷰 렌더
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        map.removeLayer(poly); map.removeLayer(label);
      });
      renderDriversOnMap();
    } else {
      // 구역/기사등록/캠프 탭: 개별 구역 표시
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        map.addLayer(poly); map.addLayer(label);
      });
    }
  }, [curTab]);

  /* ── 구역 데이터 변경 시 레이어 재렌더 ── */
  useEffect(() => {
    const map = mapInstance.current; if (!map) return;
    // 기존 레이어와 새 zones 비교해서 변경된 것만 업데이트
    const currentIds = new Set(Object.keys(zoneLayersRef.current));
    const newIds     = new Set(zones.map(z => z.id));
    // 삭제된 구역 제거
    currentIds.forEach(zid => { if (!newIds.has(zid)) removeZoneFromMap(zid); });
    // 추가/변경된 구역 추가
    zones.forEach(z => addZoneToMap(z));

    if (curTab === 'assign') {
      Object.values(zoneLayersRef.current).forEach(({ poly, label }) => {
        map.removeLayer(poly); map.removeLayer(label);
      });
      renderDriversOnMap();
    }
  }, [zones]);

  /* ── 기사 뷰 렌더 ── */
  const renderDriversOnMap = useCallback(() => {
    const map = mapInstance.current; if (!map) return;
    driverLayerRef.current?.clearLayers();
    driverLabelMarkersRef.current.forEach(m => map.removeLayer(m));
    driverLabelMarkersRef.current = [];

    drivers.forEach(driver => {
      // 백업기사는 기본 숨김 (선택 시 selectedDriverId로 표시)
      if (driver.type === 'backup' && driver.id !== selectedDriverId) return;

      const dZones = (driver.zones||[]).map(zid => zones.find(z => z.id === zid)).filter(Boolean);
      if (!dZones.length) return;

      const color = driverColor(driver.id);
      const total = getDriverTotal(driver);
      const opacity = selectedDriverId
        ? (driver.id === selectedDriverId ? .4 : .1)
        : .3;
      const weight  = selectedDriverId
        ? (driver.id === selectedDriverId ? 3 : 1)
        : 2;

      try {
        const features = dZones.map(z => {
          const ring = z.latlngs.map(p => [p.lng, p.lat]);
          ring.push(ring[0]);
          return turf.polygon([ring]);
        });
        const unified = features.length === 1
          ? features[0]
          : features.reduce((acc, f) => turf.union(turf.featureCollection([acc, f])));

        const geom = unified.geometry;
        const polys = geom.type === 'Polygon'
          ? [geom.coordinates[0].map(c => L.latLng(c[1], c[0]))]
          : geom.coordinates.map(p => p[0].map(c => L.latLng(c[1], c[0])));

        polys.forEach((lls, i) => {
          const poly = L.polygon(lls, { color, fillColor:color, fillOpacity:opacity, weight });
          driverLayerRef.current.addLayer(poly);

          if (i === 0) {
            const pos = driver.labelPos
              ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
              : centroid(lls.map(p => ({ lat:p.lat, lng:p.lng })));
            const label = L.marker(pos, {
              icon: makeDriverIcon(driver, total),
              draggable: true, zIndexOffset: 1000,
            }).addTo(map);
            label.on('dragend', async () => {
              const p = label.getLatLng();
              // labelPos 저장 (drivers 업데이트)
            });
            driverLabelMarkersRef.current.push(label);
          }
        });
      } catch(e) {
        dZones.forEach(z => {
          const poly = L.polygon(
            z.latlngs.map(p => L.latLng(p.lat, p.lng)),
            { color, fillColor:color, fillOpacity:opacity, weight }
          );
          driverLayerRef.current.addLayer(poly);
        });
        const pos = driver.labelPos
          ? L.latLng(driver.labelPos.lat, driver.labelPos.lng)
          : centroid(dZones[0].latlngs);
        const label = L.marker(pos, {
          icon: makeDriverIcon(driver, total), draggable:true, zIndexOffset:1000,
        }).addTo(map);
        driverLabelMarkersRef.current.push(label);
      }
    });
  }, [drivers, zones, selectedDriverId, driverColor, getDriverTotal]);

  /* ── 기사 선택/데이터 변경 시 기사 뷰 갱신 ── */
  useEffect(() => {
    if (curTab === 'assign') renderDriversOnMap();
  }, [drivers, selectedDriverId, curTab]);

  /* ── 지도 크기 갱신 ── */
  useEffect(() => {
    setTimeout(() => mapInstance.current?.invalidateSize(), 100);
  }, [curTab]);

  return (
    <div ref={mapRef} style={{ flex:1, zIndex:1 }} />
  );
}
