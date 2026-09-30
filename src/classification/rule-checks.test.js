import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRuleChecks } from './rule-checks.js';

const r = (id, tags) => ({ id, tags });
const result = {
  url: 'https://a.test',
  violations: [r('color-contrast', ['wcag2aa', 'wcag143']), r('link-name', ['wcag2a', 'wcag244', 'wcag412']), r('aria-dialog-name', ['best-practice']), r('target-size', ['wcag22aa', 'wcag258'])],
  incomplete: [r('aria-valid-attr-value', ['wcag2a', 'wcag412'])],
  passes: [r('color-contrast', ['wcag2aa', 'wcag143']), r('html-has-lang', ['wcag2a', 'wcag311']), r('region', ['best-practice'])],
  inapplicable: [r('image-alt', ['wcag2a', 'wcag111']), r('skip-link', ['best-practice'])]
};

test('summarizeRuleChecks separa reglas WCAG y buenas prácticas por resultado', () => {
  const s = summarizeRuleChecks(result);
  assert.deepEqual(s.wcag, { fail: 2, review: 1, pass: 2, inapplicable: 1, criteria_with_pass: 2 });
  assert.deepEqual(s.best_practice, { fail: 1, review: 0, pass: 1, inapplicable: 1 });
});

test('summarizeRuleChecks suma WCAG 2.1/2.2 solo con includeExtended', () => {
  assert.equal(summarizeRuleChecks(result, { includeExtended: true }).wcag.fail, 3);
});

test('summarizeRuleChecks tolera un resultado sin categorías', () => {
  assert.deepEqual(summarizeRuleChecks({ url: 'x' }).wcag, { fail: 0, review: 0, pass: 0, inapplicable: 0, criteria_with_pass: 0 });
});
