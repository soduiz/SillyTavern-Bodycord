/**
 * notes-image.js —— 随手记的图片：压缩 → 存进酒馆的图片目录 → 返回路径
 *
 * 为什么走酒馆自己的接口（而不是自己写磁盘）：
 *   酒馆扩展是**纯前端**，自己写不了文件 ✗；但酒馆有现成的 `/api/images/upload`：
 *     · 存到 `data/default-user/user/images/`（玩家自己的图片库那个目录 ✓）
 *     · **支持一层子文件夹**（`ch_name`），而且**会自动创建目录** ✓
 *     · 删图用 `/api/images/delete`（只能删图片目录里的 ✓）
 *   ⇒ 于是「全局一份 / 每个聊天一份」各一个文件夹，在资源管理器里能直接翻图 ✓
 *     （小文件夹按"全局一份 / 每个聊天一份"存图时自动创建）
 *
 * ⚠️ 三个已经过酒馆源码验证的坑：
 *   ① 酒馆默认开 CSRF ⇒ POST 必须带 `X-CSRF-Token`（先 GET `/csrf-token` 拿）✓
 *   ② 只支持**一层**子文件夹（文件夹名会被 sanitize 洗掉 `/`）✗ ⇒ 用 `bodycord_xxx` 命名
 *   ③ 删只能删**文件**，没有删文件夹的接口 ⇒ 图删光后会留个空文件夹（只能手删）
 */

import { compressImageFile } from './image.js';
import { postJson } from './csrf.js';

/** 随手记图片的规格：长边 1600 + WebP q0.85（普通截图压完约 100~400KB）✓
 *  ⚠️ 「一条最多几张」只写在面板那一处（`NOTES_IMG_LIMIT`）—— 两处都写会漂 ✗ */
export const NOTES_IMAGE = { max: 1600, quality: 0.85 };

/** 文件夹名的安全化：只留字母数字下划线连字符和中文，最长 40 字（再长酒馆也会 sanitize） */
export function safeFolderPart(s) {
    const t = String(s || '')
        .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');
    return t.slice(0, 40);
}

/** 这一「份」（全局 / 某个聊天）对应的文件夹名：一层，带统一前缀，好认也好找 ✓ */
export function notesFolderName(scopeId) {
    const part = safeFolderPart(scopeId);
    return 'bodycord_' + (part || 'global');
}

/**
 * 带上我们自己的错误口径（CSRF 被挡 / HTTP 非 2xx 抛错，方便调用方 catch ✓）。
 * ★ CSRF 的取令牌与 403 清缓存都搬去 `csrf.js` 了（推演走酒馆后端也要用同一套 ✓）
 */
async function postJsonStrict(url, body) {
    const r = await postJson(url, body);
    if (r.status === 403) throw new Error('被 CSRF 挡下了（刷新页面再试一次）');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
}

/** 接口返回的是「相对根目录的路径」⇒ 补上前导 `/` 就能直接当 img src 用 ✓ */
export function tavernUrl(path) {
    const p = String(path || '');
    if (!p) return '';
    return p.startsWith('/') ? p : '/' + p;
}

/**
 * 通用：把一张图**压缩 + 上传**到酒馆图片库的某个文件夹，返回它的地址。
 *
 * 随手记和「阶段插图」都走它（阶段插图只存地址、不存 base64 ✓）——
 * CSRF / 只支持一层子文件夹 / 上传返回相对路径这三个坑只在这里处理一次 ✓
 *
 * @param {File|Blob} file
 * @param {string} folder 子文件夹名（**一层**，自己带前缀 ✓）
 * @param {object} [opts] { max, quality, prefix }
 */
export async function uploadImageFile(file, folder, opts = {}) {
    const res = await compressImageFile(file, {
        max: Number(opts.max) || NOTES_IMAGE.max,
        quality: typeof opts.quality === 'number' ? opts.quality : NOTES_IMAGE.quality,
    });
    const m = String(res.dataUrl || '').match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!m) throw new Error('压缩后的图片格式不认');
    const format = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const base64 = m[2];
    // 文件名只用时间戳 + 随机尾巴（避免同名覆盖；酒馆那头还会再 sanitize 一次 ✓）
    const prefix = safeFolderPart(opts.prefix || 'img') || 'img';
    const filename = prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const r = await postJsonStrict('/api/images/upload', {
        image: base64,
        format,
        filename,
        ch_name: String(folder || 'bodycord_global'),
    });
    const data = await r.json().catch(() => ({}));
    const path = String(data?.path || '');
    if (!path) throw new Error('上传成功但没拿到路径');
    return {
        path,
        url: tavernUrl(path),
        bytes: res.bytes,
        width: res.width,
        height: res.height,
        original: res.original,
    };
}

/** 阶段插图的图传到这个文件夹（跟随手记的分开，方便在资源管理器里找 ✓） */
export function saveStageImage(file) {
    return uploadImageFile(file, 'bodycord_stages', { prefix: 'stage' });
}

/**
 * 压缩 + 上传一张图。
 * @param {File|Blob} file
 * @param {string} scopeId 'global' 或聊天 id（决定落到哪个文件夹）
 * @returns {Promise<{path:string,url:string,bytes:number,width:number,height:number,original:number}>}
 */
export async function saveNotesImage(file, scopeId) {
    return uploadImageFile(file, notesFolderName(scopeId), { prefix: 'note' });
}

/** 删一张图（路径必须在酒馆图片目录里，接口自己会校验 ✓）*/
export async function deleteNotesImage(path) {
    if (!path) return false;
    try {
        await postJsonStrict('/api/images/delete', { path });
        return true;
    } catch (e) {
        console.warn('[Bodycord] 删图失败（会留个孤儿文件）', e);
        return false;
    }
}

/** 一次删多张（删笔记时用）—— 逐张删，失败不打断 */
export async function deleteNotesImages(paths) {
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
    let ok = 0;
    for (const p of list) {
        if (await deleteNotesImage(p)) ok++;
    }
    return { total: list.length, ok };
}
