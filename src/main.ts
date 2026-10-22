import './styles.css';
import { isSoundEnabled, setSoundEnabled, sounds } from './audio';
import {
  LABELS,
  TYPES,
  buildTestSequence,
  generateScenario,
  practiceItem,
  type IntersectionType,
  type TestItem,
} from './generator';
import { deriveSeed, randomSeed } from './random';
import { RoundPlayer, type Mistake } from './round';
import type { Blocker } from './rules';
import { loadStats, recordGame, recordRound, resetStats, type Mode } from './storage';
import type { Intersection, Scenario, Vehicle } from './types';

const TOTAL = 30;
const EXAM_SECONDS = 25;
const EXAM_PASS_PERCENT = 85;

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
  timer: byId('hud-timer'),
  timerWrap: byId('hud-timer-wrap'),
  sound: byId<HTMLButtonElement>('btn-sound'),
  menu: byId<HTMLButtonElement>('btn-menu'),
};
const modal = {
  root: byId('modal'),
  box: byId('modal-box'),
  title: byId('modal-title'),
  body: byId('modal-body'),
  actions: byId('modal-actions'),
};

interface RoundRecord {
  scenario: Scenario;
  correct: boolean;
}

interface Game {
  mode: Mode;
  seed: number;
  practiceType: IntersectionType | null;
  items: TestItem[];
  round: number;
  good: number;
  bad: number;
  points: number;
  maxPoints: number;
  records: RoundRecord[];
}

let game: Game | null = null;
let player: RoundPlayer | null = null;
let timer: number | undefined;
let timeLeft = 0;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const noop = (): void => undefined;

interface ModalBlock {
  text?: string;
  items?: string[];
  ordered?: boolean;
  element?: HTMLElement;
}

interface ModalAction {
  label: string;
  primary?: boolean;
  /** The handler hides the dialog itself (or keeps it open). */
  manual?: boolean;
  onClick: (button: HTMLButtonElement) => void;
}

interface ModalOptions {
  kind: 'ok' | 'bad' | 'info';
  title: string;
  blocks: ModalBlock[];
  actions: ModalAction[];
}

