/**
 * 策略回测框架 v2 - 使用真实优化器算法
 * 直接调用 FrontDanOptimizer / BackDanOptimizer 进行回测
 * 
 * 使用方法: node scripts/backtest-v2.js [期数] [策略] [重复次数]
 *   - 期数: 回测期数，默认200
 *   - 策略: hot/balanced/conservative/all，默认all
 *   - 重复次数: 每期重复采样次数（克服随机性），默认10
 * 
 * 示例:
 *   node scripts/backtest-v2.js 100 hot 20     # 回测100期，热号策略，每期重复20次
 *   node scripts/backtest-v2.js 200 all 5      # 回测200期，所有策略，每期5次
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

// 模拟 LotteryAnalyzer 的接口，让 FrontDanOptimizer/BackDanOptimizer 能直接调用
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
    if (this.dataWindow === 0) {
      return this.historyData;
    }
    return this.historyData.slice(-this.dataWindow);
  }

  setDataWindow(windowSize) {
    this.dataWindow = windowSize;
    // 清除所有缓存，确保新窗口数据重新计算
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

  // 时间衰减权重计算（与 LotteryAnalyzer 逻辑一致）
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

// 加载历史数据
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
  
  console.log(`✅ 加载历史数据: ${historyData.length}期`);
  return historyData;
}

/**
 * 获取胆码数量（与 App.jsx 中的策略配置一致）
 */
function getDanCount(strategy) {
  return 4; // 所有策略统一4胆
}

/**
 * 获取后区胆码数量
 */
function getBackDanCount(strategy) {
  return 1; // 所有策略后区1胆
}

/**
 * 获取后区拖码数量
 */
function getBackTuoCount(strategy) {
  return 4; // 所有策略后区4拖
}

/**
 * 抑制 console.log 输出（回测时不需要详细日志）
 */
function suppressConsole() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => {}; // 静默
  console.warn = (...args) => {}; // 静默
  return { restore: () => { console.log = originalLog; console.warn = originalWarn; } };
}

/**
 * 执行单期回测（多次采样取平均）
 * @param {Array} historyData - 全量历史数据
 * @param {number} testIndex - 测试期索引
 * @param {string} strategy - 策略名
 * @param {number} repeatCount - 每期重复采样次数
 */
