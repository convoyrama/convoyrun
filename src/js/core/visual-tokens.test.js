import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EVENT_TYPE_COLORS,
    CONNECTION_STATE_COLORS,
    VOTE_SYMBOL_UP,
    VOTE_SYMBOL_DOWN,
    VOTE_ACTIVE_COLOR,
    VOTE_INACTIVE_COLOR,
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

test('desktop vote and connection tokens stay aligned with the shared spec', () => {
    assert.equal(VOTE_ACTIVE_COLOR, '#00aaff');
    assert.equal(VOTE_INACTIVE_COLOR, '#8a8a8a');
    assert.deepEqual(CONNECTION_STATE_COLORS, {
        online: '#4ade80',
        searching: '#facc15',
        offline: '#666666',
    });
});
