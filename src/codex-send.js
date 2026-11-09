/**
 * codex-send.js —— 第六批：这一轮要发给主 API 的「种族设定」
 *
 * 做三件事（都是纯函数，能单测）：
 *   1) 把这一轮**在场**的对象对到图鉴条目（绑定的 > 名字 / 别名对上的）；
 *   2) 按**阶段**筛段落：日常发介绍和生理，受孕 / 怀孕 / 待孵那几轮才带生育；
 *      自由补充常驻（有才发）；
 *   3) 拼成一段进系统段的文字，同时给出每条的字数与大概 token（界面拿它做预览）。
 *
 * 口径（她 2026-11-02 定的计划，2026-11-06 又当面纠了一次）：
 *   · 只发**在场的种族** —— 不是把整本图鉴都塞进提示词（那才是"文字量明显下降"的由来）✓
 *   · **人类也走条目**：人类数据要从主规则里剥离、只走图鉴，所以这里不特判人类；
 *     没有人类在场才不发（她原话：要是没有人类的场景就不发送人类）✓
 *   · 名字对不上 ⇒ 发一份「每族一行」的种族目录，**绝不默认当人类** ✓
 *   · 同一族只发一份（几个人共用一个种族时，正文里不点名，靠状态摘要里的人名对）✓
 *   · 条目正文一个字都没写 ⇒ 不发，也不假装发过 ✓
 *
 * 为什么不在这里顺手 import prompt.js：那边要用 isPregnant / 受孕率这些判定，
 *   这里是"发送层"。调用方把 `needRepro(t)` 传进来（prompt.js 的 codexNeedRepro），
 *   两边就不会各写一套阶段判据 ✓
 */

import { codexEntries, codexEntry } from './codex.js';
import { codexIdOf, resolveRaceWithTemp, nearestRaceEntries, sexBorrowOf } from './codex-bind.js';
import { CODEX_SPECIES, SEX_LABELS, SEX_KEYS } from './codex-schema.js';
import { displayName, raceJudgeOf } from './store.js';
import { estimateTokens } from './tokens.js';

/** 四段正文（顺序就是发出去与界面上的顺序） */
export const CODEX_SEGMENTS = [
    { key: 'intro', label: '介绍' },
    { key: 'physio', label: '生理' },
    { key: 'repro', label: '生育' },
    { key: 'extra', label: '补充' },
];

/** ★ 2026-11-08：性特征那一段的标题跟着条目的性别术语走：兽形用雄 / 雌，亚人与兽人用男 / 女 */
function sexWordsOf(entry) {
    return entry?.cat === 'animal' ? { male: '雄性', female: '雌性' } : { male: '男性', female: '女性' };
}

/**
 * 把条目里存的性特征拼成能发的一段（没写就返回空串 ⇒ 一个字都不发 ✓）。
 * 结构：固定的四项走「名字：值」，其余是自由文本；雌性两项各一行。
 */
export function buildSexText(entry) {
    const s = entry?.sexTrait || {};
    const w = sexWordsOf(entry);
    const head = [];
    for (const k of SEX_KEYS) {
        const v = String(s[k] || '').trim();
        if (v) head.push(SEX_LABELS[k] + '：' + v);
    }
    const male = [head.join('；'), String(s.male || '').trim()].filter(Boolean).join('\n');
    const female = [
        String(s.outer || '').trim() ? ('外阴：' + String(s.outer).trim()) : '',
        String(s.clit || '').trim() ? ('阴蒂：' + String(s.clit).trim()) : '',
    ].filter(Boolean).join('\n');
    const out = [];
    if (male) out.push(w.male + '：\n' + male);
    if (female) out.push(w.female + '：\n' + female);
    return out.join('\n');
}

