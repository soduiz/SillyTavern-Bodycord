/**
 * judge-hint.js —— 推演失败时，附一句「可能的原因」
 *
 * 为什么单独一个文件（2026-11-14 她拍的）：
 *   推演失败的红弹窗里只有接口原话（一长串 JSON / HTTP 码），玩家看不懂，我们也只能反过来
 *   问"你看到什么了"。她定的口径：**在报错后面补一句可能的原因**，不猜是哪一家的服务。
 *
 * 三条约束（别越界）：
 *   ① 只给**一句话**，红色弹窗会自己消失，长了看不完；完整原文照旧进「上次推演日志」✓
 *   ② **不提第三方 / 中转站 / 代理**（社区禁止那种用法，弹窗里点了等于往那边引）✗
 *   ③ 认不出来就返回空串，宁可不补，也别给一句错的猜测 ✗
 *
 * 判据只看两样东西：错误串（`error`）和回包原文（`raw`）。两样都是现成拿得到的 ✓
 */

/**
 * @param {{error?:string, raw?:string}} info
 * @returns {string} 一句「可能的原因：…」；认不出来返回 ''
 */
export function failureHint(info = {}) {
    const e = String(info.error || '');
    const all = e + '\n' + String(info.raw || '');
    if (!e && !all.trim()) return '';

    // 跨域那条已经有自己那句（api.js 的 CROSS_HINT，含"怎么改"）⇒ 别叠第二句
    if (/跨域|Failed to fetch|NetworkError|Load failed|ERR_NETWORK|ERR_FAILED/i.test(e)) return '';

    // ---- 认得出的那几类：一条一句，顺序从"最确定"到"最宽泛" ----
    // ⚠️ 状态码只认「HTTP 401」这种带前缀的写法：正文里随便一个 401 / 500 的数字
    //   （token 数、模型名）很容易误伤，认错比不认更糟 ✗
    if (/HTTP\s*401\b|HTTP\s*403\b/i.test(e)) {
        return '可能的原因：密钥或权限不对，去看一眼这条接口的密钥。';
    }
    if (/HTTP\s*429\b/i.test(e)) {
        return '可能的原因：被接口限流了，等一会儿再试。';
    }
    if (/HTTP\s*5\d\d\b/i.test(e)) {
        return '可能的原因：接口那边出错了，过一会儿再试。';
    }
    // ★ 有回包、但一个字都没吐出来 —— 她截图那种（choices 空 / 输出 0 token）
    //   放在"不是 JSON"前面：那种回包也不是合法 JSON，但真正的原因在"空"这件事上 ✓
    if (/"choices"\s*:\s*\[\s*\]/.test(all)
        || /没有\s*choices|completion_tokens"\s*:\s*0/.test(all)) {
        return '可能的原因：接口有回复，但一个字都没返回。常见是内容被拦、参数不兼容、上下文太长，或者连接中途断了。';
    }
    if (/invalid[_ ]argument|unrecognized|unknown (request )?argument|unsupported|invalid[_ ]parameter|HTTP\s*400\b/i.test(e)) {
        return '可能的原因：接口不认这次请求里的某一项（最常见是关掉原生思考、强制返回 JSON、长度上限这三样），去设置里关掉试试。';
    }
    if (/超时|请求被中断|timeout/i.test(e)) {
        return '可能的原因：接口太久没回话，或者网络断了。可以稍后再试，或者把超时那格调大。';
    }
    // ★ 返回的不是 JSON（截图里那串 data: {...} 也走这一类，只不过上面"空回包"先接住了 ✓）
    //   ⚠️ 这里按她 2026-11-14 定的措辞：只说现象和下一步，不点第三方 / 中转站 ✗
    if (/<!doctype|<html|不是 JSON/i.test(all)) {
        return '可能的原因：接口返回的不是能识别的格式，像一段报错文字。稍后再试；还不行就看「上次推演日志」里的原文。';
    }
    // 模型回了东西，但不是契约要的 JSON（这句报错自己已经指了「推演日志」⇒ 这里不重复 ✓）
    if (/没有返回预期的 JSON/.test(e)) {
        return '可能的原因：模型这一轮没按格式回（可能被截断，或者答非所问）。再推一次通常就好。';
    }
    return '';
}
