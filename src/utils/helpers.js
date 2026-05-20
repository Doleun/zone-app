/* ══════════════════════════════════════
   공통 유틸 (src/utils/helpers.js)
   Leaflet 무관한 순수 유틸 + 아이콘 팩토리
══════════════════════════════════════ */
import L from 'leaflet';
import { DRIVER_COLORS } from '../App';

/* ── 지도 중심점 ── */
export const centroid = (latlngs) => {
  const pts = (latlngs || []).filter(p => p && 'lat' in p);
  if (!pts.length) return L.latLng(36.5, 127.8);
  return L.latLng(
    pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  );
};

/* ── 구역 교대별 수량 ── */
export const getQty = (zone, shift) => {
  if (!zone) return 0;
  const raw = shift === 'night'
    ? (zone.qtyNight != null ? zone.qtyNight : 0)
    : (zone.qtyDay   != null ? zone.qtyDay   : (zone.qty ?? 0));
  return parseInt(raw) || 0;
};

/* ── 기사 합산 수량 (백업기사는 평균) ── */
export const getDriverTotal = (driver, zoneList) => {
  if (!driver || !zoneList) return 0;
  const shift = driver.shift || 'day';
  const total = (driver.zones || []).reduce((s, zid) => {
    return s + getQty(zoneList.find(z => z.id === zid), shift);
  }, 0);
  if (driver.type === 'backup' && (driver.selectedFixed || []).length > 0)
    return Math.round(total / driver.selectedFixed.length);
  return total;
};

/* ── 기사 색상 ── */
export const driverColor = (driverId, drivers) => {
  const i = drivers.findIndex(d => d.id === driverId);
  return DRIVER_COLORS[i % DRIVER_COLORS.length];
};

/* ── Leaflet 아이콘 팩토리 ── */
export const makeZoneIcon = (z) => {
  const day   = parseInt(z.qtyDay   != null ? z.qtyDay   : (z.qty ?? 0)) || 0;
  const night = parseInt(z.qtyNight != null ? z.qtyNight : 0)             || 0;
  return L.divIcon({
    className: 'zlabel',
    html: `<div class="zlabel-inner"><div>${z.name}</div><div class="zlabel-qty">☀️${day} / 🌙${night}</div></div>`,
    iconSize: null, iconAnchor: [0, 0],
  });
};

export const makeDriverIcon = (driver, total) => L.divIcon({
  className: 'zlabel',
  html: `<div class="zlabel-inner"><div>${driver.name}</div><div class="zlabel-qty">${total}개</div></div>`,
  iconSize: null, iconAnchor: [0, 0],
});

export const makeUnassignedIcon = (z) => L.divIcon({
  className: 'zlabel',
  html: `<div class="zlabel-inner" style="opacity:.55"><div>${z.name}</div><div class="zlabel-qty">미배정</div></div>`,
  iconSize: null, iconAnchor: [0, 0],
});