function renderBlock(block: ModalBlock): HTMLElement {
  if (block.element) return block.element;
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

function hideModal(): void {
  modal.root.classList.add('hidden');
}

function showModal(options: ModalOptions): void {
  modal.box.className = `modal-box ${options.kind}`;
  modal.title.textContent = options.title;
  modal.body.replaceChildren(...options.blocks.map(renderBlock));
  const buttons = options.actions.map((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.className = action.primary ? 'btn primary' : 'btn';
    button.addEventListener('click', () => {
      if (!action.manual) hideModal();
      action.onClick(button);
    });
    return button;
  });
  modal.actions.replaceChildren(...buttons);
  modal.root.classList.remove('hidden');
  (buttons.find((b) => b.classList.contains('primary')) ?? buttons[0])?.focus();
}

function updateHud(): void {
  if (!game) return;
  const practice = game.mode === 'practice';
  const done = game.good + game.bad;
  hud.round.textContent = practice
    ? `Procvičování · ${game.round + 1}.`
    : `Křižovatka ${Math.min(game.round + 1, TOTAL)} / ${TOTAL}`;
  hud.type.textContent = player?.scenario.intersection.label ?? '';
  hud.left.textContent = practice ? '∞' : String(TOTAL - done);
  hud.good.textContent = String(game.good);
  hud.bad.textContent = String(game.bad);
  hud.score.textContent = done ? `${Math.round((game.good / done) * 100)} %` : '– %';
}

function updateInfo(): void {
  const passed = player?.passed ?? [];
  info.textContent = passed.length
    ? `Projelo: ${passed.map((v, i) => `${i + 1}. ${v.name}`).join(', ')}`
    : 'Klikej na vozidla (nebo je vyber klávesou Tab a potvrď Enterem) v pořadí, v jakém projedou – včetně svého červeného auta.';
}

function updateSoundButton(): void {
  const on = isSoundEnabled();
  hud.sound.textContent = on ? 'Zvuk: zap.' : 'Zvuk: vyp.';
  hud.sound.setAttribute('aria-pressed', String(on));
}

function stopTimer(): void {
  window.clearInterval(timer);
  timer = undefined;
  hud.timerWrap.classList.add('hidden');
}

function startTimer(): void {
  stopTimer();
  if (game?.mode !== 'exam') return;
  timeLeft = EXAM_SECONDS;
  hud.timer.textContent = String(timeLeft);
  hud.timerWrap.classList.remove('hidden', 'urgent');
  timer = window.setInterval(() => {
    timeLeft--;
    hud.timer.textContent = String(timeLeft);
    hud.timerWrap.classList.toggle('urgent', timeLeft <= 5);
    if (timeLeft > 0 || !player || player.finished) return;
    stopTimer();
    finishRound(false, player.timeout());
  }, 1000);
}

function blockerText(inter: Intersection, v: Vehicle, b: Blocker): string {
  const you = v.isPlayer;
  if (!b.other) {
    if (b.reason === 'police') {
      return you
        ? 'Policista je k tobě čelem nebo zády – to znamená „Stůj!“.'
        : 'Policista je k němu čelem nebo zády – to znamená „Stůj!“.';
    }
    if (b.reason === 'arrowOnly') return 'Svítí jen zelená šipka vlevo – rovně a vpravo se zatím nejede.';
    return you ? 'Svítí ti červená, musíš počkat na zelenou.' : 'Svítí mu červená, musí počkat na zelenou.';
  }
  const name = b.other.name;
  if (b.reason === 'ahead') return `${you ? 'Před tebou' : 'Před ním'} stojí ${name}, to musí odjet první.`;
  const prefix = `${you ? 'Musíš' : 'Musí'} dát přednost: ${name}`;
  const turning = you ? 'ty odbočuješ' : 'toto vozidlo odbočuje';
  const texts: Record<Exclude<Blocker['reason'], 'ahead' | 'police' | 'arrowOnly' | 'red'>, string> = {
    main: 'jede po hlavní pozemní komunikaci.',
    right: 'přijíždí zprava.',
    oncoming:
      !inter.signals && !inter.police && inter.mainArms.includes(v.from) && inter.mainArms.includes(b.other.from)
        ? `jede v protisměru po hlavní silnici a ${turning} z hlavní vlevo.`
        : `jede v protisměru a ${turning} vlevo.`,
    arrow: `jede ve volném směru a ${turning} vpravo jen na doplňkovou šipku.`,
    tramSameDir: `jede vedle ${you ? 'tebe' : 'něj'} a ${you ? 'křížíš' : 'kříží'} její dráhu (tramvaji se dává přednost).`,
    emergency: 'má zapnutý modrý maják a sirénu.',
    pedestrian: 'přechází po přechodu pro chodce.',
    tramFirst: 'chodec musí tramvaji vždy dát přednost.',
    ring: 'už jede po kruhovém objezdu.',
    ringRight: 'vjíždí zprava a objezd není označen „Dej přednost v jízdě!“, platí pravidlo pravé ruky.',
  };
  return `${prefix} – ${texts[b.reason as keyof typeof texts]}`;
}

function nextLabel(): string {
  if (!game || game.mode === 'practice') return 'Další křižovatka';
  return game.round + 1 >= TOTAL ? 'Zobrazit výsledek' : 'Další křižovatka';
}

function mistakeBlocks(m: Mistake, inter: Intersection): ModalBlock[] {
  const allowed = `Správná volba: ${m.allowed.map((v) => v.name).join(' nebo ')}.`;
  if (!m.vehicle) return [{ text: 'Čas vypršel.' }, { text: allowed }];
  const vehicle = m.vehicle;
  const who = vehicle.isPlayer ? 'Tvoje auto' : capitalize(vehicle.name);
  return [
    { text: `${who} teď ještě nesmí jet:` },
    { items: m.blockers.map((b) => blockerText(inter, vehicle, b)) },
    { text: allowed },
  ];
}

function finishRound(correct: boolean, mistake: Mistake | null): void {
  if (!game || !player) return;
  stopTimer();
  const current = game;
  const scenario = player.scenario;
  if (correct) current.good++;
  else current.bad++;
  current.points += correct ? scenario.difficulty : 0;
  current.maxPoints += scenario.difficulty;
  current.records.push({ scenario, correct });
  recordRound(scenario.intersection.label, correct);
  updateHud();
  if (correct) sounds.success();
  else sounds.error();

  if (current.mode === 'exam') {
    info.textContent = correct ? 'Správně.' : mistake?.vehicle ? 'Chyba.' : 'Čas vypršel.';
    const round = player;
    window.setTimeout(() => player === round && nextRound(), 1200);
    return;
  }
  if (correct) {
    showModal({
      kind: 'ok',
      title: 'Správně!',
      blocks: [
        { text: 'Všichni projeli ve správném pořadí:' },
        { items: player.passed.map((v) => capitalize(v.name)), ordered: true },
      ],
      actions: [{ label: nextLabel(), primary: true, onClick: nextRound }],
    });
    return;
  }
  const errorDialog = (): void =>
    showModal({
      kind: 'bad',
      title: 'Chyba!',
      blocks: [...mistakeBlocks(mistake as Mistake, scenario.intersection), { text: `Počet chyb: ${current.bad}` }],
      actions: [
        {
          label: 'Ukázat správné řešení',
          onClick: () => void player?.playSolution().then(errorDialog),
        },
        { label: nextLabel(), primary: true, onClick: nextRound },
      ],
    });
  errorDialog();
}

function startRound(): void {
  if (!game) return;
  const item =
    game.mode === 'practice'
      ? practiceItem(deriveSeed(game.seed, game.round), game.practiceType)
      : game.items[game.round];
  // callbacks of a replaced round must not touch the new one
  const round: RoundPlayer = new RoundPlayer(scene, generateScenario(item), {
    onProgress: () => player === round && updateInfo(),
    onComplete: () => player === round && finishRound(true, null),
    onMistake: (mistake) => player === round && finishRound(false, mistake),
  });
  player = round;
  updateHud();
  updateInfo();
  startTimer();
}

function nextRound(): void {
  if (!game) return;
  game.round++;
  if (game.mode !== 'practice' && game.round >= TOTAL) {
    finishGame();
    return;
  }
  startRound();
}

function shareUrl(current: Game): string {
  return `${location.origin}${location.pathname}?mode=${current.mode}&seed=${current.seed}`;
}

function startGame(mode: Mode, seed: number, practiceType: IntersectionType | null = null): void {
  game = {
    mode,
    seed,
    practiceType,
    items: mode === 'practice' ? [] : buildTestSequence(seed, TOTAL),
    round: 0,
    good: 0,
    bad: 0,
    points: 0,
    maxPoints: 0,
    records: [],
  };
  if (mode !== 'practice') history.replaceState(null, '', shareUrl(game));
  startRound();
}

function resultPercent(current: Game): number {
  return current.mode === 'exam'
    ? Math.round((current.points / Math.max(1, current.maxPoints)) * 100)
    : Math.round((current.good / TOTAL) * 100);
}

function finishGame(): void {
  if (!game) return;
  recordGame({ date: new Date().toISOString(), mode: game.mode, percent: resultPercent(game), seed: game.seed });
  showResult();
}

function reviewList(current: Game): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'review';
  current.records.forEach((record) => {
    const li = document.createElement('li');
    li.className = record.correct ? 'ok' : 'bad';
    const label = document.createElement('span');
    label.textContent = `${record.correct ? '✓' : '✗'} ${record.scenario.intersection.label}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small';
    button.textContent = 'Přehrát';
    button.addEventListener('click', () => void replay(record));
    li.append(label, button);
    list.appendChild(li);
  });
  return list;
}

async function replay(record: RoundRecord): Promise<void> {
  hideModal();
  player = new RoundPlayer(scene, record.scenario, { onProgress: updateInfo, onComplete: noop, onMistake: noop });
  updateHud();
  await player.playSolution();
  showModal({
    kind: 'info',
    title: 'Správné pořadí',
    blocks: [{ items: player.passed.map((v) => capitalize(v.name)), ordered: true }],
    actions: [{ label: 'Zpět na výsledky', primary: true, onClick: showResult }],
  });
}

function showResult(): void {
  if (!game) return;
  const current = game;
  const percent = resultPercent(current);
  const exam = current.mode === 'exam';
  const passed = percent >= EXAM_PASS_PERCENT;
  showModal({
    kind: passed ? 'ok' : 'bad',
    title: exam ? (passed ? 'Zkouška: prospěl(a)' : 'Zkouška: neprospěl(a)') : 'Test dokončen',
    blocks: [
      { text: `Správně ${current.good} z ${TOTAL} křižovatek, chyb ${current.bad}.` },
      {
        text: exam
          ? `Body: ${current.points} z ${current.maxPoints} (${percent} %), k úspěchu je potřeba ${EXAM_PASS_PERCENT} %.`
          : `Úspěšnost: ${percent} %`,
      },
      { text: `Kód testu: ${current.seed} – se stejným kódem dostaneš stejné křižovatky.` },
      { text: 'Rozbor křižovatek – kliknutím na „Přehrát“ uvidíš správné pořadí:' },
      { element: reviewList(current) },
    ],
    actions: [
      {
        label: 'Kopírovat odkaz',
        manual: true,
        onClick: (button) => {
          void navigator.clipboard?.writeText(shareUrl(current)).then(() => (button.textContent = 'Odkaz zkopírován'));
        },
      },
      { label: 'Znovu stejný test', onClick: () => startGame(current.mode, current.seed) },
      { label: 'Nový test', primary: true, onClick: () => startGame(current.mode, randomSeed()) },
      { label: 'Menu', onClick: showMenu },
    ],
  });
}

function statsBlock(): HTMLElement {
  const stats = loadStats();
  const box = document.createElement('div');
  box.className = 'stats';
  const lines: string[] = [];
  if (stats.best.test !== undefined) lines.push(`Nejlepší test: ${stats.best.test} %`);
  if (stats.best.exam !== undefined) lines.push(`Nejlepší zkouška: ${stats.best.exam} %`);
  const weakest = Object.entries(stats.byType)
    .filter(([, s]) => s.played >= 3)
    .map(([type, s]) => ({ type, rate: s.correct / s.played }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3)
    .filter((w) => w.rate < 1);
  if (weakest.length) {
    lines.push(`Nejvíc chyb: ${weakest.map((w) => `${w.type} (${Math.round(w.rate * 100)} %)`).join(', ')}`);
  }
  const last = stats.history[0];
  if (last)
    lines.push(`Poslední hra: ${last.mode === 'exam' ? 'zkouška' : 'test'} ${last.percent} % (kód ${last.seed})`);
  if (!lines.length) lines.push('Zatím žádné výsledky.');
  for (const text of lines) {
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
  }
  return box;
}

function menuForm(): { element: HTMLElement; seed: () => number; type: () => IntersectionType | null } {
  const element = document.createElement('div');
  element.className = 'menu-form';
  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'Procvičovat typ: ';
  const select = document.createElement('select');
  const any = new Option('všechny typy', '');
  select.append(any, ...TYPES.map((t) => new Option(LABELS[t], t)));
  typeLabel.appendChild(select);
  const seedLabel = document.createElement('label');
  seedLabel.textContent = 'Kód testu (nepovinné): ';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.maxLength = 10;
  input.placeholder = 'např. 482913';
  seedLabel.appendChild(input);
  element.append(typeLabel, seedLabel);
  return {
    element,
    seed: () => {
      const value = Number.parseInt(input.value.trim(), 10);
      return Number.isFinite(value) && value > 0 ? value : randomSeed();
    },
    type: () => (select.value ? (select.value as IntersectionType) : null),
  };
}

function showMenu(): void {
  stopTimer();
  const form = menuForm();
  showModal({
    kind: 'info',
    title: 'Přednost v jízdě',
    blocks: [
      {
        text: 'Na každé křižovatce klikej postupně na účastníky provozu v pořadí, v jakém smějí projet – včetně svého červeného auta.',
      },
      {
        items: [
          'Test: 30 křižovatek, po každé chybě vysvětlení a možnost přehrát správné řešení.',
          `Zkouška nanečisto: 30 křižovatek, ${EXAM_SECONDS} s na každou, body podle obtížnosti, k úspěchu ${EXAM_PASS_PERCENT} %.`,
          'Procvičování: neomezeně křižovatek vybraného typu.',
        ],
      },
      { element: form.element },
      { element: statsBlock() },
    ],
    actions: [
      { label: 'Test', primary: true, onClick: () => startGame('test', form.seed()) },
      { label: 'Zkouška nanečisto', onClick: () => startGame('exam', form.seed()) },
      { label: 'Procvičování', onClick: () => startGame('practice', randomSeed(), form.type()) },
      {
        label: 'Vymazat statistiky',
        manual: true,
        onClick: () => {
          resetStats();
          showMenu();
        },
      },
    ],
  });
}

hud.sound.addEventListener('click', () => {
  setSoundEnabled(!isSoundEnabled());
  updateSoundButton();
});
hud.menu.addEventListener('click', showMenu);
updateSoundButton();

const params = new URLSearchParams(location.search);
const urlMode = params.get('mode');
const urlSeed = Number.parseInt(params.get('seed') ?? '', 10);
if ((urlMode === 'test' || urlMode === 'exam') && Number.isFinite(urlSeed) && urlSeed > 0) {
  startGame(urlMode, urlSeed);
} else {
  player = new RoundPlayer(scene, generateScenario(practiceItem(randomSeed(), null)), {
    onProgress: noop,
    onComplete: noop,
    onMistake: noop,
  });
  showMenu();
}
