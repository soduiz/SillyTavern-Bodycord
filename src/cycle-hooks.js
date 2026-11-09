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
export const cycleHooks = {
    ovuMode: null,
    inducedParams: null,
    inducedDay: null,
};
