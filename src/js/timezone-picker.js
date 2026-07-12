// Panel de configuración de husos horarios/países — arma la lista exacta de
// zonas del flyer (un solo país si es lo único que hace falta, una región
// entera, o cualquier mezcla), en vez de quedar atado a un preset fijo. Se
// abre desde un botón chico para no ensuciar la barra de controles. Aislado
// de main.js igual que los demás módulos de feature (time-sync.js, about.js).
import { dom } from './dom.js';
import * as state from './core/state.js';
import { timezoneRegions } from './core/config.js';
import { getZoneLabel } from './core/utils.js';

const { DateTime } = luxon;

function friendlyLabelFromIana(iana_tz) {
    const parts = iana_tz.split('/');
    return parts[parts.length - 1].replace(/_/g, ' ');
}

function buildZoneCatalog() {
    return Intl.supportedValuesOf('timeZone').map(iana_tz => {
        const label = friendlyLabelFromIana(iana_tz);
        return { iana_tz, label, display: `${label} — ${iana_tz}` };
    });
}

const displayToZone = new Map();

function populateDatalist() {
    displayToZone.clear();
    dom.zoneDatalist.innerHTML = '';
    buildZoneCatalog().forEach(z => {
        const option = document.createElement('option');
        option.value = z.display;
        dom.zoneDatalist.appendChild(option);
        displayToZone.set(z.display, z);
    });
}

function renderDetectedTimezone() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = DateTime.local().toFormat('ZZ');
    dom.detectedTimezoneInfo.textContent = `${tz} (UTC${offset})`;
}

function renderActiveZoneList(onChange) {
    dom.zoneList.innerHTML = '';
    state.getActiveZones().forEach(z => {
        const chip = document.createElement('span');
        chip.className = 'custom-zone-chip';
        chip.textContent = getZoneLabel(z, state.currentLangData);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'custom-zone-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            state.removeZone(z.iana_tz);
            refreshZoneSettingsUI(onChange);
            onChange();
        });

        chip.appendChild(removeBtn);
        dom.zoneList.appendChild(chip);
    });
}

// Cada zona de preset queda siempre visible acá, prendida/apagada — sacarla
// de la lista activa de arriba solo la destilda, no la hace desaparecer,
// para poder volver a prenderla fácil.
function renderPresetZoneToggles(onChange) {
    dom.presetButtons.innerHTML = '';
    Object.keys(timezoneRegions).forEach(regionKey => {
        const region = timezoneRegions[regionKey];

        const groupWrap = document.createElement('div');
        groupWrap.className = 'preset-region-group';

        const groupLabel = document.createElement('div');
        groupLabel.className = 'preset-region-label';
        groupLabel.textContent = state.currentLangData[region.name] || region.name;
        groupWrap.appendChild(groupLabel);

        const chipsWrap = document.createElement('div');
        chipsWrap.className = 'preset-region-chips';

        region.zones.forEach(zone => {
            const isActive = state.getActiveZones().some(z => z.iana_tz === zone.iana_tz);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'preset-zone-toggle' + (isActive ? ' active' : '');
            chip.textContent = getZoneLabel(zone, state.currentLangData);
            chip.addEventListener('click', () => {
                if (isActive) state.removeZone(zone.iana_tz);
                else state.addZone(zone);
                refreshZoneSettingsUI(onChange);
                onChange();
            });
            chipsWrap.appendChild(chip);
        });

        groupWrap.appendChild(chipsWrap);
        dom.presetButtons.appendChild(groupWrap);
    });
}

// Redibuja las etiquetas de chips/presets (por cambio de idioma o de zona)
// sin volver a enganchar los event listeners.
export function refreshZoneSettingsUI(onChange) {
    renderActiveZoneList(onChange);
    renderPresetZoneToggles(onChange);
}

export function initTimezoneSettings(onChange) {
    dom.zoneSettingsOpen = document.getElementById('zone-settings-open');
    dom.zoneSettingsOverlay = document.getElementById('zone-settings-overlay');
    dom.zoneSettingsClose = document.getElementById('zone-settings-close');
    dom.zoneSearch = document.getElementById('zone-search');
    dom.zoneDatalist = document.getElementById('zone-datalist');
    dom.zoneSearchAdd = document.getElementById('zone-search-add');
    dom.zoneList = document.getElementById('zone-list');
    dom.presetButtons = document.getElementById('preset-buttons');
    dom.detectedTimezoneInfo = document.getElementById('detected-timezone-info');

    populateDatalist();
    renderDetectedTimezone();
    refreshZoneSettingsUI(onChange);

    dom.zoneSettingsOpen.addEventListener('click', () => dom.zoneSettingsOverlay.classList.add('open'));
    dom.zoneSettingsClose.addEventListener('click', () => dom.zoneSettingsOverlay.classList.remove('open'));
    dom.zoneSettingsOverlay.addEventListener('click', (e) => {
        if (e.target === dom.zoneSettingsOverlay) dom.zoneSettingsOverlay.classList.remove('open');
    });

    const addZone = () => {
        const typed = dom.zoneSearch.value.trim();
        const match = displayToZone.get(typed);
        if (!match) return;
        state.addZone({ iana_tz: match.iana_tz, label: match.label, key: null });
        dom.zoneSearch.value = '';
        refreshZoneSettingsUI(onChange);
        onChange();
    };

    dom.zoneSearchAdd.addEventListener('click', addZone);
    dom.zoneSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addZone(); }
    });
}