function backtestSinglePeriod(historyData, testIndex, strategy, repeatCount) {
  // 训练数据：testIndex之前的所有数据
  const trainData = historyData.slice(0, testIndex);
  // 测试数据：testIndex当期
  const testData = historyData[testIndex];
  
  if (trainData.length < 50) {
    return null; // 训练数据不足
  }
  
  const analyzer = new BacktestAnalyzer(trainData);
  const danCount = getDanCount(strategy);
  const backDanCount = getBackDanCount(strategy);
  const tuoCount = getBackTuoCount(strategy);
  
  // 多次采样取平均命中（克服加权随机采样的随机性）
  let totalFrontDanHits = 0;
  let totalBackDanHits = 0;
  let totalBackTuoHits = 0;
  let totalBackCoverage = 0;
  let bestFrontDanHits = 0;
  let worstFrontDanHits = Infinity;
  let allFrontDanRecommendations = [];
  let allBackDanRecommendations = [];
  let allBackTuoRecommendations = [];
  
  const { restore } = suppressConsole();
  
  try {
    for (let r = 0; r < repeatCount; r++) {
      // 清除缓存，确保每次采样是独立的新计算
      analyzer._frequencyAnalyzer.clearCache();
      analyzer._omissionCalculator.clearCache();
      analyzer._trendAnalyzer.clearCache();
      analyzer._conditionalProbability.clearCache();
      analyzer._correlationAnalyzer.clearCache();
      
      // 调用真实优化器
      const frontResult = FrontDanOptimizer.optimize(analyzer, danCount, strategy);
      const backDanResult = BackDanOptimizer.optimize(analyzer, backDanCount, strategy);
      const backTuoResult = BackTuoOptimizer.optimize(analyzer, backDanResult.selected, tuoCount, strategy);
      
      const frontDanHits = frontResult.selected.filter(n => testData.front.includes(n)).length;
      const backDanHits = backDanResult.selected.filter(n => testData.back.includes(n)).length;
      const backTuoHits = backTuoResult.selected.filter(n => testData.back.includes(n)).length;
      const backCoverage = backDanHits + backTuoHits; // 胆+拖总覆盖
      
      totalFrontDanHits += frontDanHits;
      totalBackDanHits += backDanHits;
      totalBackTuoHits += backTuoHits;
      totalBackCoverage += backCoverage;
      bestFrontDanHits = Math.max(bestFrontDanHits, frontDanHits);
      worstFrontDanHits = Math.min(worstFrontDanHits, frontDanHits);
      
      allFrontDanRecommendations.push(frontResult.selected);
      allBackDanRecommendations.push(backDanResult.selected);
      allBackTuoRecommendations.push(backTuoResult.selected);
    }
  } finally {
    restore();
  }
  
  const avgFrontDanHits = totalFrontDanHits / repeatCount;
  const avgBackDanHits = totalBackDanHits / repeatCount;
  const avgBackTuoHits = totalBackTuoHits / repeatCount;
  const avgBackCoverage = totalBackCoverage / repeatCount;
  const frontHitAtLeast1 = allFrontDanRecommendations.some(rec => rec.some(n => testData.front.includes(n)));
  
  // 统计推荐号码频率（哪些号码被推荐最多）
  const frontDanFreq = {};
  const backDanFreq = {};
  const backTuoFreq = {};
  for (const rec of allFrontDanRecommendations) {
    for (const n of rec) frontDanFreq[n] = (frontDanFreq[n] || 0) + 1;
  }
  for (const rec of allBackDanRecommendations) {
    for (const n of rec) backDanFreq[n] = (backDanFreq[n] || 0) + 1;
  }
  for (const rec of allBackTuoRecommendations) {
    for (const n of rec) backTuoFreq[n] = (backTuoFreq[n] || 0) + 1;
  }
  
  // Top推荐号码（出现频率最高）
  const topFrontDan = Object.entries(frontDanFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, danCount)
    .map(([num]) => parseInt(num, 10))
    .sort((a, b) => a - b);
  const topBackDan = Object.entries(backDanFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, backDanCount)
    .map(([num]) => parseInt(num, 10))
    .sort((a, b) => a - b);
  
  // 确定性推荐的命中（取出现频率最高的号码作为确定性推荐）
  const deterministicFrontHits = topFrontDan.filter(n => testData.front.includes(n)).length;
  const deterministicBackHits = topBackDan.filter(n => testData.back.includes(n)).length;
  
  // 后区拖码命中率（随机采样）
  const backTuoHitAtLeast1 = allBackTuoRecommendations.some(rec => rec.some(n => testData.back.includes(n)));
  // 后区胆拖总覆盖率（≥1个中奖号被胆或拖覆盖）
  const backCoverageAtLeast1 = allBackDanRecommendations.some((danRec, idx) => {
    const tuoRec = allBackTuoRecommendations[idx];
    const covered = [...danRec, ...tuoRec];
    return testData.back.some(n => covered.includes(n));
  });
  const backCoverageBoth = allBackDanRecommendations.some((danRec, idx) => {
    const tuoRec = allBackTuoRecommendations[idx];
    const covered = [...danRec, ...tuoRec];
    return testData.back.every(n => covered.includes(n));
  });
  
  return {
    period: testIndex,
    actualFront: testData.front,
    actualBack: testData.back,
    avgFrontDanHits,
    avgBackDanHits,
    avgBackTuoHits,
    avgBackCoverage,
    bestFrontDanHits,
    worstFrontDanHits,
    frontHitAtLeast1,
    deterministicFrontHits,
    deterministicBackHits,
    backTuoHitAtLeast1,
    backCoverageAtLeast1,
    backCoverageBoth,
    topFrontDan,
    topBackDan,
    frontDanFreq,
    backDanFreq,
    backTuoFreq,
    danCount,
    backDanCount,
    tuoCount
  };
}

/**
 * 主回测函数
 */
