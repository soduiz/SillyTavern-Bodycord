/**
 * params.js —— 补丁里的「数值」面板
 *
 * 为什么不是通用提取？
 *   试过用 `- 关键词：值` 这种通用规则去扫，光「核心监测系统」一条就扫出 23 处，
 *   而且绝大多数是规则不是参数。所以这里改成**手工指定**：
 *   每条参数用明确的模式定位，只能改值，改不动结构。
 *
 * 这正好对上「某些地方不让改，只能改数值」的诉求；
 * 想改全文，在补丁页还有「文案」那个高级入口。
 *
 * 另外：敏感带初始设定是「自由填写区」，单独处理，而且即使模块开关是关的，
 * 这里也照样显示——你填过的东西不该因为开关而看不见。
 */

import { moduleText, moduleTextRaw, setModuleText, settings, save, CYCLE_RATE_DEF, ACH_LEN_DEF, PROT_COEF_DEF, AWARENESS_TIER_DEF, ZONE_LV_DEF, zoneParamsOf, parseZoneRows, serializeZoneRows, stripLegacyTailBlocks, BODY_COEF_RE, BODY_COEF_OLD_RE, RACE_LINE_RE, RACE_READ_NEW_RE, RACE_READ_OLD_RE, postpartumParamsOf, fetusCountTableOf, fetusSexRangeOf, fetusOvumRangeOf, fetusMixRangeOf, implantRangeOf, talentTierTableOf, dominantSourceRangeOf } from './settings.js';
import {
    zoneTextOf, setZoneTextOf, setZonePresetOf,
    isUserKey, fertilityTierOf, setFertilityTierOf, fertilityManualOf, setRaceManualOf,
    awarenessTierIdOf, setAwarenessTierIdOf, noteAwarenessEvent,
} from './store.js';
import { MODULE_MAP } from './modules.js';

// ---------------------------------------------------------------------------
// 规格
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 数值句的锚点（改排版）
//
// 既然抬头都是 [身体补丁 - XXX] 了，下面那行就可以删掉 ——
//   改成 种族：XXX / 日常体质系数：XXX / 排卵日：XXX；排卵日取 14 更合适 ✓
//   · 新写法（现在出厂正文用的，一行一格）：`种族：人类` / `周期长度：28天` / `排卵日：14` /
//     `日常体质系数：1.0（排卵日当天临时提升至 1.5）`
//   · 老写法（老存档 / 玩家自己那份旧文本）：
//     `周期：28天，排卵日第14天` ＋ `{{user}} 的种族为人类`（更老的是 `{{user}} 为人类体质`）
//
// ⚠️ 老写法**必须继续能读能写** —— 老存档不能因为换了排版就读不出来、也改不动 ✗
// ⚠️ 同一套判据还在 `settings.js` 的 `isNumbersOnlyDiff`（那儿管"是不是只改了数值"）
//    和 `parseBodyCycleParams`（给逻辑用）；settings 不能 import 这里（会循环）⇒ 各写一份、
//    靠 自测脚本 拿同一段文本走两边比对 ✓
// ---------------------------------------------------------------------------
const CYCLE_READ = /周期长度：\s*(\d+)\s*天/;
const CYCLE_OLD_READ = /周期：\s*(\d+)\s*天[，,]\s*排卵日第\s*(\d+)\s*天/;
const OVU_READ = /排卵日：\s*第?\s*(\d+)/;
const OVU_OLD_READ = /排卵日第\s*(\d+)\s*天/;
const BASE_READ = BODY_COEF_RE;          // ★ 乙-4：正则从 settings.js 来（一份解析 ✓）
const BASE_OLD_READ = BODY_COEF_OLD_RE;
const PEAK_READ = /排卵日当天临时提升至\s*([\d.]+)/;
const CYCLE_WRITE = /(周期长度：\s*)\d+\s*天/;
const CYCLE_OLD_WRITE = /(周期：\s*)\d+\s*天([，,]\s*排卵日第\s*)\d+\s*天/;
const OVU_WRITE = /(排卵日：\s*)\d+/;
const BASE_WRITE = /(日常体质系数：\s*)[\d.]+/;
const BASE_OLD_WRITE = /(日常体质系数\s*)[\d.]+(\s*[，,]\s*排卵日当天临时提升至\s*)[\d.]+/;
const PEAK_WRITE = /(排卵日当天临时提升至\s*)[\d.]+/;

// ---------------------------------------------------------------------------
// 「这个角色的种族」那一格的锚点（改口径）
//
// 人类不是体质、是种族，改成"种族为 XX"这种更合适（需要锚点的话）✓
//   · 最新写法（改排版后）：独占一行 `种族：人类`
//   · 上一版：`{{user}} 的种族为人类`
//   · 老写法（别人存档里可能还留着）：`{{user}} 为人类体质`（中间还可能夹一个性别词）
//
// ⚠️ 三种都要认、都要能改 —— 老存档不能因为换了个说法就读不出来 / 写不进去 ✗
// ⚠️ 同一套判据还在 `settings.js` 的 `isNumbersOnlyDiff` 里（它要判断"是不是只改了数值面板那些值"）；
//    那边不能 import 这里（会循环：params.js 已经 import 了 settings.js）⇒ 照旧两处各写一份，
//    靠 自测脚本 拿同一段文本走两边比对 ✓
// ---------------------------------------------------------------------------
const RACE_LINE_READ = RACE_LINE_RE;          // ★ 正则从 settings.js 来（一份解析 ✓）
const RACE_READ_NEW = RACE_READ_NEW_RE;
const RACE_READ_OLD = RACE_READ_OLD_RE;
const RACE_LINE_WRITE = /(种族：\s*)[^\s，,。]+/;
// 清空种族名时用：**整行删掉**（含换行；留半截「- 种族：」更糟 ✗）✓
const RACE_LINE_KILL = /^[^\n]*种族：\s*[^\s，,。]+[^\n]*(?:\n|$)/m;
const RACE_WRITE_NEW = /(\{\{user\}\}\s*的种族为\s*)[^\s，,。]+/;
const RACE_WRITE_OLD = /(\{\{user\}\}\s*为\s*)[^\s，,。]+?(\s*(?:女性|男性|雌性|雄性|扶她)?\s*体质)/;

