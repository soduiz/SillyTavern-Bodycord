/**
 * codex-schema.js —— 种族图鉴的数据形状
 *
 * 这个文件是**叶子**（不 import 任何东西）⇒ 谁都能引它，不会造环 ✓
 *
 * 一条条目长什么样（计划里定的）：
 *   · 编号：内置 `bi-`、自建 `cr-`，后面八位随机十六进制；名字可重复，编号唯一
 *   · 名字 + 别名：推演报别的叫法也能对回这一条
 *   · 分类：人类 / 兽人 / 动物 / 其他（2026-11-06 晚收窄，旧分类都落到「其他」）
 *     来源（人类 / 西方与通用 / 东方 / 原创）只是标签，不参与判定
 *   · 四段正文：简单介绍（兼目录摘要）、生理、繁殖受孕、自由补充
 *   · 数值表：一张表，一行一项，可自己加行（见下面的 VALUE_ROWS）
 *   · 发育段：每段「起始刻度 + 一句话」；空着就明确不生成生长描述
 *   · 备注：只给玩家看，不进提示词、不参与匹配
 *   · 状态：on（默认）/ off（停用）
 *
 * ⚠️ 数值从第三批起**参与判定**（见 `codex-values.js`）；正文（介绍 / 生理 / 繁殖）要到第四、六批 ✓
 */

/** 分类（第一层，顺序就是界面上的顺序）
 *  ★ 2026-11-06 晚她定的：人类 / 动物 / 亚人 / 兽人。
 *    第二层才是「动物里面的猪、牛、绵羊、山羊、犬…」（见 CODEX_SPECIES）。
 *    ⚠️ 第一层只放这四个，别把动物名字平铺进来 —— 她嫌翻着难受 ✓
 */
export const CODEX_CATS = [
    ['human', '人类'],
    ['animal', '动物'],
    ['kin', '亚人'],
    ['beastkin', '兽人 / 类人怪物'],
    ['other', '其他'],
];

/** 第二层：具体是哪一种（大类）。用日常泛称，不用生物分类，也不用地域 ✓ */
export const CODEX_SPECIES = [
    ['pig', '猪'],
    ['cattle', '牛'],
    ['sheep', '羊'],
    ['dog', '狗'],
    ['cat', '猫'],
    ['chicken', '鸡'],
    ['duck', '鸭'],
    ['goose', '鹅'],
    ['pigeon', '鸽'],
    ['turtle', '龟'],
    ['snake', '蛇'],
    ['fish', '鱼'],
    ['horse', '马'],
    ['rabbit', '兔'],
    ['rat', '鼠'],
    ['insect', '昆虫'],
    ['arthropod', '节肢动物'],
    ['cephalopod', '头足类'],
    ['mythbeast', '神兽'],
    ['elephant', '象'],
    ['bear', '熊'],
    ['cetacean', '鲸豚类'],
    ['penguin', '企鹅'],
    ['leopard', '豹'],
    ['tiger', '虎'],
    ['lion', '狮'],
    ['monkey', '猴'],
    ['ape', '猿'],
    ['lemur', '狐猴'],
    ['raptor', '猛禽'],
    ['wolf', '狼'],
    ['fox', '狐'],
    ['deer', '鹿'],
];

export function codexSpeciesLabel(id) {
    const hit = CODEX_SPECIES.find((s) => s[0] === id);
    return hit ? hit[1] : '';
}

export function codexCatLabel(id) {
    const hit = CODEX_CATS.find((c) => c[0] === id);
    return hit ? hit[1] : '其他';
}

/** 来源标签（只用来认"这条是从哪儿搬来的"，不参与判定 ✓） */
export const CODEX_SOURCES = [
    ['human', '人类'],
    ['west', '西方与通用'],
    ['east', '东方'],
    ['origin', '原创'],
];

/**
 * ★ 2026-11-08（第 0 批）：性特征。
 *
 * 口径见 种族图鉴-性特征-计划.md：
 *   · 固定的只有雄性那四项（倒刺 / 锁结 / 龟头形状 / 双阴茎），其余走自由文本
 *   · 雌性只写外阴与内部结构、阴蒂两项（她 2026-11-08 定的，分泌物不要）
 *   · 空串 ＝ 没填（不接管、不发）
 *   · 这块**单独存**（不塞进正文四段），才能只在性接触那一轮门控发送 ✓
 */
