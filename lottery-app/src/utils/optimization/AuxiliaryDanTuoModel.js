/**
 * 统一辅助胆拖推荐模型（P4合并：Bayesian+Normal+Zhouyi → 单一模型）
 * 保留三个模型的核心特色维度，通过mode参数切换
 * mode='bayesian': 先验→后验动态更新，重号因子+和值趋势
 * mode='normal': 期望值/方差引导搜索，和值逼近目标+组合质量评估
 * mode='zhouyi': 卦象映射+时辰映射+开奖日特征
 */

import { CONFIG } from '../core/Config.js';
import {
  PHI, PHI_INV, PHI_COMPLEMENT,
  FIB_FRONT, FIB_BACK,
  goldenRegressionBonus, fibonacciRhythmBonus,
  goldenSumTarget, fibonacciPresenceScore, fibonacciSumBonus,
  goldenWeightDistribution, fibonacciTimeWeights,
  moderateOmissionRecovery, recentAppearanceBonus
} from './GoldenFibonacci.js';

export class AuxiliaryDanTuoModel {

  /**
   * 推荐前区胆码+拖码
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {number} danCount - 胆码数量(2-4)
   * @param {string} strategy - 策略: hot/balanced/conservative
   * @param {string} mode - 模型模式: bayesian/normal/zhouyi
   * @returns {Object} { danSelected, tuoSelected, probabilityInfo, description }
   */
  static recommendFront(analyzer, danCount = 3, strategy = 'hot', mode = 'bayesian') {
    const modeIcons = { bayesian: '🔮', normal: '📊', zhouyi: '🧭', goldenFibonacci: '🌟' };
    const modeNames = { bayesian: '贝叶斯动态', normal: '正态分布', zhouyi: '周易时空', goldenFibonacci: '黄金斐波那契' };
    console.log(`${modeIcons[mode]} ${modeNames[mode]}胆拖推荐（前区）- 样本量：近30期`);

    const activeData = analyzer.getActiveData();
    if (activeData.length === 0) {
      return { danSelected: [], tuoSelected: [], probabilityInfo: [], backDanSelected: [], backTuoSelected: [], description: '数据不足' };
    }

    const recentData = activeData.slice(-30);
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();
    const omission = analyzer.omissionCalculator.calculateOmission();
    const avgFrontOmission = analyzer.omissionCalculator.getAverageOmission('front');
    const lastDraw = recentData[recentData.length - 1];
    const sumTrend = analyzer.trendAnalyzer.analyzeSumTrend();
    const repeatAnalysis = analyzer.trendAnalyzer.analyzeRepeatNumbers();

    // 近30期前区频率
    const recentFrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) recentFrontFreq[i] = 0;
    for (const draw of recentData) {
      for (const num of draw.front) recentFrontFreq[num]++;
    }
    const maxFreq = Math.max(...Object.values(recentFrontFreq), 0);
    const totalDraws = recentData.length;

