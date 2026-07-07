/**
 * 复式选号优化器 (FushiSelector)
 *
 * 针对复式玩法"号码池覆盖率"目标设计，弥补 UnifiedScorer 仅按总分排序取前N、
 * 缺少群体结构优化的缺陷。
 *
 * 核心思路：
 * 复式投注买的是号码池的所有组合，目标是让开奖号尽可能多地落入池中。
 * 因此号码池的"结构"比单号分数更重要：
 *   1. 区间覆盖广（7小区尽量都有代表，避免某区全军覆没）
 *   2. 冷热搭配（池中要有热号/温号/冷号，匹配开奖号的真实分布）
 *   3. 遗漏多样性（低/中/高遗漏段都有代表）
 *   4. 和值中心化（池子均值接近经验中心 90/5≈18）
 *   5. 奇偶平衡（避免极端奇偶比）
 *
 * 算法：贪心选择 + 结构评分。每步从候选池选一个号码，使当前池子的
 *   综合得分（个体分 40% + 结构分 60%）最大化。
 */

import { CONFIG } from '../core/Config.js';
import { UnifiedScorer } from './UnifiedScorer.js';
import { getZone7, getBackZone4 } from './ZonePrediction.js';

export class FushiSelector {

  /**
   * 复式选号 - 群体组合优化
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {number[]} frontRemaining - 杀号后前区剩余号码
   * @param {number[]} backRemaining - 杀号后后区剩余号码
   * @param {Object} plan - 套餐配置 { frontPool, backPool }
   * @param {string} strategy - 'hot' | 'balanced' | 'conservative'
   * @returns {{ frontSelected, backSelected, frontMeta, backMeta }}
   */
  static select(analyzer, frontRemaining, backRemaining, plan, strategy = 'balanced') {
    const frontResult = FushiSelector._selectFront(analyzer, frontRemaining, plan.frontPool, strategy);
    const backResult = FushiSelector._selectBack(analyzer, backRemaining, plan.backPool, strategy);
    return {
      frontSelected: frontResult.selected,
      backSelected: backResult.selected,
      frontMeta: frontResult.meta,
      backMeta: backResult.meta,
    };
  }

  // ==================== 前区选号 ====================

  static _selectFront(analyzer, frontRemaining, poolSize, strategy) {
    // 剩余号码不足，直接全选
    if (frontRemaining.length <= poolSize) {
      const selected = [...frontRemaining].sort((a, b) => a - b);
      return { selected, meta: { mode: 'full', candidateSize: selected.length } };
    }

    // 1. UnifiedScorer 评分，过滤到剩余号码
    const scored = UnifiedScorer.score(analyzer, 'front', strategy)
      .filter(r => frontRemaining.includes(r.number));

    if (scored.length === 0) {
      return { selected: [...frontRemaining].sort((a, b) => a - b), meta: { mode: 'fallback' } };
    }

    // 2. 候选池：取 Top（poolSize*2，至少 poolSize+4），保证有选择空间
    const candidateSize = Math.min(scored.length, Math.max(poolSize + 4, poolSize * 2));
    const candidates = scored.slice(0, candidateSize);

    // 3. 预计算遗漏数据（用于冷热分桶与多样性评估）
    const omissionData = analyzer.omissionCalculator.calculateOmission();
    const frontOmission = omissionData.front || {};
    const avgOmission = analyzer.omissionCalculator.getAverageOmission('front') || 7;

    // 3.1 预计算和值中心（动态值，避免固定18导致结构分失准）
    let frontIdealPerNum = 18;
    try {
      const sumTrend = analyzer.trendAnalyzer.analyzeSumTrend();
      frontIdealPerNum = (sumTrend.avgFrontSum || 90) / CONFIG.FRONT_COUNT;
    } catch (e) { /* 降级到默认18 */ }

    // 4. 贪心选择
    const selected = [];
    const usedNumbers = new Set();

    // 4.1 先放评分最高的一个作为种子（保证个体分基线）
    const seed = candidates[0];
    selected.push(seed);
    usedNumbers.add(seed.number);

    // 4.2 逐步贪心填充
    while (selected.length < poolSize && selected.length < candidates.length) {
      let bestCandidate = null;
      let bestScore = -Infinity;

      for (const c of candidates) {
        if (usedNumbers.has(c.number)) continue;

        // 评估"加入该号码后"的池子结构分
        const trialPool = selected.concat(c);
        const structScore = FushiSelector._evalFrontStructure(trialPool, frontOmission, avgOmission, frontIdealPerNum);

        // 综合 = 个体分(40%) + 结构分(60%)
        // 回测验证：40/60优于60/40（结构分主导能避免区间集中，个体分≈随机无法主导）
        const totalScore = c.totalScore * 0.4 + structScore * 0.6;

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestCandidate = c;
        }
      }

      if (!bestCandidate) break;
      selected.push(bestCandidate);
      usedNumbers.add(bestCandidate.number);
    }

