/**
 * 后区胆码智能推荐优化器
 * 融合：条件概率 + 遗漏回归 + 时间衰减 + 频率 + 区间分布
 */

import { CONFIG } from '../core/Config.js';
import { computeZone4Prediction, formatZonePredictionLog } from './ZonePrediction.js';

export class BackDanOptimizer {
  /**
   * 优化后区胆码推荐（多维度智能评分）
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {number} backDanCount - 需要推荐的胆码数量
   * @returns {number[]} 推荐的后区胆码
   */
  static optimize(analyzer, backDanCount = 1, strategy = 'balanced', dimensionMultipliers = null) {
    console.log('🎯 后区胆码智能推荐（多维度评分）');
    
    // 维度权重倍率（策略差异化 + 遗漏σ分段归一化）
    // 热号：追趋势，条件概率1.2倍+4小区+重号+冷却惩罚全开
    // 均衡：少数强维度，条件概率+4小区主导，不加弱维度（与前区设计原则一致）
    // 保守：多维确认回归，遗漏回归0.8+条件概率降0.7+冷却惩罚0.3
    const defaultMultipliers = {
      hot: { conditionalProb: 1, omissionDeviation: 1, freqMomentum: 1, timeDecay: 1, freqTrend: 0, zone4Trend: 1, repeatFactor: 1, coolingPenalty: 1, zoneAntiExtreme: 0.5 },
      balanced: { conditionalProb: 1, omissionDeviation: 1, freqMomentum: 1, timeDecay: 1, freqTrend: 0, zone4Trend: 1, coolingPenalty: 0, zoneAntiExtreme: 1 },
      conservative: { conditionalProb: 0.8, omissionDeviation: 1, freqMomentum: 0.8, timeDecay: 0.5, freqTrend: 0, zone4Trend: 1, coolingPenalty: 0.2, zoneAntiExtreme: 1 }
    };
    const dm = dimensionMultipliers || defaultMultipliers[strategy];
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();
    const confidence = conditionalProb.confidence || 0.3;
    
    // 2. 获取遗漏数据
    const omissionData = analyzer.omissionCalculator.calculateOmission();
    const avgBackOmission = analyzer.omissionCalculator.getAverageOmission('back');
    const omissionStd = analyzer.omissionCalculator.getOmissionStd('back');
    
    // 3. 获取频率数据（全量 + 近期趋势动量）
    const [, backCounter] = analyzer.frequencyAnalyzer.analyzeFrequency();
    const maxFreq = Math.max(...Object.values(backCounter));
    const recentFreq = analyzer.frequencyAnalyzer.analyzeRecentFrequency();
    
    // 热号策略专用数据
    const repeatAnalysis = analyzer.trendAnalyzer.analyzeRepeatNumbers();
    const activeData = analyzer.getActiveData();
    const lastDraw = activeData.length > 0 ? activeData[activeData.length - 1] : null;
    
    // 4. 获取时间衰减权重（归一化到0-1范围）
    const rawTimeWeights = analyzer.calculateTimeDecayWeights();
    const maxBackTimeWeight = Math.max(...Object.values(rawTimeWeights.back));
    const timeWeights = {}; // 归一化后的权重
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
      timeWeights[i] = maxBackTimeWeight > 0 ? (rawTimeWeights.back[i] || 0) / maxBackTimeWeight : 0;
    }
    
    // 5. 预计算频率趋势数据（维度5需要）- 优化5：改用近20期频率而非全量频率
    // 近期频率更能反映当前冷热趋势，避免历史数据拖低正在升温号码的评分
    // 例如后区#1从历史17.4%升至近50期28.0%，全量频率会低估其当前热度
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

    // === 后区4小区动态趋势数据（改进4：使用共享ZonePrediction工具） ===
    // 4小区: 区1(1-3), 区2(4-6), 区3(7-9), 区4(10-12)
    // 数据支撑: 85.4%恰好2个4小区出号, 连续不出1期后96-100%回归
    const { backZone4Absence, backZone4RecentHit, backZone4Trend, backZone4Prediction } = computeZone4Prediction(activeData);
    const getBackZone4 = (num) => Math.ceil(num / 3); // 评分循环中仍需使用
    
    const zone4RangeFormatter = (z) => z <= 3 ? `${(z-1)*3+1}-${z*3}` : '10-12';
    const backZone4Log = formatZonePredictionLog(backZone4Prediction, backZone4Absence, backZone4Trend, 4, zone4RangeFormatter, '后区4小区');
    console.log('  📊 后区4小区动态趋势:', backZone4Log);

