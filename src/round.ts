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
  /** Chosen road users that were not allowed to go yet. */
  wrong: { vehicle: Vehicle; blockers: Blocker[] }[];
  /** Road users that could have gone together with the chosen ones but were left out. */
  missing: Vehicle[];
  allowed: Vehicle[];
  timedOut: boolean;
}

export interface RoundCallbacks {
  /** Selection or departures changed. */
  onProgress(): void;
  onComplete(): void;
  onMistake(mistake: Mistake): void;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One intersection on screen: the player selects everyone who may go at once and confirms the group. */
export class RoundPlayer {
  remaining: Vehicle[] = [];
  /** Groups that went at the same time, in order. */
  passed: Vehicle[][] = [];
  finished = false;
  private selected = new Set<Vehicle>();
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
    this.scene = renderScene(this.svg, this.scenario, interactive ? (id) => this.toggle(id) : () => undefined);
    this.remaining = [...this.scenario.vehicles];
    this.passed = [];
    this.selected.clear();
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

  get canConfirm(): boolean {
    return !this.busy && !this.finished && this.selected.size > 0;
  }

  allowedNow(): Vehicle[] {
    return freeVehicles(this.inter, this.remaining, this.phase);
  }

  toggle(id: string): void {
    if (this.busy || this.finished) return;
    const vehicle = this.remaining.find((v) => v.id === id);
    const view = this.scene.views.get(id);
    if (!vehicle || !view) return;
    if (this.selected.has(vehicle)) this.selected.delete(vehicle);
    else this.selected.add(vehicle);
    view.node.classList.toggle('selected', this.selected.has(vehicle));
    view.node.setAttribute('aria-pressed', String(this.selected.has(vehicle)));
    this.callbacks.onProgress();
  }

  /** Sends the selected group, or ends the round when it is not exactly the set of those who may go now. */
  async confirm(): Promise<void> {
    if (!this.canConfirm) return;
    const chosen = this.remaining.filter((v) => this.selected.has(v));
    this.clearSelection();
    this.setBusy(true);
    this.callbacks.onProgress();

    const allowed = this.allowedNow();
    const wrong = chosen
      .filter((v) => !allowed.includes(v))
      .map((vehicle) => ({ vehicle, blockers: blockersOf(this.inter, vehicle, this.remaining, this.phase) }));
    const missing = allowed.filter((v) => !chosen.includes(v));
    if (!wrong.length && !missing.length) {
      await this.departGroup(chosen);
      if (this.finished) return;
      if (this.remaining.length) {
        this.setBusy(false);
        this.callbacks.onProgress();
        return;
      }
      this.finished = true;
      this.callbacks.onComplete();
      return;
    }

    this.markMissing(missing);
    await Promise.all(
      wrong.map(({ vehicle }) => {
        const view = this.scene.views.get(vehicle.id) as VehicleView;
        const { sEntry, sExit } = view.path;
        return animateTo(view, sEntry + (sExit - sEntry) * 0.4, 'inOut').then(() => {
          for (const body of view.bodies) body.classList.add('crash');
        });
      }),
    );
    if (this.finished) return;
    this.finished = true;
    this.callbacks.onMistake({ wrong, missing, allowed, timedOut: false });
  }

  /** Ends the round because the time limit ran out. */
  timeout(): Mistake {
    this.finished = true;
    this.clearSelection();
    this.setBusy(true);
    const allowed = this.allowedNow();
    this.markMissing(allowed);
    return { wrong: [], missing: allowed, allowed, timedOut: true };
  }

  /** Replays the whole intersection from the start, group by group. */
  async playSolution(): Promise<void> {
    this.reset(false);
    await pause(500);
    while (this.remaining.length) {
      const group = this.allowedNow();
      if (!group.length) return;
      await this.departGroup(group);
      await pause(200);
    }
  }

  private clearSelection(): void {
    for (const v of this.selected) {
      const node = this.scene.views.get(v.id)?.node;
      node?.classList.remove('selected');
      node?.setAttribute('aria-pressed', 'false');
    }
    this.selected.clear();
  }

  private markMissing(vehicles: Vehicle[]): void {
    for (const v of vehicles) this.scene.views.get(v.id)?.node.classList.add('missed');
  }

  private async departGroup(group: Vehicle[]): Promise<void> {
    const views = group.map((v) => this.scene.views.get(v.id) as VehicleView);
    if (group.some((v) => v.beacons)) sounds.siren();
    else sounds.pass();
    await Promise.all(views.map((view) => animateTo(view, view.path.length, 'in')));
    this.remaining = this.remaining.filter((v) => !group.includes(v));
    this.passed.push(group);
    for (const view of views) {
      view.node.remove();
      addOrderBadge(this.scene, view, this.passed.length);
    }
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
