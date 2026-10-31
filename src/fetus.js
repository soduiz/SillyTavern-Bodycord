/**
 * fetus.js —— 「胎儿状态」（d6）的结构化读写
 *
 * d6 的原文长这样：
 *   双胎 · 孕10周，均心跳有力；子1：狼人 男（致孕方：阿杰，显性：银发褐瞳，隐性携带：人类血统）；子2：人类 女（致孕方：阿明）
 *
 * 拆成
 *   head = 双胎 · 孕10周，均心跳有力
 *   kids = [{ race:'狼人', sex:'男', impregnator:'阿杰', extra:'显性：银发褐瞳，隐性携带：人类血统' }, …]
 *
 * 这样界面上就能像敏感带那样一行一个孩子地改，致孕方也跟着绑在每一行上。
 * 写回去时严格保持原格式，免得推演引擎下次读不懂。
 */

/**
 * ★ 2026-10-29：概述里那个「孕 11-14 周」的表头要拿掉。
 *
 * 它来自孕周表每一行的表头（`孕 11-14 周：性别分化…`）—— 推演「照原句抄一句」时
 * 整行抄进来，于是概述里多出一个区间，跟上面那行「孕 14 周+0 天」看着像在打架 ✗
 * （她 2026-10-29 截图问的就是这个）
 *
 * ⚠️ 这不是"过滤数据"：表头是**孕周那一档的标签**，跟孕周是同一个事实，
 *   概述只该写「这一胎现在是什么」。**存档里的原文不动**（只在读出来拼展示时去掉 ✓）
 */
