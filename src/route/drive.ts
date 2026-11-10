import { Marker } from 'maplibre-gl';
import { drawVehicle, svgEl } from '../sprites';
import type { Vehicle } from '../types';
import type { RouteJunction } from './junctions';
import type { RouteMap } from './mapView';
import { pointAt, type Route } from './route';

/** m/s at speed factor 1, ≈ 50 km/h. */
const CRUISE = 14;
const MIN_SPEED = 2;
const ACCEL = 3;
const BRAKE = 2.5;
const FOLLOW_ZOOM = 17.5;
/** Camera flight before the car sets off, ms. */
const CAMERA_MS = 1000;

const CAR: Vehicle = {
  id: 'player',
  kind: 'car',
  color: '#d62828',
  name: 'tvoje červené auto',
  from: 0,
  to: 2,
  isPlayer: true,
  queue: 0,
  beacons: false,
  circulating: false,
  walkDir: 1,
};

function carElement(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'route-car';
  element.append(svgEl('svg', { viewBox: '-28 -52 56 104', width: 22, height: 41 }, drawVehicle(CAR, 'straight')));
  return element;
}

/** Turns bearing `from` by the fraction `k` of the shorter way towards `to`. */
const turnTowards = (from: number, to: number, k: number): number =>
  (from + (((((to - from) % 360) + 540) % 360) - 180) * k + 360) % 360;

export interface DriveCallbacks {
  /** The car stopped before the junction; call `start()` to go on. */
  onJunction(junction: RouteJunction): void;
  onFinish(): void;
}

/** The red car driving along the route; it stops before each junction. */
export class RouteDrive {
  speedFactor = 1;
  private s = 0;
  private speed = 0;
  private next = 0;
  private heading: number;
  private running = false;
  private frame = 0;
  private timeout = 0;
  private last = 0;
  private junctions: readonly RouteJunction[] = [];
  private readonly marker: Marker;

  constructor(
    private readonly view: RouteMap,
    private readonly route: Route,
    private readonly callbacks: DriveCallbacks,
  ) {
    const start = pointAt(route, 0);
    this.heading = start.heading;
    this.marker = new Marker({ element: carElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat(start.point)
      .setRotation(this.heading)
      .addTo(view.map);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get started(): boolean {
    return this.running || this.s > 0;
  }

  get finished(): boolean {
    return this.s >= this.route.length;
  }

  /** Junctions still ahead of the car. */
  get remaining(): number {
    return this.junctions.length - this.next;
  }

  /** The junctions may arrive while the car is already driving; those it has passed are skipped. */
  setJunctions(junctions: readonly RouteJunction[]): void {
    this.junctions = junctions.filter((j) => j.at > this.s);
    this.next = 0;
  }

  start(): void {
    if (this.running || this.finished) return;
    this.running = true;
    this.view.map.easeTo({
      center: pointAt(this.route, this.s).point,
      bearing: this.heading,
      zoom: FOLLOW_ZOOM,
      pitch: 45,
      duration: CAMERA_MS,
    });
    this.timeout = window.setTimeout(() => {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }, CAMERA_MS);
  }

  pause(): void {
    this.running = false;
    this.speed = 0;
    window.clearTimeout(this.timeout);
    cancelAnimationFrame(this.frame);
  }

  remove(): void {
    this.pause();
    this.marker.remove();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const junction = this.junctions[this.next];
    const stopAt = junction ? Math.max(junction.at, this.s) : this.route.length;
    const f = this.speedFactor;
    const target = Math.max(MIN_SPEED, Math.min(CRUISE * f, Math.sqrt(2 * BRAKE * f * (stopAt - this.s))));
    this.speed = Math.min(target, this.speed + ACCEL * f * dt);
    this.s = Math.min(stopAt, this.s + this.speed * dt);

    const { point, heading } = pointAt(this.route, this.s);
    this.heading = turnTowards(this.heading, heading, Math.min(1, dt * 4));
    this.marker.setLngLat(point).setRotation(this.heading);
    this.view.map.jumpTo({ center: point, bearing: this.heading });
    if (this.s < stopAt) {
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    this.pause();
    if (junction) {
      this.next++;
      this.callbacks.onJunction(junction);
    } else {
      this.callbacks.onFinish();
    }
  };
}
