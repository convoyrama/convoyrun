import { dom } from './dom.js';
import * as state from './core/state.js';
import { drawCanvas, revokeAllObjectUrls } from './canvas.js';
import { formatDateForDisplay } from './core/time.js';

const { DateTime } = luxon;

export function initCanvasControls(onTimeChange) {
    dom.waypointToggle.addEventListener('change', (e) => { state.setIsWaypointVisible(e.target.checked); drawCanvas(); });
    dom.departureToggle.addEventListener('change', (e) => { state.setIsDepartureVisible(e.target.checked); drawCanvas(); });
    dom.destinationToggle.addEventListener('change', (e) => { state.setIsDestinationVisible(e.target.checked); drawCanvas(); });

    function updateOrientationUI() {
        const v = state.getIsVertical();
        dom.canvasContainer.classList.toggle('vertical', v);
        dom.orientationToggle.textContent = v
            ? (state.currentLangData.orientation_vertical || 'Vertical')
            : (state.currentLangData.orientation_landscape || 'Horizontal');
    }
    updateOrientationUI();
    dom.orientationToggle.addEventListener('click', () => {
        state.setIsVertical(!state.getIsVertical());
        updateOrientationUI();
        drawCanvas();
    });

    dom.textSize.addEventListener("change", () => drawCanvas());
    dom.textStyle.addEventListener("change", () => drawCanvas());
    dom.textFont.addEventListener("change", () => drawCanvas());
    dom.textBackgroundOpacity.addEventListener("input", () => {
        const opacityLabel = document.getElementById("opacity-value");
        if (opacityLabel) opacityLabel.textContent = dom.textBackgroundOpacity.value + "%";
        drawCanvas();
    });

    dom.customEventName.addEventListener("input", () => drawCanvas());
    dom.customStartCity.addEventListener("input", () => drawCanvas());
    dom.customStartLocation.addEventListener("input", () => drawCanvas());
    dom.customDestCity.addEventListener("input", () => drawCanvas());
    dom.customDestLocation.addEventListener("input", () => drawCanvas());
    dom.customDate.addEventListener("change", (e) => {
        const d = DateTime.fromISO(e.target.value);
        if (d.isValid && state.currentLangData) {
            const labelKey = state.currentLangData.label_selected_date || 'Fecha seleccionada';
            dom.customDateDisplay.textContent = `${labelKey}: ${formatDateForDisplay(d)}`;
        }
        drawCanvas();
    });

    dom.customDate.addEventListener("keydown", (e) => { if (e.key === "Escape") dom.customDate.blur(); });
    dom.customTime.addEventListener("keydown", (e) => { if (e.key === "Escape") dom.customTime.blur(); });

    dom.customTime.addEventListener("input", () => { drawCanvas(); onTimeChange(); });
    dom.departureTimeOffset.addEventListener("change", () => { drawCanvas(); onTimeChange(); });

    dom.resetCanvas.addEventListener("click", () => {
        revokeAllObjectUrls();
        state.setMapImage(null); state.setCircleImageTop(null); state.setCircleImageBottom(null);
        state.setLogoImage(null); state.setBackgroundImage(null); state.setDetailImage(null); state.setCircleImageWaypoint(null);
        state.imageX = 0; state.imageY = 0; state.imageScale = 1;
        state.circleImageXTop = 20; state.circleImageYTop = 20; state.circleImageScaleTop = 1;
        state.circleImageXBottom = 20; state.circleImageYBottom = 20; state.circleImageScaleBottom = 1;
        state.circleImageXWaypoint = 20; state.circleImageYWaypoint = 20; state.circleImageScaleWaypoint = 1;
        state.detailImageX = 20; state.detailImageY = 20; state.detailImageScale = 1;
        dom.mapUpload.value = ""; dom.circleUploadTop.value = ""; dom.circleUploadBottom.value = "";
        dom.logoUpload.value = ""; dom.backgroundUpload.value = ""; dom.detailUpload.value = ""; dom.waypointUpload.value = "";
        drawCanvas();
    });

    dom.speedToggles.forEach((toggle) => toggle.addEventListener('change', (e) => { const idx = parseInt(e.target.dataset.speedIndex, 10); if (!isNaN(idx)) { state.speedIndicators[idx].visible = e.target.checked; drawCanvas(); } }));
    dom.speedValues.forEach((input) => input.addEventListener('input', (e) => { const idx = parseInt(e.target.dataset.speedIndex, 10); if (!isNaN(idx)) { state.speedIndicators[idx].value = e.target.value; drawCanvas(); } }));
    dom.speedUnits.forEach((select) => select.addEventListener('change', (e) => { const idx = parseInt(e.target.dataset.speedIndex, 10); if (!isNaN(idx)) { state.speedIndicators[idx].unit = e.target.value; drawCanvas(); } }));
}
