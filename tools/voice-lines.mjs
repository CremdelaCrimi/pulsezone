// Node side of tools/make-voice.ps1 (PowerShell does the speech and the MP3 encoding; this file knows the lines).
//   node tools/voice-lines.mjs                    the clips to render, as JSON: [{ id, text, say }]
//   node tools/voice-lines.mjs --manifest <json>  write assets/voice/manifest.json from the render results
//   node tools/voice-lines.mjs --check            compare the lines with how js/game.js calls the coach
// `say` is what the voice speaks; `text` is what the game passes (they differ for cues with a SPOKEN form).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PHRASES, CUES, SPOKEN, cueId } from '../js/coach-lines.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every clip, in a fixed order (phrases as written, then cues), so ids and file names never shuffle. */
export function voiceLines() {
  const out = [];
  for (const [key, list] of Object.entries(PHRASES)) list.forEach((text, i) => out.push({ id: `${key}.${i}`, text, say: text }));
  for (const text of CUES) out.push({ id: cueId(text), text, say: SPOKEN[text] ?? text });
  return out;
}

/** Problems that would make two lines fight over one file, or leave a line nothing to say. */
export function lineProblems(lines = voiceLines()) {
  const problems = [], seen = new Map();
  for (const l of lines) {
    const k = l.id.toLowerCase(); // Windows file names ignore case
    if (seen.has(k)) problems.push(`"${l.text}" and "${seen.get(k)}" share the id ${l.id}`);
    seen.set(k, l.text);
    if (!/^[\w.-]+$/.test(l.id) || l.id === 'cue.') problems.push(`"${l.text}" gives an id that is not a safe file name: ${l.id}`);
    if (!l.say.trim()) problems.push(`${l.id} has nothing to say`);
    if (/[^\x20-\x7e]/.test(l.say)) problems.push(`${l.id} has a character outside plain ASCII (no em dashes or curly quotes): ${l.say}`);
  }
  for (const text of Object.keys(SPOKEN)) if (!CUES.includes(text)) problems.push(`SPOKEN has an entry that is not in CUES: "${text}"`);
  return problems;
}

/** One clip per line keeps the file readable in a diff. */
export function manifestJson({ clips, ...head }) {
  const rows = Object.entries(clips).map(([id, c]) => `    ${JSON.stringify(id)}: ${JSON.stringify(c)}`);
  const top = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${top.join('\n')}\n  "clips": {\n${rows.join(',\n')}\n  }\n}\n`;
}

// ------------------------------------------------------------------ --check: the game's side of the contract

/** Calls of `name(` in JS source: { args: [source text of each argument], index, after: what follows the call }. */
function callsOf(src, name) {
  const out = [], re = new RegExp(`(?<![\\w$.])${name.replace(/\./g, '\\.')}\\(`, 'g');
  for (let m; (m = re.exec(src));) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue; // the declaration itself
    const args = []; let depth = 0, start = re.lastIndex, i = start;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '\'' || c === '"' || c === '`') { i = skipString(src, i); continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (!depth) break; depth--; }
      else if (c === ',' && !depth) { args.push(src.slice(start, i).trim()); start = i + 1; }
    }
    args.push(src.slice(start, i).trim());
    const lineEnd = src.indexOf('\n', i), nextEnd = src.indexOf('\n', lineEnd + 1);
    out.push({ args, index: m.index, after: src.slice(i + 1, nextEnd < 0 ? src.length : nextEnd) });
  }
  return out;
}
/** Index of the closing quote of the string that opens at `i` (template `${...}` parts are skipped whole). */
function skipString(src, i) {
  const q = src[i];
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (q === '`' && src[i] === '$' && src[i + 1] === '{') { let d = 1; for (i += 2; i < src.length && d; i++) { if (src[i] === '{') d++; else if (src[i] === '}') d--; } i--; }
    else if (src[i] === q) return i;
  }
  return i;
}
/** String literals in an expression that are its possible values (not operands of a comparison or of a nested call). */
function valueLiterals(expr) {
  const fixed = [], built = []; let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '\'' || c === '"' || c === '`') {
      const end = skipString(expr, i), raw = expr.slice(i + 1, end);
      const before = expr.slice(0, i).trimEnd(), after = expr.slice(end + 1).trimStart();
      const compared = /[=!]==?$/.test(before) || /^[=!]==?/.test(after);
      if (!depth && !compared && !/^[.[]/.test(after)) (c === '`' && raw.includes('${') ? built : fixed).push(raw.replace(/\\(.)/g, '$1'));
      i = end;
    }
  }
  return { fixed, built };
}