/** 这条文字在提示词里的抬头（她不喜欢破折号；这里也不用 markdown） */const HEADER = [
    '[种族设定 · 这一轮在场]',
    '下面是这一轮在场对象所属的种族。写正文时按这些事实描写他们的身体与反应。',
    '这些是设定事实，不是让你在正文里判定或计算的规则；数值由系统算好，正文只按结果描写。不要把分项名称和数值格式抄进正文。',
    // ★ 2026-11-07 她定的：条目写的是这一族的典型样子，个别角色的外貌以他自己的设定为准
    '这些是这一族的典型样子；某个角色自己的设定里写得不一样的，以那个角色自己的设定为准。',
    // ★ 2026-11-08：这些设定只用来让描写贴合，别把解剖名词搬进正文（她 2026-11-08 点名担心过）
    '写正文时只按这些事实写看得见、感觉得到的样子，不要写器官名称或解剖术语，也不要写成说明文。',
].join('\n');

/** 这个对象现在的种族文字（推演报的 > 面板那格 > 出厂）—— 跟判定侧同一个来源 ✓ */
function raceTextOf(key) {
    try {
        const r = raceJudgeOf(key);
        return String(r?.race || r?.set || '').trim();
    } catch { return ''; }
}

/**
 * 把一个对象对到条目（真实数据这条路）。
 * @returns {{entry:object|null, race:string, how:string}} how：bound / matched / alias / loose /
 *          empty（还没填种族）/ unmatched（对不上）/ ambiguous（撞多条）/ missing（绑的条目没了）
 */
export function resolveSendEntry(t) {
    const key = String(t?.key || '');
    if (!key) return { entry: null, race: '', how: 'empty' };
    let boundId = '';
    try { boundId = codexIdOf(key); } catch { boundId = ''; }
    if (boundId) {
        const e = codexEntry(boundId);
        // 停用的条目不算「有」：它是玩家自己关掉的 ✓
        if (e && e.status === 'on') return { entry: e, race: '', how: 'bound' };
        const race = raceTextOf(key);
        return { entry: null, race, how: 'missing' };
    }
    const race = raceTextOf(key);
    if (!race) return { entry: null, race: '', how: 'empty' };
    let m = null;
    try { m = resolveRaceWithTemp(race); } catch { m = null; }
    if (m && m.entry && m.entry.status === 'on') {
        // ★ 2026-11-09（B 方案）：临时映射只在她**确认过**之后才走到这里
        //   （`resolveRaceWithTemp` 里挡着；没确认的一律当"没对上"）
        return { entry: m.entry, race, how: m.how || 'matched', temp: m.how === 'temp' };
    }
    return { entry: null, race, how: (m && m.cands && m.cands.length > 1) ? 'ambiguous' : 'unmatched' };
}

/**
 * 这一轮要发什么。
 *
 * @param {object[]} targets 这一轮在场的对象（主 API 那边就是 injectTargets() 的结果）
 * @param {object} opts
 *   · needRepro(t)  这个对象这一轮要不要带「生育」段（受孕 / 怀孕 / 待孵 ⇒ true）
 *   · resolve(t)    换成别的解析器（自测用）
 *   · nameOf(t)     对象在界面上叫什么（自测用）
 * @returns {{
 *   text:string, chars:number, tokens:number, targetCount:number, sentCount:number,
 *   entries:Array<{id,name,segments:string[],segLabels:string[],chars:number,tokens:number,who:string[],text:string}>,
 *   unmatched:Array<{race:string,name:string,how:string}>
 * }}
 */
