// Arma la lista de zonas del flyer libremente, sin atarla a un preset fijo.
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
    if (!dom.zoneDatalist) return;
    dom.zoneDatalist.innerHTML = '';
    buildZoneCatalog().forEach(z => {
        const option = document.createElement('option');
        option.value = z.display;
        dom.zoneDatalist.appendChild(option);
        displayToZone.set(z.display, z);
    });
}

function renderDetectedTimezone() {
    if (!dom.detectedTimezoneInfo) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = DateTime.local().toFormat('ZZ');
    dom.detectedTimezoneInfo.textContent = `${tz} (UTC${offset})`;
}

function renderActiveZoneList(onChange) {
    if (!dom.zoneList) return;
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

// Sacarla de la lista activa solo la destilda acá, no la hace desaparecer.
function renderPresetZoneToggles(onChange) {
    if (!dom.presetButtons) return;
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
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.zoneSettingsOverlay.classList.contains('open')) {
            dom.zoneSettingsOverlay.classList.remove('open');
        }
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

    if (dom.zoneSearchAdd) dom.zoneSearchAdd.addEventListener('click', addZone);
    if (dom.zoneSearch) dom.zoneSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addZone(); }
    });
}