    // 近10期动量频率
    const recentMomentumCount = Math.min(10, recentData.length);
    const recentMomentumFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) recentMomentumFreq[i] = 0;
    const recentMomentumDraws = recentData.slice(-recentMomentumCount);
    for (const draw of recentMomentumDraws) {
      for (const num of draw.front) recentMomentumFreq[num]++;
    }

    // 时间加权得分（归一化）
    const frontTimeScores = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontTimeScores[i] = 0;
    for (let idx = 0; idx < recentData.length; idx++) {
      const draw = recentData[idx];
      const timeWeight = Math.exp((idx - recentData.length + 1) / recentData.length) * 0.2;
      for (const num of draw.front) frontTimeScores[num] += timeWeight;
    }
    const frontMaxTime = Math.max(...Object.values(frontTimeScores)) || 1;
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontTimeScores[i] /= frontMaxTime;

    let frontWeights = {}; // 各模式的权重计算结果

    if (mode === 'bayesian') {
      // 贝叶斯模式：先验→后验，8维评分
      const priorFront = {};
      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
        priorFront[i] = recentFrontFreq[i] / (totalDraws || 1);
      }
      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
        let score = priorFront[i] * 0.15; // 先验15%
        score += (frontTimeScores[i] || 0) * 0.12; // 时间加权12%
        const recentRate = recentMomentumFreq[i] / recentMomentumCount;
        score += (recentRate - priorFront[i]) * 0.12; // 动量12%
        score += (conditionalProb.front[i] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence; // 条件概率20%
        const currentOmission = omission.front[i] || 0;
        const omissionDiff = Math.abs(currentOmission - avgFrontOmission);
        const omissionFactor = Math.max(0, 1 - omissionDiff / (avgFrontOmission * 2));
        score += omissionFactor * 0.15; // 遗漏15%
        const zoneIndex = Math.floor((i - 1) / 5);
        score += (zoneIndex % 2 === 0) ? 0.05 : 0; // 奇偶5%
        if (lastDraw && lastDraw.front.includes(i)) score += repeatAnalysis.frontRepeatRate * 0.08; // 重号8%
        if (sumTrend.trendFront > 5 && i > 18) score += 0.04; // 和值趋势
        else if (sumTrend.trendFront < -5 && i <= 18) score += 0.04;
        frontWeights[i] = score;
      }
    } else if (mode === 'normal') {
      // 正态分布模式：和值目标引导+组合质量
      const targetSumFront = Math.round(recentData.map(d => d.front.reduce((a, b) => a + b, 0))
        .reduce((a, b) => a + b, 0) / recentData.length);
      
      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
        const freq = (recentFrontFreq[i] || 0) + 1;
        const freqNorm = freq / (maxFreq + 1);
        const cond = (conditionalProb.front[i] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence * 10;
        const currentOmission = omission.front[i] || 0;
        const omissionDeviation = currentOmission - avgFrontOmission;
        const omissionBonus = omissionDeviation > 0 ? omissionDeviation / (avgFrontOmission + 1) : 0;
        frontWeights[i] = freqNorm * 10 + cond + omissionBonus * 3;
      }

      // 和值引导搜索
      let bestFront = null;
      let bestScore = -Infinity;
      for (let i = 0; i < 300; i++) {
        let f;
        if (i < 240) {
          const frontNums = Object.keys(frontWeights).map(Number);
          const frontW = Object.values(frontWeights);
          f = AuxiliaryDanTuoModel._weightedSampleNoReplacement(frontNums, frontW, CONFIG.FRONT_COUNT);
        } else {
          f = [...Array.from({ length: CONFIG.FRONT_RANGE }, (_, idx) => idx + 1)].sort(() => Math.random() - 0.5).slice(0, CONFIG.FRONT_COUNT);
        }
        const sumF = f.reduce((a, b) => a + b, 0);
        const diffF = Math.abs(sumF - targetSumFront);
        const sumScore = 100 - (diffF / targetSumFront * 50);
        const oddCount = f.filter(n => n % 2 !== 0).length;
        const qualityScore = (oddCount >= 2 && oddCount <= 3) ? 60 : 50;
        const bigCount = f.filter(n => n > 17).length;
        if (bigCount >= 2 && bigCount <= 3) qualityScore += 10;
        const zones = new Set(f.map(n => Math.floor((n - 1) / 5)));
        const coverageBonus = zones.size >= 4 ? 5 : zones.size >= 3 ? 2 : -3;
        const totalScore = sumScore * 0.3 + qualityScore * 0.6 + coverageBonus;
        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestFront = f.sort((a, b) => a - b);
        }
        if (diffF < 10 && qualityScore >= 70 && zones.size >= 3) break;
      }
      if (!bestFront) bestFront = Array.from({ length: CONFIG.FRONT_COUNT }, (_, i) => i + 1);
      
      // 确保区间覆盖
      bestFront = AuxiliaryDanTuoModel._enforceZoneCoverage(bestFront, 4);
      
      // 胆码选择基于权重评分
      const danPriority = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .map(n => ({ number: n, score: frontWeights[n] || 0 }))
        .sort((a, b) => b.score - a.score);
      const danSelected = danPriority.slice(0, danCount).map(d => d.number).sort((a, b) => a - b);
      const tuoRest = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .filter(n => !danSelected.includes(n))
        .sort((a, b) => (frontWeights[b] || 0) - (frontWeights[a] || 0));
      const tuoCount = 15 - danCount;
      const tuoSelected = tuoRest.slice(0, tuoCount).sort((a, b) => a - b);
      const probabilityInfo = danPriority.slice(0, 5).map((item, idx) => ({
        number: item.number, probability: item.score, rank: idx + 1, score: item.score
      }));

      console.log('✅ 正态分布前区推荐完成 - 胆码:', danSelected, '拖码:', tuoSelected.slice(0, 5), '目标和值:', targetSumFront);
      return {
        danSelected, tuoSelected, probabilityInfo, targetSum: targetSumFront,
        description: `正态分布模型：期望值${targetSumFront}引导搜索，和值逼近目标+组合质量评估`,
        recommendType: '确定性推荐'
      };
    } else if (mode === 'zhouyi') {
      // 周易时空模式：卦象映射+开奖日特征
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const day = now.getDate();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const second = now.getSeconds();
      const weekday = now.getDay();

      // 计算距离下次开奖的天数
      const drawDays = [1, 3, 6];
      let daysToNextDraw = 7;
      let nextDrawDay = 1;
      for (const drawDay of drawDays) {
        let diff = drawDay - weekday;
        if (diff <= 0) diff += 7;
        if (diff === 0 && hour >= 20) diff = 7;
        if (diff < daysToNextDraw) { daysToNextDraw = diff; nextDrawDay = drawDay; }
      }

      // 卦象计算
      const upperTrigram = (year + month + day) % 8;
      const lowerTrigram = (year + month + day + hour + minute) % 8;
      const movingLine = (year + month + day + hour + minute + second + daysToNextDraw) % 6;

      const trigramElements = {
        0: [1, 8, 15, 22, 29], 1: [2, 9, 16, 23, 30],
        2: [3, 10, 17, 24, 31], 3: [4, 11, 18, 25, 32],
        4: [5, 12, 19, 26, 33], 5: [6, 13, 20, 27, 34],
        6: [7, 14, 21, 28, 35], 7: [1, 9, 17, 25, 33]
      };

      const poolUpper = trigramElements[upperTrigram] || [];
      const poolLower = trigramElements[lowerTrigram] || [];
      const combinedPool = [...new Set([...poolUpper, ...poolLower])];

      if (combinedPool.length < CONFIG.FRONT_COUNT) {
        const movingLineNumbers = [
          movingLine + 1, movingLine + 6, movingLine + 11,
          movingLine + 16, movingLine + 21, movingLine + 26, movingLine + 31
        ].filter(n => n >= 1 && n <= CONFIG.FRONT_RANGE);
        combinedPool.push(...movingLineNumbers);
      }

      // 开奖日特征频率
      const drawDayCycle = [1, 3, 6];
      const drawDayToCyclePos = { 1: 0, 3: 1, 6: 2 };
      const targetCyclePos = drawDayToCyclePos[nextDrawDay];
      const weekdayOffset = ((targetCyclePos - totalDraws % 3) + 3) % 3;
      const weekdayFrontFreq = {};
      for (let i = 0; i < recentData.length; i++) {
        const drawWeekday = drawDayCycle[(i + weekdayOffset) % 3];
        if (drawWeekday === nextDrawDay) {
          for (const num of recentData[i].front) {
            weekdayFrontFreq[num] = (weekdayFrontFreq[num] || 0) + 1;
          }
        }
      }
      const maxWeekdayFreq = Math.max(...Object.values(weekdayFrontFreq), 0);

      const correlation = analyzer.correlationAnalyzer.calculateNumberCorrelation();

      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
        const isInPool = combinedPool.includes(i);
        const freqWeight = isInPool ? ((recentFrontFreq[i] || 0) + 1) * 2 / (maxFreq + 1) * 10 : 1;
        const condBonus = (conditionalProb.front[i] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence * 8;
        let corrBonus = 0;
        if (correlation.front[i]) {
          const correlations = Object.values(correlation.front[i]);
          if (correlations.length > 0) corrBonus = correlations.reduce((sum, c) => sum + c, 0) / correlations.length * 0.1;
        }
        const scienceBonus = isInPool ? 0 : (conditionalProb.front[i] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence * 3;
        const weekdayFreqNum = weekdayFrontFreq[i] || 0;
        const weekdayBonus = maxWeekdayFreq > 0 ? (weekdayFreqNum / maxWeekdayFreq) * 3 : 0;
        frontWeights[i] = freqWeight + condBonus + corrBonus + scienceBonus + weekdayBonus;
      }
    } else if (mode === 'goldenFibonacci') {
      // === 黄金斐波那契模式：黄金分割+斐波那契数列驱动的数学模型 ===
      // 核心思想：用φ(≈0.618)和斐波那契数列替代经验权重，数学依据更强
      // 5维评分：频率φ权重 + 遗漏黄金回归 + 条件概率φ比例 + 斐波那契结构 + 区间覆盖φ分布
      
      // 斐波那契时间衰减权重（替代指数衰减）
      const fibTimeWeights = fibonacciTimeWeights(Math.min(recentData.length, 7));
      const fibTimeScores = {};
      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) fibTimeScores[i] = 0;
      for (let idx = 0; idx < recentData.length; idx++) {
        // 使用斐波那契衰减：越近的期数权重越高，比例趋近φ
        const fibIdx = Math.min(idx, fibTimeWeights.length - 1);
        const timeWeight = fibTimeWeights.length > 0 ? fibTimeWeights[fibIdx] : 0;
        for (const num of recentData[idx].front) fibTimeScores[num] += timeWeight;
      }
      const maxFibTime = Math.max(...Object.values(fibTimeScores)) || 1;
      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) fibTimeScores[i] /= maxFibTime;
      
      // 黄金比例权重分配：条件概率φ权重(0.618) + 频率φ补数(0.382)
      const goldenWeights = goldenWeightDistribution('frontBack');
      
      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
        let score = 0;
        const freq = (recentFrontFreq[i] || 0) + 1;
        const freqNorm = freq / (maxFreq + 1);
        // 1. 频率得分 × φ补数(0.382) - 频率是基础信号但不应过度依赖
        score += freqNorm * 10 * PHI_COMPLEMENT;
        // 2. 斐波那契时间衰减得分 × φ(0.618) - 近期出现更重要
        score += (fibTimeScores[i] || 0) * 12 * PHI;
        // 3. 遗漏黄金回归得分 - 遗漏≈0.618×avg或≈1.618×avg时回归概率高
        const currentOmission = omission.front[i] || 0;
        const goldenBonus = goldenRegressionBonus(currentOmission, avgFrontOmission, analyzer.omissionCalculator.getOmissionStd('front'));
        score += goldenBonus * 3;
        // 4. 斐波那契节奏得分 - 遗漏=斐波那契数时处于自然节奏回归点
        const fibRhythm = fibonacciRhythmBonus(currentOmission);
        score += fibRhythm * 2;
        // 回测O6新增：中间地带回升 + 低遗漏近期加分
        score += moderateOmissionRecovery(currentOmission, avgFrontOmission) * 2;
        score += recentAppearanceBonus(currentOmission, avgFrontOmission) * 2;
        // 5. 条件概率得分 × φ(0.618) - 更难命中的前区条件概率权重更高
        score += (conditionalProb.front[i] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence * PHI * 10;
        // 6. 斐波那契号码结构加分 - 斐波那契数{1,2,3,5,8,13,21,34}有统计显著性
        if (FIB_FRONT.includes(i)) score += 1;
        frontWeights[i] = score;
      }
    }

    // 通用选择逻辑（bayesian/zhouyi/goldenFibonacci共用）
    const sortedWeights = Object.entries(frontWeights).sort((a, b) => b[1] - a[1]);
    const candidateSize = strategy === 'hot' ? 10 : strategy === 'balanced' ? 15 : 20;
    const candidatePool = sortedWeights.slice(0, candidateSize).map(x => ({
      number: Number(x[0]), weight: x[1]
    }));

    const danSelected = candidatePool.slice(0, danCount).map(c => c.number);
    const tuoAllNumbers = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
      .filter(n => !danSelected.includes(n));
    const tuoCandidates = tuoAllNumbers.map(n => ({
      number: n, weight: frontWeights[n] || 0
    })).sort((a, b) => b.weight - a.weight);
    const tuoCount = 15 - danCount;
    const tuoSelected = tuoCandidates.slice(0, tuoCount).map(c => c.number);

    const probabilityInfo = sortedWeights.slice(0, 5).map(([num, weight], idx) => ({
      number: Number(num), probability: weight, rank: idx + 1, score: weight
    }));

    // 黄金斐波那契特有信息
    if (mode === 'goldenFibonacci') {
      const goldenTarget = goldenSumTarget(15, 165);
      const fibPresence = fibonacciPresenceScore(danSelected.concat(tuoSelected.slice(0, 5)), 'front');
      console.log('✅ 黄金斐波那契前区推荐完成 - 胆码:', danSelected.sort((a, b) => a - b),
        `黄金和值[${goldenTarget.lower}-${goldenTarget.upper}]中心${goldenTarget.ideal}, 斐波那契${fibPresence.fibCount}个`);
      return {
        danSelected: danSelected.sort((a, b) => a - b),
        tuoSelected: tuoSelected.sort((a, b) => a - b),
        probabilityInfo,
        goldenTarget,
        fibPresence,
        description: `黄金斐波那契模型：φ≈${PHI.toFixed(3)}比例权重分配+遗漏黄金回归+斐波那契节奏+号码结构评估`,
        recommendType: '确定性推荐'
      };
    }

    // 周易特有信息
    if (mode === 'zhouyi') {
      const trigramNames = ['乾', '兑', '离', '震', '巽', '坎', '', '坤'];
      const upperName = trigramNames[upperTrigram];
      const lowerName = trigramNames[lowerTrigram];
      const drawDayNames = { 1: '周一', 3: '周三', 6: '周六' };
      console.log('✅ 周易时空前区推荐完成 - 胆码:', danSelected.sort((a, b) => a - b),
        `卦象:${upperName}/${lowerName}, 开奖日:${drawDayNames[nextDrawDay]}`);
      return {
        danSelected: danSelected.sort((a, b) => a - b),
        tuoSelected: tuoSelected.sort((a, b) => a - b),
        probabilityInfo,
        trigramInfo: { upper: upperName, lower: lowerName, movingLine },
        nextDrawDay: drawDayNames[nextDrawDay],
        description: `周易时空模型：${upperName}${lowerName}卦+动爻${movingLine+1}，下次开奖${drawDayNames[nextDrawDay]}`,
        recommendType: '确定性推荐'
      };
    }

    // 贝叶斯描述
    console.log('✅ 贝叶斯动态前区推荐完成 - 胆码:', danSelected.sort((a, b) => a - b));
    return {
      danSelected: danSelected.sort((a, b) => a - b),
      tuoSelected: tuoSelected.sort((a, b) => a - b),
      probabilityInfo,
      description: '贝叶斯动态模型：先验→后验修正，融合重号因子+和值趋势+时间加权（归一化）',
      recommendType: '确定性推荐'
    };
  }

  /**
   * 推荐后区胆码+拖码
   */
  static recommendBack(analyzer, backDanCount = 1, mode = 'bayesian') {
    const activeData = analyzer.getActiveData();
    const recentData = activeData.slice(-30);
    const totalDraws = recentData.length;
    const lastDraw = recentData[recentData.length - 1];
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();
    const omission = analyzer.omissionCalculator.calculateOmission();
    const repeatAnalysis = analyzer.trendAnalyzer.analyzeRepeatNumbers();
    const backAvgOmission = analyzer.omissionCalculator.getAverageOmission('back');

    // 近30期后区频率
    const recentBackFreq = {};
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) recentBackFreq[i] = 0;
    for (const draw of recentData) {
      for (const num of draw.back) recentBackFreq[num]++;
    }
    const maxBackFreq = Math.max(...Object.values(recentBackFreq), 0);

    // 时间加权（归一化）
    const backTimeScores = {};
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backTimeScores[i] = 0;
    for (let idx = 0; idx < recentData.length; idx++) {
      const timeWeight = Math.exp((idx - recentData.length + 1) / recentData.length) * 0.2;
      for (const num of recentData[idx].back) backTimeScores[num] += timeWeight;
    }
    const backMaxTime = Math.max(...Object.values(backTimeScores)) || 1;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backTimeScores[i] /= backMaxTime;

    // 近10期动量
    const recentMomentumCount = Math.min(10, recentData.length);
    const recentBackMomentum = {};
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) recentBackMomentum[i] = 0;
    const recentMomentumDraws = recentData.slice(-recentMomentumCount);
    for (const draw of recentMomentumDraws) {
      for (const num of draw.back) recentBackMomentum[num]++;
    }

    let backWeights = {};

    if (mode === 'bayesian') {
      const priorBack = {};
      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) priorBack[i] = recentBackFreq[i] / (totalDraws || 1);
      
      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
        let score = priorBack[i] * 0.15;
        score += (backTimeScores[i] || 0) * 0.12;
        const recentRate = recentBackMomentum[i] / recentMomentumCount;
        score += (recentRate - priorBack[i]) * 0.12;
        score += (conditionalProb.back[i] || 0) * CONFIG.BACK_CONDITIONAL_WEIGHT * conditionalProb.confidence;
        const currentOmission = omission.back[i] || 0;
        const omissionDiff = Math.abs(currentOmission - backAvgOmission);
        const omissionFactor = Math.max(0, 1 - omissionDiff / (backAvgOmission * 2));
        score += omissionFactor * 0.15;
        if (lastDraw && lastDraw.back.includes(i)) score += repeatAnalysis.backRepeatRate * 0.08;
        // 冷热状态检测
        const expectedRate = 2 / CONFIG.BACK_RANGE;
        const temperatureRatio = recentRate / expectedRate;
        if (temperatureRatio >= 1.5) score += Math.min(0.08, (temperatureRatio - 1.5) * 0.04);
        else if (temperatureRatio < 0.5) {
          const historicalHeat = priorBack[i] / expectedRate;
          score -= Math.min(0.08, (0.5 - temperatureRatio) * 0.04 * Math.min(2, historicalHeat));
        }
        if (currentOmission > backAvgOmission * 1.5) {
          const streakRatio = currentOmission / backAvgOmission;
          score -= Math.min(0.08, (streakRatio - 1.5) * 0.02 * Math.min(2, priorBack[i] / expectedRate));
        }
        backWeights[i] = score;
      }
    } else if (mode === 'normal') {
      const targetSumBack = Math.round(recentData.map(d => d.back.reduce((a, b) => a + b, 0))
        .reduce((a, b) => a + b, 0) / recentData.length);
      
      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
        const freq = (recentBackFreq[i] || 0) + 1;
        const freqNorm = freq / (maxBackFreq + 1);
        const cond = (conditionalProb.back[i] || 0) * CONFIG.BACK_CONDITIONAL_WEIGHT * conditionalProb.confidence * 10;
        const currentOmission = omission.back[i] || 0;
        const omissionDeviation = currentOmission - backAvgOmission;
        const omissionBonus = omissionDeviation > 0 ? omissionDeviation / (backAvgOmission + 1) : 0;
        backWeights[i] = freqNorm * 10 + cond + omissionBonus * 3;
      }

      // 和值引导搜索
      let bestBack = null;
      let bestDiff = Infinity;
      for (let i = 0; i < 100; i++) {
        const backNums = Object.keys(backWeights).map(Number);
        const backW = Object.values(backWeights);
        const b = AuxiliaryDanTuoModel._weightedSampleNoReplacement(backNums, backW, CONFIG.BACK_COUNT);
        const sumB = b.reduce((a, c) => a + c, 0);
        const diff = Math.abs(sumB - targetSumBack);
        if (diff < bestDiff) { bestDiff = diff; bestBack = b.sort((a, c) => a - c); }
        if (diff < 3) break;
      }
      if (!bestBack) bestBack = [1, 2];

      const backScores = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
        .map(n => ({ number: n, score: backWeights[n] || 0 }))
        .sort((a, b) => b.score - a.score);
      const danSelected = backScores.slice(0, backDanCount).map(d => d.number);
      const tuoAll = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
        .filter(n => !danSelected.includes(n))
        .sort((a, b) => (backWeights[b] || 0) - (backWeights[a] || 0));
      const tuoSelected = tuoAll.slice(0, 4);

      return {
        danSelected: danSelected.sort((a, b) => a - b),
        tuoSelected: tuoSelected.sort((a, b) => a - b),
        targetSum: targetSumBack,
        description: `正态分布后区推荐，目标和值${targetSumBack}`,
        recommendType: '确定性推荐'
      };
    } else if (mode === 'zhouyi') {
      const now = new Date();
      const hour = now.getHours();
      const weekday = now.getDay();
      const drawDays = [1, 3, 6];
      let nextDrawDay = null;
      for (const dd of drawDays) {
        let diff = dd - weekday;
        if (diff < 0) diff += 7;
        if (diff === 0 && now.getHours() >= 20) diff = 7;
        if (diff > 0) { nextDrawDay = dd; break; }
      }
      if (!nextDrawDay) nextDrawDay = 1;

      const hourBackMap = {
        0: [1, 6, 7, 12], 1: [1, 6, 7, 12],
        2: [2, 5, 8, 11], 3: [2, 5, 8, 11],
        4: [3, 4, 9, 10], 5: [3, 4, 9, 10],
        6: [1, 4, 7, 10], 7: [1, 4, 7, 10],
        8: [2, 5, 8, 11], 9: [2, 5, 8, 11],
        10: [3, 6, 9, 12], 11: [3, 6, 9, 12],
        12: [1, 6, 7, 12], 13: [1, 6, 7, 12],
        14: [2, 5, 8, 11], 15: [2, 5, 8, 11],
        16: [3, 4, 9, 10], 17: [3, 4, 9, 10],
        18: [1, 4, 7, 10], 19: [1, 4, 7, 10],
        20: [2, 5, 8, 11], 21: [2, 5, 8, 11],
        22: [3, 6, 9, 12], 23: [3, 6, 9, 12]
      };
      const backCandidates = hourBackMap[hour] || [1, 6, 7, 12];

      // 开奖日特征
      const drawDayCycle = [1, 3, 6];
      const drawDayToCyclePos = { 1: 0, 3: 1, 6: 2 };
      const targetCyclePos = drawDayToCyclePos[nextDrawDay];
      const weekdayOffset = ((targetCyclePos - totalDraws % 3) + 3) % 3;
      const weekdayBackFreq = {};
      for (let i = 0; i < recentData.length; i++) {
        const drawWeekday = drawDayCycle[(i + weekdayOffset) % 3];
        if (drawWeekday === nextDrawDay) {
          for (const num of recentData[i].back) {
            weekdayBackFreq[num] = (weekdayBackFreq[num] || 0) + 1;
          }
        }
      }
      const maxWeekdayBackFreq = Math.max(...Object.values(weekdayBackFreq), 0);

      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
        const isTimeCandidate = backCandidates.includes(i);
        const timeWeight = isTimeCandidate ? 2.0 : 0.5;
        const freqWeight = ((recentBackFreq[i] || 0) + 1) / (maxBackFreq + 1) * 10;
        const condWeight = (conditionalProb.back[i] || 0) * CONFIG.BACK_CONDITIONAL_WEIGHT * conditionalProb.confidence * 8;
        const weekdayFreqNum = weekdayBackFreq[i] || 0;
        const weekdayBonus = maxWeekdayBackFreq > 0 ? (weekdayFreqNum / maxWeekdayBackFreq) * 3 : 0;
        backWeights[i] = timeWeight * freqWeight + condWeight + weekdayBonus;
      }
    } else if (mode === 'goldenFibonacci') {
      // === 黄金斐波那契后区模式 ===
      const backOmissionStd = analyzer.omissionCalculator.getOmissionStd('back');
      const goldenBackTarget = goldenSumTarget(3, 23);
      
      // 斐波那契时间衰减
      const fibBackTimeWeights = fibonacciTimeWeights(Math.min(recentData.length, 7));
      const fibBackTimeScores = {};
      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) fibBackTimeScores[i] = 0;
      for (let idx = 0; idx < recentData.length; idx++) {
        const fibIdx = Math.min(idx, fibBackTimeWeights.length - 1);
        const timeWeight = fibBackTimeWeights.length > 0 ? fibBackTimeWeights[fibIdx] : 0;
        for (const num of recentData[idx].back) fibBackTimeScores[num] += timeWeight;
      }
      const maxFibBackTime = Math.max(...Object.values(fibBackTimeScores)) || 1;
      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) fibBackTimeScores[i] /= maxFibBackTime;
      
      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
        let score = 0;
        // 1. 频率得分 × φ补数(0.382)
        const freq = (recentBackFreq[i] || 0) + 1;
        const freqNorm = freq / (maxBackFreq + 1);
        score += freqNorm * 10 * PHI_COMPLEMENT;
        // 2. 斐波那契时间衰减得分 × φ(0.618)
        score += (fibBackTimeScores[i] || 0) * 12 * PHI;
        // 3. 条件概率得分 × φ补数(0.382)
        score += (conditionalProb.back[i] || 0) * CONFIG.BACK_CONDITIONAL_WEIGHT * conditionalProb.confidence * PHI_COMPLEMENT * 10;
        // 4. 遗漏黄金回归得分
        const currentOmission = omission.back[i] || 0;
        score += goldenRegressionBonus(currentOmission, backAvgOmission, backOmissionStd) * 3;
        // 5. 斐波那契节奏得分
        score += fibonacciRhythmBonus(currentOmission) * 2;
        // 回测O6新增：中间地带回升 + 低遗漏近期加分
        score += moderateOmissionRecovery(currentOmission, backAvgOmission) * 2;
        score += recentAppearanceBonus(currentOmission, backAvgOmission) * 2;
        // 6. 斐波那契号码结构加分
        if (FIB_BACK.includes(i)) score += 0.5;
        backWeights[i] = score;
      }
    }

    // 通用后区选择逻辑
    const allCandidates = Object.entries(backWeights)
      .sort((a, b) => b[1] - a[1])
      .map(([num, weight]) => ({ number: Number(num), weight }));
    const danSelected = allCandidates.slice(0, backDanCount).map(c => c.number);
    const tuoAll = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
      .filter(n => !danSelected.includes(n))
      .sort((a, b) => (backWeights[b] || 0) - (backWeights[a] || 0));
    const tuoSelected = tuoAll.slice(0, 4);

    const modeDescs = {
      bayesian: '贝叶斯动态后区推荐：先验+时间+动量+条件概率+遗漏+重号+冷热状态',
      zhouyi: `周易时空后区推荐，时辰${new Date().getHours()}时`,
      goldenFibonacci: `黄金斐波那契后区推荐：φ比例权重+黄金回归+斐波那契节奏+号码结构`
    };
    const drawDayNames = { 1: '周一', 3: '周三', 6: '周六' };

    return {
      danSelected: danSelected.sort((a, b) => a - b),
      tuoSelected: tuoSelected.sort((a, b) => a - b),
      description: modeDescs[mode] || '辅助模型后区推荐',
      recommendType: '确定性推荐'
    };
  }

  // === 工具方法 ===

  static _weightedSampleNoReplacement(nums, weights, count) {
    const selected = [];
    const remainingNums = [...nums];
    const remainingWeights = [...weights];
    for (let i = 0; i < count && remainingNums.length > 0; i++) {
      const totalWeight = remainingWeights.reduce((s, w) => s + w, 0);
      let random = Math.random() * totalWeight;
      let chosenIdx = 0;
      for (let j = 0; j < remainingWeights.length; j++) {
        random -= remainingWeights[j];
        if (random <= 0) { chosenIdx = j; break; }
      }
      if (chosenIdx >= remainingNums.length) chosenIdx = remainingNums.length - 1;
      selected.push(remainingNums[chosenIdx]);
      remainingNums.splice(chosenIdx, 1);
      remainingWeights.splice(chosenIdx, 1);
    }
    return selected;
  }

  static _enforceZoneCoverage(front, minZones) {
    const zones = new Set(front.map(n => Math.floor((n - 1) / 5)));
    if (zones.size >= minZones) return front;
    const result = [...front];
    const missingZones = [];
    for (let z = 0; z < 7; z++) {
      if (!zones.has(z)) missingZones.push(z);
    }
    for (const missingZone of missingZones) {
      if (result.length >= 5) {
        const candidate = missingZone * 5 + 1;
        const zoneCounts = {};
        result.forEach(n => { const z = Math.floor((n - 1) / 5); zoneCounts[z] = (zoneCounts[z] || 0) + 1; });
        const mostCrowdedZone = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1])[0];
        if (mostCrowdedZone && mostCrowdedZone[1] > 1) {
          const replaceIdx = result.findIndex(n => Math.floor((n - 1) / 5) === Number(mostCrowdedZone[0]) && n !== Math.min(...result));
          if (replaceIdx !== -1 && !result.includes(candidate)) result[replaceIdx] = candidate;
        }
      }
    }
    return result.sort((a, b) => a - b);
  }

  static getDescription(mode = 'bayesian') {
    const descriptions = {
      bayesian: {
        name: '贝叶斯动态', icon: '🔮',
        strengths: ['先验→后验概率动态更新，理论基础扎实', '重号因子+和值趋势因子', '时间加权归一化+遗漏回归', '冷热状态检测'],
        weaknesses: ['先验概率基于近期频率，长期冷号先验极低', '和值趋势判断阈值固定(±5)', '各维度权重固定，缺乏自适应']
      },
      normal: {
        name: '正态分布', icon: '📊',
        strengths: ['期望值/方差引导搜索，和值逼近历史均值', '组合质量评估：奇偶+大小平衡', '区间覆盖保障：至少4个区间', '80%加权+20%纯随机混合'],
        weaknesses: ['和值逼近忽略号码间微观关系', '组合质量评估简单（仅奇偶+大小）', '300次迭代计算成本高', '胆码可能偏向中间值']
      },
      zhouyi: {
        name: '周易时空', icon: '🧭',
        strengths: ['开奖日特征：周一/周三/周六频率差异', '卦象映射：日期→号码池，有时间独特性', '时辰映射：时间段→后区偏好', '融合科学维度：条件概率补充权重'],
        weaknesses: ['卦象映射本质是确定性伪随机', '开奖日频率统计有偏移风险', '时辰映射过于固定', '周易理论与统计缺乏因果关联']
      },
      goldenFibonacci: {
        name: '黄金斐波那契', icon: '🌟',
        strengths: ['φ≈0.618比例权重分配替代经验值，数学依据强', '遗漏黄金回归：0.618×avg和1.618×avg自然回归点', '斐波那契遗漏节奏：遗漏=斐波那契数的自然节奏回归', '斐波那契号码结构：1,2,3,5,8,13,21,34统计显著性'],
        weaknesses: ['黄金分割是数学比例而非因果规律', '斐波那契数统计显著性有限(8/35≈22.9%)', '未融合区间趋势等经验维度', '理论优美但实际命中率需回测验证']
      }
    };
    return descriptions[mode] || descriptions.bayesian;
  }
}