export function buildCodexPlan(targets, opts = {}) {
    const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
    const resolve = typeof opts.resolve === 'function' ? opts.resolve : resolveSendEntry;
    const needRepro = typeof opts.needRepro === 'function' ? opts.needRepro : () => false;
    // ★ 2026-11-09：发不发「介绍（外貌）」那一段。默认关 ——
    //   角色卡自己写了外貌时，图鉴再发一份两处会打架。
    //   只影响 intro 这一段；生理 / 生育 / 补充照发 ✓
    const introOn = opts.introOn !== undefined ? !!opts.introOn : true;
    // ★ 2026-11-08：这个对象的性特征借用了哪一条（空 = 跟随它自己绑的那一条 ✓）
    const borrowOf = typeof opts.sexBorrowOf === 'function' ? opts.sexBorrowOf : sexBorrowOf;
    const nameOf = typeof opts.nameOf === 'function'
        ? opts.nameOf
        : (t) => { try { return displayName(t) || String(t?.key || ''); } catch { return String(t?.key || ''); } };

    // 稳定的顺序：按图鉴里的排列（内置在前、自建在后）；不在图鉴里的（自测）按名字排
    const order = new Map(codexEntries().map((e, i) => [e.id, i]));

    const groups = new Map();
    const unmatched = [];
    let sentCount = 0;

    for (const t of list) {
        let r = null;
        try { r = resolve(t) || null; } catch { r = null; }
        if (!r || !r.entry) {
            // 连种族都还没填（新对象第一轮）⇒ 不算"对不上"，别拿目录去烦模型 ✓
            if (r && r.race && r.how !== 'empty') {
                unmatched.push({ race: r.race, name: nameOf(t), how: r.how || 'unmatched' });
            }
            continue;
        }
        // 人类不特判：它也要走条目（人类数据正在从主规则里剥离 ✓）
        // ★ 2026-11-08：临时族按**名字**分块（两个不同的临时族借同一条来源时，不能并成一块 ✗）
        const isTemp = r.how === 'temp';
        // ★ 2026-11-08：「性特征按哪一族」—— 借来的那条只换性特征那一段，别的段还是自己这条 ✓
        let sexEntry = r.entry;
        let sexBorrowed = false;
        try {
            const bid = borrowOf(t);
            if (bid && bid !== r.entry.id) {
                const b = codexEntry(bid);
                if (b && b.status === 'on') { sexEntry = b; sexBorrowed = true; }
            }
        } catch { /* 读不到就按自己这条 ✓ */ }
        const gkey = (isTemp ? ('temp:' + r.race) : r.entry.id) + '|' + (sexBorrowed ? sexEntry.id : '');
        let g = groups.get(gkey);
        if (!g) {
            g = {
                entry: r.entry,
                who: [],
                repro: false,
                temp: isTemp,
                label: isTemp ? (r.race || r.entry.name) : r.entry.name,
                sexEntry,
                sexBorrowed,
            };
            groups.set(gkey, g);
        }
        const nm = nameOf(t);
        if (nm && !g.who.includes(nm)) g.who.push(nm);
        if (needRepro(t)) g.repro = true;
        sentCount++;
    }

    const sorted = [...groups.values()].sort((a, b) => {
        const ia = order.has(a.entry.id) ? order.get(a.entry.id) : 1e9;
        const ib = order.has(b.entry.id) ? order.get(b.entry.id) : 1e9;
        if (ia !== ib) return ia - ib;
        return String(a.entry.name).localeCompare(String(b.entry.name), 'zh');
    });

    // ★ 2026-11-08（她定的）：性特征内容完全一样的族**合并成一句**，不重复发。
    //   同一种类的几个品种（金毛 / 德牧）常常一字不差 ⇒ 只发第一块的，标题里把这些名字都列上 ✓
    const sexByText = new Map();
    for (const g of sorted) {
        const sexText = buildSexText(g.sexEntry || g.entry);
        if (!sexText) continue;
        g.sexText = sexText;
        const stKey = (g.sexBorrowed ? g.sexEntry.id : '') + '\u0001' + sexText;
        if (!sexByText.has(stKey)) {
            sexByText.set(stKey, {
                names: [],
                borrowed: g.sexBorrowed ? g.sexEntry.name : '',
            });
        }
        sexByText.get(stKey).names.push(g.label || g.entry.name);
        g.sexKey = stKey;
    }

    const entriesOut = [];
    const blocks = [];
    for (const g of sorted) {
        const segs = [];
        for (const s of CODEX_SEGMENTS) {
            if (s.key === 'repro' && !g.repro) continue;
            if (s.key === 'intro' && !introOn) continue;   // ★ 介绍（外貌）：默认不发 ✓
            const text = String(g.entry[s.key] || '').trim();
            if (!text) continue;
            segs.push({ key: s.key, label: s.label, text });
        }
        // ★ 性特征跟正文一起常驻；内容相同的只由第一块带，其余块靠标题里的名字认领 ✓
        if (g.sexText) {
            const grp = sexByText.get(g.sexKey) || { names: [], borrowed: '' };
            const mine = g.label || g.entry.name;
            if (grp.names[0] === mine) {
                let lab = '性特征';
                if (grp.borrowed) lab += '（按 ' + grp.borrowed + ' 那一族）';
                if (grp.names.length > 1) lab += '（' + grp.names.join('、') + ' 相同）';
                segs.push({ key: 'sex', label: lab, text: g.sexText });
            }
        }
        if (!segs.length) {
            // 这一条正文全空：不发，但界面上要能看见"为什么没发" ✓
            entriesOut.push({
                id: g.entry.id, name: g.entry.name, segments: [], segLabels: [],
                chars: 0, tokens: 0, who: g.who, text: '',
            });
            continue;
        }
        const head = [`■ ${g.label || g.entry.name}`];
        if (g.temp) {
            head.push(`（这一族在图鉴里没有单独条目，下面的设定借用最接近的「${g.entry.name}」）`);
        }
        const block = [...head, ...segs.map((s) => `${s.label}：${s.text}`)].join('\n');
        entriesOut.push({
            id: g.entry.id,
            name: g.label || g.entry.name,
            temp: !!g.temp,
            sourceName: g.temp ? g.entry.name : '',
            segments: segs.map((s) => s.key),
            segLabels: segs.map((s) => s.label),
            chars: block.length,
            tokens: estimateTokens(block),
            who: g.who,
            text: block,
        });
        blocks.push(block);
    }

    // ---- 对不上的：只给"最接近的几条"（绝不默认当人类 ✓）----
    // ★ 2026-11-08：以前这里把**整本图鉴 706 条的名字**全列出来（3616 字，约 2260 token），
    //   而且只要有一族对不上，**每轮都发** ⇒ 爆 token。现在只给最像的几条候选；
    //   一条都不像，就只给 33 个种类名，够它选一类，又不会把整本目录塞进去。
    const dirLines = [];
    let dirText = '';
    if (unmatched.length) {
        const races = [...new Set(unmatched.map((u) => u.race))];
        const near = nearestRaceEntries(races);
        dirLines.push('【种族目录】');
        dirLines.push(`这几个种族在图鉴里还没对上：${races.join('、')}。`);
        if (near.length) {
            dirLines.push('最接近的几条：' + near.map((e) => e.name).join('、') + '。');
            dirLines.push('写的时候按最接近的那一族来；拿不准就写得不具体一点，不要默认按人类写。');
        } else {
            const kinds = CODEX_SPECIES.map((s) => s[1]).filter(Boolean);
            dirLines.push('图鉴里现有的种类：' + kinds.join('、') + '。');
            dirLines.push('写的时候按最接近的那一类来；拿不准就写得不具体一点，不要默认按人类写。');
        }
        dirText = dirLines.join('\n');
        blocks.push(dirText);
    }

    const text = blocks.length ? [HEADER, ...blocks].join('\n\n') : '';

    return {
        text,
        chars: text.length,
        tokens: estimateTokens(text),
        targetCount: list.length,
        sentCount,
        entries: entriesOut,
        unmatched,
        // 真发出去的那份种族目录（没发就是空串）
        directory: dirText,
    };
}
