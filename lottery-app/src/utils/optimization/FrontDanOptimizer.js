/**
 * 前区胆码智能推荐优化器
 * 融合：条件概率 + 遗漏回归 + 时间衰减 + 频率 + 区间分布
 * 使用加权随机采样，每次推荐结果不同但合理
 */

import { CONFIG } from '../core/Config.js';
import { HistoricalSimilarity } from '../analysis/HistoricalSimilarity.js';
import { computeZone5Prediction, formatZonePredictionLog } from './ZonePrediction.js';

export class FrontDanOptimizer {
  /**
   * 优化前区胆码推荐（多维度智能评分 + 加权随机采样）
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {number} danCount - 需要推荐的胆码数量（2-4）
   * @param {string} strategy - 策略：hot/balanced/conservative
   * @returns {Object} { selected: number[], probabilityInfo: Object[] }
   */
  static optimize(analyzer, danCount = 3, strategy = 'hot', dimensionMultipliers = null) {
    console.log('🎯 前区胆码智能推荐（多维度评分 + 加权随机采样）');
    console.log('  策略:', strategy, '胆码数量:', danCount);
    
    // 维度权重倍率（4胆配置，V5重构：去噪音强信号）
    // 核心原则：条件概率置信度0.40-0.51（接近噪音），不应占30%总分
    //   zone5Trend是区间级信号（7号共享），不应主导号码级评分
    //   timeDecay与frequency信息重叠（频率已含时间衰减）
    //   consecutive基于邻居统计，信号极弱
    // 改进：大幅强化heatSignal+momentum（最可靠的短期频率信号），
    //   大幅削弱conditionalProb/zone5Trend/timeDecay/consecutive
    const defaultMultipliers = {
      hot: { 
        heatSignal: 2.0,       // 强化：频率+遗漏合并信号（最基础最可靠，占评分主导）
        freqRatio: 0.8,        // 近期升温信号（保留，有用的短期信号）
        conditionalProb: 0.3,  // 大幅削弱：置信度0.40-0.51≈噪音，不应主导评分
        timeDecay: 0,          // 移除：与frequency信息重叠，冗余维度
        zone5Trend: 0.5,       // 削弱：区间级信号（7号共享同一趋势），不应占大权重
        repeatCooling: 1.0,    // 保留：重号降温是热号策略核心逻辑
        momentum: 2.0,         // 强化：频率动量是最可靠的短期趋势信号
        coolingPenalty: 0,     // 关闭
        zoneSaturation: 0.3,   // 削弱：结构性辅助信号
        historicalSimilarity: 0, // 关闭：数据稀疏
        consecutive: 0,        // 移除：基于邻居统计的弱信号
        zoneAntiExtreme: 0     // 关闭
      },
      balanced: { freqMomentum: 1, conditionalProb: 1, omissionDeviation: 0.6, timeDecay: 0, freqTrend: 1, zone5Trend: 1, consecutive: 1 },
      conservative: { freqMomentum: 1, conditionalProb: 1, omissionDeviation: 1.0, timeDecay: 0.3, freqTrend: 1, zone5Trend: 1, consecutive: 1, historicalSimilarity: 0.5, zoneSaturation: 0.3 }
    };
    const dm = dimensionMultipliers || defaultMultipliers[strategy];
    
    // 1. 获取条件概率
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();
    const confidence = conditionalProb.confidence || 0.3;
    
    // 2. 获取遗漏数据
    const omissionData = analyzer.omissionCalculator.calculateOmission();
    const avgFrontOmission = analyzer.omissionCalculator.getAverageOmission('front');
    const omissionStd = analyzer.omissionCalculator.getOmissionStd('front');
    
    // 3. 获取频率数据（全量 + 近期趋势动量）
    const [frontCounter] = analyzer.frequencyAnalyzer.analyzeFrequency();
    const maxFreq = Math.max(...Object.values(frontCounter));
    const recentFreq = analyzer.frequencyAnalyzer.analyzeRecentFrequency();
    
    // 4. 获取时间衰减权重（归一化到0-1范围）
    const rawTimeWeights = analyzer.calculateTimeDecayWeights();
    const maxFrontTimeWeight = Math.max(...Object.values(rawTimeWeights.front));
    
    // 5. 获取关联性数据（使用时间衰减版本，近期共现权重更高）
    const correlationData = analyzer.correlationAnalyzer.calculateNumberCorrelationWithTimeDecay();
    
    // 6. 热号策略专用数据
    const repeatAnalysis = analyzer.trendAnalyzer.analyzeRepeatNumbers();
    const activeData = analyzer.getActiveData();
    const lastDraw = activeData.length > 0 ? activeData[activeData.length - 1] : null;
    
    // 动量加速度：近10期频率 vs 近30期频率（更长窗口减少噪音，更稳定的趋势信号）
    const veryRecentCount = Math.min(10, activeData.length); // 改为近10期（原5期噪音大）
    const veryRecentData = activeData.slice(-veryRecentCount);
    const veryRecentFrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) veryRecentFrontFreq[i] = 0;
    for (const draw of veryRecentData) {
      for (const num of draw.front) veryRecentFrontFreq[num]++;
    }
    
