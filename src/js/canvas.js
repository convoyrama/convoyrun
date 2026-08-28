import { dom } from './dom.js';
import * as state from './core/state.js';
import { getGameTime, getDetailedDayNightIcon, formatDateForDisplayShort, formatTime, resolveMeetingDateTime } from './core/time.js';

let _canvasListenersInitialized = false;

const { DateTime } = luxon;
import { wrapText, getZoneLabel } from './core/utils.js';

// Track object URLs to revoke them on replacement (prevent memory leaks)
const _objectUrls = {};
function setObjectUrl(key, url) {
    if (_objectUrls[key]) URL.revokeObjectURL(_objectUrls[key]);
    _objectUrls[key] = url;
}

export function revokeAllObjectUrls() {
    for (const key of Object.keys(_objectUrls)) {
        URL.revokeObjectURL(_objectUrls[key]);
        delete _objectUrls[key];
    }
}

// requestAnimationFrame throttle for drag operations
let _rafPending = false;
function scheduleRedraw() {
    if (!_rafPending) {
        _rafPending = true;
        requestAnimationFrame(() => {
            _rafPending = false;
            drawCanvas();
        });
    }
}

// targetCanvas/scale: performDownload() renderiza más grande en un canvas aparte.
export function drawCanvas(targetCanvas = dom.mapCanvas, scale = 1) {
    const canvas = targetCanvas;
    const ctx = canvas.getContext("2d");
    const isV = state.getIsVertical();
    const logicalWidth = isV ? 720 : 1280, logicalHeight = isV ? 1280 : 720;
    // 'high' es lento con mapas grandes; solo vale la pena en el export.
    const smoothingQuality = (canvas === dom.mapCanvas) ? 'low' : 'high';
    const textSize = parseInt(dom.textSize.value), textStyle = dom.textStyle.value, textBackgroundOpacity = parseInt(dom.textBackgroundOpacity.value, 10) / 100;
    const customDateValue = dom.customDate.value, customTimeValue = dom.customTime.value, customEventNameValue = dom.customEventName.value || (state.currentLangData.canvas_default_event_name || "Evento Personalizado");
    const customStartCityValue = dom.customStartCity?.value || dom.customStartPlace?.value || "";
    const customStartLocationValue = dom.customStartLocation?.value || "";
    const customDestCityValue = dom.customDestCity?.value || dom.customDestination?.value || "";
    const customDestLocationValue = dom.customDestLocation?.value || "";
    const customStartPlaceValue = customStartCityValue ? (customStartLocationValue ? `${customStartCityValue} — ${customStartLocationValue}` : customStartCityValue) : "Sin especificar";
    const customDestinationValue = customDestCityValue ? (customDestLocationValue ? `${customDestCityValue} — ${customDestLocationValue}` : customDestCityValue) : "Sin especificar";
    const customServerValue = dom.customServer.value || "Sin especificar";

    canvas.width = logicalWidth * scale; canvas.height = logicalHeight * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = smoothingQuality;
    if (state.backgroundImage && state.backgroundImage.complete && state.backgroundImage.naturalWidth !== 0) { ctx.drawImage(state.backgroundImage, 0, 0, logicalWidth, logicalHeight); } else { ctx.fillStyle = "#333"; ctx.fillRect(0, 0, logicalWidth, logicalHeight); }
    if (state.mapImage && state.mapImage.complete && state.mapImage.naturalWidth !== 0) {
        const mapW = state.mapImage.width * state.imageScale;
        const mapH = state.mapImage.height * state.imageScale;
        ctx.drawImage(state.mapImage, state.imageX, state.imageY, mapW, mapH);
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 2;
        ctx.strokeRect(state.imageX, state.imageY, mapW, mapH);
    }

    let textFill = "rgb(240,240,240)";
    let shadowColor = "rgba(0,0,0,0.8)";
    let borderColor = "white";
    ctx.shadowBlur = 10;

    const STYLE_DEFS = {
        classic: {},
        mint:              { border: "rgb(90,165,25)", shadow: "rgb(90,165,25)" },
        sky:               { border: "#00FFFF", shadow: "#00FFFF" },
        bubblegum:         { border: "#FF00FF", shadow: "#FF00FF" },
        alert:             { border: "#FF0000", shadow: "#FF0000" },
        inverse:           { text: "rgb(0,0,0)", border: "rgb(240,240,240)", shadow: "rgb(240,240,240)" },
        fire:              { gradient: [["yellow", 0], ["red", 1]], border: "yellow" },
        ice:               { gradient: [["#B0E0E6", 0], ["#4682B4", 1]], border: "#B0E0E6" },
        retro:             { text: "#FF69B4", border: "#FF69B4", shadow: "#00FFFF" },
        womens_day:        { gradient: [["#FFC0CB", 0], ["#800080", 1]], border: "#FFC0CB" },
        gold:              { gradient: [["#FFD700", 0], ["#B8860B", 1]], border: "#FFD700" },
        rainbow:           { gradient: [["red", 0], ["orange", 0.15], ["yellow", 0.3], ["green", 0.45], ["blue", 0.6], ["indigo", 0.75], ["violet", 0.9]], borderGradient: true, horizontal: true },
        hacker:            { text: "#00FF00", border: "#00FF00", shadow: "rgba(0,0,0,0)" },
        love:              { gradient: [["#FFC0CB", 0], ["#FF0000", 1]], border: "#FFC0CB" },
        galaxy:            { gradient: [["#8A2BE2", 0], ["#4169E1", 1]], text: "white", border: "#8A2BE2", gradientTarget: "shadow" },
        sunset:            { gradient: [["yellow", 0], ["orange", 1]], shadow: "darkred", border: "orange" },
        neon:              { text: "#39FF14", shadow: "#39FF14", border: "#39FF14", blur: 20 },
        jungle:            { text: "lightgreen", shadow: "darkgreen", border: "darkgreen" },
        volcano:           { text: "orange", shadow: "red", border: "red" },
        electric:          { text: "white", shadow: "yellow", border: "yellow" },
        oceanic:           { gradient: [["#00BFFF", 0], ["#1E90FF", 1]], border: "#1E90FF" },
        sunrise:           { gradient: [["#FFD700", 0], ["#FFA500", 1]], border: "#FFA500" },
        shadow:            { text: "white", shadow: "black", blur: 15, shadowOffsetX: 5, shadowOffsetY: 5 },
        metallic:          { gradient: [["#E5E4E2", 0], ["#C0C0C0", 0.5], ["#8C8C8C", 1]], shadow: "black", border: "#C0C0C0" },
        toxic:             { text: "#7CFC00", shadow: "#ADFF2F", border: "#7CFC00", blur: 20 },
        cosmic:            { gradient: [["#483D8B", 0], ["#191970", 1]], text: "white", border: "#483D8B", gradientTarget: "shadow" },
        sunburst:          { gradient: [["#FFD700", 0], ["#FF4500", 1]], shadow: "darkred", border: "#FFD700" },
    };

    const def = STYLE_DEFS[textStyle] || STYLE_DEFS.classic;
    if (def.text) textFill = def.text;
    if (def.border) borderColor = def.border;
    if (def.shadow) shadowColor = def.shadow;
    if (def.blur) ctx.shadowBlur = def.blur;
    ctx.shadowOffsetX = def.shadowOffsetX || 0;
    ctx.shadowOffsetY = def.shadowOffsetY || 0;
    if (def.gradient) {
        const grad = def.horizontal
            ? ctx.createLinearGradient(0, 0, logicalWidth, 0)
            : ctx.createLinearGradient(0, 0, 0, textSize + 10);
        def.gradient.forEach(([color, stop]) => grad.addColorStop(stop, color));
        if (def.gradientTarget === "shadow") { shadowColor = grad; }
        else { textFill = grad; }
        if (def.borderGradient) borderColor = grad;
    }

    // Marco del flyer, corrido hacia adentro para que no se recorte el trazo.
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, logicalWidth - 6, logicalHeight - 6);
    ctx.restore();

    ctx.shadowColor = shadowColor;
    
    ctx.font = `bold ${textSize + 8}px ${dom.textFont.value}`;
    ctx.textAlign = "center";
    const eventName = customEventNameValue;
    const eventNameMetrics = ctx.measureText(eventName);
    const eventNameWidth = eventNameMetrics.width + 40;
    const eventNameHeight = textSize + 15;
    ctx.fillStyle = `rgba(0, 0, 0, ${textBackgroundOpacity})`;
    ctx.fillRect((logicalWidth - eventNameWidth) / 2, 20, eventNameWidth, eventNameHeight);
    ctx.fillStyle = textFill;
    ctx.fillText(eventName, logicalWidth / 2, 45);

    let topOffset = 45;
    if (state.logoImage) { const logoHeight = 80; const logoWidth = state.logoImage.width * (logoHeight / state.logoImage.height); const logoX = (logicalWidth - logoWidth) / 2; const logoY = 60; ctx.drawImage(state.logoImage, logoX, logoY, logoWidth, logoHeight); topOffset = logoY + logoHeight + 20; }

    ctx.font = `bold ${textSize}px ${dom.textFont.value}`;
    ctx.textAlign = "left";
    const textLines = [ `${state.currentLangData.canvas_server || 'Servidor:'} ${customServerValue}`, `${state.currentLangData.canvas_departure || 'Partida:'} ${customStartPlaceValue}`, `${state.currentLangData.canvas_destination || 'Destino:'} ${customDestinationValue}`, "", state.currentLangData.canvas_meeting_time || 'Hora de reunión / Hora de partida:' ];

    if (customDateValue && customTimeValue) {
        const meetingDateTime = resolveMeetingDateTime(customDateValue, customTimeValue, dom.manualOffsetSelect.value);

        const utcBaseTime = meetingDateTime.toJSDate();
        const activeTimezoneGroup = state.getActiveZones();
        const datesByDay = new Map();
        activeTimezoneGroup.forEach(tz => {
            const localTimeForTz = DateTime.fromJSDate(utcBaseTime).setZone(tz.iana_tz);
            const dayString = formatDateForDisplayShort(localTimeForTz);
            if (!datesByDay.has(dayString)) { datesByDay.set(dayString, { times: [] }); }
            const dayEntry = datesByDay.get(dayString);
            const tzLabel = getZoneLabel(tz, state.currentLangData);
            const reunionTimeLuxon = localTimeForTz;
            const departureOffset = parseInt(dom.departureTimeOffset.value, 10);
            const partidaTimeLuxon = reunionTimeLuxon.plus({ minutes: departureOffset });
            dayEntry.times.push({ tzLabel, reunionTime: formatTime(reunionTimeLuxon), partidaTime: formatTime(partidaTimeLuxon) });
        });
        const monthMap = (state.currentLangData.months_short || ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]).reduce((acc, month, index) => { acc[month] = index; return acc; }, {});
        const refYear = meetingDateTime.year;
        const sortedDays = Array.from(datesByDay.keys()).sort((a, b) => { const [dayA, monthAbbrA] = a.split(' '); const [dayB, monthAbbrB] = b.split(' '); const dateA = new Date(refYear, monthMap[monthAbbrA], dayA); const dateB = new Date(refYear, monthMap[monthAbbrB], dayB); return dateA - dateB; });
        const newTextLines = [];
        newTextLines.push(`${state.currentLangData.canvas_meeting_time || 'Hora de reunión / Hora de partida:'}`);
        sortedDays.forEach(dayString => { newTextLines.push(dayString); const dayEntry = datesByDay.get(dayString); dayEntry.times.forEach(timeEntry => { newTextLines.push(`  ${timeEntry.tzLabel}: ${timeEntry.reunionTime} / ${timeEntry.partidaTime}`); }); });
        textLines.splice(4, textLines.length - 4, ...newTextLines);
    } else { textLines.splice(4, textLines.length - 4); textLines.push(`${state.currentLangData.canvas_meeting_time || 'Hora de reunión / Hora de partida:'}`); textLines.push(`  N/A`); }

    const textX = 20, lineHeight = textSize + 10;
    let textY = topOffset + (textSize + 10);

    const textWidth = Math.max(...textLines.map(line => ctx.measureText(line).width)) + 40;
    const textHeight = textLines.length * lineHeight + 20;
    ctx.fillStyle = `rgba(0, 0, 0, ${textBackgroundOpacity})`;
    ctx.fillRect(textX - 10, textY - lineHeight, textWidth, textHeight);
    
    ctx.fillStyle = textFill;
    const maxTextWidth = logicalWidth - textX - 20;
    textLines.forEach((line, index) => { let currentTextX = textX; let currentLineHeight = lineHeight; if (line.startsWith('  ')) { currentTextX += 15; } const wrappedLines = wrapText(ctx, line, maxTextWidth - (currentTextX - textX)); wrappedLines.forEach((wrappedLine, wrappedIndex) => { ctx.fillText(wrappedLine, currentTextX, textY + (index * lineHeight) + (wrappedIndex * currentLineHeight)); }); });

    // Tamaño lógico; cada sub-canvas se escala aparte para no exportar borroso.
    const circleDiameter = 240; const circleX = logicalWidth - circleDiameter - 10; const topY = 10; const bottomY = logicalHeight - circleDiameter - 10;
    const circleCenterX = circleX + circleDiameter / 2;

    if (state.isDepartureVisible) {
        const circleCanvasTop = dom.circleCanvasTop;
        const circleCtxTop = circleCanvasTop.getContext("2d");
        circleCanvasTop.width = circleDiameter * scale; circleCanvasTop.height = circleDiameter * scale;
        circleCtxTop.setTransform(scale, 0, 0, scale, 0, 0);
        circleCtxTop.imageSmoothingEnabled = true; circleCtxTop.imageSmoothingQuality = smoothingQuality;
        circleCtxTop.clearRect(0, 0, circleDiameter, circleDiameter);
        if (state.circleImageTop) { circleCtxTop.save(); circleCtxTop.beginPath(); circleCtxTop.arc(circleDiameter / 2, circleDiameter / 2, circleDiameter / 2, 0, Math.PI * 2); circleCtxTop.clip(); circleCtxTop.drawImage(state.circleImageTop, state.circleImageXTop, state.circleImageYTop, state.circleImageTop.width * state.circleImageScaleTop, state.circleImageTop.height * state.circleImageScaleTop); circleCtxTop.restore(); }
        ctx.drawImage(circleCanvasTop, circleX, topY, circleDiameter, circleDiameter);

        ctx.beginPath();
        ctx.arc(circleCenterX, topY + circleDiameter / 2, circleDiameter / 2, 0, Math.PI * 2);
        ctx.strokeStyle = borderColor; ctx.lineWidth = 8; ctx.stroke();

        ctx.font = `bold ${textSize + 8}px ${dom.textFont.value}`;
        ctx.textAlign = "center";
        const departureText = state.currentLangData.canvas_label_departure || "Partida";
        const departureTextMetrics = ctx.measureText(departureText); const departureTextWidth = departureTextMetrics.width + 30; const departureTextHeight = textSize + 15; const departureTextY = topY + circleDiameter + 30;
        ctx.fillStyle = `rgba(0, 0, 0, ${textBackgroundOpacity})`;
        ctx.fillRect(circleCenterX - departureTextWidth / 2, departureTextY - departureTextHeight + 10, departureTextWidth, departureTextHeight);
        ctx.fillStyle = textFill;
        ctx.fillText(departureText, circleCenterX, departureTextY);
    }

    if (state.isDestinationVisible) {
        const circleCanvasBottom = dom.circleCanvasBottom;
        const circleCtxBottom = circleCanvasBottom.getContext("2d");
        circleCanvasBottom.width = circleDiameter * scale; circleCanvasBottom.height = circleDiameter * scale;
        circleCtxBottom.setTransform(scale, 0, 0, scale, 0, 0);
        circleCtxBottom.imageSmoothingEnabled = true; circleCtxBottom.imageSmoothingQuality = smoothingQuality;
        circleCtxBottom.clearRect(0, 0, circleDiameter, circleDiameter);
        if (state.circleImageBottom) { circleCtxBottom.save(); circleCtxBottom.beginPath(); circleCtxBottom.arc(circleDiameter / 2, circleDiameter / 2, circleDiameter / 2, 0, Math.PI * 2); circleCtxBottom.clip(); circleCtxBottom.drawImage(state.circleImageBottom, state.circleImageXBottom, state.circleImageYBottom, state.circleImageBottom.width * state.circleImageScaleBottom, state.circleImageBottom.height * state.circleImageScaleBottom); circleCtxBottom.restore(); }
        ctx.drawImage(circleCanvasBottom, circleX, bottomY, circleDiameter, circleDiameter);

        ctx.beginPath();
        ctx.arc(circleCenterX, bottomY + circleDiameter / 2, circleDiameter / 2, 0, Math.PI * 2);
        ctx.strokeStyle = borderColor; ctx.lineWidth = 8; ctx.stroke();

        ctx.font = `bold ${textSize + 8}px ${dom.textFont.value}`;
        ctx.textAlign = "center";
        const destinationText = state.currentLangData.canvas_label_destination || "Destino";
        const destinationTextMetrics = ctx.measureText(destinationText); const destinationTextWidth = destinationTextMetrics.width + 30; const destinationTextHeight = textSize + 15; const destinationTextY = bottomY - 15;
        ctx.fillStyle = `rgba(0, 0, 0, ${textBackgroundOpacity})`;
        ctx.fillRect(circleCenterX - destinationTextWidth / 2, destinationTextY - destinationTextHeight + 10, destinationTextWidth, destinationTextHeight);
        ctx.fillStyle = textFill;
        ctx.fillText(destinationText, circleCenterX, destinationTextY);
    }

    if (state.isWaypointVisible) {


        const circleCanvasWaypoint = dom.circleCanvasWaypoint, circleCtxWaypoint = circleCanvasWaypoint.getContext("2d");
        circleCanvasWaypoint.width = circleDiameter * scale; circleCanvasWaypoint.height = circleDiameter * scale;
        circleCtxWaypoint.setTransform(scale, 0, 0, scale, 0, 0);
        circleCtxWaypoint.imageSmoothingEnabled = true; circleCtxWaypoint.imageSmoothingQuality = smoothingQuality;
        circleCtxWaypoint.clearRect(0, 0, circleDiameter, circleDiameter);
        if (state.circleImageWaypoint) { 
            circleCtxWaypoint.save(); 
            circleCtxWaypoint.beginPath(); 
            circleCtxWaypoint.arc(circleDiameter / 2, circleDiameter / 2, circleDiameter / 2, 0, Math.PI * 2); 
            circleCtxWaypoint.clip(); 
            circleCtxWaypoint.drawImage(state.circleImageWaypoint, state.circleImageXWaypoint, state.circleImageYWaypoint, state.circleImageWaypoint.width * state.circleImageScaleWaypoint, state.circleImageWaypoint.height * state.circleImageScaleWaypoint); 
            circleCtxWaypoint.restore(); 
        }
        const waypointX = 10;
        ctx.drawImage(circleCanvasWaypoint, waypointX, bottomY, circleDiameter, circleDiameter);

        ctx.beginPath();
        ctx.arc(waypointX + circleDiameter / 2, bottomY + circleDiameter / 2, circleDiameter / 2, 0, Math.PI * 2);
        ctx.strokeStyle = borderColor; ctx.lineWidth = 8; ctx.stroke();

        const waypointText = state.currentLangData.canvas_label_waypoint || "Waypoint";
        const waypointTextMetrics = ctx.measureText(waypointText); 
        const waypointTextWidth = waypointTextMetrics.width + 30; 
        const waypointTextHeight = textSize + 15; 
        const waypointTextY = bottomY - 15;
        const waypointCircleCenterX = waypointX + circleDiameter / 2;
        ctx.fillStyle = `rgba(0, 0, 0, ${textBackgroundOpacity})`;
        ctx.fillRect(waypointCircleCenterX - waypointTextWidth / 2, waypointTextY - waypointTextHeight + 10, waypointTextWidth, waypointTextHeight);
        ctx.textAlign = "center";
        ctx.fillStyle = textFill;
        ctx.fillText(waypointText, waypointCircleCenterX, waypointTextY);
    }

    if (state.detailImage) { ctx.drawImage(state.detailImage, state.detailImageX, state.detailImageY, state.detailImage.width * state.detailImageScale, state.detailImage.height * state.detailImageScale); }

    state.speedIndicators.forEach(indicator => {
        if (indicator.visible) {
            const speedText = `${indicator.value} ${indicator.unit}`;
            ctx.font = `bold ${textSize + 8}px ${dom.textFont.value}`;
            ctx.textAlign = "center";
            
            const metrics = ctx.measureText(speedText);
            const bgWidth = metrics.width + 25;
            const bgHeight = textSize + 15;
            
            ctx.fillStyle = `rgba(0, 0, 0, ${textBackgroundOpacity})`;
            ctx.fillRect(indicator.x - bgWidth / 2, indicator.y - bgHeight + 10, bgWidth, bgHeight);
            
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = (textStyle === "neon" || textStyle === "toxic") ? 20 : 10;
            ctx.fillStyle = textFill;
            ctx.fillText(speedText, indicator.x, indicator.y);
            ctx.shadowBlur = 0;
        }
    });

    // Reset del shadowBlur: sin esto el logo hereda la sombra del estilo activo.
    if (state.watermarkImage.complete && state.watermarkImage.naturalWidth !== 0) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.6;
        const wmWidth = state.watermarkImage.width * 0.35;
        const wmHeight = state.watermarkImage.height * 0.35;
        ctx.drawImage(state.watermarkImage, (logicalWidth - wmWidth) / 2, logicalHeight - wmHeight - 15, wmWidth, wmHeight);
        ctx.globalAlpha = 1.0;
    }
}

