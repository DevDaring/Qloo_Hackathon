import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type LngLatLike, type Map as MLMap } from 'maplibre-gl';
import type { Place } from '../api/types';
import { PLACE_ROLE_COLOR, PLACE_ROLE_LABEL } from '../lib/labels';

export interface MapArea {
  id: string;
  name: string;
  center: { lat: number; lon: number } | null;
  radius_m: number | null;
  polygon?: [number, number][];
  tone: 'eligible' | 'excluded' | 'saved' | 'incomplete';
}

export interface TastePoint {
  lat: number;
  lon: number;
  w: number;
}

export interface MapViewHandle {
  getView: () => { center: [number, number]; zoom: number } | null;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  fitAreas: () => void;
}

interface Props {
  styleUrl: string;
  places: Place[];
  areas: MapArea[];
  selectedId?: string | null;
  shortlisted?: Set<string>;
  onSelect: (id: string | null) => void;
  onError: (msg: string) => void;
  initial?: { center?: [number, number]; zoom?: number };
  taste?: TastePoint[] | null;
  drawing?: boolean;
  drawPoints?: [number, number][];
  onDrawPoint?: (p: [number, number]) => void;
  className?: string;
}

const TONE: Record<MapArea['tone'], string> = { eligible: '#FF7A45', excluded: '#E5484D', saved: '#1F6FEB', incomplete: '#D99100' };

function circle(lon: number, lat: number, radiusM: number, steps = 64): [number, number][] {
  const out: [number, number][] = [];
  const R = 6371008.8;
  const d = radiusM / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    out.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return out;
}

