import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeCsvCell, getInitialAvatar } from '../../frontend/src/utils/helpers.js';

test('map labels escape HTML and attribute delimiters', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
test('CSV export escapes spreadsheet formulas and quote/newline boundaries', () => {
  assert.equal(safeCsvCell('=SUM(1,2)'), '"\'=SUM(1,2)"');
  assert.equal(safeCsvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(safeCsvCell('\t=CMD()'), '"\'\t=CMD()"');
});
test('avatar initials cannot inject SVG markup', () => {
  const svg = decodeURIComponent(getInitialAvatar('< &').split(',')[1]);
  assert.ok(svg.includes('&lt;&amp;'));
  assert.ok(!svg.includes('<&'));
});
