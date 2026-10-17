/**
 * Tripwire: the submission form, its handlers, analytics calls and the
 * server's submission/question routes must stay byte-for-byte identical to
 * the audited baseline while presentation fixes land elsewhere on the page.
 */
const path = require('path');
const { hashAll } = require('../helpers/protected-regions');
const baseline = require('../fixtures/protected-baseline.json');

const current = hashAll(path.resolve(__dirname, '../..'));

describe('protected submission regions are unchanged', () => {
  test.each(Object.keys(baseline))('%s', key => {
    expect(current[key]).toBe(baseline[key]);
  });
});