const WEEK_BAND_RE = /孕\s*\d+\s*[-~～—到至]\s*\d+\s*周\s*[：:,，、]?\s*/g;
/** 去掉「孕 X-Y 周」这个表头（只认区间写法；单说「孕10周」那种老写法不动 ✓） */
export function stripWeekBand(s) {
    return String(s ?? '').replace(WEEK_BAND_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/** 把 d6 拆成「概述 + 每个孩子」 */
export function parseFetus(raw) {
    const s = String(raw ?? '').trim();
    if (!s || s === '无' || s === '未加载') return { head: s === '无' ? '' : s, kids: [] };

    // 用「子N：」切开
    // ⚠️ 分隔符要连**逗号**一起认 —— 插件自己的文案里就写着
    //   「子1：狼人 男（致孕方：阿杰，显性：…），子2：人类 女（致孕方：阿明）」（modules.js 的 d6 示例）
    //   只认「；」的话整串会被当成一个孩子，子2 的种族/性别/致孕方全被吞进子1 的备注，
    //   而界面上动一下就把它写回 d6 ⇒ 真丢数据 ✗
    const parts = s.split(/[；;，,]\s*(?=子\s*\d+\s*[:：])/);
    const head = /^子\s*\d+\s*[:：]/.test(parts[0]) ? '' : stripWeekBand(parts[0].trim());

    const kids = [];
    for (const p of parts) {
        // 锚上 ^，免得同一块里再被后面那个「子N：」截胡
        const m = p.match(/^\s*子\s*\d+\s*[:：]\s*([\s\S]*)$/);
        if (!m) continue;
        let body = m[1].trim();

        // 括号里是「致孕方：xxx」以及可选的显性/隐性
        let impregnator = '';
        let gest = '';
        let due = '';
        let extra = '';
        let talent = '';
        let strength = '';
        const paren = body.match(/[（(]([\s\S]*)[）)]\s*$/);
        if (paren) {
            const inner0 = paren[1];
            // ★ 2026-10-24：「天赋」是一整句话（句子里本来就带逗号）——
            //   只能靠「下一个键名」划界，按逗号切只会留下前半句 ✗
            //   ⚠️「强度」也是一个键：天赋那句到它为止 ✓
            const tal = inner0.match(/[，,；;、｜|]?\s*天赋\s*[:：]\s*([\s\S]*?)(?=\s*(?:[，,；;、｜|]\s*)?(?:强度|致孕方|受孕方|孕期|预产期|显性|隐性携带|隐性)\s*[：:]|$)/);
            if (tal) talent = tal[1].trim();
            // ⚠️ 2026-10-24（她的判断）：天赋那句里的来源词 / 程度词**不在这里剔** ——
            //   那是提示词该管的事；读取时乱剔会误伤正常内容 ✗
            const stg = inner0.match(/[，,；;、｜|]?\s*强度\s*[:：]\s*([^，,；;、｜|]+)/);
            if (stg) strength = stg[1].trim();
            const inner = (tal ? inner0.replace(tal[0], '') : inner0)
                .replace(/[，,；;、｜|]?\s*强度\s*[:：]\s*[^，,；;、｜|]+/g, '');
            body = body.slice(0, paren.index).trim();
            const fm = inner.match(/致孕方\s*[:：]\s*([^，,、]+)/);
            if (fm) impregnator = fm[1].trim();
            // ★ 同一对括号里还能住两件事 ——
            //   `预产期：1年09月12日`（谁报了就用谁，插件也会自己掷定 ✓）
            //   `孕期：12-15 个月`（**引擎照那张表抄的区间**，掷由插件做 ✓
            //     口径：异种要掷、人类不掷（人类生产日期很固定）✓）
            const dm = inner.match(/预产期\s*[:：]\s*([^，,、]+)/);
            if (dm) due = dm[1].trim();
            const gm = inner.match(/孕期\s*[:：]\s*([^，,、]+)/);
            if (gm) gest = gm[1].trim();
            extra = inner
                .replace(/致孕方\s*[:：]\s*[^，,、]+[，,]?\s*/, '')
                .replace(/预产期\s*[:：]\s*[^，,、]+[，,]?\s*/, '')
                .replace(/孕期\s*[:：]\s*[^，,、]+[，,]?\s*/, '')
                .trim()
                .replace(/^[，,、]\s*/, '');
        }

        // ⚠️ 2026-10-24（她的判断）：显性开头的来源词也**不在读取时剔**（提示词该管）✗
        const bits = body.split(/\s+/).filter(Boolean);        kids.push({
            race: bits[0] || '',
            sex: bits[1] || '',
            impregnator,
            gest,
            due,
            extra,
            talent,
            strength,
        });
    }
    return { head, kids };
}

/**
 * ★ 「显性外貌 / 隐性携带」在界面上是**两格**，但**数据还是一段**（`extra` 那串自由尾巴）——
 *   口径（2026-10-14 定的）：**界面分两格，数据不拆** ✓
 *   ⇒ 这里只管"拆出来编辑 / 拼回去"，**d6 的格式一个字都不改** ✓
 *
 * ⚠️ 认不出来的余项（例如"发育正常"）**原样留着**，一点不丢：
 *   它挂在**显性那一格**里显示（不然它在界面上无处可去 ✗），改完照样按原格式写回去 ✓
 */
const HERITAGE_SEP = ' ｜ ';

/** 拆：`{ dom, rec, rest }`（dom 里已经含"认不出来的余项"） */
export function splitHeritage(extra) {
    const s = String(extra ?? '').trim();
    const out = { dom: '', rec: '', rest: '' };
    if (!s) return out;
    // ★ 2026-10-24：显性是一串外貌，值里本来就有逗号 ⇒ 只能按"下一个键名"划界，
    //   值里本来就有逗号 ⇒ 只能靠**下一个键名**划界，按逗号切只留得下第一段 ✗
    const NEXT = '(?:隐性携带|隐性|天赋|强度|致孕方|受孕方|孕期|预产期)';
    const reDom = new RegExp('显性\\s*[:：]\\s*([\\s\\S]*?)(?=[，,；;｜|]\\s*' + NEXT + '\\s*[：:]|$)');
    const reRec = new RegExp('隐性(?:携带)?\\s*[:：]\\s*([\\s\\S]*?)(?=[，,；;｜|]\\s*' + NEXT + '\\s*[：:]|$)');
    const mDom = s.match(reDom);
    const mRec = s.match(reRec);
    out.dom = mDom ? mDom[1].trim() : '';
    out.rec = mRec ? mRec[1].trim() : '';
    out.rest = s
        .replace(mDom ? mDom[0] : '', '')
        .replace(mRec ? mRec[0] : '', '')
        .replace(/^[｜|，,;；\s]+/, '')
        .replace(/[｜|，,;；\s]+$/, '')
        .replace(/([，,；;｜|])\s*[，,；;｜|]+/g, '$1')
        .trim();
    if (out.rest) out.dom = out.dom ? (out.dom + HERITAGE_SEP + out.rest) : out.rest;
    return out;
}

/** 拼回去：两格 ⇒ `显性：… ｜ 隐性携带：…` 那一段（其它内容原样带上 ✓） */
export function joinHeritage({ dom, rec } = {}) {
    const d = String(dom ?? '').trim();
    const r = String(rec ?? '').trim();
    const parts = [];
    if (d) parts.push('显性：' + d);
    if (r) parts.push('隐性携带：' + r);
    return parts.join(HERITAGE_SEP);
}

/** 写回 d6 原文 */
export function buildFetus(head, kids) {    const h = String(head ?? '').trim();
    const rows = (kids || []).filter(k => String(k.race ?? '').trim() || String(k.sex ?? '').trim() || String(k.impregnator ?? '').trim());
    if (!h && !rows.length) return '无';

    const pieces = [];
    if (h) pieces.push(h);

    rows.forEach((k, i) => {
        // ★ 2026-10-24（构建 -104）：各格末尾的句号 / 分号 / 逗号先收掉 ——
        //   模型常把天赋写成完整句子（句尾带「。」），拼的时候又用「，」接「强度」，
        //   结果拼出「…水平。，强度：起点高于亲代」这种脏格式 ✗
        //   ⚠️ 只收**末尾那一个**标点，句子内部的一点不动（不是清洗内容 ✓）
        const trimEnd = (v) => String(v ?? '').trim().replace(/[。．.！!？?；;，,、\s]+$/, '');
        const race = String(k.race ?? '').trim();
        const sex = String(k.sex ?? '').trim();
        const impregnator = trimEnd(k.impregnator);
        const gest = trimEnd(k.gest);
        const due = trimEnd(k.due);
        const extra = trimEnd(k.extra);
        const talent = trimEnd(k.talent);
        const strength = trimEnd(k.strength);

        let s = `子${i + 1}：${[race, sex].filter(Boolean).join(' ')}`;
        const inner = [
            impregnator ? `致孕方：${impregnator}` : '',
            gest ? `孕期：${gest}` : '',
            due ? `预产期：${due}` : '',
            extra,
            talent ? `天赋：${talent}` : '',
            strength ? `强度：${strength}` : '',
        ].filter(Boolean).join('，');
        if (inner) s += `（${inner}）`;
        pieces.push(s);
    });
    return pieces.join('；');
}