    // 6. 计算每个号码的综合得分（策略差异化 + dm维度控制）
    // 热号7维度: 条件概率15 + 遗漏σ归一 + 频率动量15 + 时间衰减10 + 4小区趋势 + 重号因子 + 冷却惩罚-5 + zoneAntiExtreme0.5
    // 均衡5维度: 条件概率20 + 遗漏σ归一 + 频率动量15 + 时间衰减15 + 4小区趋势 + zoneAntiExtreme1
    // 保守5维度: 条件概率×0.8 + 遗漏σ归一 + 频率动量15 + 时间衰减15 + 4小区趋势 + zoneAntiExtreme1
    const scored = [];
    for (let num = 1; num <= CONFIG.BACK_RANGE; num++) {
      let score = 0;
      
      // 预先计算频率（维度2和维度3都需要）
      const freq = backCounter[String(num)] || backCounter[num] || 0;
      
      // 维度1: 条件概率得分 - 归一化（优化5：热号15分，均衡/保守20分，降5分释放空间给4小区must）
      // 从20/25降5分释放空间给4小区must加分(10→18)，must区回归概率接近100%比条件概率更重要
      const condProb = conditionalProb.back[num] || 0;
      const maxCondProb = Math.max(...Object.values(conditionalProb.back));
      const normalizedCondProb = maxCondProb > 0 ? condProb / maxCondProb : 0;
      score += normalizedCondProb * (strategy === 'hot' ? 15 : 20) * dm.conditionalProb;
            
      // 维度2: 遗漏回归评分（σ分段归一化，与前区同步）
      // 逻辑：0-2σ线性映射(0→10分)，>2σ满分10分，避免极端遗漏压缩区分度
      const currentOmission = omissionData.back[num] || 0;
      const omissionDeviation = currentOmission - avgBackOmission;
      const absDeviation = Math.abs(omissionDeviation);
      
      // σ分段归一化：偏离度/2σ → 映射到0-10分
      const omissionNormalized = omissionStd > 0 ? Math.min(absDeviation / (2 * omissionStd), 1) : 0;
      // 适度遗漏得分：偏离均值越近得分越高（反向映射）
      let omissionDevRaw = (1 - omissionNormalized) * 10;
      // 策略加成（10分满分）：
      // - 热号策略：偏向低遗漏（近期刚开出的号码）
      // - 均衡策略：偏向高遗漏（冷号回归），但6分上限（不如保守侧重）
      // - 保守策略：偏向高遗漏（冷号回归），8分上限（最侧重遗漏回归）
      if (strategy === 'hot') {
        if (omissionDeviation < 0) {
          // 热号策略：遗漏越低得分越高
          const maxNegDeviation = Math.max(
            ...Object.values(omissionData.back)
              .map(o => (o || 0) - avgBackOmission)
              .filter(d => d < 0)
              .map(d => Math.abs(d))
          );
          const hotness = maxNegDeviation > 0 ? Math.abs(omissionDeviation) / maxNegDeviation : 0;
          omissionDevRaw += hotness * 10;
        }
      } else if (strategy === 'conservative') {
        // 保守策略：高遗漏回归加分（8分上限）
        if (omissionDeviation > 0) {
          const maxPosDeviation = Math.max(...Object.values(omissionData.back).map(o => (o || 0) - avgBackOmission).filter(d => d > 0));
          const posNormalized = maxPosDeviation > 0 ? omissionDeviation / maxPosDeviation : 0;
          let strategyBonus = posNormalized * 5; // 保守5分基础加成
          if (omissionDeviation > omissionStd * 2) {
            strategyBonus += 3; // >2σ额外+3分
          }
          // 频率惩罚：低频号码的遗漏回归得分打折
          const totalBackFreq = Object.values(backCounter).reduce((sum, f) => sum + f, 0);
          const globalFreqRatio = totalBackFreq > 0 ? freq / totalBackFreq : 0;
          const avgFreqRatio = 1 / CONFIG.BACK_RANGE;
          if (globalFreqRatio < avgFreqRatio) {
            strategyBonus *= globalFreqRatio / avgFreqRatio;
          }
          omissionDevRaw += strategyBonus;
        }
      } else {
        // 均衡策略：适度遗漏回归加分（6分上限，不如保守侧重）
        if (omissionDeviation > 0) {
          const maxPosDeviation = Math.max(...Object.values(omissionData.back).map(o => (o || 0) - avgBackOmission).filter(d => d > 0));
          const posNormalized = maxPosDeviation > 0 ? omissionDeviation / maxPosDeviation : 0;
          let strategyBonus = posNormalized * 4; // 均衡4分基础加成
          if (omissionDeviation > omissionStd * 2) {
            strategyBonus += 2; // >2σ额外+2分
          }
          // 频率惩罚
          const totalBackFreq = Object.values(backCounter).reduce((sum, f) => sum + f, 0);
          const globalFreqRatio = totalBackFreq > 0 ? freq / totalBackFreq : 0;
          const avgFreqRatio = 1 / CONFIG.BACK_RANGE;
          if (globalFreqRatio < avgFreqRatio) {
            strategyBonus *= globalFreqRatio / avgFreqRatio;
          }
          omissionDevRaw += strategyBonus;
        }
      }
      score += omissionDevRaw * dm.omissionDeviation;
            
      // 维度3: 频率+动量得分（dm.freqMomentum乘数控制）
      const freqBase = maxFreq > 0 ? (freq / maxFreq) * 10 : 0; // 基础频率 10分
      const momentum = recentFreq.backMomentum[num] || 0;
      const maxMomentum = Math.max(...Object.values(recentFreq.backMomentum).map(m => Math.abs(m)));
      const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
      let freqScore = freqBase + Math.max(0, normalizedMomentum) * 5; // 动量 5分
      // [简化] 移除热号恒热正向反馈：回测显示该逻辑贡献-4.3%（拖累命中率）
      score += freqScore * dm.freqMomentum;
            
      // 维度4: 时间衰减得分（dm.timeDecay乘数控制）
      const timeWeight = timeWeights[num] || 0;
      score += timeWeight * (strategy === 'hot' ? 10 : 15) * dm.timeDecay;
            
      // 维度5: 频率趋势加分（dm.freqTrend乘数控制，当前全策略禁用=0）
      const freqRate = freqRates[num];
      const freqTrendMax = strategy === 'hot' ? 10 : 15;
      if (freqRate > expectedRate && maxFreqRate > expectedRate) {
        const normalizedTrend = (freqRate - expectedRate) / (maxFreqRate - expectedRate);
        score += normalizedTrend * freqTrendMax * dm.freqTrend;
      }
      
      // 维度6: 4小区动态趋势加分（dm.zone4Trend乘数控制）
      // 数据支撑: 85.4%恰好2个4小区出号, 连续不出2期后100%回归
      // must区回归概率接近100%，加分必须足以让must区号码进入Top候选
      const backZone4 = getBackZone4(num);
      const backPrediction = backZone4Prediction[backZone4];
      if (backPrediction === 'must') score += (strategy === 'hot' ? 18 : 15) * dm.zone4Trend;
      else if (backPrediction === 'very_likely') score += (strategy === 'hot' ? 12 : 10) * dm.zone4Trend;
      else if (backPrediction === 'likely_warm') score += (strategy === 'hot' ? 6 : 5) * dm.zone4Trend;
      else if (backPrediction === 'warming') score += (strategy === 'hot' ? 3 : 2) * dm.zone4Trend;
      else if (backPrediction === 'unlikely_cool') score -= (strategy === 'hot' ? 8 : 5) * (dm.zone4Trend + (dm.zoneAntiExtreme || 0));
      
      // 维度7: 重号因子（热号策略专属，dm.repeatFactor控制）
      // 大乐透后区约25-35%重号率，上期出现的号码本期更可能再出
      // 但高重复周期后往往出现低重复期（均值回归），需动态调整
      if (strategy === 'hot') {
        let backRepeatWeight = 10;
        if (activeData.length >= 2) {
          const lastBackRepeatCount = activeData[activeData.length - 1].back.filter(
            n => activeData[activeData.length - 2].back.includes(n)
          ).length;
          if (lastBackRepeatCount >= 1) backRepeatWeight = 7;
          if (lastBackRepeatCount === 0) backRepeatWeight = 10;
        }
        if (lastDraw && lastDraw.back.includes(num)) {
          score += Math.min(repeatAnalysis.backRepeatRate * backRepeatWeight, backRepeatWeight) * dm.repeatFactor;
        }
      }
      
      // 维度8: 冷却惩罚（所有策略，dm.coolingPenalty控制）
      // 高频号且当前遗漏 > 平均遗漏 → 正在冷却 → 扣分
      const totalBackFreq = Object.values(backCounter).reduce((a, b) => a + b, 0);
      const avgFreqPerNum = totalBackFreq / CONFIG.BACK_RANGE;
      if (freq > avgFreqPerNum && currentOmission > avgBackOmission) {
        const coolingDegree = (currentOmission - avgBackOmission) / avgBackOmission;
        const freqHeat = freq / avgFreqPerNum;
        const maxPenalty = strategy === 'hot' ? 5 : 3; // 热号最多扣5分，均衡/保守最多扣3分
        const penalty = Math.min(coolingDegree * freqHeat * 2, maxPenalty);
        score -= penalty * (dm.coolingPenalty || 0);
      }

      scored.push({
        number: num,
        score,
        condProb,
        omission: currentOmission,
        freq,
        timeWeight
      });
    }
    
