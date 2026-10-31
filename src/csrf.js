/**
 * csrf.js —— 给**酒馆后端**发 POST 时带 CSRF 令牌。
 *
 * 酒馆默认开着 CSRF（`src-tauri`/server 那边 `csrfSync`），任何 POST 都得带
 * `X-CSRF-Token`，令牌先 GET `/csrf-token` 拿 ✓（只有开了 `--enableCorsProxy` 时
 * `/proxy/*` 才免）。
 *
 * ★ 两处都要用 ⇒ 抽成一个文件（别各写一份）：
 *   ① 随手记的图片上传（notes-image.js）
 *   ② 推演请求走酒馆后端转发（api.js，用来绕开服务商的跨域限制）
 */

let _csrf = '';

/** 拿 CSRF 令牌（缓存一次；403 时由 postJson 清掉重拿 ✓） */
export async function csrfToken() {
    if (_csrf) return _csrf;
    const r = await fetch('/csrf-token', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('拿不到 CSRF 令牌（HTTP ' + r.status + '）');
    const data = await r.json().catch(() => ({}));
    _csrf = String(data?.token || '');
    if (!_csrf) throw new Error('CSRF 令牌是空的（刷新一下页面再试）');
    return _csrf;
}

/** 令牌过期了 ⇒ 丢掉缓存，下次重新拿 ✓ */
export function forgetCsrf() {
    _csrf = '';
}

/** 带 CSRF 头 POST JSON（返回 Response；调用方自己判状态码 ✓） */
export async function postJson(url, body, opts = {}) {
    const token = await csrfToken();
    const r = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(body || {}),
        signal: opts.signal,
    });
    if (r.status === 403) forgetCsrf();
    return r;
}
