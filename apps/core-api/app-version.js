/**
 * Product version + changelog helper.
 * Files (repo root): VERSION, CHANGELOG.md
 *
 * Usage from CLI:
 *   node app-version.js                 → print version
 *   node app-version.js bump patch "msg"
 *   node app-version.js bump minor "msg"
 *   node app-version.js bump major "msg"
 *   node app-version.js log "msg"       → append under current version
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERSION_CANDIDATES = [
  path.join(__dirname, 'VERSION'),          // next to server.js (prod deploy)
  path.join(ROOT, 'VERSION'),               // repo root (dev)
  path.join(__dirname, '..', 'VERSION')
];
const CHANGELOG_CANDIDATES = [
  path.join(__dirname, 'CHANGELOG.md'),
  path.join(ROOT, 'CHANGELOG.md')
];

function resolveExisting(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return paths[0];
}

const VERSION_FILE = resolveExisting(VERSION_CANDIDATES);
const CHANGELOG_FILE = resolveExisting(CHANGELOG_CANDIDATES);

function readVersion() {
  for (const p of VERSION_CANDIDATES) {
    try {
      if (!fs.existsSync(p)) continue;
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    } catch (e) {}
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg.version) return String(pkg.version);
  } catch (e) {}
  return '0.0.0';
}

function writeVersion(v) {
  fs.writeFileSync(VERSION_FILE, String(v).trim() + '\n', 'utf8');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function bumpSemver(ver, kind) {
  const parts = String(ver).split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  let [maj, min, pat] = parts;
  if (kind === 'major') { maj += 1; min = 0; pat = 0; }
  else if (kind === 'minor') { min += 1; pat = 0; }
  else { pat += 1; }
  return `${maj}.${min}.${pat}`;
}

function ensureChangelogHeader() {
  if (!fs.existsSync(CHANGELOG_FILE)) {
    fs.writeFileSync(CHANGELOG_FILE, '# Changelog — CRM WebAgency\n\n', 'utf8');
  }
}

/** Prepend a change bullet under ## [version] (create section if missing). */
function appendChange(message, version = null) {
  ensureChangelogHeader();
  const ver = version || readVersion();
  const msg = String(message || '').trim();
  if (!msg) return;
  let text = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  const heading = `## [${ver}]`;
  const entry = `- ${msg}`;
  if (text.includes(heading)) {
    // Insert after heading line (and optional date line)
    text = text.replace(
      new RegExp(`(## \\[${ver.replace(/\./g, '\\.')}\\][^\\n]*\\n(?:### [^\\n]+\\n)?)`),
      `$1${entry}\n`
    );
    // If replace didn't add (edge), fall through to prepend section
    if (!text.includes(entry)) {
      text = text.replace(heading, `${heading} — ${todayISO()}\n\n### Changed\n${entry}\n`);
    }
  } else {
    const block = `## [${ver}] — ${todayISO()}\n\n### Changed\n${entry}\n\n`;
    const idx = text.indexOf('\n## ');
    if (idx === -1) text = text.trimEnd() + '\n\n' + block;
    else text = text.slice(0, idx + 1) + block + text.slice(idx + 1);
  }
  fs.writeFileSync(CHANGELOG_FILE, text, 'utf8');
}

function bump(kind, message) {
  const next = bumpSemver(readVersion(), kind || 'patch');
  writeVersion(next);
  ensureChangelogHeader();
  const block = `## [${next}] — ${todayISO()}\n\n### Changed\n- ${String(message || 'Release').trim()}\n\n`;
  let text = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  const idx = text.search(/\n## \[/);
  if (idx === -1) text = text.trimEnd() + '\n\n' + block;
  else text = text.slice(0, idx + 1) + block + text.slice(idx + 1);
  fs.writeFileSync(CHANGELOG_FILE, text, 'utf8');
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.version = next;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } catch (e) {}
  return next;
}

function getInfo() {
  return {
    version: readVersion(),
    name: 'Vantegra CRM',
    changelogPath: 'CHANGELOG.md'
  };
}

if (require.main === module) {
  const [, , cmd, a, b] = process.argv;
  if (cmd === 'bump') {
    const v = bump(a || 'patch', b || 'Bump');
    console.log(v);
  } else if (cmd === 'log') {
    appendChange(a || 'Update');
    console.log(readVersion());
  } else {
    console.log(readVersion());
  }
}

module.exports = { readVersion, writeVersion, bump, appendChange, getInfo, bumpSemver };
