import { dom } from './dom.js';
import * as state from './core/state.js';
import { getGameTime, getDetailedDayNightIcon, formatDateForDisplayShort, formatTime, resolveMeetingDateTime } from './core/time.js';

const { DateTime } = luxon;
import { wrapText, getZoneLabel } from './core/utils.js';

// targetCanvas/scale: performDownload() renderiza más grande en un canvas aparte.
export function drawCanvas(targetCanvas = dom.mapCanvas, scale = 1) {
    const canvas = targetCanvas;
    const ctx = canvas.getContext("2d");
    const logicalWidth = 1280, logicalHeight = 720;
    // 'high' es lento con mapas grandes; solo vale la pena en el export.
    const smoothingQuality = (canvas === dom.mapCanvas) ? 'low' : 'high';
    const textSize = parseInt(dom.textSize.value), textStyle = dom.textStyle.value, textBackgroundOpacity = parseFloat(dom.textBackgroundOpacity.value);
    const customDateValue = dom.customDate.value, customTimeValue = dom.customTime.value, customEventNameValue = dom.customEventName.value || (state.currentLangData.canvas_default_event_name || "Evento Personalizado");
    const customStartPlaceValue = dom.customStartPlace.value || "Sin especificar", customDestinationValue = dom.customDestination.value || "Sin especificar", customServerValue = dom.customServer.value || "Sin especificar";

    canvas.width = logicalWidth * scale; canvas.height = logicalHeight * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = smoothingQuality;
    if (state.backgroundImage) { ctx.drawImage(state.backgroundImage, 0, 0, logicalWidth, logicalHeight); } else { ctx.fillStyle = "#333"; ctx.fillRect(0, 0, logicalWidth, logicalHeight); }
    if (state.mapImage) ctx.drawImage(state.mapImage, state.imageX, state.imageY, state.mapImage.width * state.imageScale, state.mapImage.height * state.imageScale);

    let textFill = "rgb(240,240,240)";
    let shadowColor = "rgba(0,0,0,0.8)";
    let borderColor = "white";
    ctx.shadowBlur = 10;

    switch (textStyle) {
        case "classic":
            break;
        case "mint":
            borderColor = "rgb(90,165,25)";
            shadowColor = "rgb(90,165,25)";
            break;
        case "sky":
            borderColor = "#00FFFF";
            shadowColor = "#00FFFF";
            break;
        case "bubblegum":
            borderColor = "#FF00FF";
            shadowColor = "#FF00FF";
            break;
        case "alert":
            borderColor = "#FF0000";
            shadowColor = "#FF0000";
            break;
        case "inverse":
            textFill = "rgb(0,0,0)";
            borderColor = "rgb(240,240,240)";
            shadowColor = "rgb(240,240,240)";
            break;
        case "fire":
            const fireGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            fireGradient.addColorStop(0, "yellow");
            fireGradient.addColorStop(1, "red");
            textFill = fireGradient;
            borderColor = "yellow";
            break;
        case "ice":
            const iceGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            iceGradient.addColorStop(0, "#B0E0E6");
            iceGradient.addColorStop(1, "#4682B4");
            textFill = iceGradient;
            borderColor = "#B0E0E6";
            break;
        case "retro":
            textFill = "#FF69B4";
            borderColor = "#FF69B4";
            shadowColor = "#00FFFF";
            break;
        case "womens_day":
            const womensDayGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            womensDayGradient.addColorStop(0, "#FFC0CB");
            womensDayGradient.addColorStop(1, "#800080");
            textFill = womensDayGradient;
            borderColor = "#FFC0CB";
            break;
        case "gold":
            const goldGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            goldGradient.addColorStop(0, "#FFD700");
            goldGradient.addColorStop(1, "#B8860B");
            textFill = goldGradient;
            borderColor = "#FFD700";
            break;
        case "rainbow":
            const rainbowGradient = ctx.createLinearGradient(0, 0, logicalWidth, 0);
            rainbowGradient.addColorStop(0, "red");
            rainbowGradient.addColorStop(0.15, "orange");
            rainbowGradient.addColorStop(0.3, "yellow");
            rainbowGradient.addColorStop(0.45, "green");
            rainbowGradient.addColorStop(0.6, "blue");
            rainbowGradient.addColorStop(0.75, "indigo");
            rainbowGradient.addColorStop(0.9, "violet");
            textFill = rainbowGradient;
            borderColor = rainbowGradient;
            break;
        case "hacker":
            textFill = "#00FF00";
            borderColor = "#00FF00";
            shadowColor = "rgba(0,0,0,0)";
            break;
        case "love":
            const loveGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            loveGradient.addColorStop(0, "#FFC0CB");
            loveGradient.addColorStop(1, "#FF0000");
            textFill = loveGradient;
            borderColor = "#FFC0CB";
            break;
        case "galaxy":
            const galaxyGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            galaxyGradient.addColorStop(0, "#8A2BE2");
            galaxyGradient.addColorStop(1, "#4169E1");
            textFill = "white";
            shadowColor = galaxyGradient;
            borderColor = "#8A2BE2";
            break;
        case "sunset":
            const sunsetGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            sunsetGradient.addColorStop(0, "yellow");
            sunsetGradient.addColorStop(1, "orange");
            textFill = sunsetGradient;
            shadowColor = "darkred";
            borderColor = "orange";
            break;
        case "neon":
            textFill = "#39FF14";
            shadowColor = "#39FF14";
            borderColor = "#39FF14";
            ctx.shadowBlur = 20;
            break;
        case "jungle":
            textFill = "lightgreen";
            shadowColor = "darkgreen";
            borderColor = "darkgreen";
            break;
        case "volcano":
            textFill = "orange";
            shadowColor = "red";
            borderColor = "red";
            break;
        case "electric":
            textFill = "white";
            shadowColor = "yellow";
            borderColor = "yellow";
            break;
        case "oceanic":
            const oceanicGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            oceanicGradient.addColorStop(0, "#00BFFF");
            oceanicGradient.addColorStop(1, "#1E90FF");
            textFill = oceanicGradient;
            borderColor = "#1E90FF";
            break;
        case "sunrise":
            const sunriseGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            sunriseGradient.addColorStop(0, "#FFD700");
            sunriseGradient.addColorStop(1, "#FFA500");
            textFill = sunriseGradient;
            borderColor = "#FFA500";
            break;
        case "shadow":
            textFill = "white";
            shadowColor = "black";
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 5;
            ctx.shadowOffsetY = 5;
            break;
        case "metallic":
            const metallicGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            metallicGradient.addColorStop(0, "#E5E4E2");
            metallicGradient.addColorStop(0.5, "#C0C0C0");
            metallicGradient.addColorStop(1, "#8C8C8C");
            textFill = metallicGradient;
            shadowColor = "black";
            borderColor = "#C0C0C0";
            break;
        case "toxic":
            textFill = "#7CFC00";
            shadowColor = "#ADFF2F";
            borderColor = "#7CFC00";
            ctx.shadowBlur = 20;
            break;
        case "cosmic":
            const cosmicGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            cosmicGradient.addColorStop(0, "#483D8B");
            cosmicGradient.addColorStop(1, "#191970");
            textFill = "white";
            shadowColor = cosmicGradient;
            borderColor = "#483D8B";
            break;
        case "sunburst":
            const sunburstGradient = ctx.createLinearGradient(0, 0, 0, textSize + 10);
            sunburstGradient.addColorStop(0, "#FFD700");
            sunburstGradient.addColorStop(1, "#FF4500");
            textFill = sunburstGradient;
            shadowColor = "darkred";
            borderColor = "#FFD700";
            break;
    }

    // Marco del flyer, corrido hacia adentro para que no se recorte el trazo.
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, logicalWidth - 6, logicalHeight - 6);
    ctx.restore();

    ctx.shadowColor = shadowColor;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
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
        const sortedDays = Array.from(datesByDay.keys()).sort((a, b) => { const [dayA, monthAbbrA] = a.split(' '); const [dayB, monthAbbrB] = b.split(' '); const dateA = new Date(new Date().getFullYear(), monthMap[monthAbbrA], dayA); const dateB = new Date(new Date().getFullYear(), monthMap[monthAbbrB], dayB); return dateA - dateB; });
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
                ctx.font = `bold ${textSize + 10}px ${dom.textFont.value}`;
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
        
        let handled = false;
        state.isDraggingSpeed.forEach((isDragging, i) => {
            if (isDragging) {
                state.speedIndicators[i].x = pos.x - state.startX;
                state.speedIndicators[i].y = pos.y - state.startY;
                drawCanvas();
                handled = true;
            }
        });

        if (handled) return;

        if (state.isDraggingDetail && state.detailImage) {
            state.setDetailImageX(pos.x - state.startX);
            state.setDetailImageY(pos.y - state.startY);
            drawCanvas();
        } else if (state.isDragging && state.mapImage) { 
            state.setImageX(pos.x - state.startX); 
            state.setImageY(pos.y - state.startY); 
            drawCanvas(); 
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
    circleCanvasTop.addEventListener("mousemove", (e) => { if (state.isDraggingTop && state.circleImageTop) { state.setCircleImageXTop(e.offsetX - state.startX); state.setCircleImageYTop(e.offsetY - state.startY); drawCanvas(); } });
    circleCanvasTop.addEventListener("mouseup", () => { state.setIsDraggingTop(false); });
    circleCanvasTop.addEventListener("mouseleave", () => { state.setIsDraggingTop(false); });

    const circleCanvasBottom = dom.circleCanvasBottom;
    circleCanvasBottom.addEventListener("mousedown", (e) => { if (state.circleImageBottom) { state.setIsDraggingBottom(true); state.setStartX(e.offsetX - state.circleImageXBottom); state.setStartY(e.offsetY - state.circleImageYBottom); } });
    circleCanvasBottom.addEventListener("mousemove", (e) => { if (state.isDraggingBottom && state.circleImageBottom) { state.setCircleImageXBottom(e.offsetX - state.startX); state.setCircleImageYBottom(e.offsetY - state.startY); drawCanvas(); } });
    circleCanvasBottom.addEventListener("mouseup", () => { state.setIsDraggingBottom(false); });
    circleCanvasBottom.addEventListener("mouseleave", () => { state.setIsDraggingBottom(false); });

    const circleCanvasWaypoint = dom.circleCanvasWaypoint;
    circleCanvasWaypoint.addEventListener("mousedown", (e) => { if (state.circleImageWaypoint) { state.setIsDraggingWaypoint(true); state.setStartX(e.offsetX - state.circleImageXWaypoint); state.setStartY(e.offsetY - state.circleImageYWaypoint); } });
    circleCanvasWaypoint.addEventListener("mousemove", (e) => { if (state.isDraggingWaypoint && state.circleImageWaypoint) { state.setCircleImageXWaypoint(e.offsetX - state.startX); state.setCircleImageYWaypoint(e.offsetY - state.startY); drawCanvas(); } });
    circleCanvasWaypoint.addEventListener("mouseup", () => { state.setIsDraggingWaypoint(false); });
    circleCanvasWaypoint.addEventListener("mouseleave", () => { state.setIsDraggingWaypoint(false); });

    dom.mapUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const img = new Image(); img.onload = () => { state.setMapImage(img); state.setImageX(0); state.setImageY(0); state.setImageScale(1); drawCanvas(); }; img.src = URL.createObjectURL(file); } else { state.setMapImage(null); drawCanvas(); } });
    dom.circleUploadTop.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const img = new Image(); img.onload = () => { state.setCircleImageTop(img); state.setCircleImageXTop(0); state.setCircleImageYTop(0); state.setCircleImageScaleTop(1); drawCanvas(); }; img.src = URL.createObjectURL(file); } else { state.setCircleImageTop(null); drawCanvas(); } });
    dom.circleUploadBottom.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const img = new Image(); img.onload = () => { state.setCircleImageBottom(img); state.setCircleImageXBottom(0); state.setCircleImageYBottom(0); state.setCircleImageScaleBottom(1); drawCanvas(); }; img.src = URL.createObjectURL(file); } else { state.setCircleImageBottom(null); drawCanvas(); } });
    dom.logoUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const img = new Image(); img.onload = () => { state.setLogoImage(img); drawCanvas(); }; img.src = URL.createObjectURL(file); } else { state.setLogoImage(null); drawCanvas(); } });
    dom.backgroundUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const img = new Image(); img.onload = () => { state.setBackgroundImage(img); drawCanvas(); }; img.src = URL.createObjectURL(file); } else { state.setBackgroundImage(null); drawCanvas(); } });
    dom.detailUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const img = new Image(); img.onload = () => { state.setDetailImage(img); state.setDetailImageX(0); state.setDetailImageY(0); state.setDetailImageScale(1); drawCanvas(); }; img.src = URL.createObjectURL(file); } else { state.setDetailImage(null); drawCanvas(); } });
    dom.waypointUpload.addEventListener("change", (e) => { const file = e.target.files[0]; if (file) { const img = new Image(); img.onload = () => { state.setCircleImageWaypoint(img); state.setCircleImageXWaypoint(0); state.setCircleImageYWaypoint(0); state.setCircleImageScaleWaypoint(1); drawCanvas(); }; img.src = URL.createObjectURL(file); } else { state.setCircleImageWaypoint(null); drawCanvas(); } });

    dom.zoomIn.addEventListener("click", () => { if (state.mapImage) { state.setImageScale(state.imageScale * 1.2); drawCanvas(); } });
    dom.zoomOut.addEventListener("click", () => { if (state.mapImage) { state.setImageScale(state.imageScale / 1.2); drawCanvas(); } });
    dom.zoomInTop.addEventListener("click", () => { if (state.circleImageTop) { state.setCircleImageScaleTop(state.circleImageScaleTop * 1.2); drawCanvas(); } });
    dom.zoomOutTop.addEventListener("click", () => { if (state.circleImageTop) { state.setCircleImageScaleTop(state.circleImageScaleTop / 1.2); drawCanvas(); } });
    dom.zoomInBottom.addEventListener("click", () => { if (state.circleImageBottom) { state.setCircleImageScaleBottom(state.circleImageScaleBottom * 1.2); drawCanvas(); } });
    dom.zoomOutBottom.addEventListener("click", () => { if (state.circleImageBottom) { state.setCircleImageScaleBottom(state.circleImageScaleBottom / 1.2); drawCanvas(); } });
    dom.zoomInDetail.addEventListener("click", () => { if (state.detailImage) { state.setDetailImageScale(state.detailImageScale * 1.2); drawCanvas(); } });
    dom.zoomOutDetail.addEventListener("click", () => { if (state.detailImage) { state.setDetailImageScale(state.detailImageScale / 1.2); drawCanvas(); } });

    dom.zoomInWaypoint.addEventListener("click", () => { if (state.circleImageWaypoint) { state.setCircleImageScaleWaypoint(state.circleImageScaleWaypoint * 1.2); drawCanvas(); } });
    dom.zoomOutWaypoint.addEventListener("click", () => { if (state.circleImageWaypoint) { state.setCircleImageScaleWaypoint(state.circleImageScaleWaypoint / 1.2); drawCanvas(); } });
}