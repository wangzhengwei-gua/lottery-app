/**
 * 结构杀号器 - 基于彩票开奖规律的结构化杀号算法
 * 
 * 核心策略：
 * 1. 7区断区杀号：大乐透前区35个号码分7区，每期大概率断1-2区
 * 2. 和值范围过滤：前区和值集中在65-115，杀极端组合
 * 3. 重号杀号增强：基于历史重号率动态调整杀号数量
 * 4. 尾数频率杀号：高频尾数只保留1-2个
 * 5. 冷热号综合过滤：热号降温+冷号回补检测
 * 
 * 增强功能：
 * 6. 回测验证：用历史数据测试杀号命中率
 * 7. 混合模式：同时运行基础+结构算法，取并集或交集
 * 8. 智能推荐：根据数据特征自动推荐杀号模式
 */

import { CONFIG } from '../core/Config.js';
import { safeDivide } from '../core/Utils.js';
import { NumberEliminator } from './NumberEliminator.js';

export class StructuralEliminator {

  /**
   * 执行全部结构杀号算法
   * @param {LotteryAnalyzer} analyzer - 分析器实例
   * @param {Object} options - 配置选项
   * @returns {Object} 杀号结果
   */
  static eliminate(analyzer, options = {}) {
    const activeData = analyzer.getActiveData();
    if (activeData.length < 10) {
      return {
        frontEliminated: [],
        backEliminated: [],
        frontRemaining: Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1),
        backRemaining: Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1),
        reasons: {},
        summary: '数据不足10期，无法执行结构杀号分析',
        algorithmDetails: []
      };
    }

    // 执行各算法
    const zoneBreakResult = StructuralEliminator._zoneBreakKill(activeData, options.zoneBreakEnabled !== false);
    const sumRangeResult = StructuralEliminator._sumRangeKill(activeData, options.sumMin || 65, options.sumMax || 115);
    const repeatEnhancedResult = StructuralEliminator._enhancedRepeatKill(analyzer, activeData, options.repeatKillCount || 3);
    const tailFreqResult = StructuralEliminator._tailFrequencyKill(analyzer, activeData, options.tailKillEnabled !== false);
    const hotColdResult = StructuralEliminator._hotColdFilter(activeData, options.hotPeriods || 10, options.coldPeriods || 20);

    // 合并杀号结果
    const frontEliminatedSet = new Set();
    const backEliminatedSet = new Set();
    const reasons = {};

    const mergeFront = (nums, reason) => {
      for (const num of nums) {
        frontEliminatedSet.add(num);
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(reason);
      }
    };

    const mergeBack = (nums, reason) => {
      for (const num of nums) {
        backEliminatedSet.add(num);
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(reason);
      }
    };

    mergeFront(zoneBreakResult.front, '7区断区预测');
    mergeFront(sumRangeResult.front, '和值范围过滤');
    mergeFront(repeatEnhancedResult.front, '重号杀号增强');
    mergeFront(tailFreqResult.front, '尾数频率杀号');
    mergeFront(hotColdResult.front, '冷热号综合过滤');

    mergeBack(repeatEnhancedResult.back, '重号杀号增强');
    mergeBack(hotColdResult.back, '冷热号综合过滤');

    // 计算保留号码
    const frontRemaining = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
      .filter(n => !frontEliminatedSet.has(n));
    const backRemaining = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
      .filter(n => !backEliminatedSet.has(n));

    // 安全阈值：至少保留CONFIG.FRONT_COUNT+1个前区，CONFIG.BACK_COUNT+1个后区
    const minFrontRemaining = CONFIG.FRONT_COUNT + 1;
    const minBackRemaining = CONFIG.BACK_COUNT + 1;

    if (frontRemaining.length < minFrontRemaining) {
      const needRestore = minFrontRemaining - frontRemaining.length;
      const eliminatedFront = [...frontEliminatedSet]
        .sort((a, b) => (reasons[a] || []).length - (reasons[b] || []).length);
      for (let i = 0; i < needRestore && i < eliminatedFront.length; i++) {
        frontEliminatedSet.delete(eliminatedFront[i]);
        delete reasons[eliminatedFront[i]];
      }
      frontRemaining.splice(0);
      frontRemaining.push(...Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .filter(n => !frontEliminatedSet.has(n)));
    }

    if (backRemaining.length < minBackRemaining) {
      const needRestore = minBackRemaining - backRemaining.length;
      const eliminatedBack = [...backEliminatedSet]
        .sort((a, b) => (reasons[a] || []).length - (reasons[b] || []).length);
      for (let i = 0; i < needRestore && i < eliminatedBack.length; i++) {
        backEliminatedSet.delete(eliminatedBack[i]);
        delete reasons[eliminatedBack[i]];
      }
      backRemaining.splice(0);
      backRemaining.push(...Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
        .filter(n => !backEliminatedSet.has(n)));
    }

    const frontEliminated = [...frontEliminatedSet].sort((a, b) => a - b);
    const backEliminated = [...backEliminatedSet].sort((a, b) => a - b);

    const algorithmDetails = [
      { name: '7区断区杀号', description: '前区分7区（每区5号），预测断1-2区并杀掉对应号码', frontCount: zoneBreakResult.front.length, backCount: zoneBreakResult.back.length, frontNumbers: zoneBreakResult.front, backNumbers: zoneBreakResult.back },
      { name: '极端号码倾向杀号', description: `近10期平均和值${sumRangeResult.details?.avgSum?.toFixed(1) || '未知'}，趋势偏移时杀贡献偏差过大的号码`, frontCount: sumRangeResult.front.length, backCount: sumRangeResult.back.length, frontNumbers: sumRangeResult.front, backNumbers: sumRangeResult.back },
      { name: '重号杀号增强', description: `基于历史重号率动态杀号（前区重号率${repeatEnhancedResult.details?.avgFrontRepeatCount?.toFixed(1) || '未知'}，后区${repeatEnhancedResult.details?.avgBackRepeatCount?.toFixed(1) || '未知'})`, frontCount: repeatEnhancedResult.front.length, backCount: repeatEnhancedResult.back.length, frontNumbers: repeatEnhancedResult.front, backNumbers: repeatEnhancedResult.back },
      { name: '尾数频率杀号', description: '近3期高频尾数只保留1-2个，杀其余同尾号', frontCount: tailFreqResult.front.length, backCount: tailFreqResult.back.length, frontNumbers: tailFreqResult.front, backNumbers: tailFreqResult.back },
      { name: '冷热号综合过滤', description: `热号(${options.hotPeriods || 10}期≥3次)降温，冷号(${options.coldPeriods || 20}期未开)批量杀`, frontCount: hotColdResult.front.length, backCount: hotColdResult.back.length, frontNumbers: hotColdResult.front, backNumbers: hotColdResult.back },
    ];

    const summary = `结构杀号完成：前区杀掉${frontEliminated.length}个（保留${frontRemaining.length}个），后区杀掉${backEliminated.length}个（保留${backRemaining.length}个）`;

    return {
      frontEliminated,
      backEliminated,
      frontRemaining,
      backRemaining,
      reasons,
      summary,
      algorithmDetails,
      rawResults: {
        zoneBreak: zoneBreakResult,
        sumRange: sumRangeResult,
        repeatEnhanced: repeatEnhancedResult,
        tailFreq: tailFreqResult,
        hotCold: hotColdResult
      }
    };
  }

  /**
   * 混合模式杀号 - 同时运行基础+结构算法
   * @param {LotteryAnalyzer} analyzer - 分析器实例
   * @param {Object} options - 配置选项
   * @param {string} options.mergeMode - 'union'(并集：任一杀掉即杀) | 'intersect'(交集：两者都杀才杀)
   * @returns {Object} 混合杀号结果
   */
  static mixedEliminate(analyzer, options = {}) {
    const mergeMode = options.mergeMode || 'union';
    const activeData = analyzer.getActiveData();

    // 分别执行基础杀号和结构杀号
    const basicResult = NumberEliminator.eliminate(analyzer, options.basicOptions || {});
    const structuralResult = StructuralEliminator.eliminate(analyzer, options.structuralOptions || {});

    if (mergeMode === 'union') {
      // 并集模式：任一算法杀掉的号码都被杀
      const frontEliminatedSet = new Set([...basicResult.frontEliminated, ...structuralResult.frontEliminated]);
      const backEliminatedSet = new Set([...basicResult.backEliminated, ...structuralResult.backEliminated]);

      const reasons = {};
      // 合并基础杀号原因
      for (const num of basicResult.frontEliminated) {
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(...(basicResult.reasons[num] || []));
      }
      for (const num of basicResult.backEliminated) {
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(...(basicResult.reasons[num] || []));
      }
      // 合并结构杀号原因（加"结构"前缀区分）
      for (const num of structuralResult.frontEliminated) {
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(...(structuralResult.reasons[num] || []).map(r => `[结构]${r}`));
      }
      for (const num of structuralResult.backEliminated) {
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(...(structuralResult.reasons[num] || []).map(r => `[结构]${r}`));
      }

      const frontRemaining = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .filter(n => !frontEliminatedSet.has(n));
      const backRemaining = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
        .filter(n => !backEliminatedSet.has(n));

      // 安全阈值检查
      StructuralEliminator._ensureMinRemaining(frontEliminatedSet, backEliminatedSet, frontRemaining, backRemaining, reasons);

      return {
        frontEliminated: [...frontEliminatedSet].sort((a, b) => a - b),
        backEliminated: [...backEliminatedSet].sort((a, b) => a - b),
        frontRemaining: Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1).filter(n => !frontEliminatedSet.has(n)),
        backRemaining: Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1).filter(n => !backEliminatedSet.has(n)),
        reasons,
        summary: `混合杀号(并集)完成：前区杀${frontEliminatedSet.size}个(保留${frontRemaining.length}个)，后区杀${backEliminatedSet.size}个(保留${backRemaining.length}个)`,
        algorithmDetails: [
          ...basicResult.algorithmDetails.map(a => ({ ...a, source: '基础' })),
          ...structuralResult.algorithmDetails.map(a => ({ ...a, source: '结构', frontNumbers: a.frontNumbers || [], backNumbers: a.backNumbers || [] }))
        ],
        mode: 'mixed_union',
        basicResult,
        structuralResult
      };
    } else {
      // 交集模式：只有两者都杀掉的号码才被杀（更保守）
      const frontEliminatedSet = new Set(
        basicResult.frontEliminated.filter(n => structuralResult.frontEliminated.includes(n))
      );
      const backEliminatedSet = new Set(
        basicResult.backEliminated.filter(n => structuralResult.backEliminated.includes(n))
      );

      const reasons = {};
      for (const num of frontEliminatedSet) {
        reasons[num] = [
          ...(basicResult.reasons[num] || []),
          ...(structuralResult.reasons[num] || []).map(r => `[结构]${r}`)
        ];
      }
      for (const num of backEliminatedSet) {
        reasons[num] = [
          ...(basicResult.reasons[num] || []),
          ...(structuralResult.reasons[num] || []).map(r => `[结构]${r}`)
        ];
      }

      const frontRemaining = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .filter(n => !frontEliminatedSet.has(n));
      const backRemaining = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
        .filter(n => !backEliminatedSet.has(n));

      return {
        frontEliminated: [...frontEliminatedSet].sort((a, b) => a - b),
        backEliminated: [...backEliminatedSet].sort((a, b) => a - b),
        frontRemaining,
        backRemaining,
        reasons,
        summary: `混合杀号(交集)完成：前区杀${frontEliminatedSet.size}个(保留${frontRemaining.length}个)，后区杀${backEliminatedSet.size}个(保留${backRemaining.length}个)`,
        algorithmDetails: [
          ...basicResult.algorithmDetails.map(a => ({ ...a, source: '基础' })),
          ...structuralResult.algorithmDetails.map(a => ({ ...a, source: '结构', frontNumbers: a.frontNumbers || [], backNumbers: a.backNumbers || [] }))
        ],
        mode: 'mixed_intersect',
        basicResult,
        structuralResult
      };
    }
  }

  /**
   * 智能推荐 - 根据数据特征自动推荐最适合的杀号模式
   * @param {LotteryAnalyzer} analyzer - 分析器实例
   * @returns {Object} 推荐结果 { recommendedMode, reason, features }
   */
  static recommendMode(analyzer) {
    const activeData = analyzer.getActiveData();
    if (activeData.length < 30) {
      return { recommendedMode: 'basic', reason: '数据量不足30期，建议使用基础杀号', features: {} };
    }

    const features = {};

    // 特征1：近10期号码集中度（是否号码集中在少数区域）
    const recent10 = activeData.slice(-10);
    const zoneHits = [0, 0, 0, 0, 0, 0, 0];
    const zones = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 30], [31, 35]];
    for (const draw of recent10) {
      for (const num of draw.front) {
        for (let z = 0; z < 7; z++) {
          if (num >= zones[z][0] && num <= zones[z][1]) zoneHits[z]++;
        }
      }
    }
    const maxZoneHit = Math.max(...zoneHits);
    const minZoneHit = Math.min(...zoneHits);
    features.zoneConcentration = maxZoneHit / (minZoneHit + 1);
    features.emptyZones = zoneHits.filter(h => h === 0).length;

    // 特征2：近5期重号率
    let totalRepeats = 0;
    for (let i = 1; i <= 5; i++) {
      const curr = activeData[activeData.length - i];
      const prev = activeData[activeData.length - i - 1];
      totalRepeats += curr.front.filter(n => prev.front.includes(n)).length;
    }
    features.avgRepeatRate = totalRepeats / 5;

    // 特征3：近10期和值分布
    const sums10 = recent10.map(d => d.front.reduce((a, b) => a + b, 0));
    const avgSum = sums10.reduce((a, b) => a + b, 0) / sums10.length;
    const sumStdDev = Math.sqrt(sums10.reduce((a, s) => a + (s - avgSum) ** 2, 0) / sums10.length);
    features.avgSum = avgSum;
    features.sumStdDev = sumStdDev;
    features.sumOutOfRange = sums10.filter(s => s < 65 || s > 115).length;

    // 特征4：号码热度分布（是否有明显过热号）
    const freq10 = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) freq10[i] = 0;
    for (const draw of recent10) {
      for (const num of draw.front) freq10[num]++;
    }
    const maxFreq = Math.max(...Object.values(freq10));
    const hotNumbers = Object.entries(freq10).filter(([_, f]) => f >= 3).length;
    features.maxFrequency = maxFreq;
    features.hotNumberCount = hotNumbers;

    // 特征5：尾数集中度
    const tailFreq = {};
    for (let t = 0; t <= 9; t++) tailFreq[t] = 0;
    for (const draw of recent10) {
      for (const num of draw.front) tailFreq[num % 10]++;
    }
    const maxTailFreq = Math.max(...Object.values(tailFreq));
    features.tailConcentration = maxTailFreq;

    // 基于特征推荐模式
    let recommendedMode = 'basic';
    let reason = '';
    const scoreMap = { basic: 0, structural: 0, mixed_union: 0, mixed_intersect: 0 };

    // 断区明显 → 结构杀号(7区断区)得分高
    if (features.emptyZones >= 1 || features.zoneConcentration > 3) {
      scoreMap.structural += 2;
      scoreMap.mixed_union += 1;
    }

    // 重号率低 → 结构杀号(重号增强)得分高
    if (features.avgRepeatRate < 1.0) {
      scoreMap.structural += 2;
      scoreMap.mixed_intersect += 1;
    }

    // 和值偏离 → 结构杀号(和值范围)得分高
    if (features.sumOutOfRange >= 2 || avgSum < 65 || avgSum > 115) {
      scoreMap.structural += 2;
      scoreMap.mixed_union += 1;
    }

    // 热号明显 → 基础杀号(过热检测+Z-score)得分高
    if (features.hotNumberCount >= 3 || features.maxFrequency >= 4) {
      scoreMap.basic += 2;
      scoreMap.mixed_union += 1;
    }

    // 尾数集中 → 结构杀号(尾数频率)得分高
    if (features.tailConcentration >= 6) {
      scoreMap.structural += 1;
      scoreMap.mixed_union += 1;
    }

    // 综合特征复杂 → 混合模式得分高
    const activeFeatures = [features.emptyZones >= 1, features.avgRepeatRate < 1, features.sumOutOfRange >= 2, features.hotNumberCount >= 3, features.tailConcentration >= 6];
    const activeCount = activeFeatures.filter(Boolean).length;
    if (activeCount >= 3) {
      scoreMap.mixed_union += 2;
      scoreMap.mixed_intersect += 1;
    }

    // 找出最高分模式
    const bestMode = Object.entries(scoreMap).sort((a, b) => b[1] - a[1])[0];
    recommendedMode = bestMode[0];

    const modeNames = {
      basic: '基础杀号（6种统计算法）',
      structural: '结构杀号（5种规律算法）',
      mixed_union: '混合杀号-并集（11种算法联合，激进）',
      mixed_intersect: '混合杀号-交集（双重验证，保守）'
    };

    const reasonParts = [];
    if (features.emptyZones >= 1) reasonParts.push(`近10期有${features.emptyZones}个空区`);
    if (features.avgRepeatRate < 1) reasonParts.push(`重号率低(${features.avgRepeatRate.toFixed(1)})`);
    if (features.sumOutOfRange >= 2) reasonParts.push(`${features.sumOutOfRange}期和值偏离`);
    if (features.hotNumberCount >= 3) reasonParts.push(`${features.hotNumberCount}个过热号`);
    if (features.tailConcentration >= 6) reasonParts.push(`尾数集中(最高${features.tailConcentration}次)`);
    if (activeCount >= 3) reasonParts.push(`${activeCount}个特征同时活跃`);

    reason = reasonParts.length > 0
      ? `推荐${modeNames[recommendedMode]}，因为：${reasonParts.join('、')}`
      : `数据特征平稳，推荐${modeNames[recommendedMode]}作为默认选择`;

    return {
      recommendedMode,
      reason,
      features,
      scores: scoreMap,
      modeNames
    };
  }

  /**
   * 回测验证 - 用历史数据测试杀号命中率
   * @param {LotteryAnalyzer} analyzer - 分析器实例
   * @param {Object} options - 配置选项
   * @param {string} options.mode - 'basic' | 'structural' | 'mixed_union' | 'mixed_intersect'
   * @param {number} options.backtestPeriods - 回测期数（默认20，最多30）
   * @returns {Object} 回测结果
   */
  static backtest(analyzer, options = {}) {
    const mode = options.mode || 'basic';
    const backtestPeriods = Math.min(options.backtestPeriods || 20, 30);
    const activeData = analyzer.getActiveData();

    if (activeData.length < backtestPeriods + 20) {
      return {
        success: false,
        summary: `数据不足${backtestPeriods + 20}期，无法回测`,
        details: [],
        frontAccuracy: 0,
        backAccuracy: 0
      };
    }

    const results = [];
    const basicOpts = options.basicOptions || { recentPeriods: 30, overheatCount: 6, backOverheatCount: 6, zScoreThreshold: 1.5, consecutiveThreshold: 3, backConsecutiveThreshold: 2 };
    const structuralOpts = options.structuralOptions || { zoneBreakEnabled: true, sumMin: 65, sumMax: 115, repeatKillCount: 3, tailKillEnabled: true, hotPeriods: 10, coldPeriods: 20 };

    // 逐期回测
    const startIdx = activeData.length - backtestPeriods - 5;
    for (let i = Math.max(10, startIdx); i < activeData.length - 5; i++) {
      // 模拟在第i期时刻执行杀号
      const simulatedData = activeData.slice(0, i + 1);
      const nextDraw = activeData[i + 1];

      // 创建临时analyzer
      const tempAnalyzer = {
        getActiveData: () => simulatedData,
        frequencyAnalyzer: analyzer.frequencyAnalyzer,
      };

      let elimResult;
      try {
        switch (mode) {
          case 'basic':
            elimResult = NumberEliminator.eliminate(tempAnalyzer, basicOpts);
            break;
          case 'structural':
            elimResult = StructuralEliminator.eliminate(tempAnalyzer, structuralOpts);
            break;
          case 'mixed_union':
            elimResult = StructuralEliminator.mixedEliminate(tempAnalyzer, { mergeMode: 'union', basicOptions: basicOpts, structuralOptions: structuralOpts });
            break;
          case 'mixed_intersect':
            elimResult = StructuralEliminator.mixedEliminate(tempAnalyzer, { mergeMode: 'intersect', basicOptions: basicOpts, structuralOptions: structuralOpts });
            break;
          default:
            elimResult = NumberEliminator.eliminate(tempAnalyzer, basicOpts);
        }
      } catch (e) {
        continue; // 跳过回测失败的期
      }

      // 检查下一期开奖号码是否在被杀号码中
      const frontWrongKill = nextDraw.front.filter(n => elimResult.frontEliminated.includes(n)).length;
      const frontCorrectKeep = nextDraw.front.filter(n => !elimResult.frontEliminated.includes(n)).length;
      const backWrongKill = nextDraw.back.filter(n => elimResult.backEliminated.includes(n)).length;
      const backCorrectKeep = nextDraw.back.filter(n => !elimResult.backEliminated.includes(n)).length;

      results.push({
        periodIndex: i + 1,
        nextDraw: { front: nextDraw.front, back: nextDraw.back },
        frontEliminated: elimResult.frontEliminated,
        backEliminated: elimResult.backEliminated,
        frontWrongKill,  // 被杀但下期开出的号码数（杀错了）
        frontCorrectKeep, // 保留且下期开出的号码数（杀对了）
        backWrongKill,
        backCorrectKeep,
        frontKillTotal: elimResult.frontEliminated.length,
        backKillTotal: elimResult.backEliminated.length,
        frontAccuracy: CONFIG.FRONT_COUNT > 0 ? frontCorrectKeep / CONFIG.FRONT_COUNT : 0,
        backAccuracy: CONFIG.BACK_COUNT > 0 ? backCorrectKeep / CONFIG.BACK_COUNT : 0
      });
    }

    if (results.length === 0) {
      return {
        success: false,
        summary: '回测无有效结果',
        details: [],
        frontAccuracy: 0,
        backAccuracy: 0
      };
    }

    // 统计总体准确率
    const avgFrontAccuracy = results.reduce((a, r) => a + r.frontAccuracy, 0) / results.length;
    const avgBackAccuracy = results.reduce((a, r) => a + r.backAccuracy, 0) / results.length;
    const avgFrontWrongKill = results.reduce((a, r) => a + r.frontWrongKill, 0) / results.length;
    const avgBackWrongKill = results.reduce((a, r) => a + r.backWrongKill, 0) / results.length;
    const avgFrontKillTotal = results.reduce((a, r) => a + r.frontKillTotal, 0) / results.length;

    const modeNames = {
      basic: '基础杀号',
      structural: '结构杀号',
      mixed_union: '混合杀号(并集)',
      mixed_intersect: '混合杀号(交集)'
    };

    return {
      success: true,
      mode,
      modeName: modeNames[mode],
      summary: `${modeNames[mode]}回测${results.length}期：前区命中率${(avgFrontAccuracy * 100).toFixed(1)}%（平均误杀${avgFrontWrongKill.toFixed(1)}个），后区命中率${(avgBackAccuracy * 100).toFixed(1)}%（平均误杀${avgBackWrongKill.toFixed(1)}个），平均每期杀${avgFrontKillTotal.toFixed(1)}个前区号`,
      details: results,
      frontAccuracy: avgFrontAccuracy,
      backAccuracy: avgBackAccuracy,
      avgFrontWrongKill,
      avgBackWrongKill,
      avgFrontKillTotal,
      totalPeriods: results.length
    };
  }

  /**
   * 安全阈值检查 - 确保至少保留最少号码
   */
  static _ensureMinRemaining(frontEliminatedSet, backEliminatedSet, frontRemaining, backRemaining, reasons) {
    const minFrontRemaining = CONFIG.FRONT_COUNT + 1;
    const minBackRemaining = CONFIG.BACK_COUNT + 1;

    if (frontRemaining.length < minFrontRemaining) {
      const needRestore = minFrontRemaining - frontRemaining.length;
      const eliminatedFront = [...frontEliminatedSet]
        .sort((a, b) => (reasons[a] || []).length - (reasons[b] || []).length);
      for (let i = 0; i < needRestore && i < eliminatedFront.length; i++) {
        frontEliminatedSet.delete(eliminatedFront[i]);
        delete reasons[eliminatedFront[i]];
      }
    }

    if (backRemaining.length < minBackRemaining) {
      const needRestore = minBackRemaining - backRemaining.length;
      const eliminatedBack = [...backEliminatedSet]
        .sort((a, b) => (reasons[a] || []).length - (reasons[b] || []).length);
      for (let i = 0; i < needRestore && i < eliminatedBack.length; i++) {
        backEliminatedSet.delete(eliminatedBack[i]);
        delete reasons[eliminatedBack[i]];
      }
    }
  }

  // ====== 5种结构杀号算法 ======

  /**
   * 算法1：7区断区杀号
   */
  static _zoneBreakKill(activeData, enabled = true) {
    if (!enabled || activeData.length < 10) return { front: [], back: [] };

    const zones = [
      [1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 30], [31, 35]
    ];

    const recentData = activeData.slice(-10);
    const zoneFreq = zones.map(([start, end]) => {
      let count = 0;
      for (const draw of recentData) {
        count += draw.front.filter(n => n >= start && n <= end).length;
      }
      return count;
    });

    const sortedZones = zoneFreq
      .map((freq, idx) => ({ zone: idx, freq }))
      .sort((a, b) => a.freq - b.freq);

    const coldestZone = sortedZones[0];
    const secondColdest = sortedZones[1];
    const shouldKillTwo = secondColdest.freq > coldestZone.freq * 0.7;

    const zonesToKill = shouldKillTwo ? [coldestZone.zone, secondColdest.zone] : [coldestZone.zone];

    const eliminated = [];
    for (const zoneIdx of zonesToKill) {
      const [start, end] = zones[zoneIdx];
      for (let i = start; i <= end; i++) {
        eliminated.push(i);
      }
    }

    return {
      front: eliminated.sort((a, b) => a - b),
      back: [],
      details: { zones, zoneFreq, zonesToKill }
    };
  }

  /**
   * 算法2：极端号码倾向杀号（替代原和值范围过滤）
   * 分析近10期和值分布，如果当前和值趋势偏高则杀掉最大的号码，
   * 偏低则杀掉最小的号码。
   * 不再基于"单号是否必然导致极端和值"的逻辑（任何号都能在合理和值组合中出现）
   */
  static _sumRangeKill(activeData, minSum = 65, maxSum = 115) {
    if (activeData.length < 10) return { front: [], back: [] };

    const recent10 = activeData.slice(-10);
    const sums = recent10.map(d => d.front.reduce((a, b) => a + b, 0));
    const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;

    // 统计近10期中各号码对和值的贡献偏差
    const numberContributions = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) numberContributions[i] = 0;
    for (const draw of recent10) {
      for (const num of draw.front) numberContributions[num] += num;
    }

    // 计算每个出现过的号码的平均贡献值
    const appeared = Object.entries(numberContributions)
      .filter(([_, v]) => v > 0)
      .map(([n, v]) => ({ num: parseInt(n), avgContrib: v / recent10.length }));

    if (appeared.length === 0) return { front: [], back: [] };

    // 理想平均贡献：avgSum / 5 ≈ 18
    const idealContrib = avgSum / CONFIG.FRONT_COUNT;

    // 杀掉贡献偏差过大的号码（贡献远高于或远低于理想值）
    // 阈值：偏差超过理想值的50%
    const upperThreshold = idealContrib * 1.5;
    const lowerThreshold = idealContrib * 0.5;

    // 只有在当前和值趋势明显偏移时才启用
    const eliminated = [];
    if (avgSum > maxSum) {
      // 和值偏高趋势 → 杀贡献过大的号码（大号倾向）
      appeared
        .filter(a => a.avgContrib > upperThreshold)
        .forEach(a => eliminated.push(a.num));
    } else if (avgSum < minSum) {
      // 和值偏低趋势 → 杀贡献过小的号码（小号倾向）
      appeared
        .filter(a => a.avgContrib < lowerThreshold)
        .forEach(a => eliminated.push(a.num));
    }

    // 和值在合理范围内时不杀号（大多数情况）
    return {
      front: eliminated.sort((a, b) => a - b),
      back: [],
      details: { avgSum, idealContrib, sums }
    };
  }

  /**
   * 算法3：重号杀号增强版（前区+后区）
   * 基于历史重号率动态调整，同时杀前后区上期号码
   */
  static _enhancedRepeatKill(analyzer, activeData, killCount = 3) {
    if (activeData.length < 6) return { front: [], back: [] };

    const lastDraw = activeData[activeData.length - 1];
    const recentPeriods = Math.min(10, activeData.length - 1);

    // 统计近N期前区平均重号数
    let totalFrontRepeats = 0;
    for (let i = 1; i <= recentPeriods; i++) {
      const curr = activeData[activeData.length - i];
      const prev = activeData[activeData.length - i - 1];
      totalFrontRepeats += curr.front.filter(n => prev.front.includes(n)).length;
    }
    const avgFrontRepeatCount = totalFrontRepeats / recentPeriods;

    // 统计近N期后区平均重号数
    let totalBackRepeats = 0;
    for (let i = 1; i <= recentPeriods; i++) {
      const curr = activeData[activeData.length - i];
      const prev = activeData[activeData.length - i - 1];
      totalBackRepeats += curr.back.filter(n => prev.back.includes(n)).length;
    }
    const avgBackRepeatCount = totalBackRepeats / recentPeriods;

    const frontEliminated = [];
    const backEliminated = [];

    // 前区：如果平均前区重号数<1，杀掉上期killCount个号码
    if (avgFrontRepeatCount < 1.0) {
      const freqData = analyzer.frequencyAnalyzer.analyzeFrequency()[0];
      const lastWithFreq = lastDraw.front.map(n => ({
        num: n,
        freq: freqData[n] || 0
      })).sort((a, b) => b.freq - a.freq);

      const keepCount = Math.max(1, 5 - killCount);
      const toKeep = lastWithFreq.slice(0, keepCount).map(item => item.num);
      frontEliminated.push(...lastDraw.front.filter(n => !toKeep.includes(n)));
    }

    // 后区：如果平均后区重号数<0.5，杀掉上期后区1个号码
    if (avgBackRepeatCount < 0.5) {
      const backFreqData = analyzer.frequencyAnalyzer.analyzeFrequency()[1];
      const lastBackWithFreq = lastDraw.back.map(n => ({
        num: n,
        freq: backFreqData[n] || 0
      })).sort((a, b) => b.freq - a.freq);

      // 后区只杀1个（频率最低的那个）
      if (lastDraw.back.length > 1) {
        backEliminated.push(lastBackWithFreq[lastBackWithFreq.length - 1].num);
      }
    }

    return {
      front: frontEliminated.sort((a, b) => a - b),
      back: backEliminated.sort((a, b) => a - b),
      details: { avgFrontRepeatCount, avgBackRepeatCount, frontKill: frontEliminated.length, backKill: backEliminated.length }
    };
  }

  /**
   * 算法4：尾数频率杀号
   */
  static _tailFrequencyKill(analyzer, activeData, enabled = true) {
    if (!enabled || activeData.length < 3) return { front: [], back: [] };

    const recentData = activeData.slice(-3);
    const tailFreq = {};
    for (let t = 0; t <= 9; t++) tailFreq[t] = 0;

    for (const draw of recentData) {
      for (const num of draw.front) {
        const tail = num % 10;
        tailFreq[tail]++;
      }
    }

    const highFreqTails = Object.entries(tailFreq)
      .filter(([_, freq]) => freq >= 4)
      .map(([tail]) => parseInt(tail));

    if (highFreqTails.length === 0) return { front: [], back: [], details: { tailFreq } };

    const eliminated = [];
    const recentForFreq = activeData.slice(-10);
    const localFreqData = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) localFreqData[i] = 0;
    for (const draw of recentForFreq) {
      for (const num of draw.front) localFreqData[num]++;
    }

    for (const tail of highFreqTails) {
      const numbersWithTail = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .filter(n => n % 10 === tail)
        .map(n => ({ num: n, freq: localFreqData[n] || 0 }))
        .sort((a, b) => b.freq - a.freq);

      if (numbersWithTail.length > 2) {
        const toKeep = numbersWithTail.slice(0, 2).map(item => item.num);
        const toKill = numbersWithTail.slice(2).map(item => item.num);
        eliminated.push(...toKill);
      }
    }

    return {
      front: [...new Set(eliminated)].sort((a, b) => a - b),
      back: [],
      details: { tailFreq, highFreqTails }
    };
  }

  /**
   * 算法5：冷热号综合过滤
   */
  static _hotColdFilter(activeData, hotPeriods = 10, coldPeriods = 20) {
    if (activeData.length < Math.max(hotPeriods, coldPeriods)) {
      return { front: [], back: [], details: {} };
    }

    const recentHot = activeData.slice(-hotPeriods);

    const hotCount = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) hotCount[i] = 0;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) hotCount[i + 100] = 0;

    for (const draw of recentHot) {
      for (const num of draw.front) hotCount[num]++;
      for (const num of draw.back) hotCount[num + 100]++;
    }

    const frontHotEliminated = [];
    const backHotEliminated = [];

    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      if (hotCount[i] >= 3) {
        const last2 = activeData.slice(-2);
        const appearedInBoth = last2.every(draw => draw.front.includes(i));
        if (appearedInBoth) frontHotEliminated.push(i);
      }
    }

    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
      if (hotCount[i + 100] >= 3) {
        const last2 = activeData.slice(-2);
        const appearedInBoth = last2.every(draw => draw.back.includes(i));
        if (appearedInBoth) backHotEliminated.push(i);
      }
    }

    const coldEliminated = [];
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      let omission = 0;
      for (let j = activeData.length - 1; j >= 0; j--) {
        if (activeData[j].front.includes(i)) break;
        omission++;
      }
      if (omission >= coldPeriods) coldEliminated.push(i);
    }

    return {
      front: [...frontHotEliminated, ...coldEliminated].sort((a, b) => a - b),
      back: backHotEliminated.sort((a, b) => a - b),
      details: { hotCount, frontHotEliminated, backHotEliminated, coldEliminated }
    };
  }
}
