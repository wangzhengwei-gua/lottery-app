/**
 * 胆拖优化器
 * 负责胆拖玩法的拖码选择优化、间距控制、区间覆盖等
 */

import { CONFIG } from '../core/Config.js';
import { HistoricalSimilarity } from '../analysis/HistoricalSimilarity.js';
import { computeZone5Prediction } from './ZonePrediction.js';

export class DanTuoOptimizer {
  constructor(options) {
    // 支持两种调用方式：对象参数或位置参数
    if (options && typeof options === 'object' && !Array.isArray(options)) {
      // 对象参数模式（新）
      this.frequencyAnalyzer = options.frequencyAnalyzer;
      this.omissionCalculator = options.omissionCalculator;
      this.trendAnalyzer = options.trendAnalyzer;
      this.correlationAnalyzer = options.correlationAnalyzer;
      this.conditionalProbability = options.conditionalProbability;
      this.getActiveData = options.getActiveData;
      this.frontNumbers = options.frontNumbers;
      this.backNumbers = options.backNumbers;
      this.historyData = null; // 通过 getActiveData 动态获取
    } else {
      // 位置参数模式（旧版兼容）
      this.historyData = arguments[0];
      this.getActiveData = arguments[1];
      this.frequencyAnalyzer = arguments[2];
      this.correlationAnalyzer = arguments[3];
    }
  }

