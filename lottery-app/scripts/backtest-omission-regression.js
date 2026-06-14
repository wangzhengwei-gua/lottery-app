/**
 * 遗漏回归专项回测 - 验证 FrontDanOptimizer omissionDeviation 维度的有效性
 * 
 * 目标：对比 omissionDeviation=0（当前禁用） vs 不同权重下的命中差异
 * 重点关注"遗漏回归期"——开奖号码中有高遗漏号码回归的期次
 * 
 * 使用方法: node scripts/backtest-omission-regression.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { CONFIG } from '../src/utils/core/Config.js';
import { FrequencyAnalyzer } from '../src/utils/analysis/FrequencyAnalyzer.js';
import { OmissionCalculator } from '../src/utils/analysis/OmissionCalculator.js';
import { TrendAnalyzer } from '../src/utils/analysis/TrendAnalyzer.js';
import { ConditionalProbability } from '../src/utils/analysis/ConditionalProbability.js';
import { CorrelationAnalyzer } from '../src/utils/analysis/CorrelationAnalyzer.js';
import { FrontDanOptimizer } from '../src/utils/optimization/FrontDanOptimizer.js';
import { BackDanOptimizer } from '../src/utils/optimization/BackDanOptimizer.js';
import { BackTuoOptimizer } from '../src/utils/optimization/BackTuoOptimizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 模拟 LotteryAnalyzer
class BacktestAnalyzer {
  constructor(historyData) {
    this.historyData = historyData;
    this.dataWindow = 0;
    
    const frontNumbers = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1);
    const backNumbers = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1);
    
    this._frequencyAnalyzer = new FrequencyAnalyzer(historyData, () => this.getActiveData());
    this._omissionCalculator = new OmissionCalculator(
      historyData, () => this.getActiveData(), frontNumbers, backNumbers
    );
    this._trendAnalyzer = new TrendAnalyzer(historyData, () => this.getActiveData());
    this._conditionalProbability = new ConditionalProbability(historyData, () => this.getActiveData());
    this._correlationAnalyzer = new CorrelationAnalyzer(historyData, () => this.getActiveData());
  }

  getActiveData() {
    if (this.dataWindow === 0) return this.historyData;
    return this.historyData.slice(-this.dataWindow);
  }

  setDataWindow(windowSize) {
    this.dataWindow = windowSize;
    this._frequencyAnalyzer.clearCache();
    this._omissionCalculator.clearCache();
    this._trendAnalyzer.clearCache();
    this._conditionalProbability.clearCache();
    this._correlationAnalyzer.clearCache();
  }

  get frequencyAnalyzer() { return this._frequencyAnalyzer; }
  get omissionCalculator() { return this._omissionCalculator; }
  get trendAnalyzer() { return this._trendAnalyzer; }
  get conditionalProbability() { return this._conditionalProbability; }
  get correlationAnalyzer() { return this._correlationAnalyzer; }

  calculateTimeDecayWeights() {
    const activeData = this.getActiveData();
    const frontWeights = {};
    const backWeights = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontWeights[i] = 0;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backWeights[i] = 0;
    for (let idx = 0; idx < activeData.length; idx++) {
      const draw = activeData[idx];
      const timeWeight = Math.exp((idx - activeData.length + 1) / activeData.length);
      for (const num of draw.front) frontWeights[num] += timeWeight;
      for (const num of draw.back) backWeights[num] += timeWeight;
    }
    return { front: frontWeights, back: backWeights };
  }
}

function loadHistoryData() {
  const dataPath = join(__dirname, '..', 'src', 'data', 'lottery-history.txt');
  const content = fs.readFileSync(dataPath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());
  const historyData = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 7) {
      const front = parts.slice(0, 5).map(n => parseInt(n, 10));
      const back = parts.slice(5, 7).map(n => parseInt(n, 10));
      historyData.push({ front, back });
    }
  }
  return historyData;
}

function suppressConsole() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => {};
  console.warn = (...args) => {};
  return { restore: () => { console.log = originalLog; console.warn = originalWarn; } };
}

// 判断某期是否是"遗漏回归期"——开奖号码中有高遗漏号码回归
function analyzeOmissionRegression(trainData, testData) {
  const frontNumbers = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1);
  const backNumbers = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1);
  
  const tempOmission = new OmissionCalculator(
    trainData, () => trainData, frontNumbers, backNumbers
  );
  const omissionData = tempOmission.calculateOmission();
  const avgFrontOmission = tempOmission.getAverageOmission('front');
  const omissionStd = tempOmission.getOmissionStd('front');
  
  // 分析开奖号码的遗漏值
  const frontOmissions = testData.front.map(n => ({
    number: n,
    omission: omissionData.front[n] || 0,
    deviation: (omissionData.front[n] || 0) - avgFrontOmission,
    isRegression: (omissionData.front[n] || 0) > avgFrontOmission + omissionStd
  }));
  
  const regressionCount = frontOmissions.filter(f => f.isRegression).length;
  const highOmissionCount = frontOmissions.filter(f => f.deviation > 0).length;
  
  return {
    frontOmissions,
    avgFrontOmission,
    omissionStd,
    regressionCount,    // 遗漏 > avg + std 的号码数量（强回归信号）
    highOmissionCount,  // 遗漏 > avg 的号码数量（中回归信号）
    isRegressionPeriod: regressionCount >= 1,  // 至少1个强回归号码
    isHighOmissionPeriod: highOmissionCount >= 2  // 至少2个中回归号码
  };
}

// 执行单期回测（对比不同 omissionDeviation 权重）
function backtestSinglePeriod(historyData, testIndex, strategy, repeatCount, omissionMultipliers) {
  const trainData = historyData.slice(0, testIndex);
  const testData = historyData[testIndex];
  
  if (trainData.length < 50) return null;
  
  const danCount = 4;
  const omissionAnalysis = analyzeOmissionRegression(trainData, testData);
  
  // 对每个遗漏权重配置进行回测
  const resultsByMultiplier = {};
  
  for (const [label, multiplier] of Object.entries(omissionMultipliers)) {
    // 构建维度权重配置
    const dimensionMultipliers = {
      hot: { heatSignal: 1, freqRatio: 1, conditionalProb: 1, timeDecay: 0, zone5Trend: 1, repeatCooling: 1, momentum: 1, coolingPenalty: 1, zoneSaturation: 1, historicalSimilarity: 1, consecutive: 1, zoneAntiExtreme: 0 },
      balanced: { freqMomentum: 1, conditionalProb: 1, omissionDeviation: multiplier, timeDecay: 0, freqTrend: 1, zone5Trend: 1, consecutive: 1 },
      conservative: { freqMomentum: 1, conditionalProb: 1, omissionDeviation: multiplier, timeDecay: 0, freqTrend: 1, zone5Trend: 1, consecutive: 1 }
    };
    
    const dm = dimensionMultipliers[strategy];
    
    let totalFrontDanHits = 0;
    let bestFrontDanHits = 0;
    let allRecommendations = [];
    let regressionHits = 0; // 遗漏回归号码命中数
    
    const analyzer = new BacktestAnalyzer(trainData);
    const { restore } = suppressConsole();
    
    try {
      for (let r = 0; r < repeatCount; r++) {
        analyzer._frequencyAnalyzer.clearCache();
        analyzer._omissionCalculator.clearCache();
        analyzer._trendAnalyzer.clearCache();
        analyzer._conditionalProbability.clearCache();
        analyzer._correlationAnalyzer.clearCache();
        
        const frontResult = FrontDanOptimizer.optimize(analyzer, danCount, strategy, dm);
        const frontDanHits = frontResult.selected.filter(n => testData.front.includes(n)).length;
        
        // 遗漏回归号码命中数：推荐的号码中有多少是遗漏回归号码（遗漏>avg+std）
        const regHits = frontResult.selected.filter(n => {
          const omissionInfo = omissionAnalysis.frontOmissions.find(f => f.number === n);
          return omissionInfo && omissionInfo.isRegression;
        }).length;
        
        totalFrontDanHits += frontDanHits;
        regressionHits += regHits;
        bestFrontDanHits = Math.max(bestFrontDanHits, frontDanHits);
        allRecommendations.push(frontResult.selected);
      }
    } finally {
      restore();
    }
    
    // 统计推荐号码频率
    const frontDanFreq = {};
    for (const rec of allRecommendations) {
      for (const n of rec) frontDanFreq[n] = (frontDanFreq[n] || 0) + 1;
    }
    
    // 确定性推荐（Top频率号码）
    const topFrontDan = Object.entries(frontDanFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, danCount)
      .map(([num]) => parseInt(num, 10))
      .sort((a, b) => a - b);
    
    const deterministicFrontHits = topFrontDan.filter(n => testData.front.includes(n)).length;
    const deterministicRegHits = topFrontDan.filter(n => {
      const omissionInfo = omissionAnalysis.frontOmissions.find(f => f.number === n);
      return omissionInfo && omissionInfo.isRegression;
    }).length;
    
    resultsByMultiplier[label] = {
      avgFrontDanHits: totalFrontDanHits / repeatCount,
      bestFrontDanHits,
      deterministicFrontHits,
      avgRegressionHits: regressionHits / repeatCount,
      deterministicRegHits,
      topFrontDan,
      frontDanFreq,
      hitAtLeast1: allRecommendations.some(rec => rec.some(n => testData.front.includes(n)))
    };
  }
  
  return {
    period: testIndex,
    actualFront: testData.front,
    actualBack: testData.back,
    omissionAnalysis,
    resultsByMultiplier
  };
}

// 主回测函数
function runOmissionBacktest(totalPeriods = 215, repeatCount = 20) {
  const historyData = loadHistoryData();
  console.log(`\n🎯 遗漏回归专项回测`);
  console.log(`历史数据: ${historyData.length}期, 回测期数: ${totalPeriods}, 每期重复: ${repeatCount}次`);
  console.log('='.repeat(80));
  
  // 测试配置：基线 vs 最终配置 vs 对比组
  const omissionMultipliers = {
    'baseline_0': 0,       // 原配置（禁用）
    'final_0.5': 0.5,      // 最终配置：均衡/保守都用0.5
    'full_1.0': 1.0,       // 对比组：完全权重
    'strong_1.5': 1.5      // 对比组：强权重
  };
  
  const strategies = ['balanced', 'conservative'];
  const startIdx = 50;
  
  const allResults = {};
  
  for (const strategy of strategies) {
    console.log(`\n📊 策略: ${strategy} (${strategy === 'hot' ? 4 : 3}前区胆)`);
    console.log('-'.repeat(80));
    
    const periodResults = [];
    const summaryByMultiplier = {};
    
    // 初始化统计
    for (const label of Object.keys(omissionMultipliers)) {
      summaryByMultiplier[label] = {
        totalAvgHits: 0,
        totalDetHits: 0,
        totalAvgRegHits: 0,
        totalDetRegHits: 0,
        hitAtLeast1Count: 0,
        detHitAtLeast1Count: 0,
        // 遗漏回归期专用统计
        regPeriodsTotalAvgHits: 0,
        regPeriodsTotalDetHits: 0,
        regPeriodsTotalAvgRegHits: 0,
        regPeriodsTotalDetRegHits: 0,
        regPeriodsDetHitAtLeast1: 0,
        highOmissionTotalAvgHits: 0,
        highOmissionTotalDetHits: 0,
        regPeriodCount: 0,
        highOmissionPeriodCount: 0
      };
    }
    
    for (let i = startIdx; i < Math.min(totalPeriods, historyData.length); i++) {
      const result = backtestSinglePeriod(historyData, i, strategy, repeatCount, omissionMultipliers);
      if (!result) continue;
      
      periodResults.push(result);
      const isRegPeriod = result.omissionAnalysis.isRegressionPeriod;
      const isHighOmission = result.omissionAnalysis.isHighOmissionPeriod;
      
      for (const [label, data] of Object.entries(result.resultsByMultiplier)) {
        const s = summaryByMultiplier[label];
        s.totalAvgHits += data.avgFrontDanHits;
        s.totalDetHits += data.deterministicFrontHits;
        s.totalAvgRegHits += data.avgRegressionHits;
        s.totalDetRegHits += data.deterministicRegHits;
        if (data.hitAtLeast1) s.hitAtLeast1Count++;
        if (data.deterministicFrontHits > 0) s.detHitAtLeast1Count++;
        
        // 遗漏回归期专用
        if (isRegPeriod) {
          s.regPeriodCount++;
          s.regPeriodsTotalAvgHits += data.avgFrontDanHits;
          s.regPeriodsTotalDetHits += data.deterministicFrontHits;
          s.regPeriodsTotalAvgRegHits += data.avgRegressionHits;
          s.regPeriodsTotalDetRegHits += data.deterministicRegHits;
          if (data.deterministicFrontHits > 0) s.regPeriodsDetHitAtLeast1++;
        }
        if (isHighOmission) {
          s.highOmissionPeriodCount++;
          s.highOmissionTotalAvgHits += data.avgFrontDanHits;
          s.highOmissionTotalDetHits += data.deterministicFrontHits;
        }
      }
    }
    
    const validPeriods = periodResults.length;
    
    // 输出对比
    console.log(`\n  有效回测期数: ${validPeriods}`);
    
    // 1. 全期对比
    console.log('\n  📈 全期平均命中对比:');
    console.log('  配置\t\t\t| 随机均值 | 确定≥1率 | 遗漏回归命中 | 确定回归命中');
    console.log('  ' + '-'.repeat(70));
    for (const [label, s] of Object.entries(summaryByMultiplier)) {
      const avgHits = validPeriods > 0 ? s.totalAvgHits / validPeriods : 0;
      const detRate = validPeriods > 0 ? s.detHitAtLeast1Count / validPeriods * 100 : 0;
      const avgRegHits = validPeriods > 0 ? s.totalAvgRegHits / validPeriods : 0;
      const detRegHits = validPeriods > 0 ? s.totalDetRegHits / validPeriods : 0;
      console.log(`  ${label.padEnd(20)}| ${avgHits.toFixed(3).padStart(8)} | ${detRate.toFixed(1).padStart(7)}% | ${avgRegHits.toFixed(3).padStart(12)} | ${detRegHits.toFixed(3).padStart(12)}`);
    }
    
    // 2. 遗漏回归期专用对比
    console.log('\n  🔥 遗漏回归期对比（开奖号码含遗漏>avg+std的号码）:');
    const regPeriods = periodResults.filter(r => r.omissionAnalysis.isRegressionPeriod);
    console.log(`  遗漏回归期数: ${regPeriods.length}/${validPeriods} (${(regPeriods.length/validPeriods*100).toFixed(1)}%)`);
    console.log('  配置\t\t\t| 回归期随机均值 | 回归期确定≥1率 | 回归号码命中均值 | 回归号码确定命中');
    console.log('  ' + '-'.repeat(75));
    for (const [label, s] of Object.entries(summaryByMultiplier)) {
      if (s.regPeriodCount === 0) continue;
      const avgHits = s.regPeriodsTotalAvgHits / s.regPeriodCount;
      const detRate = s.regPeriodsDetHitAtLeast1 / s.regPeriodCount * 100;
      const avgRegHits = s.regPeriodsTotalAvgRegHits / s.regPeriodCount;
      const detRegHits = s.regPeriodsTotalDetRegHits / s.regPeriodCount;
      console.log(`  ${label.padEnd(20)}| ${avgHits.toFixed(3).padStart(15)} | ${detRate.toFixed(1).padStart(14)}% | ${avgRegHits.toFixed(3).padStart(16)} | ${detRegHits.toFixed(3).padStart(16)}`);
    }
    
    // 3. 高遗漏期对比（至少2个号码遗漏>avg）
    console.log('\n  📊 高遗漏期对比（开奖号码含2+个遗漏>avg的号码）:');
    const highOmissionPeriods = periodResults.filter(r => r.omissionAnalysis.isHighOmissionPeriod);
    console.log(`  高遗漏期数: ${highOmissionPeriods.length}/${validPeriods} (${(highOmissionPeriods.length/validPeriods*100).toFixed(1)}%)`);
    console.log('  配置\t\t\t| 高遗漏期随机均值 | 高遗漏期确定≥1率');
    console.log('  ' + '-'.repeat(55));
    for (const [label, s] of Object.entries(summaryByMultiplier)) {
      if (s.highOmissionPeriodCount === 0) continue;
      const avgHits = s.highOmissionTotalAvgHits / s.highOmissionPeriodCount;
      const detRate = s.highOmissionTotalDetHits / s.highOmissionPeriodCount > 0 
        ? (s.highOmissionTotalDetHits / s.highOmissionPeriodCount).toFixed(1) : '0';
      console.log(`  ${label.padEnd(20)}| ${avgHits.toFixed(3).padStart(16)} | ${detRate.toString().padStart(14)}`);
    }
    
    // 4. 典型遗漏回归期详情
    console.log('\n  📋 典型遗漏回归期详情（最近10个）:');
    const recentRegPeriods = regPeriods.slice(-10);
    for (const rp of recentRegPeriods) {
      const periodNum = rp.period + 1; // 期号从1开始
      const regNums = rp.omissionAnalysis.frontOmissions.filter(f => f.isRegression)
        .map(f => `#${f.number}(遗漏${f.omission})`).join(', ');
      const baselineHits = rp.resultsByMultiplier['baseline_0'].deterministicFrontHits;
      const fullHits = rp.resultsByMultiplier['full_1.0'].deterministicFrontHits;
      const baselineTop = rp.resultsByMultiplier['baseline_0'].topFrontDan.join(',');
      const fullTop = rp.resultsByMultiplier['full_1.0'].topFrontDan.join(',');
      console.log(`  ${periodNum}期: 实际[${rp.actualFront.join(',')}] 回归号[${regNums}] | baseline命中${baselineHits}(${baselineTop}) | full命中${fullHits}(${fullTop})`);
    }
    
    // 计算随机基线
    const danCount = 4;
    const randomFrontProb = 1 - comb(30, danCount) / comb(35, danCount);
    console.log(`\n  随机基线: 纯随机${danCount}胆至少中1概率=${(randomFrontProb*100).toFixed(1)}%`);
    
    allResults[strategy] = {
      validPeriods,
      summaryByMultiplier,
      regPeriodCount: regPeriods.length,
      highOmissionPeriodCount: highOmissionPeriods.length,
      recentRegPeriodDetails: recentRegPeriods.map(rp => ({
        period: rp.period + 1,
        actualFront: rp.actualFront,
        regressionNumbers: rp.omissionAnalysis.frontOmissions.filter(f => f.isRegression).map(f => ({ number: f.number, omission: f.omission })),
        baselineDeterministicHits: rp.resultsByMultiplier['baseline_0'].deterministicFrontHits,
        fullDeterministicHits: rp.resultsByMultiplier['full_1.0'].deterministicFrontHits,
        baselineTopFrontDan: rp.resultsByMultiplier['baseline_0'].topFrontDan,
        fullTopFrontDan: rp.resultsByMultiplier['full_1.0'].topFrontDan
      }))
    };
  }
  
  // 保存结果
  const outputPath = join(__dirname, 'backtest-omission-regression-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2), 'utf-8');
  console.log(`\n💾 结果已保存到: ${outputPath}`);
  
  return allResults;
}

function comb(n, k) {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) result *= (n - i) / (i + 1);
  return result;
}

runOmissionBacktest(215, 20);