export const SEX_ENUMS = {
    // ★ 2026-11-08：倒刺那一项改名「表面特征」并加选项（她说的：倒刺只是其中一种）
    surface: ['', '无（光滑）', '倒刺', '角质小刺', '颗粒', '沟槽', '鳞片', '环状隆起', '纵褶', '肉状突起', '吸盘'],
    glans: ['', '圆锥', '蘑菇', '螺旋', '分叉', '扁宽（盘状）', '球状', '钩状', '带软骨', '无（不外露）', '其他'],
    lock: ['', '无', '有'],
    // ★ 2026-11-08：结节和锁结分开 —— 锁结是交配时的物理状态，结节是身上本来就有的隆起
    node: ['', '无', '球状膨大', '环状隆起', '多结节'],
    double: ['', '无', '两根'],
    baculum: ['', '有', '无'],
    // ★ 2026-11-08：鸟类 / 爬行 / 两栖 / 部分鱼是泄殖腔
    cloaca: ['', '无', '有', '有（交接器藏在里面）'],
    // ★ 2026-11-08（第 10 批）：怎么把精子送过去 —— 蜘蛛用触肢、蝎子蜈蚣用精荚、鱼体外受精
    delivery: ['', '直接交配', '泄殖腔对口', '体外受精', '精荚转移', '触肢送精'],
};

export const SEX_LABELS = {
    surface: '表面特征',
    glans: '龟头形状',
    lock: '锁结',
    node: '结节',
    double: '双阴茎',
    baculum: '阴茎骨',
    cloaca: '泄殖腔',
    delivery: '交接方式',
};

/** 雄性那几项的显示顺序（界面与提示词同一份 ✓） */
export const SEX_KEYS = ['surface', 'glans', 'lock', 'node', 'double', 'baculum', 'cloaca', 'delivery'];

function pickEnum(v, allowed) {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return allowed.includes(s) ? s : '';
}

/** 这一条有没有写性特征（两项都空 ⇒ 不发、也算没填 ✓） */
export function sexFilled(entry) {
    const s = entry?.sexTrait || {};
    return !!(String(s.male || '').trim() || String(s.outer || '').trim()
        || String(s.clit || '').trim() || SEX_KEYS.some((k) => s[k]));
}

/**
 * 数值表的固定项（顺序就是界面上的顺序）。
 *
 * kind：
 *   · `range`  ⇒ 两个数字（最短 / 最长），单位跟「刻度」那一行走
 *   · `number` ⇒ 一个数字（显怀起点那种），单位写在行上
 *   · `select` ⇒ 从 options 里挑一个
 *   · `text`   ⇒ 一句话
 * ⚠️ 加项 / 改名要一起看 `codex-data.js`（内置条目按 key 填值）与
 *    `ui-codex.js`（每种 kind 的画法）✓
 */
