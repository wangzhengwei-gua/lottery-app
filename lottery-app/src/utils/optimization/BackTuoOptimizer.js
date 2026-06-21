/**
 * 后区拖码智能推荐优化器
 * 融合：条件概率 + 遗漏回归 + 时间衰减 + 频率 + 与胆码协同性 + 和值回归
 * 使用加权随机采样，每次推荐结果不同但合理
 */

import { CONFIG } from '../core/Config.js';
import { computeZone4Prediction, formatZonePredictionLog, getBackZone4 } from './ZonePrediction.js';
import { goldenRegressionBonus, fibonacciRhythmBonus, FIB_BACK, moderateOmissionRecovery, recentAppearanceBonus } from './GoldenFibonacci.js';

export class BackTuoOptimizer {
  /**
   * 优化后区拖码推荐（多维度智能评分 + 加权随机采样）
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {number[]} danNumbers - 后区胆码数组
   * @param {number} tuoCount - 需要推荐的拖码数量
   * @returns {Object} { selected: number[], probabilityInfo: Object[] }
   */
  static optimize(analyzer, danNumbers, tuoCount = 4, strategy = 'balanced', dimensionMultipliers = null) {
    console.log('🎯 后区拖码智能推荐（多维度评分 + 加权随机采样）');
    console.log('  胆码:', danNumbers, '拖码数量:', tuoCount);

    // 维度权重倍率（P0优化：激活多维度，后区拖码≠纯遗漏排序）
    // 核心改进：后区12选2-4的目标是覆盖不同4小区，激活zone4Trend是覆盖导向的关键
    // 同时激活条件概率(归一化后区分度好)和频率动量(短期趋势信号)
    const defaultMultipliers = {
      hot: { conditionalProb: 0.3, omission: 1, freqMomentum: 0.5, timeDecay: 0, hotZoneTrend: 0, repeatFactor: 0.5, zone4Trend: 1, coolingPenalty: 0, freqTrend: 0, sumRegression: 1 },
      balanced: { conditionalProb: 0.5, omission: 1, freqMomentum: 0.5, timeDecay: 0, freqTrend: 0.5, zone4Trend: 1, sumRegression: 1 },
      conservative: { conditionalProb: 0.5, omission: 1, freqMomentum: 0.5, timeDecay: 0, freqTrend: 0.5, zone4Trend: 1, sumRegression: 0.8 }
    };

    const dm = dimensionMultipliers || defaultMultipliers[strategy];

    // 1. 获取条件概率
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();
    const maxCondProb = Math.max(...Object.values(conditionalProb.back));

    // 2. 获取遗漏数据
    const omissionData = analyzer.omissionCalculator.calculateOmission();
    const avgBackOmission = analyzer.omissionCalculator.getAverageOmission('back');
    const omissionStd = analyzer.omissionCalculator.getOmissionStd('back');
    const maxPositiveDeviation = Math.max(
      ...Object.values(omissionData.back)
        .map(o => (o || 0) - avgBackOmission)
        .filter(d => d > 0)
    );

    // 3. 获取频率数据（全量 + 近期趋势动量）
    const [, backCounter] = analyzer.frequencyAnalyzer.analyzeFrequency();
    const maxFreq = Math.max(...Object.values(backCounter));
    const recentFreq = analyzer.frequencyAnalyzer.analyzeRecentFrequency();

    // 4. 获取时间衰减权重
    const rawTimeWeights = analyzer.calculateTimeDecayWeights();
    const maxBackTimeWeight = Math.max(...Object.values(rawTimeWeights.back));

    // 5. 获取关联性数据（与胆码的共现）
    const correlationData = analyzer.correlationAnalyzer.calculateNumberCorrelation();
    const activeData = analyzer.getActiveData();
    
    // 热号策略专用数据
    const repeatAnalysis = analyzer.trendAnalyzer.analyzeRepeatNumbers();
    const lastDraw = activeData.length > 0 ? activeData[activeData.length - 1] : null;
    
    // 热区趋势：近5期后区两区频率占比
    const veryRecentCount = Math.min(5, activeData.length);
    const veryRecentData = activeData.slice(-veryRecentCount);
    let hotFirstHalfFreq = 0;
    let hotSecondHalfFreq = 0;
    let hotTotalFreq = 0;
    for (const draw of veryRecentData) {
      for (const num of draw.back) {
        if (num <= 6) hotFirstHalfFreq++;
        else hotSecondHalfFreq++;
        hotTotalFreq++;
      }
    }
    const hotFirstHalfRatio = hotTotalFreq > 0 ? hotFirstHalfFreq / hotTotalFreq : 0.5;

    // === 后区4小区动态趋势数据（P5优化：使用共享getBackZone4） ===
    const { backZone4Absence, backZone4RecentHit, backZone4Trend, backZone4Prediction } = computeZone4Prediction(activeData);
    
    const zone4RangeFormatter = (z) => z <= 3 ? `${(z-1)*3+1}-${z*3}` : '10-12';
    const backZone4Log = formatZonePredictionLog(backZone4Prediction, backZone4Absence, backZone4Trend, 4, zone4RangeFormatter, '后区4小区');
    console.log('  📊 后区拖码4小区动态趋势:', backZone4Log);

    // === 和值趋势数据（和值回归维度） ===
    // 后区和值理想均值≈13，单号理想贡献≈6.5
    // 拖码需补偿胆码和值偏差：胆码偏高→偏低拖码加分
    const sumTrendData = analyzer.trendAnalyzer.analyzeSumTrend();
    const avgBackSum = sumTrendData.avgBackSum;
    const idealBackPerNum = avgBackSum / CONFIG.BACK_COUNT;
    const recent5BackSums = sumTrendData.recentBackSums.slice(-5);
    const recent5BackAvg = recent5BackSums.length > 0 ? recent5BackSums.reduce((a,b) => a+b, 0) / recent5BackSums.length : avgBackSum;
    const backSumBias = recent5BackAvg - avgBackSum;
    const backDanSum = danNumbers.reduce((a, b) => a + b, 0);
    const idealBackDanContribution = avgBackSum * danNumbers.length / CONFIG.BACK_COUNT;
    const backDanSumBias = backDanSum - idealBackDanContribution;
    console.log('  📊 和值趋势: 近5期均值' + recent5BackAvg.toFixed(1) + '(偏差' + backSumBias.toFixed(1) + '), 胆码和值' + backDanSum + '(偏差' + backDanSumBias.toFixed(1) + '), 理想单号贡献≈' + idealBackPerNum.toFixed(1));

    // 排除胆码后的候选拖码
    const candidateNumbers = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
      .filter(n => !danNumbers.includes(n));

    // 预计算关联性最大值
    const TIME_DECAY = 0.98;
    const rawCorrScores = candidateNumbers.map(tuoNum => {
      let corr = 0;
      const recentDraws = activeData.slice(-15);
      for (const dan of danNumbers) {
        const coOccurrence = correlationData.back[dan] && correlationData.back[dan][tuoNum] || 0;
        corr += coOccurrence;
        for (const draw of recentDraws) {
          if (draw.back.includes(dan) && draw.back.includes(tuoNum)) {
            const recencyIdx = recentDraws.indexOf(draw);
            corr += Math.pow(TIME_DECAY, recentDraws.length - recencyIdx);
          }
        }
      }
      return { number: tuoNum, corr };
    });
    const maxCorr = Math.max(...rawCorrScores.map(s => s.corr));

    // 6. 计算每个号码的综合得分（改进4~5：共享趋势工具+自适应扰动）
    // 热号策略8维度：条件概率20 + 遗漏20 + 频率20 + 时间衰减10 + 热区趋势5 + 4小区趋势5 + 重号因子10 + 冷却惩罚-5 = 80~85
    // 均衡/保守策略6维度：条件概率25 + 遗漏25 + 频率20 + 时间衰减15 + 频率趋势15 + 4小区趋势5 = 总分100
    const scored = [];

    // 频率趋势数据（与BackDanOptimizer一致的设计决策：取消区间均衡，改为基于历史频率的趋势加分）
    const recentBackWindowCount = Math.min(20, activeData.length);
    const recentBackWindowData = activeData.slice(-recentBackWindowCount);
    const recentBackWindowFreq = {};
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) recentBackWindowFreq[i] = 0;
    for (const draw of recentBackWindowData) {
      for (const num of draw.back) recentBackWindowFreq[num]++;
    }
    const expectedRate = CONFIG.BACK_COUNT / CONFIG.BACK_RANGE; // 2/12 ≈ 0.167
    const freqRates = {}; // 每个号码的近期频率比率
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
      freqRates[i] = recentBackWindowCount > 0 ? recentBackWindowFreq[i] / recentBackWindowCount : 0;
    }
    const maxFreqRate = Math.max(...Object.values(freqRates));

    for (const num of candidateNumbers) {
      let score = 0;
      const isFirstHalf = num <= 6;

      // 维度1: 条件概率得分（热号20分，均衡/保守25分）- 归一化
      const condProb = conditionalProb.back[num] || 0;
      const normalizedCondProb = maxCondProb > 0 ? condProb / maxCondProb : 0;
      score += normalizedCondProb * (strategy === 'hot' ? 20 : 25) * dm.conditionalProb;

      // 维度2: 遗漏/趋势评分（热号20分，均衡/保守25分）+ 黄金回归/斐波那契节奏
      const currentOmission = omissionData.back[num] || 0;
      const omissionDeviation = currentOmission - avgBackOmission;
      if (strategy === 'hot') {
        // 热号策略：奖励低遗漏（近期频繁出现的热号）
        if (omissionDeviation < 0) {
          const maxNegDeviation = Math.max(
            ...Object.values(omissionData.back)
              .map(o => (o || 0) - avgBackOmission)
              .filter(d => d < 0)
              .map(d => Math.abs(d))
          );
          const normalizedHotness = maxNegDeviation > 0
            ? Math.abs(omissionDeviation) / maxNegDeviation : 0;
          score += normalizedHotness * 20 * dm.omission;
        }
      } else {
        // 均衡/保守策略：遗漏回归逻辑 + 黄金回归 + 斐波那契节奏增强
        if (omissionDeviation > 0) {
          const normalizedDeviation = maxPositiveDeviation > 0
            ? omissionDeviation / maxPositiveDeviation : 0;
          score += normalizedDeviation * 20 * dm.omission;
          if (omissionDeviation > omissionStd * 2) {
            score += 5 * dm.omission;
          }
        }
        // 黄金回归子信号：遗漏≈0.618×avg或≈1.618×avg时回归概率显著提升
        score += goldenRegressionBonus(currentOmission, avgBackOmission, omissionStd) * dm.omission;
        // 斐波那契节奏子信号：后区遗漏=斐波那契数{1,2,3,5,8}时处于自然节奏回归点
        score += fibonacciRhythmBonus(currentOmission) * dm.omission;
        // 回测O4新增：中间地带回升+低遗漏近期加分
        score += moderateOmissionRecovery(currentOmission, avgBackOmission) * dm.omission;
        score += recentAppearanceBonus(currentOmission, avgBackOmission) * dm.omission;
      }

      // 维度3: 频率得分（20分满分）- 归一化 + 近期趋势动量加成
      const freq = backCounter[String(num)] || backCounter[num] || 0;
      const freqBase = maxFreq > 0 ? (freq / maxFreq) * 15 : 0;
      const momentum = recentFreq.backMomentum[num] || 0;
      const maxMomentum = Math.max(...Object.values(recentFreq.backMomentum).map(m => Math.abs(m)));
      const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
      score += freqBase + Math.max(0, normalizedMomentum) * 5 * dm.freqMomentum;

      // 维度4: 时间衰减得分（热号10分，均衡/保守15分）- 归一化
      const rawTimeWeight = rawTimeWeights.back[num] || 0;
      const normalizedTimeWeight = maxBackTimeWeight > 0
        ? rawTimeWeight / maxBackTimeWeight : 0;
      score += normalizedTimeWeight * (strategy === 'hot' ? 10 : 15) * dm.timeDecay;

      // 维度5: 区间/热区评分（优化4：热号热区趋势降至5分+4小区趋势5分=10分；均衡/保守频率趋势降至15分+4小区趋势5分=20分）
      if (strategy === 'hot') {
        // 热区趋势加分（5分满分，从10分降至5分释放5分给4小区趋势）
        const halfRecentRatio = hotTotalFreq > 0
          ? (isFirstHalf ? hotFirstHalfFreq / hotTotalFreq : hotSecondHalfFreq / hotTotalFreq) : 0.5;
        const hotZoneBonus = halfRecentRatio > 0.45
          ? Math.min((halfRecentRatio - 0.45) * 10, 5) : 0;
        score += hotZoneBonus * dm.hotZoneTrend;
        
        // 重号因子加分（10分满分）：上期出现的号码本期更可能再出
        if (lastDraw && lastDraw.back.includes(num)) {
          score += Math.min(repeatAnalysis.backRepeatRate * 10, 10) * dm.repeatFactor;
        }
      } else {
        // 均衡/保守策略：频率趋势加分（15分满分，从20分降至15分释放5分给4小区趋势）
        const freqRate = freqRates[num] || 0;
        const freqTrendMax = 15;
        if (freqRate > expectedRate && maxFreqRate > expectedRate) {
          const normalizedTrend = (freqRate - expectedRate) / (maxFreqRate - expectedRate);
          score += normalizedTrend * freqTrendMax * dm.freqTrend;
        }
      }
      
      // 维度5b: 4小区动态趋势加分（优化4：5分满分，与BackDanOptimizer维度对称）
      const backZone4Num = getBackZone4(num);
      const backZone4Pred = backZone4Prediction[backZone4Num];
      if (strategy === 'hot') {
        if (backZone4Pred === 'must') score += 5 * dm.zone4Trend;
        else if (backZone4Pred === 'very_likely') score += 3 * dm.zone4Trend;
        else if (backZone4Pred === 'likely_warm') score += 1 * dm.zone4Trend;
        else if (backZone4Pred === 'unlikely_cool') score -= 3 * dm.zone4Trend;
      } else {
        if (backZone4Pred === 'must') score += 5 * dm.zone4Trend;
        else if (backZone4Pred === 'very_likely') score += 3 * dm.zone4Trend;
        else if (backZone4Pred === 'likely_warm') score += 1 * dm.zone4Trend;
        else if (backZone4Pred === 'unlikely_cool') score -= 2 * dm.zone4Trend;
      }
      
      // 热号策略：冷却惩罚（最多扣5分）
      // 高频号且当前遗漏 > 平均遗漏 → 正在冷却 → 扣分
      if (strategy === 'hot') {
        const totalBackFreq = Object.values(backCounter).reduce((a, b) => a + b, 0);
        const avgFreqPerNum = totalBackFreq / CONFIG.BACK_RANGE;
        const numFreq = backCounter[String(num)] || backCounter[num] || 0;
        if (numFreq > avgFreqPerNum && currentOmission > avgBackOmission) {
          const coolingDegree = (currentOmission - avgBackOmission) / avgBackOmission;
          const freqHeat = numFreq / avgFreqPerNum;
          const penalty = Math.min(coolingDegree * freqHeat * 2, 5);
          score -= penalty * dm.coolingPenalty;
        }
      }

      // 斐波那契号码结构加分：后区斐波那契数{1,2,3,5,8}有统计规律
      if (FIB_BACK.includes(num)) score += 0.5;

      // 维度7: 和值趋势回归（近期后区和值偏离→号码值反向加分）
      // 拖码需补偿胆码和值偏差：胆码偏高→偏低拖码加分，胆码偏低→偏高拖码加分
      const backSumNeedDirection = backSumBias + backDanSumBias * 0.3;
      const backTuoSumMax = strategy === 'hot' ? 5 : strategy === 'balanced' ? 6 : 5;
      let backTuoSumRegScore = 0;
      if (Math.abs(backSumNeedDirection) > 3) {
        const normalizedDirection = Math.min(Math.abs(backSumNeedDirection) / 8, 1);
        if (backSumNeedDirection > 0 && num < idealBackPerNum) {
          const deviation = (idealBackPerNum - num) / idealBackPerNum;
          backTuoSumRegScore = normalizedDirection * Math.min(deviation * 0.5, 0.8) * backTuoSumMax;
        } else if (backSumNeedDirection < 0 && num > idealBackPerNum) {
          const deviation = (num - idealBackPerNum) / idealBackPerNum;
          backTuoSumRegScore = normalizedDirection * Math.min(deviation * 0.5, 0.8) * backTuoSumMax;
        }
      }
      score += backTuoSumRegScore * dm.sumRegression;

      scored.push({
        number: num,
        score,
        condProb,
        omission: currentOmission,
        freq,
        timeWeight: normalizedTimeWeight
      });
    }

    // 加权随机采样：高分号码概率更高，但每次结果不同
    // 优化5：评分随机扰动+平方根压缩（与FrontDanOptimizer/DanTuoOptimizer同步）
    // 改进5：扰动幅度按分数范围自适应（扰动=range*5%），后区评分范围较小无需固定±1分
    const backTuoRange = Math.max(...scored.map(s => s.score)) - Math.min(...scored.map(s => s.score));
    const backTuoPerturbation = backTuoRange * 0.05;
    for (const s of scored) {
      s.score += (Math.random() - 0.5) * backTuoPerturbation * 2;
    }
    
    const minScore = Math.min(...scored.map(s => s.score));
    const scoreRange = Math.max(...scored.map(s => s.score)) - minScore;

    const weights = scored.map(s => {
      const normalized = scoreRange > 0 ? (s.score - minScore) / scoreRange : 0.5;
      const compressed = Math.sqrt(normalized); // 平方根压缩：高分仍优先但差距缩小
      return {
        ...s,
        sampleWeight: 0.15 + compressed * 0.85  // 最低15%概率，最高100%概率
      };
    });

    // 加权随机采样选出 tuoCount 个号码
    const selected = [];
    const remaining = [...weights];

    // 区间覆盖选择：热号策略确保两区至少各1个（防止极端分布）；均衡/保守策略确保两区覆盖
    if (tuoCount >= 2) {
      const zone1Candidates = remaining.filter(w => w.number <= 6);
      const zone2Candidates = remaining.filter(w => w.number > 6);

      const pickOneFromZone = (zoneCandidates, remList) => {
        if (zoneCandidates.length === 0) return null;
        const totalW = zoneCandidates.reduce((sum, w) => sum + w.sampleWeight, 0);
        let random = Math.random() * totalW;
        for (const w of zoneCandidates) {
          random -= w.sampleWeight;
          if (random <= 0) {
            remList.splice(remList.findIndex(r => r.number === w.number), 1);
            return w.number;
          }
        }
        const chosen = zoneCandidates[0];
        remList.splice(remList.findIndex(r => r.number === chosen.number), 1);
        return chosen.number;
      };

      const z1 = pickOneFromZone(zone1Candidates, remaining);
      const z2 = pickOneFromZone(zone2Candidates, remaining);
      if (z1) selected.push(z1);
      if (z2) selected.push(z2);
    }
    // 热号策略：如果只选了1个拖码，确保两区覆盖（优先选热区号码）
    if (strategy === 'hot' && tuoCount === 1 && selected.length === 0) {
      // 热区优先：选择近期频率更高的半区中的最优号码
      const hotZone1Weight = remaining.filter(w => w.number <= 6)
        .reduce((sum, w) => sum + w.sampleWeight, 0);
      const hotZone2Weight = remaining.filter(w => w.number > 6)
        .reduce((sum, w) => sum + w.sampleWeight, 0);
      const hotZonePool = hotZone1Weight >= hotZone2Weight
        ? remaining.filter(w => w.number <= 6)
        : remaining.filter(w => w.number > 6);
      if (hotZonePool.length > 0) {
        const totalW = hotZonePool.reduce((sum, w) => sum + w.sampleWeight, 0);
        let random = Math.random() * totalW;
        for (const w of hotZonePool) {
          random -= w.sampleWeight;
          if (random <= 0) {
            remaining.splice(remaining.findIndex(r => r.number === w.number), 1);
            selected.push(w.number);
            break;
          }
        }
      }
    }

    // 补充剩余拖码
    while (selected.length < tuoCount && remaining.length > 0) {
      const totalW = remaining.reduce((sum, w) => sum + w.sampleWeight, 0);
      let random = Math.random() * totalW;
      let chosenIdx = 0;
      for (let j = 0; j < remaining.length; j++) {
        random -= remaining[j].sampleWeight;
        if (random <= 0) { chosenIdx = j; break; }
      }
      selected.push(remaining[chosenIdx].number);
      remaining.splice(chosenIdx, 1);
    }

    // 计算概率排名信息（优化5：使用平方根压缩与采样权重一致）
    const allWeights = scored.map(s => {
      const allMinScore = Math.min(...scored.map(s2 => s2.score));
      const allScoreRange = Math.max(...scored.map(s2 => s2.score)) - allMinScore;
      const normalized = allScoreRange > 0 ? (s.score - allMinScore) / allScoreRange : 0.5;
      const compressed = Math.sqrt(normalized);
      return { number: s.number, weight: 0.15 + compressed * 0.85 };
    });

    const totalWeightSum = allWeights.reduce((sum, w) => sum + w.weight, 0);
    const topCandidates = [...allWeights].sort((a, b) => b.weight - a.weight).slice(0, 5);
    const probabilityInfo = topCandidates.map(w => {
      const actualProb = totalWeightSum > 0 ? (w.weight / totalWeightSum * 100) : 0;
      const originalScore = scored.find(s => s.number === w.number);
      return {
        number: w.number,
        probability: actualProb,
        score: originalScore ? originalScore.score : 0,
        condProb: originalScore ? originalScore.condProb : 0,
        omission: originalScore ? originalScore.omission : 0,
        freq: originalScore ? originalScore.freq : 0
      };
    });

    console.log('✅ 后区拖码推荐完成:', selected.sort((a, b) => a - b));
    console.log('  实际选择:', selected.map(n => `#${n}`).join(', '), '(加权随机采样)');
    console.log('  Top5概率排名:', probabilityInfo.map(p =>
      `#${p.number}(概率${p.probability.toFixed(1)}%, 条件概率${p.condProb.toFixed(3)}, 遗漏${p.omission}, 频率${p.freq}, 总分${p.score.toFixed(2)})`
    ).join(', '));

    return {
      selected: selected.sort((a, b) => a - b),
      probabilityInfo: probabilityInfo
    };
  }
}