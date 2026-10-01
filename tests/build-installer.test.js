import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateVersion } from '../scripts/build-installer.mjs';

test('date versions have no leading zeros and always grow', () => {
    assert.equal(dateVersion(new Date(2026, 9, 2, 14, 35)), '2026.1002.1435');
    assert.equal(dateVersion(new Date(2027, 0, 5, 9, 5)), '2027.105.905');
    const order = [new Date(2026, 9, 2, 9, 5), new Date(2026, 9, 2, 14, 35), new Date(2026, 11, 31, 0, 0), new Date(2027, 0, 1, 0, 1)]
        .map((d) => dateVersion(d).split('.').map(Number));
    for (let i = 1; i < order.length; i++) {
        const [a, b] = [order[i - 1], order[i]];
        assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))), `${a} < ${b}`);
    }
});
