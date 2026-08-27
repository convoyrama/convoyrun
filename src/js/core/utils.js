import { dom } from '../dom.js';
import { timezoneCountryCodes } from './config.js';

/** Show/hide element using the `hidden` attribute + explicit display for shown state. */
export function setVisible(el, show, display) {
    if (!el) return;
    el.hidden = !show;
    if (show && display) el.style.display = display;
    if (!show) el.style.display = '';
}

let _copyMessageTimeout = null;

export function showCopyMessage(message = "¡Información copiada al portapapeles!") {
    if (!dom.copyMessage) { console.warn('[UTILS] copyMessage element not found'); return; }
    if (_copyMessageTimeout) { clearTimeout(_copyMessageTimeout); }
    dom.copyMessage.textContent = message;
    setVisible(dom.copyMessage, true, 'block');
    _copyMessageTimeout = setTimeout(() => { setVisible(dom.copyMessage, false); _copyMessageTimeout = null; }, 2000);
}

export function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            lines.push(line.trim());
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    return lines;
}

export function pad(n) { return n < 10 ? "0" + n : n; }

let _footerActionTimeout = null;

export function setFooterAction(text) {
    const el = document.getElementById('footer-action');
    if (el) el.textContent = text || '';
}

export function showFooterAction(text, durationMs = 2000) {
    setFooterAction(text);
    if (_footerActionTimeout) clearTimeout(_footerActionTimeout);
    if (durationMs > 0) {
        _footerActionTimeout = setTimeout(() => { setFooterAction(''); _footerActionTimeout = null; }, durationMs);
    }
}

// Las zonas que el usuario agrega a mano (state.activeZones sin key) traen
// su propio label; las de un preset se buscan por key como siempre.
export function getZoneLabel(tz, langData) {
    if (tz.key === null) return tz.label;
    return langData[tz.key] || (timezoneCountryCodes[tz.key] || [tz.key.replace('tz_', '').toUpperCase()]).join(', ');
}

/**
 * Markdown renderer for event descriptions.
 * Supports: bold, italic, strikethrough, inline code, links, unordered lists, line breaks.
 * Sanitizes HTML to prevent XSS.
 */
export function renderMarkdown(text) {
    if (!text) return '';
    // Sanitize: strip HTML tags
    let s = text.replace(/<[^>]*>/g, '');
    // Escape HTML entities
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Inline code `code` (before bold/italic to avoid inner parsing)
    s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    // Bold: **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/_(.+?)_/g, '<em>$1</em>');
    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Unordered list lines: "- " or "* " at line start
    s = s.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    s = s.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    // Line breaks (but not inside lists)
    s = s.replace(/\n/g, '<br>');
    return s;
}