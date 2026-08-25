export const AVAILABLE_LANGUAGES = [
    { code: 'es', key: 'swarm_lang_es' },
    { code: 'en', key: 'swarm_lang_en' },
    { code: 'pt', key: 'swarm_lang_pt' },
    { code: 'fr', key: 'swarm_lang_fr' },
    { code: 'de', key: 'swarm_lang_de' },
    { code: 'it', key: 'swarm_lang_it' },
    { code: 'nl', key: 'swarm_lang_nl' },
    { code: 'pl', key: 'swarm_lang_pl' },
    { code: 'ru', key: 'swarm_lang_ru' },
    { code: 'tr', key: 'swarm_lang_tr' },
    { code: 'cs', key: 'swarm_lang_cs' },
    { code: 'ro', key: 'swarm_lang_ro' },
    { code: 'sv', key: 'swarm_lang_sv' },
    { code: 'da', key: 'swarm_lang_da' },
    { code: 'fi', key: 'swarm_lang_fi' },
    { code: 'no', key: 'swarm_lang_no' },
    { code: 'hu', key: 'swarm_lang_hu' },
    { code: 'bg', key: 'swarm_lang_bg' },
    { code: 'ko', key: 'swarm_lang_ko' },
    { code: 'zh', key: 'swarm_lang_zh' },
    { code: 'ja', key: 'swarm_lang_ja' },
];

export const timezoneRegions = {
    hispano: {
        name: 'region_hispano',
        zones: [
            { iana_tz: 'America/Mexico_City', key: 'tz_mx_gt_hn_cr' },
            { iana_tz: 'America/Lima', key: 'tz_pe_ec_co' },
            { iana_tz: 'America/Caracas', key: 'tz_ve' },
            { iana_tz: 'America/La_Paz', key: 'tz_bo' },
            { iana_tz: 'America/Santiago', key: 'tz_cl' },
            { iana_tz: 'America/Asuncion', key: 'tz_py' },
            { iana_tz: 'America/Montevideo', key: 'tz_uy_ar_br' },
            { iana_tz: 'Europe/Madrid', key: 'tz_es' }
        ]
    },
    lusofono: {
        name: 'region_lusofono',
        zones: [
            { iana_tz: 'America/Manaus', key: 'tz_br_manaus' },
            { iana_tz: 'America/Sao_Paulo', key: 'tz_br_brasilia' },
            { iana_tz: 'Europe/Lisbon', key: 'tz_pt' },
            { iana_tz: 'Africa/Bissau', key: 'tz_gw' },
            { iana_tz: 'Europe/Madrid', key: 'tz_es' },
            { iana_tz: 'Africa/Casablanca', key: 'tz_ma' },
            { iana_tz: 'Africa/Luanda', key: 'tz_ao' },
            { iana_tz: 'Africa/Maputo', key: 'tz_mz' }
        ]
    },
    north_america: {
        name: 'region_north_america',
        zones: [
            { iana_tz: 'America/Los_Angeles', key: 'tz_us_pst' },
            { iana_tz: 'America/Mexico_City', key: 'tz_mx_gt_hn_cr' },
            { iana_tz: 'America/Denver', key: 'tz_us_mst' },
            { iana_tz: 'America/Chicago', key: 'tz_us_cst' },
            { iana_tz: 'America/New_York', key: 'tz_us_est' },
            { iana_tz: 'Europe/London', key: 'tz_gb' }
        ]
    },
    europe: {
        name: 'region_europe',
        zones: [
            { iana_tz: 'Europe/London', key: 'tz_pt_gb_ie' },
            { iana_tz: 'Europe/Berlin', key: 'tz_es_fr_it_de_pl' },
            { iana_tz: 'Europe/Athens', key: 'tz_gr_fi' },
            { iana_tz: 'Europe/Moscow', key: 'tz_ru_tr' }
        ]
    },
    universal: {
        name: 'region_universal',
        zones: [
            { iana_tz: 'America/Los_Angeles', key: 'tz_us_pst' },
            { iana_tz: 'America/New_York', key: 'tz_us_est' },
            { iana_tz: 'America/Montevideo', key: 'tz_uy_ar_br' },
            { iana_tz: 'America/Lima', key: 'tz_pe_ec_co' },
            { iana_tz: 'Europe/Madrid', key: 'tz_es' },
            { iana_tz: 'Europe/Paris', key: 'tz_fr' },
            { iana_tz: 'Europe/Berlin', key: 'tz_de' },
            { iana_tz: 'Europe/Moscow', key: 'tz_ru' },
            { iana_tz: 'Asia/Shanghai', key: 'tz_cn' }
        ]
    }
};

export const timezoneCountryCodes = {
    'tz_mx_gt_hn_cr': ['MX', 'GT', 'HN', 'CR'],
    'tz_pe_ec_co': ['PE', 'EC', 'CO'],
    'tz_ve': ['VE'],
    'tz_bo': ['BO'],
    'tz_cl': ['CL'],
    'tz_py': ['PY'],
    'tz_uy_ar_br': ['UY', 'AR', 'BR'],
    'tz_es': ['ES'],
    'tz_br_manaus': ['BR'],
    'tz_br_brasilia': ['BR'],
    'tz_pt': ['PT'],
    'tz_gw': ['GW'],
    'tz_ma': ['MA'],
    'tz_ao': ['AO'],
    'tz_mz': ['MZ'],
    'tz_us_pst': ['US'],
    'tz_us_mst': ['US'],
    'tz_us_cst': ['US'],
    'tz_us_est': ['US'],
    'tz_gb': ['GB'],
    'tz_pt_gb_ie': ['PT', 'GB', 'IE'],
    'tz_es_fr_it_de_pl': ['ES', 'FR', 'IT', 'DE', 'PL'],
    'tz_gr_fi': ['GR', 'FI'],
    'tz_ru_tr': ['RU', 'TR'],
    'tz_fr': ['FR'],
    'tz_de': ['DE'],
    'tz_ru': ['RU'],
    'tz_cn': ['CN']
};