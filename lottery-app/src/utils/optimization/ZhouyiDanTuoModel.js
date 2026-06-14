/**
 * 周易时空胆拖推荐模型
 * 核心特色：卦象计算+时辰映射+开奖日特征
 * 不修改现有优化器，作为独立的辅助推荐模型
 */

import { CONFIG } from '../core/Config.js';

export class ZhouyiDanTuoModel {

  /**
   * 推荐前区胆码+拖码
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {number} danCount - 胆码数量(2-4)
   * @param {string} strategy - 策略: hot/balanced/conservative
   * @returns {Object} { danSelected, tuoSelected, probabilityInfo, description }
   */
  static recommendFront(analyzer, danCount = 3, strategy = 'balanced') {
    console.log('🧭 周易时空胆拖推荐（前区）- 样本量：近30期');

    const now = new Date();
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();
    const correlation = analyzer.correlationAnalyzer.calculateNumberCorrelation();
    const activeData = analyzer.getActiveData();

    if (activeData.length === 0) {
      return { danSelected: [], tuoSelected: [], probabilityInfo: [], description: '数据不足' };
    }

    // ========== 样本量控制：统一使用近30期数据 ==========
    const recentData = activeData.slice(-30); // 近30期数据

    // 计算近30期前区频率
    const recentFrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) recentFrontFreq[i] = 0;
    for (const draw of recentData) {
      for (const num of draw.front) recentFrontFreq[num]++;
    }

    // 1. 获取时间要素
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const weekday = now.getDay();

    // 2. 计算距离下次开奖的天数（周一三六开奖）
    const drawDays = [1, 3, 6];
    let daysToNextDraw = 7;
    let nextDrawDay = 1;
    for (const drawDay of drawDays) {
      let diff = drawDay - weekday;
      if (diff <= 0) diff += 7; // 已过的开奖日，算到下周
      if (diff === 0 && hour >= 20) diff = 7; // 当天20点后算下期
      if (diff < daysToNextDraw) {
        daysToNextDraw = diff;
        nextDrawDay = drawDay;
      }
    }

    // 3. 计算卦象（与ZhouyiSpaceTime模型一致）
    const upperTrigram = (year + month + day) % 8;
    const lowerTrigram = (year + month + day + hour + minute) % 8;
    const movingLine = (year + month + day + hour + minute + second + daysToNextDraw) % 6;

    // 卦象元素映射
    const trigramElements = {
      0: [1, 8, 15, 22, 29],
      1: [2, 9, 16, 23, 30],
      2: [3, 10, 17, 24, 31],
      3: [4, 11, 18, 25, 32],
      4: [5, 12, 19, 26, 33],
      5: [6, 13, 20, 27, 34],
      6: [7, 14, 21, 28, 35],
      7: [1, 9, 17, 25, 33]
    };

    const poolUpper = trigramElements[upperTrigram] || [];
    const poolLower = trigramElements[lowerTrigram] || [];
    const combinedPool = [...new Set([...poolUpper, ...poolLower])];

    // 补充动爻相关号码
    if (combinedPool.length < CONFIG.FRONT_COUNT) {
      const movingLineNumbers = [
        movingLine + 1, movingLine + 6, movingLine + 11,
        movingLine + 16, movingLine + 21, movingLine + 26, movingLine + 31
      ].filter(n => n >= 1 && n <= CONFIG.FRONT_RANGE);
      combinedPool.push(...movingLineNumbers);
    }

    // 4. 开奖日特征：基于近30期数据统计目标开奖日的前区频率分布
    const drawDayCycle = [1, 3, 6];
    const drawDayToCyclePos = { 1: 0, 3: 1, 6: 2 };
    const targetCyclePos = drawDayToCyclePos[nextDrawDay];
    const totalDraws = recentData.length; // 近30期期数
    const weekdayOffset = ((targetCyclePos - totalDraws % 3) + 3) % 3;

    // 统计目标开奖日的近30期前区频率分布
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