    // 后区胆码：确定性推荐（直接取评分最高），确保推荐结果稳定可预期
    // 后区12选1的特性适合确定性策略，每次推荐都是同一号码
    // 但后区胆码风险极高（1不命中=全军覆没），需规避极端依赖重号的号码
    // 如果top1是上期重号且近期重号率高，降低其优先级，取top2或top3作为替代
    const sortedScored = [...scored].sort((a, b) => b.score - a.score);
    let selected = sortedScored.slice(0, backDanCount).map(s => s.number);
    
    // 后区胆码重号风险缓解：胆码是上期出现的号码→重号依赖风险极高
    // 后区胆码1不命中=全军覆没，推荐重号等于赌“它会连续出现”
    // 条件概率更高的非重号通常更可靠（如#5条件概率0.168 >> #10的0.076）
    if (backDanCount >= 1 && lastDraw) {
      // 只要推荐的第一名是上期重号，就考虑降级风险
      // 不再依赖上期重号率判断，直接检查胆码本身是否是重号
      if (lastDraw.back.includes(selected[0])) {
        // 找非重号候选中评分最高的替换（条件概率往往更高）
        const nonRepeatCandidates = sortedScored.filter(s => !lastDraw.back.includes(s.number));
        // 只有非重号候选的评分差距≤3分才替换（避免替换评分差距过大的号码）
        if (nonRepeatCandidates.length > 0) {
          const topRepeatScore = sortedScored.find(s => s.number === selected[0])?.score || 0;
          const topNonRepeatScore = nonRepeatCandidates[0].score;
          if (topRepeatScore - topNonRepeatScore <= 3) {
            // 评分差距≤3分，非重号更安全，替换
            selected[0] = nonRepeatCandidates[0].number;
            console.log('  🔒 后区胆码重号风险缓解: 替换重号#' + sortedScored.find(s => s.number === selected[0] || lastDraw.back.includes(s.number))?.number + '→非重号#' + selected[0] + ' (评分差距' + (topRepeatScore - topNonRepeatScore).toFixed(1) + '分)');
          }
        }
      }
    }
    