    const result = selected.map(s => s.number).sort((a, b) => a - b);
    return {
      selected: result,
      meta: {
        mode: 'greedy',
        candidateSize,
        zoneCoverage: new Set(result.map(getZone7)).size,
      },
    };
  }

  /**
   * 评估前区号码池的结构得分（越高越可能覆盖开奖号）
   * 维度：区间覆盖 + 遗漏多样性 + 和值中心 + 奇偶平衡 + 冷热搭配
   */
  static _evalFrontStructure(pool, frontOmission, avgOmission, idealPerNum = 18) {
    let score = 0;
    const numbers = pool.map(p => (typeof p === 'number' ? p : p.number));

    // 维度1: 7小区覆盖（权重最大，开奖号通常覆盖3-4个区，池子应尽量广）
    const zones = new Set(numbers.map(getZone7));
    score += zones.size * 12; // 最多7区=84分

    // 维度2: 遗漏多样性（低/中/高三段都要有）
    const omissionBuckets = new Set();
    for (const n of numbers) {
      const om = frontOmission[n] || 0;
      const ratio = avgOmission > 0 ? om / avgOmission : 0;
      if (ratio <= 0.5) omissionBuckets.add('hot');
      else if (ratio <= 1.5) omissionBuckets.add('warm');
      else omissionBuckets.add('cold');
    }
    score += omissionBuckets.size * 9; // 最多3段=27分

    // 维度3: 和值中心化（池子均值接近动态理想单号贡献）
    const avgNum = numbers.reduce((s, n) => s + n, 0) / numbers.length;
    const sumDeviation = Math.abs(avgNum - idealPerNum);
    score += Math.max(0, 15 - sumDeviation); // 偏离越大分越低

    // 维度4: 奇偶平衡（避免极端奇偶比）
    const oddCount = numbers.filter(n => n % 2 !== 0).length;
    const evenCount = numbers.length - oddCount;
    const oddEvenDiff = Math.abs(oddCount - evenCount);
    score += Math.max(0, 10 - oddEvenDiff * 2.5);

    // 维度5: 冷热搭配惩罚（全热或全冷都不好）
    if (omissionBuckets.size === 1) {
      score -= 8; // 单一遗漏段惩罚
    }

    // 维度6: 012路分布平衡（开奖号通常三路各有代表，避免某路全军覆没）
    // 0路=3的倍数, 1路=除3余1, 2路=除3余2
    const roadCounts = [0, 0, 0];
    for (const n of numbers) roadCounts[n % 3]++;
    const roadMin = Math.min(...roadCounts);
    const roadMax = Math.max(...roadCounts);
    if (roadMin > 0) score += 8; // 三路都有代表
    score += Math.max(0, 7 - (roadMax - roadMin)); // 分布越均衡分越高

    return score;
  }

  // ==================== 后区选号 ====================

  static _selectBack(analyzer, backRemaining, poolSize, strategy) {
    if (backRemaining.length <= poolSize) {
      const selected = [...backRemaining].sort((a, b) => a - b);
      return { selected, meta: { mode: 'full' } };
    }

    const scored = UnifiedScorer.score(analyzer, 'back', strategy)
      .filter(r => backRemaining.includes(r.number));

    if (scored.length === 0) {
      return { selected: [...backRemaining].sort((a, b) => a - b), meta: { mode: 'fallback' } };
    }

    const candidateSize = Math.min(scored.length, Math.max(poolSize + 3, poolSize * 2));
    const candidates = scored.slice(0, candidateSize);

    const omissionData = analyzer.omissionCalculator.calculateOmission();
    const backOmission = omissionData.back || {};
    const avgOmission = analyzer.omissionCalculator.getAverageOmission('back') || 6;

    // 预计算和值中心（动态值，避免固定6.5导致结构分失准）
    let backIdealPerNum = 6.5;
    try {
      const sumTrend = analyzer.trendAnalyzer.analyzeSumTrend();
      backIdealPerNum = (sumTrend.avgBackSum || 13) / CONFIG.BACK_COUNT;
    } catch (e) { /* 降级到默认6.5 */ }

    const selected = [];
    const usedNumbers = new Set();

    // 种子：评分最高
    selected.push(candidates[0]);
    usedNumbers.add(candidates[0].number);

    while (selected.length < poolSize && selected.length < candidates.length) {
      let bestCandidate = null;
      let bestScore = -Infinity;

      for (const c of candidates) {
        if (usedNumbers.has(c.number)) continue;

        const trialPool = selected.concat(c);
        const structScore = FushiSelector._evalBackStructure(trialPool, backOmission, avgOmission, backIdealPerNum);
        const totalScore = c.totalScore * 0.4 + structScore * 0.6;

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestCandidate = c;
        }
      }

      if (!bestCandidate) break;
      selected.push(bestCandidate);
      usedNumbers.add(bestCandidate.number);
    }

    const result = selected.map(s => s.number).sort((a, b) => a - b);
    return {
      selected: result,
      meta: {
        mode: 'greedy',
        candidateSize,
        zoneCoverage: new Set(result.map(getBackZone4)).size,
      },
    };
  }

  /**
   * 评估后区号码池结构
   * 后区12个号分4小区(1-3/4-6/7-9/10-12)，开奖2个号通常覆盖1-2个区
   */
  static _evalBackStructure(pool, backOmission, avgOmission, idealPerNum = 6.5) {
    let score = 0;
    const numbers = pool.map(p => (typeof p === 'number' ? p : p.number));

    // 维度1: 4小区覆盖
    const zones = new Set(numbers.map(getBackZone4));
    score += zones.size * 12; // 最多4区=48分

    // 维度2: 遗漏多样性
    const omissionBuckets = new Set();
    for (const n of numbers) {
      const om = backOmission[n] || 0;
      const ratio = avgOmission > 0 ? om / avgOmission : 0;
      if (ratio <= 0.5) omissionBuckets.add('hot');
      else if (ratio <= 1.5) omissionBuckets.add('warm');
      else omissionBuckets.add('cold');
    }
    score += omissionBuckets.size * 9;

    // 维度3: 和值中心化（池子均值接近动态理想单号贡献）
    const avgNum = numbers.reduce((s, n) => s + n, 0) / numbers.length;
    const sumDeviation = Math.abs(avgNum - idealPerNum);
    score += Math.max(0, 12 - sumDeviation);

    // 维度4: 奇偶平衡
    const oddCount = numbers.filter(n => n % 2 !== 0).length;
    const evenCount = numbers.length - oddCount;
    const oddEvenDiff = Math.abs(oddCount - evenCount);
    score += Math.max(0, 8 - oddEvenDiff * 2);

    // 维度5: 单一遗漏段惩罚
    if (omissionBuckets.size === 1) score -= 6;

    // 维度6: 012路分布平衡（后区12号三路各4个，池子应尽量覆盖多路）
    const roadCounts = [0, 0, 0];
    for (const n of numbers) roadCounts[n % 3]++;
    const roadMin = Math.min(...roadCounts);
    const roadMax = Math.max(...roadCounts);
    if (roadMin > 0) score += 6; // 三路都有代表
    score += Math.max(0, 5 - (roadMax - roadMin)); // 分布越均衡分越高

    return score;
  }
}
