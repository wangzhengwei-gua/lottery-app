import { CONFIG } from '../core/Config.js';
import { computeZone5Prediction, formatZonePredictionLog, getZone5, getZone7 } from './ZonePrediction.js';

export class FrontDanOptimizer {
  /**
   * 优化前区胆码推荐（5维度评分 + 和值回归 + 加权随机采样）
   * 热号：heatSignal + zone5Trend + repeatCooling + momentum + sumRegression
   * 均衡/保守：freqMomentum + conditionalProb + omissionDeviation + zone5Trend + sumRegression
   * @param {Object} analyzer - LotteryAnalyzer实例
   * @param {number} danCount - 需要推荐的胆码数量（2-4）
   * @param {string} strategy - 策略：hot/balanced/conservative
   * @returns {Object} { selected: number[], probabilityInfo: Object[] }
   */
  static optimize(analyzer, danCount = 3, strategy = 'hot', dimensionMultipliers = null) {
    console.log('🎯 前区胆码智能推荐（5维度评分 + 和值回归）');
    console.log('  策略:', strategy, '胆码数量:', danCount);
    
    // P1维度精简：从12维度→5维度，删除噪音/重叠维度
    // 热号：heatSignal+zone5Trend+repeatCooling+momentum+sumRegression（纯短期信号+和值回归）
    // 均衡/保守：freqMomentum+conditionalProb+omissionDeviation+zone5Trend+sumRegression
    const defaultMultipliers = {
      hot: { heatSignal: 2.0, zone5Trend: 1.0, repeatCooling: 1.0, momentum: 2.0, sumRegression: 1 },
      balanced: { freqMomentum: 1, conditionalProb: 1, omissionDeviation: 1.0, zone5Trend: 1, sumRegression: 1 },
      conservative: { freqMomentum: 1, conditionalProb: 0.8, omissionDeviation: 1.0, zone5Trend: 1, sumRegression: 0.8 }
    };
    const dm = dimensionMultipliers || defaultMultipliers[strategy];
    
    // 1. 获取条件概率（均衡/保守策略用）
    const conditionalProb = analyzer.conditionalProbability.calculateConditionalProbability();
    
    // 2. 获取遗漏数据
    const omissionData = analyzer.omissionCalculator.calculateOmission();
    const avgFrontOmission = analyzer.omissionCalculator.getAverageOmission('front');
    const omissionStd = analyzer.omissionCalculator.getOmissionStd('front');
    
    // 3. 获取频率数据（全量 + 近期趋势动量）
    const [frontCounter] = analyzer.frequencyAnalyzer.analyzeFrequency();
    const maxFreq = Math.max(...Object.values(frontCounter));
    const recentFreq = analyzer.frequencyAnalyzer.analyzeRecentFrequency();
    
    // 4. 热号策略专用数据
    const activeData = analyzer.getActiveData();
    const lastDraw = activeData.length > 0 ? activeData[activeData.length - 1] : null;
    
    // 动量加速度：近10期频率 vs 近30期频率
    const veryRecentCount = Math.min(10, activeData.length);
    const veryRecentData = activeData.slice(-veryRecentCount);
    const veryRecentFrontFreq = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) veryRecentFrontFreq[i] = 0;
    for (const draw of veryRecentData) {
      for (const num of draw.front) veryRecentFrontFreq[num]++;
    }
    
    // 预计算：近10期重号率（用于胆码重号降温幅度判断）
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

    // === 5小区动态趋势数据 ===
    const { zone5Absence, zone5RecentHit, zone5Trend, zone5Prediction } = computeZone5Prediction(activeData, getZone5);
    
    const zone5Log = formatZonePredictionLog(zone5Prediction, zone5Absence, zone5Trend, 5, (z) => `${(z-1)*7+1}-${z*7}`, '5小区');
    console.log('  📊 5小区动态趋势预测:', zone5Log);
    
