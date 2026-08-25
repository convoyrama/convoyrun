// Asistente de publicación de convoy (pestaña SWARM).
// El creador elige día y hora en SU zona local; se guarda unix UTC + ianaTimeZone
// y cada lector lo ve en su propio huso (docs/04_SWARM_CALENDAR.md §4.2).
// El flyer es opcional. Se puede subir un PNG (máx 2 MB) o pegar una URL directa.
// Si se sube PNG, se leen metadatos incrustados para autocompletar y se sube a catbox.
import * as state from './core/state.js';
import { showCopyMessage } from './core/utils.js';
import { readMetadataFromPNG } from './core/png-metadata.js';
import { createConvoy, isWithinPublishWindow } from './core/convoy.js';
import { swarmPublish, swarmGetConfig, swarmSetConfig, swarmValidateChannel, uploadToCatbox } from './native/tauri-bridge.js';
import { AVAILABLE_LANGUAGES } from './core/config.js';

const { DateTime } = luxon;
const MAX_FLYER_BYTES = 2 * 1024 * 1024;

function label(key, fallback) {
    return state.currentLangData[key] || fallback;
}


let _publishInitialized = false;
export function initSwarmPublish(onPublished) {
    if (_publishInitialized) return;
    _publishInitialized = true;
    const overlay = document.getElementById('swarm-wizard');
    const openBtn = document.getElementById('swarm-publish-btn');
    const cancelBtn = document.getElementById('swarm-w-cancel');
    const submitBtn = document.getElementById('swarm-w-submit');
    const zoneEl = document.getElementById('swarm-w-zone');
    if (!overlay || !openBtn) return;
    if (!submitBtn) return;

    const nameEl = document.getElementById('swarm-w-name');
    const gameEl = document.getElementById('swarm-w-game');
    const modeEl = document.getElementById('swarm-w-mode');
    const typeEl = document.getElementById('swarm-w-type');
    const serverEl = document.getElementById('swarm-w-server');
    const startEl = document.getElementById('swarm-w-start');
    const startLocEl = document.getElementById('swarm-w-start-location');
    const destEl = document.getElementById('swarm-w-dest');
    const destLocEl = document.getElementById('swarm-w-dest-location');
    const descEl = document.getElementById('swarm-w-desc');
    const dateEl = document.getElementById('swarm-w-date');
    const timeEl = document.getElementById('swarm-w-time');
    const nicknameEl = document.getElementById('swarm-w-nickname');
    const flyerInput = document.getElementById('swarm-w-flyer');
    const flyerPreview = document.getElementById('swarm-w-flyer-preview');
    const flyerStatus = document.getElementById('swarm-w-flyer-status');
    const channelEl = document.getElementById('swarm-w-channel');
    const channelPasswordEl = document.getElementById('swarm-w-channel-password');
    const channelPasswordGroup = document.getElementById('swarm-w-password-group');
    const languagesGroup = document.getElementById('swarm-w-languages');
    const statusEl = document.getElementById('swarm-w-status');

    const imageUrlInput = document.getElementById('swarm-w-image-url');
    let currentImageUrl = null;
    let currentFlyerSize = 0;

    function populateLanguages(defaultLangs) {
        if (!languagesGroup) return;
        languagesGroup.innerHTML = '';
        for (const lang of AVAILABLE_LANGUAGES) {
            const lbl = document.createElement('label');
            lbl.className = 'swarm-lang-option';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = lang.code;
            cb.checked = defaultLangs.includes(lang.code);
            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(' ' + label(lang.key, lang.code.toUpperCase())));
            languagesGroup.appendChild(lbl);
        }
    }

    function getSelectedLanguages() {
        if (!languagesGroup) return [];
        return Array.from(languagesGroup.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    }

    let statusTimeout = null;

    function showStatus(msg, isError) {
        if (!statusEl) return showCopyMessage(msg);
        if (statusTimeout) { clearTimeout(statusTimeout); statusTimeout = null; }
        statusEl.textContent = msg;
        statusEl.hidden = false;
        statusEl.style.color = isError !== false ? '#ff6b6b' : '#4ade80';
        statusEl.style.background = isError !== false ? 'rgba(255,107,107,0.1)' : 'rgba(74,222,128,0.1)';
        statusEl.style.borderColor = isError !== false ? 'rgba(255,107,107,0.3)' : 'rgba(74,222,128,0.3)';
        if (isError !== false) statusTimeout = setTimeout(() => { statusEl.hidden = true; statusTimeout = null; }, 4000);
    }

    function hideStatus() {
        if (statusEl) statusEl.hidden = true;
    }

    async function checkChannelPassword() {
        const ch = channelEl.value.trim();
        if (!ch || ch.toLowerCase() === 'general') {
            channelPasswordGroup.hidden = true;
            return;
        }
        const ok = await swarmValidateChannel(ch, '');
        if (!ok) {
            channelPasswordGroup.hidden = false;
        } else {
            channelPasswordGroup.hidden = true;
        }
    }

    if (channelEl) {
        channelEl.addEventListener('blur', checkChannelPassword);
        channelEl.addEventListener('change', checkChannelPassword);
    }

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
        currentImageUrl = null;
        currentFlyerSize = 0;
        flyerPreview.hidden = true;
        if (imageUrlInput) imageUrlInput.value = '';

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
                const raw = readMetadataFromPNG(buffer, 'convoyrun-event-v1') || readMetadataFromPNG(buffer, 'convoyrama-event-data');
                if (raw) {
                    const m = JSON.parse(raw);
                    fillEmpty(nameEl, m.eventName || m.name);
                    fillEmpty(serverEl, m.server);
                    if (m.route) {
                        fillEmpty(startEl, m.route.startCity);
                        fillEmpty(startLocEl, m.route.startLocation);
                        fillEmpty(destEl, m.route.destCity);
                        fillEmpty(destLocEl, m.route.destLocation);
                    }
                    if (m.eventType && typeEl) {
                        typeEl.value = m.eventType;
                    }
                    fillEmpty(descEl, m.description);
                    const meetingTs = m.meetingTimestamp || (m.schedule && m.schedule.meetingTimestamp);
                    const tz = m.ianaTimeZone || (m.schedule && m.schedule.ianaTimeZone);
                    if (meetingTs && tz) {
                        const meeting = DateTime.fromSeconds(meetingTs, { zone: tz });
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
            flyerStatus.textContent = state.currentLangData.swarm_wizard_image_uploading || 'Subiendo imagen...';
            try {
                currentImageUrl = await uploadToCatbox(buffer);
                flyerPreview.src = currentImageUrl;
                flyerPreview.hidden = false;
                flyerStatus.textContent = state.currentLangData.swarm_wizard_image_uploaded || 'Imagen subida correctamente.';
                flyerStatus.classList.add('ok');
            } catch (err) {
                console.error('[SWARM-FLYER-UPLOAD] Failed:', err);
                flyerStatus.textContent = state.currentLangData.swarm_wizard_image_upload_fail || 'No se pudo subir la imagen.';
            }
        }).catch((err) => {
            console.error('[SWARM-FLYER-READ] Failed:', err);
            showCopyMessage(state.currentLangData.swarm_wizard_error_image || 'No se pudo leer la imagen.');
        });
    }

    function handleImageUrl() {
        const url = imageUrlInput ? imageUrlInput.value.trim() : '';
        if (!url) {
            currentImageUrl = null;
            flyerPreview.hidden = true;
            return;
        }
        // Limpiar input de archivo si habia algo
        flyerInput.value = '';
        currentFlyerSize = 0;
        currentImageUrl = url;
        flyerPreview.src = url;
        flyerPreview.hidden = false;
        flyerStatus.textContent = state.currentLangData.swarm_wizard_image_url_ok || 'URL de imagen cargada.';
        flyerStatus.classList.add('ok');
    }

    async function openWizard() {
        const cfg = await swarmGetConfig();
        if (cfg.nickname && !nicknameEl.value) nicknameEl.value = cfg.nickname;
        populateLanguages(cfg.defaultLanguages || ['es']);
        const now = DateTime.local();
        if (!dateEl.value) dateEl.value = now.toISODate();
        if (!timeEl.value) timeEl.value = now.plus({ hours: 2 }).toFormat('HH:mm');
        updateZoneLabel();
        overlay.classList.add('open');
        nameEl.focus();
    }

    function closeWizard() {
        overlay.classList.remove('open');
        currentImageUrl = null;
        currentFlyerSize = 0;
        flyerInput.value = '';
        if (imageUrlInput) imageUrlInput.value = '';
        flyerPreview.hidden = true;
        flyerPreview.removeAttribute('src');
        flyerStatus.textContent = '';
        flyerStatus.classList.remove('ok');
        hideStatus();
    }

    async function submit() {
        const name = nameEl.value.trim();
        const dateVal = dateEl.value;
        const timeVal = timeEl.value;

        hideStatus();

        if (!name || !dateVal || !timeVal) {
            showStatus(state.currentLangData.swarm_wizard_error_required || 'Completá nombre, juego, modo, fecha y hora.');
            return;
        }

        const meeting = DateTime.fromISO(`${dateVal}T${timeVal}`);
        if (!meeting.isValid) {
            showStatus(state.currentLangData.error_invalid_date || 'Fecha u hora inválida.');
            return;
        }

        const convoy = createConvoy({
            name,
            type: typeEl ? typeEl.value : 'convoy',
            game: gameEl.value,
            mode: modeEl.value,
            meetingTimestamp: meeting.toUnixInteger(),
            ianaTimeZone: DateTime.local().zoneName || 'UTC',
            server: serverEl.value.trim(),
            startCity: startEl.value.trim(),
            startLocation: startLocEl ? startLocEl.value.trim() : '',
            destCity: destEl.value.trim(),
            destLocation: destLocEl ? destLocEl.value.trim() : '',
            description: descEl.value.trim(),
            languages: getSelectedLanguages(),
            nickname: nicknameEl.value.trim() || undefined,
            flyer: currentImageUrl ? { url: currentImageUrl, size: currentFlyerSize } : null,
        });

        // Agregar canal al convoy
        const channelName = channelEl ? channelEl.value.trim() : '';
        if (channelName) convoy.channel = channelName;

        if (!isWithinPublishWindow(convoy)) {
            showStatus(state.currentLangData.swarm_wizard_error_window || 'Solo se pueden publicar convoys hasta 3 meses adelante.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = label('swarm_wizard_publishing', 'Publicando...');

        try {
            const channelPassword = channelPasswordEl ? channelPasswordEl.value : '';
            const result = await swarmPublish(convoy, channelName, channelPassword);

            const nick = nicknameEl.value.trim();
            if (nick) {
                const cfg = await swarmGetConfig();
                if (cfg.nickname !== nick) await swarmSetConfig({ ...cfg, nickname: nick });
            }

            closeWizard();
            showCopyMessage(state.currentLangData.swarm_published_ok || 'Convoy publicado en el Swarm.');
            if (onPublished) onPublished();
        } catch (err) {
            console.error('[SWARM-PUBLISH] Failed:', err);
            const msg = err?.toString() || '';
            if (msg.includes('wait') || msg.includes('esperar') || msg.includes('cooldown')) {
                showStatus(msg, true);
            } else {
                showStatus(state.currentLangData.swarm_wizard_error || 'Error al publicar el convoy.');
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = label('swarm_wizard_submit', 'Publicar');
        }
    }

    openBtn.addEventListener('click', () => openWizard().catch(e => console.error('[SWARM-PUBLISH] openWizard error:', e)));
    if (cancelBtn) cancelBtn.addEventListener('click', closeWizard);
    submitBtn.addEventListener('click', () => submit().catch(e => console.error('[SWARM-PUBLISH] submit error:', e)));
    flyerInput.addEventListener('change', (e) => handleFlyerFile(e.target.files[0]));
    if (imageUrlInput) imageUrlInput.addEventListener('input', handleImageUrl);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizard(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeWizard(); });
    window.addEventListener('languageChanged', updateZoneLabel);

    // Prevenir que clicks en date/time picker propaguen al overlay
    [dateEl, timeEl].forEach(input => {
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
    });
}
