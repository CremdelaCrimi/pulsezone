// Move picker checks (v61): every card has a figure, every figure moves sensibly, and no card can
// switch on a move that steps you off your centre line.
import { PICK_CARDS, cardOn } from '../js/movepicker.js';
import { MOVE_FIGS, poseAt, bodyOf } from '../js/movefig.js';

let failed = 0, passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? `  (${extra})` : ''}`); };
const MOVE_KEYS = ['jab', 'low', 'swing', 'power', 'pair', 'guard', 'trace', 'sweep', 'hammer', 'knee', 'press', 'chop', 'tiptoe', 'bag', 'ropes', 'heavy', 'sled', 'barrage', 'duck', 'squatSide', 'lean', 'pillar', 'pose'];

console.log('== cards');
check('18 cards with unique ids', PICK_CARDS.length === 18 && new Set(PICK_CARDS.map((c) => c.id)).size === 18);
check('every card switches real moveset keys', PICK_CARDS.every((c) => c.keys.length && c.keys.every((k) => MOVE_KEYS.includes(k))));
check('every move on the board is on some card', MOVE_KEYS.every((k) => PICK_CARDS.some((c) => c.keys.includes(k))));
check('no card switches on side shifts (stay centred)', !PICK_CARDS.some((c) => c.keys.includes('shift')));
check('a card is on when any of its moves is on', cardOn(PICK_CARDS[0], { swing: true }) && !cardOn(PICK_CARDS[0], {}));
check('every card has a description under 120 characters', PICK_CARDS.every((c) => c.text && c.text.length <= 120), PICK_CARDS.filter((c) => c.text.length > 120).map((c) => c.id).join(','));

console.log('== figures');
check('every card has a figure', PICK_CARDS.every((c) => MOVE_FIGS[c.id]));
let finite = true, grounded = true, moving = true;
for (const [key, fig] of Object.entries(MOVE_FIGS)) {
  const heads = [];
  for (let b = 0; b < 12; b += 0.05) {
    const body = bodyOf(poseAt(fig, b), fig.view);
    const pts = [body.head, body.neck, body.hip, ...body.arms.flat(), ...body.legs.flat()];
    if (!pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) finite = false;
    if (body.legs.some((l) => l[2][1] < -0.01)) grounded = false;
    heads.push(body.head[1] + body.hands[0][0] + body.hands[1][1]);
  }
  if (Math.max(...heads) - Math.min(...heads) < 0.05) { moving = false; console.log(`    ${key} barely moves`); }
}
check('every figure has finite joints through its loop', finite);
check('no foot goes through the floor', grounded);
check('every figure visibly moves', moving);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('SOME CHECKS FAILED'); process.exit(1); }
console.log('ALL CHECKS PASSED');
