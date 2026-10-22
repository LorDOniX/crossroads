import { sounds } from './audio';
import { waitDistances } from './geometry';
import {
  addOrderBadge,
  animateTo,
  changeControl,
  renderScene,
  showControl,
  type Scene,
  type VehicleView,
} from './render';
import { blockersOf, freeVehicles, settlePhase, type Blocker } from './rules';
import type { Scenario, Vehicle } from './types';

export interface Mistake {
  /** Null when the time ran out. */
  vehicle: Vehicle | null;
  blockers: Blocker[];
  allowed: Vehicle[];
}

export interface RoundCallbacks {
  onProgress(): void;
  onComplete(): void;
  onMistake(mistake: Mistake): void;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One intersection on screen: handles picks, departures, columns moving up and signal phases. */
export class RoundPlayer {
  remaining: Vehicle[] = [];
  passed: Vehicle[] = [];
  finished = false;
  private phase = 0;
  private busy = false;
  private scene!: Scene;

  constructor(
    private readonly svg: SVGSVGElement,
    readonly scenario: Scenario,
    private readonly callbacks: RoundCallbacks,
  ) {
    this.reset(true);
  }

  private reset(interactive: boolean): void {
    this.scene = renderScene(this.svg, this.scenario, interactive ? (id) => void this.pick(id) : () => undefined);
    this.remaining = [...this.scenario.vehicles];
    this.passed = [];
    this.phase = this.scenario.startPhase;
    this.setBusy(!interactive);
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    this.svg.classList.toggle('busy', value);
  }

  private get inter() {
    return this.scenario.intersection;
  }

  allowedNow(): Vehicle[] {
    return freeVehicles(this.inter, this.remaining, this.phase);
  }

  async pick(id: string): Promise<void> {
    if (this.busy || this.finished) return;
    const vehicle = this.remaining.find((v) => v.id === id);
    const view = this.scene.views.get(id);
    if (!vehicle || !view) return;
    this.setBusy(true);

    const allowed = this.allowedNow();
    if (allowed.includes(vehicle)) {
      await this.depart(vehicle);
      if (this.finished) return;
      if (this.remaining.length) {
        this.setBusy(false);
        return;
      }
      this.finished = true;
      this.callbacks.onComplete();
      return;
    }

    const blockers = blockersOf(this.inter, vehicle, this.remaining, this.phase);
    const { sEntry, sExit } = view.path;
    await animateTo(view, sEntry + (sExit - sEntry) * 0.4, 'inOut');
    for (const body of view.bodies) body.classList.add('crash');
    if (this.finished) return;
    this.finished = true;
    this.callbacks.onMistake({ vehicle, blockers, allowed });
  }

  /** Ends the round because the time limit ran out. */
  timeout(): Mistake {
    this.finished = true;
    this.setBusy(true);
    return { vehicle: null, blockers: [], allowed: this.allowedNow() };
  }

  /** Replays the whole intersection from the start in a correct order. */
  async playSolution(): Promise<void> {
    this.reset(false);
    await pause(500);
    while (this.remaining.length) {
      const next = this.allowedNow()[0];
      if (!next) return;
      await this.depart(next);
      await pause(200);
    }
  }

  private async depart(vehicle: Vehicle): Promise<void> {
    const view = this.scene.views.get(vehicle.id) as VehicleView;
    if (vehicle.beacons) sounds.siren();
    else sounds.pass();
    await animateTo(view, view.path.length, 'in');
    view.node.remove();
    this.remaining = this.remaining.filter((v) => v !== vehicle);
    this.passed.push(vehicle);
    addOrderBadge(this.scene, view, this.passed.length);
    this.callbacks.onProgress();
    await this.moveUpColumns();
    const next = settlePhase(this.inter, this.remaining, this.phase);
    if (next !== this.phase) {
      sounds.signal();
      await changeControl(this.svg, this.inter, this.phase, next);
      this.phase = next;
      showControl(this.svg, this.inter, this.phase);
    }
  }

  private async moveUpColumns(): Promise<void> {
    const waits = waitDistances(this.scene.layout, this.remaining);
    const moves: Promise<void>[] = [];
    for (const v of this.remaining) {
      const view = this.scene.views.get(v.id);
      const target = waits.get(v.id);
      if (!view || target === undefined || view.waitDist - target < 1) continue;
      moves.push(animateTo(view, view.s + (view.waitDist - target), 'inOut'));
      view.waitDist = target;
    }
    await Promise.all(moves);
  }
}
