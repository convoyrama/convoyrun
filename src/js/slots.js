// Reference timezone for slot definitions (slots are defined in this timezone)
const SOURCE_TIMEZONE = 'America/Montevideo';

const slots = [
    { inicio: { h: 0, m: 30 }, fin: { h: 2, m: 0 } },
    { inicio: { h: 2, m: 0 }, fin: { h: 3, m: 30 } },
    { inicio: { h: 3, m: 30 }, fin: { h: 5, m: 0 } },
    { inicio: { h: 5, m: 0 }, fin: { h: 6, m: 30 } },
    { inicio: { h: 6, m: 30 }, fin: { h: 8, m: 0 } },
    { inicio: { h: 8, m: 0 }, fin: { h: 9, m: 30 } },
    { inicio: { h: 9, m: 30 }, fin: { h: 11, m: 0 } },
    { inicio: { h: 11, m: 0 }, fin: { h: 12, m: 30 } },
    { inicio: { h: 12, m: 30 }, fin: { h: 14, m: 0 } },
    { inicio: { h: 14, m: 0 }, fin: { h: 15, m: 30 } },
    { inicio: { h: 15, m: 30 }, fin: { h: 17, m: 0 } },
    { inicio: { h: 17, m: 0 }, fin: { h: 18, m: 30 } },
    { inicio: { h: 18, m: 30 }, fin: { h: 20, m: 0 } },
    { inicio: { h: 20, m: 0 }, fin: { h: 21, m: 30 } },
    { inicio: { h: 21, m: 30 }, fin: { h: 23, m: 0 } },
    { inicio: { h: 23, m: 0 }, fin: { h: 0, m: 30 } }
];

function formatTime(h, m) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toMinutes(h, m) {
    return h * 60 + m;
}

function getCurrentTime() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const h = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }));
    const m = parseInt(now.toLocaleString('en-US', { minute: 'numeric', timeZone: tz }));
    return { h, m };
}

function getCurrentSlotIndex() {
    const current = getCurrentTime();
    const currentMin = toMinutes(current.h, current.m);

    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const inicioMin = toMinutes(s.inicio.h, s.inicio.m);
        const finMin = toMinutes(s.fin.h, s.fin.m);

        if (finMin < inicioMin) {
            if (currentMin >= inicioMin || currentMin < finMin) return i;
        } else {
            if (currentMin >= inicioMin && currentMin < finMin) return i;
        }
    }

    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (currentMin < toMinutes(s.inicio.h, s.inicio.m)) return i;
    }

    return 0;
}

function convertTime(time, fromTz, toTz) {
    const now = new Date();
    const dateFrom = new Date(now.toLocaleString('en-US', { timeZone: fromTz }));
    dateFrom.setHours(time.h, time.m, 0, 0);
    const dateTo = new Date(dateFrom.toLocaleString('en-US', { timeZone: toTz }));
    return { h: dateTo.getHours(), m: dateTo.getMinutes() };
}