export const PARAM_SPECS = [
    {
        moduleId: 'body_base',
        title: '身体基础参数',
        desc: '这个身体的基础周期。改这里等于改「身体补丁」里的数值，正文描写会跟着变',
        fields: [
            { key: 'cycle', label: '周期长度', suffix: '天', type: 'number' },
            // ⚠️ suffix 里**不许自带括号** —— 渲染时统一套一对（ui-params.js:125）
            //   自带就成了「（（第几天））」（✗）
            { key: 'ovu', label: '排卵日', suffix: '第几天', type: 'number' },
            // 这两格只能改数字（出厂 1.0，排卵日当天临时提升至 1.5）
            { key: 'base', label: '日常体质系数', type: 'number' },
            { key: 'peak', label: '排卵日暴击', suffix: '当天临时提升至', type: 'number' },
            // ★ 种族名字（这角色是什么种族）—— 只影响叫法，不影响规则 ✓
            //   「种族用哪条判定规则」是另一件事，在「异种扩展包 · 西方与通用」里 ✓
            { key: 'raceName', label: '这个角色的种族', type: 'text', wide: true },
            // ⚠️ 「月经表现」**不在这里** ✗ ——
            //   它在**补丁页顶部的全局「周期模式」切换**里 ✓
            //   （曾经在这里放过一个 select，那和全局切换控制同一件事 ⇒ 必然打架 ✓）
        ],
        read: (t) => {
            // 周期长度 / 排卵日：先认新排版那两行，再认老的一句（老存档 ✓）
            const cyc = t.match(CYCLE_READ) || t.match(CYCLE_OLD_READ);
            const ov = t.match(OVU_READ) || t.match(OVU_OLD_READ);
            const bs = t.match(BASE_READ) || t.match(BASE_OLD_READ);
            const pk = t.match(PEAK_READ);
            if (!cyc && !bs) return null;
            // 种族名：三种写法都认（见文件顶上那段说明 ✓）
            const rn = t.match(RACE_LINE_READ) || t.match(RACE_READ_NEW) || t.match(RACE_READ_OLD);
            return {
                cycle: cyc ? cyc[1] : '',
                ovu: ov ? ov[1] : '',
                base: bs ? bs[1] : '',      // 日常体质系数
                peak: pk ? pk[1] : '',      // 排卵日暴击
                raceName: rn ? rn[1].trim() : '',
            };
        },
        write: (t, v) => {
            let out = t;
            if (String(v.cycle ?? '').trim() !== '' || String(v.ovu ?? '').trim() !== '') {
                // ★ 这两格以前没有边界 ⇒ 排卵日填得比周期还大时，
                //   「排卵窗口最后一天」永远不出现、受精判定**永不触发**（推演出来的）✗
                //   夹一道：周期 5~90 天，排卵日 1~（周期 − 2）
                const cyc = Math.max(5, Math.min(90, Math.round(Number(v.cycle) || 28)));
                const ovu = Math.max(1, Math.min(Math.round(Number(v.ovu) || 14), cyc - 2));
                // 新排版：两行各换各的；老排版：一句里两个一起换（老存档照样能改 ✓）
                if (CYCLE_WRITE.test(out)) {
                    out = out.replace(CYCLE_WRITE, `$1${cyc}天`);
                    if (OVU_WRITE.test(out)) out = out.replace(OVU_WRITE, `$1${ovu}`);
                } else {
                    out = out.replace(CYCLE_OLD_WRITE, `$1${cyc}天$2${ovu}天`);
                }
            }
            if (String(v.base ?? '').trim() !== '' || String(v.peak ?? '').trim() !== '') {
                if (BASE_WRITE.test(out)) out = out.replace(BASE_WRITE, `$1${v.base || 1.0}`);
                else out = out.replace(BASE_OLD_WRITE, `$1${v.base || 1.0}$2${v.peak || 1.5}`);
                out = out.replace(PEAK_WRITE, `$1${v.peak || 1.5}`);
            }
            // 种族名：新排版那行优先；再退到「的种族为X」；最后才是老写法 ✓
            // ⚠️ **明确传了空串 = 清空那一格**：以前空值直接跳过 ⇒
            //   界面看着清空了、底层那行还在，重建设置页又冒出来 ✗
            //   ⚠️⚠️ 但「**没传这一格**」和「传了空串」必须分开（写周期长度时传的那份
            //   压根没有 raceName ⇒ 一个字节都不许动，否则会把种族那行顺手抹掉 ✗
            //   —— 这一条是单元测试当场抓出来的）
            const hasRaceField = Object.prototype.hasOwnProperty.call(v, 'raceName');
            const raceName = String(v.raceName ?? '').trim();
            if (raceName) {
                if (RACE_LINE_WRITE.test(out)) out = out.replace(RACE_LINE_WRITE, `$1${raceName}`);
                else if (RACE_WRITE_NEW.test(out)) out = out.replace(RACE_WRITE_NEW, `$1${raceName}`);
                else out = out.replace(RACE_WRITE_OLD, `$1${raceName}$2`);
            } else if (hasRaceField) {
                out = out.replace(RACE_LINE_KILL, '');       // 整行删掉（留半截「- 种族：」更糟 ✗）
            }
            return out;
        },
    },
    {
        moduleId: 'period_patch',
        title: '生理期参数（本模块独有的）',
        desc: '周期长度与排卵日由「身体补丁」统一管，这里只管经期自己的参数，不再重复',
        fields: [
            { key: 'days', label: '经期天数', suffix: '天', type: 'number' },
            { key: 'start', label: '经期起算', type: 'text', wide: true },
        ],
        read: (t) => {
            const g = (re) => { const m = t.match(re); return m ? m[1].trim() : ''; };
            return {
                days: g(/- 经期天数：\s*([\d.]+)/),
                start: g(/- 经期起算：\s*(.+)/),
            };
        },
        write: (t, v) => t
            .replace(/(- 经期天数：\s*)[\d.]+/, `$1${v.days}`)
            .replace(/(- 经期起算：\s*).+/, `$1${v.start}`),
    },
    {
        // ★ 每档各自的夜数（2026-10-21 起）——
        //   原来只有一格「衰减速度：每 N 夜降一档」⇒ 微红和鞭痕同一个节拍（轻度也得挂 4 天 ✗）。
        //   现在四档分开填，出厂的 1 / 3 / 6 / 12 就是"微红一天、浅瘀三四天、深瘀一周、鞭痕按周"。
        //   ⚠️ 锚点 `- 轻度：每 N 夜降一档` 四行，和 settings.js 的 `traceNightsMapOf` 读的是同一批句子
        moduleId: 'body_trace',
        title: '痕迹参数（本模块独有的）',
        desc: '每档的痕迹要几夜才退一档。默认 轻度 1 夜、中度 3 夜、重度 6 夜、深层 12 夜；体质档会在这个基础上加快或放慢',
        fields: [
            { key: 'light', label: '轻度', suffix: '夜 / 档', type: 'number' },
            { key: 'mid', label: '中度', suffix: '夜 / 档', type: 'number' },
            { key: 'heavy', label: '重度', suffix: '夜 / 档', type: 'number' },
            { key: 'deep', label: '深层', suffix: '夜 / 档', type: 'number' },
        ],
        read: (t) => {
            const g = (lv) => {
                const m = t.match(new RegExp('- ' + lv + '：每\\s*([\\d.]+)\\s*夜降一档'));
                return m ? m[1] : '';
            };
            return { light: g('轻度'), mid: g('中度'), heavy: g('重度'), deep: g('深层') };
        },
        // 夹在 1 到 30 夜之间：手滑填 0 会让痕迹永远不消、填太大等于一觉睡醒全没了 ✗
        write: (t, v) => {
            const set = (txt, lv, val) => txt.replace(
                new RegExp('(- ' + lv + '：每\\s*)[\\d.]+(\\s*夜降一档)'),
                (_all, head, tail) => `${head}${clampTraceNights(val, 1)}${tail}`);
            let out = t;
            out = set(out, '轻度', v.light);
            out = set(out, '中度', v.mid);
            out = set(out, '重度', v.heavy);
            out = set(out, '深层', v.deep);
            return out;
        },
    },
    {
        moduleId: 'lactation_patch',
        title: '泌乳量参数',
        desc: '非孕期也产奶的体质，这里的数值夸张度由你定',
        fields: [
            { key: 'rate', label: '持续刺激 · 单侧流速', suffix: 'ml/分钟', type: 'text' },
            { key: 'burst', label: '高潮 · 单次喷出量', suffix: 'ml', type: 'text' },
            { key: 'total', label: '反复刺激 · 单次总量', suffix: 'ml', type: 'text' },
        ],
        read: (t) => {
            const g = (re) => { const m = t.match(re); return m ? m[1].trim() : ''; };
            return {
                rate: g(/- 持续刺激：单侧流速约\s*([\d\-~～]+)\s*ml\/分钟/),
                burst: g(/- 高潮\/强烈刺激：双侧喷射，单次总喷出量\s*([\d\-~～]+)\s*ml/),
                total: g(/- 长时间反复刺激：单次总量可超\s*([\d\-~～]+)\s*ml/),
            };
        },
        write: (t, v) => t
            .replace(/(- 持续刺激：单侧流速约\s*)[\d\-~～]+(\s*ml\/分钟)/, `$1${v.rate}$2`)
            .replace(/(单次总喷出量\s*)[\d\-~～]+(\s*ml)/, `$1${v.burst}$2`)
            .replace(/(单次总量可超\s*)[\d\-~～]+(\s*ml)/, `$1${v.total}$2`),
    },
    {
        // ★ 这条 spec 现在收**六格** ——
        //   原来只有奶量三格（C7 抽的），这次再加**产后时间线**三格（大量泌乳 / 快速增长 / 稳定期）。
        //   ⚠️ **必须并进同一条**：`specFor()` 用 `find` 取第一条 ⇒ 另开一条同 moduleId 永远渲染不出来 ✗
        //   ⚠️ 它跟「从设置读」那几条不同：**真相源就是正文**（出厂写回一个字不变 ✓）
        // ★ 产后那段的奶量抽成**一行一格的锚点字段** ⇒
        //   ① 玩家想调就在面板里调、不用碰正文；② 正文顺手压短（去掉铺垫与重复）✓
        //   ⚠️ 这些值**只进描写**（d7），不参与任何判定 ⇒ 改了不会动数值口径 ✓
        moduleId: 'postpartum_system',
        title: '产奶量参数',
        desc: '产后三段各从第几天开始，以及各段的奶量参考值。只影响描写，不参与计算',
        fields: [
            { key: 'flowStart', label: '大量泌乳（从第几天）', suffix: '天', type: 'number' },
            { key: 'growthStart', label: '奶量快速增长（从第几天）', suffix: '天', type: 'number' },
            { key: 'stableStart', label: '稳定泌乳期（从第几天）', suffix: '天', type: 'number' },
            { key: 'colostrum', label: '初乳期', suffix: 'ml / 天', type: 'text' },
            { key: 'stable', label: '稳定期', suffix: 'ml / 天', type: 'text' },
            { key: 'multi', label: '多胎倍率', suffix: '倍', type: 'text' },
        ],
        read: (t) => {
            // ★ 解析挪到 settings.js 的 `postpartumParamsOf()`（插件也要读同一份 ✓）——
            //   把传进来的这段文本交给它，字段名与返回形态跟以前一模一样 ✓
            // ⚠️ 字符类里**必须带上小数点**（`1.5-2.5` 这种小数区间）—— 漏了 `.` 时整行读成空 ✗
            //   （踩到的坑：`multi` 那一格永远读不出来、写也静默失败）
            // ⚠️ 时间线那三格：正文写「产后第 2 周」「1-6 个月」⇒ 读回来统一折算成**天** ✓
            return postpartumParamsOf(t);
        },
        write: (t, v) => {
            const int = (raw, def) => {
                const str = String(raw ?? '').trim();
                if (str === '') return def;
                const n = Math.round(Number(str));
                return (Number.isFinite(n) && n >= 1 && n <= 365) ? n : null;
            };
            const flow = int(v.flowStart, 2), grow = int(v.growthStart, 14), stab = int(v.stableStart, 30);
            if (flow === null || grow === null || stab === null) return t;   // 不合法 ⇒ 一个字都不动 ✓
            let out = String(t)
                .replace(/(- 产后 )\d+-\d+( 天：开始大量泌乳)/, `$1${flow}-${flow + 1}$2`)
                .replace(/(- 产后第 )\d+( 周：奶量快速增长)/, `$1${Math.max(1, Math.round(grow / 7))}$2`)
                // 稳定期的结束点原文是「1-6 个月」⇒ 按"起始 +5 个月"给（和原来同一个差 ✓）
                .replace(/(- 产后 )\d+-\d+( 个月：稳定泌乳期)/,
                    `$1${Math.max(1, Math.round(stab / 30))}-${Math.max(2, Math.round(stab / 30) + 5)}$2`);
            // 奶量那三格：空着就不动它（它们本来就是自由文本 ✓）
            const safe = (s) => String(s ?? '').trim();
            if (safe(v.colostrum)) out = out.replace(/(- 初乳期：\s*)[\d.\-~～]+(\s*ml)/, `$1${safe(v.colostrum)}$2`);
            if (safe(v.stable)) out = out.replace(/(- 稳定期：\s*)[\d.\-~～]+(\s*ml)/, `$1${safe(v.stable)}$2`);
            if (safe(v.multi)) out = out.replace(/(- 多胎倍率：\s*)[\d.\-~～]+(\s*倍)/, `$1${safe(v.multi)}$2`);
            return out;
        },
    },
    {
        // ★ 敏感带「每轮加几次」抽成**一行一格的锚点字段** ⇒
        //   ① 玩家想调开发速度就在面板里调、不用碰正文；② 正文顺手压短 ✓
        //   ⚠️ 正文里还有一句「单个部位每轮最多 +3」＝**每轮上限**。出厂时它恰好等于重度那档
        //     ⇒ 写回时让它**跟着重度走**（不然玩家把重度调到 5、上限还写着 3，正文自己打架 ✗）
        // ★ 同一张卡里再加**等级阈值表**那 6 格（见 zoneLv 顶上那段说明）。
        //   ⚠️ **必须并进这一条 spec**，不能另开一条同 moduleId 的 —— `specFor()` 是
        //     `PARAM_SPECS.find(s => s.moduleId === id)`（**取第一条**）⇒ 两条同 id 的话
        //     新那条永远渲染不出来、还会把 `specFor('zones_record')` 的测试指到错的那条 ✗
        moduleId: 'zones_record',
        title: '敏感带升级参数',
        desc: '每轮被触碰后的累计刺激增量，以及每一级从多少累计刺激开始算（等级阈值表的起点）',
        fields: [
            { key: 'light', label: '轻度增量', type: 'number' },
            { key: 'mid', label: '中度增量', type: 'number' },
            { key: 'heavy', label: '重度增量', type: 'number' },
            { key: 'lv0', label: '0级起点', type: 'number' },
            { key: 'lv1', label: '1级起点', type: 'number' },
            { key: 'lv2', label: '2级起点', type: 'number' },
            { key: 'lv3', label: '3级起点', type: 'number' },
            { key: 'lv4', label: '4级起点', type: 'number' },
            { key: 'lv5', label: '5级起点', type: 'number' },
        ],
        read: () => {
            // ★ 乙-2a：解析挪到 settings.js 的 `zoneParamsOf()`（和插件共用同一份 ✓）——
            //   这里只把数字转回字符串（面板那几格的取值形态跟以前一模一样 ✓）
            const z = zoneParamsOf();
            return {
                light: String(z.light), mid: String(z.mid), heavy: String(z.heavy),
                lv0: String(z.lv[0]), lv1: String(z.lv[1]), lv2: String(z.lv[2]),
                lv3: String(z.lv[3]), lv4: String(z.lv[4]), lv5: String(z.lv[5]),
            };
        },
        write: (t, v) => {
            const light = zoneStep(v.light);
            const mid = zoneStep(v.mid);
            const heavy = zoneStep(v.heavy);
            // 有一格不合法 ⇒ **一个字都不动**（宁可"没变化"，也不能把敏感带写成永远不长 ✗）
            if (light === null || mid === null || heavy === null) return t;
            const nums = [0, 1, 2, 3, 4, 5].map((i) => zoneLv(v['lv' + i], ZONE_LV_DEF[i]));
            if (nums.some((x) => x === null)) return t;   // 有一格不合法 ⇒ 一个字都不动 ✓
            // 严格递增（不然范围会倒挂：上一级的上限比下一级的起点还大 ✗）⇒ 不合法就一个字都不写
            for (let i = 1; i < nums.length; i++) if (nums[i] <= nums[i - 1]) return t;
            let lv = 0;
            const out = t
                .replace(/(- 轻度（短暂触碰\/间接刺激）→\s*\+)\d+/, `$1${light}`)
                .replace(/(- 中度（直接触碰\/持续刺激\/明显反应）→\s*\+)\d+/, `$1${mid}`)
                .replace(/(- 重度（反复刺激\/与高潮相关\/强烈反应）→\s*\+)\d+/, `$1${heavy}`)
                .replace(/(单个部位每轮最多 \+)\d+/, `$1${heavy}`);
            // ⚠️ 下半段的「等级表现参考」那几行也长着「- 5级：」⇒ 这里**必须锚住"是区间或 N 以上"**
            //   （`^-\s*(\d)级：(?:\d+-\d+|\d+\s*以上)$`），不然会把那六行描述一起改掉 ✗
            // ★ 2026-10-29：那六行不再挂「次」（那个词留给"次数"那类事实）⇒
            //   认新格式（不带 次）、也认老存档里那份（带 次）✓
            return out.replace(/^-\s*(\d)级：(?:\d+\s*-\s*\d+(?:\s*次)?|\d+\s*(?:次)?\s*以上)$/gm, (line, d) => {
                const cur = lv++;
                if (cur !== Number(d)) return line;           // 不是那六行 ⇒ 原样（保守 ✓）
                if (cur >= 5) return `- 5级：${nums[5]} 以上`;
                return `- ${cur}级：${nums[cur]}-${nums[cur + 1] - 1}`;
            });
        },
    },
    {
        // ★★ 四个基础率：
        //   这四个数是**判定用的真数**（阶段基础率 × 体质系数 × 防护系数 里的第一个因子）。
        //   以前散在三处（`settings.cycleDayInfoOf()` / [生理周期模块] 正文 / [身体补丁] 正文）✗
        //   ⇒ 现在唯一真相源＝设置在 `settings()` 里那四格：
        //     · 代码算受孕率读它（`cycleDayInfoOf` ✓）
        //     · 正文里那几处数字由 `applyCycleRateLines()` 在**发送时**按它渲染 ✓
        //     · 本面板只读写设置（**不碰正文**）⇒ 一个事实源 ✓
        //   ⚠️ 所以这里的 read 读的是 `settings()`、不是正文 —— 和别的 spec 不一样，
        //     那是因为别的 spec 的"真相源就是正文"，而这一条的真相源是设置 ✓
        moduleId: 'cycle_module',
        // ★ 这一条的真相源也是**设置**（那块"正文"只是渲染出来的样子）——
        //   它跟成就那条的区别是：cycle_module 真有补丁正文，所以 read 本来也能读；
        //   但写回走的是设置 ⇒ 用同一个标记让语义一致 ✓
        fromSettings: true,
        title: '受孕基础率与防护系数',
        desc: '各阶段每次内射的基础受孕率；下面那 8 格是各情境的防护乘数（计算和提示词正文都用这些数）',
        fields: [
            { key: 'menstrual', label: '经期', suffix: '%', type: 'number' },
            { key: 'follicular', label: '卵泡期', suffix: '%', type: 'number' },
            { key: 'window', label: '受孕窗口', suffix: '%', type: 'number' },
            { key: 'transition', label: '过渡日', suffix: '%', type: 'number' },
            // ★ 无月经档没有阶段可挑 ⇒ 单独一格（每次内射都按它算 ✓）
            { key: 'amenorrhea', label: '无月经（没有周期阶段时）', suffix: '%', type: 'number' },
            // ★ 防护系数那 8 格**并进这一条** ——
            //   ⚠️ 给它们另开一条 spec 的话**根本渲染不出来**：
            //     `renderParamFields` 只渲染 `specOf()` 拿到的**第一条** ✗
            //   ⇒ 同一 moduleId 的所有字段都收在这一条里 ✓
            { key: 'internal', label: '防护 · 内射', type: 'number' },
            { key: 'friction', label: '防护 · 外部摩擦', type: 'number' },
            { key: 'condomTorn', label: '防护 · 破损（小洞）', type: 'number' },
            { key: 'condomBurst', label: '防护 · 大面积破裂', type: 'number' },
            { key: 'condomSlipOff', label: '防护 · 掉落（有液）', type: 'number' },
            { key: 'outPull', label: '防护 · 无套外射', type: 'number' },
            // 前液也必须判：没射精、只有前液流到入口 / 外阴也算一笔 ✓
            { key: 'pre', label: '防护 · 前液接触（没射精）', type: 'number' },
            { key: 'pillShort', label: '防护 · 短效避孕药', type: 'number' },
            // ★ 2026-10-15（哪种防护措施都能用）：这一格是**一切真的挡住了**的档
            //   （屏障类、护盾、结界都归它）⇒ 标签上把那层意思写出来，
            //   不然玩家在魔法 / 古代背景下看着"避孕套味的词"以为这一格用不上 ✗
            //   ⚠️ 正文里那句「默认“完好无损”，系数 0」是面板写回的锚点，**措辞不许动** ✓
            { key: 'condomIntact', label: '防护 · 完好无损（屏障 / 护盾也算）', type: 'number' },
        ],
        // ★ 出厂值（「重置这一条」和单格 ↩ 都用它；不能读设置，读设置等于"重置回现在" ✗）
        defaults: () => {
            const out = {
                menstrual: String(CYCLE_RATE_DEF.menstrual),
                follicular: String(CYCLE_RATE_DEF.follicular),
                window: String(CYCLE_RATE_DEF.window),
                transition: String(CYCLE_RATE_DEF.transition),
                amenorrhea: String(CYCLE_RATE_DEF.amenorrhea),
            };
            for (const k of Object.keys(PROT_COEF_DEF)) out[k] = String(PROT_COEF_DEF[k]);
            return out;
        },
        read: () => {
            const s = settings();
            const out = {
                menstrual: String(s.cycleRateMenstrual ?? CYCLE_RATE_DEF.menstrual),
                follicular: String(s.cycleRateFollicular ?? CYCLE_RATE_DEF.follicular),
                window: String(s.cycleRateWindow ?? CYCLE_RATE_DEF.window),
                transition: String(s.cycleRateTransition ?? CYCLE_RATE_DEF.transition),
                amenorrhea: String(s.cycleRateAmenorrhea ?? CYCLE_RATE_DEF.amenorrhea),
            };
            for (const k of Object.keys(PROT_COEF_DEF)) {
                out[k] = String(s['prot' + k.charAt(0).toUpperCase() + k.slice(1)] ?? PROT_COEF_DEF[k]);
            }
            return out;
        },
        write: (t, v) => {
            const s = settings();
            const keys = [
                ['cycleRateMenstrual', 'menstrual'], ['cycleRateFollicular', 'follicular'],
                ['cycleRateWindow', 'window'], ['cycleRateTransition', 'transition'],
                ['cycleRateAmenorrhea', 'amenorrhea'],
            ];
            // 先全验一遍（有一格不合法 ⇒ 一个字都不动 ✓）
            const next = {};
            for (const [sk, fk] of keys) {
                const n = cycleRateNum(v[fk], CYCLE_RATE_DEF[fk]);
                if (n === null) return false;
                next[sk] = n;
            }
            for (const k of Object.keys(PROT_COEF_DEF)) {
                const n = protCoefNum(v[k], PROT_COEF_DEF[k]);
                if (n === null) return false;
                next['prot' + k.charAt(0).toUpperCase() + k.slice(1)] = n;
            }
            let changed = false;
            for (const [sk, n] of Object.entries(next)) {
                // ⚠️ 比之前把两边都归一成数字：面板传进来的是**字符串**（"8"），
                //   直接 `!==` 比数字 8 会永远"变了"⇒ 每次都回"已保存"（小事，但读数会骗人 ✓）
                if (Number(s[sk]) !== n) { s[sk] = n; changed = true; }
            }
            if (changed) save();
            return changed;                                          // 没变 ⇒ 面板显示"内容没有变化" ✓
        },
    },
    {
        // ★★ 「怀孕判定模块」那几张概率表——
        //   起因：这些数住在**正文**里，而这张卡是判定类模块 ⇒ 默认「只能改数值」档下正文被锁住，
        //   那几个数实际上**改不了**（去面板上找也找不到入口 ✗）
        //   ⇒ 照「受孕基础率与防护系数」那套做成数值面板：**面板格子与正文那几行是同一份数据**，
        //     默认档下就能改，而且以后插件更新内置正文时数字照旧留得住（`rebaseNumbers` ✓）
        //   ⚠️ 真相源是**正文**（不是设置）：`read` 走 settings.js 里那几个现成解析器
        //     （判定那一侧读的也是正文 ⇒ 一处事实源 ✓），`write` 只把数字换掉。
        //   ⚠️ 同一个 moduleId 只能有一条 spec（`specFor()` 用 `find` ⇒ 两条的话后一条渲染不出来）
        moduleId: 'pregnancy_module',
        title: '怀孕与胎儿的概率',
        desc: '胎数怎么分、同卵占多少、受精后有多少能着床、性别怎么分。这几格都是 1-100 的分界：随机数落在哪一段就是哪个结果。计算用的就是正文里那几行，改这里等于改它们。着床成功率那一格填 80 就是 80%（掷 1-100，80 及以下着床成功）；填 100 就是受精成功必定怀上。混合胎概率填 5 就是 5%（只有 3 胎以上、且判成异卵时才用；混合＝一对同卵＋其余异卵）。性别那一行是人类的写法：人类的孩子写男 / 女，非人类写雄 / 雌。天赋与显性来源那两张表在下面那张卡里',
        fields: [
            { key: 'count1', label: '单胎上限', type: 'number' },
            { key: 'count2', label: '双胎上限', type: 'number' },
            { key: 'count3', label: '三胎上限', type: 'number' },
            { key: 'ovum', label: '同卵上限', type: 'number' },
            // ★ 2026-10-23：混合胎（一对同卵 ＋ 其余异卵），只有 ≥3 胎且整胎异卵时才用
            { key: 'mix', label: '混合胎概率', suffix: '%', type: 'number' },
            // ★ 这一格填的是**成功率**（掷 1-100，≤ 这个数就着床成功）。
            //   别叫"上限"：那个说法要玩家自己推一遍才知道 80 等于 80%，读着有歧义 ✓
            { key: 'implant', label: '着床成功率', suffix: '%', type: 'number' },
            { key: 'sex', label: '男性上限', type: 'number' },
        ],
        read: () => {
            const rows = fetusCountTableOf();
            const at = (n) => { const r = rows.find((x) => x.n === n); return r ? String(r.to) : ''; };
            const ov = fetusOvumRangeOf();
            const mx = fetusMixRangeOf();
            const sx = fetusSexRangeOf();
            // 着床那一条：认得出区间就用区间上界；认不出但正文写着「1-100 着床成功」
            //   （手改过的写法）⇒ 也是 100 ＝ 没有失败档 ✓
            let im = '';
            const r = implantRangeOf();
            if (r) im = String(r.ok[1]);
            else if (/1-100\s*着床成功/.test(String(moduleText('pregnancy_module') || ''))) im = '100';
            return {
                count1: at(1), count2: at(2), count3: at(3),
                ovum: ov ? String(ov.same[1]) : '',
                mix: mx ? String(100 - mx.none[1]) : '',
                implant: im,
                sex: sx ? String(sx.male[1]) : '',
            };
        },
        write: (t, v) => {
            const num = (x) => {
                const s = String(x ?? '').trim();
                if (!s) return null;
                const n = Number(s);
                return Number.isFinite(n) ? Math.round(n) : null;
            };
            const c1 = num(v.count1), c2 = num(v.count2), c3 = num(v.count3);
            const ov = num(v.ovum), im = num(v.implant), sx = num(v.sex);
            // ★ 混合胎概率（%）：0 = 关，1~99；留空 ⇒ 不动那一行 ✓
            const mx = num(v.mix);
            const within = (x, lo, hi) => x !== null && x >= lo && x <= hi;
            // 有一格不合法 / 区间倒挂 ⇒ **一个字都不动**（宁可"没变化"，也不能写出倒挂的表 ✗）
            if (!within(c1, 1, 99) || !within(c2, 1, 99) || !within(c3, 1, 99)
                || !(c1 < c2 && c2 < c3)) return t;
            if (!within(ov, 1, 99) || !within(im, 1, 100) || !within(sx, 1, 99)) return t;
            if (mx !== null && !within(mx, 0, 99)) return t;
            let out = t;
            out = out.replace(
                /(D100\s*[：:]\s*)1-\d+(\s*单胎，)\d+-\d+(\s*双胎，)\d+-\d+(\s*三胎，)\d+-100(\s*四胎或以上[^\n]*)/,
                (m, a, b, c, d, e) => `${a}1-${c1}${b}${c1 + 1}-${c2}${c}${c2 + 1}-${c3}${d}${c3 + 1}-100${e}`);
            out = out.replace(
                /(同卵判定（D100）\s*[：:]\s*)1-\d+(\s*同卵，)\d+-100(\s*异卵)/,
                (m, a, b, c) => `${a}1-${ov}${b}${ov + 1}-100${c}`);
            // ★ 2026-10-23：混合胎那一行（老正文没有 ⇒ 补在同卵判定后面 ✓）
            if (mx !== null) {
                const safe = 100 - mx;                 // 1..safe 不混合，safe+1..100 混合
                const line = `混合胎判定（D100）：1-${safe} 不混合，${safe + 1}-100 混合`;
                if (/混合胎判定（D100）/.test(out)) {
                    out = out.replace(
                        /(混合胎判定（D100）\s*[：:]\s*)1-\d+(\s*不混合，)\d+-100(\s*混合)/,
                        (m, a, b, c) => `${a}1-${safe}${b}${safe + 1}-100${c}`);
                } else {
                    out = out.replace(/(同卵判定（D100）[^\n]*\n)/, `$1${line}\n`);
                }
            }
            out = out.replace(
                /(着床判定（D100）\s*[：:]\s*)1-\d+(\s*着床成功，)\d+\s*(?:-\s*\d+)?\s*(?:及以上\s*)?(着床失败)/,
                // ⚠️ 上限填 100 ＝ **没人够得着失败**，写成「101 及以上着床失败」。
                //   为什么不写成「永远不会失败」那种好读的话：那一改就**不是纯数字改动**了 ⇒
                //   这条补丁会被判成"改过正文"⇒ 整条冻结、玩家的改动不生效 ✗（玩家自己踩到过）
                //   为什么不写成 `101-100`：那是倒挂的区间，看着像坏了 ✗
                (m, a, b, c) => `${a}1-${im}${b}${im + 1} 及以上${c}`);
            out = out.replace(
                // ★ 三种写法都要认（新版「判为男」／老版「为雄性」／手改过的「为男性」）——
                //   只认一种的话，玩家一点这颗格子就"没反应"，看起来像坏了 ✗
                /(（1-)\d+(\s*判?为(?:雄性|男性|男)[，,])\d+(-100\s*判?为(?:雌性|女性|女)）)/,
                (m, a, b, c) => `${a}${sx}${b}${sx + 1}${c}`);
            // ★ 2026-10-24（她的判断）：天赋五档 / 显性来源这两张表属于「血脉遗传特质」，
            //   已经搬到那张卡里去了（见下面那条 spec）——这里不再写它们 ✓
            return out;
        },
    },
    {
        // ★ 2026-10-24：天赋五档 ＋ 显性来源（血脉遗传那一轮由插件掷，同卵组共一颗、异卵各一颗）
        //   ⚠️ 数据住在「血脉遗传特质」的正文里：那本书只在判遗传那一轮才发，
        //     放在怀孕判定模块里等于每轮都在告诉模型"可以自己判天赋" ✗
        moduleId: 'heritage',
        title: '血脉遗传 · 档位区间',
        desc: '天赋五档的分界，和显性来源的三个分界（随受孕方 / 随致孕方 / 两边各取）。这两组都必须从左到右递增，填错会一个字都不改。它们在「血脉遗传特质」里，只在判遗传那一轮才发给模型',
        fields: [
            { key: 'talent1', label: '天赋 · 两边都拿到上限', type: 'number' },
            { key: 'talent2', label: '天赋 · 超过一方上限', type: 'number' },
            { key: 'talent3', label: '天赋 · 跟一方一样上限', type: 'number' },
            { key: 'talent4', label: '天赋 · 还没成体系上限', type: 'number' },
            { key: 'domMat', label: '显性 · 随受孕方上限', type: 'number' },
            { key: 'domPat', label: '显性 · 随致孕方上限', type: 'number' },
        ],
        read: () => {
            const tt = talentTierTableOf();
            const ds = dominantSourceRangeOf();
            return {
                talent1: (tt[0] ? String(tt[0].to) : ''),
                talent2: (tt[1] ? String(tt[1].to) : ''),
                talent3: (tt[2] ? String(tt[2].to) : ''),
                talent4: (tt[3] ? String(tt[3].to) : ''),
                domMat: ds ? String(ds.mat[1]) : '',
                domPat: ds ? String(ds.pat[1]) : '',
            };
        },
        write: (t, v) => {
            const num = (x) => {
                const s = String(x ?? '').trim();
                if (!s) return null;
                const n = Number(s);
                return Number.isFinite(n) ? Math.round(n) : null;
            };
            const within = (x, lo, hi) => x !== null && x >= lo && x <= hi;
            let out = t;
            const t1 = num(v.talent1), t2 = num(v.talent2), t3 = num(v.talent3), t4 = num(v.talent4);
            if ([t1, t2, t3, t4].some((x) => x !== null)) {
                if (![t1, t2, t3, t4].every((x) => x !== null)) return t;
                if (!within(t1, 1, 98) || !within(t2, 2, 99) || !within(t3, 3, 99) || !within(t4, 4, 99)) return t;
                if (!(t1 < t2 && t2 < t3 && t3 < t4)) return t;
                const tt0 = talentTierTableOf();
                const defs = ['两边的天赋都拿到', '超过拿到的那一方', '跟拿到的那一方一样', '还没成体系', '只拿到一部分'];
                const L = (i) => (tt0[i] && tt0[i].label) || defs[i];
                const newLine = `天赋判定（D100）：1-${t1} ${L(0)}，${t1 + 1}-${t2} ${L(1)}，${t2 + 1}-${t3} ${L(2)}，${t3 + 1}-${t4} ${L(3)}，${t4 + 1}-100 ${L(4)}`;
                if (/天赋判定（D100）/.test(out)) {
                    out = out.replace(/天赋判定（D100）[^\n]*/, () => newLine);
                } else {
                    // 老存档没有这一行 ⇒ 补在区间表标题后面（没有标题就补在【分步 COT】前面 ✓）
                    if (!/【系统掷骰用的区间表[^\n]*】/.test(out)) {
                        out = out.replace(/(【分步 COT)/, '【系统掷骰用的区间表（你不用掷，照系统给的结果写）】\n' + newLine + '\n\n$1');
                    } else {
                        out = out.replace(/(【系统掷骰用的区间表[^\n]*】\n)/, (m) => m + newLine + '\n');
                    }
                }
            }
            const dm = num(v.domMat), dp = num(v.domPat);
            if (dm !== null || dp !== null) {
                if (dm === null || dp === null) return t;
                if (!within(dm, 1, 98) || !within(dp, 2, 99) || !(dm < dp)) return t;
                const r = dominantSourceRangeOf();
                const l1 = (r && r.matLabel) || '主要随受孕方';
                const l2 = (r && r.patLabel) || '主要随致孕方';
                const l3 = (r && r.bothLabel) || '两边各取';
                const line = `显性来源判定（D100）：1-${dm} ${l1}，${dm + 1}-${dp} ${l2}，${dp + 1}-100 ${l3}`;
                if (/显性来源判定（D100）/.test(out)) {
                    out = out.replace(/显性来源判定（D100）[^\n]*/, () => line);
                } else {
                    out = out.replace(/(天赋判定（D100）[^\n]*\n)/, (m) => m + line + '\n');
                }
            }
            return out;
        },
    },
    {
        // ★ 意识状态那五档（A~E）的**察觉时间**做成格子。
        //   每档 8 个数：怀疑 / 确认各自的**孕周起止** ＋ **着床后天数起止**。
        //   ⚠️ 全都必须单独存 —— 天数跟孕周不成比例、周区间也不是"起~起+1"
        //     （C 档 孕5-6 / 孕6-8；D 档 8-12 / 12-16）✗ ⇒ 按原文老实存 ✓
        moduleId: 'awareness',
        fromSettings: true,
        // ★ 意识状态演化那一堆可填项做一个折叠（太多了）：
        //   42 格一次铺满太扎眼（也白占 DOM）⇒ 标上 folded，由 ui-params.js 默认收起 ✓
        folded: true,
        title: '察觉档位时间',
        desc: '各档各自的参考时间：到哪个孕周 / 着床后天数，这个性格大概会开始起疑、可能去确认。它只做参考，不推进状态；状态只由剧情事件推进（验孕、就医、他人告知、身体明显变化）',
        fields: [
            { key: 'A_suspW0', label: 'A档 怀疑孕起', suffix: '周', type: 'number' },
            { key: 'A_suspW1', label: 'A档 怀疑孕止', suffix: '周', type: 'number' },
            { key: 'A_suspD0', label: 'A档 怀疑天起', suffix: '天', type: 'number' },
            { key: 'A_suspD1', label: 'A档 怀疑天止', suffix: '天', type: 'number' },
            { key: 'A_confW0', label: 'A档 确认孕起', suffix: '周', type: 'number' },
            { key: 'A_confW1', label: 'A档 确认孕止', suffix: '周', type: 'number' },
            { key: 'A_confD0', label: 'A档 确认天起', suffix: '天', type: 'number' },
            { key: 'A_confD1', label: 'A档 确认天止', suffix: '天', type: 'number' },
            { key: 'B_suspW0', label: 'B档 怀疑孕起', suffix: '周', type: 'number' },
            { key: 'B_suspW1', label: 'B档 怀疑孕止', suffix: '周', type: 'number' },
            { key: 'B_suspD0', label: 'B档 怀疑天起', suffix: '天', type: 'number' },
            { key: 'B_suspD1', label: 'B档 怀疑天止', suffix: '天', type: 'number' },
            { key: 'B_confW0', label: 'B档 确认孕起', suffix: '周', type: 'number' },
            { key: 'B_confW1', label: 'B档 确认孕止', suffix: '周', type: 'number' },
            { key: 'B_confD0', label: 'B档 确认天起', suffix: '天', type: 'number' },
            { key: 'B_confD1', label: 'B档 确认天止', suffix: '天', type: 'number' },
            { key: 'C_suspW0', label: 'C档 怀疑孕起', suffix: '周', type: 'number' },
            { key: 'C_suspW1', label: 'C档 怀疑孕止', suffix: '周', type: 'number' },
            { key: 'C_suspD0', label: 'C档 怀疑天起', suffix: '天', type: 'number' },
            { key: 'C_suspD1', label: 'C档 怀疑天止', suffix: '天', type: 'number' },
            { key: 'C_confW0', label: 'C档 确认孕起', suffix: '周', type: 'number' },
            { key: 'C_confW1', label: 'C档 确认孕止', suffix: '周', type: 'number' },
            { key: 'C_confD0', label: 'C档 确认天起', suffix: '天', type: 'number' },
            { key: 'C_confD1', label: 'C档 确认天止', suffix: '天', type: 'number' },
            { key: 'D_suspW0', label: 'D档 怀疑孕起', suffix: '周', type: 'number' },
            { key: 'D_suspW1', label: 'D档 怀疑孕止', suffix: '周', type: 'number' },
            { key: 'D_suspD0', label: 'D档 怀疑天起', suffix: '天', type: 'number' },
            { key: 'D_suspD1', label: 'D档 怀疑天止', suffix: '天', type: 'number' },
            { key: 'D_confW0', label: 'D档 确认孕起', suffix: '周', type: 'number' },
            { key: 'D_confW1', label: 'D档 确认孕止', suffix: '周', type: 'number' },
            { key: 'D_confD0', label: 'D档 确认天起', suffix: '天', type: 'number' },
            { key: 'D_confD1', label: 'D档 确认天止', suffix: '天', type: 'number' },
            { key: 'E_suspW0', label: 'E档 怀疑孕起', suffix: '周', type: 'number' },
            { key: 'E_suspW1', label: 'E档 怀疑孕止', suffix: '周', type: 'number' },
            { key: 'E_suspD0', label: 'E档 怀疑天起', suffix: '天', type: 'number' },
            { key: 'E_suspD1', label: 'E档 怀疑天止', suffix: '天', type: 'number' },
            { key: 'E_confW0', label: 'E档 确认孕起', suffix: '周', type: 'number' },
            { key: 'E_confW1', label: 'E档 确认孕止', suffix: '周', type: 'number' },
            { key: 'E_confD0', label: 'E档 确认天起', suffix: '天', type: 'number' },
            { key: 'E_confD1', label: 'E档 确认天止', suffix: '天', type: 'number' },
            { key: 'F_suspW0', label: 'F档 怀疑孕起', suffix: '周', type: 'number' },
            { key: 'F_suspW1', label: 'F档 怀疑孕止', suffix: '周', type: 'number' },
            { key: 'F_suspD0', label: 'F档 怀疑天起', suffix: '天', type: 'number' },
            { key: 'F_suspD1', label: 'F档 怀疑天止', suffix: '天', type: 'number' },
            { key: 'F_confW0', label: 'F档 确认孕起', suffix: '周', type: 'number' },
            { key: 'F_confW1', label: 'F档 确认孕止', suffix: '周', type: 'number' },
            { key: 'F_confD0', label: 'F档 确认天起', suffix: '天', type: 'number' },
            { key: 'F_confD1', label: 'F档 确认天止', suffix: '天', type: 'number' },
            { key: 'upper', label: '最晚上限', suffix: '周', type: 'number' },
            { key: 'upperDays', label: '最晚上限的天数', suffix: '天', type: 'number' },
        ],
        read: () => {
            const s = settings();
            const out = {};
            const F = ['suspW0', 'suspW1', 'suspD0', 'suspD1', 'confW0', 'confW1', 'confD0', 'confD1'];
            for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) {
                const v = (s['awarenessTier' + k] && typeof s['awarenessTier' + k] === 'object') ? s['awarenessTier' + k] : {};
                const d = AWARENESS_TIER_DEF[k];
                for (const f of F) out[k + '_' + f] = String(v[f] ?? d[f]);
            }
            out.upper = String(s.awarenessUpper ?? 32);
            out.upperDays = String(s.awarenessUpperDays ?? 203);
            return out;
        },
        write: (t, v) => {
            const s = settings();
            const int = (raw, def, lo, hi) => {
                const str = String(raw ?? '').trim();
                if (str === '') return def;
                const n = Math.round(Number(str));
                return (Number.isFinite(n) && n >= lo && n <= hi) ? n : null;
            };
            const F = ['suspW0', 'suspW1', 'suspD0', 'suspD1', 'confW0', 'confW1', 'confD0', 'confD1'];
            const next = {};
            for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) {
                const d = AWARENESS_TIER_DEF[k];
                const cur = (s['awarenessTier' + k] && typeof s['awarenessTier' + k] === 'object') ? s['awarenessTier' + k] : {};
                const row = {};
                for (const f of F) {
                    const isW = f.indexOf('W') === 2 || f.indexOf('W') === 0;   // suspW*/confW*
                    row[f] = int(v[k + '_' + f], cur[f] ?? d[f], isW ? 1 : 0, isW ? 45 : 400);
                }
                if (Object.values(row).some((x) => x === null)) return false;   // 不合法 ⇒ 不动 ✓
                if (row.suspW0 > row.suspW1 || row.confW0 > row.confW1) return false;   // 周倒挂 ⇒ 不动 ✓
                if (row.suspD0 > row.suspD1 || row.confD0 > row.confD1) return false;   // 天倒挂 ⇒ 不动 ✓
                next[k] = row;
            }
            const up = int(v.upper, s.awarenessUpper ?? 32, 1, 45);
            const upd = int(v.upperDays, s.awarenessUpperDays ?? 203, 0, 400);
            if (up === null || upd === null) return false;
            let changed = false;
            for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) {
                const cur = s['awarenessTier' + k] || {};
                const n2 = next[k];
                if (F.some((f) => Number(cur[f]) !== n2[f])) { s['awarenessTier' + k] = n2; changed = true; }
            }
            if (Number(s.awarenessUpper) !== up) { s.awarenessUpper = up; changed = true; }
            if (Number(s.awarenessUpperDays) !== upd) { s.awarenessUpperDays = upd; changed = true; }
            if (changed) save();
            // ★★ 症状是"修改之后说内容没有变化，点重置也重置不了"：
            //   **这里原来 return 的是 `t`（文本），不是 boolean** ✗✗
            //   而 `writeParams` 对设置型 spec 判的是 `spec.write(...) === true`
            //   （`fromSettings` 那条路传进来的 `t` 是空串）⇒ 永远 false ⇒
            //   ① 界面一律喊「内容没有变化」（其实设置**已经改好了**）② 连带不触发 refresh
            //   ⇒ 界面看到的就是"改了没反应、点↩也没反应" ✗。
            //   **约定**：设置型（fromSettings）的 write 必须返回"变没变"的 boolean；正文型才返回文本 ✓
            //   units 有一条**通用守卫**：所有 fromSettings 的 spec，write 的返回值必须是 boolean ✓
            return changed;
        },
    },
    {
        // ★ 成就那三个字数上限做成面板格。
        //   起因：规则句里写「名字 ≤8 字 / 依据 ≤20 字 / 吐槽 ≤90 字」，而 store.js 那边的
        //   兜底截断是 24/60/80 —— **两套数**（代码是故意放宽的保险丝 ✓，但玩家看不出区别）⇒
        //   现在三个数由设置说了算、规则句按它渲染，面板上也能调 ✓
        //   ⚠️ moduleId 用 `__ach__`（成就不是 modules.js 里的模块，它的文案住在 settings.js 的
        //     ACH_STRUCT / ACH_STYLE_DEFAULT，卡片由 ui-ach.js 画 ⇒ 这是个虚 id，和
        //     `__fields__` / `__tpl__` 那类页签一个写法 ✓）
        moduleId: '__ach__',
        // ★ 这一条的**真相源是设置、不是补丁正文** ——
        //   `__ach__` 不是 modules.js 里的模块、根本没有"补丁原文"可定位 ⇒
        //   不加这个标记的话，面板会走"先去正文找这些参数"那条路、永远找不到 ⇒
        //   显示成「没能在补丁文本里找到这些参数」✗）
        fromSettings: true,
        title: '成就字数上限',
        desc: '成就提示词里那三个上限（改这里，发给推演的规则句跟着变；你自己改过吐槽风格时，吐槽那个上限就不再影响它）',
        fields: [
            { key: 'name', label: '名字上限', suffix: '字', type: 'number' },
            { key: 'why', label: '依据上限', suffix: '字', type: 'number' },
            { key: 'quip', label: '吐槽上限', suffix: '字', type: 'number' },
        ],
        // ★ 出厂值（同上：不能读设置，否则「重置这一条」等于什么都没做 ✗）
        defaults: () => ({
            name: String(ACH_LEN_DEF.name),
            why: String(ACH_LEN_DEF.why),
            quip: String(ACH_LEN_DEF.quip),
        }),
        read: () => {
            const s = settings();
            return {
                name: String(s.achNameMax ?? ACH_LEN_DEF.name),
                why: String(s.achWhyMax ?? ACH_LEN_DEF.why),
                quip: String(s.achQuipMax ?? ACH_LEN_DEF.quip),
            };
        },
        write: (t, v) => {
            const s = settings();
            let changed = false;
            for (const [sk, fk] of [['achNameMax', 'name'], ['achWhyMax', 'why'], ['achQuipMax', 'quip']]) {
                const n = achLenNum(v[fk], ACH_LEN_DEF[fk]);
                if (n === null) return false;          // 不合法 ⇒ 一个字都不动 ✓
                if (Number(s[sk]) !== n) { s[sk] = n; changed = true; }
            }
            if (changed) save();
            return changed;
        },
    },
    {
        // ★★ 近期性行为「显示条数」（2026-10-17 改）：记录归插件、这个数只管**露出几条**。
        //   以前它是"改正文里的数字"（正文写着最近 1~3 次 / 最多保留 3 条）——
        //   现在 AI 每轮只写最近这一条、历史由插件的清单负责 ⇒
        //   这个数不再是提示词的一部分，改成一个**真正的设置格**（`recentSexKeep`）✓
        //   ⚠️ 所以它是 `fromSettings`：读写都不碰模块正文（正文里已经没有这个数了 ✓）
        moduleId: 'row_sex',
        title: '近期性行为参数',
        desc: '面板里显示最近几条。记录本身由插件一直留着，这里只决定露出多少',
        fromSettings: true,
        fields: [
            { key: 'keep', label: '显示条数', suffix: '条', type: 'number' },
        ],
        read: () => ({ keep: String(recentSexKeep()) }),
        write: (t, v) => {
            const n = keptRows(v.keep);
            if (n === null) return false;               // 不合法 ⇒ 一个字都不动 ✓
            const s = settings();
            if (Number(s.recentSexKeep) === n) return false;
            s.recentSexKeep = n;
            save();
            return true;
        },
    },
    {
        moduleId: 'zones_custom',
        title: '敏感带初始设定',
        desc: '一行一个部位。填了等级或累计刺激的会参与数值追踪；只写备注的就只影响描写。未列出的部位默认 0 级',
        kind: 'list',
        // 锚点用**标题行**，不用那句「（在此行下方填写）」——
        // 那句是给玩家看的位置提示，会被原样发给 AI，纯属噪音。
        // 老数据里可能还留着它，readRegion/writeRegion 会自动跳过（见 LEGACY_REGION_FILLER）。
        // 锚点可以给**多个候选**（按顺序找第一个命中的）。
        // 为什么要多个：老版本用的是「（在此行下方填写）」，用户设置里可能存着
        // 那时留下的文案覆盖；只认新锚点的话，写入会返回 false → 界面显示「保存失败」，
        // 而且**切换模块开关会让刚填的内容看起来被清空了**（其实是根本没写进去）。
        region: {
            start: ['[敏感带自定义 · 初始设定]\n', '【{{user}} 的敏感带初始设定】\n', '（在此行下方填写）\n', '[敏感带初始设定]\n'],
            end: ['\n【AI 使用规则】', '\n【AI 使用规则】\n'],
        },
        columns: [
            { key: 'name', label: '部位', flex: '1.3fr', placeholder: '乳尖' },
            { key: 'level', label: '等级', flex: '.6fr', type: 'number', placeholder: '0', suffix: '级' },
            { key: 'count', label: '累计刺激', flex: '.9fr', type: 'number', placeholder: '0' },
            { key: 'note', label: '备注（可选，只影响描写）', flex: '1.6fr', placeholder: '被碰到会轻微发抖' },
        ],
        alwaysShow: true,
    },
    {
        // ★★ 2026-10-15（让玩家能编辑这五个等级的效果）——
        //   这条模块的正文**本身就是给玩家改的内容**（各等级被碰到时什么表现）⇒ 面板上给 6 个文本格 ✓
        //   实现取巧：`numberFields` 里"既不是 number 也不是 select"的字段本来就渲染成文本输入框 ✓
        //   ⇒ 不用给参数面板加新类型 ✓；读写拿 `- N级：xxx` 这一行的**等级数字当锚点**替换 ✓
        //   （跟"防护系数"那套一个手法；⚠️ 正则必须只吃**这一行**，绝不能跨行 ✗
        //     —— 同一个模块里"等级阈值表"那 6 行也长着 `- 0级：…`，跨行就会把它一起改坏 ✗）
        //   ⚠️ 它 role 是 both（会进插件 API）⇒ 在 `isPatchLocked` 里给它开了例外，
        //     不然「只能改数值」档会把玩家改的这几行冻掉 ✗（见 settings.js 那条的说明）
        moduleId: 'zone_levels',
        title: '敏感带等级表现参考',
        desc: '各等级被碰到时的表现（0-5 级各一行）。写正文的主 API 和负责计算的插件 API 都会看它',
        // ★ 每格都 `wide: true`（各自占一整行）—— 等级表现是整句话，挤成两列会看不全 ✗
        //   （触碰即明显反应，呼吸变浅、✗）
        fields: [
            { key: 'lv0', label: '0级', type: 'text', wide: true },
            { key: 'lv1', label: '1级', type: 'text', wide: true },
            { key: 'lv2', label: '2级', type: 'text', wide: true },
            { key: 'lv3', label: '3级', type: 'text', wide: true },
            { key: 'lv4', label: '4级', type: 'text', wide: true },
            { key: 'lv5', label: '5级', type: 'text', wide: true },
        ],
        // 读：每一级那一行的后半截（**只匹配"这一行就是 - N级：…"** ⇒ 不会碰到别处 ✓）
        read: (t) => {
            const out = {};
            for (let i = 0; i <= 5; i++) {
                const m = String(t || '').match(new RegExp('^-\\s*' + i + '级[：:]\\s*(.*)$', 'm'));
                out['lv' + i] = m ? m[1].trim() : '';
            }
            return Object.values(out).some(Boolean) ? out : null;
        },
        // 写：只换每一级那一行的内容；**空值不动那一行**（保住 6 行结构 ✓）
        write: (t, v) => {
            let out = String(t || '');
            for (let i = 0; i <= 5; i++) {
                const val = String((v && v['lv' + i]) || '').trim();
                if (!val) continue;
                out = out.replace(new RegExp('^(-\\s*' + i + '级[：:]\\s*).*$', 'm'), (s, p1) => p1 + val);
            }
            return out;
        },
    },
];