export const VALUE_ROWS = [
    { key: 'scale', label: '刻度', kind: 'select', options: ['天', '周', '月'], hint: '这一条的孕期与发育段都按这个刻度写' },
    // ★ 2026-11-08（规则剥离第一步）：周期长度与排卵日改成**按族**存，不再写死在身体补丁正文里。
    //   填的是这一族的**平均值**（人类 28 / 14 也是平均值，不是必须值）；
    //   空着 ⇒ 跟全局（28 / 14），不是"这一族没有周期"。
    { key: 'cycle_len', label: '周期长度', kind: 'number', unit: '天', hint: '这一族有周期时的平均天数；空着 = 跟全局（28 天）' },
    { key: 'cycle_ovu', label: '排卵日', kind: 'number', unit: '第几天', hint: '平均在周期第几天排卵；空着 = 跟全局（14）' },
    // ★ 2026-11-08：诱导排卵（兔、猫这类要交配后才排）——
    //   选了「交配后排卵」就不再看上面的排卵日，改由插件在交配时掷一次。
    { key: 'ovu_mode', label: '排卵方式', kind: 'select', options: ['按周期', '交配后排卵'], hint: '按周期 = 上面那个排卵日；交配后排卵 = 兔、猫这类，交配后才会排卵' },
    { key: 'ovu_rate', label: '诱导排卵率', kind: 'range', unit: '%', hint: '只对「交配后排卵」有用：每次交配掷一次会不会排卵；空着 = 80 到 90%' },
    { key: 'ovu_delay', label: '排卵延迟', kind: 'range', unit: '小时', hint: '只对「交配后排卵」有用：交配后多久排卵；空着 = 10 到 13 小时' },
    { key: 'preg_in', label: '孕期（体内孕育）', kind: 'range', hint: '最短到最长，按上面的刻度；空着 = 不适用' },
    { key: 'preg_out', label: '孕期（体外孵化）', kind: 'range', hint: '卵生才填；空着 = 不适用' },
    // ★ 2026-11-06（第三批）：着床天数按条目走；空着 = 跟全局设置（默认 6 到 10 天）
    { key: 'implant_days', label: '着床天数', kind: 'range', unit: '天', hint: '受精到着床几天；空着 = 跟全局设置（默认 6 到 10 天）' },
    { key: 'birth', label: '生育方式', kind: 'select', options: ['胎生', '卵生（体外孵化）', '卵生（体内孵化）'] },
    // ★ 2026-11-08：泌乳单独一格，**跟生育方式无关**（她当场纠正的：卵生不等于没奶，
    //   鸭嘴兽卵生照样产奶）⇒ 只看这一族的原型：哺乳类有乳腺乳；鸽 / 企鹅这类是嗉囊乳、
    //   食道乳（不是乳腺，也没有按天算的奶量）；爬行 / 鱼 / 虫 / 头足 / 无血肉的没有。
    //   空着 = 按设定与剧情（插件不替玩家编这一族的身体）。
    { key: 'milk', label: '泌乳', kind: 'select', options: ['', '有（乳腺乳）', '有（嗉囊乳这类）', '无'], blankLabel: '留空（按设定与剧情）', hint: '这一族喂不喂奶、是哪种奶；跟是不是卵生无关（鸭嘴兽卵生也产奶）。留空 = 按设定与剧情' },
    // ★ 2026-11-06：显怀改成**这一族的一个范围**（最早到最晚，单位固定「周」）。
    //   为什么不按单 / 双 / 三胎分三格：胎数现实里不止三种（她 2026-11-06 亲口否掉），
    //   个体早还是晚是体质，也不是胎数决定的。
    //   空着 = 这一条不接管，仍按规则里的显怀模块走（宁可不接管，也不替玩家编数 ✓）
    { key: 'show_weeks', label: '显怀范围', kind: 'range', unit: '周', hint: '这一族最早到最晚第几周开始显怀；空着 = 这一族不接管' },
    // ★ 2026-11-06：下面三行在界面上不再是「写 D100」——
    //   胎数按「一行一档 + 占比 %」填、性别按「两个称呼 + 一边占比」填、
    //   同卵按「同卵占比 + 混合占比」填，骰子区间由插件折算（存法没变，仍是这几个字，
    //   判定侧照旧解析；老存档 / 导入的那份也照样读得懂 ✓）
    { key: 'litter', label: '胎数分档', kind: 'text', hint: '按下面的填法：一行一档，填几个孩子、占多少 %' },
    { key: 'sex', label: '性别分档', kind: 'text', placeholder: '雄 / 雌' },
    { key: 'twin', label: '同卵与混合胎', kind: 'text' },
    { key: 'breedGroup', label: '混血组', kind: 'text', placeholder: '同一个原型的族填同一个名字，留空 = 只跟同族生' },
    // ★ 2026-11-07：品种 —— 统称下面是品种时填这里（边牧 / 德牧 / 绵羊 / 山羊）；
    //   留空 = 统称的通用形态。品种只在父母本来就有这个品种时才进混血池 ✓
    { key: 'breed', label: '品种', kind: 'text', placeholder: '留空 = 统称的通用形态；填了就是具体品种' },
    { key: 'unit', label: '单位', kind: 'text', placeholder: '胎 / 枚 / 只' },
    // ★ 2026-11-08：从"文字占位"改成**天数区间** —— 分娩那一轮按它掷一次恢复天数，
    //   掷出来存个人，不重掷。空着 ＝ 跟全局默认（设置页那三档）✓
    { key: 'postpartum', label: '产后恢复', kind: 'range', unit: '天', hint: '产后多久恢复周期，最短到最长（天）；空着 = 跟全局默认' },
    // ★ 2026-11-08（发情期第 0 批）：这一族有没有发情期、多久一次、一次几天、一年里哪几个月。
    //   ⚠️ 只认「有」；「无」与空着都等于不发（不是"留空就跟全局"——发情期没有全局默认 ✓）
    //   ★ 2026-11-09：空着就等于「无」⇒ 下拉里不再单列一个没字的空选项，空的一律显示成「无」✓
    //   ⚠️ 季节存的是**一年里的位置**（比例），不是月份序号 —— 自定义历法下才不会错位 ✓
    { key: 'estrus', label: '发情期', kind: 'select', options: ['有', '无'], blankAs: '无', hint: '这一族有没有发情期；空着和「无」都是不发。人类与无血肉的族填「无」' },
    { key: 'estrus_cycle', label: '发情周期', kind: 'range', unit: '天', hint: '两次发情开始之间隔多少天；空着 = 21 天' },
    { key: 'estrus_days', label: '发情持续', kind: 'range', unit: '天', hint: '一次发情持续几天；空着 = 5 到 7 天' },
    { key: 'estrus_season', label: '发情季节', kind: 'months', hint: '哪几个月有发情；空着 = 全年发情。按当前历法的月份勾，内部存一年里的位置' },
];

