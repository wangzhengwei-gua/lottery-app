/**
 * 参数敏感性分析工具
 * 对每个维度进行消融实验（ablation study），评估各维度对命中率的贡献
 * 
 * 使用方法: node scripts/sensitivity-v1.js [策略] [期数] [重复次数]
 *   - 策略: hot/balanced/conservative，默认hot
 *   - 期数: 回测期数，默认214
 *   - 重复次数: 每期重复采样次数，默认5
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 维度定义（名称、中文名、所属策略）
const DIMENSION_DEFS = {
  hot: [
    { key: 'heatSignal', label: '热度信号(遗漏+频率)', weight: '~20分' },
    { key: 'freqRatio', label: '近期频率逆袭', weight: '6分' },
    { key: 'conditionalProb', label: '条件概率', weight: '15分' },
    { key: 'timeDecay', label: '时间衰减', weight: '10分' },
    { key: 'zone5Trend', label: '5小区趋势+必出区强化', weight: '~20分' },
    { key: 'repeatCooling', label: '胆码重号降温', weight: '-1~-2分' },
    { key: 'momentum', label: '动量加速', weight: '5分' },
    { key: 'coolingPenalty', label: '冷却惩罚', weight: '-5分' },
    { key: 'zoneSaturation', label: '区间饱和度调节', weight: '±5分' },
    { key: 'historicalSimilarity', label: '历史形态相似度', weight: '5分' },
    { key: 'consecutive', label: '连号协同', weight: '5分' },
    { key: 'zoneAntiExtreme', label: '区间防极端', weight: '-3分' },
  ],
  balanced: [
    { key: 'freqMomentum', label: '频率+动量', weight: '15分' },
    { key: 'conditionalProb', label: '条件概率', weight: '30分' },
    { key: 'omissionDeviation', label: '遗漏偏离度', weight: '20分' },
    { key: 'timeDecay', label: '时间衰减', weight: '15分' },
    { key: 'freqTrend', label: '频率趋势', weight: '10分' },
    { key: 'zone5Trend', label: '5小区动态趋势', weight: '10分' },
    { key: 'consecutive', label: '连号协同', weight: '5分' },
  ],
  conservative: [
    { key: 'freqMomentum', label: '频率+动量', weight: '8分' },
    { key: 'conditionalProb', label: '条件概率', weight: '25分' },
    { key: 'omissionDeviation', label: '遗漏偏离度', weight: '25分' },
    { key: 'timeDecay', label: '时间衰减', weight: '15分' },
    { key: 'freqTrend', label: '频率趋势', weight: '7分' },
    { key: 'zone5Trend', label: '5小区动态趋势', weight: '7分' },
    { key: 'consecutive', label: '连号协同', weight: '3分' },
  ]
};

const BACK_DIMENSION_DEFS = {
  hot: [
    { key: 'conditionalProb', label: '条件概率', weight: '15分' },
    { key: 'omissionDeviation', label: '遗漏偏离度', weight: '20分' },
    { key: 'freqMomentum', label: '频率+动量+恒热', weight: '15分' },
    { key: 'timeDecay', label: '时间衰减', weight: '10分' },
    { key: 'freqTrend', label: '频率趋势', weight: '10分' },
    { key: 'zone4Trend', label: '4小区动态趋势', weight: '18分' },
    { key: 'repeatFactor', label: '重号因子', weight: '10分' },
    { key: 'coolingPenalty', label: '冷却惩罚', weight: '-5分' },
  ],
  balanced: [
    { key: 'conditionalProb', label: '条件概率', weight: '20分' },
    { key: 'omissionDeviation', label: '遗漏偏离度', weight: '20分' },
    { key: 'freqMomentum', label: '频率+动量', weight: '15分' },
    { key: 'timeDecay', label: '时间衰减', weight: '15分' },
    { key: 'freqTrend', label: '频率趋势', weight: '15分' },
    { key: 'zone4Trend', label: '4小区动态趋势', weight: '15分' },
  ],
  conservative: [
    { key: 'conditionalProb', label: '条件概率', weight: '20分' },
    { key: 'omissionDeviation', label: '遗漏偏离度', weight: '20分' },
    { key: 'freqMomentum', label: '频率+动量', weight: '15分' },
    { key: 'timeDecay', label: '时间衰减', weight: '15分' },
    { key: 'freqTrend', label: '频率趋势', weight: '15分' },
    { key: 'zone4Trend', label: '4小区动态趋势', weight: '15分' },
  ]
};

// BacktestAnalyzer（与 backtest-v2.js 相同）
class BacktestAnalyzer {
  constructor(historyData) {
    this.historyData = historyData;
    this.dataWindow = 0;
    const frontNumbers = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1);
    const backNumbers = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1);
    this._frequencyAnalyzer = new FrequencyAnalyzer(historyData, () => this.getActiveData());
    this._omissionCalculator = new OmissionCalculator(historyData, () => this.getActiveData(), frontNumbers, backNumbers);
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
      historyData.push({ front: parts.slice(0, 5).map(n => parseInt(n, 10)), back: parts.slice(5, 7).map(n => parseInt(n, 10)) });
    }
  }
  return historyData;
}

function getDanCount(strategy) { return 4; }
function getBackDanCount() { return 1; }

function suppressConsole() {
  const orig = console.log;
  const origW = console.warn;
  console.log = () => {};
  console.warn = () => {};
  return { restore: () => { console.log = orig; console.warn = origW; } };
}

function clearAnalyzerCache(analyzer) {
  analyzer._frequencyAnalyzer.clearCache();
  analyzer._omissionCalculator.clearCache();
  analyzer._trendAnalyzer.clearCache();
  analyzer._conditionalProbability.clearCache();
  analyzer._correlationAnalyzer.clearCache();
}

/**
 * 运行单维度消融回测
 * @param {string} strategy - 策略
 * @param {string} area - 'front' 或 'back'
 * @param {string} dimKey - 要消融的维度key
 * @param {Object} baselineMultipliers - 基线倍率对象
 * @param {Array} historyData - 历史数据
 * @param {number} totalPeriods - 回测期数
 * @param {number} repeatCount - 每期重复次数
 */
