import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvelope } from './http.ts';

describe('parseEnvelope', () => {
  it('accepts code envelope success', () => {
    assert.equal(parseEnvelope<number>({ code: 0, message: 'ok', data: 42 }), 42);
  });

  it('throws on code envelope error', () => {
    assert.throws(
      () => parseEnvelope({ code: 400, message: 'bad', data: null }),
      /bad/
    );
  });

  it('accepts success envelope', () => {
    assert.deepEqual(parseEnvelope<{ a: number }>({ success: true, data: { a: 1 } }), { a: 1 });
  });

  it('throws on success envelope error', () => {
    assert.throws(
      () => parseEnvelope({ success: false, error: 'nope' }),
      /nope/
    );
  });
});