export function specFor(moduleId) {
    return PARAM_SPECS.find(s => s.moduleId === moduleId) || null;
}

// ---------------------------------------------------------------------------
// ★ 工厂默认值登记表（给每个条目增加一个单独的重置按键，
//   重置全部要留，但每个也得单独有重置）
//
// 用途：面板上每一格右边那颗「↩」用它知道"恢复成多少" ✓
//   ⚠️ 这里的值**不是另外抄一份**，而是**出厂正文 / 设置读出来的那一份**：
//     正文类 spec 的默认值就在内置正文里（写死的那几行），设置类在 settings() 里 ✓
//     ⇒ 内置正文改了措辞，这里不用跟着改（只有"数字本身变了"才要动 ✓）
//
// ⚠️ 没登记在表里的字段，走 `fieldDefaultOf()` 的**回退**：出厂正文里那一格是什么就算什么
//   （除了数值也得给单独的重置 ✓ —— 早先"没登记的就不画那颗按钮"的口径已作废 ✗）
// ---------------------------------------------------------------------------
export const FIELD_DEFAULTS = {
    body_base: () => ({ cycle: '28', ovu: '14', base: '1.0', peak: '1.5' }),
    period_patch: () => ({ days: '5' }),
    body_trace: () => ({ light: '1', mid: '3', heavy: '6', deep: '12' }),
    lactation_patch: () => ({ rate: '5-15', burst: '60-150', total: '300-500' }),
    postpartum_system: () => ({
        flowStart: '2', growthStart: '14', stableStart: '30',
        colostrum: '50-150', stable: '500-1000', multi: '1.5-2.5',
    }),
    zones_record: () => ({ light: '1', mid: '2', heavy: '3', lv0: '0', lv1: '5', lv2: '21', lv3: '51', lv4: '101', lv5: '181' }),
    cycle_module: () => ({
        menstrual: String(CYCLE_RATE_DEF.menstrual), follicular: String(CYCLE_RATE_DEF.follicular),
        window: String(CYCLE_RATE_DEF.window), transition: String(CYCLE_RATE_DEF.transition),
        ...Object.fromEntries(Object.keys(PROT_COEF_DEF).map((k) => [k, String(PROT_COEF_DEF[k])])),
    }),
    awareness: () => {
        const out = {};
        for (const k of ['A', 'B', 'C', 'D', 'E']) {
            const d = AWARENESS_TIER_DEF[k];
            for (const f of ['suspW0', 'suspW1', 'suspD0', 'suspD1', 'confW0', 'confW1', 'confD0', 'confD1']) {
                out[k + '_' + f] = String(d[f]);
            }
        }
        out.upper = '32';
        out.upperDays = '203';
        return out;
    },
    // ★ 三个字数上限的出厂值**只认 `ACH_LEN_DEF` 那一处** ——
    //   以前这里写死 '8' / '20' / '90'，改了出厂默认它不跟着走 ⇒
    //   点「重置这一条」写回去的还是旧数，界面还提示"本来就是默认值" ✗（2026-10-23 踩的）
    __ach__: () => ({ name: String(ACH_LEN_DEF.name), why: String(ACH_LEN_DEF.why), quip: String(ACH_LEN_DEF.quip) }),
    row_sex: () => ({ keep: '3' }),
    // ★ 怀孕与胎儿的概率（数值面板）：出厂值就是内置正文里那几个数 ✓
    pregnancy_module: () => ({ count1: '78', count2: '94', count3: '98', ovum: '33', implant: '80', sex: '50' }),
    // ★ 敏感带等级表现参考（2026-10-15）：6 格的默认值 ＝ **内置正文里那 6 行** ✓
    //   ⚠️ 取的是 `MODULE_MAP` 里的**内置正文**，不是 `moduleText()`（那个会把玩家改过的算进默认 ✗）
    zone_levels: () => {
        const out = {};
        const t = (MODULE_MAP.zone_levels && MODULE_MAP.zone_levels.text) || '';
        for (let i = 0; i <= 5; i++) {
            const m = t.match(new RegExp('^-\\s*' + i + '级[：:]\\s*(.*)$', 'm'));
            out['lv' + i] = m ? m[1].trim() : '';
        }
        return out;
    },
};