function runAblationBacktest(strategy, area, dimKey, baselineMultipliers, historyData, totalPeriods, repeatCount) {
  const ablationMultipliers = { ...baselineMultipliers };
  ablationMultipliers[dimKey] = 0; // 消融：将该维度权重设为0
  
  const danCount = area === 'front' ? getDanCount(strategy) : getBackDanCount();
  let totalHits = 0;
  let hitAtLeast1Count = 0;
  let validPeriods = 0;
  
  const { restore } = suppressConsole();
  try {
    for (let i = 50; i < totalPeriods; i++) {
      const trainData = historyData.slice(0, i);
      const testData = historyData[i];
      if (trainData.length < 50) continue;
      
      const analyzer = new BacktestAnalyzer(trainData);
      const actualNums = area === 'front' ? testData.front : testData.back;
      
      for (let r = 0; r < repeatCount; r++) {
        clearAnalyzerCache(analyzer);
        
        let result;
        if (area === 'front') {
          result = FrontDanOptimizer.optimize(analyzer, danCount, strategy, ablationMultipliers);
        } else {
          result = BackDanOptimizer.optimize(analyzer, danCount, strategy, ablationMultipliers);
        }
        
        const hits = result.selected.filter(n => actualNums.includes(n)).length;
        totalHits += hits;
        if (hits > 0) hitAtLeast1Count++;
      }
      validPeriods++;
    }
  } finally {
    restore();
  }
  
  const totalSamples = validPeriods * repeatCount;
  const avgHits = totalSamples > 0 ? totalHits / totalSamples : 0;
  const hitRate = totalSamples > 0 ? hitAtLeast1Count / totalSamples : 0;
  
  return { avgHits, hitRate, validPeriods, totalSamples };
}

/**
 * 运行基线回测（所有维度=1.0）
 */
function runBaselineBacktest(strategy, area, baselineMultipliers, historyData, totalPeriods, repeatCount) {
  const danCount = area === 'front' ? getDanCount(strategy) : getBackDanCount();
  let totalHits = 0;
  let hitAtLeast1Count = 0;
  let validPeriods = 0;
  
  const { restore } = suppressConsole();
  try {
    for (let i = 50; i < totalPeriods; i++) {
      const trainData = historyData.slice(0, i);
      const testData = historyData[i];
      if (trainData.length < 50) continue;
      
      const analyzer = new BacktestAnalyzer(trainData);
      const actualNums = area === 'front' ? testData.front : testData.back;
      
      for (let r = 0; r < repeatCount; r++) {
        clearAnalyzerCache(analyzer);
        
        let result;
        if (area === 'front') {
          result = FrontDanOptimizer.optimize(analyzer, danCount, strategy, baselineMultipliers);
        } else {
          result = BackDanOptimizer.optimize(analyzer, danCount, strategy, baselineMultipliers);
        }
        
        const hits = result.selected.filter(n => actualNums.includes(n)).length;
        totalHits += hits;
        if (hits > 0) hitAtLeast1Count++;
      }
      validPeriods++;
    }
  } finally {
    restore();
  }
  
  const totalSamples = validPeriods * repeatCount;
  const avgHits = totalSamples > 0 ? totalHits / totalSamples : 0;
  const hitRate = totalSamples > 0 ? hitAtLeast1Count / totalSamples : 0;
  
  return { avgHits, hitRate, validPeriods, totalSamples };
}

