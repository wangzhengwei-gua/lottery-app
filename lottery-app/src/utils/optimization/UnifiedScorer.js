/**
 * 统一号码评分器 (UnifiedScorer)
 * 
 * 为胆拖/复式/单式三种玩法提供一致的base score，确保同一号码在不同玩法中
 * 评分基准统一，避免因评分管线不同导致推荐结果不一致。
 *
 * 5个归一化维度（每维0-100分）：
 * 1. frequencyScore  - 频率热度（近30期+全量加权）
 * 2. omissionScore    - 遗漏回归潜力（当前遗漏 vs 平均遗漏）
 * 3. momentumScore    - 趋势动量（近10期 vs 近30期频率变化率）
 * 4. zoneScore        - 区间分布（5小区动态趋势）
 * 5. correlationScore - 条件概率+关联性
 *
 * 策略权重调整：
 * - hot:        偏 frequency + momentum（追热号趋势）
 * - balanced:   五维均衡（综合判断）
 * - conservative: 偏 omission + zone（追冷号回归+区间补位）
 */

import { CONFIG } from '../core/Config.js';
import { computeZone5Prediction } from './ZonePrediction.js';

export class UnifiedScorer {

  /**
   * 策略权重配置
   * 每个维度的权重，总和不需要为1，会在内部归一化
   */
  static STRATEGY_WEIGHTS = {
    hot:          { frequency: 3.0, omission: 0.5, momentum: 2.5, zone: 1.0, correlation: 1.0 },
    balanced:     { frequency: 1.5, omission: 1.5, momentum: 1.5, zone: 1.5, correlation: 1.5 },
    conservative: { frequency: 0.8, omission: 3.0, momentum: 0.5, zone: 2.0, correlation: 1.0 },
  };

  /**
   * 对指定区域的所有号码进行统一评分
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {string} area - 'front' 或 'back'
   * @param {string} strategy - 'hot' | 'balanced' | 'conservative'
   * @returns {Array} 排序后的评分数组 [{ number, totalScore, dimensionScores, rank }]
   */
  static score(analyzer, area = 'front', strategy = 'hot') {
    const range = area === 'front' ? CONFIG.FRONT_RANGE : CONFIG.BACK_RANGE;
    const numbers = Array.from({ length: range }, (_, i) => i + 1);

    // 计算各维度原始分数
    const freqScores = UnifiedScorer._calcFrequencyScore(analyzer, area);
    const omissionScores = UnifiedScorer._calcOmissionScore(analyzer, area);
    const momentumScores = UnifiedScorer._calcMomentumScore(analyzer, area);
    const zoneScores = UnifiedScorer._calcZoneScore(analyzer, area);
    const corrScores = UnifiedScorer._calcCorrelationScore(analyzer, area);

    // 归一化每个维度到0-100
    const norm = (obj) => {
      const vals = Object.values(obj);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min;
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = range > 0 ? ((v - min) / range) * 100 : 50;
      }
      return result;
    };

    const normFreq = norm(freqScores);
    const normOmission = norm(omissionScores);
    const normMomentum = norm(momentumScores);
    const normZone = norm(zoneScores);
    const normCorr = norm(corrScores);