/**
 * 这一格的出厂默认值；读不到就返回 null（面板就不画那颗按钮 ✓）
 *
 * **除了数值，文字 / 下拉那些条目也要有自己单独的重置**
 *   （「除了数值也得给单独的重置啊」✓）⇒ 没登记在 `FIELD_DEFAULTS` 里的字段，
 *   从这里**回出厂正文里读那一格**当默认值 ✓（内置正文改了措辞这儿自动跟上 ✓）
 *   ⚠️ 读的是 `MODULE_MAP[id].text`（**内置**那份），不是 `moduleText()`
 *     —— 后者会把玩家自己改过的那份算成：默认 ⇒ 点了等于没变 ✗
 */
export function fieldDefaultOf(moduleId, fieldKey) {
    try {
        const f = FIELD_DEFAULTS[moduleId];
        if (f) {
            const v = f();
            if (v && v[fieldKey] !== undefined) return String(v[fieldKey]);
        }
        const spec = specFor(moduleId);
        // ★★ 真相源是**设置**的那种条目（`fromSettings`），它的 `read()` 读的是**当前设置**，
        //   拿当前值当"默认值"就等于"重置回现在" ⇒ 那颗「↩ 重置这一条」永远不会变
        //   （2026-10-23 实证：成就字数上限 90 点了重置，提示"本来就是默认值"，值一动没动 ✗）
        //   ⇒ 它必须自己声明一份 `defaults()`，这里优先读它 ✓
        if (spec && typeof spec.defaults === 'function') {
            const d = spec.defaults();
            if (d && d[fieldKey] !== undefined) return String(d[fieldKey] ?? '');
        }
        const builtin = (spec && typeof spec.read === 'function')
            ? spec.read(String((MODULE_MAP[moduleId] && MODULE_MAP[moduleId].text) || ''))
            : null;
        if (builtin && builtin[fieldKey] !== undefined) return String(builtin[fieldKey] ?? '');
        return null;
    } catch { return null; }
}

