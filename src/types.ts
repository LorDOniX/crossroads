/** Rameno křižovatky: 0 = jih (dole), 1 = východ (vpravo), 2 = sever (nahoře), 3 = západ (vlevo). */
export type Arm = 0 | 1 | 2 | 3;
export type Turn = 'right' | 'straight' | 'left';
export type VehicleKind = 'car' | 'truck' | 'tram';
export type YieldSign = 'giveWay' | 'stop';

export interface SignalPlan {
  /** Flashing amber: the junction is not controlled, signs apply. */
  blinking: boolean;
  /** Arms that get green together, in cycle order. */
  phases: Arm[][];
  /** Arms with a green supplementary right arrow shown during red. */
  rightArrows: Arm[];
}

export interface Intersection {
  arms: Arm[];
  /** Arms of the main road; empty for an intersection of equal roads. */
  mainArms: Arm[];
  yieldSign: YieldSign;
  /** Tram line between two arms, drawn in both directions. */
  tramLine: [Arm, Arm] | null;
  signals: SignalPlan | null;
  label: string;
}

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  color: string;
  name: string;
  from: Arm;
  to: Arm;
  isPlayer: boolean;
}

export interface Scenario {
  intersection: Intersection;
  vehicles: Vehicle[];
  /** Index into `signals.phases` shown when the round starts. */
  startPhase: number;
}
