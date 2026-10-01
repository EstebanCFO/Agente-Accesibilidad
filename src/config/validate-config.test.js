import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, redactConfig } from './validate-config.js';

test('acepta un config url_list mínimo y aplica defaults', () => {
  const { valid, errors, config } = validateConfig({
    target: { channel: 'home_banking', mode: 'url_list', urls: ['https://banco.test/login'] }
  });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
  assert.equal(config.wcag.baseline, 'onti_2019');
  assert.deepEqual(config.wcag.levels, ['A', 'AA']);
  assert.equal('conformance_threshold' in config.wcag, false);
  assert.equal(config.wcag.extended_22, false);
  assert.equal(config.scope.max_urls, 100);
  assert.equal(config.scope.parallel_workers, 3);
  assert.equal(config.agent.max_iterations, 30);
  assert.equal(config.agent.model, 'claude-sonnet-5');
  assert.match(config.job_id, /^[0-9a-f-]{36}$/);
});

test('respeta job_id; ignora con aviso el umbral y los skills retirados de configs viejas', () => {
  const { valid, config, warnings } = validateConfig({
    job_id: 'job-fijo-123',
    target: { channel: 'app_ios', mode: 'url_list', urls: ['https://app.test/home'] },
    wcag: { conformance_threshold: 32 },
    skills: { visual_audit: true, ux_compliance_review: false }
  });
  assert.equal(valid, true);
  assert.equal(config.job_id, 'job-fijo-123');
  assert.equal('conformance_threshold' in config.wcag, false);
  assert.deepEqual(config.skills, { keyboard_review: true, generate_remediation_plan: true });
  assert.equal(warnings.length, 3);
  assert.match(warnings.join(' '), /conformance_threshold/);
  assert.match(warnings.join(' '), /visual_audit/);
});

test('rechaza config sin target.channel', () => {
  const { valid, errors, config } = validateConfig({ target: { mode: 'url_list', urls: ['https://x.test'] } });
  assert.equal(valid, false);
  assert.equal(config, null);
  assert.ok(errors.some((e) => e.includes('target.channel')));
});

test('rechaza target.channel con valor fuera del enum', () => {
  const { valid, errors } = validateConfig({ target: { channel: 'desktop_app', mode: 'url_list', urls: ['https://x.test'] } });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target.channel')));
});

test('rechaza mode=crawl sin root_url', () => {
  const { valid, errors } = validateConfig({ target: { channel: 'home_banking', mode: 'crawl' } });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target.root_url')));
});

test('rechaza mode=url_list con urls vacío', () => {
  const { valid, errors } = validateConfig({ target: { channel: 'home_banking', mode: 'url_list', urls: [] } });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target.urls')));
});

test('rechaza config sin target', () => {
  const { valid, errors } = validateConfig({});
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('target')));
});

test('redactConfig oculta username/password/bearer_token/cookies sin mutar el original', () => {
  const { config } = validateConfig({
    target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] },
    auth: { type: 'basic', config: { username: 'admin', password: 'SUPERSECRET', bearer_token: 'tok123', cookies: [{ name: 'sid', value: 'abc123', domain: 'x.test' }] } }
  });
  const redacted = redactConfig(config);
  assert.equal(redacted.auth.config.username, '[REDACTED]');
  assert.equal(redacted.auth.config.password, '[REDACTED]');
  assert.equal(redacted.auth.config.bearer_token, '[REDACTED]');
  assert.equal(redacted.auth.config.cookies[0].value, '[REDACTED]');
  assert.equal(config.auth.config.password, 'SUPERSECRET');
});

test('los skills por defecto son las pruebas de teclado y el plan de remediación', () => {
  const { config } = validateConfig({ target: { channel: 'home_banking', mode: 'url_list', urls: ['https://banco.test'] } });
  assert.deepEqual(config.skills, { keyboard_review: true, generate_remediation_plan: true });
});

const VPAT_TARGET = { channel: 'home_banking', mode: 'url_list', urls: ['https://a.test'] };

test('validateConfig acepta el bloque opcional vpat', () => {
  const { valid, config, warnings } = validateConfig({
    target: VPAT_TARGET,
    vpat: { product_name: 'Banco X', product_version: '3.2', description: 'Portal', contact: 'a11y@x.test' }
  });
  assert.equal(valid, true);
  assert.deepEqual(config.vpat, { product_name: 'Banco X', product_version: '3.2', description: 'Portal', contact: 'a11y@x.test' });
  assert.deepEqual(warnings, []);
});

test('validateConfig sin vpat sigue siendo válida y deja vpat vacío', () => {
  const { valid, config } = validateConfig({ target: VPAT_TARGET });
  assert.equal(valid, true);
  assert.deepEqual(config.vpat, {});
});

test('validateConfig ignora con aviso los campos vpat que no son texto y las claves desconocidas', () => {
  const { valid, config, warnings } = validateConfig({ target: VPAT_TARGET, vpat: { product_name: 42, contact: 'ok', otro: 'x' } });
  assert.equal(valid, true);
  assert.deepEqual(config.vpat, { contact: 'ok' });
  assert.ok(warnings.some((w) => w.includes('vpat.product_name')));
});

test('validateConfig ignora con aviso un vpat que no es objeto', () => {
  for (const vpat of ['Banco X', ['a'], 7]) {
    const { valid, config, warnings } = validateConfig({ target: VPAT_TARGET, vpat });
    assert.equal(valid, true);
    assert.deepEqual(config.vpat, {});
    assert.ok(warnings.some((w) => w.startsWith('vpat se ignora')));
  }
});