// ---------------------------------------------------------------------------
// ★ 「受孕体质档」：推演按角色设定判一个档，插件把档换成数值写进身体补丁
//
// 让 AI 判断受孕体质 —— 角色设定明显很弱（怀孕能力之类的）
//   或者很强的，AI 可以自己填写这个角色（NPC）的初始体质 ✓
//
// 为什么让 AI 只报**档位词**、数值由这里给：
//   体质系数是受孕率公式里的**乘数**（阶段基础率 × 体质系数 × 防护系数），
//   基础率已经按既定口径调好 ⇒ 档开太宽等于把难度冲掉 ✗
//   所以范围由代码夹住（0.8 ~ 1.3），AI 只回答"很弱 / 偏弱 / 标准 / 偏强 / 很强" ✓
//
// ⚠️ 只管 NPC：用户本人那份身体补丁存在**全局设置**里、穿所有聊天
//   ⇒ 这一期不动它（要动的只是"这个角色的（NPC）初始体质" ✓）
// ⚠️ 玩家手改过（`fertilityManual`）⇒ 只记档、不写值（手改锁，照敏感带那套 ✓）
// ---------------------------------------------------------------------------

/** 档位 ⇄ 体质系数（顺序＝从弱到强，界面按这个顺序展示 ✓） */
export const FERTILITY_TIERS = [
    ['很弱', 0.8],
    ['偏弱', 0.9],
    ['标准', 1.0],
    ['偏强', 1.15],
    ['很强', 1.3],
];

