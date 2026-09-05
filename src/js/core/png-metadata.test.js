import test from 'node:test';
import assert from 'node:assert/strict';

import {
    injectMetadataIntoPNG,
    injectCtesFlyerDocumentIntoPNG,
    readMetadataFromPNG,
    readCtesFlyerDocumentFromPNG,
    CTES_FLYER_KEY,
    MAX_FLYER_METADATA_BYTES,
} from './png-metadata.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

function basePngBuffer() {
    const bytes = Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function flyerDocument() {
    return {
        specVersion: '1.0',
        kind: 'flyer',
        event: {
            title: 'Convoy del Sur',
            language: 'es-UY',
            eventType: 'convoy',
            game: 'ets2',
            network: {
                server: 'Simulation 1',
            },
            schedule: {
                meetingAt: '2026-09-05T20:30:00Z',
                startAt: '2026-09-05T21:00:00Z',
                timeZone: 'America/Montevideo',
            },
        },
    };
}

test('reads and writes the CTES flyer document', () => {
    const input = flyerDocument();
    const buffer = injectCtesFlyerDocumentIntoPNG(basePngBuffer(), input);
    const raw = readMetadataFromPNG(buffer, CTES_FLYER_KEY);

    assert.ok(raw);
    assert.deepEqual(readCtesFlyerDocumentFromPNG(buffer), input);
});

test('rejects duplicate flyer chunks', () => {
    const input = flyerDocument();
    const once = injectCtesFlyerDocumentIntoPNG(basePngBuffer(), input);
    const twice = injectCtesFlyerDocumentIntoPNG(once, input);

    assert.equal(readMetadataFromPNG(twice, CTES_FLYER_KEY), JSON.stringify(input));
    assert.equal(readCtesFlyerDocumentFromPNG(twice), null);
});

test('rejects malformed flyer metadata', () => {
    const buffer = injectMetadataIntoPNG(basePngBuffer(), CTES_FLYER_KEY, '{');

    assert.equal(readMetadataFromPNG(buffer, CTES_FLYER_KEY), '{');
    assert.equal(readCtesFlyerDocumentFromPNG(buffer), null);
});

test('rejects oversized flyer metadata writes', () => {
    const buffer = basePngBuffer();
    const oversized = 'x'.repeat(MAX_FLYER_METADATA_BYTES + 1);
    const result = injectMetadataIntoPNG(buffer, CTES_FLYER_KEY, oversized);

    assert.equal(result, buffer);
    assert.equal(readMetadataFromPNG(result, CTES_FLYER_KEY), null);
});
