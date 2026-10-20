/**
 * File names for extracted code blocks (pure).
 *
 * The extension comes from the language label Gemini shows above the block; when
 * that is missing or unknown the content is sniffed (shebang, <!doctype>, <?php,
 * <?xml, valid JSON). Anything else is plain `.txt`.
 */

const EXT = {
  python: 'py', py: 'py', python3: 'py', javascript: 'js', js: 'js', node: 'js', nodejs: 'js', mjs: 'mjs', typescript: 'ts', ts: 'ts',
  jsx: 'jsx', tsx: 'tsx', html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less', json: 'json', jsonc: 'jsonc',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', xml: 'xml', svg: 'svg', markdown: 'md', md: 'md', csv: 'csv', tsv: 'tsv', sql: 'sql',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'ps1', ps1: 'ps1', bat: 'bat', batch: 'bat', cmd: 'bat',
  java: 'java', kotlin: 'kt', kt: 'kt', scala: 'scala', groovy: 'groovy', c: 'c', h: 'h', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'hpp',
  csharp: 'cs', 'c#': 'cs', cs: 'cs', fsharp: 'fs', 'f#': 'fs', vb: 'vb', go: 'go', golang: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb',
  php: 'php', swift: 'swift', objectivec: 'm', 'objective-c': 'm', dart: 'dart', lua: 'lua', perl: 'pl', pl: 'pl', r: 'r', julia: 'jl',
  haskell: 'hs', hs: 'hs', elixir: 'ex', erlang: 'erl', clojure: 'clj', lisp: 'lisp', scheme: 'scm', ocaml: 'ml', matlab: 'm', octave: 'm',
  latex: 'tex', tex: 'tex', diff: 'diff', patch: 'patch', graphql: 'graphql', gql: 'graphql', proto: 'proto', protobuf: 'proto',
  vue: 'vue', svelte: 'svelte', solidity: 'sol', zig: 'zig', nim: 'nim', assembly: 'asm', asm: 'asm', verilog: 'v', vhdl: 'vhd',
  text: 'txt', plaintext: 'txt', plain: 'txt', txt: 'txt', log: 'log', terraform: 'tf', hcl: 'hcl', nginx: 'conf', apache: 'conf',
};

/** Files that are known by NAME, not extension. */
const SPECIAL = { dockerfile: 'Dockerfile', docker: 'Dockerfile', makefile: 'Makefile', make: 'Makefile', cmake: 'CMakeLists.txt' };

/** "Python " -> "python"; "C++" stays "c++"; "language-js" -> "js". */
export function normalizeLang(label) {
  return String(label ?? '').trim().toLowerCase().replace(/^language-/, '').split(/\s+/)[0].replace(/[^a-z0-9#+.-]/g, '');
}

function sniff(code) {
  const head = String(code ?? '').trimStart().slice(0, 300);
  if (/^#!.*\b(ba|z)?sh\b/.test(head)) return 'sh';
  if (/^#!.*python/.test(head)) return 'py';
  if (/^#!.*\bnode\b/.test(head)) return 'js';
  if (/^<!doctype html|^<html[\s>]/i.test(head)) return 'html';
  if (/^<\?php/.test(head)) return 'php';
  if (/^<\?xml/.test(head)) return 'xml';
  if (/^[{[]/.test(head)) {
    try {
      JSON.parse(String(code).trim());
      return 'json';
    } catch {
      /* not JSON */
    }
  }
  return 'txt';
}

/** @returns {{ ext: string, fixedName: string|null }} */
export function guessFile(lang, code = '') {
  const l = normalizeLang(lang);
  if (SPECIAL[l]) return { ext: SPECIAL[l].includes('.') ? SPECIAL[l].split('.').pop() : '', fixedName: SPECIAL[l] };
  return { ext: EXT[l] || sniff(code), fixedName: null };
}

const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 60) || 'code';

/**
 * One name per block: `<base>-<n>.<ext>` (n counts all blocks, so names stay stable if one is skipped).
 * Files known by name (Dockerfile, Makefile) keep it.
 * @param {{ lang: string, code: string }[]} blocks
 */
export function codeFileNames(blocks, base = 'code') {
  const b = safe(base);
  return blocks.map((blk, i) => {
    const { ext, fixedName } = guessFile(blk.lang, blk.code);
    return fixedName || `${b}-${i + 1}.${ext || 'txt'}`;
  });
}