/** 档位词 → 数值（认不出来 ⇒ null，别拿它写数据 ✗） */
export function fertilityCoefOfTier(word) {
    const w = String(word ?? '').trim();
    const hit = FERTILITY_TIERS.find(([name]) => w === name);
    return hit ? hit[1] : null;
}

/** 档位词 → 规范写法（模型可能写成「偏强（生育能力强）」这种 ⇒ 认开头那个词 ✓） */
export function normalizeFertilityTier(word) {
    const w = String(word ?? '').trim();
    const hit = FERTILITY_TIERS.find(([name]) => w.startsWith(name));
    return hit ? hit[0] : '';
}

/**
 * 把「日常体质系数」写成指定数值。
 *
 * ⚠️ 必须带上**读出来的整份数值**再写：`spec.write` 里那一行
 *   `out.replace(PEAK_WRITE, $1${v.peak || 1.5})` 是**无条件执行**的 ⇒
 *   只传 `{ base }` 会把「排卵日暴击」悄悄改成 1.5（玩家自己调过的就丢了 ✗）
 *
 * @param {{onlyIfDefault?: boolean}} [opts]
 *   `onlyIfDefault` = **推演报档那条路**用的闸：只有这一格还是出厂那个 1.0 才敢写 ✓
 *   （玩家在别处，比如「全文」里自己写过一个数 ⇒ 一个字都不许覆盖 ✗ 红线）
 *   界面上的「恢复按设定判」不加这个闸 —— 那是玩家当场点的动作 ✓
 */
