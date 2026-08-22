// Asistente de publicación de convoy (pestaña SWARM).
// El creador elige día y hora en SU zona local; se guarda unix UTC + ianaTimeZone
// y cada lector lo ve en su propio huso (docs/04_SWARM_CALENDAR.md §4.2).
// El flyer PNG es obligatorio (máx 2 MB): se leen sus metadatos incrustados
// ("convoyrama-event-data") para autocompletar, y se embebe un thumb 128px.
import * as state from './core/state.js';
import { showCopyMessage } from './core/utils.js';
import { readMetadataFromPNG } from './core/png-metadata.js';
import { createConvoy, isWithinPublishWindow } from './core/convoy.js';
import { swarmPublish, swarmGetConfig, swarmSetConfig } from './native/tauri-bridge.js';

const { DateTime } = luxon;
const MAX_FLYER_BYTES = 2 * 1024 * 1024;

function makeThumb(buffer) {
    return new Promise((resolve) => {
        try {
            const blob = new Blob([buffer], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const scale = 256 / img.width;
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const thumb = canvas.toDataURL('image/png');
                URL.revokeObjectURL(url);
                resolve(thumb);
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        } catch {
            resolve(null);
        }
    });
}

export function initSwarmPublish(onPublished) {
    const overlay = document.getElementById('swarm-wizard');
    const openBtn = document.getElementById('swarm-publish-btn');
    const cancelBtn = document.getElementById('swarm-w-cancel');
    const submitBtn = document.getElementById('swarm-w-submit');
    const zoneEl = document.getElementById('swarm-w-zone');
    if (!overlay || !openBtn) return;

    const nameEl = document.getElementById('swarm-w-name');
    const gameEl = document.getElementById('swarm-w-game');
    const modeEl = document.getElementById('swarm-w-mode');
    const serverEl = document.getElementById('swarm-w-server');
    const startEl = document.getElementById('swarm-w-start');
    const destEl = document.getElementById('swarm-w-dest');
    const descEl = document.getElementById('swarm-w-desc');
    const dateEl = document.getElementById('swarm-w-date');
    const timeEl = document.getElementById('swarm-w-time');
    const nicknameEl = document.getElementById('swarm-w-nickname');
    const flyerInput = document.getElementById('swarm-w-flyer');
    const flyerPreview = document.getElementById('swarm-w-flyer-preview');
    const flyerStatus = document.getElementById('swarm-w-flyer-status');

    let currentThumb = null;
    let currentFlyerSize = 0;

    function updateZoneLabel() {
        const zone = DateTime.local().zoneName || 'local';
        const tpl = state.currentLangData.swarm_wizard_your_zone || 'En tu zona: {zone}';
        zoneEl.textContent = tpl.replace('{zone}', zone);
    }

    function fillEmpty(input, value) {
        if (value && !input.value.trim()) input.value = value;
    }

    function handleFlyerFile(file) {
        flyerStatus.textContent = '';
        flyerStatus.classList.remove('ok');
        currentThumb = null;
        currentFlyerSize = 0;
        flyerPreview.hidden = true;

        if (!file) return;
        if (!/\.png$/i.test(file.name) && file.type !== 'image/png') {
            showCopyMessage(state.currentLangData.swarm_wizard_error_image_type || 'La imagen debe ser un PNG.');
            flyerInput.value = '';
            return;
        }
        if (file.size > MAX_FLYER_BYTES) {
            showCopyMessage(state.currentLangData.swarm_wizard_error_image_size || 'La imagen supera los 2 MB.');
            flyerInput.value = '';
            return;
        }

        file.arrayBuffer().then(async (buffer) => {
            const u8 = new Uint8Array(buffer);
            try {
                const raw = readMetadataFromPNG(buffer, 'convoyrama-event-data');
                if (raw) {
                    const m = JSON.parse(raw);
                    fillEmpty(nameEl, m.eventName);
                    fillEmpty(serverEl, m.server);
                    fillEmpty(startEl, m.startPlace);
                    fillEmpty(destEl, m.destination);
                    fillEmpty(descEl, m.description);
                    if (m.meetingTimestamp && m.ianaTimeZone) {
                        const meeting = DateTime.fromSeconds(m.meetingTimestamp, { zone: m.ianaTimeZone });
                        if (meeting.isValid) {
                            dateEl.value = meeting.toISODate();
                            timeEl.value = meeting.toFormat('HH:mm');
                        }
                    }
                    flyerStatus.textContent = state.currentLangData.swarm_wizard_image_meta_ok || 'Metadatos del flyer cargados.';
                    flyerStatus.classList.add('ok');
                } else {
                    flyerStatus.textContent = state.currentLangData.swarm_wizard_image_meta_none || 'Imagen sin metadatos de ConvoyRun.';
                }
            } catch (err) {
                console.error('[SWARM-FLYER-META] Failed:', err);
                flyerStatus.textContent = state.currentLangData.swarm_wizard_image_meta_none || 'Imagen sin metadatos de ConvoyRun.';
            }

            currentFlyerSize = u8.byteLength;
            currentThumb = await makeThumb(u8);
            if (currentThumb) {
                flyerPreview.src = currentThumb;
                flyerPreview.hidden = false;
            }
        }).catch((err) => {
            console.error('[SWARM-FLYER-READ] Failed:', err);
            showCopyMessage(state.currentLangData.swarm_wizard_error_image || 'No se pudo leer la imagen.');
        });
    }

    async function openWizard() {
        const cfg = await swarmGetConfig();
        if (cfg.nickname && !nicknameEl.value) nicknameEl.value = cfg.nickname;
        const now = DateTime.local();
        if (!dateEl.value) dateEl.value = now.toISODate();
        if (!timeEl.value) timeEl.value = now.plus({ hours: 2 }).toFormat('HH:mm');
        updateZoneLabel();
        overlay.classList.add('open');
        nameEl.focus();
    }

    function closeWizard() {
        overlay.classList.remove('open');
        currentThumb = null;
        currentFlyerSize = 0;
        flyerInput.value = '';
        flyerPreview.hidden = true;
        flyerPreview.removeAttribute('src');
        flyerStatus.textContent = '';
        flyerStatus.classList.remove('ok');
    }

    async function submit() {
        const name = nameEl.value.trim();
        const dateVal = dateEl.value;
        const timeVal = timeEl.value;

        if (!currentThumb) {
            showCopyMessage(state.currentLangData.swarm_wizard_error_image || 'Adjuntá una imagen (PNG) del convoy.');
            return;
        }
        if (!name || !dateVal || !timeVal) {
            showCopyMessage(state.currentLangData.swarm_wizard_error_required || 'Completá nombre, juego, modo, fecha y hora.');
            return;
        }

        const meeting = DateTime.fromISO(`${dateVal}T${timeVal}`);
        if (!meeting.isValid) {
            showCopyMessage(state.currentLangData.error_invalid_date || 'Fecha u hora inválida.');
            return;
        }

        const convoy = createConvoy({
            name,
            game: gameEl.value,
            mode: modeEl.value,
            meetingTimestamp: meeting.toUnixInteger(),
            ianaTimeZone: DateTime.local().zoneName || 'UTC',
            server: serverEl.value.trim(),
            startPlace: startEl.value.trim(),
            destination: destEl.value.trim(),
            description: descEl.value.trim(),
            nickname: nicknameEl.value.trim() || undefined,
            flyer: { thumb: currentThumb, size: currentFlyerSize, mime: 'image/png' },
        });

        if (!isWithinPublishWindow(convoy)) {
            showCopyMessage(state.currentLangData.swarm_wizard_error_window || 'Solo se pueden publicar convoys hasta 3 meses adelante.');
            return;
        }

        await swarmPublish(convoy);

        const nick = nicknameEl.value.trim();
        if (nick) {
            const cfg = await swarmGetConfig();
            if (cfg.nickname !== nick) await swarmSetConfig({ ...cfg, nickname: nick });
        }

        closeWizard();
        showCopyMessage(state.currentLangData.swarm_published_ok || 'Convoy publicado en el Swarm.');
        if (onPublished) onPublished();
    }

    openBtn.addEventListener('click', openWizard);
    cancelBtn.addEventListener('click', closeWizard);
    submitBtn.addEventListener('click', submit);
    flyerInput.addEventListener('change', (e) => handleFlyerFile(e.target.files[0]));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizard(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeWizard(); });
    window.addEventListener('languageChanged', updateZoneLabel);

    // WebKitGTK no cierra el picker de fecha/hora solo con seleccionar: hay que
    // hacer blur (mismo fix que main.js) para que el calendario nativo desaparezca.
    [dateEl, timeEl].forEach(input => {
        input.addEventListener('change', () => input.blur());
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
    });
}
