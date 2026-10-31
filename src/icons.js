/**
 * icons.js —— 自定义图标的 CSS 生成
 *
 * 这段逻辑本来写在 bodycord.js 的 shim 模板字符串里面 ——
 * 那是个坑：模板字符串里的注释**不能出现反引号**（会直接终止模板），
 * 换行得写成 String.fromCharCode(10)，反斜杠要穿三层转义。
 * 这些坑都踩过（正则被吃掉 / 注释切断 / 反引号终止模板）。
 *
 * 所以搬到这里用**真正的 JS** 写：注释正常写、`\n` 正常用、不用管转义层级。
 * 生成好的 CSS 作为字符串传给 shim，shim 只负责把它塞进 <style>。
 */

/** url("...") 里不能出现引号、括号、反斜杠、换行 —— 出现了就说明这地址不能用 */
const BAD_URL_CHARS = [
    '"', "'", '(', ')',
    String.fromCharCode(92),   // 反斜杠
    String.fromCharCode(10),   // 换行
    String.fromCharCode(13),   // 回车
];

/** 净化图片地址，不能用的返回空串 */
export function safeIconUrl(u) {
    const v = String(u == null ? '' : u).trim();
    if (!v) return '';
    for (const bad of BAD_URL_CHARS) {
        if (v.indexOf(bad) >= 0) {
            console.warn('[Bodycord] 图标地址含不安全字符，已忽略：' + v.slice(0, 60));
            return '';
        }
    }
    return v;
}

/** 侧栏频道的 data-view 只允许纯字母 */
const SAFE_VIEW = /^[A-Za-z]+$/;
/** 面板头像的 key 只允许纯字母 */
const SAFE_KEY = /^[A-Za-z]+$/;

/**
 * 把「图标 key → 图片地址」映射成一段 CSS。
 *
 * 两类槽位写法不同：
 *   · 面板头像（key 如 bot / astro）：图片铺满整个圆形头像，原来的渐变色要一起清掉
 *   · 侧栏频道（key 如 ch:fetus）：**# 号必须保留**（它是频道标记），
 *     图片用 ::before 加在 # 前面 —— 直接把 # 换成图会让这一行跟别的频道不像同类
 *
 * @param {Record<string,string>} map
 * @returns {string} CSS 文本（每行一条规则）
 */
export function buildIconCss(map) {
    const out = [];

    for (const k of Object.keys(map || {})) {
        const url = safeIconUrl(map[k]);
        if (!url) continue;

        if (k.indexOf('ch:') === 0) {
            const view = k.slice(3);
            if (!SAFE_VIEW.test(view)) continue;

            // 面板有两套导航，它们的规矩不一样：
            //
            //   ① .channel-list（展开时的「文字栏」：`# 名称` 一行一行）
            //      这里**不放图** —— 一排 `# 名称` 是干净的、可读的，
            //      往里塞图标会让这一行显得跟其他行不是一类。
            //
            //   ② .channel-icons（收起时的「图标栏」：竖着一条纯图标）
            //      那里本来就是图标位，换成自定义图正合适。
            //
            // ① 里不能加图（加过 ::before，被否掉：文字栏这里不要有图片）。
            out.push(
                '.channel-icon-btn[data-view="' + view + '"]{'
                + 'background:url("' + url + '") center/62% no-repeat !important}',
            );
            out.push('.channel-icon-btn[data-view="' + view + '"] svg{display:none!important}');
            continue;
        }

        if (!SAFE_KEY.test(k)) continue;
        // ⚠️ 这里**不许单开一类槽位**（`tball`，给番茄钟那颗球单独换头像）✗
        //   一句话否掉：番茄钟的悬浮球就该放在"悬浮球头像"那里，没必要单开一类 ✓
        //   ⇒ 那颗球**共用「悬浮球头像」那一张图**（`settings().ui.fabImage`，
        //     由 `ui.js` 的 `applyTimerBall` 自己贴上去 ✓）—— **这里不需要任何特殊处理** ✓
        // 必须用 background **简写** + !important：
        // 面板原来的写法是 .block-avatar.bot{background:linear-gradient(...)}，
        // 只覆盖 background-image 的话那层渐变色还在，透明图会被垫一层底。
        // 简写能一次把 image / color / repeat / position / size 全清掉。
        out.push(
            '.block-avatar.' + k + '{'
            + 'background:url("' + url + '") center/cover no-repeat !important;'
            + 'border:0 !important;box-shadow:none !important}',
        );
        out.push('.block-avatar.' + k + ' svg{display:none!important}');
    }

    return out.join('\n');
}

/** 生成 <style> 标签的 id（shim 与设置页共用同一个名字） */
export const ICON_STYLE_ID = 'bc-icon-overrides';
