// WebKitGTK no scrollea el popup nativo de 27 opciones; el <select> oculto
// sigue siendo la fuente de verdad, este panel solo reemplaza la interacción.
import { dom } from './dom.js';

function closePanel() {
    dom.stylePickerPanel.classList.remove('open');
}

function renderPanel() {
    dom.stylePickerPanel.innerHTML = '';
    Array.from(dom.textStyle.options).forEach(option => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'style-picker-option' + (option.value === dom.textStyle.value ? ' active' : '');
        btn.textContent = option.textContent;
        btn.addEventListener('click', () => {
            dom.textStyle.value = option.value;
            dom.textStyle.dispatchEvent(new Event('change'));
            dom.stylePickerToggle.textContent = option.textContent;
            closePanel();
        });
        dom.stylePickerPanel.appendChild(btn);
    });
}

export function initStylePicker() {
    dom.stylePickerToggle = document.getElementById('style-picker-toggle');
    dom.stylePickerPanel = document.getElementById('style-picker-panel');
    if (!dom.stylePickerToggle || !dom.stylePickerPanel) return;

    dom.stylePickerToggle.addEventListener('click', () => {
        const willOpen = !dom.stylePickerPanel.classList.contains('open');
        if (willOpen) renderPanel();
        dom.stylePickerPanel.classList.toggle('open', willOpen);
    });

    document.addEventListener('click', (e) => {
        if (!dom.stylePickerPanel.contains(e.target) && e.target !== dom.stylePickerToggle) closePanel();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
}