/**
 * How js/game.js uses the coach, set against the lines: which tier-1 call-outs have a clip, which
 * are left to browser speech (silent in the Quest browser), and any coach.line() key that does not exist.
 */
export function checkGame(gameSrc = readFileSync(`${root}js/game.js`, 'utf8'), coreSrc = readFileSync(`${root}js/core.js`, 'utf8')) {
  const cues = new Set(CUES);
  const skip = /coach\.say\(text/.test(gameSrc) && gameSrc.match(/!\/(\^[^\n]*?)\/\.test\(text\)\)\s*coach\.say\(text/);
  const skipRe = skip ? new RegExp(skip[1]) : null;
  const r = { unknownKeys: [], cue: [], phrase: [], skipped: [], speech: [], built: [], indirect: [], stale: [] };
  for (const c of callsOf(gameSrc, 'coach.line')) {
    for (const key of valueLiterals(c.args[0]).fixed) if (!Array.isArray(PHRASES[key])) r.unknownKeys.push(key);
  }
  const callOut = (text, followed) => {
    if (cues.has(text.trim())) r.cue.push(text);
    else if (skipRe?.test(text)) r.skipped.push(text);
    else if (followed) r.phrase.push(text);
    else r.speech.push(text);
  };
  for (const c of callsOf(gameSrc, 'say')) {
    if (c.args[c.args.length - 1] !== '1' || c.args.length < 2) continue; // only tier 1 is handed to the coach
    const { fixed, built } = valueLiterals(c.args[0]);
    const followed = /^[;\s}]*coach\.line\(/.test(c.after) || /\n\s*coach\.line\(/.test(c.after);
    for (const text of fixed) callOut(text, followed);
    for (const text of built) if (!skipRe?.test(text)) r.built.push(text);
    if (!fixed.length && !built.length) r.indirect.push(c.args[0]);
  }
  for (const c of callsOf(gameSrc, 'coach.say')) {
    if (c.args[0] === 'text') continue; // say()'s own hand-off, counted above
    const { fixed, built } = valueLiterals(c.args[0]);
    for (const text of fixed) if (text) callOut(text, false);
    r.built.push(...built);
  }
  for (const text of CUES) if (!gameSrc.includes(text) && !coreSrc.includes(text)) r.stale.push(text);
  return r;
}

// ------------------------------------------------------------------ command line

const escapeNonAscii = (s) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function main(argv) {
  const lines = voiceLines(), problems = lineProblems(lines);
  if (problems.length) { console.error(`voice-lines: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); return 1; }

  if (argv[0] === '--manifest') {
    // PowerShell hands over { dir, voice, format, ..., clips: { id: { file, ms } } }; the texts come from here.
    const { dir, clips: done, ...head } = JSON.parse(readFileSync(argv[1], 'utf8').replace(/^﻿/, ''));
    const clips = {}, missing = [];
    for (const l of lines) {
      const d = done[l.id];
      if (!d) { missing.push(l.id); continue; }
      clips[l.id] = { file: d.file, text: l.text, ...(l.say !== l.text ? { spoken: l.say } : {}), ms: d.ms };
    }
    writeFileSync(`${dir}/manifest.json`, manifestJson({ ...head, clips }));
    console.log(`manifest.json: ${Object.keys(clips).length} of ${lines.length} clips${missing.length ? `  MISSING: ${missing.join(', ')}` : ''}`);
    return missing.length ? 1 : 0;
  }

  if (argv[0] === '--check') {
    const r = checkGame(), show = (title, list) => { if (list.length) console.log(`\n${title} (${list.length})\n  ${[...new Set(list)].join('\n  ')}`); };
    console.log(`${lines.length} clips: ${Object.keys(PHRASES).length} phrase keys, ${CUES.length} cues`);
    show('coach.line() keys in js/game.js that are NOT in PHRASES (never spoken)', r.unknownKeys);
    show('Tier-1 call-outs with a cue clip', r.cue);
    show('Tier-1 call-outs followed by a coach.line(): the phrase is the spoken version', r.phrase);
    show('Tier-1 call-outs on the game\'s skip list (never handed to the coach)', r.skipped);
    show('Tier-1 call-outs with NO clip: browser speech only, silent in the Quest browser', r.speech);
    show('Built from numbers or names: browser speech only', r.built);
    show('Passed through a table or a variable: check by hand that CUES has them', r.indirect);
    show('CUES not found in js/game.js or js/core.js any more (unused clips)', r.stale);
    return r.unknownKeys.length ? 1 : 0;
  }

  console.log(escapeNonAscii(JSON.stringify(lines))); // ASCII only: PowerShell 5.1 reads native output in the OEM code page
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
