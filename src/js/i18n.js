// Standalone (el sitio usa main-i18n.js aparte); dispara 'languageChanged'.
async function loadLanguage(lang) {
    try {
        const response = await fetch(`./locales/${lang}.json`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const translations = await response.json();

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const translation = translations[el.getAttribute('data-i18n')];
            if (translation) el.textContent = translation;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const translation = translations[el.getAttribute('data-i18n-placeholder')];
            if (translation) el.placeholder = translation;
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const translation = translations[el.getAttribute('data-i18n-title')];
            if (translation) el.title = translation;
        });

        document.title = translations.page_title || document.title;
        document.documentElement.lang = lang;
        localStorage.setItem('preferred-lang', lang);

        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
        });

        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang, translations } }));
    } catch (err) {
        console.error(`Failed to load language "${lang}":`, err);
        if (lang !== 'en') loadLanguage('en');
    }
}

export function initI18n() {
    const savedLang = localStorage.getItem('preferred-lang') || 'en';
    loadLanguage(savedLang);

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => loadLanguage(btn.getAttribute('data-lang')));
    });
}
