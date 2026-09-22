import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidateJobs } from './consolidate-jobs.js';

function scoreDoc(overrides) {
  return {
    summary: {
      onti_criteria_compliant: 35,
      onti_criteria_evaluated: 38,
      onti_compliance_percentage: 92.11,
      onti_conformance: true,
      total_urls_evaluated: 10,
      ...overrides
    }
  };
}

test('consolidateJobs agrega los 3 canales y calcula el score ponderado por URLs evaluadas', () => {
  const result = consolidateJobs([
    { jobId: 'job-hb', channel: 'home_banking', score: scoreDoc({ onti_compliance_percentage: 100, total_urls_evaluated: 10 }) },
    { jobId: 'job-ios', channel: 'app_ios', score: scoreDoc({ onti_compliance_percentage: 50, onti_conformance: false, total_urls_evaluated: 10 }) },
    { jobId: 'job-android', channel: 'app_android', score: scoreDoc({ onti_compliance_percentage: 80, total_urls_evaluated: 0 }) }
  ]);

  assert.equal(result.channels.length, 3);
  // (100*10 + 50*10 + 80*0) / 20 = 75
  assert.equal(result.global.weighted_onti_compliance_percentage, 75);
  assert.equal(result.global.channels_conformant, 2);
  assert.equal(result.global.channels_total, 3);
  assert.equal(result.global.total_urls_evaluated, 20);
  assert.equal(result.global.weighting_method, 'total_urls_evaluated');
});

test('consolidateJobs cae a promedio simple si ningún canal tiene URLs evaluadas', () => {
  const result = consolidateJobs([
    { jobId: 'job-hb', channel: 'home_banking', score: scoreDoc({ onti_compliance_percentage: 60, total_urls_evaluated: 0 }) },
    { jobId: 'job-ios', channel: 'app_ios', score: scoreDoc({ onti_compliance_percentage: 40, total_urls_evaluated: 0 }) }
  ]);
  assert.equal(result.global.weighted_onti_compliance_percentage, 50);
});

test('consolidateJobs con un solo canal iguala el score global al de ese canal', () => {
  const result = consolidateJobs([
    { jobId: 'job-hb', channel: 'home_banking', score: scoreDoc({ onti_compliance_percentage: 88, total_urls_evaluated: 7 }) }
  ]);
  assert.equal(result.global.weighted_onti_compliance_percentage, 88);
  assert.equal(result.global.channels_total, 1);
});

test('consolidateJobs requiere al menos un reporte de canal', () => {
  assert.throws(() => consolidateJobs([]), /requiere al menos un reporte/);
});
