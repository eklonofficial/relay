// Imports a game module under the same ?v= stamp the game's own imports carry, so a test shares
// one module instance with the modules it exercises (./x.js and ./x.js?v=abc are different
// modules to the loader). The stamp is read from index.html's entry script.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/src="js\/main\.js\?v=([^"]+)"/);
export const STAMP = m ? m[1] : null;

export const load = rel => import(new URL(`../js/${rel}${STAMP ? `?v=${STAMP}` : ''}`, import.meta.url).href);
