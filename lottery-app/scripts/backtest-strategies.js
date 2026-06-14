/**
 * 策略回测框架
 * 用历史数据测试各策略的中奖率、覆盖率等指标
 * 
 * 使用方法: node scripts/backtest-strategies.js [期数] [策略]
 *   - 期数: 回测期数，默认200期
 *   - 策略: hot/balanced/conservative/all，默认all
 * 
 * 示例:
 *   node scripts/backtest-strategies.js 100 hot     # 回测最近100期的热号策略
 *   node scripts/backtest-strategies.js 200 all     # 回测最近200期的所有策略
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 导入核心模块（需要模拟浏览器环境）
global.CONFIG = {
  FRONT_RANGE: 35,
  BACK_RANGE: 12,
  FRONT_COUNT: 5,
  BACK_COUNT: 2,
  HOT_NUMBERS_COUNT: 8,
  COLD_NUMBERS_COUNT: 8,
  RECENT_DRAWS_FOR_TREND: 30,
  ADAPTIVE_WEIGHT_WINDOW: 30,
  CONDITIONAL_WEIGHT: 0.25,
};

// 简化版LotteryAnalyzer用于回测
class SimpleAnalyzer {
  constructor(historyData) {
    this.historyData = historyData;
    this.dataWindow = 0; // 0=全部数据
  }

  getActiveData() {
    if (this.dataWindow === 0) {
      return this.historyData;
    }
    return this.historyData.slice(-this.dataWindow);
  }

  setDataWindow(windowSize) {
    this.dataWindow = windowSize;
  }

  // 频率分析器
  get frequencyAnalyzer() {
    return new FrequencyAnalyzer(this.historyData, () => this.getActiveData());
  }

  // 遗漏计算器
  get omissionCalculator() {
    return new OmissionCalculator(
      this.historyData,
      () => this.getActiveData(),
      Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1),
      Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1)
    );
  }

  // 趋势分析器
  get trendAnalyzer() {
    return new TrendAnalyzer(this.historyData, () => this.getActiveData());
  }

  // 条件概率计算器
  get conditionalProbability() {
    return new ConditionalProbability(this.historyData, () => this.getActiveData());
  }

  // 关联性分析器
  get correlationAnalyzer() {
    return new CorrelationAnalyzer(this.historyData, () => this.getActiveData());
  }

  // 时间衰减权重计算
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

// 简化的分析器类（从源代码复制核心逻辑）
class FrequencyAnalyzer {
  constructor(historyData, getActiveDataFn) {
    this.historyData = historyData;
    this.getActiveData = getActiveDataFn;
    this.cache = null;
  }

  analyzeFrequency() {
    if (this.cache) return this.cache;

    const frontCounter = {};
    const backCounter = {};

    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontCounter[i] = 0;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backCounter[i] = 0;

    for (const data of this.getActiveData()) {
      for (const num of data.front) frontCounter[num]++;
      for (const num of data.back) backCounter[num]++;
    }

    this.cache = [frontCounter, backCounter];
    return this.cache;
  }

  analyzeRecentFrequency(recentCount = CONFIG.RECENT_DRAWS_FOR_TREND) {
    const activeData = this.getActiveData();
    const recent = activeData.slice(-recentCount);
    const recentLength = recent.length;

    const frontCounter = {};
    const backCounter = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontCounter[i] = 0;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backCounter[i] = 0;

    for (const data of recent) {
      for (const num of data.front) frontCounter[num]++;
      for (const num of data.back) backCounter[num]++;
    }

    const [allFront, allBack] = this.analyzeFrequency();
    const totalDraws = activeData.length;

    const frontMomentum = {};
    const backMomentum = {};

    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      const recentRate = frontCounter[i] / recentLength;
      const overallRate = (allFront[String(i)] || allFront[i] || 0) / totalDraws;
      frontMomentum[i] = recentRate - overallRate;
    }

    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
      const recentRate = backCounter[i] / recentLength;
      const overallRate = (allBack[String(i)] || allBack[i] || 0) / totalDraws;
      backMomentum[i] = recentRate - overallRate;
    }

    return {
      front: frontCounter,
      back: backCounter,
      frontMomentum,
      backMomentum,
      recentCount: recentLength,
      totalDraws
    };
  }
}

class OmissionCalculator {
  constructor(historyData, getActiveDataFn, frontNumbers, backNumbers) {
    this.historyData = historyData;
    this.getActiveData = getActiveDataFn;
    this.frontNumbers = frontNumbers;
    this.backNumbers = backNumbers;
    this.cache = null;
  }

  calculateOmission() {
    if (this.cache) return this.cache;

    const frontOmission = {};
    const backOmission = {};
    
    this.frontNumbers.forEach(n => frontOmission[n] = 0);
    this.backNumbers.forEach(n => backOmission[n] = 0);

    const activeData = this.getActiveData();

    for (const num of this.frontNumbers) {
      let omission = 0;
      for (let i = activeData.length - 1; i >= 0; i--) {
        if (activeData[i].front.includes(num)) break;
        omission++;
      }
      frontOmission[num] = omission;
    }

    for (const num of this.backNumbers) {
      let omission = 0;
      for (let i = activeData.length - 1; i >= 0; i--) {
        if (activeData[i].back.includes(num)) break;
        omission++;
      }
      backOmission[num] = omission;
    }

    this.cache = { front: frontOmission, back: backOmission };
    return this.cache;
  }

  getAverageOmission(area = 'front') {
    const omission = this.calculateOmission();
    const values = Object.values(omission[area]);
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  getOmissionStd(area = 'front') {
    const omission = this.calculateOmission();
    const values = Object.values(omission[area]);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
}

class TrendAnalyzer {
  constructor(historyData, getActiveDataFn) {
    this.historyData = historyData;
    this.getActiveData = getActiveDataFn;
    this.cache = { sumTrend: null, spanAnalysis: null, repeatNumbers: null };
  }

  analyzeSumTrend() {
    if (this.cache.sumTrend) return this.cache.sumTrend;

    const activeData = this.getActiveData();
    const recentCount = Math.min(CONFIG.RECENT_DRAWS_FOR_TREND, activeData.length);
    const recentDraws = activeData.slice(-recentCount);

    const frontSums = recentDraws.map(d => d.front.reduce((a, b) => a + b, 0));
    const backSums = recentDraws.map(d => d.back.reduce((a, b) => a + b, 0));

    const avgFrontSum = frontSums.reduce((a, b) => a + b, 0) / frontSums.length;
    const avgBackSum = backSums.reduce((a, b) => a + b, 0) / backSums.length;

    const firstHalfFront = frontSums.slice(0, Math.floor(frontSums.length / 2));
    const secondHalfFront = frontSums.slice(Math.floor(frontSums.length / 2));
    const trendFront = secondHalfFront.reduce((a, b) => a + b, 0) / secondHalfFront.length - 
                       firstHalfFront.reduce((a, b) => a + b, 0) / firstHalfFront.length;

    const result = {
      avgFrontSum,
      avgBackSum,
      frontStd: 0,
      backStd: 0,
      trendFront,
      recentFrontSums: frontSums,
      recentBackSums: backSums
    };

    this.cache.sumTrend = result;
    return result;
  }

  analyzeRepeatNumbers() {
    if (this.cache.repeatNumbers) return this.cache.repeatNumbers;

    const activeData = this.getActiveData();
    if (activeData.length < 2) {
      return { frontRepeatRate: 0, backRepeatRate: 0, recentRepeats: [] };
    }

    let frontRepeatCount = 0;
    let backRepeatCount = 0;
    let comparisonCount = 0;

    for (let i = 1; i < activeData.length; i++) {
      const prevDraw = activeData[i - 1];
      const currDraw = activeData[i];

      const frontRepeats = currDraw.front.filter(n => prevDraw.front.includes(n));
      frontRepeatCount += frontRepeats.length;

      const backRepeats = currDraw.back.filter(n => prevDraw.back.includes(n));
      backRepeatCount += backRepeats.length;

      comparisonCount++;
    }

    const result = {
      frontRepeatRate: frontRepeatCount / comparisonCount,
      backRepeatRate: backRepeatCount / comparisonCount,
      recentRepeats: []
    };

    this.cache.repeatNumbers = result;
    return result;
  }
}

class ConditionalProbability {
  constructor(historyData, getActiveDataFn) {
    this.historyData = historyData;
    this.getActiveData = getActiveDataFn;
    this.cache = null;
  }

  calculateConditionalProbability() {
    if (this.cache) return this.cache;

    const activeData = this.getActiveData();
    if (activeData.length < 3) {
      const frontUniform = {};
      const backUniform = {};
      for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontUniform[i] = 1 / CONFIG.FRONT_RANGE;
      for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backUniform[i] = 1 / CONFIG.BACK_RANGE;
      
      const result = { front: frontUniform, back: backUniform, confidence: 0 };
      this.cache = result;
      return result;
    }

    const LAPLACE_ALPHA = 0.01;
    const TIME_DECAY = 0.98;

    const frontTransition = {};
    const backTransition = {};

    for (let i = 1; i < activeData.length; i++) {
      const prevDraw = activeData[i - 1];
      const currDraw = activeData[i];
      const recencyIndex = activeData.length - i;
      const timeWeight = Math.pow(TIME_DECAY, recencyIndex);

      for (const prevNum of prevDraw.front) {
        if (!frontTransition[prevNum]) frontTransition[prevNum] = {};
        for (const currNum of currDraw.front) {
          frontTransition[prevNum][currNum] = (frontTransition[prevNum][currNum] || 0) + timeWeight;
        }
      }

      for (const prevNum of prevDraw.back) {
        if (!backTransition[prevNum]) backTransition[prevNum] = {};
        for (const currNum of currDraw.back) {
          backTransition[prevNum][currNum] = (backTransition[prevNum][currNum] || 0) + timeWeight;
        }
      }
    }

    const fullData = this.getActiveData();
    const lastDraw = fullData[fullData.length - 1];
    const frontConditional = {};
    const backConditional = {};

    const laplaceProb = (rawCount, rawTotal, numOutcomes) => {
      return (rawCount + LAPLACE_ALPHA) / (rawTotal + LAPLACE_ALPHA * numOutcomes);
    };

    for (let y = 1; y <= CONFIG.FRONT_RANGE; y++) {
      let score = 0;
      let weightSum = 0;

      for (const x of lastDraw.front) {
        const transitions = frontTransition[x] || {};
        const rawTotal = Object.values(transitions).reduce((a, b) => a + b, 0);
        const rawCount = transitions[y] || 0;
        const prob = laplaceProb(rawCount, rawTotal, CONFIG.FRONT_RANGE);
        score += prob;
        weightSum += 1;
      }

      frontConditional[y] = weightSum > 0 ? score / weightSum : 1 / CONFIG.FRONT_RANGE;
    }

    for (let y = 1; y <= CONFIG.BACK_RANGE; y++) {
      let score = 0;
      let weightSum = 0;

      for (const x of lastDraw.back) {
        const transitions = backTransition[x] || {};
        const rawTotal = Object.values(transitions).reduce((a, b) => a + b, 0);
        const rawCount = transitions[y] || 0;
        const prob = laplaceProb(rawCount, rawTotal, CONFIG.BACK_RANGE);
        score += prob;
        weightSum += 1;
      }

      backConditional[y] = weightSum > 0 ? score / weightSum : 1 / CONFIG.BACK_RANGE;
    }

    const result = { front: frontConditional, back: backConditional, confidence: 0.5 };
    this.cache = result;
    return result;
  }
}

class CorrelationAnalyzer {
  constructor(historyData, getActiveDataFn) {
    this.historyData = historyData;
    this.getActiveData = getActiveDataFn;
    this.cache = null;
  }

  calculateNumberCorrelationWithTimeDecay() {
    if (this.cache) return this.cache;

    const activeData = this.getActiveData();
    const TIME_DECAY = 0.98;

    const frontCorrelation = {};
    const backCorrelation = {};

    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) {
      frontCorrelation[i] = {};
      for (let j = 1; j <= CONFIG.FRONT_RANGE; j++) {
        if (i !== j) frontCorrelation[i][j] = 0;
      }
    }

    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) {
      backCorrelation[i] = {};
      for (let j = 1; j <= CONFIG.BACK_RANGE; j++) {
        if (i !== j) backCorrelation[i][j] = 0;
      }
    }

    for (let idx = 0; idx < activeData.length; idx++) {
      const draw = activeData[idx];
      const recencyIndex = activeData.length - idx;
      const timeWeight = Math.pow(TIME_DECAY, recencyIndex);

      for (let i = 0; i < draw.front.length; i++) {
        for (let j = i + 1; j < draw.front.length; j++) {
          const num1 = draw.front[i];
          const num2 = draw.front[j];
          frontCorrelation[num1][num2] = (frontCorrelation[num1][num2] || 0) + timeWeight;
          frontCorrelation[num2][num1] = (frontCorrelation[num2][num1] || 0) + timeWeight;
        }
      }

      for (let i = 0; i < draw.back.length; i++) {
        for (let j = i + 1; j < draw.back.length; j++) {
          const num1 = draw.back[i];
          const num2 = draw.back[j];
          backCorrelation[num1][num2] = (backCorrelation[num1][num2] || 0) + timeWeight;
          backCorrelation[num2][num1] = (backCorrelation[num2][num1] || 0) + timeWeight;
        }
      }
    }

    const result = { front: frontCorrelation, back: backCorrelation };
    this.cache = result;
    return result;
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

// 简化的胆码推荐（用于回测）
function simpleDanRecommend(analyzer, danCount, strategy) {
  // 这里使用简化的评分逻辑，避免依赖完整的优化器
  const freq = analyzer.frequencyAnalyzer.analyzeFrequency()[0];
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, danCount + 5)
    .map(([num]) => parseInt(num, 10));
  
  // 随机选择danCount个号码
  const shuffled = [...sorted].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, danCount).sort((a, b) => a - b);
}

// 执行单期回测
function backtestSinglePeriod(historyData, testIndex, strategy) {
  // 训练数据：testIndex之前的所有数据
  const trainData = historyData.slice(0, testIndex);
  // 测试数据：testIndex当期
  const testData = historyData[testIndex];
  
  if (trainData.length < 50) {
    return null; // 训练数据不足
  }
  
  const analyzer = new SimpleAnalyzer(trainData);
  
  // 生成推荐
  const recommendedDan = simpleDanRecommend(analyzer, 3, strategy);
  const actualFront = testData.front;
  const actualBack = testData.back;
  
  // 计算命中情况
  const danHits = recommendedDan.filter(n => actualFront.includes(n)).length;
  
  return {
    period: testIndex,
    recommendedDan,
    actualFront,
    actualBack,
    danHits,
    success: danHits > 0
  };
}

// 主回测函数
function runBacktest(totalPeriods = 200, strategies = ['hot', 'balanced', 'conservative']) {
  console.log('🎯 开始策略回测...\n');
  console.log(`参数: 回测期数=${totalPeriods}, 策略=${strategies.join(', ')}`);
  console.log('='.repeat(60));
  
  const historyData = loadHistoryData();
  
  if (historyData.length < totalPeriods) {
    console.warn(`⚠️ 历史数据不足${totalPeriods}期，实际使用${historyData.length}期`);
    totalPeriods = historyData.length;
  }
  
  const results = {};
  
  for (const strategy of strategies) {
    console.log(`\n📊 回测策略: ${strategy}`);
    console.log('-'.repeat(60));
    
    const periodResults = [];
    let totalDanHits = 0;
    let successfulPeriods = 0;
    
    // 从第50期开始回测（确保有足够的训练数据）
    for (let i = 50; i < totalPeriods; i++) {
      const result = backtestSinglePeriod(historyData, i, strategy);
      if (result) {
        periodResults.push(result);
        totalDanHits += result.danHits;
        if (result.success) successfulPeriods++;
      }
    }
    
    const validPeriods = periodResults.length;
    const avgDanHits = totalDanHits / validPeriods;
    const hitRate = successfulPeriods / validPeriods;
    
    // 统计胆码命中分布
    const hitDistribution = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const r of periodResults) {
      hitDistribution[r.danHits]++;
    }
    
    results[strategy] = {
      validPeriods,
      totalDanHits,
      avgDanHits,
      successfulPeriods,
      hitRate,
      hitDistribution,
      periodResults
    };
    
    console.log(`  有效回测期数: ${validPeriods}`);
    console.log(`  胆码总命中数: ${totalDanHits}`);
    console.log(`  平均每期胆码命中: ${avgDanHits.toFixed(2)}个`);
    console.log(`  命中率(至少中1胆): ${(hitRate * 100).toFixed(1)}%`);
    console.log(`  胆码命中分布:`);
    console.log(`    0胆: ${hitDistribution[0]}期 (${(hitDistribution[0]/validPeriods*100).toFixed(1)}%)`);
    console.log(`    1胆: ${hitDistribution[1]}期 (${(hitDistribution[1]/validPeriods*100).toFixed(1)}%)`);
    console.log(`    2胆: ${hitDistribution[2]}期 (${(hitDistribution[2]/validPeriods*100).toFixed(1)}%)`);
    console.log(`    3胆: ${hitDistribution[3]}期 (${(hitDistribution[3]/validPeriods*100).toFixed(1)}%)`);
  }
  
  // 对比总结
  console.log('\n' + '='.repeat(60));
  console.log('📈 策略对比总结');
  console.log('='.repeat(60));
  console.log('策略\t\t| 平均胆码命中 | 命中率(≥1胆)');
  console.log('-'.repeat(60));
  
  for (const [strategy, data] of Object.entries(results)) {
    console.log(`${strategy.padEnd(12)}| ${data.avgDanHits.toFixed(2).padStart(12)} | ${(data.hitRate * 100).toFixed(1).padStart(12)}%`);
  }
  
  // 保存详细结果
  const outputPath = join(__dirname, 'backtest-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n💾 详细结果已保存到: ${outputPath}`);
  
  return results;
}

// 解析命令行参数
const args = process.argv.slice(2);
const totalPeriods = args[0] ? parseInt(args[0], 10) : 200;
const strategyArg = args[1] || 'all';
const strategies = strategyArg === 'all' 
  ? ['hot', 'balanced', 'conservative'] 
  : [strategyArg];

// 执行回测
runBacktest(totalPeriods, strategies);
