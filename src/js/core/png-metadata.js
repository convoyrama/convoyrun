function writeUint32(view, offset, value) {
    view.setUint32(offset, value, false); // PNG usa big-endian
}

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

// Inyecta un chunk iTXt (metadata custom en UTF-8) en un PNG.
export function injectMetadataIntoPNG(pngBuffer, key, value) {
    const IEND_CHUNK_TYPE = 'IEND';
    const ITXT_CHUNK_TYPE = 'iTXt';

    const dataView = new DataView(pngBuffer);
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
        
        if (type === IEND_CHUNK_TYPE) {
            const iendChunk = pngBuffer.slice(offset);
            const pngWithoutIend = pngBuffer.slice(0, offset);

            // iTXt: keyword\0 flag method lang\0 transkey\0 text (spec PNG 11.3.4.4)
            const encoder = new TextEncoder();
            const keywordBytes = encoder.encode(key);
            const valueBytes = encoder.encode(value);
            const langTagBytes = encoder.encode(""); // Empty language tag
            const transKeyBytes = encoder.encode(""); // Empty translated keyword
            
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

// Lee el chunk iTXt que escribe injectMetadataIntoPNG, para recargar un flyer viejo.
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
