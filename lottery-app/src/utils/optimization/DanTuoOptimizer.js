/**
 * 胆拖优化器（P1+P2+P3重构版）
 * P1: 维度从15→5精简（删除噪音/重叠维度）
 * P2: 删除降级方法optimizeTuoSelection死代码
 * P3: 拖码定位改为覆盖最大化而非个体评分最大化
 */

import { CONFIG } from '../core/Config.js';
import { computeZone5Prediction, getZone5, getZone7 } from './ZonePrediction.js';
import { goldenRegressionBonus, fibonacciRhythmBonus, FIB_FRONT, moderateOmissionRecovery, recentAppearanceBonus } from './GoldenFibonacci.js';

export class DanTuoOptimizer {
  constructor(options) {
    if (options && typeof options === 'object' && !Array.isArray(options)) {
      this.frequencyAnalyzer = options.frequencyAnalyzer;
      this.omissionCalculator = options.omissionCalculator;
      this.trendAnalyzer = options.trendAnalyzer;
      this.correlationAnalyzer = options.correlationAnalyzer;
      this.conditionalProbability = options.conditionalProbability;
      this.getActiveData = options.getActiveData;
      this.frontNumbers = options.frontNumbers;
      this.backNumbers = options.backNumbers;
      this.historyData = null;
    } else {
      // 旧版兼容（位置参数）
      this.historyData = arguments[0];
      this.getActiveData = arguments[1];
      this.frequencyAnalyzer = arguments[2];
      this.correlationAnalyzer = arguments[3];
      this.omissionCalculator = arguments[4];
      this.conditionalProbability = arguments[5];
      this.trendAnalyzer = arguments[6];
    }
  }