    // 策略权重
    const weights = UnifiedScorer.STRATEGY_WEIGHTS[strategy] || UnifiedScorer.STRATEGY_WEIGHTS.hot;
    const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);

    // 组装结果
    const results = numbers.map(num => {
      const dimensionScores = {
        frequency: normFreq[num] || 0,
        omission: normOmission[num] || 0,
        momentum: normMomentum[num] || 0,
        zone: normZone[num] || 0,
        correlation: normCorr[num] || 0,
      };

      const totalScore = (
        dimensionScores.frequency * weights.frequency +
        dimensionScores.omission * weights.omission +
        dimensionScores.momentum * weights.momentum +
        dimensionScores.zone * weights.zone +
        dimensionScores.correlation * weights.correlation
      ) / weightSum;

      return {
        number: num,
        totalScore: Math.round(totalScore * 10) / 10,
        dimensionScores,
      };
    });

    // 按总分降序排序
    results.sort((a, b) => b.totalScore - a.totalScore);
    results.forEach((r, i) => { r.rank = i + 1; });

    return results;
  }

  /**
   * 获取TopN号码
   * @param {Object} analyzer
   * @param {string} area
   * @param {string} strategy
   * @param {number} topN
   * @returns {number[]} 号码数组（已排序）
   */
  static getTopN(analyzer, area = 'front', strategy = 'hot', topN = 10) {
    return UnifiedScorer.score(analyzer, area, strategy)
      .slice(0, topN)
      .map(r => r.number);
  }

  /**
   * 加权随机采样（不重复）
   * 高分号码概率更高，低分号码也有机会
   * @param {Array} scoredResults - score()返回的结果数组
   * @param {number} count - 采样数量
   * @returns {number[]} 采样到的号码数组
   */
  static weightedSample(scoredResults, count) {
    const pool = [...scoredResults];
    const selected = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const weights = pool.map(r => Math.pow(r.totalScore, 2) + 1);
      const totalW = weights.reduce((a, b) => a + b, 0);
      let rand = Math.random() * totalW;
      let idx = 0;
      for (let j = 0; j < weights.length; j++) {
        rand -= weights[j];
        if (rand <= 0) { idx = j; break; }
        idx = j;
      }
      selected.push(pool[idx].number);
      pool.splice(idx, 1);
    }
    return selected.sort((a, b) => a - b);
  }

  // ==================== 维度计算方法 ====================

  /**
   * 维度1: 频率热度
   * 综合：全量频率(40%) + 近30期频率(60%)
   */
  static _calcFrequencyScore(analyzer, area) {
    const range = area === 'front' ? CONFIG.FRONT_RANGE : CONFIG.BACK_RANGE;
    const [allFront, allBack] = analyzer.frequencyAnalyzer.analyzeFrequency();
    const allCounter = area === 'front' ? allFront : allBack;

    const recentData = analyzer.frequencyAnalyzer.analyzeRecentFrequency(30);
    const recentCounter = area === 'front' ? recentData.front : recentData.back;

    const totalDraws = recentData.totalDraws || 1;
    const scores = {};

    for (let i = 1; i <= range; i++) {
      const allFreq = (allCounter[i] || allCounter[String(i)] || 0);
      const recentFreq = (recentCounter[i] || recentCounter[String(i)] || 0);
      // 全量频率归一化 + 近期频率归一化，加权
      const allRate = allFreq / (totalDraws || 1);
      const recentRate = recentFreq / (recentData.recentCount || 1);
      scores[i] = allRate * 0.4 + recentRate * 0.6;
    }
    return scores;
  }

  /**
   * 维度2: 遗漏回归潜力（综合模型）
   * 三段式评分，覆盖所有遗漏区间：
   * - 低遗漏(ratio<0.7): 持续热度信号，约40-50%开奖号来自此区间 → 中等偏高分
   * - 中等遗漏(ratio 0.7-1.3): 自然节奏区，约30%开奖号 → 中高分（接近平均值的号有基础回升）
   * - 高遗漏(ratio 1.3-3): 回归潜力最高 → 高分
   * - 过度遗漏(ratio>3): 可能真冷号 → 降温
   */
  static _calcOmissionScore(analyzer, area) {
    const range = area === 'front' ? CONFIG.FRONT_RANGE : CONFIG.BACK_RANGE;
    const omission = analyzer.omissionCalculator.calculateOmission();
    const areaOmission = omission[area];
    const avgOmission = analyzer.omissionCalculator.getAverageOmission(area);

    const scores = {};
    for (let i = 1; i <= range; i++) {
      const currentOmission = areaOmission[i] || 0;
      if (avgOmission === 0) {
        scores[i] = 50;
        continue;
      }

      const ratio = currentOmission / avgOmission;
      let score = 0;

      // 三段式评分
      if (ratio <= 0.3) {
        // 极低遗漏：近2-3期连续出现，持续热度强
        score = 55;
      } else if (ratio <= 0.7) {
        // 低遗漏：近期刚出现，有热度惯性
        score = 50 + (0.7 - ratio) / 0.4 * 5; // 50~55
      } else if (ratio <= 1.3) {
        // 中等遗漏：自然节奏区，接近平均值
        // 越接近1.0(完美平均值)加分越多
        const closeness = 1 - Math.abs(ratio - 1.0) / 0.3;
        score = 55 + closeness * 15; // 55~70
      } else if (ratio <= 1.5) {
        // 中高遗漏：开始进入回归区
        score = 70 + (ratio - 1.3) / 0.2 * 10; // 70~80
      } else if (ratio <= 3) {
        // 高遗漏：回归潜力最高
        score = 80 + (ratio - 1.5) / 1.5 * 15; // 80~95
      } else {
        // 过度遗漏：可能真冷号，降温
        score = Math.max(35, 95 - (ratio - 3) * 12);
      }

      scores[i] = score;
    }
    return scores;
  }

  /**
   * 维度3: 趋势动量
   * 近10期频率 vs 近30期频率的变化率
   * 正动量（升温）→ 热号策略加分
   */
  static _calcMomentumScore(analyzer, area) {
    const range = area === 'front' ? CONFIG.FRONT_RANGE : CONFIG.BACK_RANGE;
    const activeData = analyzer.getActiveData();

    const recent10Count = Math.min(10, activeData.length);
    const recent30Count = Math.min(30, activeData.length);

    const recent10 = activeData.slice(-recent10Count);
    const recent30 = activeData.slice(-recent30Count);

    const key = area === 'front' ? 'front' : 'back';
    const count10 = {};
    const count30 = {};
    for (let i = 1; i <= range; i++) { count10[i] = 0; count30[i] = 0; }

    for (const draw of recent10) {
      for (const num of draw[key]) count10[num]++;
    }
    for (const draw of recent30) {
      for (const num of draw[key]) count30[num]++;
    }

    const scores = {};
    for (let i = 1; i <= range; i++) {
      const rate10 = count10[i] / (recent10Count || 1);
      const rate30 = count30[i] / (recent30Count || 1);
      // 动量 = 近期变化率
      scores[i] = rate10 - rate30;
    }
    return scores;
  }

  /**
   * 维度4: 区间分布
   * 5小区动态趋势：该号码所在区间的趋势+遗漏预测
   */
  static _calcZoneScore(analyzer, area) {
    const range = area === 'front' ? CONFIG.FRONT_RANGE : CONFIG.BACK_RANGE;
    const activeData = analyzer.getActiveData();
    const scores = {};

    if (area === 'front') {
      // 前区5小区
      const getZone5 = (num) => Math.ceil(num / 7);
      const { zone5Absence, zone5Trend, zone5Prediction } = computeZone5Prediction(activeData, getZone5);

      for (let i = 1; i <= range; i++) {
        const zone = getZone5(i);
        let score = 50; // 基础分
        // 区间遗漏越大，该区间号码潜力越高
        score += Math.min(30, zone5Absence[zone] * 10);
        // 趋势>1表示升温
        if (zone5Trend[zone] > 1) {
          score += Math.min(15, (zone5Trend[zone] - 1) * 15);
        } else if (zone5Trend[zone] < 0.8) {
          score -= Math.min(10, (0.8 - zone5Trend[zone]) * 20);
        }
        scores[i] = score;
      }
    } else {
      // 后区4小区
      const getBackZone4 = (num) => Math.ceil(num / 3);
      const shortWindow = Math.min(10, activeData.length);
      const longWindow = Math.min(20, activeData.length);
      const recent10 = activeData.slice(-shortWindow);
      const recent20 = activeData.slice(-longWindow);

      for (let i = 1; i <= range; i++) {
        const zone = getBackZone4(i);
        let zoneAbsence = 0;
        for (let j = activeData.length - 1; j >= 0; j--) {
          if (activeData[j].back.some(n => getBackZone4(n) === zone)) break;
          zoneAbsence++;
        }
        let score = 50;
        score += Math.min(30, zoneAbsence * 10);
        scores[i] = score;
      }
    }
    return scores;
  }

  /**
   * 维度5: 条件概率+关联性
   * 基于马尔可夫转移矩阵，给定上期开奖号码后下期各号码出现概率
   */
  static _calcCorrelationScore(analyzer, area) {
    const range = area === 'front' ? CONFIG.FRONT_RANGE : CONFIG.BACK_RANGE;
    const condProb = analyzer.conditionalProbability.calculateConditionalProbability();
    const areaProb = condProb[area] || {};
    const confidence = condProb.confidence || 0;

    const scores = {};
    for (let i = 1; i <= range; i++) {
      // 条件概率 * 置信度
      scores[i] = (areaProb[i] || areaProb[String(i)] || 0) * confidence;
    }
    return scores;
  }
}
