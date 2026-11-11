/**
 * period-readout.js —— 经期那几格由插件算（2026-11-11 第三批）
 *
 * 为什么不让模型报：流量 / 颜色 / 质地 / 痛经 都是能按「档位 + 第几天」推出来的东西。
 *   交给模型每轮猜，一是会飘、二是和面板上的档位对不上。
 *   ⇒ 现在模型只报**这一轮真的发生了什么**（表现名 + 临时偏离 + 原因），
 *     这几格由这里算，面板读的也是这份。
 *
 * 口径：
 *   · 经量档（少 / 中 / 多）按天递进；超出序列的尾巴按「点滴」
 *   · 痛经档（无 / 轻 / 中 / 重）第 1 天原样，第 2 天降一档，第 3 天起降两档
 *   · 颜色 / 质地跟流量走；玩家在设置里填了写法就按玩家写的
 *   · 「非常态」里的经量 / 痛经可以临时改档（止痛药这类），只改这一次，不改基础档
 */

/** 各档位按天的流量序列（超出长度按「点滴」） */
export const PERIOD_FLOW_SERIES = {
    少: ['少', '少', '点滴', '点滴', '点滴'],
    中: ['中', '多', '中', '少', '点滴'],
    多: ['多', '大量', '多', '中', '少'],
};

const COLOR_BY_FLOW = { 大量: '鲜红', 多: '鲜红', 中: '暗红', 少: '暗红', 点滴: '褐色' };
const TEX_BY_FLOW = { 大量: '有血块', 多: '粘稠', 中: '粘稠', 少: '稀薄', 点滴: '稀薄' };
const PAIN_LV = ['无', '轻', '中', '重'];

/** 从 "Day3" / "3" 这类写法里取第几天（取不到 ⇒ NaN） */
export function dayNoOf(v) {
    const m = String(v ?? '').match(/\d+/);
    return m ? Number(m[0]) : NaN;
}

/** 这个档位、第几天该是多少流量 */
export function periodFlowOf(tier, day) {
    const arr = PERIOD_FLOW_SERIES[tier] || PERIOD_FLOW_SERIES['中'];
    const d = Math.round(Number(day) || 1);
    if (d < 1) return arr[0];
    return arr[d - 1] || '点滴';
}

/** 这个档位、第几天该是几档痛经（走势可选：逐天减轻 / 全程保持 / 只头几天 / 逐天自定义） */
export function periodPainOf(tier, day, pattern = 'descend', byDay = []) {
    const base = PAIN_LV.includes(tier) ? PAIN_LV.indexOf(tier) : 1;
    const d = Math.round(Number(day) || 1);
    if (pattern === 'steady') return PAIN_LV[base];
    if (pattern === 'front') return PAIN_LV[Math.max(0, base - (d <= 2 ? 0 : 2))];
    if (pattern === 'custom') {
        // 逐天自己点的：这一天填了就用它，没填就退回基础档 ✓
        const v = Array.isArray(byDay) ? byDay[Math.max(0, d - 1)] : '';
        return PAIN_LV.includes(v) ? v : PAIN_LV[base];
    }
    const drop = d <= 1 ? 0 : (d === 2 ? 1 : 2);
    return PAIN_LV[Math.max(0, base - drop)];
}

export function periodColorOf(flow) { return COLOR_BY_FLOW[flow] || '暗红'; }
export function periodTextureOf(flow) { return TEX_BY_FLOW[flow] || '稀薄'; }

/**
 * 把这个人的设置和模型报的事实合成面板那一份读数。
 *
 * @param {object} prefs periodPrefsOf() 的形状
 * @param {object} raw   模型报的那份（items / off / day）
 * @returns {{day:number, flow:string, color:string, texture:string, pain:string, items:string[], off:{what:string,to:string,why:string}[]}}
 */
export function periodReadoutOf(prefs = {}, raw = {}) {
    const day = dayNoOf(raw?.day) || 1;
    let flow = periodFlowOf(prefs.flow, day);
    let pain = periodPainOf(prefs.pain, day, prefs.painPattern, prefs.painByDay);
    const off = [];

    // 「非常态」里能临时调档的两项（止痛药、受寒这类）
    const rawOff = Array.isArray(raw?.off) ? raw.off : [];
    for (const it of rawOff) {
        const what = String(it?.what ?? '').trim();
        if (!what) continue;
        const to = String(it?.to ?? '').trim();
        const why = String(it?.why ?? '').trim();
        if (to) {
            if (what === '经量' && PERIOD_FLOW_SERIES[to]) flow = to;
            else if (what === '痛经' && PAIN_LV.includes(to)) pain = to;
        }
        off.push({ what, to, why });
    }

    const color = String(prefs.color || '').trim() || periodColorOf(flow);
    const texture = String(prefs.texture || '').trim() || periodTextureOf(flow);

    // 常态 = 这一轮真的发生、而且清单里勾上的那几项；
    //   ★ 2026-11-12（她定的）：**清单一条都没勾**（典型是 NPC，没人会去给他配清单）⇒
    //     不拿清单过滤，正文里写到的表现直接记常态。
    //     不然正常经期表现会全被当成「非常态」，看着像异常 ✗（NPC 每个周期都刷一屏非常态）
    //   ⚠️ 勾过清单的人照旧：清单外又真发生了的，不丢，归到「非常态」（没有原因就空着 ✓）
    const onNames = (Array.isArray(prefs.items) ? prefs.items : []).filter((x) => x && x.on).map((x) => x.name);
    const hasList = onNames.length > 0;
    const items = [];
    const rawItems = Array.isArray(raw?.items) ? raw.items : [];
    for (const v of rawItems) {
        const name = String(v ?? '').trim();
        if (!name) continue;
        if (!hasList || onNames.includes(name)) {
            if (!items.includes(name)) items.push(name);
        } else if (!off.some((x) => x.what === name)) {
            off.push({ what: name, to: '', why: '' });
        }
    }

    return { day, flow, color, texture, pain, items, off };
}

/** 面板上那一行文字：非常态怎么显示（没写原因就只写是什么） */
export function periodOffText(off = []) {
    return (Array.isArray(off) ? off : [])
        .map((x) => {
            const what = String(x?.what ?? '').trim();
            if (!what) return '';
            const to = String(x?.to ?? '').trim();
            const why = String(x?.why ?? '').trim();
            const core = to ? (what + '变' + to) : what;
            return why ? (core + '（' + why + '）') : core;
        })
        .filter(Boolean)
        .join('、');
}
