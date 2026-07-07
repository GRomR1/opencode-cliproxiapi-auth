import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeForLog, formatErrorForLog } from '../dist/src/logger.js';

test('sanitizeForLog redacts bearer tokens and api keys', () => {
  const input = 'Bearer sk-secret123 apiKey: "leak" "key":"also-leak"';
  const out = sanitizeForLog(input);
  assert.match(out, /Bearer \[REDACTED\]/);
  assert.match(out, /apiKey=\[REDACTED\]/);
  assert.match(out, /"key":"\[REDACTED\]"/);
  assert.doesNotMatch(out, /sk-secret123/);
});

test('sanitizeForLog redacts standalone sk- tokens', () => {
  const out = sanitizeForLog('failed with sk-abcdefghijklmnop');
  assert.match(out, /sk-\[REDACTED\]/);
  assert.doesNotMatch(out, /abcdefghijklmnop/);
});

test('formatErrorForLog sanitizes Error messages', () => {
  const out = formatErrorForLog(new Error('auth failed Bearer sk-live-token'));
  assert.match(out, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(out, /sk-live-token/);
});