# Přednost v jízdě – křižovatky

Webová hra na procvičování přednosti v jízdě podle zákona č. 361/2000 Sb. Na náhodně vygenerované křižovatce
(pohled shora) označíš všechny účastníky provozu, kteří smějí jet současně – včetně svého červeného auta – a potvrdíš
tlačítkem „Jeďte“. Pak pokračuješ další skupinou, dokud křižovatkou neprojedou všichni.

## Herní režimy

- **Test** – 30 křižovatek, výsledek = podíl správně vyřešených.
- **Zkouška nanečisto** – 30 křižovatek, na každou 25 s, bez vysvětlování chyb; body podle obtížnosti, na úspěch je
  potřeba 85 %.
- **Procvičování** – nekonečně křižovatek, volitelně jen jednoho typu.

Po chybě hra vysvětlí, komu měl řidič dát přednost a proč, a umí přehrát správné řešení. Na konci testu je přehled všech
křižovatek s možností přehrání. Statistiky se ukládají do `localStorage`.

Test lze sdílet odkazem – zadání se generuje deterministicky ze seedu: `?mode=test&seed=12345` (případně `mode=exam`).

### Co se na křižovatkách objevuje

- rovnocenné křižovatky (X a T), hlavní silnice rovná i lomená (s dodatkovou tabulkou tvaru),
- světelná signalizace včetně zelené šipky vlevo, doplňkové šipky vpravo a přerušovaného žlutého světla,
- řízení policistou, kruhové objezdy (s i bez „Dej přednost v jízdě!“ na vjezdu),
- osobní a nákladní auta, tramvaje, sanitka s majákem, chodci na přechodech, kolony vozidel.

Ovládání myší, dotykem i klávesnicí (Tab + Enter/mezerník označí vozidlo, pak Tab na „Jeďte“). Veškerá grafika je SVG generované v kódu, žádné externí
obrázky.

## Vývoj

Požadavky: Node.js 22.15+ (vyžaduje vitest 5 a webpack-dev-server 6) a npm.

```sh
npm install
npm start          # dev server na http://localhost:8080
npm test           # testy pravidel a generátoru (vitest)
npm run typecheck
npm run lint
npm run format     # prettier
npm run build      # statický web do dist/
```

Obsah `dist/` stačí nahrát na libovolný statický hosting.

## Struktura

| Soubor             | Obsah                                                                |
| ------------------ | -------------------------------------------------------------------- |
| `src/rules.ts`     | pravidla přednosti (model křížení drah, semafory, policista, objezd) |
| `src/generator.ts` | náhodné generování křižovatek a vozidel, sestavení testu ze seedu    |
| `src/geometry.ts`  | rozměry silnic, jízdní pruhy, trajektorie vozidel                    |
| `src/render.ts`    | vykreslení scény (silnice, značky, semafory) a animace               |
| `src/sprites.ts`   | SVG vozidel, chodců a policisty                                      |
| `src/round.ts`     | průběh jednoho kola (výběr skupiny, kontrola, přehrání řešení)       |
| `src/main.ts`      | herní smyčka, HUD, dialogy, menu, výsledky                           |
| `src/storage.ts`   | statistiky v `localStorage`                                          |
| `src/audio.ts`     | zvukové efekty (Web Audio)                                           |
| `src/random.ts`    | deterministický generátor náhodných čísel                            |
| `tests/`           | testy pravidel a řešitelnosti vygenerovaných křižovatek              |

## Poznámky k závislostem

- `npm audit` hlásí zranitelnost v balíčku `braces` (přes `webpack-dev-server` → `http-proxy-middleware`). Opravená
  verze zatím neexistuje; týká se jen lokálního dev serveru, ne výsledného webu.
- Instalační skript `fsevents` je v `package.json` (`allowScripts`) zakázaný – balíček obsahuje předkompilovanou
  binárku a skript by ji jen zbytečně překládal přes `node-gyp`.