function renderTimeline() {
    const timeline = document.getElementById('slots-timeline');
    const currentTimeEl = document.getElementById('slots-current-time');
    const currentSlotInfoEl = document.getElementById('slots-current-slot-info');
    const slotsGrid = document.getElementById('slots-grid');

    if (!timeline || !currentTimeEl || !currentSlotInfoEl || !slotsGrid) return;

    timeline.innerHTML = '';

    const currentSlotIndex = getCurrentSlotIndex();
    const current = getCurrentTime();

    currentTimeEl.textContent = formatTime(current.h, current.m);
    currentSlotInfoEl.textContent = '';
    const infoStrong = document.createElement('strong');
    infoStrong.textContent = String(currentSlotIndex + 1);
    currentSlotInfoEl.appendChild(infoStrong);
    currentSlotInfoEl.appendChild(document.createTextNode(
        ` \u00B7 ${formatTime(slots[currentSlotIndex].inicio.h, slots[currentSlotIndex].inicio.m)} \u2192 ${formatTime(slots[currentSlotIndex].fin.h, slots[currentSlotIndex].fin.m)}`
    ));

    const slotWidth = 180;
    const slotsExtended = [...slots, ...slots, ...slots];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    for (let i = 0; i < slotsExtended.length; i++) {
        const s = slotsExtended[i];
        const slotEl = document.createElement('div');
        slotEl.className = 'slot';

        const realIndex = i % slots.length;

        if (realIndex === currentSlotIndex) {
            slotEl.classList.add('current');
        } else {
            const diff = realIndex - currentSlotIndex;
            const wrappedDiff = ((diff + slots.length) % slots.length);
            if (wrappedDiff > slots.length / 2 || (wrappedDiff === 0 && i !== slots.length + currentSlotIndex)) {
                slotEl.classList.add('past');
            }
        }

        const slotInicio = convertTime(s.inicio, SOURCE_TIMEZONE, tz);
        const slotFin = convertTime(s.fin, SOURCE_TIMEZONE, tz);

        slotEl.textContent = '';
        const slotContent = document.createElement('div');
        slotContent.className = 'slot-content';
        const slotStart = document.createElement('span');
        slotStart.className = 'slot-start';
        slotStart.textContent = formatTime(slotInicio.h, slotInicio.m);
        const slotEnd = document.createElement('span');
        slotEnd.className = 'slot-end';
        slotEnd.textContent = `\u2192 ${formatTime(slotFin.h, slotFin.m)}`;
        slotContent.appendChild(slotStart);
        slotContent.appendChild(slotEnd);
        const slotNumber = document.createElement('span');
        slotNumber.className = 'slot-number';
        slotNumber.textContent = `#${realIndex + 1}`;
        slotEl.appendChild(slotContent);
        slotEl.appendChild(slotNumber);

        timeline.appendChild(slotEl);
    }

    const currentOffset = slots.length + currentSlotIndex;
    const offset = -currentOffset * slotWidth + (timeline.parentElement.offsetWidth / 2 - slotWidth / 2);
    timeline.style.transform = `translateX(${offset}px)`;

    renderGrid();
}

function renderGrid() {
    const slotsGrid = document.getElementById('slots-grid');
    if (!slotsGrid) return;

    const currentSlotIndex = getCurrentSlotIndex();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    slotsGrid.innerHTML = '';

    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const gridSlot = document.createElement('div');
        gridSlot.className = 'grid-slot';

        if (i === currentSlotIndex) {
            gridSlot.classList.add('current');
        }

        const inicio = convertTime(s.inicio, SOURCE_TIMEZONE, tz);
        const fin = convertTime(s.fin, SOURCE_TIMEZONE, tz);

        const gridNumber = document.createElement('div');
        gridNumber.className = 'grid-slot-number';
        gridNumber.textContent = `SLOT ${i + 1}`;
        const gridTimes = document.createElement('div');
        gridTimes.className = 'grid-slot-times';
        const gridStart = document.createElement('span');
        gridStart.className = 'grid-slot-start';
        gridStart.textContent = formatTime(inicio.h, inicio.m);
        const gridEnd = document.createElement('span');
        gridEnd.className = 'grid-slot-end';
        gridEnd.textContent = `\u2192 ${formatTime(fin.h, fin.m)}`;
        gridTimes.appendChild(gridStart);
        gridTimes.appendChild(gridEnd);
        gridSlot.appendChild(gridNumber);
        gridSlot.appendChild(gridTimes);

        slotsGrid.appendChild(gridSlot);
    }
}

export function recalcTimeline() {
    const timeline = document.getElementById('slots-timeline');
    if (!timeline || !timeline.parentElement || timeline.parentElement.offsetWidth === 0) return;
    const slotWidth = 180;
    const currentSlotIndex = getCurrentSlotIndex();
    const currentOffset = slots.length + currentSlotIndex;
    const offset = -currentOffset * slotWidth + (timeline.parentElement.offsetWidth / 2 - slotWidth / 2);
    timeline.style.transform = `translateX(${offset}px)`;
}

export function initSlots() {
    renderTimeline();

    setInterval(() => renderTimeline(), 60000);

    window.addEventListener('resize', () => {
        const timeline = document.getElementById('slots-timeline');
        if (timeline) {
            const slotWidth = 180;
            const currentSlotIndex = getCurrentSlotIndex();
            const currentOffset = slots.length + currentSlotIndex;
            const offset = -currentOffset * slotWidth + (timeline.parentElement.offsetWidth / 2 - slotWidth / 2);
            timeline.style.transform = `translateX(${offset}px)`;
        }
    });
}