export function initCanvasEventListeners() {
    if (_canvasListenersInitialized) return;
    _canvasListenersInitialized = true;
    const canvas = dom.mapCanvas;
    
    const getMousePos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    canvas.addEventListener("mousedown", (e) => { 
        const pos = getMousePos(e);
        const textSize = parseInt(dom.textSize.value);

        // Los indicadores de velocidad van primero: son la capa de más arriba.
        for (let i = state.speedIndicators.length - 1; i >= 0; i--) {
            const ind = state.speedIndicators[i];
            if (ind.visible) {
                const ctx = canvas.getContext("2d");
                ctx.font = `bold ${textSize + 8}px ${dom.textFont.value}`;
                const metrics = ctx.measureText(`${ind.value} ${ind.unit}`);
                const bgWidth = metrics.width + 30;
                const bgHeight = textSize + 20;

                if (pos.x >= ind.x - bgWidth/2 && pos.x <= ind.x + bgWidth/2 && pos.y >= ind.y - bgHeight + 15 && pos.y <= ind.y + 15) {
                    state.isDraggingSpeed[i] = true;
                    state.setStartX(pos.x - ind.x);
                    state.setStartY(pos.y - ind.y);
                    return; // Stop checking others
                }
            }
        }

        if (state.detailImage && pos.x >= state.detailImageX && pos.x <= state.detailImageX + state.detailImage.width * state.detailImageScale && pos.y >= state.detailImageY && pos.y <= state.detailImageY + state.detailImage.height * state.detailImageScale) {
            state.setIsDraggingDetail(true);
            state.setStartX(pos.x - state.detailImageX);
            state.setStartY(pos.y - state.detailImageY);
        } else if (state.mapImage) { 
            state.setIsDragging(true); 
            state.setStartX(pos.x - state.imageX); 
            state.setStartY(pos.y - state.imageY); 
        } 
    });
    canvas.addEventListener("mousemove", (e) => {
        const pos = getMousePos(e);
        const isV = state.getIsVertical();
        const cW = isV ? 720 : 1280, cH = isV ? 1280 : 720;

        let handled = false;
        state.isDraggingSpeed.forEach((isDragging, i) => {
            if (isDragging) {
                state.speedIndicators[i].x = Math.max(0, Math.min(cW, pos.x - state.startX));
                state.speedIndicators[i].y = Math.max(0, Math.min(cH, pos.y - state.startY));
                handled = true;
            }
        });

        if (handled) { scheduleRedraw(); return; }

        if (state.isDraggingDetail && state.detailImage) {
            const w = state.detailImage.width * state.detailImageScale;
            const h = state.detailImage.height * state.detailImageScale;
            state.setDetailImageX(Math.max(-w, Math.min(cW, pos.x - state.startX)));
            state.setDetailImageY(Math.max(-h, Math.min(cH, pos.y - state.startY)));
            scheduleRedraw();
        } else if (state.isDragging && state.mapImage) {
            const w = state.mapImage.width * state.imageScale;
            const h = state.mapImage.height * state.imageScale;
            state.setImageX(Math.max(-w, Math.min(cW, pos.x - state.startX)));
            state.setImageY(Math.max(-h, Math.min(cH, pos.y - state.startY)));
            scheduleRedraw();
        }
    });
    canvas.addEventListener("mouseup", () => { 
        state.setIsDragging(false); 
        state.setIsDraggingDetail(false); 
        state.isDraggingSpeed.fill(false);
    });
    canvas.addEventListener("mouseleave", () => { 
        state.setIsDragging(false); 
        state.setIsDraggingDetail(false); 
        state.isDraggingSpeed.fill(false);
    });

    const circleCanvasTop = dom.circleCanvasTop;
    circleCanvasTop.addEventListener("mousedown", (e) => { if (state.circleImageTop) { state.setIsDraggingTop(true); state.setStartX(e.offsetX - state.circleImageXTop); state.setStartY(e.offsetY - state.circleImageYTop); } });
    circleCanvasTop.addEventListener("mousemove", (e) => { if (state.isDraggingTop && state.circleImageTop) { state.setCircleImageXTop(e.offsetX - state.startX); state.setCircleImageYTop(e.offsetY - state.startY); scheduleRedraw(); } });
    circleCanvasTop.addEventListener("mouseup", () => { state.setIsDraggingTop(false); });
    circleCanvasTop.addEventListener("mouseleave", () => { state.setIsDraggingTop(false); });

    const circleCanvasBottom = dom.circleCanvasBottom;
    circleCanvasBottom.addEventListener("mousedown", (e) => { if (state.circleImageBottom) { state.setIsDraggingBottom(true); state.setStartX(e.offsetX - state.circleImageXBottom); state.setStartY(e.offsetY - state.circleImageYBottom); } });
    circleCanvasBottom.addEventListener("mousemove", (e) => { if (state.isDraggingBottom && state.circleImageBottom) { state.setCircleImageXBottom(e.offsetX - state.startX); state.setCircleImageYBottom(e.offsetY - state.startY); scheduleRedraw(); } });
    circleCanvasBottom.addEventListener("mouseup", () => { state.setIsDraggingBottom(false); });
    circleCanvasBottom.addEventListener("mouseleave", () => { state.setIsDraggingBottom(false); });

    const circleCanvasWaypoint = dom.circleCanvasWaypoint;
    circleCanvasWaypoint.addEventListener("mousedown", (e) => { if (state.circleImageWaypoint) { state.setIsDraggingWaypoint(true); state.setStartX(e.offsetX - state.circleImageXWaypoint); state.setStartY(e.offsetY - state.circleImageYWaypoint); } });
    circleCanvasWaypoint.addEventListener("mousemove", (e) => { if (state.isDraggingWaypoint && state.circleImageWaypoint) { state.setCircleImageXWaypoint(e.offsetX - state.startX); state.setCircleImageYWaypoint(e.offsetY - state.startY); scheduleRedraw(); } });
    circleCanvasWaypoint.addEventListener("mouseup", () => { state.setIsDraggingWaypoint(false); });
    circleCanvasWaypoint.addEventListener("mouseleave", () => { state.setIsDraggingWaypoint(false); });

    dom.mapUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const url = URL.createObjectURL(file); setObjectUrl('map', url); const img = new Image(); img.onload = () => { state.setMapImage(img); state.setImageX(0); state.setImageY(0); state.setImageScale(1); drawCanvas(); }; img.src = url; } else { state.setMapImage(null); drawCanvas(); } });
    dom.circleUploadTop.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const url = URL.createObjectURL(file); setObjectUrl('circleTop', url); const img = new Image(); img.onload = () => { state.setCircleImageTop(img); state.setCircleImageXTop(0); state.setCircleImageYTop(0); state.setCircleImageScaleTop(1); drawCanvas(); }; img.src = url; } else { state.setCircleImageTop(null); drawCanvas(); } });
    dom.circleUploadBottom.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const url = URL.createObjectURL(file); setObjectUrl('circleBottom', url); const img = new Image(); img.onload = () => { state.setCircleImageBottom(img); state.setCircleImageXBottom(0); state.setCircleImageYBottom(0); state.setCircleImageScaleBottom(1); drawCanvas(); }; img.src = url; } else { state.setCircleImageBottom(null); drawCanvas(); } });
    dom.logoUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const url = URL.createObjectURL(file); setObjectUrl('logo', url); const img = new Image(); img.onload = () => { state.setLogoImage(img); drawCanvas(); }; img.src = url; } else { state.setLogoImage(null); drawCanvas(); } });
    dom.backgroundUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const url = URL.createObjectURL(file); setObjectUrl('background', url); const img = new Image(); img.onload = () => { state.setBackgroundImage(img); drawCanvas(); }; img.src = url; } else { state.setBackgroundImage(null); drawCanvas(); } });
    dom.detailUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const url = URL.createObjectURL(file); setObjectUrl('detail', url); const img = new Image(); img.onload = () => { state.setDetailImage(img); state.setDetailImageX(0); state.setDetailImageY(0); state.setDetailImageScale(1); drawCanvas(); }; img.src = url; } else { state.setDetailImage(null); drawCanvas(); } });
    dom.waypointUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const url = URL.createObjectURL(file); setObjectUrl('waypoint', url); const img = new Image(); img.onload = () => { state.setCircleImageWaypoint(img); state.setCircleImageXWaypoint(0); state.setCircleImageYWaypoint(0); state.setCircleImageScaleWaypoint(1); drawCanvas(); }; img.src = url; } else { state.setCircleImageWaypoint(null); drawCanvas(); } });

    dom.zoomIn.addEventListener("click", () => { if (state.mapImage) { state.setImageScale(Math.min(10, state.imageScale * 1.2)); drawCanvas(); } });
    dom.zoomOut.addEventListener("click", () => { if (state.mapImage) { state.setImageScale(Math.max(0.1, state.imageScale / 1.2)); drawCanvas(); } });
    dom.zoomInTop.addEventListener("click", () => { if (state.circleImageTop) { state.setCircleImageScaleTop(Math.min(10, state.circleImageScaleTop * 1.2)); drawCanvas(); } });
    dom.zoomOutTop.addEventListener("click", () => { if (state.circleImageTop) { state.setCircleImageScaleTop(Math.max(0.1, state.circleImageScaleTop / 1.2)); drawCanvas(); } });
    dom.zoomInBottom.addEventListener("click", () => { if (state.circleImageBottom) { state.setCircleImageScaleBottom(Math.min(10, state.circleImageScaleBottom * 1.2)); drawCanvas(); } });
    dom.zoomOutBottom.addEventListener("click", () => { if (state.circleImageBottom) { state.setCircleImageScaleBottom(Math.max(0.1, state.circleImageScaleBottom / 1.2)); drawCanvas(); } });
    dom.zoomInDetail.addEventListener("click", () => { if (state.detailImage) { state.setDetailImageScale(Math.min(10, state.detailImageScale * 1.2)); drawCanvas(); } });
    dom.zoomOutDetail.addEventListener("click", () => { if (state.detailImage) { state.setDetailImageScale(Math.max(0.1, state.detailImageScale / 1.2)); drawCanvas(); } });

    dom.zoomInWaypoint.addEventListener("click", () => { if (state.circleImageWaypoint) { state.setCircleImageScaleWaypoint(Math.min(10, state.circleImageScaleWaypoint * 1.2)); drawCanvas(); } });
    dom.zoomOutWaypoint.addEventListener("click", () => { if (state.circleImageWaypoint) { state.setCircleImageScaleWaypoint(Math.max(0.1, state.circleImageScaleWaypoint / 1.2)); drawCanvas(); } });
}