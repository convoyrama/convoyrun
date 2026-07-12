// Helper to write a 32-bit unsigned integer to a DataView
function writeUint32(view, offset, value) {
    view.setUint32(offset, value, false); // PNG uses big-endian
}

// CRC32 checksum calculation
const crc32 = (function() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c;
    }
    return function(bytes, start = 0, length = bytes.length - start) {
        let crc = -1;
        for (let i = start, l = start + length; i < l; i++) {
            crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
        }
        return (crc ^ -1) >>> 0;
    };
})();

/**
 * Injects an iTXt chunk with custom metadata into a PNG ArrayBuffer.
 * iTXt supports UTF-8 and is the standard for international text in PNGs.
 * @param {ArrayBuffer} pngBuffer The original PNG data.
 * @param {string} key The metadata key (e.g., "convoyrama-event-data").
 * @param {string} value The metadata value (e.g., a JSON string).
 * @returns {ArrayBuffer} A new ArrayBuffer with the injected chunk.
 */
export function injectMetadataIntoPNG(pngBuffer, key, value) {
    const IEND_CHUNK_TYPE = 'IEND';
    const ITXT_CHUNK_TYPE = 'iTXt';

    const dataView = new DataView(pngBuffer);
    // PNG signature
    if (dataView.getUint32(0) !== 0x89504E47 || dataView.getUint32(4) !== 0x0D0A1A0A) {
        console.error("[PNG] Invalid signature.");
        return pngBuffer;
    }

    let offset = 8;
    while (offset < pngBuffer.byteLength) {
        const length = dataView.getUint32(offset);
        const type = String.fromCharCode(
            dataView.getUint8(offset + 4),
            dataView.getUint8(offset + 5),
            dataView.getUint8(offset + 6),
            dataView.getUint8(offset + 7)
        );
        
        // Find the IEND chunk, which must be the last one.
        if (type === IEND_CHUNK_TYPE) {
            const iendChunk = pngBuffer.slice(offset);
            const pngWithoutIend = pngBuffer.slice(0, offset);

            // iTXt structure:
            // Keyword: 1-79 bytes (character string)
            // Null separator: 1 byte
            // Compression flag: 1 byte (0 = uncompressed, 1 = compressed)
            // Compression method: 1 byte (0 = deflate)
            // Language tag: 0 or more bytes (character string)
            // Null separator: 1 byte
            // Translated keyword: 0 or more bytes
            // Null separator: 1 byte
            // Text: 0 or more bytes (UTF-8)

            const encoder = new TextEncoder();
            const keywordBytes = encoder.encode(key);
            const valueBytes = encoder.encode(value);
            const langTagBytes = encoder.encode(""); // Empty language tag
            const transKeyBytes = encoder.encode(""); // Empty translated keyword
            
            // Calculate total chunk data length
            // keyword (len) + null (1) + flag (1) + method (1) + lang (len) + null (1) + trans (len) + null (1) + value (len)
            const chunkDataLength = keywordBytes.length + 1 + 1 + 1 + langTagBytes.length + 1 + transKeyBytes.length + 1 + valueBytes.length;
            
            const newChunkBuffer = new ArrayBuffer(12 + chunkDataLength);
            const newChunkView = new DataView(newChunkBuffer);
            const newChunkBytes = new Uint8Array(newChunkBuffer);

            // Length
            writeUint32(newChunkView, 0, chunkDataLength);
            // Type
            newChunkBytes.set(encoder.encode(ITXT_CHUNK_TYPE), 4);
            
            // Data
            let dataOffset = 8;
            newChunkBytes.set(keywordBytes, dataOffset);
            dataOffset += keywordBytes.length;
            newChunkBytes[dataOffset++] = 0; // Null separator for keyword
            
            newChunkBytes[dataOffset++] = 0; // Compression flag: 0 (uncompressed)
            newChunkBytes[dataOffset++] = 0; // Compression method: 0
            
            newChunkBytes.set(langTagBytes, dataOffset);
            dataOffset += langTagBytes.length;
            newChunkBytes[dataOffset++] = 0; // Null separator for lang tag
            
            newChunkBytes.set(transKeyBytes, dataOffset);
            dataOffset += transKeyBytes.length;
            newChunkBytes[dataOffset++] = 0; // Null separator for translated keyword
            
            newChunkBytes.set(valueBytes, dataOffset);
            
            // CRC
            const crc = crc32(newChunkBytes, 4, chunkDataLength + 4);
            writeUint32(newChunkView, 8 + chunkDataLength, crc);

            // Combine the parts: original PNG (without IEND) + new chunk + IEND chunk
            const finalPngBuffer = new ArrayBuffer(pngWithoutIend.byteLength + newChunkBuffer.byteLength + iendChunk.byteLength);
            const finalPngBytes = new Uint8Array(finalPngBuffer);
            
            finalPngBytes.set(new Uint8Array(pngWithoutIend), 0);
            finalPngBytes.set(new Uint8Array(newChunkBuffer), pngWithoutIend.byteLength);
            finalPngBytes.set(new Uint8Array(iendChunk), pngWithoutIend.byteLength + newChunkBuffer.byteLength);

            return finalPngBuffer;
        }
        offset += 12 + length;
    }

    console.error("[PNG] IEND chunk not found.");
    return pngBuffer;
}

/**
 * Reads back the iTXt chunk written by injectMetadataIntoPNG — lets the app
 * load a flyer PNG it generated earlier and recover the original event data
 * (to regenerate Discord/TMP text without retyping everything).
 * @param {ArrayBuffer} pngBuffer The PNG data to read.
 * @param {string} key The metadata keyword to look for (e.g. "convoyrama-event-data").
 * @returns {string|null} The raw text stored in the chunk, or null if not found/invalid.
 */
export function readMetadataFromPNG(pngBuffer, key) {
    const dataView = new DataView(pngBuffer);
    if (dataView.getUint32(0) !== 0x89504E47 || dataView.getUint32(4) !== 0x0D0A1A0A) {
        return null;
    }

    const decoder = new TextDecoder('utf-8');
    let offset = 8;
    while (offset + 8 <= pngBuffer.byteLength) {
        const length = dataView.getUint32(offset);
        const type = String.fromCharCode(
            dataView.getUint8(offset + 4),
            dataView.getUint8(offset + 5),
            dataView.getUint8(offset + 6),
            dataView.getUint8(offset + 7)
        );

        if (type === 'iTXt') {
            const chunkBytes = new Uint8Array(pngBuffer, offset + 8, length);
            let pos = chunkBytes.indexOf(0);
            if (pos === -1) { offset += 12 + length; continue; }
            const keyword = decoder.decode(chunkBytes.subarray(0, pos));
            pos += 1; // null separator

            if (keyword === key) {
                pos += 2; // compression flag + method
                const langEnd = chunkBytes.indexOf(0, pos);
                pos = langEnd + 1;
                const transEnd = chunkBytes.indexOf(0, pos);
                pos = transEnd + 1;
                return decoder.decode(chunkBytes.subarray(pos));
            }
        }

        if (type === 'IEND') break;
        offset += 12 + length;
    }
    return null;
}