export function writeFertilityCoef(key, coef, opts = {}) {
    const spec = specFor('body_base');
    if (!spec || !key) return false;
    const cur = readParams(spec, key);
    if (!cur) return false;                        // 那段正文被改烂了 ⇒ 不硬写
    if (Number(cur.base) === Number(coef)) return false;   // 已经就是这个数 ⇒ 一个字不动
    if (opts.onlyIfDefault && Number(cur.base) !== 1) return false;
    return writeParams(spec, key, { ...cur, base: coef });
}

/**
 * 推演报了一个受孕体质档 ⇒ 记下来，并（在玩家没手改过时）写进那个对象的身体补丁。
 * ✅ 只动**这一个对象**那一份，绝不碰别人、也绝不碰全局那份（红线 ✓）
 */
export function applyFertilityTierReport(key, word) {
    if (!key || isUserKey(key)) return false;       // 本人那份不动
    const tier = normalizeFertilityTier(word);
    if (!tier) return false;                        // 没报 / 认不出来 ⇒ 什么都不做（下轮再试 ✓）
    setFertilityTierOf(key, tier);
    if (fertilityManualOf(key)) return true;        // 玩家改过 ⇒ 只记档、不写值 ✓
    return writeFertilityCoef(key, fertilityCoefOfTier(tier), { onlyIfDefault: true });
}

/** 这个对象还没定过档（推演名单里有这种人时，契约才多问那一行 ✓） */
export function needsFertilityTier(key) {
    if (!key || isUserKey(key)) return false;
    if (fertilityTierOf(key)) return false;
    return !fertilityManualOf(key);
}

/** 察觉档位：字母 ＋ 它在面板上显示的名字（顺序＝从最早察觉到最晚 ✓） */
export const AWARENESS_TIERS = [
    ['A', '极早'], ['B', '较早'], ['C', '普通'], ['D', '较晚'], ['E', '极晚'], ['F', '几乎到生产'],
];

/** 察觉档位那一格的中文名（认不出 ⇒ 空串 ✓） */
export function awarenessTierNameOf(letter) {
    const hit = AWARENESS_TIERS.find(([k]) => k === String(letter ?? '').trim().toUpperCase());
    return hit ? hit[1] : '';
}

/**
 * 推演报的察觉档位词 → 规范字母（认不出 ⇒ 空串，**别拿它写数据** ✗）。
 * 认字母（A~E）也认词（极早 / 较早 / 普通 / 较晚 / 极晚）—— 兼容两种写法 ✓
 */
export function normalizeAwarenessTier(word) {
    const w = String(word ?? '').trim().toUpperCase();
    if (!w) return '';
    const byLetter = AWARENESS_TIERS.find(([k]) => w === k);
    if (byLetter) return byLetter[0];
    const hit = AWARENESS_TIERS.find(([, name]) => w.startsWith(name));
    return hit ? hit[0] : '';
}

/**
 * 推演报了一个察觉档位 ⇒ 记下来（定过就不再问 ✓）。
 * ★ 改判通道：以后剧情 / 设定上有了更准的判断，模型可以再报一次，以新的为准 ✓
 *   （跟 `race` / `impregnator_side` 那两格同一条做法 ✓）
 */
export function applyAwarenessTierReport(key, word) {
    if (!key) return false;
    const id = normalizeAwarenessTier(word);
    if (!id) return false;                          // 没报 / 认不出来 ⇒ 什么都不做（下轮再试 ✓）
    return setAwarenessTierIdOf(key, id);
}

/**
 * 「剧情强制提前」那一格（验孕 / 就医 / 他人告知）⇒ 记下来。
 * 只认「怀疑」「确认」两个词（其余当没报）—— 记的时候**只前进不后退** ✓
 */
export function applyAwarenessEventReport(key, word) {
    if (!key) return false;
    const w = String(word ?? '').trim();
    if (!w || w === '无') return false;
    const hit = w.startsWith('确认') ? '确认' : (w.startsWith('怀疑') ? '怀疑' : '');
    if (!hit) return false;
    return noteAwarenessEvent(key, hit);
}

/** 这个对象还没定过察觉档位 ⇒ 契约里才问那一格（跟 `needsFertilityTier` 同一套做法 ✓） */
export function needsAwarenessTier(key) {
    if (!key) return false;
    return !awarenessTierIdOf(key);
}

/**
 * 「敏感带等级阈值表」—— 那张 6 行的等级表做成面板字段。
 *
 * **为什么只存「起始次数」不存范围**（这是当初没做的那道坎的解法）：
 *   表里行的是「0级 0-4次 / 1级 5-20次 / …」= 6 行 × 2 个数，相邻边界会互相矛盾 ✗
 *   ⇒ 只让玩家填**每级的起点**（0/5/21/51/101/181），**范围由相邻两级算出来**（上一级的起点 − 1）
 *   ⇒ **矛盾在定义上就不存在**，唯一的约束只剩「严格递增」✓
 *
 * ⚠️ **没有任何代码读这张表** —— 等级是 AI 照正文判的（这张表是纯文字）
 *   ⇒ 做成字段只影响 AI 看到的正文，不牵动任何计算 ✓
 * ⚠️ 第 5 级没有上限 ⇒ 只有它写「N次以上」，前面几级一律写成区间 ✓
 */
function zoneLv(raw, def) {
    const s = String(raw ?? '').trim();
    if (s === '') return def;              // 空 ⇒ 回出厂（跟别的几格一个待遇 ✓）
    const n = Math.round(Number(s));
    if (!Number.isFinite(n) || n < 0 || n > 9999) return null;   // 认不出来 ⇒ null（一个字都不写）
    return n;
}

/** ⚠️ 出厂六级起点已经搬进 settings.js（解析要和插件共用一份 ✓）—— 这里只是**转出去**，
 *   免得别处 `import { ZONE_LV_DEF } from './params.js'` 断掉 ✓ */
export { ZONE_LV_DEF };

/**
 * 「阶段基础率」那一格的合法值：夹 0~1000 的整数，认不出来 ⇒ null（一个字都不写）。
 * ⚠️ 0 是**合法**的（"这一段不发生关系"的极端玩法 ✓），负数 / 乱填才算不合法 ——
 *   别把 0 当空值处理（那会让玩家没法把经期设成 0% ✗）。
 * 空串 ⇒ 回出厂默认（和别的几格一个待遇 ✓）。
 */
function cycleRateNum(raw, def) {
    const s = String(raw ?? '').trim();
    if (s === '') return def;
    const n = Math.round(Number(s));
    if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
    return n;
}

/** 成就那三个字数上限的合法值：1~500 的整数，空 ⇒ 回出厂，认不出来 ⇒ null（不写 ✓） */
function achLenNum(raw, def) {
    const s = String(raw ?? '').trim();
    if (s === '') return def;
    const n = Math.round(Number(s));
    if (!Number.isFinite(n) || n < 1 || n > 500) return null;
    return n;
}

