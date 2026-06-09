// ==UserScript==
// @name         Yandex Music Downloader (Ultimate Native)
// @namespace    http://tampermonkey.net/
// @version      18.14
// @updateURL    https://github.com/frostbittenbull/Yandex-Music-Downloader/raw/refs/heads/main/Yandex-Music-Downloader.user.js
// @downloadURL  https://github.com/frostbittenbull/Yandex-Music-Downloader/raw/refs/heads/main/Yandex-Music-Downloader.user.js
// @description  Скачивание треков/плейлистов из Яндекс.Музыки напрямую (с поддержкой тегов для MP3 и M4A)
// @author       frostbittenbull
// @icon         https://music.yandex.ru/favicon.svg
// @icon64       https://music.yandex.ru/favicon.svg
// @match        https://music.yandex.ru/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.music.yandex.net
// @connect      avatars.yandex.net
// @connect      strm.yandex.net
// @connect      *.strm.yandex.net
// @connect      storage.yandex.net
// @connect      *.storage.yandex.net
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const _style = document.createElement('style');
    _style.textContent = `
        .NavbarDesktopAnimatedPlusBar_root___wH9W,
        .NavbarDesktopAnimatedBar_root__tTyvO,
        .VibePageFreemiumBlock_root__HCPuh,
        .VibePage_freemiumBlock__uhLoT { display: none !important; }
        .PaywallModal_root__HIYOy,
        [data-floating-ui-portal]:has(.PaywallModal_root__HIYOy) { display: none !important; pointer-events: none !important; }
        [data-floating-ui-portal]:has(.Vi7Rd0SZWqD17F0872TB) { display: none !important; pointer-events: none !important; }
        .l66GiFKS1Ux_BNd603Cu.NaZE1NCUxSM1MvpZuLJV[data-floating-ui-inert] { display: none !important; pointer-events: none !important; }
        /* Download All button: sits right after Слушать (order:2), same yellow style */
        button.ymd-dl-all-btn { order: 2 !important; }
        button.ymd-dl-all-btn .ymd-btn-icon { display: none; }
        @media only screen and (max-width: 767.98px) {
            button.ymd-dl-all-btn { display: none !important; }
        }

    `;
    (document.head || document.documentElement).appendChild(_style);

    const SECRET_KEY = "kzqU4XhfCaY6B6JTHODeq5";
    const API_BASE = "https://api.music.yandex.net";

    const QUALITY_OPTIONS = [
        { label: "Lossless → FLAC",           value: "lossless", codecs: ["flac", "flac-mp4"] },
        { label: "High → MP3 (~320 kbps)",    value: "hq",       codecs: ["mp3"] },
        { label: "Low → MP3 (~192 kbps)",     value: "lq",       codecs: ["mp3"] },
    ];

    function guessCoverMime(buf) {
        const view = new Uint8Array(buf.slice(0, 8));
        if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
        if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) return { mime: 'image/png', ext: 'png' };
        return { mime: 'image/jpeg', ext: 'jpg' };
    }

    (function injectPageInterceptor() {
        const script = document.createElement('script');
        script.textContent = `(function() {
            function saveToken(t) {
                if (!t || t.length < 20) return;
                try { sessionStorage.setItem('ymd_intercepted_token', t); sessionStorage.setItem('ymd_injector_ok', '1'); } catch(e) {}
            }
            const _f = window.fetch;
            window.fetch = function(input, init) {
                try {
                    const h = init && init.headers;
                    let auth = null;
                    if (h && h.get) auth = h.get('Authorization');
                    else if (h) auth = h['Authorization'] || h['authorization'];
                    if (auth && /^OAuth\\s+/.test(auth)) saveToken(auth.replace(/^OAuth\\s+/, ''));
                    const url = typeof input === 'string' ? input : (input && input.url) || '';
                    const m = url.match(/[?&](?:oauth_token|access_token)=([A-Za-z0-9._-]{20,})/);
                    if (m) saveToken(m[1]);
                } catch(e) {}
                return _f.apply(this, arguments);
            };
            const _sh = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                try {
                    if (/^authorization$/i.test(name) && /^OAuth\\s+/.test(value))
                        saveToken(value.replace(/^OAuth\\s+/, ''));
                } catch(e) {}
                return _sh.call(this, name, value);
            };
            const _op = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
                try {
                    const m = String(url).match(/[?&](?:oauth_token|access_token)=([A-Za-z0-9._-]{20,})/);
                    if (m) saveToken(m[1]);
                } catch(e) {}
                return _op.apply(this, arguments);
            };
        })();`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();

        const tokenSync = setInterval(function() {
            try {
                const t = sessionStorage.getItem('ymd_intercepted_token');
                if (t && t.length > 20) {
                    const stored = GM_getValue('ymd_oauth_token', null);
                    if (stored !== t) GM_setValue('ymd_oauth_token', t);
                    clearInterval(tokenSync);
                }
            } catch(e) {}
        }, 1000);

        try {
            const hash = window.location.hash;
            if (hash.includes('access_token=')) {
                const m = hash.match(/access_token=([A-Za-z0-9._-]+)/);
                if (m) GM_setValue('ymd_oauth_token', m[1]);
            }
        } catch(e) {}
    })();

    const iconSvg = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"
         style="margin-right:6px;display:inline-block;vertical-align:middle;">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
    </svg>`;

    const downloadSmallSvgIcon = `<svg class="J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk" focusable="false" aria-hidden="true"><use xlink:href="/icons/sprite.svg#download_xxs"></use></svg>`;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function sanitize(name) {
        return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 200);
    }

    function deepFindToken(obj, depth) {
        if (!obj || depth > 5 || typeof obj !== 'object') return null;
        for (const key of Object.keys(obj)) {
            try {
                const val = obj[key];
                if (typeof val === 'string' && val.length > 20 && val.length < 200
                    && /^[A-Za-z0-9._-]+$/.test(val)
                    && /(token|oauth|access)/i.test(key)) {
                    return val;
                }
                if (val && typeof val === 'object') {
                    const found = deepFindToken(val, depth + 1);
                    if (found) return found;
                }
            } catch(e) {}
        }
        return null;
    }

    function getOAuthToken() {
        const stored = GM_getValue('ymd_oauth_token', null);
        if (stored && typeof stored === 'string' && stored.length > 10) return "OAuth " + stored;

        try {
            const t = sessionStorage.getItem('ymd_intercepted_token');
            if (t && t.length > 20) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
        } catch(e) {}

        try {
            const candidates = [
                unsafeWindow.Ya, unsafeWindow.__YA__,
                unsafeWindow.__store__?.getState?.(),
                unsafeWindow.__redux_store__?.getState?.(),
                unsafeWindow.__initialData__,
                unsafeWindow.__STATE__,
                unsafeWindow.externalAPI,
            ];
            for (const c of candidates) {
                if (!c) continue;
                const t = deepFindToken(c, 0);
                if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
            }
        } catch(e) {}

        try {
            const snap = unsafeWindow.__STATE_SNAPSHOT__;
            const arr = Array.isArray(snap) ? snap : [snap];
            for (const s of arr) {
                const t = deepFindToken(s, 0);
                if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
            }
        } catch(e) {}

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                const val = localStorage.getItem(key);
                if (!val) continue;
                try {
                    const p = JSON.parse(val);
                    const t = deepFindToken(p, 0);
                    if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
                } catch(e) {
                    if (/(oauth|token)/i.test(key) && val.length > 20
                        && val.length < 200 && /^[A-Za-z0-9._-]+$/.test(val)) {
                        GM_setValue('ymd_oauth_token', val);
                        return "OAuth " + val;
                    }
                }
            }
        } catch(e) {}

        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (!key || !/(oauth|token)/i.test(key)) continue;
                const val = sessionStorage.getItem(key);
                if (!val) continue;
                try {
                    const p = JSON.parse(val);
                    const t = deepFindToken(p, 0);
                    if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
                } catch(e) {
                    if (val.length > 20 && /^[A-Za-z0-9._-]+$/.test(val)) {
                        GM_setValue('ymd_oauth_token', val);
                        return "OAuth " + val;
                    }
                }
            }
        } catch(e) {}

        return null;
    }

    function autoGetToken(silent = false) {
        const CLIENT_ID = "23cabbbdc6cd418abb4b39c32c41195d";
        const authUrl = "https://oauth.yandex.ru/authorize?response_type=token&client_id=" + CLIENT_ID;
        const popup = window.open(authUrl, "ymd_oauth", "width=600,height=500,left=200,top=100");
        if (!popup) {
            if (!silent) alert("Разрешите всплывающие окна для music.yandex.ru и попробуйте снова.");
            return;
        }
        status("Ожидание авторизации в открывшемся окне...");
        const timer = setInterval(() => {
            try {
                const url = popup.location.href;
                if (url.includes("access_token=")) {
                    const m = url.match(/access_token=([A-Za-z0-9._-]+)/);
                    if (m && m[1]) {
                        GM_setValue('ymd_oauth_token', m[1]);
                        clearInterval(timer);
                        popup.close();
                        status("✓ Токен получен! Можно качать.");
                        hideStatus(3000);
                    }
                }
            } catch(e) {}
            if (popup.closed) {
                clearInterval(timer);
                if (!GM_getValue('ymd_oauth_token', null) && !silent)
                    status("Окно закрыто без авторизации.", true);
            }
        }, 300);
    }

    function showAuthBanner() {
        if (GM_getValue('ymd_oauth_token', null)) return;
        const banner = document.createElement('div');
        banner.id = 'ymd-auth-banner';
        banner.style.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:999999;
            -webkit-backdrop-filter:blur(.875rem);backdrop-filter:blur(.875rem);background-color:var(--ym-background-color-primary-enabled-menu);border:none;border-radius:var(--ym-radius-size-xl);box-shadow:0 .25rem 1.25rem 0 var(--ym-shadow-menu);
            color:#fff; padding:14px 18px;
            font-family:var(--ym-font-text); font-size:14px; max-width:320px;
            display:flex; align-items:center; gap:12px;
        `;
        banner.innerHTML = `
            <div style="flex:1; line-height:1.4;">
                <b style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</b><br>
                Нажмите "Войти"<br>чтобы авторизоваться<br>(больше не появится)
            </div>
            <button id="ymd-auth-btn" style="
                background:#ffff00; color:#000; border:none; border-radius:16px;
                padding:8px 14px; cursor:pointer; font-size:13px; font-weight:bold;
                white-space:nowrap; flex-shrink:0; font-family:var(--ym-font-heading);
            ">Войти</button>
            <span id="ymd-banner-close" style="
                cursor:pointer; color:#666; font-size:18px;
                padding:0 2px; flex-shrink:0; user-select:none;
            " title="Скрыть">✕</span>
        `;
        document.body.appendChild(banner);
        banner.querySelector('#ymd-auth-btn').addEventListener('click', () => { banner.remove(); autoGetToken(false); });
        banner.querySelector('#ymd-banner-close').addEventListener('click', () => banner.remove());
    }

    function promptForToken() {
        const current = GM_getValue('ymd_oauth_token', '') || '';
        const input = prompt(
            "Введите OAuth токен:\n\n" +
            "1) Откройте: https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d\n" +
            "2) Скопируйте access_token из адресной строки\n" +
            "3) Вставьте сюда\n\n" +
            "(Если вы уже авторизованы на сайте — токен подхватится автоматически при воспроизведении любого трека)",
            current
        );
        if (input === null) return;
        const cleaned = input.trim().replace(/^OAuth\s+/i, '');
        if (cleaned.length < 10) { alert("Неверный токен"); return; }
        GM_setValue('ymd_oauth_token', cleaned);
        alert("Токен сохранён. Обновите страницу.");
    }

    try {
        GM_registerMenuCommand("⚙️ Настроить токен", promptForToken);
        GM_registerMenuCommand("🔑 Получить токен автоматически", autoGetToken);
        GM_registerMenuCommand("🗑️ Сбросить токен", () => {
            GM_setValue('ymd_oauth_token', null);
            sessionStorage.removeItem('ymd_intercepted_token');
            alert("Токен сброшен.");
        });
        GM_registerMenuCommand("🔍 Диагностика токена", function() {
            const lines = [];
            const gm = GM_getValue('ymd_oauth_token', null);
            lines.push('=== GM хранилище ===');
            lines.push(gm ? 'ЕСТЬ: ' + gm.slice(0,12) + '...' : 'пусто');
            lines.push('=== sessionStorage[ymd_intercepted_token] ===');
            try {
                const ss = sessionStorage.getItem('ymd_intercepted_token');
                lines.push(ss ? 'ЕСТЬ: ' + ss.slice(0,12) + '...' : 'пусто');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== sessionStorage ключи ===');
            try {
                const keys = [];
                for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
                lines.push(keys.join(', ') || '(пусто)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== localStorage ключи ===');
            try {
                const keys = [];
                for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
                lines.push(keys.join(', ') || '(пусто)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Глобальные объекты ===');
            try {
                const globals = ['Ya','__YA__','__store__','__redux_store__','__initialData__','__STATE__','externalAPI','__STATE_SNAPSHOT__'];
                const found = globals.filter(k => { try { return !!unsafeWindow[k]; } catch(e) { return false; } });
                lines.push(found.join(', ') || '(ничего)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Ya ключи ===');
            try {
                const ya = unsafeWindow.Ya;
                if (ya) lines.push(Object.keys(ya).join(', '));
                else lines.push('(нет Ya)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Ya.Music ===');
            try {
                const ym = unsafeWindow.Ya && unsafeWindow.Ya.Music;
                if (ym) lines.push(Object.keys(ym).join(', '));
                else lines.push('(нет)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Ya токен ===');
            try {
                const ya = unsafeWindow.Ya;
                const candidates = [
                    ya?.token, ya?.oauth, ya?.accessToken,
                    ya?.Music?.token, ya?.Music?.oauth,
                    ya?.Rum?.token,
                    ya?.d?.token, ya?.d?.oauth,
                ];
                const t = candidates.find(x => x && typeof x === 'string' && x.length > 20);
                lines.push(t ? 'ЕСТЬ: ' + t.slice(0,12) + '...' : 'не найден');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== XHR перехват ===');
            try {
                lines.push('toString: ' + XMLHttpRequest.prototype.setRequestHeader.toString().slice(0, 60));
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Инжектор ===');
            try {
                const inj = sessionStorage.getItem('ymd_injector_ok');
                lines.push(inj ? 'ДА, сработал' : 'НЕТ (или ещё не перехватил запрос)');
            } catch(e) { lines.push('ошибка: ' + e); }
            const result = lines.join('\n');
            console.log('[YMD ДИАГНОСТИКА]\n' + result);
            alert('[YMD ДИАГНОСТИКА]\n\n' + result);
        });
    } catch (e) {}

    function getVersion() {
        return (unsafeWindow && unsafeWindow.VERSION) || '5.32.1';
    }

    let panel = document.getElementById('ymd-panel') || document.createElement('div');
    if (!panel.id) {
        panel.id = 'ymd-panel';
        panel.style.cssText = `
            position:fixed; bottom:20px; right:20px;
            -webkit-backdrop-filter:blur(.875rem);
            backdrop-filter:blur(.875rem);
            background-color:var(--ym-background-color-primary-enabled-menu);
            border:none;
            border-radius:var(--ym-radius-size-xl);
            box-shadow:0 .25rem 1.25rem 0 var(--ym-shadow-menu);
            color:#fff;
            padding:var(--ym-spacer-size-xs);
            z-index:999999; display:none; font-family:var(--ym-font-text);
            min-width:320px; max-width:460px;
        `;
    }

    function status(text, err = false) {
        panel.style.display = 'block';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:${err ? '#ff5555' : '#ffff00'};font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                <span id="ymd-close" title="Закрыть" style="
                    cursor:pointer;font-size:18px;line-height:1;
                    color:#aaa;padding:0 4px;margin-left:10px;user-select:none;
                " onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
            </div>
            <span style="font-size:14px;display:inline-block;line-height:1.4;">${text}</span>
        `;
        const closeBtn = panel.querySelector('#ymd-close');
        if (closeBtn) closeBtn.addEventListener('click', () => panel.style.display = 'none');
        if (err) console.error("[YMD]", text);
    }

    function hideStatus(ms = 4000) {
        setTimeout(() => panel.style.display = 'none', ms);
    }

    function setProgress(pct, loaded, total) {
        let bar = panel.querySelector('#ymd-progress');
        if (!bar) return;
        pct = Math.max(0, Math.min(100, Math.round(pct)));
        bar.style.width = pct + '%';
        const label = panel.querySelector('#ymd-pct');
        if (label) {
            if (loaded != null && total != null && total > 0) {
                const toMB = b => (b / 1048576).toFixed(2);
                label.textContent = `${toMB(loaded)}/${toMB(total)} МБ · (${pct}/100%)`;
            } else {
                label.textContent = pct + '%';
            }
        }
    }

    function formatBadge(info) {
        if (!info) return '';
        const codec = (info.codec || '').toLowerCase();
        const br = info.bitrate || 0;
        let label, color;
        if (codec === 'flac' || codec === 'flac-mp4') {
            label = 'FLAC'; color = '#00bcd4';
        } else if (codec === 'mp3' && br >= 300) {
            label = 'MP3 320'; color = '#00e676';
        } else if (codec === 'mp3') {
            label = `MP3 ${br || '~192'}`; color = '#ff9800';
        } else {
            label = codec.toUpperCase() + (br ? ` ${br}` : ''); color = '#aaa';
        }
        return `<span style="
            display:inline-block;margin-left:8px;padding:1px 7px;border-radius:10px;
            font-size:11px;font-weight:bold;vertical-align:middle;
            background:${color}22;color:${color};border:1px solid ${color}55;
        ">${label}</span>`;
    }

    function statusWithProgress(trackName, trackNum, total, info) {
        panel.style.display = 'block';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                <span id="ymd-close" title="Закрыть" style="
                    cursor:pointer;font-size:18px;line-height:1;
                    color:#aaa;padding:0 4px;margin-left:10px;user-select:none;
                " onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
            </div>
            <span style="font-size:13px;color:#aaa;">Скачивание ${trackNum} из ${total}</span><br>
            <b style="color:#00e676;font-size:14px;">${trackName}</b>${formatBadge(info)}
            <div style="margin-top:10px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;height:6px;">
                <div id="ymd-progress" style="height:100%;width:0%;background:linear-gradient(90deg,#ffff00,#ff9800);transition:width 0.15s ease;border-radius:4px;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                <span id="ymd-pct" style="font-size:12px;color:#aaa;">0%</span>
                <button id="ymd-cancel-btn" style="
                    background:rgba(255,85,85,0.15);color:#ff5555;
                    border:1px solid rgba(255,85,85,0.3);border-radius:6px;
                    padding:3px 10px;font-size:12px;cursor:pointer;
                " onmouseover="this.style.background='rgba(255,85,85,0.3)'"
                  onmouseout="this.style.background='rgba(255,85,85,0.15)'">Отмена</button>
            </div>
        `;
        const closeBtn = panel.querySelector('#ymd-close');
        if (closeBtn) closeBtn.addEventListener('click', () => panel.style.display = 'none');
        const cancelBtn = panel.querySelector('#ymd-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { downloadCancelled = true; });
    }

    function showQualityPicker() {
        return new Promise((resolve) => {
            const savedIdx = GM_getValue('ymd_quality_idx', 0);
            const savedCovers = GM_getValue('ymd_download_covers', false);

            const isTaggableSaved = QUALITY_OPTIONS[savedIdx].codecs.some(c => c.includes('mp3') || c.includes('mp4') || c.includes('aac'));

            panel.style.display = 'block';
            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                    <span id="ymd-close" title="Закрыть" style="cursor:pointer;font-size:18px;line-height:1;color:#aaa;padding:0 4px;margin-left:10px;user-select:none;"
                        onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
                </div>
                <div style="font-size:13px;margin-bottom:8px;color:#ccc;">Качество:</div>
                <div id="ymd-quality-btns" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
                    ${QUALITY_OPTIONS.map((q, i) => `
                        <button data-qi="${i}" style="
                            background:${i === savedIdx ? 'rgba(255,255,0,0.15)' : 'rgba(255,255,255,0.07)'};
                            border:1px solid ${i === savedIdx ? '#ffff00' : 'rgba(255,255,255,0.15)'};
                            border-radius:16px; color:#fff; padding:7px 12px; cursor:pointer;
                            font-size:13px; text-align:left;
                        " onmouseover="this.style.background='rgba(255,255,0,0.12)'"
                          onmouseout="this.style.background='${i === savedIdx ? 'rgba(255,255,0,0.15)' : 'rgba(255,255,255,0.07)'}'">
                            ${q.label}
                        </button>
                    `).join('')}
                </div>
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ccc;cursor:pointer;margin-bottom:12px;">
                    <input type="checkbox" id="ymd-covers-chk" ${savedCovers ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">
                    <span id="ymd-covers-label">${isTaggableSaved ? 'Встраивать теги и обложки' : 'Скачивать обложки'}</span>
                </label>
                <button id="ymd-go-btn" style="
                    background:#ffff00; color:#000; border:none; border-radius:16px;
                    padding:8px 18px; cursor:pointer; font-size:13px; font-weight:bold; width:100%; font-family:var(--ym-font-heading);
                ">Скачать</button>
            `;

            let selectedIdx = savedIdx;

            const closeBtn = panel.querySelector('#ymd-close');
            if (closeBtn) closeBtn.addEventListener('click', () => { panel.style.display = 'none'; resolve(null); });

            panel.querySelectorAll('[data-qi]').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedIdx = parseInt(btn.dataset.qi);
                    panel.querySelectorAll('[data-qi]').forEach((b, i) => {
                        b.style.background = i === selectedIdx ? 'rgba(255,255,0,0.15)' : 'rgba(255,255,255,0.07)';
                        b.style.border = `1px solid ${i === selectedIdx ? '#ffff00' : 'rgba(255,255,255,0.15)'}`;
                    });
                    const isTaggable = QUALITY_OPTIONS[selectedIdx].codecs.some(c => c.includes('mp3') || c.includes('mp4') || c.includes('aac'));
                    panel.querySelector('#ymd-covers-label').textContent = isTaggable ? 'Встраивать теги и обложки' : 'Скачивать обложки';
                });
            });

            panel.querySelector('#ymd-go-btn').addEventListener('click', () => {
                const downloadCovers = panel.querySelector('#ymd-covers-chk').checked;
                GM_setValue('ymd_quality_idx', selectedIdx);
                GM_setValue('ymd_download_covers', downloadCovers);
                resolve({ quality: QUALITY_OPTIONS[selectedIdx], downloadCovers });
            });
        });
    }

    async function getSign(key, data) {
        const enc = new TextEncoder();
        const ck = await crypto.subtle.importKey(
            "raw", enc.encode(key),
            { name: "HMAC", hash: "SHA-256" },
            true, ["sign"]
        );
        const sig = await crypto.subtle.sign("HMAC", ck, enc.encode(data));
        return btoa(String.fromCharCode(...new Uint8Array(sig))).slice(0, -1);
    }

    function gmFetch(url, headers = {}, timeout = 30000) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url, headers,
                timeout,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res);
                    else reject(new Error(`HTTP ${res.status}: ${(res.responseText || '').slice(0, 200)}`));
                },
                ontimeout: () => reject(new Error("Превышено время ожидания")),
                onerror: () => reject(new Error("Сетевая ошибка"))
            });
        });
    }

    async function gmJSON(url, headers = {}) {
        const res = await gmFetch(url, headers);
        return JSON.parse(res.responseText);
    }

    async function fetchTokenFromPassport() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://music.yandex.ru/api/v2.1/handlers/auth?external-domain=music.yandex.ru&overembed=no",
                headers: { "Referer": "https://music.yandex.ru/" },
                onload: (res) => {
                    try {
                        const d = JSON.parse(res.responseText);
                        const t = d?.token || d?.oauth_token || d?.access_token;
                        if (t && t.length > 20) { resolve(t); return; }
                    } catch(e) {}
                    resolve(null);
                },
                onerror: () => resolve(null)
            });
        });
    }

    async function checkAuth() {
        if (!GM_getValue('ymd_oauth_token', null)) {
            try {
                const t = await fetchTokenFromPassport();
                if (t) GM_setValue('ymd_oauth_token', t);
            } catch(e) {}
        }

        const token = getOAuthToken();
        if (!token) return { ok: false, err: "Нет токена" };
        try {
            const d = await gmJSON(`${API_BASE}/account/status`, {
                "Authorization": token,
                "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion()
            });
            if (d?.result?.account?.uid) {
                return { ok: true, login: d.result.account.login, plus: !!d.result.plus?.hasPlus };
            }
        } catch (e) { console.error("[YMD] auth:", e); }
        return { ok: false, err: "Токен невалидный" };
    }

    async function getTrackDownloadUrl(trackId, qualityOption) {
        const token = getOAuthToken();
        if (!token) throw new Error("Нет OAuth токена. Включите любой трек на сайте (чтобы перехватить токен), либо введите вручную через меню Tampermonkey.");

        const ts = Math.floor(Date.now() / 1000);
        const codecs = qualityOption.codecs;
        const transports = "raw";
        const quality = qualityOption.value;

        const sign = await getSign(SECRET_KEY, `${ts}${trackId}${quality}${codecs.join("")}${transports}`);

        const headers = {
            "Authorization": token,
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };

        const url = `${API_BASE}/get-file-info?ts=${ts}&trackId=${trackId}&quality=${quality}` +
            `&codecs=${encodeURIComponent(codecs.join(","))}&transports=${transports}&sign=${encodeURIComponent(sign)}`;

        for (let i = 0; i < 10; i++) {
            const data = await gmJSON(url, headers);
            if (!data?.downloadInfo) throw new Error("Нет downloadInfo");
            if (String(data.downloadInfo.trackId) !== String(trackId)) { await sleep(150); continue; }
            return data.downloadInfo;
        }
        throw new Error("Превышено число попыток");
    }

    async function getTracksInfo(ids) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;
        return gmJSON(`${API_BASE}/tracks?trackIds=${ids.join(",")}&removeDuplicates=false&withProgress=true`, h);
    }

    async function getPlaylistIds(pid) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;
        const d = await gmJSON(`${API_BASE}/playlist/${pid}?resumeStream=false&richTracks=false`, h);
        if (!d?.tracks) throw new Error("Нет tracks");
        return d.tracks.map(t => String(t.id));
    }

    async function getAlbumIds(aid) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;
        const d = await gmJSON(`${API_BASE}/albums/${aid}/with-tracks?resumeStream=false&richTracks=false`, h);
        if (!d?.volumes) throw new Error("Нет volumes");
        return d.volumes.flatMap(v => v.map(t => String(t.id)));
    }

    async function getArtistTrackIds(artistId) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;
        const ids = [], seen = new Set();
        let page = 0;
        while (true) {
            const r = await gmJSON(`${API_BASE}/artists/${artistId}/tracks?page=${page}&pageSize=100`, h);
            const tracks = r?.tracks || [];
            if (!tracks.length) break;
            let added = 0;
            for (const t of tracks) {
                const tid = String(t.id || t.trackId || '');
                if (tid && !seen.has(tid)) { seen.add(tid); ids.push(tid); added++; }
            }
            if (added === 0 || tracks.length < 100) break;
            page++;
            await sleep(200);
        }
        return ids;
    }

    function getPageType() {
        const h = window.location.hash || window.location.href;
        let m;
        if ((m = h.match(/\/playlists?\/([\w-]+)/))) return { type: "playlist", id: m[1] };
        if ((m = h.match(/\/album\/(\d+)/))) return { type: "album", id: m[1] };
        if ((m = h.match(/\/artist\/(\d+)/))) return { type: "artist", id: m[1] };
        if ((m = h.match(/\/track\/(\d+)/))) return { type: "track", id: m[1] };
        return { type: "unknown" };
    }

    function parseSnapshotIds() {
        let snapshots = [];
        if (unsafeWindow.__STATE_SNAPSHOT__) {
            const s = unsafeWindow.__STATE_SNAPSHOT__;
            snapshots.push(...(Array.isArray(s) ? s : [s]));
        }
        let entries = [];
        for (const snap of snapshots) {
            for (const key of ['playlist', 'album', 'artist']) {
                const items = snap?.[key]?.items || snap?.[key]?.initialItems || snap?.[key]?.popularTracks;
                if (items && Array.isArray(items) && items.length > entries.length) entries = items;
            }
        }
        const ids = [], seen = new Set();
        for (const it of entries) {
            const tid = it.id || it.trackId || it.data?.id;
            if (tid && !seen.has(String(tid))) { seen.add(String(tid)); ids.push(String(tid)); }
        }
        return ids;
    }

    function getMime(codec) {
        if (codec === 'flac') return 'audio/flac';
        if (codec === 'mp3') return 'audio/mpeg';
        return 'audio/mp4';
    }

    function getExt(codec) {
        if (codec === 'flac') return 'flac';
        if (codec === 'mp3') return 'mp3';
        return 'm4a';
    }

    function writeID3v2(audioBuf, meta, coverBuf) {
        function enc(str) { return new TextEncoder().encode(str); }

        function textFrame(id, text) {
            const bom = new Uint8Array([0xFF, 0xFE]);
            const utf16 = new Uint16Array([...text].map(c => c.codePointAt(0)));
            const tb = new Uint8Array(utf16.buffer);
            const size = 1 + bom.length + tb.length;
            const f = new Uint8Array(10 + size);
            for (let i = 0; i < 4; i++) f[i] = id.charCodeAt(i);
            f[4] = (size >> 24) & 0xFF; f[5] = (size >> 16) & 0xFF;
            f[6] = (size >>  8) & 0xFF; f[7] =  size        & 0xFF;
            f[8] = 0x00; f[9] = 0x00;
            f[10] = 0x01;
            f.set(bom, 11);
            f.set(tb, 13);
            return f;
        }

        function apicFrame(imgBuf) {
            const img  = new Uint8Array(imgBuf);
            const mime = (img[0] === 0x89 && img[1] === 0x50) ? 'image/png' : 'image/jpeg';
            const mb   = enc(mime);
            const body = 1 + mb.length + 1 + 1 + 1 + img.length;
            const f    = new Uint8Array(10 + body);
            'APIC'.split('').forEach((c, i) => f[i] = c.charCodeAt(0));
            f[4] = (body >> 24) & 0xFF; f[5] = (body >> 16) & 0xFF;
            f[6] = (body >>  8) & 0xFF; f[7] =  body        & 0xFF;
            f[8] = 0x00; f[9] = 0x00;
            let o = 10;
            f[o++] = 0x00;
            f.set(mb, o); o += mb.length;
            f[o++] = 0x00;
            f[o++] = 0x03;
            f[o++] = 0x00;
            f.set(img, o);
            return f;
        }

        const frames = [];
        if (meta.title)  frames.push(textFrame('TIT2', meta.title));
        if (meta.artist) frames.push(textFrame('TPE1', meta.artist));
        if (meta.album)  frames.push(textFrame('TALB', meta.album));
        if (coverBuf && coverBuf.byteLength > 0) frames.push(apicFrame(coverBuf));

        const framesSize = frames.reduce((s, f) => s + f.length, 0);
        const tagHdr = new Uint8Array(10);
        tagHdr[0] = 0x49; tagHdr[1] = 0x44; tagHdr[2] = 0x33;
        tagHdr[3] = 0x03; tagHdr[4] = 0x00; tagHdr[5] = 0x00;
        tagHdr[6] = (framesSize >>> 21) & 0x7F; tagHdr[7] = (framesSize >>> 14) & 0x7F;
        tagHdr[8] = (framesSize >>>  7) & 0x7F; tagHdr[9] =  framesSize          & 0x7F;

        const tag = new Uint8Array(10 + framesSize);
        tag.set(tagHdr); let o = 10;
        for (const f of frames) { tag.set(f, o); o += f.length; }

        const audio = new Uint8Array(audioBuf);
        let audioStart = 0;
        if (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
            const s = ((audio[6] & 0x7F) << 21) | ((audio[7] & 0x7F) << 14) |
                      ((audio[8] & 0x7F) <<  7) |  (audio[9] & 0x7F);
            audioStart = 10 + s;
        }

        const result = new Uint8Array(tag.length + audio.length - audioStart);
        result.set(tag);
        result.set(audio.subarray(audioStart), tag.length);
        return result.buffer;
    }

    function writeM4ATags(audioBuf, meta, coverBuf) {
        const view = new DataView(audioBuf);
        const bytes = new Uint8Array(audioBuf);
        let offset = 0;

        let moovOffset = -1, moovSize = 0;
        let mdatOffset = -1;

        while (offset < audioBuf.byteLength) {
            let size = view.getUint32(offset);
            if (size < 8) break;
            let type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);

            if (type === 'moov') { moovOffset = offset; moovSize = size; }
            if (type === 'mdat') { mdatOffset = offset; }

            offset += size;
        }

        if (moovOffset === -1) return audioBuf;

        let stcoOffsets = [];
        let co64Offsets = [];

        function traverse(start, end) {
            let p = start;
            while (p < end) {
                let size = view.getUint32(p);
                if (size < 8) break;
                let type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);

                if (['trak', 'mdia', 'minf', 'stbl'].includes(type)) {
                    traverse(p + 8, p + size);
                } else if (type === 'stco') {
                    let entryCount = view.getUint32(p + 12);
                    let tableOffset = p + 16;
                    for (let i = 0; i < entryCount; i++) stcoOffsets.push(tableOffset + i * 4);
                } else if (type === 'co64') {
                    let entryCount = view.getUint32(p + 12);
                    let tableOffset = p + 16;
                    for (let i = 0; i < entryCount; i++) co64Offsets.push(tableOffset + i * 8);
                }
                p += size;
            }
        }
        traverse(moovOffset + 8, moovOffset + moovSize);

        let oldUdtaOffset = -1;
        let oldUdtaSize = 0;
        let p = moovOffset + 8;
        while (p < moovOffset + moovSize) {
            let size = view.getUint32(p);
            if (size < 8) break;
            let type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
            if (type === 'udta') {
                oldUdtaOffset = p;
                oldUdtaSize = size;
                break;
            }
            p += size;
        }

        function makeBox(type, payload) {
            let size = payload.length + 8;
            let box = new Uint8Array(size);
            let dv = new DataView(box.buffer);
            dv.setUint32(0, size);
            for (let i = 0; i < 4; i++) box[i + 4] = type.charCodeAt(i);
            box.set(payload, 8);
            return box;
        }

        function makeFullBox(type, version, flags, payload) {
            let size = payload.length + 12;
            let box = new Uint8Array(size);
            let dv = new DataView(box.buffer);
            dv.setUint32(0, size);
            for (let i = 0; i < 4; i++) box[i + 4] = type.charCodeAt(i);
            dv.setUint8(8, version);
            dv.setUint8(9, (flags >> 16) & 0xFF);
            dv.setUint8(10, (flags >> 8) & 0xFF);
            dv.setUint8(11, flags & 0xFF);
            box.set(payload, 12);
            return box;
        }

        function makeDataBox(typeCode, data) {
            let payload = new Uint8Array(data.length + 8);
            let dv = new DataView(payload.buffer);
            dv.setUint32(0, typeCode);
            dv.setUint32(4, 0);
            payload.set(data, 8);
            return makeBox('data', payload);
        }

        function makeMetaItem(type, str) {
            return makeBox(type, makeDataBox(1, new TextEncoder().encode(str)));
        }

        let ilstItems = [];
        if (meta.title) ilstItems.push(makeMetaItem('\xA9nam', meta.title));
        if (meta.artist) ilstItems.push(makeMetaItem('\xA9ART', meta.artist));
        if (meta.album) ilstItems.push(makeMetaItem('\xA9alb', meta.album));
        if (coverBuf && coverBuf.byteLength > 0) {
            let cBytes = new Uint8Array(coverBuf);
            let isPng = cBytes[0] === 0x89 && cBytes[1] === 0x50;
            ilstItems.push(makeBox('covr', makeDataBox(isPng ? 14 : 13, cBytes)));
        }

        if (ilstItems.length === 0) return audioBuf;

        let ilstPayloadSize = ilstItems.reduce((acc, b) => acc + b.length, 0);
        let ilstPayload = new Uint8Array(ilstPayloadSize);
        let offsetIlst = 0;
        for (let b of ilstItems) {
            ilstPayload.set(b, offsetIlst);
            offsetIlst += b.length;
        }
        let ilstBox = makeBox('ilst', ilstPayload);

        let hdlrPayload = new Uint8Array(21);
        let hdlrView = new DataView(hdlrPayload.buffer);
        hdlrView.setUint32(0, 0);
        hdlrView.setUint32(4, 0x6d646972);
        hdlrPayload[20] = 0;
        let hdlrBox = makeFullBox('hdlr', 0, 0, hdlrPayload);

        let metaPayload = new Uint8Array(hdlrBox.length + ilstBox.length);
        metaPayload.set(hdlrBox, 0);
        metaPayload.set(ilstBox, hdlrBox.length);
        let metaBox = makeFullBox('meta', 0, 0, metaPayload);

        let udtaPayload = new Uint8Array(metaBox.length);
        udtaPayload.set(metaBox, 0);
        let newUdtaBox = makeBox('udta', udtaPayload);

        let oldUdtaSizeExt = oldUdtaOffset !== -1 ? oldUdtaSize : 0;
        let delta = newUdtaBox.length - oldUdtaSizeExt;

        let out = new Uint8Array(audioBuf.byteLength + delta);

        if (oldUdtaOffset !== -1) {
            out.set(new Uint8Array(audioBuf, 0, oldUdtaOffset), 0);
            out.set(newUdtaBox, oldUdtaOffset);
            out.set(new Uint8Array(audioBuf, oldUdtaOffset + oldUdtaSize), oldUdtaOffset + newUdtaBox.length);
        } else {
            let moovEnd = moovOffset + moovSize;
            out.set(new Uint8Array(audioBuf, 0, moovEnd), 0);
            out.set(newUdtaBox, moovEnd);
            out.set(new Uint8Array(audioBuf, moovEnd), moovEnd + newUdtaBox.length);
        }

        let outView = new DataView(out.buffer);
        outView.setUint32(moovOffset, moovSize + delta);

        if (moovOffset < mdatOffset && delta !== 0) {
            let insertionPoint = oldUdtaOffset !== -1 ? oldUdtaOffset : (moovOffset + moovSize);

            for (let off of stcoOffsets) {
                let newOff = off < insertionPoint ? off : off + delta;
                let val = outView.getUint32(newOff);
                outView.setUint32(newOff, val + delta);
            }
            for (let off of co64Offsets) {
                let newOff = off < insertionPoint ? off : off + delta;
                let valHi = outView.getUint32(newOff);
                let valLo = outView.getUint32(newOff + 4);
                let val = (BigInt(valHi) << 32n) | BigInt(valLo);
                val = val + BigInt(delta);
                outView.setUint32(newOff, Number(val >> 32n));
                outView.setUint32(newOff + 4, Number(val & 0xFFFFFFFFn));
            }
        }

        return out.buffer;
    }

    function downloadBlob(buf, filename, mime) {
        const blob = new Blob([buf], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }

    function downloadFile(url, filename, onProgress) {
        return new Promise((resolve, reject) => {
            const req = GM_xmlhttpRequest({
                method: "GET",
                url,
                responseType: "arraybuffer",
                headers: { "Referer": "https://music.yandex.ru/" },
                timeout: 120000,
                onprogress: (e) => {
                    if (downloadCancelled) {
                        try { req.abort(); } catch(e) {}
                        reject(new Error("Отменено"));
                        return;
                    }
                    if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total * 100, e.loaded, e.total);
                },
                ontimeout: () => reject(new Error("Превышено время ожидания CDN")),
                onload: (res) => {
                    if (res.status !== 200) { reject(new Error(`CDN HTTP ${res.status}`)); return; }
                    const buf = res.response;
                    if (!buf || buf.byteLength === 0) { reject(new Error("Пустой ответ от CDN")); return; }

                    const view = new Uint8Array(buf.slice(0, 12));
                    let mime = 'audio/mp4';

                    if (view[0]===0x66&&view[1]===0x4C&&view[2]===0x61&&view[3]===0x43) {
                        mime = 'audio/flac';
                    } else if (view[0]===0x49&&view[1]===0x44&&view[2]===0x33) {
                        mime = 'audio/mpeg';
                    } else if (view[0]===0xFF&&(view[1]&0xE0)===0xE0) {
                        mime = 'audio/mpeg';
                    } else if (view[0]===0x4F&&view[1]===0x67&&view[2]===0x67&&view[3]===0x53) {
                        mime = 'audio/ogg';
                    }

                    downloadBlob(buf, filename, mime);
                    resolve();
                },
                onerror: () => reject(new Error("Ошибка загрузки с CDN"))
            });
        });
    }

    function gmFetchBinary(url, headers = {}, timeout = 30000) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url, headers,
                responseType: "arraybuffer",
                timeout,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res);
                    else reject(new Error(`HTTP ${res.status}`));
                },
                ontimeout: () => reject(new Error("Превышено время ожидания")),
                onerror: () => reject(new Error("Сетевая ошибка"))
            });
        });
    }

    async function downloadCoverFile(url, filename) {
        try {
            const res = await gmFetchBinary(url);
            const buf = res.response;
            if (!buf || buf.byteLength === 0) return;
            const { mime, ext } = guessCoverMime(buf);
            downloadBlob(buf, filename + '.' + ext, mime);
        } catch(e) {
            console.error('[YMD] Cover error', e, url);
        }
    }

    function getCoverUrl(track) {
        const uri = track.coverUri || track.albums?.[0]?.coverUri;
        if (!uri) return null;
        const normalized = uri.replace('%%', '1000x1000');
        if (/^https?:\/\//i.test(normalized)) return normalized;
        return 'https://' + normalized;
    }

    let downloading = false;
    let downloadCancelled = false;

    async function startDownload(btn, singleTrackId) {
        if (downloading) return;
        downloading = true;
        downloadCancelled = false;
        const origHTML = btn.innerHTML;

        try {
            const choice = await showQualityPicker();
            if (!choice) { downloading = false; return; }
            const { quality: qualityOption, downloadCovers } = choice;

            status("Проверка авторизации...");
            const auth = await checkAuth();

            if (!auth.ok) {
                let dbg = [];
                try { dbg.push('fetch: ' + (typeof unsafeWindow.fetch)); } catch(e) {}
                try { dbg.push('XHR перехват: ок'); } catch(e) {}
                try {
                    const lsKeys = [];
                    for (let i = 0; i < localStorage.length; i++) lsKeys.push(localStorage.key(i));
                    dbg.push('localStorage ключи: ' + lsKeys.slice(0, 8).join(', '));
                } catch(e) { dbg.push('localStorage: нет доступа'); }
                try {
                    const globals = ['Ya','__YA__','__store__','__redux_store__','__initialData__','__STATE__','externalAPI']
                        .filter(k => !!unsafeWindow[k]);
                    dbg.push('globals: ' + (globals.join(', ') || 'не найдены'));
                } catch(e) {}
                console.warn('[YMD] Диагностика:', dbg);

                panel.style.display = 'block';
                panel.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong style="color:#ff5555">Загрузчик Музыки</strong>
                        <span id="ymd-close" title="Закрыть" style="cursor:pointer;font-size:18px;color:#aaa;padding:0 4px;user-select:none;"
                            onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
                    </div>
                    <div style="font-size:13px;line-height:1.5;">
                        ⚠️ Токен не найден.<br>
                        <b style="color:#ffff00">Что делать:</b><br>
                        1. Включите любой трек — токен подхватится автоматически<br>
                        2. Или введите вручную через меню Tampermonkey → ⚙️ Настроить токен<br>
                        <span style="color:#666;font-size:11px;">${dbg.join(' | ')}</span>
                    </div>
                    <div style="margin-top:10px;">
                        <button onclick="document.getElementById('ymd-panel').style.display='none'"
                            style="background:#333;color:#fff;border:none;border-radius:5px;padding:4px 12px;cursor:pointer;font-size:13px;">
                            Закрыть
                        </button>
                    </div>
                `;
                panel.querySelector('#ymd-close')?.addEventListener('click', () => panel.style.display = 'none');
                throw new Error("Отмена");
            } else {
                status(`✓ ${auth.login}${auth.plus ? " (Плюс)" : ""}`);
                await sleep(600);
            }

            let ids = [];

            if (singleTrackId) {
                ids = [String(singleTrackId)];
            } else {
                status("Поиск треков...");
                btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} Поиск...</span>`;

                const page = getPageType();

                if (page.type === "playlist" && page.id) {
                    status("Загрузка плейлиста...");
                    ids = await getPlaylistIds(page.id);
                } else if (page.type === "album" && page.id) {
                    status("Загрузка альбома...");
                    ids = await getAlbumIds(page.id);
                } else if (page.type === "artist" && page.id) {
                    status("Загрузка треков артиста...");
                    ids = await getArtistTrackIds(page.id);
                } else if (page.type === "track" && page.id) {
                    ids = [page.id];
                } else {
                    ids = parseSnapshotIds();
                }
            }

            if (!ids.length) throw new Error("Треки не найдены.");

            const meta = [];
            for (let i = 0; i < ids.length; i += 50) {
                status(`Информация: ${Math.round(i / ids.length * 100)}%`);
                meta.push(...await getTracksInfo(ids.slice(i, i + 50)));
                await sleep(300);
            }

            let ok = 0, skip = 0, fail = 0;

            for (let i = 0; i < meta.length; i++) {
                const t = meta[i];
                if (!t || t.available === false || t.error) { skip++; continue; }

                const name = sanitize(`${(t.artists || []).map(a => a.name).join(", ") || "Unknown"} - ${t.title || "Unknown"}`);

                if (downloadCancelled) break;
                statusWithProgress(name, i + 1, meta.length);
                if (!singleTrackId && btn && document.body.contains(btn)) {
                    btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} ${i + 1}/${meta.length}</span>`;
                }

                try {
                    const info = await getTrackDownloadUrl(t.id, qualityOption);

                    const url = info.url || info.urls?.[0];
                    if (!url) throw new Error("Нет ссылки");

                    if (info.quality === "preview") {
                        status(`⚠️ Превью: ${name}<br><small>Нужен Плюс или трек недоступен</small>`, true);
                        skip++;
                        await sleep(1500);
                        continue;
                    }

                    statusWithProgress(name, i + 1, meta.length, info);
                    const ext = getExt(info.codec);
                    
                    const isMP3 = info.codec === 'mp3';
                    const isM4A = ext === 'm4a' || info.codec.includes('mp4') || info.codec.includes('aac');

                    if ((isMP3 || isM4A) && downloadCovers) {
                        const audioBuf = await new Promise((res, rej) => {
                            const req = GM_xmlhttpRequest({
                                method: "GET", url,
                                responseType: "arraybuffer",
                                headers: { "Referer": "https://music.yandex.ru/" },
                                timeout: 120000,
                                onprogress: (e) => {
                                    if (downloadCancelled) { try { req.abort(); } catch(_) {} rej(new Error("Отменено")); return; }
                                    if (e.lengthComputable) setProgress(e.loaded / e.total * 100, e.loaded, e.total);
                                },
                                ontimeout: () => rej(new Error("Превышено время ожидания CDN")),
                                onload:    (r) => r.status === 200 ? res(r.response) : rej(new Error(`CDN HTTP ${r.status}`)),
                                onerror:   ()  => rej(new Error("Ошибка загрузки с CDN")),
                            });
                        });
                        if (!audioBuf || audioBuf.byteLength === 0) throw new Error("Пустой ответ от CDN");

                        const trackMeta = {
                            title:  t.title || name,
                            artist: (t.artists || []).map(a => a.name).join(', ') || 'Unknown',
                            album:  t.albums?.[0]?.title || t.title || name,
                        };

                        let coverBuf = null;
                        try {
                            const coverUrl = getCoverUrl(t);
                            if (coverUrl) {
                                const r = await gmFetchBinary(coverUrl);
                                if (r.status === 200) coverBuf = r.response;
                            }
                        } catch(_) {}

                        let taggedBuf;
                        let mimeType;
                        
                        if (isMP3) {
                            taggedBuf = writeID3v2(audioBuf, trackMeta, coverBuf);
                            mimeType = 'audio/mpeg';
                        } else {
                            taggedBuf = writeM4ATags(audioBuf, trackMeta, coverBuf);
                            mimeType = 'audio/mp4';
                        }

                        downloadBlob(taggedBuf, `${name}.${ext}`, mimeType);
                    } else {
                        await downloadFile(url, `${name}.${ext}`, (pct, loaded, total) => setProgress(pct, loaded, total));

                        if (downloadCovers) {
                            const coverUrl = getCoverUrl(t);
                            if (coverUrl) {
                                await downloadCoverFile(coverUrl, name);
                                await sleep(200);
                            }
                        }
                    }

                    ok++;
                } catch (e) {
                    console.error(`[YMD] ✗ ${name}:`, e);
                    status(`Ошибка: ${name}<br>${e.message}`, true);
                    fail++;
                    await sleep(1500);
                }

                if (downloadCancelled) break;
                await sleep(600);
            }

            let s = "";
            if (downloadCancelled) s += `<b style="color:#ff9800">Отменено</b><br>`;
            if (ok) s += `<b style="color:#00e676">Скачано: ${ok}</b><br>`;
            if (skip) s += `<b style="color:#ff9800">Пропущено: ${skip}</b><br>`;
            if (fail) s += `<b style="color:#ff5555">Ошибок: ${fail}</b>`;
            status(s || "Готово!");
            if (!singleTrackId && btn && document.body.contains(btn)) {
                btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} Готово</span>`;
            }
            hideStatus(6000);
            setTimeout(() => { if (btn && document.body.contains(btn)) btn.innerHTML = origHTML; }, 5000);

        } catch (e) {
            console.error("[YMD] Fatal:", e);
            status(e.message, true);
            if (btn && document.body.contains(btn)) btn.innerHTML = origHTML;
            hideStatus(8000);
        } finally {
            downloading = false;
        }
    }

    function inject() {
        function makeDownloadBtn(playBtn, onclick) {
            const btn = document.createElement('button');
            btn.className = playBtn.className;
            btn.classList.add('ymd-dl-all-btn');
            btn.setAttribute('type', 'button');
            btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF ymd-btn-label">${iconSvg} Скачать всё</span>` +
                            `<span class="ymd-btn-icon" aria-hidden="true">${iconSvg}</span>`;
            btn.onclick = onclick;
            return btn;
        }

        const playlistControls = document.querySelector('.PageHeaderPlaylist_mainControls__k_S_i');
        if (playlistControls && !playlistControls.classList.contains('ymd-done')) {
            playlistControls.classList.add('ymd-done');
            const playBtn = playlistControls.querySelector('.CommonPageHeader_playControl__gYOuR');
            if (playBtn) {
                const btn = makeDownloadBtn(playBtn, () => startDownload(btn));
                playBtn.insertAdjacentElement('afterend', btn);
            }
        }

        const artistControls = document.querySelector('.PageHeaderArtist_controls__U_6g7:not(.ymd-done)');
        if (artistControls) {
            artistControls.classList.add('ymd-done');
            const playBtn = artistControls.querySelector('.PageHeaderArtist_playControl__N_3l_');
            if (playBtn) {
                const btn = makeDownloadBtn(playBtn, () => startDownload(btn));
                btn.classList.remove('PageHeaderArtist_playControl__N_3l_');
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'display:flex;gap:var(--ym-spacer-size-m);align-items:center;grid-area:play;flex-wrap:wrap;';
                playBtn.parentNode.insertBefore(wrapper, playBtn);
                wrapper.appendChild(playBtn);
                wrapper.appendChild(btn);
            }
        }

        const albumControls = document.querySelector('.CommonPageHeader_controls__c27E_:not(.ymd-done)');
        if (albumControls && window.location.pathname.match(/\/album\/\d+/)) {
            albumControls.classList.add('ymd-done');
            const playBtn = albumControls.querySelector('.CommonPageHeader_playControl__gYOuR');
            if (playBtn) {
                const btn = makeDownloadBtn(playBtn, () => startDownload(btn));
                playBtn.insertAdjacentElement('afterend', btn);
            }
        }

        const bar = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_meta__FhKTC:not(.ymd-done)');
        if (bar) {
            bar.classList.add('ymd-done');
            const tb = bar.querySelector('button');
            if (!tb) return;

            const btn = tb.cloneNode(true);
            btn.removeAttribute('disabled');
            btn.title = 'Скачать текущий трек';
            btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${downloadSmallSvgIcon}</span>`;

            btn.addEventListener('mouseover', () => { btn.style.color = '#e6e6e6'; });
            btn.addEventListener('mouseout', () => { btn.style.color = ''; });

            btn.onclick = () => {
                const info = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_');
                const link = info?.querySelector('a[href*="/track/"]');
                if (link) {
                    const m = link.href.match(/track\/(\d+)/);
                    if (m) { startDownload(btn, m[1]); return; }
                }
                try {
                    const s = unsafeWindow.__STATE_SNAPSHOT__;
                    const arr = Array.isArray(s) ? s : [s];
                    for (const snap of arr) {
                        const id = snap?.sonataState?.entityMeta?.id;
                        if (id) { startDownload(btn, String(id)); return; }
                    }
                } catch(e) {}
                alert("Сначала включите трек");
            };

            bar.insertBefore(btn, bar.firstChild);
        }

        const vibeProgress = document.querySelector('.VibePlayerBar_progress__Cri6E');
        if (vibeProgress && !vibeProgress.querySelector('button[aria-label="Скачать текущий трек"]')) {

            const likeBtn = Array.from(vibeProgress.children).find(
                el => el.tagName === 'BUTTON' && el.getAttribute('aria-label') === 'Нравится'
            );
            if (likeBtn) {
                const vibeBtn = likeBtn.cloneNode(false);
                vibeBtn.removeAttribute('disabled');
                vibeBtn.removeAttribute('aria-pressed');
                vibeBtn.removeAttribute('aria-label');
                vibeBtn.setAttribute('aria-label', 'Скачать текущий трек');
                vibeBtn.title = 'Скачать трек';
                vibeBtn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${downloadSmallSvgIcon}</span>`;

                vibeBtn.addEventListener('click', async () => {
                    const nameEl = document.querySelector('.VibePlayerbarMeta_trackNameText__9IgY2');
                    const artistEl = document.querySelector('.VibePlayerbarMeta_artistText__QHRmU, [class*="VibePlayerbarMeta_artistText"]');
                    const trackName = nameEl ? (nameEl.textContent || '').trim() : '';
                    const artistName = artistEl ? (artistEl.textContent || '').trim() : '';
                    if (!trackName) { alert('Сначала включите трек в Моей волне'); return; }

                    status(`Поиск трека: ${trackName}...`);
                    try {
                        const token = getOAuthToken();
                        const headers = {
                            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
                            "X-Yandex-Music-Frontend": "new",
                            "X-Yandex-Music-Without-Invocation-Info": "1",
                        };
                        if (token) headers["Authorization"] = token;

                        const query = artistName ? `${artistName} ${trackName}` : trackName;
                        const searchUrl = `${API_BASE}/search?text=${encodeURIComponent(query)}&type=track&page=0&pageSize=5`;
                        const data = await gmJSON(searchUrl, headers);
                        const tracks = data?.tracks?.results;
                        if (!tracks || !tracks.length) {
                            status(`Трек не найден в поиске: ${trackName}`, true);
                            hideStatus(6000);
                            return;
                        }
                        const best = tracks.find(tr =>
                            tr.title?.toLowerCase() === trackName.toLowerCase() &&
                            (!artistName || (tr.artists || []).some(a => a.name?.toLowerCase().includes(artistName.toLowerCase())))
                        ) || tracks[0];
                        const trackId = String(best.id);
                        startDownload(vibeBtn, trackId);
                    } catch(e) {
                        status(`Ошибка поиска: ${e.message}`, true);
                        hideStatus(6000);
                    }
                });

                likeBtn.parentNode.insertBefore(vibeBtn, likeBtn);
            }
        }

        const contextMenus = document.querySelectorAll('div[role="menu"]:not(.ymd-done-menu)');
        contextMenus.forEach(menu => {
            menu.classList.add('ymd-done-menu');

            const innerContainer = menu.querySelector('div') || menu;

            const sampleBtn = innerContainer.querySelector('button[role="menuitem"], button[role="menuitemcheckbox"]');
            if (!sampleBtn) return;

            const hasVibeByTrack = Array.from(innerContainer.querySelectorAll('button[role="menuitem"], button[role="menuitemcheckbox"]'))
                .some(b => (b.textContent || '').includes('волна по треку'));
            if (!hasVibeByTrack) return;

            const btn = document.createElement('button');
            btn.className = sampleBtn.className;
            btn.setAttribute('type', 'button');
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('tabindex', '-1');

            btn.innerHTML = `
                <span class="JjlbHZ4FaP9EAcR_1DxF">
                    <svg class="J9wTKytjOWG73QMoN5WP elJfazUBui03YWZgHCbW vqAVPWFJlhAOleK_SLk4 l3tE1hAMmBj2aoPPwU08" focusable="false" aria-hidden="true">
                        <use xlink:href="/icons/sprite.svg#download_xxs"></use>
                    </svg>Скачать трек
                </span>
            `;

            btn.onclick = async (e) => {
                e.stopPropagation();
                let trackId = null;

                const sourceId = menu.getAttribute('aria-labelledby');
                const sourceBtn = sourceId ? document.getElementById(sourceId) : null;
                const isVibeMenu = sourceBtn
                    ? sourceBtn.closest('.VibePlayerBar_progress__Cri6E') !== null
                    : !!document.querySelector('.VibePlayerBar_progress__Cri6E');

                if (isVibeMenu) {
                    document.body.click();
                    const nameEl = document.querySelector('.VibePlayerbarMeta_trackNameText__9IgY2');
                    const artistEl = document.querySelector('.VibePlayerbarMeta_artistText__QHRmU, [class*="VibePlayerbarMeta_artistText"]');
                    const trackName = nameEl ? (nameEl.textContent || '').trim() : '';
                    const artistName = artistEl ? (artistEl.textContent || '').trim() : '';
                    if (!trackName) { alert('Сначала включите трек в Моей волне'); return; }
                    status(`Поиск трека: ${trackName}...`);
                    try {
                        const token = getOAuthToken();
                        const headers = {
                            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
                            "X-Yandex-Music-Frontend": "new",
                            "X-Yandex-Music-Without-Invocation-Info": "1",
                        };
                        if (token) headers["Authorization"] = token;
                        const query = artistName ? `${artistName} ${trackName}` : trackName;
                        const searchUrl = `${API_BASE}/search?text=${encodeURIComponent(query)}&type=track&page=0&pageSize=5`;
                        const data = await gmJSON(searchUrl, headers);
                        const tracks = data?.tracks?.results;
                        if (!tracks || !tracks.length) {
                            status(`Трек не найден в поиске: ${trackName}`, true);
                            hideStatus(6000);
                            return;
                        }
                        const best = tracks.find(tr =>
                            tr.title?.toLowerCase() === trackName.toLowerCase() &&
                            (!artistName || (tr.artists || []).some(a => a.name?.toLowerCase().includes(artistName.toLowerCase())))
                        ) || tracks[0];
                        startDownload(btn, String(best.id));
                    } catch(err) {
                        status(`Ошибка поиска: ${err.message}`, true);
                        hideStatus(6000);
                    }
                    return;
                }

                if (sourceBtn) {
                    const trackRow = sourceBtn.closest('[data-index], .CommonTrack_root__i6shE, .TrackPlaylist_trackWithDots__EU6LD');
                    if (trackRow) {
                        const link = trackRow.querySelector('a[href*="/track/"]');
                        if (link) {
                            const m = link.href.match(/track\/(\d+)/);
                            if (m) trackId = m[1];
                        }
                    }
                }

                if (!trackId) {
                    const info = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_');
                    const link = info?.querySelector('a[href*="/track/"]');
                    if (link) {
                        const m = link.href.match(/track\/(\d+)/);
                        if (m) trackId = m[1];
                    }
                }

                if (trackId) {
                    document.body.click();
                    startDownload(btn, trackId);
                } else {
                    alert("Не удалось определить ID трека");
                }
            };

            let vibeBtn = null;
            innerContainer.querySelectorAll('use').forEach(use => {
                const href = use.getAttribute('href') || use.getAttribute('xlink:href');
                if (href && href.includes('#vibe_')) {
                    vibeBtn = use.closest('button');
                }
            });

            if (vibeBtn) {
                vibeBtn.after(btn);
            } else {
                innerContainer.appendChild(btn);
            }
        });
    }

    const _previewCache = new Map();
    const _nativeFetch = unsafeWindow.fetch.bind(unsafeWindow);

    async function _getFullTrackInfo(trackId, quality) {
        const cacheKey = `${trackId}:${quality}`;
        if (_previewCache.has(cacheKey)) return _previewCache.get(cacheKey);

        const token = getOAuthToken();
        if (!token) return null;

        const ts        = Math.floor(Date.now() / 1000);
        const codecs    = ['flac', 'aac', 'he-aac', 'mp3', 'flac-mp4', 'aac-mp4', 'he-aac-mp4'];
        const transport = 'encraw';
        const sign      = await getSign(SECRET_KEY, `${ts}${trackId}${quality}${codecs.join('')}${transport}`);
        const url       = `${API_BASE}/get-file-info?ts=${ts}&trackId=${trackId}&quality=${quality}` +
                          `&codecs=${encodeURIComponent(codecs.join(','))}` +
                          `&transports=${transport}&sign=${encodeURIComponent(sign)}`;
        const headers   = {
            'Authorization':                           token,
            'X-Yandex-Music-Client':                  'YandexMusicDesktopAppWindows/' + getVersion(),
            'X-Yandex-Music-Frontend':                'new',
            'X-Yandex-Music-Without-Invocation-Info': '1',
        };

        for (let i = 0; i < 10; i++) {
            try {
                const data = await gmJSON(url, headers);
                if (!data?.downloadInfo) throw new Error('no downloadInfo');
                if (String(data.downloadInfo.trackId) !== String(trackId)) { await sleep(150); continue; }
                if (data.downloadInfo.quality === 'preview') return null;
                _previewCache.set(cacheKey, data.downloadInfo);
                return data.downloadInfo;
            } catch (e) {
                if (i < 9) await sleep(300);
            }
        }
        return null;
    }

    unsafeWindow.fetch = async function (...args) {
        const [resource, init] = args;
        const url = typeof resource === 'string' ? resource : resource?.url || '';

        try {
            const h    = init && init.headers;
            let   auth = null;
            if (h && h.get) auth = h.get('Authorization');
            else if (h) auth = h['Authorization'] || h['authorization'];
            if (auth && /^OAuth\s+/.test(auth)) {
                const t = auth.replace(/^OAuth\s+/, '');
                if (t !== GM_getValue('ymd_oauth_token', null)) GM_setValue('ymd_oauth_token', t);
            }
        } catch (e) {}

        if (!url.includes('/get-file-info')) return _nativeFetch(...args);

        const params  = new URLSearchParams(url.split('?')[1] || '');
        const trackId = params.get('trackId') || (params.get('trackIds') || '').split(',')[0];
        const quality = params.get('quality') || 'nq';

        const res  = await _nativeFetch(...args);
        const data = await res.clone().json().catch(() => null);
        if (!data) return res;

        const info         = data?.downloadInfo;
        const needsReplace = !info ||
                             String(info.trackId) !== String(trackId) ||
                             info.quality === 'preview';

        if (trackId && needsReplace) {
            console.log(`[YMD] превью для трека ${trackId}, запрашиваем полный...`);
            const full = await _getFullTrackInfo(trackId, quality === 'preview' ? 'hq' : quality);
            if (full) {
                console.log(`[YMD] подменили на ${full.codec}/${full.quality}`);
                return new unsafeWindow.Response(
                    JSON.stringify({ downloadInfo: full }),
                    { headers: { 'Content-Type': 'application/json' } }
                );
            }
        }
        return new unsafeWindow.Response(
            JSON.stringify(data),
            { headers: { 'Content-Type': 'application/json' } }
        );
    };

    function startObserver() {
        if (document.body) {
            if (!document.getElementById('ymd-panel')) document.body.appendChild(panel);
            inject();
            let injectTimer = null;
            const obs = new MutationObserver(() => {
                clearTimeout(injectTimer);
                injectTimer = setTimeout(inject, 150);
            });
            obs.observe(document.body, { childList: true, subtree: true });
            if (!GM_getValue('ymd_oauth_token', null)) setTimeout(showAuthBanner, 1500);
        } else {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
        }
    }
    startObserver();

})();