  /**
   * 融合区间频率的拖码选择优化
   * @param {number[]} danNumbers - 胆码数组
   * @param {number[]} candidateNumbers - 候选拖码数组
   * @param {number} targetCount - 目标拖码数量
   * @param {string} strategy - 策略：hot/balanced/conservative
   * @returns {number[]} 优化后的拖码数组
   */
  optimizeTuoSelectionWithZoneFrequency(danNumbers, candidateNumbers, targetCount = 10, strategy = 'balanced') {
    console.log(' 方案2：拖码选择优化（融合区间频率）');

    // 防御性检查
    if (!danNumbers || !Array.isArray(danNumbers) || danNumbers.length === 0) {
      console.warn('⚠️ 胆码为空，降级到普通优化');
      return this.optimizeTuoSelection(danNumbers || [], candidateNumbers, targetCount);
    }

    if (!candidateNumbers || candidateNumbers.length === 0) {
      return [];
    }

    // 定义5小区（与FrontDanOptimizer同步，更符合出号规律）
    const getZone5 = (num) => Math.ceil(num / 7); // 区1(1-7),区2(8-14),区3(15-21),区4(22-28),区5(29-35)
    // 定义7区间（仍用于区间分布+饱和度维度）
    const getZone = (num) => {
      if (num <= 5) return 1;
      if (num <= 10) return 2;
      if (num <= 15) return 3;
      if (num <= 20) return 4;
      if (num <= 25) return 5;
      if (num <= 30) return 6;
      return 7;
    };

    // 分析胆码的区间分布
    const danZoneCount = {};
    danNumbers.forEach(num => {
      const zone = getZone(num);
      danZoneCount[zone] = (danZoneCount[zone] || 0) + 1;
    });

    console.log('  胆码区间分布:', danZoneCount);

    // 获取区间频率数据
    const [frontCounter] = this.frequencyAnalyzer.analyzeFrequency();
    const recentFreq = this.frequencyAnalyzer.analyzeRecentFrequency();

    // 计算每个区间的总频率
    const zoneFrequencies = {};
    for (let zone = 1; zone <= 7; zone++) {
      const start = (zone - 1) * 5 + 1;
      const end = zone * 5;
      let totalFreq = 0;
      for (let i = start; i <= end; i++) {
        totalFreq += frontCounter[String(i)] || frontCounter[i] || 0;
      }
      zoneFrequencies[zone] = totalFreq;
    }

    console.log('  区间频率:', zoneFrequencies);

    // 维度权重倍率（去重叠化配置，与FrontDanOptimizer对齐）
    // 核心原则：拖码降重叠维度(条件概率/频率/遗漏)，升拖码专用维度(关联性/协同性/间距)
    // 均衡依赖少数强维度(条件概率主导但降低重叠)，保守需多维确认回归
    // 热号启用timeDecay+zoneAntiExtreme
    // 同步FrontDanOptimizer：omissionDeviation 0.6(均衡)/1.0(保守), timeDecay 0.5(热)/0(均衡)/0.3(保守)
    const defaultMultipliers = {
      hot: { heatSignal: 1, freqRatio: 0.75, conditionalProb: 0.6, repeatFactor: 1, zone5Trend: 1, momentum: 0.6, correlation: 1.5, synergy: 1, historicalSimilarity: 1, gapScore: 1.2, crossZone: 1, crossPeriod: 1, coolingPenalty: 0.6, zoneSaturation: 1, zoneAntiExtreme: 0.5, timeDecay: 0.5 },
      balanced: { freqMomentum: 0.6, conditionalProb: 0.5, omissionDeviation: 0.6, freqRatio: 0.6, zoneDistribution: 1, zone5Trend: 1, correlation: 1.5, synergy: 1, historicalSimilarity: 0.5, gapScore: 1.2, crossZone: 1, crossPeriod: 1, coolingPenalty: 0.5, zoneSaturation: 0, zoneAntiExtreme: 1, timeDecay: 0 },
      conservative: { freqMomentum: 0.5, conditionalProb: 0.4, omissionDeviation: 0.8, freqRatio: 0.3, zoneDistribution: 1, zone5Trend: 1, correlation: 1.5, synergy: 1, historicalSimilarity: 0.5, gapScore: 1.2, crossZone: 1, crossPeriod: 1, coolingPenalty: 0.3, zoneSaturation: 0.3, zoneAntiExtreme: 1, timeDecay: 0.3 }
    };
    const dm = defaultMultipliers[strategy];
    // 获取条件概率和遗漏数据
    const conditionalProb = this.conditionalProbability.calculateConditionalProbability();
    const omission = this.omissionCalculator.calculateOmission();
    const correlationData = this.correlationAnalyzer.calculateNumberCorrelationWithTimeDecay();
    const avgFrontOmission = this.omissionCalculator.getAverageOmission('front');

    // 热号策略专用数据
    const repeatAnalysis = this.trendAnalyzer.analyzeRepeatNumbers();
    const activeData = this.getActiveData();
    const lastDraw = activeData.length > 0 ? activeData[activeData.length - 1] : null;
    
    // 优化7：时间衰减权重（用于冷却惩罚优化）
    // 直接计算时间衰减：近10期线性衰减（第1期=1.0，第10期=0.1）
    const TIME_DECAY_WINDOW = 10;
    const rawTimeWeights = { front: {}, back: {} };
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) rawTimeWeights.front[i] = 0;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) rawTimeWeights.back[i] = 0;
    const recentData = activeData.slice(-TIME_DECAY_WINDOW);
    for (const draw of recentData) {
      for (const num of draw.front) {
        const idx = recentData.indexOf(draw);
        rawTimeWeights.front[num] += 1 - idx / TIME_DECAY_WINDOW; // 近->远：1.0->0.1
      }
      for (const num of draw.back) {
        const idx = recentData.indexOf(draw);
        rawTimeWeights.back[num] += 1 - idx / TIME_DECAY_WINDOW;
      }
    }
    
    // 优化6：内部参数与dataWindow动态关联
    // 热区趋势：近 dataWindow*0.5 期（更稳定的趋势信号，与用户选择的数据窗口一致）
    const zoneWindowCount = Math.min(Math.floor(activeData.length * 0.5), activeData.length);
    const zoneWindowData = activeData.slice(-zoneWindowCount);
    const hotZoneRecentFreq = {};
    for (let zone = 1; zone <= 7; zone++) hotZoneRecentFreq[zone] = 0;
    for (const draw of zoneWindowData) {
      for (const num of draw.front) hotZoneRecentFreq[getZone(num)]++;
    }
    const totalHotZoneFreq = Object.values(hotZoneRecentFreq).reduce((a, b) => a + b, 0) || 1;

    // === 5小区动态趋势数据（改进4：使用共享ZonePrediction工具，统一预测逻辑） ===
    const { zone5Absence, zone5RecentHit, zone5Trend, zone5Prediction } = computeZone5Prediction(activeData, getZone5);

    // 区间饱和度仍用近 dataWindow*0.33 期短窗口（捕捉短期过热/冷区信号）
    const veryRecentCount = Math.min(Math.max(10, Math.floor(activeData.length * 0.33)), activeData.length); // 优化6：近1/3窗口
    const veryRecentData = activeData.slice(-veryRecentCount);
    const zoneRecentFreq10 = {}; // 近1/3窗口区频率（用于区间饱和度调节）
    for (let zone = 1; zone <= 7; zone++) zoneRecentFreq10[zone] = 0;
    for (const draw of veryRecentData) {
      for (const num of draw.front) zoneRecentFreq10[getZone(num)]++;
    }
    
    // 动量加速度：近10期频率（与FrontDanOptimizer同步升级，原5期噪音大）
    const veryRecentFrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) veryRecentFrontFreq[i] = 0;
    for (const draw of veryRecentData) {
      for (const num of draw.front) veryRecentFrontFreq[num]++;
    }

    // 近期频率逆袭数据（优化1+6）：对比近 dataWindow*0.67 期频率与全量频率
    // 与FrontDanOptimizer同步升级到2/3窗口：更大窗口捕捉中期趋势而非短期噪音
    // 近2/3窗口频率远高于全量频率的号码 → 冷→热逆袭信号 → 加分
    const recent30Count = Math.min(Math.max(10, Math.floor(activeData.length * 0.67)), activeData.length); // 优化6：近2/3窗口
    const recent30Data = activeData.slice(-recent30Count);
    const recent30FrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) recent30FrontFreq[i] = 0;
    for (const draw of recent30Data) {
      for (const num of draw.front) recent30FrontFreq[num]++;
    }
    const totalDraws = activeData.length;
    const frontFreqRatio = {}; // 近期频率 / 全量频率 的比值
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      const recentRate = recent30FrontFreq[i] / recent30Count;
      const overallRate = (frontCounter[String(i)] || frontCounter[i] || 0) / totalDraws;
      frontFreqRatio[i] = overallRate > 0 ? recentRate / overallRate : 0;
    }
    // 归一化：只取 ratio > 1 的号码，计算最大ratio用于归一化
    const maxFreqRatioValue = Math.max(...Object.values(frontFreqRatio).filter(r => r > 1), 1);

    // 重号因子自适应数据（优化4）：根据近10期实际重号率调整权重
    // 期望前区重号率约1.5个/期(30%)，实际低于1.0时降低权重，高于2.0时增加
    const recent10ForRepeat = Math.min(10, activeData.length - 1);
    let recent10RepeatSum = 0;
    for (let i = activeData.length - recent10ForRepeat; i < activeData.length; i++) {
      if (i > 0) {
        const prevDraw = activeData[i - 1];
        const currDraw = activeData[i];
        const repeatCount = currDraw.front.filter(n => prevDraw.front.includes(n)).length;
        recent10RepeatSum += repeatCount;
      }
    }
    const recent10RepeatRate = recent10ForRepeat > 0 ? recent10RepeatSum / recent10ForRepeat : 0;
    // 自适应权重因子：低重号周期→0.5，正常→1.0，高重号周期→1.5
    let repeatWeightFactor = recent10RepeatRate < 1.0 ? 0.5 : recent10RepeatRate > 2.0 ? 1.5 : 1.0;
    
    // 重复率均值回归调整 + 预计算lastRepeatCount/prevRepeatCount（优化8跨期形态复用）
    // 高重复周期后往往出现低重复期，检查最近1-2期重号数动态调整
    let lastRepeatCount = 0;
    let prevRepeatCount = 0;
    if (activeData.length >= 2) {
      lastRepeatCount = activeData[activeData.length - 1].front.filter(
        n => activeData[activeData.length - 2].front.includes(n)
      ).length;
      if (lastRepeatCount >= 2) {
        repeatWeightFactor *= 0.7; // 上期≥2重号→降低30%
      }
      if (activeData.length >= 3) {
        prevRepeatCount = activeData[activeData.length - 2].front.filter(
          n => activeData[activeData.length - 3].front.includes(n)
        ).length;
        if (prevRepeatCount >= 2 && lastRepeatCount >= 2) {
          repeatWeightFactor *= 0.5; // 连续2期≥2重号→降低50%
        }
      }
      if (lastRepeatCount === 0) {
        repeatWeightFactor *= 1.2; // 上期0重号→适当提升20%
      }
    }
    console.log('  近10期前区重号率:', recent10RepeatRate.toFixed(2), '自适应因子:', repeatWeightFactor);

    // 归一化所需的统计量（提前计算避免重复）
    const maxFreq = Math.max(...Object.values(frontCounter));
    const maxCondProb = Math.max(...Object.values(conditionalProb.front));
    const allOmissionValues = Object.values(omission.front);
    const omissionStd = this.omissionCalculator.getOmissionStd('front');
    const maxPositiveDeviation = Math.max(...allOmissionValues.map(o => (o || 0) - avgFrontOmission).filter(d => d > 0));
    // 优化2：统一归一化——关联性使用全局最大值（避免候选池偏差）
    const rawCorrelationScores = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1).map(tuoNum => {
      let corr = 0;
      const TIME_DECAY = 0.98;
      const recentDraws = activeData.slice(-Math.min(15, Math.floor(activeData.length * 0.4))); // 优化6：近40%窗口
      for (const dan of danNumbers) {
        // 仅使用近15期时间衰减共现（避免重复计算）
        for (const draw of recentDraws) {
          if (draw.front.includes(dan) && draw.front.includes(tuoNum)) {
            const recencyIdx = recentDraws.indexOf(draw);
            corr += Math.pow(TIME_DECAY, recentDraws.length - recencyIdx);
          }
        }
      }
      return { number: tuoNum, corr };
    });
    const maxCorr = Math.max(...rawCorrelationScores.map(s => s.corr));

    // 预计算：map外常量（避免在每个候选号码中重复计算）
    const totalFrontFreq = Object.values(frontCounter).reduce((a, b) => a + b, 0);
    const avgFreqPerNum = totalFrontFreq / CONFIG.FRONT_RANGE;
    const sumTrend = this.trendAnalyzer.analyzeSumTrend();
    const spanAnalysis = this.trendAnalyzer.analyzeSpan();
    // 预计算：动量加速度全局最大值（优化1：使用1-35全局范围，避免候选池偏差）
    const maxAcceleration = Math.max(
      ...Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1).map(n => {
        const vr = (veryRecentFrontFreq[n] || 0) / veryRecentCount;
        const mr = (recentFreq.front[n] || 0) / (recentFreq.recentCount || 15);
        return vr - mr;
      }).filter(a => a > 0)
    );
    const currentDanSum = danNumbers.reduce((a, b) => a + b, 0);
    // 预计算：均衡/保守策略动量归一化常量
    const maxMomentum = Math.max(...Object.values(recentFreq.frontMomentum).map(m => Math.abs(m)));
    // 预计算：尾数分布周期动态数据（优化2：动态识别关键尾数+自适应阈值）
    // 根据近30期前区各尾数出现频率动态选择top 4热尾数，而非硬编码[1,2,7,8]
    const tailFreqRecent30 = {}; // 近30期各尾数出现次数
    for (let t = 0; t <= 9; t++) tailFreqRecent30[t] = 0;
    const recent30DataForTail = activeData.slice(-Math.min(30, activeData.length));
    for (const draw of recent30DataForTail) {
      for (const num of draw.front) tailFreqRecent30[num % 10]++; // 仅使用前区号码的尾数
    }
    // 动态关键尾数：近30期频率最高的4个尾数（而非硬编码）
    const dynamicHotTails = Object.entries(tailFreqRecent30)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => parseInt(t));
    // 自适应阈值：基于实际数据窗口大小
    const tailWindowSize = Math.min(10, activeData.length);
    const expectedTailFreqPerTail = tailWindowSize * 5 / 10; // 10期*5号/期/10尾数 ≈ 5次
    const tailCoolThreshold = expectedTailFreqPerTail * 2.0; // 冷却阈值≈10次
    const tailWarmThreshold = expectedTailFreqPerTail * 0.6; // 升温阈值≈3次
    // 预计算：近10期各尾数出现次数（避免在每个候选号码中重复计算）
    const tailFreqRecent10 = {};
    for (let t = 0; t <= 9; t++) tailFreqRecent10[t] = 0;
    const recent10DataForTail = activeData.slice(-tailWindowSize);
    for (const draw of recent10DataForTail) {
      for (const num of draw.front) tailFreqRecent10[num % 10]++; // 前区尾数
    }

    const tuoScores = candidateNumbers.map(tuoNum => {
      const zone = getZone(tuoNum);
      let score = 0;

      // 1. 热度信号得分（20分满分）- 频率+遗漏合并，消除信息重叠
      const freq = frontCounter[String(tuoNum)] || frontCounter[tuoNum] || 0;
      const currentOmission = omission.front[tuoNum] || 0;
      if (strategy === 'hot') {
        // 热号策略：遗漏评分(0~12天花板) + 频率可信度5分
        // 与FrontDanOptimizer同步：遗漏=0不应给满分15分，天花板12分
        const rawOmissionScore = Math.max(0, 15 - (currentOmission / avgFrontOmission) * 15);
        const omissionBaseScore = Math.min(rawOmissionScore, 12); // 天花板12分
        const freqBoost = maxFreq > 0 ? (freq / maxFreq) * 5 : 0;
        score += omissionBaseScore + freqBoost;
      } else if (strategy === 'balanced') {
        // 均衡策略：频率基础10分 + 动量5分（降重叠，dm=0.6）
        const freqBase = maxFreq > 0 ? (freq / maxFreq) * 10 : 0;
        const momentum = recentFreq.frontMomentum[tuoNum] || 0;
        const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
        score += (freqBase + Math.max(0, normalizedMomentum) * 5) * dm.freqMomentum;
      } else {
        // 保守策略：频率降至6分 + 动量降至2分（降重叠，dm=0.5）
        const freqBase = maxFreq > 0 ? (freq / maxFreq) * 6 : 0;
        const momentum = recentFreq.frontMomentum[tuoNum] || 0;
        const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
        score += (freqBase + Math.max(0, normalizedMomentum) * 2) * dm.freqMomentum;
      }

      // 1b. 近期频率逆袭加成（降重叠，dm控制）
      // 近30期频率/全量频率比值>1 → 冷→热逆袭信号 → 加分
      const freqRatio = frontFreqRatio[tuoNum] || 0;
      if (freqRatio > 1) {
        const normalizedRatio = maxFreqRatioValue > 1 ? (freqRatio - 1) / (maxFreqRatioValue - 1) : 0;
        const freqRatioMax = strategy === 'hot' ? 8 : strategy === 'balanced' ? 5 : 3;
        score += normalizedRatio * freqRatioMax * (dm.freqRatio || 1);
      }

      // 2. 区间/热区评分
      // 热号：重号因子(自适应8-15分) + 5小区动态趋势(12分)
      // 均衡：区间分布12分 + 5小区动态趋势(8分)
      // 保守（改进1）：区间分布8分 + 5小区动态趋势(5分，保守更谨慎对待趋势)
      if (strategy === 'hot') {
        // 热号策略：重号因子加分（优化3：提升至8-15分，与趋势维度权重匹配）
        // 低重号周期（近10期重号率<1.0）权重降为0.5，高重号周期权重升为1.5
        const repeatMaxScore = Math.min(15 * repeatWeightFactor, 15);
        if (lastDraw && lastDraw.front.includes(tuoNum)) {
          score += Math.min(repeatAnalysis.frontRepeatRate * 15 * repeatWeightFactor, repeatMaxScore);
        }
      } else if (strategy === 'balanced') {
        // 衡策略：区间分布得分（12分满分，dm控制）
        const danInThisZone = danZoneCount[zone] || 0;
        const zoneFreqRank = Object.entries(zoneFrequencies)
          .sort((a, b) => b[1] - a[1])
          .findIndex(([z]) => parseInt(z) === zone);
        const maxZoneRank = 6;
        let zoneScore = 0;
        if (danInThisZone === 0) {
          zoneScore = Math.max(3, 12 - (zoneFreqRank / maxZoneRank) * 9);
        } else {
          zoneScore = Math.max(1, 5 - danInThisZone * 2);
        }
        score += zoneScore * (dm.zoneDistribution || 1);
      } else {
        // 保守策略：区间分布降至8分，dm控制
        const danInThisZone = danZoneCount[zone] || 0;
        const zoneFreqRank = Object.entries(zoneFrequencies)
          .sort((a, b) => b[1] - a[1])
          .findIndex(([z]) => parseInt(z) === zone);
        const maxZoneRank = 6;
        let zoneScore = 0;
        if (danInThisZone === 0) {
          zoneScore = Math.max(2, 8 - (zoneFreqRank / maxZoneRank) * 6);
        } else {
          zoneScore = Math.max(1, 3 - danInThisZone * 1);
        }
        score += zoneScore * (dm.zoneDistribution || 1);
      }

      // 2b. 5小区动态趋势加分（所有策略共用，唯一计算点）
      // 优化3：热号策略提升至12分（与均衡8分拉开差距）
      const zone5Num = getZone5(tuoNum);
      const prediction = zone5Prediction[zone5Num];
      if (strategy === 'hot') {
        if (prediction === 'must') score += 12;
        else if (prediction === 'very_likely') score += 9;
        else if (prediction === 'likely_warm') score += 5;
        else if (prediction === 'warming') score += 3;
        else if (prediction === 'unlikely_cool') score -= 3;
      } else if (strategy === 'balanced') {
        if (prediction === 'must') score += 8;
        else if (prediction === 'very_likely') score += 5;
        else if (prediction === 'likely_warm') score += 3;
        else if (prediction === 'warming') score += 1;
        else if (prediction === 'unlikely_cool') score -= 2;
      } else {
        // 保守策略（改进1）：5小区趋势降至5分，保守更谨慎对待趋势预测
        if (prediction === 'must') score += 5;
        else if (prediction === 'very_likely') score += 3;
        else if (prediction === 'likely_warm') score += 2;
        else if (prediction === 'warming') score += 1;
        else if (prediction === 'unlikely_cool') score -= 1;
      }

      // 3. 条件概率加成（降重叠，dm控制）
      const condProb = conditionalProb.front[tuoNum] || 0;
      const normalizedCondProb = maxCondProb > 0 ? condProb / maxCondProb : 0;
      score += normalizedCondProb * (strategy === 'hot' ? 20 : strategy === 'balanced' ? 25 : 20) * dm.conditionalProb;

      // 3b. 时间衰减得分（dm控制，与FrontDanOptimizer同步）
      // 近期数据权重更高，热号5分(dm=0.5→2.5), 保守4.5分(dm=0.3→1.35), 均衡禁用(dm=0)
      const rawTimeWeight = rawTimeWeights.front[tuoNum] || 0;
      const maxFrontTimeWeight = Math.max(...Object.values(rawTimeWeights.front));
      const normalizedTimeWeight = maxFrontTimeWeight > 0 ? rawTimeWeight / maxFrontTimeWeight : 0;
      score += normalizedTimeWeight * (strategy === 'hot' ? 5 : strategy === 'balanced' ? 0 : 4.5) * (dm.timeDecay || 0);

      // 4. 遗漏偏离度评分（降重叠，σ分段归一化+dm倍率，与FrontDanOptimizer同步）
      // 热号策略已在热度信号维度中处理遗漏，此处仅均衡/保守策略使用
      if (strategy !== 'hot') {
        const omissionDeviation = currentOmission - avgFrontOmission;
        const absOmissionDeviation = Math.abs(omissionDeviation);
        const sigma2 = omissionStd * 2;
        
        const baseDevScore = strategy === 'balanced' ? 5 : 7;
        let baseScore = 0;
        if (absOmissionDeviation >= sigma2 && sigma2 > 0) {
          baseScore = baseDevScore;
        } else if (sigma2 > 0) {
          baseScore = (absOmissionDeviation / sigma2) * baseDevScore;
        }
        
        const highOmissionMax = strategy === 'balanced' ? 7 : 10;
        let strategyBonus = 0;
        if (omissionDeviation > 0) {
          if (omissionDeviation >= sigma2 && sigma2 > 0) {
            strategyBonus = highOmissionMax;
          } else if (sigma2 > 0) {
            strategyBonus = (omissionDeviation / sigma2) * highOmissionMax;
          }
          if (omissionDeviation > sigma2) strategyBonus += 3;
        }
        score += (baseScore + strategyBonus) * dm.omissionDeviation;
      }

      // 5. 关联性加成（升拖码专用，dm控制）
      const rawCorr = rawCorrelationScores.find(s => s.number === tuoNum)?.corr || 0;
      const normalizedCorr = maxCorr > 0 ? rawCorr / maxCorr : 0;
      score += normalizedCorr * 10 * dm.correlation;

      // 6. 协同评分加成（拖码专用，dm控制）
      // 和值协调：拖码加入后使总和接近历史均值
      const targetTotalSum = sumTrend.avgFrontSum;
      const sumWithTuo = currentDanSum + tuoNum;
      const sumDiff = Math.abs(sumWithTuo - targetTotalSum / 5 * (danNumbers.length + 1));
      const maxSumDiff = targetTotalSum * 0.5;
      const sumScoreMax = strategy === 'hot' ? 4 : strategy === 'balanced' ? 4 : 3;
      const sumScore = maxSumDiff > 0 ? Math.max(0, 1 - sumDiff / maxSumDiff) * sumScoreMax : 2;
      score += sumScore * dm.synergy;

      // 奇偶协调（改进3：归一化连续加分，理想比40%-60%得满分，偏离越多扣分越多）
      const danOddCount = danNumbers.filter(n => n % 2 !== 0).length;
      const isOdd = tuoNum % 2 !== 0;
      const totalWithTuo = danNumbers.length + 1;
      const newOddCount = danOddCount + (isOdd ? 1 : 0);
      const idealOddRatio = 0.5; // 理想奇偶比50%:50%
      const actualOddRatio = newOddCount / totalWithTuo;
      const oddDeviation = Math.abs(actualOddRatio - idealOddRatio);
      const maxOddDeviation = 0.5; // 最大偏离(全奇0:5或全偶5:0)
      if (strategy === 'hot') {
        // 热号：归一化惩罚（dm控制）
        if (oddDeviation > 0.2) {
          score -= Math.min((oddDeviation - 0.2) / 0.3, 1) * 3 * dm.synergy;
        }
      } else if (strategy === 'balanced') {
        // 均衡：归一化加分3分
        score += Math.max(0, 1 - oddDeviation / maxOddDeviation) * 3 * dm.synergy;
      } else {
        // 保守：归一化加分2分
        score += Math.max(0, 1 - oddDeviation / maxOddDeviation) * 2 * dm.synergy;
      }

      // 跨度协调：拖码加入后使号码跨度合理（使用预计算的spanAnalysis）
      const allNumbersWithTuo = [...danNumbers, tuoNum];
      const spanWithTuo = Math.max(...allNumbersWithTuo) - Math.min(...allNumbersWithTuo);
      const spanDiff = Math.abs(spanWithTuo - spanAnalysis.avgFrontSpan);
      const maxSpanDiff = spanAnalysis.avgFrontSpan * 0.3;
      const spanScoreMax = strategy === 'hot' ? 2 : 3;
      const spanBonus = maxSpanDiff > 0 ? Math.max(0, 1 - spanDiff / maxSpanDiff) * spanScoreMax : 1;
      score += spanBonus * dm.synergy;
      
      // 热号策略：动量加速度加分（dm控制）
      if (strategy === 'hot') {
        const veryRecentRate = (veryRecentFrontFreq[tuoNum] || 0) / veryRecentCount;
        const mediumRecentRate = (recentFreq.front[tuoNum] || 0) / (recentFreq.recentCount || 15);
        const acceleration = veryRecentRate - mediumRecentRate;
        if (acceleration > 0 && maxAcceleration > 0) {
          score += (acceleration / maxAcceleration) * 5 * dm.momentum;
        }
      }
      
      // 所有策略：冷却惩罚（dm控制）
      const numFreq = frontCounter[String(tuoNum)] || frontCounter[tuoNum] || 0;
      const timeWeight = rawTimeWeights ? (rawTimeWeights.front[tuoNum] || 0) / (Math.max(...Object.values(rawTimeWeights.front)) || 1) : 0;
      if (numFreq > avgFreqPerNum && currentOmission > avgFrontOmission) {
        const coolingDegree = (currentOmission - avgFrontOmission) / avgFrontOmission;
        const freqHeat = numFreq / avgFreqPerNum;
        const toleranceFactor = freqHeat > 1.5 ? 1.5 : (timeWeight > 0.7 ? 1.3 : 1.0);
        const maxPenalty = strategy === 'hot' ? 8 : strategy === 'balanced' ? 3 : 2;
        const penalty = Math.min(coolingDegree * freqHeat * 2 / toleranceFactor, maxPenalty);
        score -= penalty * (dm.coolingPenalty || 1);
      }

      // 所有策略：区间饱和度调节（dm控制，均值回归信号）
      {
        const expectedZoneFreqPerPeriod = 5 / 7;
        const expectedZoneFreq = expectedZoneFreqPerPeriod * veryRecentCount;
        const zoneRecentFreqNum = zoneRecentFreq10[zone] || 0;
        const zoneSatMax = strategy === 'hot' ? 5 : strategy === 'balanced' ? 3 : 2;
        if (zoneRecentFreqNum < expectedZoneFreq * 0.7) {
          const recoveryBonus = Math.min((expectedZoneFreq - zoneRecentFreqNum) / expectedZoneFreq * zoneSatMax, zoneSatMax);
          score += recoveryBonus * (dm.zoneSaturation || 0);
        } else if (zoneRecentFreqNum > expectedZoneFreq * 1.5) {
          const overheatPenalty = Math.min((zoneRecentFreqNum - expectedZoneFreq) / expectedZoneFreq * (zoneSatMax * 0.6), zoneSatMax * 0.6);
          score -= overheatPenalty * (dm.zoneSaturation || 0);
        }
      }


      // 7. 历史形态相似度加成（dm控制）
      const similarityBonus = HistoricalSimilarity.computeNumberSimilarityBonus(
        tuoNum, true, danNumbers, [], activeData
      );
      score += similarityBonus * (strategy === 'hot' ? 5 : strategy === 'balanced' ? 5 : 5) * (dm.historicalSimilarity || 1);

      // 8. 号码间距模式加成（拖码专用，dm控制）
      const gapsWithDan = danNumbers.map(dan => Math.abs(tuoNum - dan));
      let gapScore = 0;
      if (danNumbers.length > 0) {
        const bestGapWeight = Math.max(...gapsWithDan.map(g => {
          if (g >= 1 && g <= 12) {
            return g === 1 ? 1.3 : g === 2 ? 1.1 : 1.0;
          }
          return 0;
        }));
        gapScore = (bestGapWeight / 1.3) * 5;
      } else {
        gapScore = 2.5;
      }
      score += gapScore * dm.gapScore;

      // 8b. 跨区协同性维度（拖码专用，dm控制）
      const danInTuoZone = danZoneCount[zone] || 0;
      if (danInTuoZone >= 2) {
        score -= 3 * (dm.crossZone || 1);
      } else if (danInTuoZone === 0) {
        score += 3 * (dm.crossZone || 1);
      }

      // 优化8：新增跨期形态维度（10分满分，独立性强）
      // 维度9a：重号周期预测信号（4分满分）
      // 逻辑：近10期重号率>0.4且连续2期≥2重号→下期重号率下降→拖码避开重号
      //       近10期重号率<0.2且上期0重号→下期重号率上升→拖码选重号加分
      // 复用外层已计算的lastRepeatCount/prevRepeatCount，避免重复计算
      const repeatCycleBonus = (() => {
        // 高重复周期后下降信号：近10期重号率>0.4且连续2期≥2重号
        if (recent10RepeatRate > 0.4 && lastRepeatCount >= 2 && prevRepeatCount >= 2) {
          return lastDraw && lastDraw.front.includes(tuoNum) ? -4 : 0; // 避开重号
        }
        // 低重复周期后上升信号：近10期重号率<0.2且上期0重号
        if (recent10RepeatRate < 0.2 && lastRepeatCount === 0) {
          return lastDraw && lastDraw.front.includes(tuoNum) ? 4 : 0; // 选择重号
        }
        return 0;
      })();
      score += repeatCycleBonus * (dm.crossPeriod || 1);

      // 维度9b：和值回归信号（3分满分）
      // 逻辑：当前胆码和值偏离均值>1.5标准差→拖码选择使总和向均值回归的号码
      const sumRegressionBonus = (() => {
        // 使用外层预计算的 currentDanSum，避免重复计算
        const targetTotalSum = sumTrend.avgFrontSum;
        const sumStd = sumTrend.frontStd || 30; // 和值标准差，TrendAnalyzer返回frontStd
        const currentDeviation = Math.abs(currentDanSum - targetTotalSum * danNumbers.length / 5);
        
        // 胆码和值偏离>1.5标准差→触发回归信号
        if (currentDeviation > 1.5 * sumStd) {
          const isBelowMean = currentDanSum < targetTotalSum * danNumbers.length / 5;
          // 拖码使总和更接近均值→加分
          const sumWithTuo = currentDanSum + tuoNum;
          const newDeviation = Math.abs(sumWithTuo - targetTotalSum * (danNumbers.length + 1) / 5);
          if (newDeviation < currentDeviation) {
            return 3; // 回归方向正确
          } else {
            return -2; // 加剧偏离
          }
        }
        return 0; // 偏离不大，不触发信号
      })();
      score += sumRegressionBonus * (dm.crossPeriod || 1);

      // 维度9c：尾数分布周期（3分满分，优化2：动态关键尾数+自适应阈值）
      // 动态识别近30期高频尾数（而非硬编码[1,2,7,8]），用自适应阈值判断热冷交替
      const tailCycleBonus = (() => {
        const tail = tuoNum % 10;
        if (!dynamicHotTails.includes(tail)) return 0; // 非关键尾数不参与
        
        // 使用预计算的近10期各尾数频率
        const tailCount = tailFreqRecent10[tail] || 0;
        
        // 自适应阈值：基于数据窗口动态计算
        if (tailCount > tailCoolThreshold) {
          return -3; // 过热，冷却信号
        } else if (tailCount < tailWarmThreshold) {
          return 3; // 偏冷，升温信号
        }
        return 0; // 正常范围
      })();
      score += tailCycleBonus * (dm.crossPeriod || 1);

      return {
        number: tuoNum,
        score,
        zone,
        freq,
        condProb,
        omission: currentOmission,
        corrBonus: rawCorr,
        similarityBonus,
        gapScore
      };
    });

    // 所有策略：区间防极端惩罚 - 必须在所有号码评分完成后统一计算
    // 热号最多扣5分(dm=0.5→实际-2.5), 均衡/保守最多扣3分(dm=1→实际-3)
    tuoScores.sort((a, b) => b.score - a.score);
    const top20ZoneCounts = {};
    for (let z = 1; z <= 7; z++) top20ZoneCounts[z] = 0;
    tuoScores.slice(0, 20).forEach(s => top20ZoneCounts[s.zone]++);
    const antiExtremeMax = strategy === 'hot' ? 5 : 3;
    const zoneAntiExtremeValue = (dm.zoneAntiExtreme !== undefined ? dm.zoneAntiExtreme : 1);
    for (const s of tuoScores) {
      if (top20ZoneCounts[s.zone] >= 4) {
        s.score -= antiExtremeMax * zoneAntiExtremeValue;
      }
    }

    // 按评分排序
    tuoScores.sort((a, b) => b.score - a.score);
    
    // 评分随机扰动（改进5：幅度按分数范围自适应，扰动=range*5%）
    // 打破确定性排名，避免同一号码每次都排同一位置
    // 不同策略分数范围差异大（均衡~15分vs热号~36分），固定±2分扰动比例不一致
    const tuoScoreRange = Math.max(...tuoScores.map(s => s.score)) - Math.min(...tuoScores.map(s => s.score));
    const tuoPerturbation = tuoScoreRange * 0.05;
    for (const s of tuoScores) {
      s.score += (Math.random() - 0.5) * tuoPerturbation * 2; // ±range*5%扰动
    }
    tuoScores.sort((a, b) => b.score - a.score); // 重新排序
    
    // 加权随机采样选择拖码（高分号码概率更高，但每次结果不同）
    // 第一步：给每个号码分配采样权重
    const minScore = Math.min(...tuoScores.map(s => s.score));
    const maxScore = Math.max(...tuoScores.map(s => s.score));
    const scoreRange = maxScore - minScore;
        
    const weightedCandidates = tuoScores.map(s => {
      const normalized = scoreRange > 0 ? (s.score - minScore) / scoreRange : 0.5;
      const compressed = Math.sqrt(normalized); // 平方根压缩：高分仍优先但差距缩小
      // 权重映射：最低10%概率，最高100%概率
      return { ...s, sampleWeight: 0.15 + compressed * 0.85 }; 
    });
        
    // 第二步：动态优先采样，考虑已选拖码的累积效果
    // 每选一个拖码后，评估当前组合质量，动态调整后续号码权重
    // 优化4：奇偶约束、区间覆盖统一在adjustDynamicWeight中处理，避免评分阶段重复计算
    const selectedTuo = []; 
    const selectedNumbers = new Set(danNumbers);
    let consecutivePairs = 0;
    const remaining = [...weightedCandidates];
    
    // 动态权重调整函数：根据当前组合不足的维度，提升对应号码的权重
    // 热号策略：防止极端奇偶比（0:5或5:0），其余让趋势决定
    // 均衡/保守策略：补充奇偶和区间覆盖
    const adjustDynamicWeight = (candidate, currentDan, currentTuo) => {
      const allSelected = [...currentDan, ...currentTuo];
      let bonus = 1.0; // 基础权重倍率
          
      // 所有策略：防止极端奇偶比
      const currentOdd = allSelected.filter(n => n % 2 !== 0).length;
      const currentEven = allSelected.length - currentOdd;
      const targetSize = 5;
      
      // 热号策略：防止极端奇偶比 + 强化区间覆盖约束
      if (strategy === 'hot' && allSelected.length >= 2) {
        if ((currentOdd === 0 && candidate.number % 2 !== 0) ||
            (currentEven === 0 && candidate.number % 2 === 0)) {
          bonus += 0.5; // 防止极端奇偶比
        }
        // 区间覆盖约束：已选号码已覆盖的区越多，未覆盖区的号码权重提升
        // 防止拖码集中在同一区（212期拖码大部分在区4-6，缺少区2号码07）
        const coveredZones7 = new Set(allSelected.map(n => getZone(n)));
        const candidateZone7 = getZone(candidate.number);
        
        // 强化未覆盖区奖励：从0.3提升到0.6
        if (!coveredZones7.has(candidateZone7)) {
          bonus += 0.6; // 未覆盖区的号码权重提升60%（原30%）
        }
        
        // 新增：过度集中惩罚 - 如果某区已有2+个号码，该区后续号码降权
        const zoneCount = allSelected.filter(n => getZone(n) === candidateZone7).length;
        if (zoneCount >= 2) {
          bonus *= 0.7; // 同区已有2+个号码时，权重降至70%
        }
      }
      
      // 均衡/保守策略：完整的奇偶和区间均衡
      if (strategy !== 'hot') {
        if (allSelected.length < targetSize) {
          const idealOddMin = Math.round(targetSize * 0.4);
          const idealOddMax = Math.round(targetSize * 0.6);
          if (currentOdd < idealOddMin && candidate.number % 2 !== 0) {
            bonus += 0.5;
          } else if (currentEven < idealOddMin && candidate.number % 2 === 0) {
            bonus += 0.5;
          }
        }
            
        const coveredZones = new Set(allSelected.map(n => getZone(n)));
        if (allSelected.length < targetSize && coveredZones.size < 4) {
          const candidateZone = getZone(candidate.number);
          if (!coveredZones.has(candidateZone)) {
            bonus += 0.3;
          }
        }
      }
          
      return candidate.sampleWeight * bonus;
    };
        
    while (selectedTuo.length < targetCount && remaining.length > 0) {
      // 动态权重：根据当前组合质量调整各号码权重
      const dynamicWeights = remaining.map(w => ({
        ...w,
        dynamicWeight: adjustDynamicWeight(w, danNumbers, selectedTuo)
      }));
      const totalWeight = dynamicWeights.reduce((sum, w) => sum + w.dynamicWeight, 0);
          
      // 加权随机选择
      let random = Math.random() * totalWeight;
      let chosenIdx = -1;
      for (let j = 0; j < dynamicWeights.length; j++) {
        random -= dynamicWeights[j].dynamicWeight;
        if (random <= 0) {
          chosenIdx = j;
          break;
        }
      }
      if (chosenIdx === -1) chosenIdx = dynamicWeights.length - 1;
          
      const chosen = remaining[chosenIdx];
      const num = chosen.number;
          
      // 连号检查
      let isConsecutive = false;
      for (const sel of selectedNumbers) {
        if (Math.abs(num - sel) === 1) {
          isConsecutive = true;
          break;
        }
      }
          
      // 允许最多2对连号，超出则跳过此号码
      // 大乐透统计：约60-70%有至少1对连号，约20-30%有2对连号
      // 改进：热号策略下，限制同区连续出现，避免过度聚集
      if (isConsecutive && consecutivePairs >= 2) {
        remaining.splice(chosenIdx, 1); // 移除不合适的号码
        continue;
      }
      
      // 热号策略额外检查：防止同一区内连续选择过多号码
      if (strategy === 'hot') {
        const candidateZone = getZone(num);
        const sameZoneCount = selectedTuo.filter(n => getZone(n) === candidateZone).length;
        // 如果同区已有2个号码，且当前号码与已选号码相邻，降低优先级
        if (sameZoneCount >= 2 && isConsecutive) {
          // 不是直接跳过，而是降低权重后继续参与竞争
          // 这里通过remaining.splice实现临时移除，下次循环可能重新选中
          remaining.splice(chosenIdx, 1);
          // 将该号码放回候选池末尾，给予较低优先级
          remaining.push({ ...chosen, sampleWeight: chosen.sampleWeight * 0.5 });
          continue;
        }
      }
          
      if (isConsecutive) consecutivePairs++; 
      selectedTuo.push(num);
      selectedNumbers.add(num);
      remaining.splice(chosenIdx, 1); // 移除已选号码
    }
        
    // 如果因为间距限制导致数量不足，放宽限制
    if (selectedTuo.length < targetCount) {
      console.log('  连号限制导致数量不足，放宽限制');
      const allRemaining = tuoScores.filter(s => !selectedNumbers.has(s.number));
      for (const item of allRemaining) {
        if (selectedTuo.length >= targetCount) break;
        selectedTuo.push(item.number);
        selectedNumbers.add(item.number);
      }
    }

    console.log('✅ 拖码选择完成:', selectedTuo, '(共' + selectedTuo.length + '个)');
    console.log(' 拖码详情:', tuoScores.slice(0, targetCount).map(item =>
      `#${item.number}(区${item.zone}, 频率${item.freq}, 条件概率${(item.condProb || 0).toFixed(3)}, 遗漏${item.omission}, 关联${item.corrBonus.toFixed(1)}, 总分${item.score.toFixed(1)})`
    ).join(', '));
  
    // 按数字大小排序后返回
    return selectedTuo.sort((a, b) => a - b);
  }

  /**
   * 计算号码对的历史搭档关系加分
   * @param {number[]} danNumbers - 胆码数组
   * @param {number[]} candidateNumbers - 候选号码数组
   * @returns {Object} {号码: 搭档加分}
   */
  calculatePairBonus(danNumbers, candidateNumbers) {
    // 防御性检查
    if (!danNumbers || !Array.isArray(danNumbers) || danNumbers.length === 0) {
      return {};
    }

    if (!candidateNumbers || !Array.isArray(candidateNumbers) || candidateNumbers.length === 0) {
      return {};
    }

    const activeData = this.getActiveData();
    const bonus = {};

    // 初始化
    candidateNumbers.forEach(num => {
      bonus[num] = 0;
    });

    // 统计历史共现次数
    for (const draw of activeData) {
      for (const dan of danNumbers) {
        if (draw.front.includes(dan)) {
          for (const candidate of candidateNumbers) {
            if (draw.front.includes(candidate)) {
              bonus[candidate] = (bonus[candidate] || 0) + 1;
            }
          }
        }
      }
    }

    return bonus;
  }

  /**
   * 强制区间覆盖（胆拖专用版）
   * 确保号码分布在三个区间，使用加权选择替代随机
   * @param {number[]} selectedNumbers - 已选号码
   * @param {number[]} danNumbers - 胆码数组
   * @param {number} targetCount - 目标数量
   * @returns {number[]} 优化后的号码数组
   */
  enforceZoneCoverageForDanTuo(selectedNumbers, danNumbers, targetCount) {
    // 防御性检查
    if (!danNumbers || !Array.isArray(danNumbers)) {
      danNumbers = [];
    }

    if (selectedNumbers.length <= targetCount) {
      return selectedNumbers;
    }

    const allNumbers = [...danNumbers, ...selectedNumbers];

    // 检查区间分布（7小区，与主方法optimizeTuoSelectionWithZoneFrequency一致）
    const getZone = (num) => {
      if (num <= 5) return 1;
      if (num <= 10) return 2;
      if (num <= 15) return 3;
      if (num <= 20) return 4;
      if (num <= 25) return 5;
      if (num <= 30) return 6;
      return 7;
    };

    const zoneCounts = {};
    for (let z = 1; z <= 7; z++) zoneCounts[z] = 0;
    allNumbers.forEach(n => zoneCounts[getZone(n)]++);

    // 至少3个7小区有号码才认为区间覆盖合格
    const coveredZones = Object.values(zoneCounts).filter(c => c > 0).length;
    if (coveredZones >= 3) {
      return selectedNumbers.slice(0, targetCount);
    }

    let result = [...selectedNumbers];
    const conditionalProb = this.conditionalProbability.calculateConditionalProbability();
    const [frontCounter] = this.frequencyAnalyzer.analyzeFrequency();

    // 加权选择函数：按频率+条件概率评分选择最优号码
    const selectBestCandidate = (candidates) => {
      if (candidates.length === 0) return null;
      let best = candidates[0];
      let bestScore = 0;
      for (const n of candidates) {
        const freqScore = (frontCounter[String(n)] || frontCounter[n] || 0) / Math.max(...Object.values(frontCounter));
        const condScore = (conditionalProb.front[n] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence;
        const total = freqScore * 0.6 + condScore * 0.4;
        if (total > bestScore) {
          bestScore = total;
          best = n;
        }
      }
      return best;
    };

    // 补充缺失区间（7小区版本）
    const missingZones = Object.entries(zoneCounts)
      .filter(([z, c]) => c === 0)
      .map(([z]) => parseInt(z));

    for (const missingZone of missingZones) {
      const zoneStart = (missingZone - 1) * 5 + 1;
      const zoneEnd = Math.min(missingZone * 5, CONFIG.FRONT_RANGE);
      const zoneCandidates = Array.from({ length: zoneEnd - zoneStart + 1 }, (_, i) => zoneStart + i)
        .filter(n => !allNumbers.includes(n));
      if (zoneCandidates.length > 0) {
        const bestCandidate = selectBestCandidate(zoneCandidates);
        if (bestCandidate) {
          // 替换冗余区中评分最低的号码
          const overrepresentedZones = Object.entries(zoneCounts)
            .filter(([z, c]) => parseInt(z) !== missingZone && c >= 2)
            .map(([z]) => parseInt(z));
          let replaceNum = null;
          if (overrepresentedZones.length > 0) {
            const worst = result.reduce((w, num) => {
              const zone = getZone(num);
              if (!overrepresentedZones.includes(zone)) return w;
              const score = (frontCounter[String(num)] || frontCounter[num] || 0) / Math.max(...Object.values(frontCounter));
              return score < w.score ? { num, score } : w;
            }, { num: 0, score: Infinity });
            replaceNum = worst.num;
          }
          if (replaceNum && replaceNum > 0) {
            result[result.indexOf(replaceNum)] = bestCandidate;
          }
        }
      }
    }

    return result.slice(0, targetCount);
  }

  /**
   * 普通拖码优化（不带区间频率）
   * 降级版本：5维度评分体系（频率+条件概率+遗漏+搭档+区间分布）
   * @param {number[]} danNumbers - 胆码数组
   * @param {number[]} candidateNumbers - 候选拖码数组
   * @param {number} targetCount - 目标数量
   * @returns {number[]} 优化后的拖码数组
   */
  optimizeTuoSelection(danNumbers, candidateNumbers, targetCount = 10) {
    // 5维度评分体系，与主方法保持维度一致性
    const [frontCounter] = this.frequencyAnalyzer.analyzeFrequency();
    const maxFreq = Math.max(...Object.values(frontCounter));
    const pairBonus = this.calculatePairBonus(danNumbers, candidateNumbers);
    const maxPairBonus = Math.max(...Object.values(pairBonus), 1);
  
    // 获取条件概率和遗漏数据
    const conditionalProb = this.conditionalProbability.calculateConditionalProbability();
    const maxCondProb = Math.max(...Object.values(conditionalProb.front));
    const omission = this.omissionCalculator.calculateOmission();
    const avgFrontOmission = this.omissionCalculator.getAverageOmission('front');
  
    // 区间定义（7区间，与主方法一致）
    const getZone = (num) => {
      if (num <= 5) return 1;
      if (num <= 10) return 2;
      if (num <= 15) return 3;
      if (num <= 20) return 4;
      if (num <= 25) return 5;
      if (num <= 30) return 6;
      return 7;
    };
    // 计算胆码区间分布
    const danZoneCount = {};
    danNumbers.forEach(num => {
      const zone = getZone(num);
      danZoneCount[zone] = (danZoneCount[zone] || 0) + 1;
    });
    // 计算区间频率排名
    const zoneFrequencies = {};
    for (let zone = 1; zone <= 7; zone++) {
      const start = (zone - 1) * 5 + 1;
      const end = zone * 5;
      let totalFreq = 0;
      for (let i = start; i <= end; i++) {
        totalFreq += frontCounter[String(i)] || frontCounter[i] || 0;
      }
      zoneFrequencies[zone] = totalFreq;
    }
  
    const scored = candidateNumbers.map(num => {
      let score = 0;
      const zone = getZone(num);
  
      // 维度1: 频率得分（20分满分）- 归一化
      const freq = frontCounter[String(num)] || frontCounter[num] || 0;
      score += maxFreq > 0 ? (freq / maxFreq) * 20 : 0;
  
      // 维度2: 条件概率得分（20分满分）- 归一化
      const condProb = conditionalProb.front[num] || 0;
      const normalizedCondProb = maxCondProb > 0 ? condProb / maxCondProb : 0;
      score += normalizedCondProb * 20;
  
      // 维度3: 遗漏回归得分（20分满分）- 归一化
      const currentOmission = omission.front[num] || 0;
      const omissionDeviation = currentOmission - avgFrontOmission;
      const maxPositiveDeviation = Math.max(
        ...Object.values(omission.front).map(o => (o || 0) - avgFrontOmission).filter(d => d > 0)
      );
      if (omissionDeviation > 0 && maxPositiveDeviation > 0) {
        score += (omissionDeviation / maxPositiveDeviation) * 20;
      }
  
      // 维度4: 搭档关系得分（20分满分）- 归一化
      const bonus = pairBonus[num] || 0;
      score += (bonus / maxPairBonus) * 20;
  
      // 维度5: 区间分布得分（20分满分）
      // 胆码未覆盖的高频区加分
      const danInThisZone = danZoneCount[zone] || 0;
      const zoneFreqRank = Object.entries(zoneFrequencies)
        .sort((a, b) => b[1] - a[1])
        .findIndex(([z]) => parseInt(z) === zone);
      if (danInThisZone === 0) {
        if (zoneFreqRank < 4) score += 20;
        else if (zoneFreqRank < 6) score += 12;
        else score += 6;
      } else {
        score += 8 - danInThisZone * 2;
      }
  
      return { number: num, score };
    });
  
    scored.sort((a, b) => b.score - a.score);
  
    // 按数字大小排序后返回
    return scored.slice(0, targetCount).map(item => item.number).sort((a, b) => a - b);
  }
}
