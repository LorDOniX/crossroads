import './styles.css';
import { buildTestSequence, generateScenario, type TestItem } from './generator';
import { animateTo, renderScene, type VehicleView } from './render';
import { blockersOf, freeVehicles, type Blocker } from './rules';
import type { Intersection, Scenario, Vehicle } from './types';

const TOTAL = 30;

function byId<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Chybí element #${id}`);
  return node as unknown as T;
}

const scene = byId<SVGSVGElement>('scene');
const info = byId('info');
const hud = {
  round: byId('hud-round'),
  type: byId('hud-type'),
  left: byId('hud-left'),
  good: byId('hud-good'),
  bad: byId('hud-bad'),
  score: byId('hud-score'),
};
const modal = {
  root: byId('modal'),
  box: byId('modal-box'),
  title: byId('modal-title'),
  body: byId('modal-body'),
  button: byId<HTMLButtonElement>('modal-btn'),
};

let sequence: TestItem[] = [];
let round = 0;
let good = 0;
let bad = 0;
let scenario: Scenario | null = null;
let remaining: Vehicle[] = [];
let passed: Vehicle[] = [];
let views = new Map<string, VehicleView>();
let busy = false;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface ModalBlock {
  text?: string;
  items?: string[];
  ordered?: boolean;
}

interface ModalOptions {
  kind: 'ok' | 'bad' | 'info';
  title: string;
  blocks: ModalBlock[];
  button: string;
  onClose: () => void;
}

function renderBlock(block: ModalBlock): HTMLElement {
  if (block.items) {
    const list = document.createElement(block.ordered ? 'ol' : 'ul');
    for (const item of block.items) {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    }
    return list;
  }
  const p = document.createElement('p');
  p.textContent = block.text ?? '';
  return p;
}

function showModal(options: ModalOptions): void {
  modal.box.className = `modal-box ${options.kind}`;
  modal.title.textContent = options.title;
  modal.body.replaceChildren(...options.blocks.map(renderBlock));
  modal.button.textContent = options.button;
  modal.button.onclick = () => {
    modal.root.classList.add('hidden');
    options.onClose();
  };
  modal.root.classList.remove('hidden');
  modal.button.focus();
}

function updateHud(): void {
  const done = good + bad;
  hud.round.textContent = `Křižovatka ${Math.min(round + 1, TOTAL)} / ${TOTAL}`;
  hud.type.textContent = scenario?.intersection.label ?? '';
  hud.left.textContent = String(TOTAL - done);
  hud.good.textContent = String(good);
  hud.bad.textContent = String(bad);
  hud.score.textContent = done ? `${Math.round((good / done) * 100)} %` : '– %';
}

function updateInfo(): void {
  info.textContent = passed.length
    ? `Projelo: ${passed.map((v, i) => `${i + 1}. ${v.name}`).join(', ')}`
    : 'Klikej na vozidla v pořadí, v jakém projedou křižovatkou – včetně svého červeného auta.';
}

function setBusy(value: boolean): void {
  busy = value;
  scene.classList.toggle('busy', value);
}

function blockerText(inter: Intersection, v: Vehicle, b: Blocker): string {
  const other = capitalize(b.other.name);
  if (b.reason === 'main') return `${other} – jede po hlavní pozemní komunikaci.`;
  if (b.reason === 'right') return `${other} – přijíždí zprava.`;
  const subject = v.isPlayer ? 'ty odbočuješ' : 'toto vozidlo odbočuje';
  const bothOnMain = inter.mainArms.includes(v.from) && inter.mainArms.includes(b.other.from);
  return bothOnMain
    ? `${other} – jede v protisměru po hlavní silnici a ${subject} z hlavní vlevo.`
    : `${other} – jede v protisměru a ${subject} vlevo.`;
}

const nextButtonLabel = (): string => (round + 1 >= TOTAL ? 'Zobrazit výsledek' : 'Další křižovatka');

function showRoundSuccess(): void {
  showModal({
    kind: 'ok',
    title: 'Správně!',
    blocks: [
      { text: 'Všechna vozidla projela ve správném pořadí:' },
      { items: passed.map((v) => capitalize(v.name)), ordered: true },
    ],
    button: nextButtonLabel(),
    onClose: nextRound,
  });
}

function showRoundError(inter: Intersection, vehicle: Vehicle, blockers: Blocker[], allowed: Vehicle[]): void {
  const who = vehicle.isPlayer ? 'Tvoje auto' : capitalize(vehicle.name);
  showModal({
    kind: 'bad',
    title: 'Chyba!',
    blocks: [
      { text: `${who} teď ještě nesmí jet, musí dát přednost:` },
      { items: blockers.map((b) => blockerText(inter, vehicle, b)) },
      { text: `Správná volba teď: ${allowed.map((v) => v.name).join(' nebo ')}.` },
      { text: `Počet chyb: ${bad}` },
    ],
    button: nextButtonLabel(),
    onClose: nextRound,
  });
}

function showResult(): void {
  const percent = Math.round((good / TOTAL) * 100);
  showModal({
    kind: percent >= 80 ? 'ok' : 'bad',
    title: 'Test dokončen',
    blocks: [
      { text: `Správně vyřešeno ${good} z ${TOTAL} křižovatek, chyb ${bad}.` },
      { text: `Úspěšnost: ${percent} %` },
    ],
    button: 'Hrát znovu',
    onClose: newGame,
  });
}

async function handlePick(id: string): Promise<void> {
  if (busy || !scenario) return;
  const vehicle = remaining.find((v) => v.id === id);
  const view = views.get(id);
  if (!vehicle || !view) return;
  setBusy(true);

  const inter = scenario.intersection;
  const allowed = freeVehicles(inter, remaining);
  if (allowed.includes(vehicle)) {
    await animateTo(view, view.path.length, 'in');
    view.node.remove();
    remaining = remaining.filter((v) => v !== vehicle);
    passed.push(vehicle);
    updateInfo();
    if (remaining.length) {
      setBusy(false);
      return;
    }
    good++;
    updateHud();
    showRoundSuccess();
    return;
  }

  const blockers = blockersOf(inter, vehicle, remaining);
  const { sEntry, sExit } = view.path;
  await animateTo(view, sEntry + (sExit - sEntry) * 0.4, 'inOut');
  view.inner.classList.add('crash');
  bad++;
  updateHud();
  showRoundError(inter, vehicle, blockers, allowed);
}

function startRound(): void {
  scenario = generateScenario(sequence[round]);
  remaining = [...scenario.vehicles];
  passed = [];
  views = renderScene(scene, scenario, (id) => void handlePick(id));
  setBusy(false);
  updateHud();
  updateInfo();
}

function nextRound(): void {
  round++;
  if (round >= TOTAL) {
    showResult();
    return;
  }
  startRound();
}

function newGame(): void {
  sequence = buildTestSequence(TOTAL);
  round = 0;
  good = 0;
  bad = 0;
  startRound();
}

newGame();
showModal({
  kind: 'info',
  title: 'Přednost v jízdě – test 30 křižovatek',
  blocks: [
    { text: 'Na každé křižovatce klikej postupně na vozidla v pořadí, v jakém smějí projet – včetně svého červeného auta.' },
    { text: 'Sleduj směrovky, dopravní značky a tvar hlavní silnice. Jezdí se vpravo, tramvaj se řídí stejnými pravidly jako ostatní.' },
    { text: 'Při první chybě se křižovatka vyhodnotí jako špatně a pokračuješ další.' },
  ],
  button: 'Začít',
  onClose: () => undefined,
});
