import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type IControl,
  type LngLatBoundsLike,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LonLat, Route } from './route';

// maplibre computes the worker URL at runtime, which webpack cannot follow – emit the worker as an asset instead
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

// retina tiles exist only for the basic and outdoor mapsets
const TILE_SIZE = window.devicePixelRatio > 1 ? '256@2x' : '256';
const TILES = `https://api.mapy.com/v1/maptiles/outdoor/${TILE_SIZE}/{z}/{x}/{y}?apikey=${encodeURIComponent(MAPY_API_KEY)}`;
const COPYRIGHT =
  '<a href="https://api.mapy.com/copyright" target="_blank" rel="noopener">&copy; Seznam.cz a.s. a další</a>';
const OSM_COPYRIGHT =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">křižovatky &copy; OpenStreetMap</a>';

/** Clickable Mapy.com logo required by the API terms. */
class MapyLogo implements IControl {
  private readonly link = document.createElement('a');

  onAdd(): HTMLElement {
    this.link.className = 'maplibregl-ctrl mapy-logo';
    this.link.href = 'https://mapy.com/';
    this.link.target = '_blank';
    this.link.rel = 'noopener';
    const img = document.createElement('img');
    img.src = 'https://api.mapy.com/img/api/logo.svg';
    img.alt = 'Mapy.com';
    this.link.replaceChildren(img);
    return this.link;
  }

  onRemove(): void {
    this.link.remove();
  }
}

function boundsOf(route: Route): LngLatBoundsLike {
  const lons = route.points.map((p) => p[0]);
  const lats = route.points.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export type JunctionState = 'pending' | 'ok' | 'bad';

/** Outdoor map from Mapy.com with the route and its junctions. */
export class RouteMap {
  readonly map: MapLibreMap;
  private readonly loaded: Promise<void>;

  constructor(container: HTMLElement, route: Route) {
    if (!MAPY_API_KEY) throw new Error('Chybí apiKey v souboru .env.json.');
    this.map = new MapLibreMap({
      container,
      bounds: boundsOf(route),
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: false },
      style: {
        version: 8,
        sources: {
          mapy: { type: 'raster', tiles: [TILES], tileSize: 256, maxzoom: 18, attribution: COPYRIGHT },
          route: {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.points } },
          },
          junctions: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution: OSM_COPYRIGHT,
          },
        },
        layers: [
          { id: 'mapy', type: 'raster', source: 'mapy' },
          {
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#1f6fd1', 'line-width': 5, 'line-opacity': 0.8 },
          },
          {
            id: 'junctions',
            type: 'circle',
            source: 'junctions',
            paint: {
              'circle-radius': 7,
              'circle-color': ['match', ['get', 'state'], 'ok', '#2e9e44', 'bad', '#d62828', '#ffffff'],
              'circle-stroke-color': '#1d2329',
              'circle-stroke-width': 2,
            },
          },
        ],
      },
    });
    this.map.addControl(new NavigationControl(), 'top-right');
    this.map.addControl(new MapyLogo(), 'bottom-left');
    this.addContextMenu();
    this.loaded = new Promise((resolve) => this.map.once('load', () => resolve()));
  }

  /** Right click copies the coordinates of the point. */
  private addContextMenu(): void {
    const menu = document.createElement('div');
    menu.className = 'map-menu hidden';
    menu.setAttribute('role', 'menu');
    this.map.getContainer().append(menu);
    const close = (): void => menu.classList.add('hidden');
    this.map.on('contextmenu', (e) => {
      e.preventDefault();
      const lat = e.lngLat.lat.toFixed(6);
      const lon = e.lngLat.lng.toFixed(6);
      const items: [string, string][] = [
        [`${lat}, ${lon}`, 'zeměpisná šířka, délka'],
        [`[${lon}, ${lat}]`, 'GeoJSON [lon, lat]'],
      ];
      menu.replaceChildren(
        ...items.map(([text, hint]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'menuitem');
          button.textContent = `Kopírovat ${text}`;
          const small = document.createElement('small');
          small.textContent = hint;
          button.append(small);
          button.addEventListener('click', () => {
            void navigator.clipboard?.writeText(text);
            close();
          });
          return button;
        }),
      );
      const { width, height } = this.map.getContainer().getBoundingClientRect();
      menu.classList.remove('hidden');
      menu.style.left = `${Math.min(e.point.x, width - menu.offsetWidth - 4)}px`;
      menu.style.top = `${Math.min(e.point.y, height - menu.offsetHeight - 4)}px`;
      (menu.firstElementChild as HTMLElement | null)?.focus();
    });
    this.map.on('click', close);
    this.map.on('dragstart', close);
    this.map.on('wheel', close);
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  async showJunctions(junctions: readonly { center: LonLat; state: JunctionState }[]): Promise<void> {
    await this.loaded;
    this.map.getSource<GeoJSONSource>('junctions')?.setData({
      type: 'FeatureCollection',
      features: junctions.map(({ center, state }) => ({
        type: 'Feature',
        properties: { state },
        geometry: { type: 'Point', coordinates: center },
      })),
    });
  }

  remove(): void {
    this.map.remove();
  }
}