    // 5. 构建周易时空融合权重（基于近30期频率）
    const maxFreq = Math.max(...Object.values(recentFrontFreq), 0);
    const zhouyiFrontWeights = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      const isInPool = combinedPool.includes(i);
      const freqWeight = isInPool ? ((recentFrontFreq[i] || 0) + 1) * 2 / (maxFreq + 1) * 10 : 1; // 近30期频率归一化
      const condBonus = (conditionalProb.front[i] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence * 8;

      let corrBonus = 0;
      if (correlation.front[i]) {
        const correlations = Object.values(correlation.front[i]);
        if (correlations.length > 0) {
          corrBonus = correlations.reduce((sum, c) => sum + c, 0) / correlations.length * 0.1;
        }
      }

      const scienceBonus = isInPool ? 0 : (conditionalProb.front[i] || 0) * CONFIG.CONDITIONAL_WEIGHT * conditionalProb.confidence * 3;

      // 开奖日特征加成（核心特色维度）
      const weekdayFreqNum = weekdayFrontFreq[i] || 0;
      const weekdayBonus = maxWeekdayFreq > 0 ? (weekdayFreqNum / maxWeekdayFreq) * 3 : 0;

      zhouyiFrontWeights[i] = freqWeight + condBonus + corrBonus + scienceBonus + weekdayBonus;
    }

    // 6. 确定性推荐：直接选择评分最高的号码作为胆码
    const sortedWeights = Object.entries(zhouyiFrontWeights)
      .sort((a, b) => b[1] - a[1]);

    const candidateSize = strategy === 'hot' ? 10 : strategy === 'balanced' ? 15 : 20;
    const candidatePool = sortedWeights.slice(0, candidateSize).map(([num, weight]) => ({
      number: Number(num), weight
    }));

    // 胆码：确定性推荐（直接取评分最高）
    const danSelected = candidatePool.slice(0, danCount).map(c => c.number);

    // 7. 拖码：确定性推荐（按评分排序取剩余号码）
    const tuoAll = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
      .filter(n => !danSelected.includes(n));
    const tuoCandidates = tuoAll.map(n => ({
      number: n, weight: zhouyiFrontWeights[n] || 1
    })).sort((a, b) => b.weight - a.weight);

    // 拖码数量：根据胆码数量动态调整
    const tuoCount = 15 - danCount;
    const tuoSelected = tuoCandidates.slice(0, tuoCount).map(c => c.number);

    // 卦象信息
    const trigramNames = ['乾', '兑', '离', '震', '巽', '坎', '', '坤'];
    const upperName = trigramNames[upperTrigram];
    const lowerName = trigramNames[lowerTrigram];
    const drawDayNames = { 1: '周一', 3: '周三', 6: '周六' };
    const nextDrawDayName = drawDayNames[nextDrawDay] || '未知';

    // 概率排名信息（基于Top5号码的评分）
    const probabilityInfo = sortedWeights.slice(0, 5).map(([num, weight], idx) => {
      return {
        number: Number(num),
        probability: weight,
        rank: idx + 1,
        score: weight
      };
    });

    console.log('✅ 周易时空前区推荐完成 - 胆码:', danSelected.sort((a, b) => a - b),
      `卦象:${upperName}/${lowerName}, 开奖日:${nextDrawDayName}`);