    // 5小区定义（替代7小区，更符合出号规律：85.4%只有3-4区出号）
    const getZone5 = (num) => Math.ceil(num / 7); // 区1(1-7),区2(8-14),区3(15-21),区4(22-28),区5(29-35)
    // 7小区定义（仍用于维度8区间饱和度调节）
    const getZone7 = (num) => {
      if (num <= 5) return 1;
      if (num <= 10) return 2;
      if (num <= 15) return 3;
      if (num <= 20) return 4;
      if (num <= 25) return 5;
      if (num <= 30) return 6;
      return 7;
    };
    // 7. 计算每个号码的综合得分（策略差异化评分，总分约100）
    // 回测验证(4胆)：均衡依赖少数强维度(条件概率30分主导)，加弱维度反而稀释信号
    // 保守需多维度确认回归(遗漏回归σ归一化+形态匹配+区间均值回归)
    // 热号启用timeDecay(近期权重)+zoneAntiExtreme(防集中)，0.97x→1.05x显著提升
    // 热号策略(4胆)：12维度(热度信号20+频率逆袭6+条件概率15+时间衰减5+5小区趋势20+重号降温-1~-2+动量加速5+冷却惩罚-5+区间饱和度±5+历史相似度5+连号协同5+区间防极端-2~-3 = 52~78)
    // 均衡策略(4胆)：6维度(频率动量15+条件概率30+遗漏偏离度(0.6×σ归一化)+频率趋势10+5小区趋势10+连号协同5)
    // 保守策略(4胆)：9维度(频率动量8+条件概率25+遗漏偏离度(1.0×σ归一化)+时间衰减4.5+频率趋势7+5小区趋势7+连号协同3+历史相似度3+区间饱和度±0.6)
    const scored = [];
    
    // 先计算全局最大值用于归一化
    const maxCondProb = Math.max(...Object.values(conditionalProb.front));
    const maxOmissionDeviation = Math.max(
      ...Object.values(omissionData.front)
        .map(o => (o || 0) - avgFrontOmission)
        .filter(d => d > 0)
    );
    // 计算关联性最大值
    let maxCorrelation = 0;
    for (const num in correlationData.front) {
      const correlations = Object.values(correlationData.front[num] || {});
      const sum = correlations.reduce((a, b) => a + b, 0);
      if (sum > maxCorrelation) maxCorrelation = sum;
    }
    
