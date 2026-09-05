import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EVENT_TYPE_COLORS,
    VOTE_SYMBOL_UP,
    VOTE_SYMBOL_DOWN,
} from './visual-tokens.js';

test('desktop visual tokens stay aligned with the shared event palette', () => {
    assert.deepEqual(EVENT_TYPE_COLORS, {
        convoy: '#00aaff',
        truck_show: '#ff9800',
        exploration: '#4caf50',
        competition: '#ef5350',
        other: '#78909c',
    });
});

test('desktop vote symbols remain a single positive-negative pair', () => {
    assert.equal(VOTE_SYMBOL_UP, '▲');
    assert.equal(VOTE_SYMBOL_DOWN, '▼');
});
