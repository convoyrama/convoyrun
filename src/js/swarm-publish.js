// Asistente de publicación de convoy (pestaña SWARM).
// El creador elige día y hora en SU zona local; se guarda unix UTC + ianaTimeZone
// y cada lector lo ve en su propio huso (docs/04_SWARM_CALENDAR.md §4.2).
// El flyer es opcional. Se puede subir un PNG (máx 2 MB) o pegar una URL directa.
// Si se sube PNG, se leen metadatos incrustados para autocompletar y se sube a catbox.
import * as state from './core/state.js';
import { showCopyMessage, renderMarkdown } from './core/utils.js';
import { readMetadataFromPNG } from './core/png-metadata.js';
import { createConvoy, isWithinPublishWindow } from './core/convoy.js';
import { swarmPublish, swarmGetConfig, swarmSetConfig, swarmValidateChannel, swarmListChannels, uploadToCatbox } from './native/tauri-bridge.js';
import { AVAILABLE_LANGUAGES } from './core/config.js';

const { DateTime } = luxon;
const MAX_FLYER_BYTES = 10 * 1024 * 1024;

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
    const flyerInput = document.getElementById('swarm-w-flyer');
    const flyerPreview = document.getElementById('swarm-w-flyer-preview');
    const flyerStatus = document.getElementById('swarm-w-flyer-status');
    const channelEl = document.getElementById('swarm-w-channel');
    const channelPasswordEl = document.getElementById('swarm-w-channel-password');
    const channelPasswordGroup = document.getElementById('swarm-w-password-group');
    const languagesGroup = document.getElementById('swarm-w-languages');
    const statusEl = document.getElementById('swarm-w-status');
    const descPreview = document.getElementById('swarm-description-preview');

    const imageUrlInput = document.getElementById('swarm-w-image-url');

    // Markdown preview for description
    if (descEl && descPreview) {
        descEl.addEventListener('input', () => {
            descPreview.innerHTML = renderMarkdown(descEl.value);
        });
    }

    // Markdown toolbar
    const mdToolbar = document.getElementById('md-toolbar');
    if (mdToolbar && descEl) {
        mdToolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('.md-btn');
            if (!btn) return;
            const action = btn.dataset.md;
            const start = descEl.selectionStart;
            const end = descEl.selectionEnd;
            const sel = descEl.value.substring(start, end);
            let before = '', after = '', replacement = '';
            switch (action) {
                case 'bold': before = '**'; after = '**'; break;
                case 'italic': before = '*'; after = '*'; break;
                case 'strike': before = '~~'; after = '~~'; break;
                case 'code': before = '`'; after = '`'; break;
                case 'link': before = '['; after = '](url)'; break;
                case 'list': before = '\n- '; after = ''; break;
            }
            replacement = before + (sel || (action === 'link' ? 'texto' : action === 'list' ? 'item' : '...')) + after;
            descEl.value = descEl.value.substring(0, start) + replacement + descEl.value.substring(end);
            const newCursorPos = start + before.length + (sel ? sel.length : (action === 'link' ? 5 : 3));
            descEl.setSelectionRange(newCursorPos, newCursorPos);
            descEl.focus();
            descEl.dispatchEvent(new Event('input'));
        });
    }
    let currentImageUrl = null;
    let currentFlyerSize = 0;

    function clearValidation() {
        [nameEl, dateEl, timeEl].forEach(el => {
            if (el) el.classList.remove('field-error');
        });
    }

    function validateFields() {
        clearValidation();
        let valid = true;
        if (!nameEl.value.trim()) { nameEl.classList.add('field-error'); valid = false; }
        if (!dateEl.value) { dateEl.classList.add('field-error'); valid = false; }
        if (!timeEl.value) { timeEl.classList.add('field-error'); valid = false; }
        return valid;
    }

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
        if (!languagesGroup) return ['en'];
        const selected = Array.from(languagesGroup.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        return selected.length > 0 ? selected : ['en'];
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

    // Cache de canales para evitar doble llamada IPC
    let _cachedChannels = [];

    // Poblamos el select de canales con los disponibles
    async function populateChannelSelect() {
        if (!channelEl) return;
        _cachedChannels = await swarmListChannels();
        const currentValue = channelEl.value || 'general';
        channelEl.innerHTML = '';

        // Canales del sistema primero (sin contraseña)
        const systemChannels = _cachedChannels.filter(c => c.is_system);
        for (const ch of systemChannels) {
            const opt = document.createElement('option');
            opt.value = ch.name;
            opt.textContent = `#${ch.display_name || ch.name}`;
            channelEl.appendChild(opt);
        }

        // Canales privados (requieren contraseña si no sos owner)
        const privateChannels = _cachedChannels.filter(c => !c.is_system);
        if (privateChannels.length > 0) {
            const separator = document.createElement('option');
            separator.disabled = true;
            separator.textContent = '──────────';
            channelEl.appendChild(separator);

            for (const ch of privateChannels) {
                const opt = document.createElement('option');
                opt.value = ch.name;
                const badge = ch.is_owner ? '🔑' : '🔒';
                opt.textContent = `${badge} #${ch.display_name || ch.name}`;
                channelEl.appendChild(opt);
            }
        }

        // Restaurar selección previa si existe
        channelEl.value = currentValue;
        checkChannelPassword();
    }

    async function checkChannelPassword() {
        const ch = channelEl.value.trim();
        if (!ch) return;

        // Usamos el cache de canales (evita doble llamada IPC)
        const channel = _cachedChannels.find(c => c.name === ch);

        if (!channel) {
            // Canal no encontrado (no debería pasar con select)
            channelPasswordGroup.hidden = true;
            return;
        }

        // Canales del sistema no requieren contraseña
        if (channel.is_system) {
            channelPasswordGroup.hidden = true;
            return;
        }

        // Si es owner, no necesita contraseña
        if (channel.is_owner) {
            channelPasswordGroup.hidden = true;
            return;
        }

        // Canal privado con contraseña
        if (channel.has_password) {
            channelPasswordGroup.hidden = false;
        } else {
            channelPasswordGroup.hidden = true;
        }
    }

    if (channelEl) {
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
        const validImageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
        if (!validImageTypes.includes(file.type)) {
            showCopyMessage(state.currentLangData.swarm_wizard_error_image_type || 'Formato de imagen no válido.');
            flyerInput.value = '';
            return;
        }
        if (file.size > MAX_FLYER_BYTES) {
            showCopyMessage(state.currentLangData.swarm_wizard_error_image_size || 'La imagen supera los 10 MB.');
            flyerInput.value = '';
            return;
        }

        file.arrayBuffer().then(async (buffer) => {
            const u8 = new Uint8Array(buffer);
            try {
                // Solo intentar leer metadatos si es PNG
                const isPng = file.type === 'image/png';
                const raw = isPng ? (readMetadataFromPNG(buffer, 'convoyrun-event-v1') || readMetadataFromPNG(buffer, 'convoyrama-event-data')) : null;
                if (raw) {
                    const m = JSON.parse(raw);
                    if (m.eventName || m.name) nameEl.value = m.eventName || m.name;
                    if (m.server) serverEl.value = m.server;
                    if (m.route) {
                        if (m.route.startCity) startEl.value = m.route.startCity;
                        if (m.route.startLocation && startLocEl) startLocEl.value = m.route.startLocation;
                        if (m.route.destCity) destEl.value = m.route.destCity;
                        if (m.route.destLocation && destLocEl) destLocEl.value = m.route.destLocation;
                    }
                    if (m.eventType && typeEl) {
                        typeEl.value = m.eventType;
                    }
                    if (m.description) { descEl.value = m.description; if (descPreview) descPreview.innerHTML = renderMarkdown(descEl.value); }
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
            flyerStatus.classList.remove('ok');
            try {
                currentImageUrl = await uploadToCatbox(buffer);
                flyerPreview.src = currentImageUrl;
                flyerPreview.hidden = false;
                flyerStatus.textContent = state.currentLangData.swarm_wizard_image_uploaded || 'Imagen subida correctamente.';
                flyerStatus.classList.add('ok');
            } catch (err) {
                console.error('[SWARM-FLYER-UPLOAD] Failed:', err);
                flyerStatus.classList.remove('ok');
                const msg = err?.message || String(err);
                if (msg.startsWith('FILE_TOO_LARGE:')) {
                    const size = msg.split(':')[1];
                    flyerStatus.textContent = (state.currentLangData.swarm_wizard_image_too_large || 'Imagen demasiado grande ({size} MB). Máximo 10 MB.').replace('{size}', size);
                } else if (msg === 'TIMEOUT') {
                    flyerStatus.textContent = state.currentLangData.swarm_wizard_image_timeout || 'Timeout al subir. Reintentá más tarde.';
                } else if (msg.startsWith('HTTP_ERROR:')) {
                    const code = msg.split(':')[1];
                    flyerStatus.textContent = (state.currentLangData.swarm_wizard_image_http_error || 'Error del servidor ({code}).').replace('{code}', code);
                } else {
                    flyerStatus.textContent = `${state.currentLangData.swarm_wizard_image_upload_fail || 'No se pudo subir la imagen.'} [${msg}]`;
                }
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

    const FLYER_STORAGE_KEY = 'convoyrun-flyer-draft';
    const flyerFields = () => ({
        name: nameEl?.value || '',
        game: gameEl?.value || 'ATS',
        mode: modeEl?.value || 'simulation',
        type: typeEl?.value || 'convoy',
        server: serverEl?.value || '',
        start: startEl?.value || '',
        startLocation: startLocEl?.value || '',
        dest: destEl?.value || '',
        destLocation: destLocEl?.value || '',
        desc: descEl?.value || '',
        date: dateEl?.value || '',
        time: timeEl?.value || '',
        channel: channelEl?.value || '',
        imageUrl: currentImageUrl || '',
    });

    function saveFlyerDraft() {
        try { localStorage.setItem(FLYER_STORAGE_KEY, JSON.stringify(flyerFields())); } catch {}
    }

    function restoreFlyerDraft() {
        try {
            const raw = localStorage.getItem(FLYER_STORAGE_KEY);
            if (!raw) return false;
            const d = JSON.parse(raw);
            if (d.name && nameEl) nameEl.value = d.name;
            if (d.game && gameEl) gameEl.value = d.game;
            if (d.mode && modeEl) modeEl.value = d.mode;
            if (d.type && typeEl) typeEl.value = d.type;
            if (d.server && serverEl) serverEl.value = d.server;
            if (d.start && startEl) startEl.value = d.start;
            if (d.startLocation && startLocEl) startLocEl.value = d.startLocation;
            if (d.dest && destEl) destEl.value = d.dest;
            if (d.destLocation && destLocEl) destLocEl.value = d.destLocation;
            if (d.desc && descEl) descEl.value = d.desc;
            if (d.date && dateEl) dateEl.value = d.date;
            if (d.time && timeEl) timeEl.value = d.time;
            if (d.channel && channelEl) channelEl.value = d.channel;
            if (d.imageUrl) {
                currentImageUrl = d.imageUrl;
                flyerPreview.src = d.imageUrl;
                flyerPreview.hidden = false;
                flyerStatus.textContent = 'URL de imagen restaurada.';
                flyerStatus.classList.add('ok');
            }
            return true;
        } catch { return false; }
    }

    async function openWizard() {
        const cfg = await swarmGetConfig();
        const hasDraft = restoreFlyerDraft();
        if (!hasDraft) {
            populateLanguages(cfg.defaultLanguages || ['es']);
            const now = DateTime.local();
            if (!dateEl.value) dateEl.value = now.toISODate();
            if (!timeEl.value) timeEl.value = now.plus({ hours: 2 }).toFormat('HH:mm');
        }
        await populateChannelSelect();
        updateZoneLabel();
        overlay.classList.add('open');
        if (descPreview) descPreview.innerHTML = renderMarkdown(descEl.value);
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
        hideStatus();
        clearValidation();

        if (!validateFields()) {
            showStatus(state.currentLangData.swarm_wizard_error_required || 'Completá nombre, fecha y hora.');
            return;
        }

        const name = nameEl.value.trim();
        const dateVal = dateEl.value;
        const timeVal = timeEl.value;

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
            flyer: currentImageUrl ? { url: currentImageUrl, size: currentFlyerSize } : null,
        });

        // Agregar canal al convoy
        const channelName = channelEl ? (channelEl.value.trim() || 'general') : 'general';
        convoy.channel = channelName;

        if (!isWithinPublishWindow(convoy)) {
            showStatus(state.currentLangData.swarm_wizard_error_window || 'Solo se pueden publicar convoys hasta 3 meses adelante.');
            return;
        }

        submitBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        submitBtn.textContent = label('swarm_wizard_publishing', 'Publicando...');
        submitBtn.classList.add('loading');

        try {
            const channelPassword = channelPasswordEl ? channelPasswordEl.value : '';
            const result = await swarmPublish(convoy, channelName, channelPassword);

            closeWizard();
            try { localStorage.removeItem(FLYER_STORAGE_KEY); } catch {}
            showCopyMessage(state.currentLangData.swarm_published_ok || 'Convoy publicado en el Swarm.');
            // Guardar idiomas seleccionados como default para la próxima vez
            const selectedLangs = getSelectedLanguages();
            if (selectedLangs.length > 0) {
                try {
                    const cfg = await swarmGetConfig();
                    cfg.defaultLanguages = selectedLangs;
                    await swarmSetConfig(cfg);
                } catch {}
            }
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
            if (cancelBtn) cancelBtn.disabled = false;
            submitBtn.classList.remove('loading');
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

    // Auto-save flyer draft on field changes
    [nameEl, gameEl, modeEl, typeEl, serverEl, startEl, startLocEl, destEl, destLocEl, descEl, dateEl, timeEl, channelEl].forEach(el => {
        if (el) el.addEventListener('input', saveFlyerDraft);
    });

    // Prevenir que clicks en date/time picker propaguen al overlay
    [dateEl, timeEl].forEach(input => {
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
    });
}
