/** Rameno křižovatky: 0 = jih (dole), 1 = východ (vpravo), 2 = sever (nahoře), 3 = západ (vlevo). */
export type Arm = 0 | 1 | 2 | 3;
export type Turn = 'right' | 'straight' | 'left';
export type VehicleKind = 'car' | 'truck' | 'tram' | 'ambulance' | 'pedestrian';
export type YieldSign = 'giveWay' | 'stop';

export interface SignalPhase {
  arms: Arm[];
  /** Only the green left arrow is lit (§ 70 odst. 2 písm. e) – straight and right wait. */
  leftOnly: boolean;
}

export interface SignalPlan {
  /** Flashing amber: the junction is not controlled, signs apply. */
  blinking: boolean;
  phases: SignalPhase[];
  /** Arms with a green supplementary right arrow shown during red. */
  rightArrows: Arm[];
}

export interface PolicePlan {
  /** Arms the officer's sides face (free direction), in the order he turns. */
  phases: Arm[][];
}

export interface RoundaboutPlan {
  /** False: only the „Kruhový objezd“ sign, so the right-hand rule applies. */
  yieldOnEntry: boolean;
}

export interface Intersection {
  arms: Arm[];
  /** Arms of the main road; empty for an intersection of equal roads. */
  mainArms: Arm[];
  yieldSign: YieldSign;
  /** Tram line between two arms, drawn in both directions. */
  tramLine: [Arm, Arm] | null;
  signals: SignalPlan | null;
  police: PolicePlan | null;
  roundabout: RoundaboutPlan | null;
  /** Arms with a pedestrian crossing at the junction mouth. */
  crosswalks: Arm[];
  label: string;
}

/** Road user – vehicle or pedestrian. */
export interface Vehicle {
  id: string;
  kind: VehicleKind;
  color: string;
  name: string;
  from: Arm;
  /** Exit arm; for a pedestrian the arm whose crossing he walks over. */
  to: Arm;
  isPlayer: boolean;
  /** Position in the column waiting in the same lane, 0 = first. */
  queue: number;
  /** Emergency vehicle with beacons and siren on (§ 41). */
  beacons: boolean;
  /** Already on the roundabout, just past arm `from`. */
  circulating: boolean;
  /** Pedestrian starts on the inbound-lane side (1) or the opposite side (-1). */
  walkDir: 1 | -1;
}

export interface Scenario {
  intersection: Intersection;
  vehicles: Vehicle[];
  /** Index into the controlling plan's phases shown when the round starts. */
  startPhase: number;
  /** 1–3, used for exam scoring. */
  difficulty: number;
}
