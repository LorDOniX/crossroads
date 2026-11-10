import type { LonLat } from './route';

const ALPHABET = '0ABCD2EFGH4IJKLMN6OPQRST8UVWXYZ-1abcd3efgh5ijklmn7opqrst9uvwxyz.';
const SCALE = 2 ** 28;

/** Decodes a Mapy.cz „Mirek“ string, same as `stringToCoords` from @mapy/mapy-utils. */
export function decodeMirek(str: string): LonLat[] {
  // unknown characters are skipped like in the original decoder
  const digits = [...str].map((ch) => ALPHABET.indexOf(ch)).filter((d) => d >= 0);
  let pos = 0;
  const read = (count: number): number => {
    if (pos + count > digits.length) throw new Error('Neúplný řetězec Mirek');
    let value = 0;
    for (let i = 0; i < count; i++) value = value * 64 + digits[pos++];
    return value;
  };

  const coords = [0, 0];
  const points: LonLat[] = [];
  for (let axis = 0; pos < digits.length; axis ^= 1) {
    const head = read(1);
    if ((head & 0b110000) === 0b110000) coords[axis] = (head & 0xf) * 2 ** 24 + read(4);
    else if (head & 0b100000) coords[axis] += (head & 0xf) * 2 ** 12 + read(2) - 2 ** 15;
    else coords[axis] += (head & 0x1f) * 2 ** 6 + read(1) - 2 ** 10;
    if (axis === 1) points.push([(coords[0] * 360) / SCALE - 180, (coords[1] * 180) / SCALE - 90]);
  }
  return points;
}