function runBacktest(totalPeriods = 200, strategies = ['hot', 'balanced', 'conservative'], repeatCount = 10) {
  console.log('🎯 策略回测 v2（使用真实优化器算法）\n');
  console.log(`参数: 回测期数=${totalPeriods}, 策略=${strategies.join(', ')}, 每期重复=${repeatCount}次`);
  console.log('='.repeat(70));
  
  const historyData = loadHistoryData();
  
  const maxTestablePeriods = historyData.length;
  if (maxTestablePeriods < totalPeriods) {
    console.warn(`⚠️ 历史数据不足${totalPeriods}期，实际使用${maxTestablePeriods}期`);
    totalPeriods = maxTestablePeriods;
  }
  
  const results = {};
  const startTime = Date.now();
  
  for (const strategy of strategies) {
    console.log(`\n📊 回测策略: ${strategy} (${getDanCount(strategy)}前区胆, ${getBackDanCount(strategy)}后区胆)`);
    console.log('-'.repeat(70));
    
    const periodResults = [];
    let sumAvgFrontHits = 0;
    let sumAvgBackHits = 0;
    let sumAvgBackTuoHits = 0;
    let sumAvgBackCoverage = 0;
    let frontHitAtLeast1Count = 0;
    let deterministicFrontHitCount = 0;
    let deterministicBackHitCount = 0;
    let backCoverageAtLeast1Count = 0;
    let backCoverageBothCount = 0;
    
    // 从第50期开始回测（确保有足够训练数据）
    const startIdx = 50;
    
    for (let i = startIdx; i < totalPeriods; i++) {
      const result = backtestSinglePeriod(historyData, i, strategy, repeatCount);
      if (result) {
        periodResults.push(result);
        sumAvgFrontHits += result.avgFrontDanHits;
        sumAvgBackHits += result.avgBackDanHits;
        sumAvgBackTuoHits += result.avgBackTuoHits;
        sumAvgBackCoverage += result.avgBackCoverage;
        if (result.frontHitAtLeast1) frontHitAtLeast1Count++;
        if (result.deterministicFrontHits > 0) deterministicFrontHitCount++;
        if (result.deterministicBackHits > 0) deterministicBackHitCount++;
        if (result.backCoverageAtLeast1) backCoverageAtLeast1Count++;
        if (result.backCoverageBoth) backCoverageBothCount++;
      }
    }
    
    const validPeriods = periodResults.length;
    const avgFrontHits = sumAvgFrontHits / validPeriods;
    const avgBackHits = sumAvgBackHits / validPeriods;
    const avgBackTuoHits = sumAvgBackTuoHits / validPeriods;
    const avgBackCoverage = sumAvgBackCoverage / validPeriods;
    const frontHitRate = frontHitAtLeast1Count / validPeriods;
    const deterministicFrontHitRate = deterministicFrontHitCount / validPeriods;
    const deterministicBackHitRate = deterministicBackHitCount / validPeriods;
    const backCoverageAtLeast1Rate = backCoverageAtLeast1Count / validPeriods;
    const backCoverageBothRate = backCoverageBothCount / validPeriods;
    
    // 前区胆码命中分布（随机采样平均）
    const frontHitDistribution = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of periodResults) {
      const bestHit = r.bestFrontDanHits;
      const distKey = Math.min(bestHit, 4);
      frontHitDistribution[distKey]++;
    }
    
    // 确定性推荐命中分布
    const deterministicDistribution = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of periodResults) {
      const hits = Math.min(r.deterministicFrontHits, 4);
      deterministicDistribution[hits]++;
    }
    
    results[strategy] = {
      validPeriods,
      avgFrontHits,
      avgBackHits,
      avgBackTuoHits,
      avgBackCoverage,
      frontHitRate,
      deterministicFrontHitRate,
      deterministicBackHitRate,
      backCoverageAtLeast1Rate,
      backCoverageBothRate,
      frontHitDistribution,
      deterministicDistribution,
      periodResults,
      danCount: getDanCount(strategy),
      backDanCount: getBackDanCount(strategy),
      tuoCount: getBackTuoCount(strategy)
    };
    
    console.log(`  有效回测期数: ${validPeriods}`);
    console.log(`  前区胆码数: ${getDanCount(strategy)}, 后区胆码数: ${getBackDanCount(strategy)}, 后区拖码数: ${getBackTuoCount(strategy)}`);
    console.log(`  随机采样(每期${repeatCount}次):`);
    console.log(`    平均前区胆码命中: ${avgFrontHits.toFixed(3)}个`);
    console.log(`    平均后区胆码命中: ${avgBackHits.toFixed(3)}个`);
    console.log(`    平均后区拖码命中: ${avgBackTuoHits.toFixed(3)}个`);
    console.log(`    平均后区胆拖总覆盖: ${avgBackCoverage.toFixed(3)}个`);
    console.log(`    至少中1前区胆率: ${(frontHitRate * 100).toFixed(1)}%`);
    console.log(`    后区胆拖≥1覆盖率: ${(backCoverageAtLeast1Rate * 100).toFixed(1)}%`);
    console.log(`    后区胆拖全中率: ${(backCoverageBothRate * 100).toFixed(1)}%`);
    console.log(`  确定性推荐(Top频率号码):`);
    console.log(`    至少中1前区胆率: ${(deterministicFrontHitRate * 100).toFixed(1)}%`);
    console.log(`    至少中1后区胆率: ${(deterministicBackHitRate * 100).toFixed(1)}%`);
    console.log(`  最佳采样命中分布:`);
    for (let k = 0; k <= 4; k++) {
      if (frontHitDistribution[k] !== undefined) {
        const pct = validPeriods > 0 ? (frontHitDistribution[k] / validPeriods * 100).toFixed(1) : '0.0';
        console.log(`    ${k}胆命中: ${frontHitDistribution[k]}期 (${pct}%)`);
      }
    }
    console.log(`  确定性推荐命中分布:`);
    for (let k = 0; k <= getDanCount(strategy); k++) {
      if (deterministicDistribution[k] !== undefined) {
        const pct = validPeriods > 0 ? (deterministicDistribution[k] / validPeriods * 100).toFixed(1) : '0.0';
        console.log(`    ${k}胆命中: ${deterministicDistribution[k]}期 (${pct}%)`);
      }
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // 对比总结
  console.log('\n' + '='.repeat(70));
  console.log('📈 策略对比总结');
  console.log('='.repeat(70));
  console.log('策略\t\t| 胆数 | 随机命中≥1 | 确定前≥1 | 确定后≥1 | 后区≥1覆盖 | 后区全中');
  console.log('-'.repeat(70));
  
  for (const [strategy, data] of Object.entries(results)) {
    const dan = `${data.danCount}+${data.backDanCount}+${data.tuoCount}`;
    console.log(
      `${strategy.padEnd(12)}| ${dan.padStart(7)} | ${(data.frontHitRate * 100).toFixed(1).padStart(12)}% | ${(data.deterministicFrontHitRate * 100).toFixed(1).padStart(8)}% | ${(data.deterministicBackHitRate * 100).toFixed(1).padStart(8)}% | ${(data.backCoverageAtLeast1Rate * 100).toFixed(1).padStart(8)}% | ${(data.backCoverageBothRate * 100).toFixed(1).padStart(6)}%`
    );
  }
  
  console.log(`\n⏱️ 回测耗时: ${elapsed}秒`);
  
  // 计算随机基线（用于对比）
  // 如果纯随机选N个胆码，命中率是多少？
  console.log('\n📊 随机基线对比（纯随机选号的期望命中率）:');
  // 后区1胆+4拖随机基线
  const randomBackCoverageAtLeast1 = 1 - (7/12)*(6/11); // ≈68.2%
  const randomBackCoverageBoth = (5/12)*(4/11); // ≈15.2%
  
  for (const [strategy, data] of Object.entries(results)) {
    const frontDan = data.danCount;
    const backDan = data.backDanCount;
    // 前区随机选中至少1个的概率 = 1 - C(30,frontDan)/C(35,frontDan)
    const randomFrontProb = 1 - comb(30, frontDan) / comb(35, frontDan);
    const randomBackProb = 1 - comb(10, backDan) / comb(12, backDan);
    const frontImprovement = data.deterministicFrontHitRate / randomFrontProb;
    const backDanImprovement = data.deterministicBackHitRate / randomBackProb;
    const backCoverageImprovement = data.backCoverageAtLeast1Rate / randomBackCoverageAtLeast1;
    const backBothImprovement = data.backCoverageBothRate / randomBackCoverageBoth;
    console.log(
      `  ${strategy}: ` +
      `前区确定≥1=${(data.deterministicFrontHitRate*100).toFixed(1)}% (随机${(randomFrontProb*100).toFixed(1)}%, ${frontImprovement.toFixed(2)}x); ` +
      `后区胆≥1=${(data.deterministicBackHitRate*100).toFixed(1)}% (随机${(randomBackProb*100).toFixed(1)}%, ${backDanImprovement.toFixed(2)}x); ` +
      `后区胆拖≥1=${(data.backCoverageAtLeast1Rate*100).toFixed(1)}% (随机${(randomBackCoverageAtLeast1*100).toFixed(1)}%, ${backCoverageImprovement.toFixed(2)}x); ` +
      `后区全中=${(data.backCoverageBothRate*100).toFixed(1)}% (随机${(randomBackCoverageBoth*100).toFixed(1)}%, ${backBothImprovement.toFixed(2)}x)`
    );
  }
  
  // 保存详细结果
  const outputPath = join(__dirname, 'backtest-v2-results.json');
  // 不保存所有periodResults（太大），只保存统计摘要
  const summary = {};
  for (const [strategy, data] of Object.entries(results)) {
    summary[strategy] = {
      validPeriods: data.validPeriods,
      danCount: data.danCount,
      backDanCount: data.backDanCount,
      tuoCount: data.tuoCount,
      avgFrontHits: data.avgFrontHits,
      avgBackHits: data.avgBackHits,
      avgBackTuoHits: data.avgBackTuoHits,
      avgBackCoverage: data.avgBackCoverage,
      frontHitRate: data.frontHitRate,
      deterministicFrontHitRate: data.deterministicFrontHitRate,
      deterministicBackHitRate: data.deterministicBackHitRate,
      backCoverageAtLeast1Rate: data.backCoverageAtLeast1Rate,
      backCoverageBothRate: data.backCoverageBothRate,
      frontHitDistribution: data.frontHitDistribution,
      deterministicDistribution: data.deterministicDistribution,
      // 保存部分典型期的详细数据（前5期、最后5期、中间5期）
      samplePeriods: data.periodResults.filter((_, idx) => 
        idx < 5 || idx > data.periodResults.length - 6 || idx % 20 === 0
      ).map(r => ({
        period: r.period,
        actualFront: r.actualFront,
        actualBack: r.actualBack,
        topFrontDan: r.topFrontDan,
        topBackDan: r.topBackDan,
        deterministicFrontHits: r.deterministicFrontHits,
        deterministicBackHits: r.deterministicBackHits,
        avgFrontDanHits: r.avgFrontDanHits,
        frontDanFreq: r.frontDanFreq
      }))
    };
  }
  summary.meta = {
    totalPeriods,
    strategies,
    repeatCount,
    historyDataLength: historyData.length,
    startIdx: 50,
    elapsed,
    timestamp: new Date().toISOString()
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n💾 详细结果已保存到: ${outputPath}`);
  
  return results;
}

// 组合数计算
function comb(n, k) {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= (n - i) / (i + 1);
  }
  return result;
}

// 解析命令行参数
const args = process.argv.slice(2);
const totalPeriods = args[0] ? parseInt(args[0], 10) : 200;
const strategyArg = args[1] || 'all';
const repeatCount = args[2] ? parseInt(args[2], 10) : 10;
const strategies = strategyArg === 'all' 
  ? ['hot', 'balanced', 'conservative'] 
  : [strategyArg];

// 执行回测
runBacktest(totalPeriods, strategies, repeatCount);