    // === 和值趋势数据（维度5: 和值回归信号） ===
    // 核心逻辑：近期和值偏高→偏低号码加分（回归低值），近期和值偏低→偏高号码加分
    const sumTrendData = analyzer.trendAnalyzer.analyzeSumTrend();
    const avgFrontSum = sumTrendData.avgFrontSum;
    const idealPerNum = avgFrontSum / CONFIG.FRONT_COUNT;
    const recent5Sums = sumTrendData.recentFrontSums.slice(-5);
    const recent5Avg = recent5Sums.length > 0 ? recent5Sums.reduce((a,b) => a+b, 0) / recent5Sums.length : avgFrontSum;
    const frontSumBias = recent5Avg - avgFrontSum;
    console.log('  📊 和值趋势: 近5期均值' + recent5Avg.toFixed(1) + '(偏差' + frontSumBias.toFixed(1) + '), 理想单号贡献≈' + idealPerNum.toFixed(1));
    
    // 5. 计算每个号码的综合得分（4维度精简版）
    const scored = [];
    
    // 预计算归一化常量
    const maxCondProb = Math.max(...Object.values(conditionalProb.front));
    
    // 预计算循环外常量
    const maxMomentum = Math.max(...Object.values(recentFreq.frontMomentum).map(m => Math.abs(m))); 
    const totalFrontFreq = Object.values(frontCounter).reduce((a, b) => a + b, 0);
    const avgFreqPerNum = totalFrontFreq / CONFIG.FRONT_RANGE;
    const maxAcceleration = Math.max(
      ...Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1)
        .map(n => ((veryRecentFrontFreq[n] || 0) / veryRecentCount) - ((recentFreq.front[n] || 0) / recentFreq.recentCount))
        .filter(a => a > 0)
    );

    for (let num = 1; num <= CONFIG.FRONT_RANGE; num++) {
      let score = 0;
      const zone7 = getZone7(num);
      const dims = {}; // 维度分解追踪
      
      const freq = frontCounter[String(num)] || frontCounter[num] || 0;
      const momentum = recentFreq.frontMomentum[num] || 0;
      const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
      const currentOmission = omissionData.front[num] || 0;
      
      // === 热号策略4维度 ===
      if (strategy === 'hot') {
        // 维度1: 热度信号得分（遗漏评分0~12天花板 + 频率可信度5分）× dm.heatSignal
        const rawOmissionScore = Math.max(0, 15 - (currentOmission / avgFrontOmission) * 15);
        const omissionBaseScore = Math.min(rawOmissionScore, 12);
        const freqBoost = maxFreq > 0 ? (freq / maxFreq) * 5 : 0;
        score += (omissionBaseScore + freqBoost) * dm.heatSignal;
        dims.heatSignal = (omissionBaseScore + freqBoost) * dm.heatSignal;
        
        // 维度2: 5小区动态趋势加分 × dm.zone5Trend
        const zone5 = getZone5(num);
        const prediction = zone5Prediction[zone5];
        let baseTrendScore = 0;
        if (prediction === 'must') baseTrendScore = 15;
        else if (prediction === 'very_likely') baseTrendScore = 12;
        else if (prediction === 'likely_warm') baseTrendScore = 7;
        else if (prediction === 'warming') baseTrendScore = 3;
        else if (prediction === 'unlikely_cool') baseTrendScore = -3;
        score += baseTrendScore * dm.zone5Trend;
        dims.zone5Trend = baseTrendScore * dm.zone5Trend;
        // 必出区额外强化（+5分）
        if (prediction === 'must') {
          const mustBonus = 5 * dm.zone5Trend;
          score += mustBonus;
          dims.zone5Trend += mustBonus;
        }
        
        // 维度3: 胆码重号降温 × dm.repeatCooling（回测O1条件化：仅近期重号率>2.5时惩罚）
        // 回测根因：#19遗漏=0实际连出(重号)，但冷却惩罚过度扣分导致排名偏低
        if (lastDraw && lastDraw.front.includes(num) && recent10RepeatRate > 2.5) {
          const coolingPenaltyVal = recent10RepeatRate > 3.0 ? 2 : 1.5;
          const repeatPenalty = coolingPenaltyVal * dm.repeatCooling;
          score -= repeatPenalty;
          dims.repeatCooling = -repeatPenalty;
        }
        
        // 维度4: 动量加速度加分 × dm.momentum
        const veryRecentRate = (veryRecentFrontFreq[num] || 0) / veryRecentCount;
        const mediumRecentRate = (recentFreq.front[num] || 0) / recentFreq.recentCount;
        const acceleration = veryRecentRate - mediumRecentRate;
        if (acceleration > 0 && maxAcceleration > 0) {
          const momentumScore = (acceleration / maxAcceleration) * 5 * dm.momentum;
          score += momentumScore;
          dims.momentum = momentumScore;
        }
        
        // 维度5: 和值趋势回归（近期和值偏离→号码值反向加分）
        const hotSumMax = 5;
        let hotSumRegScore = 0;
        if (Math.abs(frontSumBias) > 5) {
          const normalizedBias = Math.min(Math.abs(frontSumBias) / 15, 1);
          if (frontSumBias > 0 && num < idealPerNum) {
            const deviation = (idealPerNum - num) / idealPerNum;
            hotSumRegScore = normalizedBias * Math.min(deviation * 0.5, 0.8) * hotSumMax;
          } else if (frontSumBias < 0 && num > idealPerNum) {
            const deviation = (num - idealPerNum) / idealPerNum;
            hotSumRegScore = normalizedBias * Math.min(deviation * 0.5, 0.8) * hotSumMax;
          }
        }
        score += hotSumRegScore * dm.sumRegression;
        dims.sumRegression = hotSumRegScore * dm.sumRegression;
      } else {
        // === 均衡/保守策略4维度 ===
        // 维度1: 频率+动量 × dm.freqMomentum
        if (strategy === 'balanced') {
          const freqBase = maxFreq > 0 ? (freq / maxFreq) * 10 : 0;
          score += (freqBase + Math.max(0, normalizedMomentum) * 5) * dm.freqMomentum;
        } else {
          // 保守：频率降至6分 + 动量降至2分
          const freqBase = maxFreq > 0 ? (freq / maxFreq) * 6 : 0;
          score += (freqBase + Math.max(0, normalizedMomentum) * 2) * dm.freqMomentum;
        }
        dims.freqMomentum = (() => {
          const freqBase = maxFreq > 0 ? (freq / maxFreq) * (strategy === 'balanced' ? 10 : 6) : 0;
          return (freqBase + Math.max(0, normalizedMomentum) * (strategy === 'balanced' ? 5 : 2)) * dm.freqMomentum;
        })();
        
        // 维度2: 条件概率得分 × dm.conditionalProb
        const condProb = conditionalProb.front[num] || 0;
        const normalizedCondProb = maxCondProb > 0 ? condProb / maxCondProb : 0;
        const condProbScore = normalizedCondProb * (strategy === 'balanced' ? 30 : 25) * dm.conditionalProb;
        score += condProbScore;
        dims.conditionalProb = condProbScore;
        
        // 维度3: 遗漏偏离度评分 × dm.omissionDeviation（σ分段归一化）
        const omissionDeviation = currentOmission - avgFrontOmission;
        const absDeviation = Math.abs(omissionDeviation);
        const sigma2 = omissionStd * 2;
        
        const devBaseMax = strategy === 'balanced' ? 10 : 13;
        let baseDevScore = 0;
        if (absDeviation >= sigma2 && sigma2 > 0) {
          baseDevScore = devBaseMax;
        } else if (sigma2 > 0) {
          baseDevScore = (absDeviation / sigma2) * devBaseMax;
        }
        
        let omissionDevRaw = baseDevScore;
        if (omissionDeviation > 0) {
          const highOmissionMax = strategy === 'balanced' ? 7 : 10;
          let strategyBonus = 0;
          if (omissionDeviation >= sigma2 && sigma2 > 0) {
            strategyBonus = highOmissionMax;
          } else if (sigma2 > 0) {
            strategyBonus = (omissionDeviation / sigma2) * highOmissionMax;
          }
          omissionDevRaw += strategyBonus;
          if (omissionDeviation > sigma2) {
            omissionDevRaw += strategy === 'balanced' ? 3 : 5;
          }
        }
        // 中间地带回升：遗漏比率0.7-1.3的号码有基础回升分
        if (avgFrontOmission > 0) {
          const ratio = currentOmission / avgFrontOmission;
          if (ratio >= 0.7 && ratio <= 1.3) {
            const closeness = 1 - Math.abs(ratio - 1.0) / 0.3;
            omissionDevRaw += closeness * 4;
          }
          // 低遗漏近期加分：遗漏≤0.5×avg的“持续热度”号码
          if (ratio <= 0.5) omissionDevRaw += 2;
          else if (ratio <= 0.7) omissionDevRaw += 1;
        }
        score += omissionDevRaw * dm.omissionDeviation;
        dims.omissionDeviation = omissionDevRaw * dm.omissionDeviation;
        
        // 维度4: 5小区动态趋势 × dm.zone5Trend
        const zone5 = getZone5(num);
        const prediction = zone5Prediction[zone5];
        const zone5Max = strategy === 'balanced' ? 10 : 7;
        const zone5VeryLikely = strategy === 'balanced' ? 7 : 4;
        const zone5LikelyWarm = strategy === 'balanced' ? 3 : 2;
        const zone5Warming = strategy === 'balanced' ? 1 : 1;
        const zone5Cool = strategy === 'balanced' ? -2 : -1;
        let zone5Score = 0;
        if (prediction === 'must') zone5Score = zone5Max;
        else if (prediction === 'very_likely') zone5Score = zone5VeryLikely;
        else if (prediction === 'likely_warm') zone5Score = zone5LikelyWarm;
        else if (prediction === 'warming') zone5Score = zone5Warming;
        else if (prediction === 'unlikely_cool') zone5Score = zone5Cool;
        score += zone5Score * dm.zone5Trend;
        dims.zone5Trend = zone5Score * dm.zone5Trend;
        
        // 维度5: 和值趋势回归（近期和值偏离→号码值反向加分）
        const balConSumMax = strategy === 'balanced' ? 8 : 6;
        let balConSumRegScore = 0;
        if (Math.abs(frontSumBias) > 5) {
          const normalizedBias = Math.min(Math.abs(frontSumBias) / 15, 1);
          if (frontSumBias > 0 && num < idealPerNum) {
            const deviation = (idealPerNum - num) / idealPerNum;
            balConSumRegScore = normalizedBias * Math.min(deviation * 0.5, 0.8) * balConSumMax;
          } else if (frontSumBias < 0 && num > idealPerNum) {
            const deviation = (num - idealPerNum) / idealPerNum;
            balConSumRegScore = normalizedBias * Math.min(deviation * 0.5, 0.8) * balConSumMax;
          }
        }
        score += balConSumRegScore * dm.sumRegression;
        dims.sumRegression = balConSumRegScore * dm.sumRegression;
      }

      scored.push({
        number: num,
        score,
        dims,
        zone5: getZone5(num),
        zone7: zone7,
        zone5Prediction: zone5Prediction[getZone5(num)],
        zone5Absence: zone5Absence[getZone5(num)],
        condProb: conditionalProb.front[num] || 0,
        omission: currentOmission,
        freq,
        isRepeat: lastDraw ? lastDraw.front.includes(num) : false
      });
    }
    
    // 根据策略调整候选池
    scored.sort((a, b) => b.score - a.score);
    
    // 热号策略：完全确定性选择（无扰动）
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
      candidatePool = scored.slice(0, 15);
    } else if (strategy === 'balanced') {
      candidatePool = scored.slice(0, 15);
    } else {
      // 保守策略：偏向遗漏回归号码
      candidatePool = scored.filter(s => {
        const omissionDeviation = (s.omission || 0) - avgFrontOmission;
        return omissionDeviation > 0 || (omissionDeviation >= -avgFrontOmission * 0.3 && s.score > scored[0].score * 0.6);
      }).slice(0, 15);
      if (candidatePool.length < danCount + 3) {
        const extras = scored.filter(s => !candidatePool.includes(s)).slice(0, 15 - candidatePool.length);
        candidatePool.push(...extras);
      }
    }
    
    // V6: 热号策略群体组合优化 - 从Top8枚举最优4号组合
    const selected = [];
    if (strategy === 'hot') {
      const topCandidates = [...candidatePool].sort((a, b) => b.score - a.score).slice(0, 8);
      
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
      
      let bestCombo = null;
      let bestGroupScore = -Infinity;
      let bestBreakdown = null;
      
      for (const { combo, zoneCounts } of validCombos) {
        const individualSum = combo.reduce((s, c) => s + c.score, 0);
        
        const comboSum = combo.reduce((s, c) => s + c.number, 0);
        // 和值目标：经验区间[72-108]，理想中心90
        let sumBonus = 0;
        if (comboSum >= 72 && comboSum <= 108) {
          sumBonus = 5 - Math.abs(comboSum - 90) * 0.1;
        } else if (comboSum >= 62 && comboSum <= 118) {
          sumBonus = 1;
        } else {
          sumBonus = -3;
        }
        
        const diffs = [];
        for (let a = 0; a < combo.length; a++) {
          for (let b = a + 1; b < combo.length; b++) {
            diffs.push(Math.abs(combo[a].number - combo[b].number));
          }
        }
        const distinctDiffs = new Set(diffs).size;
        const acValue = distinctDiffs - 3;
        const acBonus = acValue >= 3 ? 5 : acValue >= 2 ? 2 : 0;
        
        const zonesCovered = Object.keys(zoneCounts).length;
        const spreadBonus = zonesCovered >= 4 ? 4 : zonesCovered >= 3 ? 2 : -2;
        
        let omissionPenalty = 0;
        const zeroOmissionCount = combo.filter(c => c.omission === 0).length;
        if (zeroOmissionCount >= 3) omissionPenalty = -5;
        else if (zeroOmissionCount === 2) omissionPenalty = -2;
        const lowOmissionCount = combo.filter(c => c.omission <= 5).length;
        if (lowOmissionCount === 4) omissionPenalty -= 2;
        
        const groupScore = individualSum + sumBonus + acBonus + spreadBonus + omissionPenalty;
        
        if (groupScore > bestGroupScore) {
          bestGroupScore = groupScore;
          bestCombo = combo;
          bestBreakdown = { individualSum, sumBonus, acBonus, spreadBonus, omissionPenalty, comboSum, acValue, zonesCovered };
        }
      }
      
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
        console.log(`  🧩 群体优化: 和值${bestBreakdown.comboSum}(适配+${bestBreakdown.sumBonus.toFixed(1)}分) AC=${bestBreakdown.acValue}(加+${bestBreakdown.acBonus}分) 区间覆盖${bestBreakdown.zonesCovered}(加+${bestBreakdown.spreadBonus}分) 遗漏惩罚${bestBreakdown.omissionPenalty} 个体总分${bestBreakdown.individualSum.toFixed(1)} 群体总分${bestGroupScore.toFixed(1)}`);
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
      
      // 近30期各区频率占比（用于采样优先级）
      const recent30Count = Math.min(30, activeData.length);
      const recent30Data = activeData.slice(-recent30Count);
      const zone7RecentFreq = {};
      for (let zone = 1; zone <= 7; zone++) zone7RecentFreq[zone] = 0;
      for (const draw of recent30Data) {
        for (const num of draw.front) zone7RecentFreq[getZone7(num)]++;
      }
      const totalZone7RecentFreq = Object.values(zone7RecentFreq).reduce((a, b) => a + b, 0) || 1;
      
      const remaining = [...weights];
      
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
    
    // 后处理：仅均衡/保守策略保留遗漏多样性约束
    if (strategy !== 'hot' && danCount >= 4) {
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

    // 计算概率排名信息
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
    
    // 区间频率排名（供UI显示）
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
      console.log('  📊 维度分解(热号):', top5Scored.map(s => {
        const d = s.dims || {};
        const parts = [];
        if (d.heatSignal) parts.push(`热${d.heatSignal.toFixed(1)}`);
        if (d.zone5Trend) parts.push(`区趋${d.zone5Trend.toFixed(1)}`);
        if (d.repeatCooling) parts.push(`重号${d.repeatCooling.toFixed(1)}`);
        if (d.momentum) parts.push(`动量${d.momentum.toFixed(1)}`);
        if (d.sumRegression) parts.push(`和值${d.sumRegression.toFixed(1)}`);
        return `#${s.number}(${parts.join('+')})`;
      }).join(', '));
    } else {
      const top5Scored = scored.slice(0, 5);
      console.log('  📊 维度分解(均衡/保守):', top5Scored.map(s => {
        const d = s.dims || {};
        const parts = [];
        if (d.freqMomentum) parts.push(`频动${d.freqMomentum.toFixed(1)}`);
        if (d.conditionalProb) parts.push(`条件${d.conditionalProb.toFixed(1)}`);
        if (d.omissionDeviation) parts.push(`遗漏${d.omissionDeviation.toFixed(1)}`);
        if (d.zone5Trend) parts.push(`区趋${d.zone5Trend.toFixed(1)}`);
        if (d.sumRegression) parts.push(`和值${d.sumRegression.toFixed(1)}`);
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