const VALUE_KEYS = new Set(VALUE_ROWS.map((r) => r.key));

/**
 * 已经退休的固定项：读老覆盖 / 老导入时直接丢掉，别当「自定义项」露出来。
 *   show1 / show2 / show3 ⇒ 2026-11-06 并成一条 show_weeks（胎数不再固定三档）
 *   hybrid ⇒ 2026-11-07 退休：混血靠混血组 / 品种和插件的池子，不再写可行性 / 折算
 */
const RETIRED_KEYS = new Set(['show1', 'show2', 'show3', 'hybrid']);

function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function rowFrom(def, raw) {
    const r = { key: def.key, label: def.label, kind: def.kind };
    if (def.options) r.options = def.options.slice();
    if (def.placeholder) r.placeholder = def.placeholder;
    if (def.hint) r.hint = def.hint;
    // 单位：range 行的单位默认跟「刻度」走；个别行（着床天数）自己带一个 ✓
    if (def.unit) r.unit = def.unit;
    if (def.kind === 'range') {
        r.min = numOrNull(raw?.min);
        r.max = numOrNull(raw?.max);
    } else if (def.kind === 'number') {
        // 单个数（显怀起点那种）；0 及以下当没填
        const n = numOrNull(raw?.num);
        r.num = (n !== null && n > 0) ? n : null;
    } else if (def.kind === 'select') {
        r.text = def.options.includes(raw?.text) ? raw.text : def.options[0];
    } else {
        r.text = raw?.text === null || raw?.text === undefined ? '' : String(raw.text);
    }
    return r;
}

/**
 * 把任何来源的条目（内置 / 覆盖 / 自建 / 导入）补成同一种形状。
 * 缺的项补空、多出来的自定义行接在固定项后面（顺序固定，界面不会跳）。
 */