function areasGeo(areas: MapArea[]) {
  return {
    type: 'FeatureCollection' as const,
    features: areas
      .filter((a) => a.center)
      .map((a) => {
        const ring = a.polygon && a.polygon.length > 3 ? a.polygon : circle(a.center!.lon, a.center!.lat, a.radius_m ?? 5000);
        return { type: 'Feature' as const, properties: { id: a.id, name: a.name, color: TONE[a.tone] }, geometry: { type: 'Polygon' as const, coordinates: [ring] } };
      }),
  };
}
function areaLabels(areas: MapArea[]) {
  return {
    type: 'FeatureCollection' as const,
    features: areas
      .filter((a) => a.center)
      .map((a) => ({ type: 'Feature' as const, properties: { name: a.tone === 'excluded' ? `${a.name} · excluded` : a.name, color: TONE[a.tone] }, geometry: { type: 'Point' as const, coordinates: [a.center!.lon, a.center!.lat] } })),
  };
}
function placesGeo(places: Place[], shortlisted?: Set<string>) {
  return {
    type: 'FeatureCollection' as const,
    features: places.map((p) => ({
      type: 'Feature' as const,
      id: undefined,
      properties: { id: p.id, name: p.name, role: p.role, category: p.category, star: shortlisted?.has(p.id) ? 1 : 0, qloo: p.provider === 'qloo' ? 1 : 0 },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    })),
  };
}
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(props, ref) {
  const { styleUrl, places, areas, selectedId, shortlisted, onSelect, onError, initial, taste, drawing, drawPoints, onDrawPoint, className } = props;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const popup = useRef<maplibregl.Popup | null>(null);
  const cbs = useRef({ onSelect, onError, onDrawPoint, drawing });
  cbs.current = { onSelect, onError, onDrawPoint, drawing };
  const areasRef = useRef(areas);
  areasRef.current = areas;

  useImperativeHandle(ref, () => ({
    getView: () => {
      const m = map.current;
      if (!m) return null;
      const c = m.getCenter();
      return { center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +m.getZoom().toFixed(2) };
    },
    flyTo: (lon, lat, zoom) => map.current?.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(map.current.getZoom(), 13), essential: true }),
    fitAreas: () => fit(map.current, areasRef.current),
  }));

  // create
  useEffect(() => {
    if (!el.current) return;
    let m: MLMap;
    let loadTimer = 0;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: styleUrl,
        center: (initial?.center ?? [80.5, 22]) as LngLatLike,
        zoom: initial?.zoom ?? 4,
        attributionControl: false,
        cooperativeGestures: false,
      });
    } catch (e) {
      cbs.current.onError(`The map could not start (${(e as Error).message}). Showing the table instead.`);
      return;
    }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '© OpenStreetMap contributors · OpenFreeMap' }), 'bottom-right');
    loadTimer = window.setTimeout(() => {
      if (!m.isStyleLoaded()) cbs.current.onError('The map style did not load in time (tile service unreachable). Showing the table instead.');
    }, 15000);
    m.on('error', (ev) => {
      const msg = (ev as { error?: Error }).error?.message ?? '';
      if (!m.isStyleLoaded() && /style|fetch|Failed|NetworkError|load/i.test(msg)) cbs.current.onError(`Map tiles are unavailable (${msg.slice(0, 120)}). Showing the table instead.`);
    });
    m.on('load', () => {
      window.clearTimeout(loadTimer);
      m.addSource('areas', { type: 'geojson', data: EMPTY });
      m.addSource('area-labels', { type: 'geojson', data: EMPTY });
      m.addSource('places', { type: 'geojson', data: EMPTY, cluster: true, clusterMaxZoom: 14, clusterRadius: 44 });
      m.addSource('taste', { type: 'geojson', data: EMPTY });
      m.addSource('draw', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'taste-heat', type: 'heatmap', source: 'taste', paint: { 'heatmap-weight': ['get', 'w'], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 1.4], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 12, 26, 15, 44], 'heatmap-opacity': 0.72, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(124,58,237,0)', 0.3, 'rgba(124,58,237,0.35)', 0.7, 'rgba(124,58,237,0.65)', 1, 'rgba(76,29,149,0.85)'] } });
      m.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 } });
      m.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      m.addLayer({
        id: 'area-labels',
        type: 'symbol',
        source: 'area-labels',
        maxzoom: 12,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, -1.6] },
        paint: { 'text-color': '#0E1320', 'text-halo-color': '#fff', 'text-halo-width': 2 },
      });
      m.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#6EA8FF', 20, '#1F6FEB', 80, '#0E1320'],
          'circle-radius': ['step', ['get', 'point_count'], 15, 20, 20, 80, 26],
          'circle-stroke-width': 3,
          'circle-stroke-color': 'rgba(255,255,255,0.9)',
        },
      });
      m.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
        paint: { 'text-color': '#ffffff' },
      });
      m.addLayer({
        id: 'points',
        type: 'circle',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['match', ['get', 'role'], 'competitor', PLACE_ROLE_COLOR.competitor, 'partner', PLACE_ROLE_COLOR.partner, 'venue', PLACE_ROLE_COLOR.venue, 'institution', PLACE_ROLE_COLOR.institution, '#8A93A6'],
          'circle-radius': ['case', ['==', ['get', 'star'], 1], 8, 6],
          'circle-stroke-width': ['case', ['==', ['get', 'star'], 1], 3, 2],
          'circle-stroke-color': ['case', ['==', ['get', 'star'], 1], '#FFB020', ['==', ['get', 'qloo'], 1], '#7C3AED', '#ffffff'],
        },
      });
      m.addLayer({
        id: 'selected',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: { 'circle-radius': 13, 'circle-color': 'rgba(255,122,69,0.18)', 'circle-stroke-width': 3, 'circle-stroke-color': '#FF7A45' },
      });
      m.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#1F6FEB', 'fill-opacity': 0.12 } });
      m.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#1F6FEB', 'line-width': 2 } });
      m.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#1F6FEB', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

      m.on('click', 'clusters', async (e) => {
        if (cbs.current.drawing) return;
        const f = e.features?.[0];
        if (!f) return;
        const src = m.getSource('places') as GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });
      m.on('click', 'points', (e) => {
        if (cbs.current.drawing) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) cbs.current.onSelect(id);
      });
      m.on('click', (e) => {
        if (cbs.current.drawing) cbs.current.onDrawPoint?.([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]);
      });
      for (const l of ['clusters', 'points']) {
        m.on('mouseenter', l, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', l, () => (m.getCanvas().style.cursor = cbs.current.drawing ? 'crosshair' : ''));
      }
      setReady(true);
      if (!initial?.center) fit(m, areasRef.current);
    });
    return () => {
      window.clearTimeout(loadTimer);
      popup.current?.remove();
      m.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('areas') as GeoJSONSource).setData(areasGeo(areas));
    (map.current.getSource('area-labels') as GeoJSONSource).setData(areaLabels(areas));
  }, [areas, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('places') as GeoJSONSource).setData(placesGeo(places, shortlisted));
  }, [places, shortlisted, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('taste') as GeoJSONSource).setData(
      taste?.length
        ? { type: 'FeatureCollection', features: taste.map((t) => ({ type: 'Feature', properties: { w: t.w }, geometry: { type: 'Point', coordinates: [t.lon, t.lat] } })) }
        : EMPTY,
    );
  }, [taste, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const pts = drawPoints ?? [];
    const feats: GeoJSON.Feature[] = pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
    if (pts.length >= 3) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
    else if (pts.length === 2) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
    (map.current.getSource('draw') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    map.current.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (drawing) map.current.doubleClickZoom.disable();
    else map.current.doubleClickZoom.enable();
  }, [drawPoints, drawing, ready]);

  // selection: highlight + popup + fly
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setFilter('selected', ['==', ['get', 'id'], selectedId ?? '__none__']);
    popup.current?.remove();
    const p = places.find((x) => x.id === selectedId);
    if (!p) return;
    const node = document.createElement('div');
    node.className = 'text-[12.5px] leading-snug';
    const t = document.createElement('div');
    t.className = 'font-semibold';
    t.textContent = p.name;
    const s = document.createElement('div');
    s.className = 'text-[11.5px]';
    s.style.color = PLACE_ROLE_COLOR[p.role] ?? '#666';
    s.textContent = `${PLACE_ROLE_LABEL[p.role] ?? p.role} · ${p.category.replace(/_/g, ' ')} · ${p.provider === 'qloo' ? 'Qloo' : 'OSM'}`;
    node.append(t, s);
    popup.current = new maplibregl.Popup({ offset: 14, closeButton: false, maxWidth: '240px' }).setLngLat([p.lon, p.lat]).setDOMContent(node).addTo(m);
    const b = m.getBounds();
    if (!b.contains([p.lon, p.lat]) || m.getZoom() < 12) m.flyTo({ center: [p.lon, p.lat], zoom: Math.max(m.getZoom(), 14), essential: true });
  }, [selectedId, places, ready]);

  return <div ref={el} className={className} role="region" aria-label="Map of retrieved places and candidate areas" />;
});

function fit(m: MLMap | null, areas: MapArea[]) {
  if (!m) return;
  const pts = areas.filter((a) => a.center).map((a) => [a.center!.lon, a.center!.lat] as [number, number]);
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  pts.forEach((p) => b.extend(p));
  m.fitBounds(b, { padding: 80, maxZoom: 11, duration: 900 });
}
