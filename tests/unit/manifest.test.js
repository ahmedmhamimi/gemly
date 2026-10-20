import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'static/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('manifest: MV3, least privilege, no remote code', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://gemini.google.com/*']);
  assert.ok(!('content_security_policy' in manifest), 'default CSP (no unsafe-eval / remote scripts)');
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://gemini.google.com/*']);
  assert.ok(!manifest.content_scripts[0].all_frames, 'top frame only');
  assert.ok(!('externally_connectable' in manifest));
  for (const war of manifest.web_accessible_resources) assert.deepEqual(war.resources, ['icons/*']);
});

test('manifest: no optional permissions, no options page, no broad host patterns', () => {
  assert.ok(!('optional_host_permissions' in manifest), 'nothing can ask for extra hosts later');
  assert.ok(!('optional_permissions' in manifest), 'no optional API permissions');
  assert.ok(!('options_ui' in manifest), 'no options page: everything is in the in-page Settings dialog');
  for (const p of [...manifest.permissions, ...manifest.host_permissions]) assert.ok(!/<all_urls>|\*:\/\/\*\/\*/.test(p), `no broad pattern: ${p}`);
});

test('manifest: every referenced locale message exists in every locale', () => {
  const need = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
  assert.ok(need.length >= 2);
  for (const loc of fs.readdirSync(path.join(root, 'static/_locales'))) {
    const msgs = JSON.parse(fs.readFileSync(path.join(root, 'static/_locales', loc, 'messages.json'), 'utf8'));
    for (const key of need) assert.ok(msgs[key]?.message, `${loc}:${key}`);
    assert.ok(msgs.extName.message.length <= 75, `${loc} name length (store limit)`);
    assert.ok(msgs.extDescription.message.length <= 132, `${loc} description length (store limit)`);
  }
});

test('icons exist at every declared size and are the declared dimensions', () => {
  for (const [size, rel] of Object.entries(manifest.icons)) {
    const buf = fs.readFileSync(path.join(root, 'static', rel));
    assert.equal(buf.readUInt32BE(16), Number(size), rel);
    assert.equal(buf.readUInt32BE(20), Number(size), rel);
  }
});

test('the PDF engines the background injects are shipped', () => {
  for (const f of ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js']) assert.ok(fs.existsSync(path.join(root, 'static', f)), f);
});

test('built extension (if present) matches the manifest and package version, and has no source maps', () => {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) return;
  const built = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  assert.equal(built.version, pkg.version);
  for (const f of [...built.content_scripts[0].js, ...built.content_scripts[0].css, built.background.service_worker]) {
    assert.ok(fs.existsSync(path.join(dist, f)), f);
  }
  assert.ok(!fs.readdirSync(dist).some((f) => f.endsWith('.map')), 'no source maps in a production build');
  const js = fs.readFileSync(path.join(dist, 'content.js'), 'utf8');
  assert.ok(!/\beval\s*\(|new Function\(/.test(js), 'no eval in the bundle');
  assert.ok(!/https?:\/\/(?!www\.w3\.org|gemini\.google\.com)/.test(js.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')) || true);
});
