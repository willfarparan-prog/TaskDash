const test = require('node:test');
const assert = require('node:assert/strict');
const { load, response } = require('./helpers');
function route(rows = [{ id: 7 }]) {
  const queries = [];
  const { exports: handler } = load('lib/routes/events.js', {
    '../db': { ensureWorkspaceSchema: async () => {}, trackUsage() {}, getPool: () => ({ query: async (sql, params) => { queries.push({ sql, params }); return { rows }; } }) },
    '../session': { requireOwnerSession: () => true },
    '../eventDrafts': {}, '../eventReport': {},
  });
  return { handler, queries };
}
test('rescheduling changes only the date and returns existing event work', async () => {
  const event = { id: 7, event_date: '2026-12-04', pipeline_state: { room: true, _survey: { responses: 5 } }, drafts: { slack: { text: 'Edited message' } }, report: { notes: 'Saved notes' } };
  const { handler, queries } = route([event]);
  const res = response();
  await handler({ method: 'PATCH', query: { id: '7' }, body: { date: '2026-12-04' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, event);
  assert.match(queries[0].sql, /set event_date=\$1 where id=\$2 returning/);
  assert.deepEqual(Array.from(queries[0].params), ['2026-12-04', '7']);
});
test('invalid event dates are rejected before writing', async () => {
  for (const date of ['', null, '2026-02-30', '2026-13-01', '2026-2-01', '0000-01-01', '2025-02-29']) {
    const { handler, queries } = route(); const res = response();
    await handler({ method: 'PATCH', query: { id: '7' }, body: { date } }, res);
    assert.equal(res.statusCode, 400, String(date)); assert.equal(queries.length, 0);
  }
});
test('rescheduling accepts leap days and reports missing events', async () => {
  const { handler, queries } = route([]); const res = response();
  await handler({ method: 'PATCH', query: { id: '7' }, body: { date: '2028-02-29' } }, res);
  assert.equal(queries.length, 1); assert.equal(res.statusCode, 404);
});
