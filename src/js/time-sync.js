// Semáforo de confianza (mismo patrón que usa LAG-ID para su estado de
// verificación de hora): 3 puntos, uno solo prendido a la vez. Acá solo
// confirma que hay red y se puede leer un reloj de servidor real — importa
// porque los timestamps de Discord salen del reloj local, y si está mal
// queda mal para todos sin que nadie se entere.
//
// Usa el plugin http de Tauri (el pedido sale desde Rust) en vez del fetch()
// nativo del webview: un fetch() común a un host externo desde el origen
// custom de la app choca con CORS y falla en silencio.
import { dom } from './dom.js';

const TIME_SOURCES = ['https://convoyrama.github.io/', 'https://github.com/'];
const TIMEOUT_MS = 8000;

async function fetchServerDate(url) {
    try {
        const response = await window.__TAURI__.http.fetch(url, { method: 'HEAD', connectTimeout: TIMEOUT_MS });
        const dateHeader = response.headers.get('date');
        return dateHeader ? new Date(dateHeader).getTime() : null;
    } catch {
        return null;
    }
}

function setStatus(status) {
    dom.timeSyncDots.forEach(dot => dot.classList.remove('active', 'blink'));
    const dot = dom.timeSyncDots.find(d => d.dataset.status === status);
    if (!dot) return;
    dot.classList.add('active');
    if (status !== 'verified') dot.classList.add('blink');
}

export async function syncTime() {
    setStatus('syncing');
    const results = await Promise.all(TIME_SOURCES.map(fetchServerDate));
    setStatus(results.some(r => r !== null) ? 'verified' : 'failed');
}

export function initTimeSync() {
    dom.timeSyncDots = Array.from(document.querySelectorAll('.time-sync-dot'));
    dom.timeSyncIndicator = document.getElementById('time-sync-indicator');
    dom.timeSyncIndicator.addEventListener('click', syncTime);
    syncTime();
}