    // 预计算：7小区频率趋势数据（均衡/保守策略维度5用，取消3大区强制均衡补偿）
    // 与后区BackDanOptimizer设计决策一致：基于历史频率的趋势加分而非强制均衡
    const recentFrontWindowCount = Math.min(30, activeData.length); // 近30期频率（更稳定）
    const recentFrontWindowData = activeData.slice(-recentFrontWindowCount);
    const recentFrontWindowFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) recentFrontWindowFreq[i] = 0;
    for (const draw of recentFrontWindowData) {
      for (const num of draw.front) recentFrontWindowFreq[num]++;
    }
    const frontExpectedRate = CONFIG.FRONT_COUNT / CONFIG.FRONT_RANGE; // 5/35 ≈ 0.143
    const frontFreqRates = {}; // 每个号码的近期频率比率
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      frontFreqRates[i] = recentFrontWindowCount > 0 ? recentFrontWindowFreq[i] / recentFrontWindowCount : 0;
    }
    const maxFrontFreqRate = Math.max(...Object.values(frontFreqRates));
    
    // === 5小区动态趋势数据（改进4：使用共享ZonePrediction工具，统一预测逻辑） ===
    // 数据支撑：85.4%只有3-4个小区出号，连续不出2期后100%回归
    const { zone5Absence, zone5RecentHit, zone5Trend, zone5Prediction } = computeZone5Prediction(activeData, getZone5);
    
    // 5小区预测：判断哪些区下期"必出"、"可能出"、"可能不出"
    // 核心逻辑：连续不出2期后回归概率接近100%，连续不出3期以上绝对必出
    const zone5Log = formatZonePredictionLog(zone5Prediction, zone5Absence, zone5Trend, 5, (z) => `${(z-1)*7+1}-${z*7}`, '5小区');
    console.log('  📊 5小区动态趋势预测:', zone5Log);
    
    // 7小区近期频率占比（仍用于区间饱和度调节维度8）
    const zone7RecentFreq = {}; // 近30期各区频率占比
    for (let zone = 1; zone <= 7; zone++) zone7RecentFreq[zone] = 0;
    for (const draw of recentFrontWindowData) {
      for (const num of draw.front) zone7RecentFreq[getZone7(num)]++;
    }
    const totalZone7RecentFreq = Object.values(zone7RecentFreq).reduce((a, b) => a + b, 0) || 1;
    
    // 预计算：近期频率逆袭数据（近30期频率/全量频率比值>1 → 冷→热逆袭信号）
    // 升级窗口到30期：更大的窗口能捕捉中期趋势而非短期噪音
    const recent30Count = Math.min(30, activeData.length);
    const recent30Data = activeData.slice(-recent30Count);
    const recent30FrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) recent30FrontFreq[i] = 0;
    for (const draw of recent30Data) {
      for (const num of draw.front) recent30FrontFreq[num]++;
    }
    const totalDraws = activeData.length;
    const frontFreqRatio = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      const recentRate = recent30FrontFreq[i] / recent30Count;
      const overallRate = (frontCounter[String(i)] || frontCounter[i] || 0) / totalDraws;
      frontFreqRatio[i] = overallRate > 0 ? recentRate / overallRate : 0;
    }
    const maxFreqRatioValue = Math.max(...Object.values(frontFreqRatio).filter(r => r > 1), 1);

    // 预计算：近10期重号率（用于胆码重号降温幅度判断）
    // 胆码是"必须命中"位置，上期号码不应因"重号因子"被大力推向胆码
    // 改为降温逻辑：上期出现过的号码在胆码位置扣1-3分
    // 降温幅度取决于近期重号环境：高重号周期→降温更多
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

    // 预计算：近10期各区频率（用于热号策略区间饱和度调节）
    // 区间饱和度调节仍用更短窗口(近10期)，捕捉短期过热/冷区信号
    const recentZone7Freq = {}; // 近10期各区频率（原hotZoneRecentFreq，改名更清晰）
    for (let zone = 1; zone <= 7; zone++) recentZone7Freq[zone] = 0;
    for (const draw of veryRecentData) {
      for (const num of draw.front) recentZone7Freq[getZone7(num)]++;
    }
    const totalRecentZone7Freq = Object.values(recentZone7Freq).reduce((a, b) => a + b, 0) || 1;

    // 预计算：循环外常量（避免在35次循环中重复计算）
    const maxMomentum = Math.max(...Object.values(recentFreq.frontMomentum).map(m => Math.abs(m))); 
    const totalFrontFreq = Object.values(frontCounter).reduce((a, b) => a + b, 0);
    const avgFreqPerNum = totalFrontFreq / CONFIG.FRONT_RANGE;
    // 预计算：动量加速度全局最大值
    const maxAcceleration = Math.max(
      ...Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .map(n => ((veryRecentFrontFreq[n] || 0) / veryRecentCount) - ((recentFreq.front[n] || 0) / recentFreq.recentCount))
        .filter(a => a > 0)
    );

    for (let num = 1; num <= CONFIG.FRONT_RANGE; num++) {
      let score = 0;
      const zone7 = getZone7(num);
      const dims = {}; // 维度分解追踪
      
      // 维度1: 热度信号得分（20分满分）- 频率+遗漏合并，消除信息重叠
      // 热号策略：低遗漏=热号信号强，频率作为权重倍率
      // 均衡/保守策略：频率基础10分 + 动量5分（与原逻辑一致）
      const freq = frontCounter[String(num)] || frontCounter[num] || 0;
      const momentum = recentFreq.frontMomentum[num] || 0;
      const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
      const currentOmission = omissionData.front[num] || 0;
      
      if (strategy === 'hot') {
        // 热号策略：热度信号 = 遗漏评分(0~12) + 频率权重倍率(0~5)
        // 修复：遗漏=0不应给满分15分，它只意味着"上期刚出"而非"极度热门"
        // 遗漏0与遗漏1的实际出现概率差距很小，不应导致8-10分的巨大评分差异
        // 上期号码(遗漏=0)已有重号降温维度扣分，此处再给15分会双重矛盾
        // 改为天花板12分：遗漏0得12分（天花板），遗漏1得~10分，遗漏avg得5分
        const rawOmissionScore = Math.max(0, 15 - (currentOmission / avgFrontOmission) * 15);
        const omissionBaseScore = Math.min(rawOmissionScore, 12); // 天花板12分
        // 频率倍率：高频号的热度信号更可信，加权5分
        const freqBoost = maxFreq > 0 ? (freq / maxFreq) * 5 : 0;
        score += (omissionBaseScore + freqBoost) * dm.heatSignal;
        dims.heatSignal = (omissionBaseScore + freqBoost) * dm.heatSignal;
      } else if (strategy === 'balanced') {
        // 均衡策略：频率基础10分 + 动量5分
        const freqBase = maxFreq > 0 ? (freq / maxFreq) * 10 : 0;
        score += (freqBase + Math.max(0, normalizedMomentum) * 5) * dm.freqMomentum;
      } else {
        // 保守策略（3胆优化）：频率降至6分 + 动量降至2分，更注重遗漏回归
        // 保守策略强调稳定性，减少高频号依赖，增加冷门号机会
        const freqBase = maxFreq > 0 ? (freq / maxFreq) * 6 : 0;
        score += (freqBase + Math.max(0, normalizedMomentum) * 2) * dm.freqMomentum;
      }

      // 热号策略维度2: 近期频率逆袭加成（6分满分）
      // 近15期频率/全量频率比值>1 → 近期升温比历史更热 → 加分
      // 直接捕捉冷→热逆袭号码（如#26、#34），弥补全量频率低估
      if (strategy === 'hot') {
        const freqRatio = frontFreqRatio[num] || 0;
        if (freqRatio > 1) {
          const normalizedRatio = maxFreqRatioValue > 1 ? (freqRatio - 1) / (maxFreqRatioValue - 1) : 0;
          const freqRatioScore = normalizedRatio * 6 * dm.freqRatio;
          score += freqRatioScore;
          dims.freqRatio = freqRatioScore;
        }
      }

      // 条件概率得分 - 归一化（改进1：均衡30分，保守降至25分）
      // 热号策略降低至15分，避免过度依赖历史共现模式，让位于更强的趋势信号
      const condProb = conditionalProb.front[num] || 0;
      const normalizedCondProb = maxCondProb > 0 ? condProb / maxCondProb : 0;
      const condProbScore = normalizedCondProb * (strategy === 'hot' ? 15 : strategy === 'balanced' ? 30 : 25) * dm.conditionalProb;
      score += condProbScore;
      dims.conditionalProb = condProbScore;
      
      // 均衡/保守策略维度3: 遗漏偏离度评分（改进2：σ分段归一化替代max值归一化）
      // 回测发现：max值归一化被极端遗漏值稀释（如#4遗漏28时，#11遗漏16仅得0.57归一化分数）
      // 改进：使用2σ作为归一化参考，>2σ直接满分，0-2σ线性映射
      // 效果：中等遗漏号码不再被极端值压制，回归信号更准确
      if (strategy !== 'hot') {
        const omissionDeviation = currentOmission - avgFrontOmission;
        const absDeviation = Math.abs(omissionDeviation);
        const sigma2 = omissionStd * 2; // 2σ归一化参考值
        
        // 基础偏离度评分：0-2σ线性映射，>2σ满分
        const devBaseMax = strategy === 'balanced' ? 10 : 13;
        let baseDevScore = 0;
        if (absDeviation >= sigma2 && sigma2 > 0) {
          baseDevScore = devBaseMax; // >2σ直接满分（极端偏离）
        } else if (sigma2 > 0) {
          baseDevScore = (absDeviation / sigma2) * devBaseMax; // 0-2σ线性映射
        }
        
        let omissionDevRaw = baseDevScore;
        
        // 策略加成：均衡/保守偏向高遗漏号码（σ分段归一化）
        if (omissionDeviation > 0) {
          const highOmissionMax = strategy === 'balanced' ? 7 : 10;
          let strategyBonus = 0;
          if (omissionDeviation >= sigma2 && sigma2 > 0) {
            strategyBonus = highOmissionMax; // >2σ直接满分
          } else if (sigma2 > 0) {
            strategyBonus = (omissionDeviation / sigma2) * highOmissionMax; // 线性映射
          }
          omissionDevRaw += strategyBonus;
          // 极端遗漏额外加成（>2σ仍获额外加分，强化回归信号）
          if (omissionDeviation > sigma2) {
            omissionDevRaw += strategy === 'balanced' ? 3 : 5;
          }
        }
        score += omissionDevRaw * dm.omissionDeviation;
      }
      

      
      // 热号策略维度4: 时间衰减得分（10分）
      // 均衡/保守策略维度4: 时间衰减得分（15分）
      const rawTimeWeight = rawTimeWeights.front[num] || 0;
      const normalizedTimeWeight = maxFrontTimeWeight > 0 
        ? rawTimeWeight / maxFrontTimeWeight : 0;
      score += normalizedTimeWeight * (strategy === 'hot' ? 10 : 15) * dm.timeDecay;
      if (dm.timeDecay > 0) dims.timeDecay = normalizedTimeWeight * (strategy === 'hot' ? 10 : 15) * dm.timeDecay;
      
      // 热号策略维度5: 5小区动态趋势强化（提升至20分满分）+ 重号因子优化
      if (strategy === 'hot') {
        // 维度5a: 5小区动态趋势加分（15分满分，替代原热区趋势10分）
        // 数据支撑：85.4%只有3-4个小区出号，连续不出2期后100%回归
        // must(连续不出≥3期): +15分 - 胆码必从必出区选
        // very_likely(连续不出≥2期): +12分 - 极可能出号的区
        // likely_warm(不出1期): +7分 - 有回归信号(约70%概率)
        // warming(刚出+升温≥1.2): +3分 - 可能继续出号
        // normal: +0分 - 正常概率
        // unlikely_cool(上期出+降温): -3分 - 该区可能不出号
        const zone5 = getZone5(num);
        const prediction = zone5Prediction[zone5];
        let baseTrendScore = 0;
        
        if (prediction === 'must') {
          baseTrendScore = 15; // 必出区，最高信任度
        } else if (prediction === 'very_likely') {
          baseTrendScore = 12; // 高概率区
        } else if (prediction === 'likely_warm') {
          baseTrendScore = 7;  // 温区
        } else if (prediction === 'warming') {
          baseTrendScore = 3;  // 升温中
        } else if (prediction === 'unlikely_cool') {
          baseTrendScore = -3; // 冷却区，扣分
        }
        score += baseTrendScore * dm.zone5Trend;
        dims.zone5Trend = baseTrendScore * dm.zone5Trend;
        
        // 维度5b: 必出区额外强化（+5分）
        if (prediction === 'must') {
          const mustBonus = 5 * dm.zone5Trend;
          score += mustBonus;
          dims.zone5Trend += mustBonus;
        }
        
        // 维度5c: 胆码重号降温（最多扣2分，从3分降低）
        // 胆码是"必须命中"位置，上期出现的号码在出概率约30-40%(约1.5个)
        // 适度降温避免过度集中，但不过度惩罚，因为重号本身也是强信号
        if (lastDraw && lastDraw.front.includes(num)) {
          // 降温幅度取决于近期重号环境：
          // 高重号周期(>2.0)→降温更多(-2)，说明重号已偏多，回归概率大
          // 低重号周期(<1.0)→轻微降温(-1)，重号可能反弹但胆码不应过度集中
          // 正常周期→中等降温(-1.5)
          const coolingPenaltyVal = recent10RepeatRate > 2.0 ? 2 : recent10RepeatRate < 1.0 ? 1 : 1.5;
          const repeatPenalty = coolingPenaltyVal * dm.repeatCooling;
          score -= repeatPenalty;
          dims.repeatCooling = -repeatPenalty;
        }
      } else if (strategy === 'balanced') {
      // 均衡策略维度5: 频率趋势(10分) + 5小区动态趋势(10分) = 20分
        const freqRate = frontFreqRates[num] || 0;
        const freqTrendMax = 10;
        if (freqRate > frontExpectedRate && maxFrontFreqRate > frontExpectedRate) {
          const normalizedTrend = (freqRate - frontExpectedRate) / (maxFrontFreqRate - frontExpectedRate);
          score += normalizedTrend * freqTrendMax * dm.freqTrend;
        }
        
        // 均衡策略：5小区动态趋势（10分满分）
        const zone5 = getZone5(num);
        const prediction = zone5Prediction[zone5];
        if (prediction === 'must') {
          score += 10 * dm.zone5Trend;
        } else if (prediction === 'very_likely') {
          score += 7 * dm.zone5Trend;
        } else if (prediction === 'likely_warm') {
          score += 3 * dm.zone5Trend;
        } else if (prediction === 'warming') {
          score += 1 * dm.zone5Trend;
        } else if (prediction === 'unlikely_cool') {
          score -= 2 * dm.zone5Trend;
        }
      } else {
      // 保守策略维度5（改进1）：频率趋势降至7分 + 5小区动态趋势降至7分 = 14分
      // 保守更谨慎对待趋势预测，减少追逐热号
        const freqRate = frontFreqRates[num] || 0;
        const freqTrendMax = 7;
        if (freqRate > frontExpectedRate && maxFrontFreqRate > frontExpectedRate) {
          const normalizedTrend = (freqRate - frontExpectedRate) / (maxFrontFreqRate - frontExpectedRate);
          score += normalizedTrend * freqTrendMax * dm.freqTrend;
        }
        
        // 保守策略：5小区动态趋势（7分满分）
        const zone5 = getZone5(num);
        const prediction = zone5Prediction[zone5];
        if (prediction === 'must') {
          score += 7 * dm.zone5Trend;
        } else if (prediction === 'very_likely') {
          score += 4 * dm.zone5Trend;
        } else if (prediction === 'likely_warm') {
          score += 2 * dm.zone5Trend;
        } else if (prediction === 'warming') {
          score += 1 * dm.zone5Trend;
        } else if (prediction === 'unlikely_cool') {
          score -= 1 * dm.zone5Trend;
        }
      }
      
      // 热号策略维度6: 动量加速度加分（5分满分）
      // 近5期频率/5 > 近15期频率/15 → 动量正在加速 → 加分
      if (strategy === 'hot') {
        const veryRecentRate = (veryRecentFrontFreq[num] || 0) / veryRecentCount;
        const mediumRecentRate = (recentFreq.front[num] || 0) / recentFreq.recentCount;
        const acceleration = veryRecentRate - mediumRecentRate;
        if (acceleration > 0 && maxAcceleration > 0) {
          const momentumScore = (acceleration / maxAcceleration) * 5 * dm.momentum;
          score += momentumScore;
          dims.momentum = momentumScore;
        }
      }
      
      // 热号策略维度7: 冷却惩罚（最多扣5分）
      // 高频号（历史频率 > 平均）且当前遗漏 > 平均遗漏 → 正在冷却 → 扣分
      if (strategy === 'hot') {
        const numFreq = frontCounter[String(num)] || frontCounter[num] || 0;
        if (numFreq > avgFreqPerNum && currentOmission > avgFrontOmission) {
          const coolingDegree = (currentOmission - avgFrontOmission) / avgFrontOmission;
          const freqHeat = numFreq / avgFreqPerNum;
          const penalty = Math.min(coolingDegree * freqHeat * 2, 5);
          score -= penalty * dm.coolingPenalty;
        }
      }
      
      // 维度8: 区间饱和度调节（所有策略，均值回归信号）
      // 近10期某区频率远超理论期望 → 该区可能即将冷却 → 区内号码扣分
      // 近10期某区频率低于理论期望 → 该区可能即将恢复 → 区内号码加分
      // 捕捉均值回归：212期区7近10期出6次(远超理论3.57次)，但212期区7完全没号
      // 热号策略满分±5分，均衡±3分，保守±2分
      {
        const expectedZoneFreqPerPeriod = 5 / 7; // 5个前区号/期，7个区，理论≈0.71个/区/期
        const expectedZoneFreq = expectedZoneFreqPerPeriod * veryRecentCount;
        const zoneRecentFreqNum = recentZone7Freq[zone7] || 0;
        const zoneSatMax = strategy === 'hot' ? 5 : strategy === 'balanced' ? 3 : 2;
        if (zoneRecentFreqNum < expectedZoneFreq * 0.7) {
          const recoveryBonus = Math.min((expectedZoneFreq - zoneRecentFreqNum) / expectedZoneFreq * zoneSatMax, zoneSatMax);
          const zoneSatScore = recoveryBonus * (dm.zoneSaturation || 0);
          score += zoneSatScore;
          if (dm.zoneSaturation > 0) dims.zoneSaturation = zoneSatScore;
        } else if (zoneRecentFreqNum > expectedZoneFreq * 1.5) {
          const overheatPenalty = Math.min((zoneRecentFreqNum - expectedZoneFreq) / expectedZoneFreq * (zoneSatMax * 0.6), zoneSatMax * 0.6);
          const zoneSatScore = -overheatPenalty * (dm.zoneSaturation || 0);
          score += zoneSatScore;
          if (dm.zoneSaturation > 0) dims.zoneSaturation = zoneSatScore;
        }
      }
      
      // 维度9: 历史形态相似度加成（所有策略）
      // 热号5分满分，均衡3分(0.5×6)，保守3分(0.5×6)
      {
        const similarityBonus = HistoricalSimilarity.computeNumberSimilarityBonus(
          num, true, [], [], activeData
        );
        const simMax = strategy === 'hot' ? 5 : 6; // 均衡/保守满分6分(乘0.5=3分实际)
        const simScore = similarityBonus * simMax * (dm.historicalSimilarity || 0);
        score += simScore;
        if (dm.historicalSimilarity > 0) dims.historicalSimilarity = simScore;
      }
      
      // 维度10: 连号协同加分（热号5分/均衡5分/保守3分满分）
      // 历史数据：约50%的开奖期有至少1对连号(如06-07、02-03、25-26)
      // 如果号码的相邻号码(±1,±2)也是统计强号，增加该号码的连号潜力加分
      // 选择有连号潜力的号码作为胆码，与邻居形成连号组合，增加命中概率
      // 保守策略(3胆)降低连号权重，避免过度依赖连号模式
      const consecutiveNeighbors = [num - 1, num + 1, num - 2, num + 2]
        .filter(n => n >= 1 && n <= CONFIG.FRONT_RANGE && n !== num);
      let consecutiveBonus = 0;
      for (const neighbor of consecutiveNeighbors) {
        const neighborFreq = frontCounter[String(neighbor)] || frontCounter[neighbor] || 0;
        const neighborCondProb = conditionalProb.front[neighbor] || 0;
        const neighborOmission = omissionData.front[neighbor] || 0;
        // 近邻(±1)权重更高，远邻(±2)权重更低
        const isAdjacent = Math.abs(neighbor - num) === 1;
        const weight = isAdjacent ? 1.0 : 0.5;
        // 频率高于平均 → 邻居是强号 → 连号协同加分
        if (neighborFreq > avgFreqPerNum) consecutiveBonus += weight * 1.5;
        // 条件概率高于50%最大值 → 邻居依赖性强 → 连号协同加分
        if (neighborCondProb > maxCondProb * 0.5) consecutiveBonus += weight * 1.5;
        // 遗漏低于平均 → 近期出现过 → 连号协同概率更高
        if (neighborOmission < avgFrontOmission) consecutiveBonus += weight * 1.0;
      }
      const consecutiveMax = strategy === 'hot' ? 5 : strategy === 'balanced' ? 5 : 3;
      const consecutiveScore = Math.min(consecutiveBonus, consecutiveMax) * dm.consecutive;
      score += consecutiveScore;
      if (dm.consecutive > 0) dims.consecutive = consecutiveScore;

      scored.push({
        number: num,
        score,
        dims, // 维度分解
        zone5: getZone5(num),
        zone7: zone7,
        zone5Prediction: zone5Prediction[getZone5(num)],
        zone5Absence: zone5Absence[getZone5(num)],
        condProb,
        omission: currentOmission,
        freq,
        timeWeight: normalizedTimeWeight,
        isRepeat: lastDraw ? lastDraw.front.includes(num) : false,
        isCooling: strategy === 'hot' && freq > avgFreqPerNum && currentOmission > avgFrontOmission
      });
    }
    
    // 所有策略：区间防极端惩罚（最多扣3分）- 必须在所有号码评分完成后统一计算
    // 防止在循环内部基于不完整的scored数组计算，导致评分不公平
    // 热号扣3分，均衡扣2分(需zoneAntiExtreme=1但新配置没有这个key...), 保守扣2分
    // 212期教训：胆码31,34都落在区7，导致0命中
    scored.sort((a, b) => b.score - a.score);
    const top12ZoneCounts = {};
    for (let z = 1; z <= 7; z++) top12ZoneCounts[z] = 0;
    scored.slice(0, 12).forEach(s => top12ZoneCounts[getZone7(s.number)]++);
    // 对所在区在Top12中占比>=4的号码统一扣分
    const antiExtremeMax = strategy === 'hot' ? 3 : 2; // 均衡/保守扣2分
    // 均衡/保守defaultMultipliers中没有zoneAntiExtreme，用1作为默认
    const zoneAntiExtremeValue = dm.zoneAntiExtreme !== undefined ? dm.zoneAntiExtreme : 1;
    for (const s of scored) {
      const zone7Num = getZone7(s.number);
      if (top12ZoneCounts[zone7Num] >= 4) {
        s.score -= antiExtremeMax * zoneAntiExtremeValue;
      }
    }

    // 根据策略调整候选池
    scored.sort((a, b) => b.score - a.score);
    
    // 热号策略：不添加评分扰动，完全确定性选择
    // 扰动会改变Top4排名，导致高评分号码被跳过，破坏预测模型的有效性
    // 其他策略保留微小扰动保持多样性
    if (strategy !== 'hot') {
      const scoredRange = Math.max(...scored.map(s => s.score)) - Math.min(...scored.map(s => s.score));
      const scoredPerturbation = scoredRange * 0.05;
      for (const s of scored) {
        s.score += (Math.random() - 0.5) * scoredPerturbation * 2;
      }
      scored.sort((a, b) => b.score - a.score);
    }
    
    let candidatePool;
    if (strategy === 'hot') {
      // 热号策略：从Top15中选
      candidatePool = scored.slice(0, 15);
    } else if (strategy === 'balanced') {
      // 均衡策略：从Top15中选
      candidatePool = scored.slice(0, 15);
    } else {
      // 保守策略：偏向遗漏回归号码（高遗漏+中等频率），而非简单跳过Top3
      // 遗漏回归号码更容易出现，降低热号集中风险
      candidatePool = scored.filter(s => {
        const omissionDeviation = (s.omission || 0) - avgFrontOmission;
        // 条件1：遗漏高于均值（冷号回归信号）
        // 条件2：或遗漏适中但评分中上（中等号稳妥选择）
        return omissionDeviation > 0 || (omissionDeviation >= -avgFrontOmission * 0.3 && s.score > scored[0].score * 0.6);
      }).slice(0, 15);
      // 如果过滤后候选不足，从Top20中补充
      if (candidatePool.length < danCount + 3) {
        const extras = scored.filter(s => !candidatePool.includes(s)).slice(0, 15 - candidatePool.length);
        candidatePool.push(...extras);
      }
    }
    
