/**
 * tokens.js —— 粗略的 token 估算
 *
 * 不追求精确（那需要真正的 tokenizer），目的只是让你**一眼看出哪条补丁在吃 token**：
 *   · 中日韩汉字、全角标点：约 1 字 = 1 token
 *   · 其它字符（英文、数字、半角标点）：约 3.5 字符 = 1 token
 *
 * 这个比例对绝大多数主流 tokenizer 都差不多，误差通常在 ±15% 以内，
 * 足够用来比较「这条补丁值不值这么多 token」。
 */

/** 估算一段文本的 token 数 */
export function estimateTokens(text) {
    const s = String(text ?? '');
    if (!s) return 0;
    let cjk = 0;
    let other = 0;
    for (const ch of s) {
        const c = ch.codePointAt(0);
        const isWide =
            (c >= 0x2e80 && c <= 0x303f) ||   // 中日韩符号、标点
            (c >= 0x3040 && c <= 0x30ff) ||   // 假名
            (c >= 0x3400 && c <= 0x4dbf) ||   // 扩展 A
            (c >= 0x4e00 && c <= 0x9fff) ||   // 基本汉字
            (c >= 0xf900 && c <= 0xfaff) ||   // 兼容汉字
            (c >= 0xff00 && c <= 0xffef) ||   // 全角形式
            (c >= 0x20000 && c <= 0x3ffff);   // 扩展 B 以上
        if (isWide) cjk++; else other++;
    }
    return Math.round(cjk + other / 3.5);
}

/** 好看一点的显示：1234 → 1,234；12345 → 12.3k */
export function formatTokens(n) {
    const v = Number(n) || 0;
    if (v >= 100000) return Math.round(v / 1000) + 'k';
    if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
    return v.toLocaleString('en-US');
}

/** 按大小给个档位，界面用来上色：ok / warn / heavy */
export function tokenLevel(n) {
    const v = Number(n) || 0;
    if (v >= 4000) return 'heavy';
    if (v >= 1500) return 'warn';
    return 'ok';
}

/** 一组文本的总量 */
export function sumTokens(list) {
    let n = 0;
    for (const t of list) n += estimateTokens(t);
    return n;
}

/** 数字说人话：1234 → 1,234；41234 → 4.1 万；380000 → 38 万 */
export function formatCount(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    if (v >= 10000) {
        const w = (v / 10000).toFixed(1).replace(/\.0$/, '');
        return w + ' 万';
    }
    return v.toLocaleString('en-US');
}

/**
 * 把接口回的那个 usage 说成人话（**只报事实、不带金额**）：
 *   `命中 92%（输入 4.1 万 / 输出 380）`
 *
 * 各家字段名不一样，这里都认：
 *   · 输入 / 输出：`prompt_tokens` / `completion_tokens`（也认 `input_tokens` 那一套）
 *   · 缓存命中：DeepSeek 的 `prompt_cache_hit_tokens`（配 miss 算比例）、
 *     OpenAI 的 `prompt_tokens_details.cached_tokens`、`cache_read_input_tokens`
 * 拿不到就不显示那一段，绝不编数字 ✓
 */
export function formatUsage(usage) {
    if (!usage || typeof usage !== 'object') return '';
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

    const inTok = num(usage.prompt_tokens) ?? num(usage.input_tokens);
    const outTok = num(usage.completion_tokens) ?? num(usage.output_tokens);
    const total = num(usage.total_tokens);
    const hit = num(usage.prompt_cache_hit_tokens)
        ?? num(usage.prompt_tokens_details?.cached_tokens)
        ?? num(usage.cached_tokens)
        ?? num(usage.cache_read_input_tokens);
    const miss = num(usage.prompt_cache_miss_tokens)
        ?? (hit != null && inTok != null ? Math.max(0, inTok - hit) : null);
    // ★ 思考（reasoning）要**单独报**，别混进"输出"里 ——
    //   那行：输出 7,679里有 7,025 是模型的思考，
    //   真正的 JSON 只有 654，看着像"输出太贵了"，其实是它想得太久 ✗
    const reason = num(usage.completion_tokens_details?.reasoning_tokens)
        ?? num(usage.reasoning_tokens)
        ?? num(usage.output_tokens_details?.reasoning_tokens);
    const outMain = (outTok != null && reason != null) ? Math.max(0, outTok - reason) : outTok;

    const parts = [];
    if (hit != null && hit + (miss || 0) > 0) {
        parts.push('命中 ' + Math.round(hit / (hit + (miss || 0)) * 100) + '%');
    }
    const io = [];
    if (inTok != null) io.push('输入 ' + formatCount(inTok));
    if (outMain != null) io.push('输出 ' + formatCount(outMain) + (reason ? ' ＋ 思考 ' + formatCount(reason) : ''));
    if (!io.length && total != null) io.push('共 ' + formatCount(total));
    if (io.length) parts.push('（' + io.join(' / ') + '）');

    return parts.join('');
}