  /**
   * 融合区间频率的拖码选择优化（P1+P3+黄金/斐波那契增强版）
   * P1: 5维度评分（热号: heatSignal+zone5Trend+correlation+repeatFactor+momentum）
   *      均衡/保守: freqMomentum+conditionalProb+omissionDeviation(+黄金回归+斐波那契节奏)+zone5Trend+correlation）
   * P3: 拖码定位改为覆盖最大化 - 优先选未覆盖区的号码而非纯评分排序
   * @param {number[]} danNumbers - 胆码数组
   * @param {number[]} candidateNumbers - 候选拖码数组
   * @param {number} targetCount - 目标拖码数量
   * @param {string} strategy - 策略：hot/balanced/conservative
   * @returns {number[]} 优化后的拖码数组
   */
  optimizeTuoSelectionWithZoneFrequency(danNumbers, candidateNumbers, targetCount = 10, strategy = 'balanced') {
    console.log('  拖码选择优化（P1 5维度 + P3 覆盖最大化 + 黄金/斐波那契增强）');

    if (!danNumbers || !Array.isArray(danNumbers) || danNumbers.length === 0) {
      console.warn('⚠️ 胆码为空，降级到普通选择');
      return candidateNumbers.slice(0, targetCount).sort((a, b) => a - b);
    }
    if (!candidateNumbers || candidateNumbers.length === 0) return [];

    // P1维度精简：5维度配置
    const defaultMultipliers = {
      hot: { heatSignal: 1, zone5Trend: 1, correlation: 1.5, repeatFactor: 1, momentum: 1 },
      balanced: { freqMomentum: 1, conditionalProb: 1, omissionDeviation: 1, zone5Trend: 1, correlation: 1.5 },
      conservative: { freqMomentum: 0.8, conditionalProb: 0.8, omissionDeviation: 1, zone5Trend: 1, correlation: 1.5 }
    };
    const dm = defaultMultipliers[strategy];

    // 获取分析数据
    const conditionalProb = this.conditionalProbability.calculateConditionalProbability();
    const omission = this.omissionCalculator.calculateOmission();
    const avgFrontOmission = this.omissionCalculator.getAverageOmission('front');
    const omissionStd = this.omissionCalculator.getOmissionStd('front');
    const [frontCounter] = this.frequencyAnalyzer.analyzeFrequency();
    const maxFreq = Math.max(...Object.values(frontCounter));
    const maxCondProb = Math.max(...Object.values(conditionalProb.front));
    const recentFreq = this.frequencyAnalyzer.analyzeRecentFrequency();
    const maxMomentum = Math.max(...Object.values(recentFreq.frontMomentum).map(m => Math.abs(m)));

    // 热号策略专用数据
    const activeData = this.getActiveData();
    const lastDraw = activeData.length > 0 ? activeData[activeData.length - 1] : null;
    const repeatAnalysis = this.trendAnalyzer.analyzeRepeatNumbers();

    // 重号因子自适应
    const recent10ForRepeat = Math.min(10, activeData.length - 1);
    let recent10RepeatSum = 0;
    for (let i = activeData.length - recent10ForRepeat; i < activeData.length; i++) {
      if (i > 0) {
        const prevDraw = activeData[i - 1];
        const currDraw = activeData[i];
        recent10RepeatSum += currDraw.front.filter(n => prevDraw.front.includes(n)).length;
      }
    }
    const recent10RepeatRate = recent10ForRepeat > 0 ? recent10RepeatSum / recent10ForRepeat : 0;
    let repeatWeightFactor = recent10RepeatRate < 1.0 ? 0.5 : recent10RepeatRate > 2.0 ? 1.5 : 1.0;
    if (activeData.length >= 2) {
      const lastRepeatCount = activeData[activeData.length - 1].front.filter(
        n => activeData[activeData.length - 2].front.includes(n)
      ).length;
      if (lastRepeatCount >= 2) repeatWeightFactor *= 0.7;
      if (lastRepeatCount === 0) repeatWeightFactor *= 1.2;
    }

    // 动量加速度数据
    const veryRecentCount = Math.min(Math.max(10, Math.floor(activeData.length * 0.33)), activeData.length);
    const veryRecentData = activeData.slice(-veryRecentCount);
    const veryRecentFrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) veryRecentFrontFreq[i] = 0;
    for (const draw of veryRecentData) {
      for (const num of draw.front) veryRecentFrontFreq[num]++;
    }
    const maxAcceleration = Math.max(
      ...Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1).map(n => {
        const vr = (veryRecentFrontFreq[n] || 0) / veryRecentCount;
        const mr = (recentFreq.front[n] || 0) / (recentFreq.recentCount || 15);
        return vr - mr;
      }).filter(a => a > 0)
    );

    // 关联性数据（拖码核心维度：与胆码的共现关联）
    const correlationData = this.correlationAnalyzer.calculateNumberCorrelationWithTimeDecay();
    const rawCorrelationScores = candidateNumbers.map(tuoNum => {
      let corr = 0;
      const TIME_DECAY = 0.98;
      const recentDraws = activeData.slice(-Math.min(15, Math.floor(activeData.length * 0.4)));
      for (const dan of danNumbers) {
        for (const draw of recentDraws) {
          if (draw.front.includes(dan) && draw.front.includes(tuoNum)) {
            const recencyIdx = recentDraws.indexOf(draw);
            corr += Math.pow(TIME_DECAY, recentDraws.length - recencyIdx);
          }
        }
      }
      return { number: tuoNum, corr };
    });
    const maxCorr = Math.max(...rawCorrelationScores.map(s => s.corr), 0);

    // 5小区动态趋势数据
    const { zone5Prediction, zone5Absence, zone5Trend } = computeZone5Prediction(activeData, getZone5);

    // 胆码区间分布（P3: 覆盖最大化需要知道胆码覆盖了哪些区）
    const danZoneCount = {};
    danNumbers.forEach(num => {
      const zone = getZone7(num);
      danZoneCount[zone] = (danZoneCount[zone] || 0) + 1;
    });

    // 评分每个候选拖码
    const tuoScores = candidateNumbers.map(tuoNum => {
      const zone = getZone7(tuoNum);
      let score = 0;
      const freq = frontCounter[String(tuoNum)] || frontCounter[tuoNum] || 0;
      const currentOmission = omission.front[tuoNum] || 0;

      // === 热号策略5维度 ===
      if (strategy === 'hot') {
        // 维度1: 热度信号（遗漏+频率，与FrontDanOptimizer同步）
        const rawOmissionScore = Math.max(0, 15 - (currentOmission / avgFrontOmission) * 15);
        const omissionBaseScore = Math.min(rawOmissionScore, 12);
        const freqBoost = maxFreq > 0 ? (freq / maxFreq) * 5 : 0;
        score += (omissionBaseScore + freqBoost) * dm.heatSignal;

        // 维度2: 5小区动态趋势
        const zone5Num = getZone5(tuoNum);
        const prediction = zone5Prediction[zone5Num];
        if (prediction === 'must') score += 12 * dm.zone5Trend;
        else if (prediction === 'very_likely') score += 9 * dm.zone5Trend;
        else if (prediction === 'likely_warm') score += 5 * dm.zone5Trend;
        else if (prediction === 'warming') score += 3 * dm.zone5Trend;
        else if (prediction === 'unlikely_cool') score -= 3 * dm.zone5Trend;

        // 维度3: 关联性加成（与胆码共现频率，拖码核心维度）
        const rawCorr = rawCorrelationScores.find(s => s.number === tuoNum)?.corr || 0;
        const normalizedCorr = maxCorr > 0 ? rawCorr / maxCorr : 0;
        score += normalizedCorr * 10 * dm.correlation;

        // 维度4: 重号因子（自适应8-15分）
        const repeatMaxScore = Math.min(15 * repeatWeightFactor, 15);
        if (lastDraw && lastDraw.front.includes(tuoNum)) {
          score += Math.min(repeatAnalysis.frontRepeatRate * 15 * repeatWeightFactor, repeatMaxScore) * dm.repeatFactor;
        }

        // 维度5: 动量加速度
        const veryRecentRate = (veryRecentFrontFreq[tuoNum] || 0) / veryRecentCount;
        const mediumRecentRate = (recentFreq.front[tuoNum] || 0) / (recentFreq.recentCount || 15);
        const acceleration = veryRecentRate - mediumRecentRate;
        if (acceleration > 0 && maxAcceleration > 0) {
          score += (acceleration / maxAcceleration) * 5 * dm.momentum;
        }
      } else {
        // === 均衡/保守策略5维度 ===
        // 维度1: 频率+动量
        const freqBase = maxFreq > 0 ? (freq / maxFreq) * (strategy === 'balanced' ? 10 : 6) : 0;
        const momentum = recentFreq.frontMomentum[tuoNum] || 0;
        const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
        score += (freqBase + Math.max(0, normalizedMomentum) * (strategy === 'balanced' ? 5 : 2)) * dm.freqMomentum;

        // 维度2: 条件概率
        const condProb = conditionalProb.front[tuoNum] || 0;
        const normalizedCondProb = maxCondProb > 0 ? condProb / maxCondProb : 0;
        score += normalizedCondProb * (strategy === 'balanced' ? 25 : 20) * dm.conditionalProb;

        // 维度3: 遗漏偏离度（σ分段归一化 + 黄金回归 + 斐波那契节奏）
        const omissionDeviation = currentOmission - avgFrontOmission;
        const absDeviation = Math.abs(omissionDeviation);
        const sigma2 = omissionStd * 2;
        const devBaseMax = strategy === 'balanced' ? 5 : 7;
        let baseScore = 0;
        if (absDeviation >= sigma2 && sigma2 > 0) baseScore = devBaseMax;
        else if (sigma2 > 0) baseScore = (absDeviation / sigma2) * devBaseMax;
        
        const highOmissionMax = strategy === 'balanced' ? 7 : 10;
        let strategyBonus = 0;
        if (omissionDeviation > 0) {
          if (omissionDeviation >= sigma2 && sigma2 > 0) strategyBonus = highOmissionMax;
          else if (sigma2 > 0) strategyBonus = (omissionDeviation / sigma2) * highOmissionMax;
          if (omissionDeviation > sigma2) strategyBonus += 3;
        }
        // 黄金回归子信号：遗漏≈0.618×avg或≈1.618×avg时自然回归概率高
        const goldenBonus = goldenRegressionBonus(currentOmission, avgFrontOmission, omissionStd);
        // 斐波那契节奏子信号：遗漏=斐波那契数时处于自然节奏回归点
        const fibRhythm = fibonacciRhythmBonus(currentOmission);
        // 回测O2新增：中间地带回升+低遗漏近期加分
        const moderateBonus = moderateOmissionRecovery(currentOmission, avgFrontOmission);
        const recentBonus = recentAppearanceBonus(currentOmission, avgFrontOmission);
        score += (baseScore + strategyBonus + goldenBonus + fibRhythm + moderateBonus + recentBonus) * dm.omissionDeviation;

        // 维度4: 5小区动态趋势
        const zone5Num = getZone5(tuoNum);
        const prediction = zone5Prediction[zone5Num];
        const zone5Max = strategy === 'balanced' ? 8 : 5;
        if (prediction === 'must') score += zone5Max * dm.zone5Trend;
        else if (prediction === 'very_likely') score += Math.round(zone5Max * 0.6) * dm.zone5Trend;
        else if (prediction === 'likely_warm') score += Math.round(zone5Max * 0.3) * dm.zone5Trend;
        else if (prediction === 'unlikely_cool') score -= Math.round(zone5Max * 0.2) * dm.zone5Trend;

        // 维度5: 关联性加成
        const rawCorr = rawCorrelationScores.find(s => s.number === tuoNum)?.corr || 0;
        const normalizedCorr = maxCorr > 0 ? rawCorr / maxCorr : 0;
        score += normalizedCorr * 10 * dm.correlation;
      }

      // 热号策略：斐波那契号码结构加分
      if (strategy === 'hot' && FIB_FRONT.includes(tuoNum)) {
        score += 1;
      }
      
      return { number: tuoNum, score, zone, freq, omission: currentOmission };
    });

    // P3: 覆盖最大化选择策略
    // 先按评分排序，但优先选择覆盖胆码未覆盖区间的号码
    tuoScores.sort((a, b) => b.score - a.score);

    // 计算胆码已覆盖的区间
    const danCoveredZones = new Set(danNumbers.map(n => getZone7(n)));
    console.log('  胆码覆盖区间:', [...danCoveredZones].sort(), '(共' + danCoveredZones.size + '个)');

    // 覆盖优先选择：未覆盖区的号码加权提升
    // 然后按加权随机采样（保留一定随机性，均衡/保守策略）
    const minScore = Math.min(...tuoScores.map(s => s.score));
    const maxScore = Math.max(...tuoScores.map(s => s.score));
    const scoreRange = maxScore - minScore;
    
    const weightedCandidates = tuoScores.map(s => {
      const normalized = scoreRange > 0 ? (s.score - minScore) / scoreRange : 0.5;
      const compressed = Math.sqrt(normalized);
      let coverageBonus = 1.0;
      // P3核心：未覆盖区的号码权重大幅提升
      if (!danCoveredZones.has(s.zone)) {
        coverageBonus = 1.5; // 未覆盖区50%权重加成
      }
      return { ...s, sampleWeight: (0.15 + compressed * 0.85) * coverageBonus };
    });

    const selectedTuo = [];
    const selectedNumbers = new Set(danNumbers);
    const selectedZoneCount = {};
    for (let z = 1; z <= 7; z++) selectedZoneCount[z] = 0;
    // 初始化：胆码已覆盖的区间
    danNumbers.forEach(n => selectedZoneCount[getZone7(n)]++);
    let consecutivePairs = 0;
    const remaining = [...weightedCandidates];

    // 动态权重调整：根据当前组合的区间覆盖状况调整
    const adjustDynamicWeight = (candidate) => {
      let bonus = 1.0;
      const allSelected = [...danNumbers, ...selectedTuo];
      const coveredZones = new Set(allSelected.map(n => getZone7(n)));
      
      // 未覆盖区号码权重提升（P3核心逻辑）
      if (!coveredZones.has(candidate.zone)) {
        bonus += 0.6;
      }
      
      // 同区已有2+号码时降权（防止过度集中）
      if (selectedZoneCount[candidate.zone] >= 2) {
        bonus *= 0.7;
      }
      
      // 均衡/保守：奇偶防极端
      if (strategy !== 'hot') {
        const currentOdd = allSelected.filter(n => n % 2 !== 0).length;
        const currentEven = allSelected.length - currentOdd;
        if (currentOdd === 0 && candidate.number % 2 !== 0) bonus += 0.5;
        if (currentEven === 0 && candidate.number % 2 === 0) bonus += 0.5;
      }
      
      return candidate.sampleWeight * bonus;
    };

    while (selectedTuo.length < targetCount && remaining.length > 0) {
      const dynamicWeights = remaining.map(w => ({
        ...w,
        dynamicWeight: adjustDynamicWeight(w)
      }));
      const totalWeight = dynamicWeights.reduce((sum, w) => sum + w.dynamicWeight, 0);

      // 加权随机选择
      let random = Math.random() * totalWeight;
      let chosenIdx = -1;
      for (let j = 0; j < dynamicWeights.length; j++) {
        random -= dynamicWeights[j].dynamicWeight;
        if (random <= 0) { chosenIdx = j; break; }
      }
      if (chosenIdx === -1) chosenIdx = dynamicWeights.length - 1;

      const chosen = remaining[chosenIdx];
      const num = chosen.number;

      // 连号检查
      let isConsecutive = false;
      for (const sel of selectedNumbers) {
        if (Math.abs(num - sel) === 1) { isConsecutive = true; break; }
      }
      if (isConsecutive && consecutivePairs >= 2) {
        remaining.splice(chosenIdx, 1);
        continue;
      }

      if (isConsecutive) consecutivePairs++;
      selectedTuo.push(num);
      selectedNumbers.add(num);
      selectedZoneCount[chosen.zone]++;
      remaining.splice(chosenIdx, 1);
    }

    // 连号限制导致数量不足时放宽
    if (selectedTuo.length < targetCount) {
      const allRemaining = tuoScores.filter(s => !selectedNumbers.has(s.number));
      for (const item of allRemaining) {
        if (selectedTuo.length >= targetCount) break;
        selectedTuo.push(item.number);
        selectedNumbers.add(item.number);
      }
    }

    // 最终区间覆盖统计
    const allNumbers = [...danNumbers, ...selectedTuo];
    const finalZoneCoverage = {};
    for (let z = 1; z <= 7; z++) finalZoneCoverage[z] = 0;
    allNumbers.forEach(n => finalZoneCoverage[getZone7(n)]++);
    const coveredCount = Object.values(finalZoneCoverage).filter(c => c > 0).length;

    console.log('✅ 拖码选择完成:', selectedTuo.sort((a, b) => a - b), '(共' + selectedTuo.length + '个)');
    console.log('  区间覆盖:', coveredCount + '/7个区间, ' + Object.entries(finalZoneCoverage)
      .filter(([z, c]) => c > 0).map(([z, c]) => `区${z}:${c}个`).join(' '));
    console.log('  拖码Top详情:', tuoScores.slice(0, targetCount).map(item =>
      `#${item.number}(区${item.zone}, 频率${item.freq}, 遗漏${item.omission}, 总分${item.score.toFixed(1)})`
    ).join(', '));

    return selectedTuo.sort((a, b) => a - b);
  }

  /**
   * 计算号码对的历史搭档关系加分（保留，UI可能用到）
   */
  calculatePairBonus(danNumbers, candidateNumbers) {
    if (!danNumbers || !Array.isArray(danNumbers) || danNumbers.length === 0) return {};
    if (!candidateNumbers || !Array.isArray(candidateNumbers) || candidateNumbers.length === 0) return {};

    const activeData = this.getActiveData();
    const bonus = {};
    candidateNumbers.forEach(num => { bonus[num] = 0; });

    for (const draw of activeData) {
      for (const dan of danNumbers) {
        if (draw.front.includes(dan)) {
          for (const candidate of candidateNumbers) {
            if (draw.front.includes(candidate)) bonus[candidate]++;
          }
        }
      }
    }
    return bonus;
  }

  /**
   * 强制区间覆盖（胆拖专用版）
   */
  enforceZoneCoverageForDanTuo(selectedNumbers, danNumbers, targetCount) {
    if (!danNumbers || !Array.isArray(danNumbers)) danNumbers = [];
    if (selectedNumbers.length <= targetCount) return selectedNumbers;

    const allNumbers = [...danNumbers, ...selectedNumbers];
    const zoneCounts = {};
    for (let z = 1; z <= 7; z++) zoneCounts[z] = 0;
    allNumbers.forEach(n => zoneCounts[getZone7(n)]++);

    const coveredZones = Object.values(zoneCounts).filter(c => c > 0).length;
    if (coveredZones >= 3) return selectedNumbers.slice(0, targetCount);

    let result = [...selectedNumbers];
    const conditionalProb = this.conditionalProbability.calculateConditionalProbability();
    const [frontCounter] = this.frequencyAnalyzer.analyzeFrequency();

    const selectBestCandidate = (candidates) => {
      if (candidates.length === 0) return null;
      let best = candidates[0];
      let bestScore = 0;
      for (const n of candidates) {
        const freqScore = (frontCounter[String(n)] || frontCounter[n] || 0) / Math.max(...Object.values(frontCounter));
        const condScore = (conditionalProb.front[n] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence;
        const total = freqScore * 0.6 + condScore * 0.4;
        if (total > bestScore) { bestScore = total; best = n; }
      }
      return best;
    };

    const missingZones = Object.entries(zoneCounts).filter(([z, c]) => c === 0).map(([z]) => parseInt(z));
    for (const missingZone of missingZones) {
      const zoneStart = (missingZone - 1) * 5 + 1;
      const zoneEnd = Math.min(missingZone * 5, CONFIG.FRONT_RANGE);
      const zoneCandidates = Array.from({ length: zoneEnd - zoneStart + 1 }, (_, i) => zoneStart + i)
        .filter(n => !allNumbers.includes(n));
      if (zoneCandidates.length > 0) {
        const bestCandidate = selectBestCandidate(zoneCandidates);
        if (bestCandidate) {
          const overrepresentedZones = Object.entries(zoneCounts)
            .filter(([z, c]) => parseInt(z) !== missingZone && c >= 2).map(([z]) => parseInt(z));
          let replaceNum = null;
          if (overrepresentedZones.length > 0) {
            const worst = result.reduce((w, num) => {
              const zone = getZone7(num);
              if (!overrepresentedZones.includes(zone)) return w;
              const score = (frontCounter[String(num)] || frontCounter[num] || 0) / Math.max(...Object.values(frontCounter));
              return score < w.score ? { num, score } : w;
            }, { num: 0, score: Infinity });
            replaceNum = worst.num;
          }
          if (replaceNum && replaceNum > 0) result[result.indexOf(replaceNum)] = bestCandidate;
        }
      }
    }
    return result.slice(0, targetCount);
  }
}
