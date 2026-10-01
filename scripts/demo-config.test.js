import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDemoConfig, buildConfigSummary, buildConfigFields, defaultConfigValues, previewTarget, MAX_PAGES_LIMIT } from './demo-config.js';
import { REFERENCE_SITES } from './demo-site-selection.js';

test('validateDemoConfig con los valores por defecto resuelve el primer sitio de referencia', () => {
  const { config, errors } = validateDemoConfig(defaultConfigValues());
  assert.deepEqual(errors, {});
  assert.equal(config.target, REFERENCE_SITES[0].url);
  assert.equal(config.channel, 'home_banking');
  assert.deepEqual(config.wcagTags, ['wcag2a', 'wcag2aa', 'best-practice']);
  assert.equal(config.auth, null);
});

test('validateDemoConfig suma los tags 2.1/2.2 solo si se activa la capa extendida', () => {
  const { config } = validateDemoConfig({ includeExtended: 'on' });
  assert.ok(config.includeExtended);
  assert.deepEqual(config.wcagTags, ['wcag2a', 'wcag2aa', 'best-practice', 'wcag21a', 'wcag21aa', 'wcag22aa']);
});

const URL_OK = { source: 'url', targetUrl: 'https://banco.com' };

test('validateDemoConfig exige URL http(s) para la fuente url', () => {
  assert.ok(validateDemoConfig({ source: 'url', targetUrl: '' }).errors.targetUrl);
  assert.ok(validateDemoConfig({ source: 'url', targetUrl: 'www.banco.com' }).errors.targetUrl);
  const { config } = validateDemoConfig({ source: 'url', targetUrl: ' https://banco.com ' });
  assert.equal(config.target, 'https://banco.com');
});

test('validateDemoConfig con carpeta local usa el path y audita todos los .html (sin tope)', () => {
  const { config, errors } = validateDemoConfig({ source: 'local', targetPath: 'C:\\sitio', maxPages: 999, channel: 'fax' });
  assert.deepEqual(errors, {});
  assert.equal(config.target, 'C:\\sitio');
  assert.equal(config.maxPages, null);
  assert.equal(config.channel, 'home_banking');
  assert.ok(validateDemoConfig({ source: 'local', targetPath: '' }).errors.targetPath);
});

test('validateDemoConfig con sitio de referencia ignora canal y máx. de páginas: arranca en la principal', () => {
  const { config, errors } = validateDemoConfig({ source: 'reference', channel: 'fax', maxPages: 0 });
  assert.deepEqual(errors, {});
  assert.equal(config.channel, 'home_banking');
  assert.deepEqual(config.selectedPages, []);
  assert.equal(config.maxPages, 1);
});

test('validateDemoConfig con sitio de referencia audita la principal + las páginas elegidas, igual que una URL', () => {
  const home = REFERENCE_SITES[0].url;
  const otra = new URL('/otra', home).href;
  const { config } = validateDemoConfig({ source: 'reference', referenceSite: '1', selectedPages: [otra, otra, home, 'no-es-url'] });
  assert.deepEqual(config.selectedPages, [otra]);
  assert.equal(config.maxPages, 2);
  assert.equal(buildConfigSummary(config).find((r) => r.label === 'Páginas').value, '2 (principal + 1 elegida(s))');
});

test('validateDemoConfig para una URL audita la home + las páginas elegidas (sin duplicados ni la home repetida)', () => {
  const { config } = validateDemoConfig({ ...URL_OK, selectedPages: ['https://banco.com/a', 'https://banco.com/a', 'https://banco.com', 'no-es-url'] });
  assert.deepEqual(config.selectedPages, ['https://banco.com/a']);
  assert.equal(config.maxPages, 2);
  const { config: solo } = validateDemoConfig(URL_OK);
  assert.deepEqual(solo.selectedPages, []);
  assert.equal(solo.maxPages, 1);
  const many = Array.from({ length: MAX_PAGES_LIMIT + 5 }, (_, i) => `https://banco.com/p${i}`);
  assert.equal(validateDemoConfig({ ...URL_OK, selectedPages: many }).config.maxPages, MAX_PAGES_LIMIT);
});

test('validateDemoConfig para una URL usa siempre Home Banking y acepta usuario de prueba', () => {
  const { config, errors } = validateDemoConfig({ ...URL_OK, channel: 'app_ios', authUser: 'qa', authPassword: 'x' });
  assert.deepEqual(errors, {});
  assert.equal(config.channel, 'home_banking');
  assert.equal(config.viewport.width, 1280);
  assert.deepEqual(config.auth, { type: 'basic', config: { username: 'qa', password: 'x' } });
});

test('buildConfigFields: sin canal, páginas para URL y sitio de referencia, usuario oculto para referencia y Path solo para carpeta', () => {
  const fields = Object.fromEntries(buildConfigFields().map((f) => [f.name, f]));
  assert.equal(fields.channel, undefined);
  assert.deepEqual(fields.authUser.showIf, { name: 'source', notEquals: 'reference' });
  assert.deepEqual(fields.authPassword.showIf, { name: 'source', notEquals: 'reference' });
  assert.equal(fields.maxPages, undefined);
  assert.equal(fields.selectedPages.type, 'pages');
  assert.deepEqual(fields.selectedPages.showIf, { name: 'source', in: ['url', 'reference'] });
  assert.deepEqual(fields.selectedPages.discoverFrom, ['targetUrl', 'referenceSite']);
  assert.deepEqual(fields.referenceSite.options.map((o) => o.url), REFERENCE_SITES.map((s) => s.url));
  assert.equal(fields.targetPath.label, 'Path');
  assert.deepEqual(fields.targetPath.showIf, { name: 'source', equals: 'local' });
  assert.deepEqual(fields.referenceSite.showIf, { name: 'source', equals: 'reference' });
});