    return {
      danSelected: danSelected.sort((a, b) => a - b),
      tuoSelected: tuoSelected.sort((a, b) => a - b),
      probabilityInfo,
      trigramInfo: { upper: upperName, lower: lowerName, movingLine },
      nextDrawDay: nextDrawDayName,
      description: `周易时空模型：${upperName}${lowerName}卦+动爻${movingLine+1}，下次开奖${nextDrawDayName}，卦象池+时辰映射+开奖日频率`,
      recommendType: '确定性推荐'
    };
  }

  /**
   * 推荐后区胆码+拖码
   */
  static recommendBack(analyzer, backDanCount = 1) {
    const now = new Date();
    const hour = now.getHours();
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();

    // ========== 样本量控制：统一使用近30期数据 ==========
    const activeData = analyzer.getActiveData();
    const recentData = activeData.slice(-30);

    // 计算近30期后区频率
    const recentBackFreq = {};
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) recentBackFreq[i] = 0;
    for (const draw of recentData) {
      for (const num of draw.back) recentBackFreq[num]++;
    }

    // 时辰候选映射（与ZhouyiSpaceTime模型一致）
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

    // 开奖日特征（基于近30期数据）
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

    const drawDayCycle = [1, 3, 6];
    const drawDayToCyclePos = { 1: 0, 3: 1, 6: 2 };
    const targetCyclePos = drawDayToCyclePos[nextDrawDay];
    const totalDraws = recentData.length;
    const weekdayOffset = ((targetCyclePos - totalDraws % 3) + 3) % 3;

    // 统计目标开奖日的近30期后区频率
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

    const maxBackFreq = Math.max(...Object.values(recentBackFreq), 0);
    const expandedBackWeights = {};
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
      const isTimeCandidate = backCandidates.includes(i);
      const timeWeight = isTimeCandidate ? 2.0 : 0.5;
      const freqWeight = ((recentBackFreq[i] || 0) + 1) / (maxBackFreq + 1) * 10; // 近30期频率归一化
      const condWeight = (conditionalProb.back[i] || 0) * CONFIG.BACK_CONDITIONAL_WEIGHT * conditionalProb.confidence * 8;
      const weekdayFreqNum = weekdayBackFreq[i] || 0;
      const weekdayBonus = maxWeekdayBackFreq > 0 ? (weekdayFreqNum / maxWeekdayBackFreq) * 3 : 0;
      expandedBackWeights[i] = timeWeight * freqWeight + condWeight + weekdayBonus;
    }

    const allCandidates = Object.entries(expandedBackWeights)
      .sort((a, b) => b[1] - a[1])
      .map(([num, weight]) => ({ number: Number(num), weight }));

    // 后区胆码：确定性推荐（直接取评分最高）
    const danSelected = allCandidates.slice(0, backDanCount).map(c => c.number);

    // 后区拖码：确定性推荐（按评分排序取前4个）
    const tuoAll = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
      .filter(n => !danSelected.includes(n))
      .sort((a, b) => (expandedBackWeights[b] || 0) - (expandedBackWeights[a] || 0));
    const tuoSelected = tuoAll.slice(0, 4);

    const drawDayNames = { 1: '周一', 3: '周三', 6: '周六' };

    return {
      danSelected: danSelected.sort((a, b) => a - b),
      tuoSelected: tuoSelected.sort((a, b) => a - b),
      nextDrawDay: drawDayNames[nextDrawDay],
      description: `周易时空后区推荐，时辰${hour}时+开奖日${drawDayNames[nextDrawDay]}`,
      recommendType: '确定性推荐'
    };
  }

  /**
   * 加权随机采样
   */
  static _weightedSample(candidates, count) {
    const minWeight = Math.min(...candidates.map(c => c.weight));
    const weightRange = Math.max(...candidates.map(c => c.weight)) - minWeight;

    const weighted = candidates.map(c => ({
      ...c,
      sampleWeight: 0.05 + (weightRange > 0 ? (c.weight - minWeight) / weightRange : 0.5) * 0.95
    }));

    const selected = [];
    const remaining = [...weighted];

    while (selected.length < count && remaining.length > 0) {
      const totalWeight = remaining.reduce((sum, w) => sum + w.sampleWeight, 0);
      let random = Math.random() * totalWeight;
      let chosenIdx = 0;
      for (let j = 0; j < remaining.length; j++) {
        random -= remaining[j].sampleWeight;
        if (random <= 0) { chosenIdx = j; break; }
      }
      if (chosenIdx >= remaining.length) chosenIdx = remaining.length - 1;
      selected.push(remaining[chosenIdx].number);
      remaining.splice(chosenIdx, 1);
    }

    return selected;
  }

  /**
   * 模型说明（优缺点）
   */
  static getDescription() {
    return {
      name: '周易时空',
      icon: '🧭',
      strengths: [
        '开奖日特征：利用周一/周三/周六的号码频率差异，是独立性强的新维度',
        '卦象映射：将日期时间转化为确定性号码池，每次推荐有时间独特性',
        '时辰映射：不同时间段对应不同的后区号码偏好',
        '动爻补充：卦象池不足时由动爻扩展，覆盖面更广',
        '融合科学维度：卦象外号码仍可凭条件概率获得补充权重'
      ],
      weaknesses: [
        '卦象映射基于模运算，本质是确定性伪随机，非真正统计规律',
        '开奖日频率统计依赖历史draw索引推算weekday，有偏移风险',
        '时辰映射对后区的分组过于固定（每组4个号码），灵活性低',
        '卦象号码池每次仅约10个，覆盖面有限',
        '周易理论与统计规律之间缺乏可验证的因果关联'
      ]
    };
  }
}