import { timezoneRegions } from './config.js';

export let mapImage = null, circleImageTop = null, circleImageBottom = null, logoImage = null, backgroundImage = null, detailImage = null, circleImageWaypoint = null;
export let watermarkImage = new Image();
watermarkImage.src = './images/default/convoyrama_logo.png';
export let imageX = 0, imageY = 0, imageScale = 1;
export let circleImageXTop = 0, circleImageYTop = 0, circleImageScaleTop = 1;
export let circleImageXBottom = 0, circleImageYBottom = 0, circleImageScaleBottom = 1;
export let circleImageXWaypoint = 0, circleImageYWaypoint = 0, circleImageScaleWaypoint = 1;
export let detailImageX = 0, detailImageY = 0, detailImageScale = 1;
export let isDragging = false, isDraggingTop = false, isDraggingBottom = false, isDraggingDetail = false, isDraggingWaypoint = false;
export let isDraggingSpeed = [false, false, false];
export let isWaypointVisible = false;
export let isDepartureVisible = true, isDestinationVisible = true;
export let speedIndicators = [
    { visible: false, value: '80', unit: 'km/h', x: 330, y: 330 },
    { visible: false, value: '60', unit: 'km/h', x: 400, y: 400 },
    { visible: false, value: 'FUGA', unit: '', x: 530, y: 530 }
];
export let startX, startY;

export let currentLangData = {};

// Arranca en "hispano" para no quedar vacía la primera vez; persiste entre sesiones.
const ACTIVE_ZONES_STORAGE_KEY = 'convoyrun-active-zones';
const DEFAULT_PRESET = 'hispano';

function loadActiveZones() {
    try {
        const stored = JSON.parse(localStorage.getItem(ACTIVE_ZONES_STORAGE_KEY) || 'null');
        if (Array.isArray(stored) && stored.length > 0) return stored;
    } catch { /* si falla, usa el preset por defecto */ }
    return timezoneRegions[DEFAULT_PRESET].zones.slice();
}

export let activeZones = loadActiveZones();

function persistActiveZones() {
    localStorage.setItem(ACTIVE_ZONES_STORAGE_KEY, JSON.stringify(activeZones));
}

export function addZone(zone) {
    if (activeZones.some(z => z.iana_tz === zone.iana_tz)) return;
    activeZones = [...activeZones, zone];
    persistActiveZones();
}

export function removeZone(iana_tz) {
    activeZones = activeZones.filter(z => z.iana_tz !== iana_tz);
    persistActiveZones();
}

export function addPreset(regionKey) {
    const preset = timezoneRegions[regionKey];
    if (!preset) return;
    preset.zones.forEach(addZone);
}

export function getActiveZones() { return activeZones; }

export function setMapImage(img) { mapImage = img; }
export function setCircleImageTop(img) { circleImageTop = img; }
export function setCircleImageBottom(img) { circleImageBottom = img; }
export function setLogoImage(img) { logoImage = img; }
export function setBackgroundImage(img) { backgroundImage = img; }
export function setDetailImage(img) { detailImage = img; }
export function setCircleImageWaypoint(img) { circleImageWaypoint = img; }

export function setImageX(x) { imageX = x; }
export function setImageY(y) { imageY = y; }
export function setImageScale(s) { imageScale = s; }

export function setCircleImageXTop(x) { circleImageXTop = x; }
export function setCircleImageYTop(y) { circleImageYTop = y; }
export function setCircleImageScaleTop(s) { circleImageScaleTop = s; }

export function setCircleImageXBottom(x) { circleImageXBottom = x; }
export function setCircleImageYBottom(y) { circleImageYBottom = y; }
export function setCircleImageScaleBottom(s) { circleImageScaleBottom = s; }

export function setCircleImageXWaypoint(x) { circleImageXWaypoint = x; }
export function setCircleImageYWaypoint(y) { circleImageYWaypoint = y; }
export function setCircleImageScaleWaypoint(s) { circleImageScaleWaypoint = s; }

export function setDetailImageX(x) { detailImageX = x; }
export function setDetailImageY(y) { detailImageY = y; }
export function setDetailImageScale(s) { detailImageScale = s; }

export function setIsDragging(val) { isDragging = val; }
export function setIsDraggingTop(val) { isDraggingTop = val; }
export function setIsDraggingBottom(val) { isDraggingBottom = val; }
export function setIsDraggingDetail(val) { isDraggingDetail = val; }
export function setIsDraggingWaypoint(val) { isDraggingWaypoint = val; }

export function setStartX(val) { startX = val; }
export function setStartY(val) { startY = val; }

export function setCurrentLangData(data) { currentLangData = data; }
export function setIsWaypointVisible(val) { isWaypointVisible = val; }
export function setIsDepartureVisible(val) { isDepartureVisible = val; }
export function setIsDestinationVisible(val) { isDestinationVisible = val; }