export function normalizeEntry(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const rowsIn = Array.isArray(src.rows) ? src.rows : [];
    const byKey = new Map();
    for (const r of rowsIn) {
        if (r && typeof r.key === 'string') byKey.set(r.key, r);
    }
    const rows = VALUE_ROWS.map((def) => rowFrom(def, byKey.get(def.key)));
    // 自己加的行（key 不以固定项命名）—— 原样跟在后面 ✓
    for (const r of rowsIn) {
        if (!r || typeof r.key !== 'string' || VALUE_KEYS.has(r.key)) continue;
        if (RETIRED_KEYS.has(r.key)) continue;
        rows.push({
            key: r.key,
            label: String(r.label || '自定义项'),
            kind: 'text',
            text: r.text === null || r.text === undefined ? '' : String(r.text),
        });
    }
    return {
        id: String(src.id || ''),
        name: String(src.name || ''),
        aliases: Array.isArray(src.aliases)
            ? src.aliases.map((a) => String(a).trim()).filter(Boolean)
            : [],
        cat: CODEX_CATS.some((c) => c[0] === src.cat) ? src.cat : 'other',
        species: CODEX_SPECIES.some((s) => s[0] === src.species) ? src.species : '',
        source: CODEX_SOURCES.some((s) => s[0] === src.source) ? src.source : 'origin',
        status: src.status === 'off' ? 'off' : 'on',
        intro: String(src.intro || ''),
        physio: String(src.physio || ''),
        repro: String(src.repro || ''),
        extra: String(src.extra || ''),
        // ★ 2026-11-06（第八批第二批）：繁殖数据借用自哪一条（'' = 不借用）。
        //   只借数值，不借正文；数据层见 codex-values.js 的 pickRow ✓
        borrowFrom: String(src.borrowFrom || ''),
        // ★ 2026-11-08：性特征（雄性四项 + 自由文本，雌性两项）；空串 ＝ 没填 ✓
        sexTrait: (() => {
            const sx = (src.sexTrait && typeof src.sexTrait === 'object' && !Array.isArray(src.sexTrait)) ? src.sexTrait : {};
            return {
                surface: pickEnum(sx.surface, SEX_ENUMS.surface),
                glans: pickEnum(sx.glans, SEX_ENUMS.glans),
                lock: pickEnum(sx.lock, SEX_ENUMS.lock),
                node: pickEnum(sx.node, SEX_ENUMS.node),
                double: pickEnum(sx.double, SEX_ENUMS.double),
                baculum: pickEnum(sx.baculum, SEX_ENUMS.baculum),
                cloaca: pickEnum(sx.cloaca, SEX_ENUMS.cloaca),
                delivery: pickEnum(sx.delivery, SEX_ENUMS.delivery),
                male: String(sx.male || ''),
                outer: String(sx.outer || ''),
                clit: String(sx.clit || ''),
            };
        })(),
        rows,
        stages: Array.isArray(src.stages)
            ? src.stages.map((s) => ({ at: String(s?.at || ''), text: String(s?.text || '') }))
            : [],
        notes: String(src.notes || ''),
    };
}

/** 取一行（界面读值用；不存在就给空行 ✓） */
export function rowOf(entry, key) {
    return (entry?.rows || []).find((r) => r.key === key) || null;
}

/** 这一条的刻度（天 / 周 / 月） */
export function scaleOf(entry) {
    return rowOf(entry, 'scale')?.text || '天';
}

/**
 * 编号：前缀（bi- / cr-）+ 八位随机十六进制。
 * ⚠️ 撞了就重掷（名字可以重复，编号不行 ✓）
 */
const HEX = '0123456789abcdef';

export function makeCodexId(prefix, taken) {
    const used = taken instanceof Set ? taken : new Set(taken || []);
    for (let tries = 0; tries < 200; tries++) {
        let s = '';
        for (let i = 0; i < 8; i++) s += HEX[Math.floor(Math.random() * 16)];
        const id = prefix + s;
        if (!used.has(id)) return id;
    }
    // 理论上到不了这里；真到了也别给空编号（编号是绑定的锚 ✓）
    return prefix + Date.now().toString(16).slice(-8);
}

/** 搜索：名字 / 别名 / 分类名 / 种类名 都算命中（大小写不敏感 ✓）；来源那套旧标签不再参与 ✓ */
export function codexMatch(entry, needle) {
    const q = String(needle || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [
        entry.name,
        ...(entry.aliases || []),
        codexCatLabel(entry.cat),
        codexSpeciesLabel(entry.species),
        entry.intro,
    ].join('\n').toLowerCase();
    return hay.includes(q);
}
