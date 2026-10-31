/**
 * image.js —— 图片压缩
 *
 * 为什么要有这个：
 *   图标和悬浮球头像都是直接存进插件设置 / localStorage 的（data URL）。
 *   用户随手丢一张手机拍的照片就是好几 MB，存进去会把酒馆的设置文件撑爆。
 *   以前的作法是不让传（「图片请小于 500KB」）—— 那是把麻烦推给用户。
 *   现在改成插件自己压好：缩到够用的尺寸、转 WebP（体积小很多、还支持透明），
 *   用户想传多大的原图都行。
 */

/** 图片在显示时的最大边长（按 2 倍图算，够视网膜屏用） */
export const IMAGE_PRESETS = {
    icon:    { max: 128, quality: 0.92 },   // 面板里的圆形头像 / 侧栏图标（显示 36px）
    avatar:  { max: 256, quality: 0.9 },    // 悬浮球、用户头像（显示 96px 上下）
    large:   { max: 512, quality: 0.88 },   // 需要看清楚细节的
};

/** data URL 的大致字节数（base64 部分 × 3/4） */
export function dataUrlBytes(dataUrl) {
    const s = String(dataUrl || '');
    const i = s.indexOf(',');
    if (i < 0) return 0;
    const b64 = s.slice(i + 1);
    return Math.floor(b64.length * 3 / 4);
}

/** 人类可读的体积 */
export function humanBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/** 把 (w,h) 等比缩进 max×max 之内，且不放大 */
function fitInside(w, h, max) {
    const scale = Math.min(1, max / Math.max(w || 1, h || 1));
    return {
        width: Math.max(1, Math.round((w || 1) * scale)),
        height: Math.max(1, Math.round((h || 1) * scale)),
        scaled: scale < 1,
    };
}

/** 读成 ImageBitmap（拿不到就退回 <img>） */
function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
        return createImageBitmap(file);
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解不开')); };
        img.src = url;
    });
}

/**
 * 压缩一张图片文件，返回 data URL。
 *
 * @param {File|Blob} file
 * @param {object} [opts]
 * @param {'icon'|'avatar'|'large'} [opts.preset]  用哪档尺寸
 * @param {number} [opts.max]    自定义最大边长（覆盖 preset）
 * @param {number} [opts.quality] 0-1
 * @param {boolean} [opts.keepIfSmaller] 原图又小又够小的时候直接留着，不重编码（默认 true）
 * @returns {Promise<{dataUrl:string, width:number, height:number, bytes:number, original:number, compressed:boolean}>}
 */
export async function compressImageFile(file, opts = {}) {
    const preset = IMAGE_PRESETS[opts.preset] || IMAGE_PRESETS.icon;
    const max = Number(opts.max) || preset.max;
    const quality = typeof opts.quality === 'number' ? opts.quality : preset.quality;
    const keepIfSmaller = opts.keepIfSmaller !== false;
    const original = file?.size || 0;

    const bmp = await loadBitmap(file);
    const w = bmp.width || bmp.naturalWidth || 1;
    const h = bmp.height || bmp.naturalHeight || 1;
    const fit = fitInside(w, h, max);

    // 本来就不大、尺寸也够用 —— 别为了压缩反而把它编码大了
    if (keepIfSmaller && !fit.scaled && original > 0 && original <= 60 * 1024) {
        const dataUrl = await blobToDataUrl(file);
        try { bmp.close?.(); } catch { /* 忽略 */ }
        return { dataUrl, width: w, height: h, bytes: dataUrlBytes(dataUrl), original, compressed: false };
    }

    const canvas = document.createElement('canvas');
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('拿不到 canvas 上下文');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, fit.width, fit.height);
    try { bmp.close?.(); } catch { /* 忽略 */ }

    // 优先 WebP：同样画质下体积通常只有 PNG 的 1/3，而且支持透明
    let dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/webp', quality); } catch { dataUrl = ''; }
    if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
        dataUrl = canvas.toDataURL('image/png');
    }

    return {
        dataUrl,
        width: fit.width,
        height: fit.height,
        bytes: dataUrlBytes(dataUrl),
        original,
        compressed: true,
    };
}

/** 把 File/Blob 读成 data URL（不重编码） */
export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('读取失败'));
        r.readAsDataURL(blob);
    });
}

/**
 * 弹一个文件选择框，把**原始 File** 交给回调（不压缩）。
 *
 * 给"要上传到酒馆图片库"的入口用（阶段插图 ✓）：那条路要的是 File，
 * 压缩 + 编码在上传那一步做（见 notes-image.js ✓）。
 */
export function pickImageFile(onPick) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
        const f = input.files?.[0];
        input.remove();
        if (!f) return;
        onPick?.(f);
    });
    document.body.appendChild(input);
    input.click();
}

/**
 * 弹一个文件选择框，选完自动压缩，把结果交给回调。
 * 统一所有上传入口的行为，省得每个地方各写一遍。
 *
 * @param {(result:{dataUrl:string,bytes:number,original:number,compressed:boolean}) => void} onDone
 * @param {object} [opts] 传给 compressImageFile 的选项；另外支持 opts.toast 前缀
 */
export function pickAndCompressImage(onDone, opts = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
        const f = input.files?.[0];
        input.remove();
        if (!f) return;
        try {
            input.disabled = true;
            const res = await compressImageFile(f, opts);
            if (opts.label) {
                const saved = res.original > res.bytes
                    ? `，省了 ${Math.round((1 - res.bytes / res.original) * 100)}%`
                    : '';
                window.toastr?.success?.(
                    `${opts.label}：${humanBytes(res.original)} → ${humanBytes(res.bytes)}（${res.width}×${res.height}）${saved}`);
            }
            onDone?.(res);
        } catch (e) {
            console.warn('[Bodycord] 图片处理失败', e);
            window.toastr?.error?.('这张图片处理不了：' + (e?.message || e));
        }
    });
    document.body.appendChild(input);
    input.click();
}