/**
 * 运行倍率放大回测（某维度权重*2）
 */
function runAmplifiedBacktest(strategy, area, dimKey, baselineMultipliers, historyData, totalPeriods, repeatCount) {
  const amplifiedMultipliers = { ...baselineMultipliers };
  amplifiedMultipliers[dimKey] = 2;
  
  return runAblationBacktest(strategy, area, dimKey, amplifiedMultipliers, historyData, totalPeriods, repeatCount);
  // 注意：这里实际上是运行倍率=2的回测，不是消融
  // 但函数名有误导，逻辑是对的：传入的是amplifiedMultipliers
  // 实际 runAblationBacktest 内部会把 dimKey 设为 0
  // 所以我需要用一个不同的方法
}

// 修正：重新写一个放大回测函数
function runDoubleWeightBacktest(strategy, area, dimKey, baselineMultipliers, historyData, totalPeriods, repeatCount) {
  const amplifiedMultipliers = { ...baselineMultipliers };
  amplifiedMultipliers[dimKey] = 2; // 放大：将该维度权重设为2
  
  const danCount = area === 'front' ? getDanCount(strategy) : getBackDanCount();
  let totalHits = 0;
  let hitAtLeast1Count = 0;
  let validPeriods = 0;
  
  const { restore } = suppressConsole();
  try {
    for (let i = 50; i < totalPeriods; i++) {
      const trainData = historyData.slice(0, i);
      const testData = historyData[i];
      if (trainData.length < 50) continue;
      
      const analyzer = new BacktestAnalyzer(trainData);
      const actualNums = area === 'front' ? testData.front : testData.back;
      
      for (let r = 0; r < repeatCount; r++) {
        clearAnalyzerCache(analyzer);
        
        let result;
        if (area === 'front') {
          result = FrontDanOptimizer.optimize(analyzer, danCount, strategy, amplifiedMultipliers);
        } else {
          result = BackDanOptimizer.optimize(analyzer, danCount, strategy, amplifiedMultipliers);
        }
        
        const hits = result.selected.filter(n => actualNums.includes(n)).length;
        totalHits += hits;
        if (hits > 0) hitAtLeast1Count++;
      }
      validPeriods++;
    }
  } finally {
    restore();
  }
  
  const totalSamples = validPeriods * repeatCount;
  const avgHits = totalSamples > 0 ? totalHits / totalSamples : 0;
  const hitRate = totalSamples > 0 ? hitAtLeast1Count / totalSamples : 0;
  
  return { avgHits, hitRate, validPeriods, totalSamples };
}