test('validateDemoConfig exige usuario y contraseña juntos (carpeta local)', () => {
  const LOCAL = { source: 'local', targetPath: 'C:\\sitio' };
  assert.ok(validateDemoConfig({ ...LOCAL, authUser: 'test' }).errors.authPassword);
  assert.ok(validateDemoConfig({ ...LOCAL, authPassword: 'x' }).errors.authUser);
  const { config } = validateDemoConfig({ ...LOCAL, authUser: 'test', authPassword: 'x' });
  assert.deepEqual(config.auth, { type: 'basic', config: { username: 'test', password: 'x' } });
});

test('validateDemoConfig ignora el usuario de prueba con sitio de referencia', () => {
  const { config, errors } = validateDemoConfig({ source: 'reference', authUser: 'qa', authPassword: 'x' });
  assert.deepEqual(errors, {});
  assert.equal(config.auth, null);
});

test('validateDemoConfig interpreta checkboxes desmarcados como false', () => {
  const { config } = validateDemoConfig({ keyboardReview: 'false' });
  assert.equal(config.keyboardReview, false);
});

test('las pruebas de teclado del Agente reemplazan a las revisiones visual y de UX', () => {
  const fields = Object.fromEntries(buildConfigFields().map((f) => [f.name, f]));
  assert.equal(fields.keyboardReview.type, 'checkbox');
  assert.match(fields.keyboardReview.label, /Pruebas de teclado del Agente/);
  assert.equal(fields.visualAudit, undefined);
  assert.equal(fields.uxReview, undefined);
  assert.equal(validateDemoConfig(defaultConfigValues()).config.keyboardReview, true);
  const summary = buildConfigSummary(validateDemoConfig(defaultConfigValues()).config);
  assert.deepEqual(summary.find((r) => r.label === 'Pruebas de teclado del Agente'), { label: 'Pruebas de teclado del Agente', value: 'sí' });
});

test('buildConfigSummary nunca expone la contraseña', () => {
  const { config } = validateDemoConfig({ source: 'local', targetPath: 'C:\\sitio', authUser: 'qa', authPassword: 'secreta123' });
  const text = JSON.stringify(buildConfigSummary(config));
  assert.ok(text.includes('qa'));
  assert.ok(!text.includes('secreta123'));
});

test('buildConfigFields no precarga la contraseña aunque venga en los valores', () => {
  const fields = buildConfigFields({ authPassword: 'secreta123' });
  const pwd = fields.find((f) => f.name === 'authPassword');
  assert.equal(pwd.value, '');
});

test('buildConfigSummary para una URL muestra la cantidad de páginas elegidas y no el canal', () => {
  const rows = buildConfigSummary(validateDemoConfig({ ...URL_OK, selectedPages: ['https://banco.com/a'] }).config);
  const labels = rows.map((r) => r.label);
  assert.ok(!labels.includes('Canal'));
  assert.ok(labels.includes('Usuario de prueba'));
  assert.equal(rows.find((r) => r.label === 'Páginas').value, '2 (principal + 1 elegida(s))');
});

test('previewTarget resuelve qué mostrar en la vista previa según el modo', () => {
  assert.deepEqual(previewTarget({ source: 'reference', referenceSite: '2' }), { kind: 'url', target: REFERENCE_SITES[1].url });
  assert.deepEqual(previewTarget({ source: 'url', targetUrl: ' https://banco.com ' }), { kind: 'url', target: 'https://banco.com' });
  assert.equal(previewTarget({ source: 'url', targetUrl: 'banco' }), null);
  assert.deepEqual(previewTarget({ source: 'local', targetPath: 'C:\\sitio' }), { kind: 'local', target: 'C:\\sitio' });
  assert.equal(previewTarget({ source: 'local', targetPath: '' }), null);
});

test('buildConfigFields incluye la evaluación WCAG 2.0 A/AA siempre activa y bloqueada', () => {
  const base = buildConfigFields().find((f) => f.name === 'wcagBase');
  assert.equal(base.value, true);
  assert.equal(base.locked, true);
  assert.match(base.label, /WCAG 2\.0 \(niveles A, AA\)/);
  assert.deepEqual(validateDemoConfig({ wcagBase: false }).config.wcagTags.slice(0, 2), ['wcag2a', 'wcag2aa']);
});

test('buildConfigFields incluye los datos opcionales del VPAT como texto', () => {
  const fields = Object.fromEntries(buildConfigFields().map((f) => [f.name, f]));
  for (const name of ['vpatProductName', 'vpatProductVersion', 'vpatDescription', 'vpatContact']) {
    assert.equal(fields[name]?.type, 'text', name);
    assert.match(fields[name].placeholder, /^Opcional/);
  }
});

test('validateDemoConfig lleva a config.vpat solo los datos del VPAT cargados', () => {
  const { config } = validateDemoConfig({ vpatProductName: '  Banco X ', vpatProductVersion: '', vpatContact: 'a11y@x.test' });
  assert.deepEqual(config.vpat, { product_name: 'Banco X', contact: 'a11y@x.test' });
  assert.deepEqual(validateDemoConfig(defaultConfigValues()).config.vpat, {});
});

test('buildConfigSummary muestra los datos del VPAT solo si se cargaron', () => {
  const sin = buildConfigSummary(validateDemoConfig(defaultConfigValues()).config);
  assert.ok(!sin.some((r) => r.label === 'Datos para el VPAT'));
  const con = buildConfigSummary(validateDemoConfig({ vpatProductName: 'Banco X', vpatProductVersion: '3.2' }).config);
  assert.equal(con.find((r) => r.label === 'Datos para el VPAT').value, 'Banco X · 3.2');
});
