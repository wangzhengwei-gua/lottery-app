/**
 * 号码杀号器 - 复式玩法核心算法（精简版）
 * 
 * 杀号策略（3种，去除冗余的统计检验）：
 * 1. 近N期过热杀号：近30期出现≥6次的号码视为过热，认为热度会下降
 * 2. 连续出现杀号：号码在连续3+期中出现，趋势过强会回落
 * 3. 重号饱和杀号：近期重号率过高时杀掉上一期号码
 */

import { CONFIG } from '../core/Config.js';
import { safeDivide } from '../core/Utils.js';
import { UnifiedScorer } from './UnifiedScorer.js';

export class NumberEliminator {

  /**
   * 执行全部杀号算法，返回综合杀号结果
   * @param {LotteryAnalyzer} analyzer - 分析器实例
   * @param {Object} options - 配置选项
   * @param {number} options.recentPeriods - 近期期数（默认5）
   * @param {number} options.consecutiveThreshold - 连续出现阈值（默认3）
   * @param {number} options.overheatCount - 过热出现次数阈值（默认3）
   * @param {number} options.backOverheatCount - 后区过热出现次数阈值（默认2，后区号码少更容易过热）
   * @returns {Object} 杀号结果
   */
  static eliminate(analyzer, options = {}) {
    const recentPeriods = options.recentPeriods || 30;
    const consecutiveThreshold = options.consecutiveThreshold || 3;
    const backConsecutiveThreshold = options.backConsecutiveThreshold || 2; // 后区连续阈值更低
    const overheatCount = options.overheatCount || 6;
    const backOverheatCount = options.backOverheatCount || 6; // 后区过热阈值与前区一致

    const activeData = analyzer.getActiveData();
    if (activeData.length < recentPeriods) {
      return {
        frontEliminated: [],
        backEliminated: [],
        frontRemaining: Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1),
        backRemaining: Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1),
        reasons: {},
        summary: `数据不足${recentPeriods}期，无法执行杀号分析`,
        algorithmDetails: []
      };
    }

    // 执行各算法（后区使用更低的过热和连续阈值）
    const overheatResult = NumberEliminator._overheatElimination(activeData, recentPeriods, overheatCount, backOverheatCount);
    const consecutiveResult = NumberEliminator._consecutiveElimination(activeData, consecutiveThreshold, backConsecutiveThreshold);
    const repeatResult = NumberEliminator._repeatSaturationElimination(activeData);

    // 合并杀号结果（被任一算法杀掉的号码即被杀）
    const frontEliminatedSet = new Set();
    const backEliminatedSet = new Set();
    const reasons = {};

    // 合并前区杀号
    const mergeFront = (nums, reason) => {
      for (const num of nums) {
        frontEliminatedSet.add(num);
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(reason);
      }
    };

    // 合并后区杀号
    const mergeBack = (nums, reason) => {
      for (const num of nums) {
        backEliminatedSet.add(num);
        if (!reasons[num]) reasons[num] = [];
        reasons[num].push(reason);
      }
    };

    mergeFront(overheatResult.front, '近5期过热');
    mergeFront(consecutiveResult.front, '连续出现');
    mergeFront(repeatResult.front, '重号饱和');

    mergeBack(overheatResult.back, '近5期过热');
    mergeBack(consecutiveResult.back, '连续出现');
    mergeBack(repeatResult.back, '重号饱和');

    // 计算保留号码（杀号后的剩余号码池）
    const frontRemaining = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
      .filter(n => !frontEliminatedSet.has(n));
    const backRemaining = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
      .filter(n => !backEliminatedSet.has(n));

    // 安全阈值：前区至少保留6个号码（5+1），后区至少保留3个号码（2+1）
    const minFrontRemaining = CONFIG.FRONT_COUNT + 1;
    const minBackRemaining = CONFIG.BACK_COUNT + 1;

    // 如果杀号过多，按杀号原因数量排序恢复（仅被1个算法杀的优先恢复）
    // 改进：同原因数下结合 UnifiedScorer 评分，优先恢复高分号码，减少误杀好号
    if (frontRemaining.length < minFrontRemaining) {
      const needRestore = minFrontRemaining - frontRemaining.length;
      let frontScoreMap = null;
      try {
        frontScoreMap = UnifiedScorer.score(analyzer, 'front', 'balanced')
          .reduce((m, r) => { m[r.number] = r.totalScore; return m; }, {});
      } catch (e) { frontScoreMap = null; }
      const eliminatedFront = [...frontEliminatedSet]
        .sort((a, b) => {
          const ra = (reasons[a] || []).length;
          const rb = (reasons[b] || []).length;
          if (ra !== rb) return ra - rb; // 原因少优先恢复
          const sa = frontScoreMap ? (frontScoreMap[a] || 0) : 0;
          const sb = frontScoreMap ? (frontScoreMap[b] || 0) : 0;
          return sb - sa; // 同原因数下高分优先恢复
        });
      for (let i = 0; i < needRestore && i < eliminatedFront.length; i++) {
        frontEliminatedSet.delete(eliminatedFront[i]);
        delete reasons[eliminatedFront[i]];
      }
      // 重新计算保留号码
      frontRemaining.splice(0);
      frontRemaining.push(...Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .filter(n => !frontEliminatedSet.has(n)));
    }

    if (backRemaining.length < minBackRemaining) {
      const needRestore = minBackRemaining - backRemaining.length;
      let backScoreMap = null;
      try {
        backScoreMap = UnifiedScorer.score(analyzer, 'back', 'balanced')
          .reduce((m, r) => { m[r.number] = r.totalScore; return m; }, {});
      } catch (e) { backScoreMap = null; }
      const eliminatedBack = [...backEliminatedSet]
        .sort((a, b) => {
          const ra = (reasons[a] || []).length;
          const rb = (reasons[b] || []).length;
          if (ra !== rb) return ra - rb;
          const sa = backScoreMap ? (backScoreMap[a] || 0) : 0;
          const sb = backScoreMap ? (backScoreMap[b] || 0) : 0;
          return sb - sa;
        });
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

    // 算法详情描述
    const algorithmDetails = [
      { name: '近N期过热杀号', description: `近${recentPeriods}期出现≥${overheatCount}次的号码，过热后热度会下降`, frontCount: overheatResult.front.length, backCount: overheatResult.back.length },
      { name: '连续出现杀号', description: `前区连续${consecutiveThreshold}+期/后区连续${backConsecutiveThreshold}+期出现的号码，趋势过强会回落`, frontCount: consecutiveResult.front.length, backCount: consecutiveResult.back.length },
      { name: '重号饱和杀号', description: '近期重号率过高时杀掉上一期号码，降低重号冲突', frontCount: repeatResult.front.length, backCount: repeatResult.back.length },
    ];

    const summary = `杀号完成：前区杀掉${frontEliminated.length}个（保留${frontRemaining.length}个），后区杀掉${backEliminated.length}个（保留${backRemaining.length}个）`;

    return {
      frontEliminated,
      backEliminated,
      frontRemaining,
      backRemaining,
      reasons,
      summary,
      algorithmDetails,
      rawResults: {
        overheat: overheatResult,
        consecutive: consecutiveResult,
        repeat: repeatResult
      }
    };
  }

  /**
   * 算法1：近N期过热杀号
   * 如果号码在最近N期中出现次数≥threshold，认为过热，杀掉
   * 后区由于号码少(12个)，单号概率高(2/12≈16.7%)，使用更低的阈值(backThreshold)
   */
  static _overheatElimination(activeData, recentPeriods = 5, threshold = 3, backThreshold = 2) {
    const recent = activeData.slice(-recentPeriods);
    
    const frontCount = {};
    const backCount = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontCount[i] = 0;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backCount[i] = 0;

    for (const draw of recent) {
      for (const num of draw.front) frontCount[num]++;
      for (const num of draw.back) backCount[num]++;
    }

    const frontEliminated = Object.entries(frontCount)
      .filter(([_, count]) => count >= threshold)
      .map(([num]) => Number(num))
      .sort((a, b) => a - b);

    const backEliminated = Object.entries(backCount)
      .filter(([_, count]) => count >= backThreshold) // 后区使用独立阈值
      .map(([num]) => Number(num))
      .sort((a, b) => a - b);

    return { front: frontEliminated, back: backEliminated, details: { frontCount, backCount } };
  }

  /**
   * 算法2：连续出现杀号
   * 号码在连续threshold+期中出现，认为趋势过强
   * 后区由于号码少(12个)，更容易连续出现，使用更低阈值(backThreshold)
   */
  static _consecutiveElimination(activeData, threshold = 3, backThreshold = 2) {
    const frontEliminated = [];
    const backEliminated = [];

    // 检查每个号码是否在最近连续threshold期中出现
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      let consecutiveCount = 0;
      for (let j = activeData.length - 1; j >= Math.max(0, activeData.length - threshold); j--) {
        if (activeData[j].front.includes(i)) {
          consecutiveCount++;
        } else {
          break;
        }
      }
      if (consecutiveCount >= threshold) frontEliminated.push(i);
    }

    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
      let consecutiveCount = 0;
      for (let j = activeData.length - 1; j >= Math.max(0, activeData.length - backThreshold); j--) {
        if (activeData[j].back.includes(i)) {
          consecutiveCount++;
        } else {
          break;
        }
      }
      if (consecutiveCount >= backThreshold) backEliminated.push(i);
    }

    return { 
      front: frontEliminated.sort((a, b) => a - b), 
      back: backEliminated.sort((a, b) => a - b),
      details: { threshold }
    };
  }

  /**
   * 算法3：重号饱和杀号
   * 分析近5期的重号率（与上一期相同的号码比例）
   * 前区重号率过高（>40%）时杀掉上一期前区号码
   * 后区重号率过高（>60%）时杀掉上一期后区号码（后区号码少，阈值更高）
   * 前区和后区独立判定，不再连坐
   */
  static _repeatSaturationElimination(activeData) {
    if (activeData.length < 6) return { front: [], back: [] };

    const recent6 = activeData.slice(-6); // 最近6期

    // 前区重号率统计
    let totalFrontRepeatRate = 0;
    for (let i = 1; i < recent6.length; i++) {
      const prev = recent6[i - 1];
      const curr = recent6[i];
      const frontRepeat = curr.front.filter(n => prev.front.includes(n)).length;
      totalFrontRepeatRate += frontRepeat / CONFIG.FRONT_COUNT;
    }
    const avgFrontRepeatRate = totalFrontRepeatRate / (recent6.length - 1);

    // 后区重号率统计（独立计算）
    let totalBackRepeatRate = 0;
    for (let i = 1; i < recent6.length; i++) {
      const prev = recent6[i - 1];
      const curr = recent6[i];
      const backRepeat = curr.back.filter(n => prev.back.includes(n)).length;
      totalBackRepeatRate += backRepeat / CONFIG.BACK_COUNT;
    }
    const avgBackRepeatRate = totalBackRepeatRate / (recent6.length - 1);

    const frontEliminated = [];
    const backEliminated = [];
    const lastDraw = activeData[activeData.length - 1];

    // 前区：平均重号率 > 40%时杀掉上一期前区号码
    if (avgFrontRepeatRate > 0.4) {
      frontEliminated.push(...lastDraw.front);
    }

    // 后区：平均重号率 > 60%时杀掉上一期后区号码
    // 后区号码少(12个选2个)，重号概率基线≈16.7%，阈值设更高避免误杀
    if (avgBackRepeatRate > 0.6) {
      backEliminated.push(...lastDraw.back);
    }

    return {
      front: frontEliminated.sort((a, b) => a - b),
      back: backEliminated.sort((a, b) => a - b),
      details: { avgFrontRepeatRate, avgBackRepeatRate, lastDraw }
    };
  }

  /**
   * 生成杀号分析报告文本
   */
  static generateReport(eliminationResult) {
    const { frontEliminated, backEliminated, frontRemaining, backRemaining, reasons, summary, algorithmDetails } = eliminationResult;
    
    let report = `【杀号分析报告】\n`;
    report += `${summary}\n\n`;
    
    report += `📊 杀号算法统计：\n`;
    for (const algo of algorithmDetails) {
      report += `  ${algo.name}：前区杀${algo.frontCount}个，后区杀${algo.backCount}个\n`;
      report += `    ${algo.description}\n`;
    }

    report += `\n🔴 前区杀号(${frontEliminated.length}个)：\n`;
    for (const num of frontEliminated) {
      const reasonStr = (reasons[num] || []).join('、');
      report += `  ${num.toString().padStart(2, '0')} - 原因: ${reasonStr}\n`;
    }

    report += `\n🔴 后区杀号(${backEliminated.length}个)：\n`;
    for (const num of backEliminated) {
      const reasonStr = (reasons[num] || []).join('、');
      report += `  ${num.toString().padStart(2, '0')} - 原因: ${reasonStr}\n`;
    }

    report += `\n✅ 前区保留(${frontRemaining.length}个)：${frontRemaining.map(n => n.toString().padStart(2, '0')).join(', ')}\n`;
    report += `✅ 后区保留(${backRemaining.length}个)：${backRemaining.map(n => n.toString().padStart(2, '0')).join(', ')}\n`;

    return report;
  }

  /**
   * 复式套餐定义
   * 格式: { key: 'X+Y', frontPool: X(前区号码池大小), backPool: Y(后区号码池大小) }
   * 注数 = C(X,5) × C(Y,2)，费用 = 注数 × 2元
   */
  static FUSHI_PLANS = [
    // 小型套餐（前区≤6，绿色系）
    { key: '5+3', frontPool: 5, backPool: 3, label: '5+3套餐' },
    { key: '6+2', frontPool: 6, backPool: 2, label: '6+2套餐' },
    { key: '6+3', frontPool: 6, backPool: 3, label: '6+3套餐' },
    // 中型套餐（前区=7，蓝色系）
    { key: '7+2', frontPool: 7, backPool: 2, label: '7+2套餐' },
    { key: '7+3', frontPool: 7, backPool: 3, label: '7+3套餐' },
    // 大型套餐（前区≥8，橙红色系）
    { key: '8+2', frontPool: 8, backPool: 2, label: '8+2套餐' },
    { key: '8+3', frontPool: 8, backPool: 3, label: '8+3套餐' },
    { key: '8+5', frontPool: 8, backPool: 5, label: '8+5套餐' },
    { key: '9+5', frontPool: 9, backPool: 5, label: '9+5套餐' },
    { key: '10+5', frontPool: 10, backPool: 5, label: '10+5套餐' },
    { key: '15+5', frontPool: 15, backPool: 5, label: '15+5套餐' },
  ];

  /**
   * 计算套餐注数和费用
   */
  static calcPlanBets(plan) {
    const fc = NumberEliminator._comb(plan.frontPool, CONFIG.FRONT_COUNT);
    const bc = NumberEliminator._comb(plan.backPool, CONFIG.BACK_COUNT);
    const total = fc * bc;
    return { frontBets: fc, backBets: bc, totalBets: total, cost: total * 2 };
  }

  /**
   * 组合数 C(n,k)
   */
  static _comb(n, k) {
    if (k > n || k < 0) return 0;
    if (k === 0 || k === n) return 1;
    let r = 1;
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return Math.round(r);
  }

  /**
   * 从剩余号码池中自动选取最优号码填充套餐
   * 评分依据：综合频率、遗漏、时间衰减、趋势动量
   * @param {LotteryAnalyzer} analyzer
   * @param {number[]} frontRemaining - 前区剩余号码
   * @param {number[]} backRemaining - 后区剩余号码
   * @param {Object} plan - 套餐配置 { frontPool, backPool }
   * @returns {{ frontSelected, backSelected, frontScores, backScores }}
   */
  static autoSelect(analyzer, frontRemaining, backRemaining, plan) {
    const hotCold = analyzer.getHotColdNumbers(30);
    const frontFreq = analyzer.frequencyAnalyzer.analyzeFrequency()[0];
    const recentFreq = analyzer.frequencyAnalyzer.analyzeRecentFrequency(15);
    const frontOmission = analyzer.omissionCalculator.calculateOmission().front;

    // 前区评分
    const frontScores = {};
    const totalFrontFreq = Object.values(frontFreq).reduce((a, b) => a + b, 0);
    const avgFrontFreq = totalFrontFreq / CONFIG.FRONT_RANGE;

    for (const num of frontRemaining) {
      const freq = frontFreq[num] || 0;
      const freqScore = safeDivide(freq, avgFrontFreq, 1) * 30; // 频率分
      const omission = frontOmission[num] || 0;
      // 遗漏回归分：遗漏适中得分高
      const omissionScore = omission >= 3 && omission <= 10 ? 25 : omission > 10 ? 15 : omission < 2 ? 5 : 20;
      const momentumScore = (recentFreq.frontMomentum[num] || 0) > 0 ? 15 : 5; // 趋势动量分
      const decayScore = (recentFreq.front[num] || 0) / recentFreq.recentCount * 20; // 近期活跃分
      frontScores[num] = freqScore + omissionScore + momentumScore + decayScore;
    }

    // 后区评分
    const backFreq = analyzer.frequencyAnalyzer.analyzeFrequency()[1];
    const backOmission = analyzer.omissionCalculator.calculateOmission().back;
    const totalBackFreq = Object.values(backFreq).reduce((a, b) => a + b, 0);
    const avgBackFreq = totalBackFreq / CONFIG.BACK_RANGE;
    const backScores = {};

    for (const num of backRemaining) {
      const freq = backFreq[num] || 0;
      const freqScore = safeDivide(freq, avgBackFreq, 1) * 30;
      const omission = backOmission[num] || 0;
      const omissionScore = omission >= 2 && omission <= 6 ? 25 : omission > 6 ? 15 : omission < 1 ? 5 : 20;
      const momentumScore = (recentFreq.backMomentum[num] || 0) > 0 ? 15 : 5;
      const decayScore = (recentFreq.back[num] || 0) / recentFreq.recentCount * 20;
      backScores[num] = freqScore + omissionScore + momentumScore + decayScore;
    }

    // 按评分降序排列，选取前N个
    const frontSelected = [...frontRemaining]
      .sort((a, b) => (frontScores[b] || 0) - (frontScores[a] || 0))
      .slice(0, plan.frontPool);
    const backSelected = [...backRemaining]
      .sort((a, b) => (backScores[b] || 0) - (backScores[a] || 0))
      .slice(0, plan.backPool);

    return { frontSelected: frontSelected.sort((a, b) => a - b), backSelected: backSelected.sort((a, b) => a - b), frontScores, backScores };
  }

  /**
   * 生成复式组合
   * @param {number[]} frontNumbers - 前区号码池
   * @param {number[]} backNumbers - 后区号码池
   * @param {number} frontCount - 前区选号数（默认CONFIG.FRONT_COUNT=5）
   * @param {number} backCount - 后区选号数（默认CONFIG.BACK_COUNT=2）
   * @returns {Object} 复式组合结果
   */
  static generateFushiCombinations(frontNumbers, backNumbers, frontCount = CONFIG.FRONT_COUNT, backCount = CONFIG.BACK_COUNT) {
    if (frontNumbers.length < frontCount) {
      throw new Error(`前区号码不足：需要${frontCount}个，仅有${frontNumbers.length}个`);
    }
    if (backNumbers.length < backCount) {
      throw new Error(`后区号码不足：需要${backCount}个，仅有${backNumbers.length}个`);
    }

    // 计算注数
    const frontCombinationsCount = NumberEliminator._comb(frontNumbers.length, frontCount);
    const backCombinationsCount = NumberEliminator._comb(backNumbers.length, backCount);
    const totalBets = frontCombinationsCount * backCombinationsCount;

    // 小套餐（≤500注）自动生成组合明细供查看/导出，大套餐省略避免内存浪费
    let combinations = null;
    if (totalBets <= 500) {
      const sortedFront = [...frontNumbers].sort((a, b) => a - b);
      const sortedBack = [...backNumbers].sort((a, b) => a - b);
      const frontCombos = NumberEliminator._generateAllCombinations(sortedFront, frontCount);
      const backCombos = NumberEliminator._generateAllCombinations(sortedBack, backCount);
      combinations = [];
      for (const fc of frontCombos) {
        for (const bc of backCombos) {
          combinations.push({ front: fc, back: bc });
        }
      }
    }

    return {
      frontPool: [...frontNumbers].sort((a, b) => a - b),
      backPool: [...backNumbers].sort((a, b) => a - b),
      frontCount,
      backCount,
      frontCombinations: frontCombinationsCount,
      backCombinations: backCombinationsCount,
      totalBets,
      cost: totalBets * 2,
      combinations,
      hasDetails: combinations !== null,
      generatedAt: new Date().toLocaleString('zh-CN')
    };
  }

  /**
   * 生成所有k个元素的组合（从数组arr中选k个）
   */
  static _generateAllCombinations(arr, k) {
    if (k > arr.length || k <= 0) return [];
    if (k === arr.length) return [[...arr]];
    if (k === 1) return arr.map(item => [item]);

    const result = [];
    for (let i = 0; i <= arr.length - k; i++) {
      const head = arr[i];
      const tailCombinations = NumberEliminator._generateAllCombinations(arr.slice(i + 1), k - 1);
      for (const tail of tailCombinations) {
        result.push([head, ...tail]);
      }
    }
    return result;
  }
}
