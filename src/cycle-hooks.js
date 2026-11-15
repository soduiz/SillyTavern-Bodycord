// 周期相关的跨模块小钩子（2026-11-08）
//
// 为什么单独一个文件：settings.js 和 store.js 是**互相 import** 的环，
//   在 store 模块体里调用 settings 导出的 setter 会撞 TDZ（那边的 let 还没初始化）；
//   这个文件两边都不 import，谁先加载都拿得到同一个空对象 ⇒ 往上面挂读取器最稳 ✓
//
// 挂什么：
//   ovuMode(key)      ⇒ 'induced' / 'cyclic'（codex-values 读图鉴「排卵方式」）
//   inducedParams(key)⇒ { rate:[min,max], delay:[min,max] }（codex-values 读两格区间）
//   inducedDay(key)   ⇒ { day } （store 算：本周期交配后排卵已经排在第几天）
//
// ★ 2026-11-13（2.7 经期波动 第一批）：
//   regularCodex(key) ⇒ 图鉴「经期规律度」那一格的字（codex-values 挂）
//   regularTier(key)  ⇒ 个人那一层选的档位 id（store 挂；'' = 没选）
//   regularRange(key) ⇒ 个人填的自定义范围 { lo, hi }（store 挂；null = 没填）
//   cycleNow(key)     ⇒ 本周期已经记下来的 { cycle, ovu }（store 挂；null = 还没记）
export const cycleHooks = {
    ovuMode: null,
    inducedParams: null,
    inducedDay: null,
    regularCodex: null,
    regularTier: null,
    regularRange: null,
    cycleNow: null,
};