// 主函数
function runSensitivityAnalysis(strategy, totalPeriods, repeatCount) {
  const historyData = loadHistoryData();
  totalPeriods = Math.min(totalPeriods, historyData.length);
  
  console.log(`\n🔬 参数敏感性分析 - 策略: ${strategy}`);
  console.log(`回测期数: ${totalPeriods}, 每期重复: ${repeatCount}次`);
  console.log('='.repeat(80));
  
  // 前区维度定义
  const frontDims = DIMENSION_DEFS[strategy];
  // 后区维度定义
  const backDims = BACK_DIMENSION_DEFS[strategy];
  
  // 构建基线倍率（全部=1.0）
  const frontBaseline = {};
  for (const dim of frontDims) frontBaseline[dim.key] = 1;
  const backBaseline = {};
  for (const dim of backDims) backBaseline[dim.key] = 1;
  
  // 运行基线回测
  console.log('\n📊 运行基线回测（所有维度权重=1.0）...');
  const frontBaselineResult = runBaselineBacktest(strategy, 'front', frontBaseline, historyData, totalPeriods, repeatCount);
  const backBaselineResult = runBaselineBacktest(strategy, 'back', backBaseline, historyData, totalPeriods, repeatCount);
  
  console.log(`  前区基线: 平均命中=${frontBaselineResult.avgHits.toFixed(3)}, ≥1命中率=${(frontBaselineResult.hitRate*100).toFixed(1)}%`);
  console.log(`  后区基线: 平均命中=${backBaselineResult.avgHits.toFixed(3)}, ≥1命中率=${(backBaselineResult.hitRate*100).toFixed(1)}%`);
  
  // 前区消融实验
  console.log('\n📊 前区维度消融实验（逐一移除维度，观察命中率变化）');
  console.log('-'.repeat(80));
  console.log('维度\t\t\t| 权重 | 基线≥1% | 消融≥1% | Δ% | 基线avg | 消融avg | Δavg | 贡献度');
  console.log('-'.repeat(80));
  
  const frontResults = [];
  for (const dim of frontDims) {
    const ablationResult = runAblationBacktest(strategy, 'front', dim.key, frontBaseline, historyData, totalPeriods, repeatCount);
    const deltaRate = frontBaselineResult.hitRate - ablationResult.hitRate;
    const deltaAvg = frontBaselineResult.avgHits - ablationResult.avgHits;
    const contribution = deltaRate * 100; // 正=维度有正面贡献，负=维度有负面贡献
    
    frontResults.push({
      key: dim.key,
      label: dim.label,
      weight: dim.weight,
      baselineRate: frontBaselineResult.hitRate,
      ablationRate: ablationResult.hitRate,
      deltaRate,
      baselineAvg: frontBaselineResult.avgHits,
      ablationAvg: ablationResult.avgHits,
      deltaAvg,
      contribution
    });
    
    const labelStr = dim.label.padEnd(22);
    const wStr = dim.weight.padEnd(6);
    const bRate = (frontBaselineResult.hitRate * 100).toFixed(1).padStart(6);
    const aRate = (ablationResult.hitRate * 100).toFixed(1).padStart(6);
    const dRate = (deltaRate >= 0 ? '+' : '') + (deltaRate * 100).toFixed(1).padStart(5);
    const bAvg = frontBaselineResult.avgHits.toFixed(3).padStart(7);
    const aAvg = ablationResult.avgHits.toFixed(3).padStart(7);
    const dAvg = (deltaAvg >= 0 ? '+' : '') + deltaAvg.toFixed(3).padStart(6);
    const contrib = (contribution >= 0 ? '+' : '') + contribution.toFixed(1).padStart(5);
    
    console.log(`${labelStr}| ${wStr}| ${bRate}% | ${aRate}% | ${dRate}% | ${bAvg} | ${aAvg} | ${dAvg} | ${contrib}%`);
  }
  
  // 按贡献度排序
  frontResults.sort((a, b) => b.contribution - a.contribution);
  
  console.log('\n📈 前区维度贡献度排名（从大到小）:');
  for (let i = 0; i < frontResults.length; i++) {
    const r = frontResults[i];
    const sign = r.contribution >= 0 ? '✅ 正贡献' : '❌ 负贡献';
    console.log(`  #${i+1} ${r.label}(${r.weight}): ${sign} ${r.contribution >= 0 ? '+' : ''}${r.contribution.toFixed(1)}% (移除后命中率从 ${(r.baselineRate*100).toFixed(1)}% 变为 ${(r.ablationRate*100).toFixed(1)}%)`);
  }
  
  // 前区倍率放大实验（仅对前3个正贡献最大的维度）
  const top3Positive = frontResults.filter(r => r.contribution > 0).slice(0, 3);
  if (top3Positive.length > 0) {
    console.log('\n📊 前区维度放大实验（权重×2，观察命中率变化）');
    console.log('-'.repeat(80));
    for (const r of top3Positive) {
      const amplifiedResult = runDoubleWeightBacktest(strategy, 'front', r.key, frontBaseline, historyData, totalPeriods, repeatCount);
      const delta = (amplifiedResult.hitRate - frontBaselineResult.hitRate) * 100;
      console.log(`  ${r.label} ×2: ≥1命中率 ${(amplifiedResult.hitRate*100).toFixed(1)}% (基线 ${(frontBaselineResult.hitRate*100).toFixed(1)}%, Δ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`);
    }
  }
  
  // 后区消融实验
  console.log('\n📊 后区维度消融实验');
  console.log('-'.repeat(80));
  console.log('维度\t\t\t| 权重 | 基线≥1% | 消融≥1% | Δ% | 贡献度');
  console.log('-'.repeat(80));
  
  const backResults = [];
  for (const dim of backDims) {
    const ablationResult = runAblationBacktest(strategy, 'back', dim.key, backBaseline, historyData, totalPeriods, repeatCount);
    const deltaRate = backBaselineResult.hitRate - ablationResult.hitRate;
    const contribution = deltaRate * 100;
    
    backResults.push({
      key: dim.key,
      label: dim.label,
      weight: dim.weight,
      baselineRate: backBaselineResult.hitRate,
      ablationRate: ablationResult.hitRate,
      deltaRate,
      contribution
    });
    
    const labelStr = dim.label.padEnd(22);
    const wStr = dim.weight.padEnd(6);
    const bRate = (backBaselineResult.hitRate * 100).toFixed(1).padStart(6);
    const aRate = (ablationResult.hitRate * 100).toFixed(1).padStart(6);
    const dRate = (deltaRate >= 0 ? '+' : '') + (deltaRate * 100).toFixed(1).padStart(5);
    const contrib = (contribution >= 0 ? '+' : '') + contribution.toFixed(1).padStart(5);
    
    console.log(`${labelStr}| ${wStr}| ${bRate}% | ${aRate}% | ${dRate}% | ${contrib}%`);
  }
  
  backResults.sort((a, b) => b.contribution - a.contribution);
  
  console.log('\n📈 后区维度贡献度排名:');
  for (let i = 0; i < backResults.length; i++) {
    const r = backResults[i];
    const sign = r.contribution >= 0 ? '✅ 正贡献' : '❌ 负贡献';
    console.log(`  #${i+1} ${r.label}(${r.weight}): ${sign} ${r.contribution >= 0 ? '+' : ''}${r.contribution.toFixed(1)}%`);
  }
  
  // 保存结果
  const output = {
    strategy,
    totalPeriods,
    repeatCount,
    frontBaseline: frontBaselineResult,
    backBaseline: backBaselineResult,
    frontAblationResults: frontResults.map(r => ({ ...r, baselineRate: r.baselineRate * 100, ablationRate: r.ablationRate * 100, deltaRate: r.deltaRate * 100 })),
    backAblationResults: backResults.map(r => ({ ...r, baselineRate: r.baselineRate * 100, ablationRate: r.ablationRate * 100, deltaRate: r.deltaRate * 100 })),
    frontDimensionDefs: frontDims,
    backDimensionDefs: backDims,
    meta: { timestamp: new Date().toISOString() }
  };
  
  const outputPath = join(__dirname, `sensitivity-${strategy}-results.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n💾 结果已保存到: ${outputPath}`);
  
  // 关键结论总结
  console.log('\n' + '='.repeat(80));
  console.log('🔑 关键结论');
  console.log('='.repeat(80));
  
  const positiveDims = frontResults.filter(r => r.contribution > 1);
  const negativeDims = frontResults.filter(r => r.contribution < -1);
  const neutralDims = frontResults.filter(r => Math.abs(r.contribution) <= 1);
  
  if (positiveDims.length > 0) {
    console.log('✅ 正贡献维度（移除后命中率显著下降）:');
    for (const r of positiveDims) {
      console.log(`  - ${r.label}: +${r.contribution.toFixed(1)}%`);
    }
  }
  if (negativeDims.length > 0) {
    console.log('❌ 负贡献维度（移除后命中率反而上升 → 该维度在拖累整体表现）:');
    for (const r of negativeDims) {
      console.log(`  - ${r.label}: ${r.contribution.toFixed(1)}%`);
    }
  }
  if (neutralDims.length > 0) {
    console.log('⚪ 中性维度（贡献极小，可考虑移除以降低复杂度）:');
    for (const r of neutralDims) {
      console.log(`  - ${r.label}: ${r.contribution.toFixed(1)}%`);
    }
  }
}

// 解析参数
const args = process.argv.slice(2);
const strategy = args[0] || 'hot';
const totalPeriods = args[1] ? parseInt(args[1], 10) : 214;
const repeatCount = args[2] ? parseInt(args[2], 10) : 5;

console.log('🔬 参数敏感性分析工具 v1');
console.log(`使用方法: node scripts/sensitivity-v1.js [策略] [期数] [重复次数]`);
console.log(`当前配置: 策略=${strategy}, 期数=${totalPeriods}, 重复=${repeatCount}`);

runSensitivityAnalysis(strategy, totalPeriods, repeatCount);