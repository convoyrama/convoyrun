// Asistente de publicación de convoy (pestaña SWARM).
// El creador elige día y hora en SU zona local; se guarda unix UTC + ianaTimeZone
// y cada lector lo ve en su propio huso (docs/04_SWARM_CALENDAR.md §4.2).
// El flyer PNG es obligatorio (máx 2 MB): se leen sus metadatos incrustados
// ("convoyrama-event-data") para autocompletar, y se embebe un thumb 128px.
import * as state from './core/state.js';
import { showCopyMessage } from './core/utils.js';
import { readMetadataFromPNG } from './core/png-metadata.js';
import { createConvoy, isWithinPublishWindow } from './core/convoy.js';
import { swarmPublish, swarmGetConfig, swarmSetConfig, swarmValidateChannel, uploadToCatbox } from './native/tauri-bridge.js';

const { DateTime } = luxon;
const MAX_FLYER_BYTES = 2 * 1024 * 1024;

function label(key, fallback) {
    return state.currentLangData[key] || fallback;
}

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

let _publishInitialized = false;
export function initSwarmPublish(onPublished) {
    if (_publishInitialized) return;
    _publishInitialized = true;
    console.log('[SWARM-PUBLISH] initSwarmPublish called');
    const overlay = document.getElementById('swarm-wizard');
    const openBtn = document.getElementById('swarm-publish-btn');
    const cancelBtn = document.getElementById('swarm-w-cancel');
    const submitBtn = document.getElementById('swarm-w-submit');
    const zoneEl = document.getElementById('swarm-w-zone');
    console.log('[SWARM-PUBLISH] Elements found:', {
        overlay: !!overlay, openBtn: !!openBtn, cancelBtn: !!cancelBtn,
        submitBtn: !!submitBtn, zoneEl: !!zoneEl
    });
    if (!overlay || !openBtn) {
        console.error('[SWARM-PUBLISH] ABORT: overlay or openBtn is null');
        return;
    }
    if (!submitBtn) {
        console.error('[SWARM-PUBLISH] ABORT: submitBtn is null');
        return;
    }

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

    let currentThumb = null;
    let currentOriginalUrl = null;
    let currentFlyerSize = 0;

    const AVAILABLE_LANGUAGES = [
        { code: 'es', key: 'swarm_lang_es' },
        { code: 'en', key: 'swarm_lang_en' },
        { code: 'pt', key: 'swarm_lang_pt' },
        { code: 'fr', key: 'swarm_lang_fr' },
        { code: 'de', key: 'swarm_lang_de' },
        { code: 'it', key: 'swarm_lang_it' },
        { code: 'nl', key: 'swarm_lang_nl' },
    ];

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
        currentThumb = null;
        currentOriginalUrl = null;
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
            currentThumb = await makeThumb(u8);
            if (currentThumb) {
                flyerPreview.src = currentThumb;
                flyerPreview.hidden = false;
            }
            flyerStatus.textContent = state.currentLangData.swarm_wizard_image_uploading || 'Subiendo imagen...';
            try {
                currentOriginalUrl = await uploadToCatbox(buffer);
                flyerStatus.textContent = state.currentLangData.swarm_wizard_image_uploaded || 'Imagen subida correctamente.';
                flyerStatus.classList.add('ok');
            } catch (err) {
                console.error('[SWARM-FLYER-UPLOAD] Failed:', err);
                flyerStatus.textContent = state.currentLangData.swarm_wizard_image_upload_fail || 'No se pudo subir la imagen. Se usará la miniatura.';
            }
        }).catch((err) => {
            console.error('[SWARM-FLYER-READ] Failed:', err);
            showCopyMessage(state.currentLangData.swarm_wizard_error_image || 'No se pudo leer la imagen.');
        });
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
        currentThumb = null;
        currentOriginalUrl = null;
        currentFlyerSize = 0;
        flyerInput.value = '';
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
        console.log('[SWARM-PUBLISH] Submit clicked', { name, dateVal, timeVal, hasThumb: !!currentThumb });

        hideStatus();

        if (!currentThumb) {
            showStatus(state.currentLangData.swarm_wizard_error_image || 'Adjuntá una imagen (PNG) del convoy.');
            return;
        }
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
            flyer: { thumb: currentThumb, originalUrl: currentOriginalUrl, size: currentFlyerSize, mime: 'image/png' },
        });

        // Agregar canal al convoy
        const channelName = channelEl ? channelEl.value.trim() : '';
        if (channelName) convoy.channel = channelName;

        console.log('[SWARM-PUBLISH] Convoy created', { id: convoy.id, game: convoy.event.game, mode: convoy.event.mode });

        if (!isWithinPublishWindow(convoy)) {
            showStatus(state.currentLangData.swarm_wizard_error_window || 'Solo se pueden publicar convoys hasta 3 meses adelante.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = label('swarm_wizard_publishing', 'Publicando...');

        try {
            const channelPassword = channelPasswordEl ? channelPasswordEl.value : '';
            console.log('[SWARM-PUBLISH] Calling swarmPublish...');
            const result = await swarmPublish(convoy, channelName, channelPassword);
            console.log('[SWARM-PUBLISH] swarmPublish result:', result);

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

    console.log('[SWARM-PUBLISH] Attaching event listeners...');
    openBtn.addEventListener('click', () => openWizard().catch(e => console.error('[SWARM-PUBLISH] openWizard error:', e)));
    console.log('[SWARM-PUBLISH] openBtn listener attached');
    if (cancelBtn) cancelBtn.addEventListener('click', closeWizard);
    submitBtn.addEventListener('click', () => submit().catch(e => console.error('[SWARM-PUBLISH] submit error:', e)));
    console.log('[SWARM-PUBLISH] submitBtn listener attached');
    flyerInput.addEventListener('change', (e) => handleFlyerFile(e.target.files[0]));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizard(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeWizard(); });
    window.addEventListener('languageChanged', updateZoneLabel);
    console.log('[SWARM-PUBLISH] All listeners attached successfully');

    // WebKitGTK no cierra el picker de fecha/hora solo con seleccionar: hay que
    // hacer blur (mismo fix que main.js) para que el calendario nativo desaparezca.
    [dateEl, timeEl].forEach(input => {
        input.addEventListener('change', () => input.blur());
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
    });
}