// V6: 热号策略群体组合优化 - 从Top8枚举最优4号组合
// 个体评分只考虑单号统计特征，群体优化考虑：和值、AC值、区间分布
// 数据支撑：双色球5号和值集中在60-140，4胆部分和55-90
    const selected = [];
    if (strategy === 'hot') {
      const topCandidates = [...candidatePool].sort((a, b) => b.score - a.score).slice(0, 8);
      
      // 枚举C(8,4)组合，带区间约束(同区最多2个)
      const validCombos = [];
      for (let i = 0; i < topCandidates.length; i++) {
        for (let j = i + 1; j < topCandidates.length; j++) {
          for (let k = j + 1; k < topCandidates.length; k++) {
            for (let l = k + 1; l < topCandidates.length; l++) {
              const combo = [topCandidates[i], topCandidates[j], topCandidates[k], topCandidates[l]];
              const zoneCounts = {};
              for (const c of combo) {
                const z = getZone7(c.number);
                zoneCounts[z] = (zoneCounts[z] || 0) + 1;
              }
              if (Math.max(...Object.values(zoneCounts)) <= 2) {
                validCombos.push({ combo, zoneCounts });
              }
            }
          }
        }
      }
      
      // 对每个有效组合评分
      let bestCombo = null;
      let bestGroupScore = -Infinity;
      let bestBreakdown = null;
      
      for (const { combo, zoneCounts } of validCombos) {
        // A: 个体评分总和（主维度）
        const individualSum = combo.reduce((s, c) => s + c.score, 0);
        
        // B: 和值适配度 - 4胆部分和典型55-90，期望72
        const comboSum = combo.reduce((s, c) => s + c.number, 0);
        let sumBonus = 0;
        if (comboSum >= 55 && comboSum <= 90) {
          sumBonus = 5 - Math.abs(comboSum - 72) * 0.1;
        } else if (comboSum >= 45 && comboSum <= 100) {
          sumBonus = 1;
        } else {
          sumBonus = -3;
        }
        
        // C: AC值 - AC=差异数-(n-1)，典型3-6，AC>=3加分
        const diffs = [];
        for (let a = 0; a < combo.length; a++) {
          for (let b = a + 1; b < combo.length; b++) {
            diffs.push(Math.abs(combo[a].number - combo[b].number));
          }
        }
        const distinctDiffs = new Set(diffs).size;
        const acValue = distinctDiffs - 3;
        const acBonus = acValue >= 3 ? 5 : acValue >= 2 ? 2 : 0;
        
        // D: 区间分布 - 覆盖4+区间加分
        const zonesCovered = Object.keys(zoneCounts).length;
        const spreadBonus = zonesCovered >= 4 ? 4 : zonesCovered >= 3 ? 2 : -2;
        
        // E: 遗漏多样性 - 避免过度集中在刚出过的号码(遗漏=0)
        let omissionPenalty = 0;
        const zeroOmissionCount = combo.filter(c => c.omission === 0).length;
        if (zeroOmissionCount >= 3) {
          omissionPenalty = -5; // 3个以上遗漏=0，大幅扣分
        } else if (zeroOmissionCount === 2) {
          omissionPenalty = -2; // 2个遗漏=0，轻微扣分
        }
        // 检查遗漏值是否过于集中(都在0-5之间)
        const lowOmissionCount = combo.filter(c => c.omission <= 5).length;
        if (lowOmissionCount === 4) {
          omissionPenalty -= 2; // 全部是近5期号码，额外扣分
        }
        
        const groupScore = individualSum + sumBonus + acBonus + spreadBonus + omissionPenalty;
        
        if (groupScore > bestGroupScore) {
          bestGroupScore = groupScore;
          bestCombo = combo;
          bestBreakdown = { individualSum, sumBonus, acBonus, spreadBonus, omissionPenalty, comboSum, acValue, zonesCovered };
        }
      }
      
      // 回退：无有效组合时简单Top4+区间约束
      if (!bestCombo) {
        const hotPool = [...candidatePool].sort((a, b) => b.score - a.score);
        const fallbackZoneCount = {};
        for (let z = 1; z <= 7; z++) fallbackZoneCount[z] = 0;
        for (const candidate of hotPool) {
          if (selected.length >= danCount) break;
          const zone7Num = getZone7(candidate.number);
          if ((fallbackZoneCount[zone7Num] || 0) < 2) {
            selected.push(candidate.number);
            fallbackZoneCount[zone7Num]++;
          }
        }
        if (selected.length < danCount) {
          for (const candidate of hotPool) {
            if (selected.length >= danCount) break;
            if (!selected.includes(candidate.number)) selected.push(candidate.number);
          }
        }
      } else {
        for (const c of bestCombo) selected.push(c.number);
      }
      
      if (bestBreakdown) {
        console.log(`  🧩 群体优化(V6.1): 和值${bestBreakdown.comboSum}(适配+${bestBreakdown.sumBonus.toFixed(1)}分) AC=${bestBreakdown.acValue}(加+${bestBreakdown.acBonus}分) 区间覆盖${bestBreakdown.zonesCovered}(加+${bestBreakdown.spreadBonus}分) 遗漏惩罚${bestBreakdown.omissionPenalty} 个体总分${bestBreakdown.individualSum.toFixed(1)} 群体总分${bestGroupScore.toFixed(1)}`);
      }
    } else {
      // 均衡/保守策略：基于7小区动态频率占比采样
      const minScore = Math.min(...candidatePool.map(s => s.score));
      const maxScore = Math.max(...candidatePool.map(s => s.score));
      const scoreRange = maxScore - minScore;
      const weights = candidatePool.map(s => {
        const normalized = scoreRange > 0 ? (s.score - minScore) / scoreRange : 0.5;
        const perturbation = (Math.random() - 0.5) * 0.2;
        return { ...s, sampleWeight: 0.1 + (normalized + perturbation) * 0.9 };
      });
      
      // 按分数排序
      const sortedByScore = [...weights].sort((a, b) => b.score - a.score);
      const remaining = [...weights];
      
      // 均衡/保守策略：基于7小区动态频率占比采样（取消3大区强制覆盖）
      const zone7Groups = {};
      for (let z = 1; z <= 7; z++) zone7Groups[z] = remaining.filter(w => getZone7(w.number) === z);
      const zone7Sorted = Object.entries(zone7Groups)
        .map(([z, candidates]) => ({
          zone: parseInt(z),
          candidates,
          totalWeight: candidates.reduce((s, w) => s + w.sampleWeight, 0),
          freqRatio: zone7RecentFreq[parseInt(z)] / totalZone7RecentFreq
        }))
        .filter(z => z.candidates.length > 0)
        .sort((a, b) => b.freqRatio - a.freqRatio);
      
      const selectedZone7Count = {};
      for (let z = 1; z <= 7; z++) selectedZone7Count[z] = 0;
      
      const pickOneFromZone7 = (zoneInfo) => {
        const candidates = zoneInfo.candidates;
        if (candidates.length === 0) return null;
        const totalW = candidates.reduce((sum, w) => sum + w.sampleWeight, 0);
        let random = Math.random() * totalW;
        for (const w of candidates) {
          random -= w.sampleWeight;
          if (random <= 0) return w.number;
        }
        return candidates[0].number;
      };
      
      for (const zoneInfo of zone7Sorted) {
        if (selected.length >= danCount) break;
        if (selectedZone7Count[zoneInfo.zone] >= 2) continue;
        const num = pickOneFromZone7(zoneInfo);
        if (num) {
          selected.push(num);
          selectedZone7Count[zoneInfo.zone]++;
          zone7Sorted.forEach(zi => {
            zi.candidates = zi.candidates.filter(w => w.number !== num);
            zi.totalWeight = zi.candidates.reduce((s, w) => s + w.sampleWeight, 0);
          });
          const idx = remaining.findIndex(r => r.number === num);
          if (idx >= 0) remaining.splice(idx, 1);
        }
      }
      
      // 如果还需更多胆码，从剩余号码中加权随机选
      while (selected.length < danCount && remaining.length > 0) {
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
    }
    
    // === 后处理：仅均衡/保守策略，热号策略完全信任评分模型 ===
    // 热号策略移除所有后处理（遗漏多样性、连号注入、小号注入、奇偶平衡）
    // 因为这些后处理会替换高评分号码为低评分号码，破坏预测有效性
    // 例如：Top4选择[15,29,31,34]，后处理用#3替换#15，但#3不在Top5中
    if (strategy !== 'hot') {
      // 均衡/保守策略：保留遗漏多样性约束
      if (danCount >= 4) {
        const selectedOmissions = selected.map(n => omissionData.front[n] || 0);
        const allBelowAvg = selectedOmissions.every(o => o <= avgFrontOmission);
        if (allBelowAvg) {
          const moderateOmissionCandidates = scored
            .filter(s => !selected.includes(s.number) && (s.omission || 0) > avgFrontOmission)
            .sort((a, b) => b.score - a.score);
          if (moderateOmissionCandidates.length > 0) {
            const worstSelected = selected
              .map(n => ({ num: n, score: scored.find(s => s.number === n)?.score || 0 }))
              .sort((a, b) => a.score - b.score)[0];
            selected[selected.indexOf(worstSelected.num)] = moderateOmissionCandidates[0].number;
          }
        }
      }
    }

    // 计算概率排名信息（基于全量35号码）
    const allWeights = scored.map(s => {
      const allMinScore = Math.min(...scored.map(s2 => s2.score));
      const allScoreRange = Math.max(...scored.map(s2 => s2.score)) - allMinScore;
      const normalized = allScoreRange > 0 ? (s.score - allMinScore) / allScoreRange : 0.5;
      return { number: s.number, weight: 0.05 + normalized * 0.95 };
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
        zone7: originalScore ? originalScore.zone7 : 0,
        condProb: originalScore ? originalScore.condProb : 0,
        omission: originalScore ? originalScore.omission : 0,
        freq: originalScore ? originalScore.freq : 0
      };
    });
    
    // 计算7区频率排名（供UI显示）
    const zoneNames = ['一区(01-05)', '二区(06-10)', '三区(11-15)', '四区(16-20)', '五区(21-25)', '六区(26-30)', '七区(31-35)'];
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
    // 按频率排序
    const zoneRank = Object.entries(zoneFrequencies)
      .sort((a, b) => b[1] - a[1])
      .map(([zone, freq], idx) => ({ zone: parseInt(zone), name: zoneNames[parseInt(zone) - 1], freq, rank: idx + 1 }));
    const zoneInfo = zoneRank.map(z => `${z.name}:${z.freq}次(第${z.rank}名)`).join('、');
    
    const selectionMethod = strategy === 'hot' ? '群体组合优化(V6)' : '加权随机采样';
    console.log('✅ 前区胆码推荐完成:', selected.sort((a, b) => a - b));
    console.log('  实际选择:', selected.map(n => `#${n}`).join(', '), `(${selectionMethod})`);
    console.log('  Top5概率排名:', probabilityInfo.map(p => 
      `#${p.number}(概率${p.probability.toFixed(1)}%, 区${p.zone7}, 条件概率${p.condProb.toFixed(3)}, 遗漏${p.omission}, 频率${p.freq}, 总分${p.score.toFixed(2)})`
    ).join(', '));
    
    // 维度分解日志：显示Top5各号码的评分来源
    if (strategy === 'hot') {
      const top5Scored = scored.slice(0, 5);
      console.log('  📊 维度分解(V5权重):', top5Scored.map(s => {
        const d = s.dims || {};
        const parts = [];
        if (d.heatSignal) parts.push(`热${d.heatSignal.toFixed(1)}`);
        if (d.freqRatio) parts.push(`逆袭${d.freqRatio.toFixed(1)}`);
        if (d.conditionalProb) parts.push(`条件${d.conditionalProb.toFixed(1)}`);
        if (d.zone5Trend) parts.push(`区趋${d.zone5Trend.toFixed(1)}`);
        if (d.repeatCooling) parts.push(`重号${d.repeatCooling.toFixed(1)}`);
        if (d.momentum) parts.push(`动量${d.momentum.toFixed(1)}`);
        if (d.zoneSaturation) parts.push(`区饱${d.zoneSaturation.toFixed(1)}`);
        return `#${s.number}(${parts.join('+')})`;
      }).join(', '));
    }
    
    console.log('  区间频率排名:', zoneInfo);
    
    return {
      selected: selected.sort((a, b) => a - b),
      probabilityInfo: probabilityInfo,
      zoneInfo: zoneInfo
    };
  }
}