import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidateJobs } from './consolidate-jobs.js';

// score-compliance.json mínimo: la Sección 1 con 3 criterios alcanza para probar la consolidación.
function scoreDoc(statuses, urls = 10) {
  const byCriterion = Object.entries(statuses).map(([id, status]) => ({ wcag_criterion: id, level: 'A', in_scope: 'onti', status }));
  const n = (s) => byCriterion.filter((c) => c.status === s).length;
  return {
    summary: { total_urls_evaluated: urls, total: byCriterion.length - n('no_aplica'), ok: n('ok'), nok: n('nok'), a_validar: n('a_validar'), no_aplica: n('no_aplica') },
    wcag_section: { by_criterion: byCriterion }
  };
}

test('consolidateJobs muestra los conteos de cada canal', () => {
  const result = consolidateJobs([
    { jobId: 'job-hb', channel: 'home_banking', score: scoreDoc({ '1.1.1': 'ok', '1.4.3': 'nok', '2.4.7': 'a_validar' }, 10) },
    { jobId: 'job-ios', channel: 'app_ios', score: scoreDoc({ '1.1.1': 'ok', '1.4.3': 'ok', '2.4.7': 'a_validar' }, 5) }
  ]);
  assert.deepEqual(result.channels[0], { job_id: 'job-hb', channel: 'home_banking', total: 3, ok: 1, nok: 1, a_validar: 1, no_aplica: 0, total_urls_evaluated: 10 });
  assert.equal(result.global.channels_total, 2);
  assert.equal(result.global.total_urls_evaluated, 15);
});

test('consolidateJobs combina por criterio con el peor caso entre canales', () => {
  const result = consolidateJobs([
    { jobId: 'a', channel: 'home_banking', score: scoreDoc({ '1.1.1': 'ok', '1.4.3': 'nok', '2.4.7': 'ok', '3.1.1': 'ok' }) },
    { jobId: 'b', channel: 'app_ios', score: scoreDoc({ '1.1.1': 'ok', '1.4.3': 'ok', '2.4.7': 'a_validar', '3.1.1': 'no_aplica' }) }
  ]);
  // 1.1.1 OK en todos; 1.4.3 NOK en uno; 2.4.7 a validar en uno; 3.1.1 OK + no aplica = OK
  assert.deepEqual(
    { total: result.global.total, ok: result.global.ok, nok: result.global.nok, a_validar: result.global.a_validar, no_aplica: result.global.no_aplica },
    { total: 4, ok: 2, nok: 1, a_validar: 1, no_aplica: 0 }
  );
  assert.equal(result.global.channels_con_nok, 1);
});

test('consolidateJobs no emite veredicto ni porcentaje ponderado', () => {
  const result = consolidateJobs([{ jobId: 'a', channel: 'home_banking', score: scoreDoc({ '1.1.1': 'ok' }) }]);
  for (const removed of ['weighted_onti_compliance_percentage', 'channels_conformant', 'weighting_method']) {
    assert.equal(removed in result.global, false, removed);
  }
});

test('consolidateJobs rechaza reportes viejos sin la Sección 1 con un mensaje claro', () => {
  assert.throws(
    () => consolidateJobs([{ jobId: 'viejo', channel: 'home_banking', score: { summary: { onti_compliance_percentage: 90, total_urls_evaluated: 3 } } }]),
    /viejo.*versión anterior/
  );
});

test('consolidateJobs requiere al menos un reporte de canal', () => {
  assert.throws(() => consolidateJobs([]), /requiere al menos un reporte/);
});