/**
 * 防护系数（乘数）的合法值：0~10，保留两位小数，空 ⇒ 回出厂，认不出来 ⇒ null（不写 ✓）。
 * ⚠️ 0 是**合法**的（"完好无损"那格出厂就是 0 ✓）⇒ 别把 0 当空值挡掉 ✗
 */
function protCoefNum(raw, def) {
    const s = String(raw ?? '').trim();
    if (s === '') return def;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 10) return null;
    return Math.round(n * 100) / 100;
}

/**
 * 「row3 保留几条」的合法值：夹到 1~9，认不出来 ⇒ null（一个字都不写）。
 *
 * 为什么夹：填 0 等于"不记性行为"（面板那一行永远空着 ✗）；填太大则每轮都要多写好几条，
 * 白烧输出 token。出厂 3，和模块正文、契约里那两处原本的数完全一致 ✓
 */
function keptRows(raw) {
    const n = Math.round(Number(String(raw ?? '').trim()));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(9, n);
}

/** 出厂值（模块正文与契约都从它出发 ✓） */
export const ROW3_KEEP_DEF = 3;

/**
 * 「近期性行为显示几条」——**唯一真相源是设置**（`settings().recentSexKeep`，
 * 参数面板那一格就是它 ✓）。
 *
 * ⚠️ 2026-10-17 起：记录归插件的清单管，AI 每轮只写最近这一次 ⇒
 *   这个数**不再是提示词的一部分**（以前它写在模块正文里、契约里还有两处引用 ✗）。
 *   现在契约里也不问条数了，所以 `@@ROW3_KEEP@@` 这一层已经不需要了 ✓
 */
export function recentSexKeep() {
    const n = keptRows(settings().recentSexKeep);
    return n === null ? ROW3_KEEP_DEF : n;
}

/**
 * 「每轮开发次数增量」（敏感带）的合法值：夹到 1~9，认不出来 ⇒ null（一个字都不写）。
 *
 * 为什么要夹：填 0 / 负数会让敏感带**永远不长**（比填错更难查 ✗）；
 * 填得像 99 则一轮就从 0 级冲到 5 级，那张【等级阈值表】等于白做 ✗
 */
function zoneStep(raw) {
    const n = Math.round(Number(String(raw ?? '').trim()));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(9, n);
}

/**
 * 「某一档痕迹要几夜降一档」的合法值。
 *
 * 空 ⇒ 用出厂值（轻度 1 / 中度 3 / 重度 6 / 深层 12）；其余夹到 1~30 夜。
 * ⚠️ 0 必须夹成 1，不能当"空"处理 —— 填 0 会让痕迹永远不消（比填错更难查 ✗）；
 *   填太大等于一觉睡醒全没了 ✗
 */
function clampTraceNights(raw, def = 1) {
    const s = String(raw ?? '').trim();
    if (s === '') return def;
    const n = Number(s);
    if (!Number.isFinite(n)) return def;
    return Math.max(1, Math.min(30, Math.round(n)));
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

/**
 * 取某个 spec 对应的文本。
 *
 * ⚠️ 敏感带（zones_custom）是个例外：它**按"是谁的"存**（照「角色基础信息」那套 ✓）。
 *   完全可以复制"人物基础"那个想法 ——
 *   所以优先级是：这个对象那一份 → 老的"本聊天一份"（兜底，老数据不许丢 ✓）→ 全局档案 / 默认文案。
 *   这样在聊天 A 里给「丽娜」改敏感带，不会影响聊天 B 的丽娜、也不会动别的对象 ✓。
 */
export function textOf(spec, targetKey) {
    if (spec.moduleId === 'zones_custom') {
        const own = zoneTextOf(targetKey || null);
        if (own) return own;
    }
    return moduleText(spec.moduleId, targetKey || null) || '';
}

/** 读数值型参数 */
export function readParams(spec, targetKey) {
    // ★ 真相源是**设置**的那几条（`fromSettings`）直接读 spec.read（不碰正文）——
    //   它们要么没有补丁正文（`__ach__` 这种虚 id），要么正文只是渲染出来的样子 ✓
    if (spec?.fromSettings) {
        try {
            const v = spec.read('');
            if (!v) return null;
            if (Object.values(v).every((x) => !String(x).trim())) return null;
            return v;
        } catch { return null; }
    }
    const t = textOf(spec, targetKey);
    if (!t) return null;
    try {
        const v = spec.read(t);
        if (!v) return null;
        // 空值就算解析失败
        if (Object.values(v).every(x => !String(x).trim())) return null;
        return v;
    } catch { return null; }
}

/**
 * 写数值型参数。
 *
 * ⚠️⚠️ **读**出来的那份是"替换过 @@ 占位符"的正文（面板上要给人看人话 ✓），
 *   但**写回必须用原文** ✗ —— 否则改一次数字就把那份正文里的占位符**烤死**：
 *   之后切「非月经模式」这条模块再也不会换名字（无月经的人照样收到"经血/排卵日"），
 *   而且这份被烤过的正文会被人物档案当成"改过"带走、还会让「只改数字」的冻结判据失效 ✓
 *   （数值锚点本身在设计上就是**字面数字**、不是占位符 ⇒ 在原文里照样匹配得到 ✓
 */
export function writeParams(spec, targetKey, values) {
    // ★ 真相源是**设置**的那几条 ⇒ 直接调 spec.write（它自己知道变没变 ✓）——
    //   走下面那条"比较正文文本"的路会永远说 true（正文压根不变），面板每次都喊"已保存" ✗
    if (spec?.fromSettings) {
        try { return spec.write('', values) === true; } catch { return false; }
    }
    const before = writeSourceOf(spec, targetKey);
    const after = spec.write(before, values);
    // ★ 动过「这个角色的种族」那格就打个标记（所有编辑器都走这条 ⇒ 一网打尽 ✓）——
    //   不然"选了人类（正好是出厂值）"会被当成"没改过" ✗
    if (spec?.moduleId === 'body_base' && values && ('raceName' in values)) {
        try { setRaceManualOf(targetKey || null, true); } catch { /* 忽略 */ }
    }
    if (after === before) return false;
    setModuleText(spec.moduleId, after, targetKey || null);
    return true;
}

/** 写回时要动的那一份文本：敏感带走"按人存"的那份，其余一律用**未替换占位符**的原文 ✓
 *  ⚠️⚠️ `{ rebase: false }` 不能省 —— 参数面板读写必须是**存着的那份原文**：
 *    用"套回内置正文"的那份会让数字改动**永远存不住**（见 moduleTextRaw 顶上那段说明，
 *    症状是恢复默认值没反应，根因就是这条链 ✗） */
function writeSourceOf(spec, targetKey) {
    if (spec.moduleId === 'zones_custom') return textOf(spec, targetKey);
    return moduleTextRaw(spec.moduleId, targetKey || null, { rebase: false }) || '';
}

/** 读自由填写区（敏感带初始化） */
/**
 * 老版本的自由填写区里带着一句给玩家看的占位符：「（在此行下方填写）」。
 * 锚点换掉之后它会被当成内容读出来，所以在读出/写入时都跳过它。
 */
const LEGACY_REGION_FILLER = /^\s*（在此行下方填写）\s*\n?/;

/**
 * 在文本里找一个能用的区间锚点。
 *
 * `start` / `end` 都可以是字符串或字符串数组 —— 数组按顺序找第一个命中的。
 * 这样老文案（旧锚点）和默认文案（新锚点）都能读写。
 */
function pickAnchor(t, anchors) {
    const list = Array.isArray(anchors) ? anchors : [anchors];
    for (const a of list) {
        if (!a) continue;
        const i = t.indexOf(a);
        if (i >= 0) return { text: a, at: i };
    }
    return null;
}

export function readRegion(spec, targetKey) {
    const t = textOf(spec, targetKey);
    if (!t) return '';
    const s0 = pickAnchor(t, spec.region.start);
    if (!s0) return '';
    const start = s0.text;
    const i = s0.at;
    const e0 = (() => {
        const list = Array.isArray(spec.region.end) ? spec.region.end : [spec.region.end];
        for (const a of list) { if (!a) continue; const k = t.indexOf(a, i + start.length); if (k >= 0) return k; }
        return -1;
    })();
    const from = i + start.length;
    const j = e0;
    const body = j < 0 ? t.slice(from) : t.slice(from, j);
    return stripLegacyTailBlocks(body).replace(/^\n+/, '').replace(LEGACY_REGION_FILLER, '').replace(/\s+$/, '');
}

/** 写自由填写区 */
export function writeRegion(spec, targetKey, value) {
    const t = textOf(spec, targetKey);
    const s0 = pickAnchor(t, spec.region.start);
    if (!s0) {
        console.warn('[Bodycord] 找不到自由填写区的锚点，这一块写不进去');
        return false;
    }
    const start = s0.text;
    const i = s0.at;
    const endList = Array.isArray(spec.region.end) ? spec.region.end : [spec.region.end];
    let e0 = -1;
    for (const a of endList) { if (!a) continue; const k = t.indexOf(a, i + start.length); if (k >= 0) { e0 = k; break; } }
    const from = i + start.length;
    const j = e0;
    const tail = stripLegacyTailBlocks(j < 0 ? '' : t.slice(j)).replace(/\s+$/, '');
    // 写之前先把老占位符清掉，免得它一直留在文本里
    const cleaned = String(value || '').replace(LEGACY_REGION_FILLER, '').replace(/\s+$/, '');
    const next = t.slice(0, from) + '\n' + cleaned + '\n' + tail;
    // 敏感带写进**这个对象自己那一份**（用户本人 ⇒ 全局、NPC ⇒ 本聊天档案 ✓
    //   见 store.js 的 zoneTextOf：老的"本聊天一份"仍然兜底，老数据不丢 ✓）
    if (spec.moduleId === 'zones_custom') {
        setZoneTextOf(targetKey || null, next);
        setZonePresetOf(targetKey || null, '');   // 手改过就不再算「来自某个档案」
    } else {
        setModuleText(spec.moduleId, next, targetKey || null);
    }
    return true;
}

// ---------------------------------------------------------------------------
// 敏感带：结构化行 ⇄ 文本
//   解析：文本 → 表格行；生成：表格行 → 拼回补丁的文本
// ---------------------------------------------------------------------------

/** ⚠️ 这两个已经挪进 settings.js（乙-2b：插件也要用同一份解析 ✓）—— 这里转出去，
 *   免得别处 `import { parseZoneRows, serializeZoneRows } from './params.js'` 断掉 ✓ */
export { parseZoneRows, serializeZoneRows };

/** 读敏感带表格（对象级没内容时回退到全局，避免空的对象覆盖挡住全局） */
export function readZoneRows(spec, targetKey) {
    let rows = parseZoneRows(readRegion(spec, targetKey));
    if (!rows.length && targetKey) rows = parseZoneRows(readRegion(spec, null));
    return rows;
}

/** 写敏感带表格 */
export function writeZoneRows(spec, targetKey, rows) {
    return writeRegion(spec, targetKey, serializeZoneRows(rows));
}