    // 输出Top候选详情（用于概率排名显示）
    const topCandidates = [...scored].sort((a, b) => b.score - a.score).slice(0, 5);
    const maxScore = scored.length > 0 ? Math.max(...scored.map(s => s.score)) : 1;
    const probabilityInfo = topCandidates.map(w => {
      const actualProb = maxScore > 0 ? (w.score / maxScore * 100) : 0;
      return {
        number: w.number,
        probability: actualProb,
        score: w.score,
        condProb: w.condProb,
        omission: w.omission,
        freq: w.freq
      }; 
    });
    
    console.log('✅ 后区胆码推荐完成:', selected.sort((a, b) => a - b));
    console.log('  实际选择:', selected.map(n => `#${n}`).join(', '), '(确定性推荐)');
    if (lastDraw) {
      const repeatNums = selected.filter(n => lastDraw.back.includes(n));
      if (repeatNums.length > 0) console.log('  含重号:', repeatNums.map(n => `#${n}`).join(', '));
    }
    console.log('  Top5概率排名:', probabilityInfo.map(p => 
      `#${p.number}(概率${p.probability.toFixed(1)}%, 条件概率${p.condProb.toFixed(3)}, 遗漏${p.omission}, 频率${p.freq}, 总分${p.score.toFixed(2)})`
    ).join(', '));
    
    return {
      selected: selected.sort((a, b) => a - b),
      probabilityInfo: probabilityInfo
    };
  }
}
