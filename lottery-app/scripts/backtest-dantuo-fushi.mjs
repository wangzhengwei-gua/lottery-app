/**
 * 胆拖+复式算法回测脚本（纯Node版本）
 * 用最近2期(217-218)开奖号码验证算法缺陷
 * 
 * 由于ES模块依赖链复杂，本脚本采用简化策略：
 * 1. 直接解析历史数据，手动计算关键统计指标
 * 2. 模拟各算法的评分逻辑（频率、遗漏、条件概率等）
 * 3. 对比推荐结果与实际开奖
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===== 配置常量 =====
const FRONT_RANGE = 35;
const BACK_RANGE = 12;
const FRONT_COUNT = 5;
const BACK_COUNT = 2;

// ===== 读取并解析历史数据 =====
const dataPath = join(__dirname, '../src/data/lottery-history.txt');
const rawData = readFileSync(dataPath, 'utf-8');
const allLines = rawData.trim().split('\n');

console.log('='.repeat(80));
console.log('📊 胆拖+复式算法回测验证（简化版）');
console.log('='.repeat(80));
console.log(`总历史数据: ${allLines.length}期`);

// 解析为结构化数据
const historyData = allLines.map(line => {
  const nums = line.trim().split(/\s+/).map(Number);
  return { front: nums.slice(0, FRONT_COUNT), back: nums.slice(FRONT_COUNT), full: nums };
});

// ===== 测试期目标 =====
const testDraws = [
  { index: 216, front: [6, 16, 18, 19, 28], back: [7, 11], label: '第217期' },
  { index: 217, front: [3, 11, 12, 21, 22], back: [6, 10], label: '第218期' }
];

console.log('\n🎯 回测目标:');
for (const draw of testDraws) {
  console.log(`  ${draw.label}: 前区[${draw.front.join(',')}] 后区[${draw.back.join(',')}]`);
}

// ===== 核心统计计算函数 =====
function calculateFrequency(data) {
  const frontFreq = {};
  const backFreq = {};
  for (let i = 1; i <= FRONT_RANGE; i++) frontFreq[i] = 0;
  for (let i = 1; i <= BACK_RANGE; i++) backFreq[i] = 0;
  for (const draw of data) {
    for (const num of draw.front) frontFreq[num]++;
    for (const num of draw.back) backFreq[num]++;
  }
  return [frontFreq, backFreq];
}

function calculateRecentFrequency(data, recentCount = 30) {
  const recent = data.slice(-Math.min(recentCount, data.length));
  const [frontFreq, backFreq] = calculateFrequency(recent);
  // 动量：近10期频率 - 近30期频率（趋势信号）
  const momentum10 = data.slice(-Math.min(10, data.length));
  const [frontFreq10, backFreq10] = calculateFrequency(momentum10);
  const frontMomentum = {};
  const backMomentum = {};
  const rc = recent.length;
  const mc = momentum10.length;
  for (let i = 1; i <= FRONT_RANGE; i++) {
    frontMomentum[i] = (frontFreq10[i] || 0) / mc - (frontFreq[i] || 0) / rc;
  }
  for (let i = 1; i <= BACK_RANGE; i++) {
    backMomentum[i] = (backFreq10[i] || 0) / mc - (backFreq[i] || 0) / rc;
  }
  return { frontFreq, backFreq, frontMomentum, backMomentum, recentCount: rc, momentumCount: mc };
}

function calculateOmission(data) {
  // 遗漏值 = 当前到最近一次出现的期数间隔
  // 如果号码从未出现，遗漏值=数据总期数
  const frontOmission = {};
  const backOmission = {};
  for (let i = 1; i <= FRONT_RANGE; i++) frontOmission[i] = data.length;
  for (let i = 1; i <= BACK_RANGE; i++) backOmission[i] = data.length;
  // 从最新期往旧期找，首次出现的位置即为遗漏值
  for (let idx = data.length - 1; idx >= 0; idx--) {
    for (const num of data[idx].front) {
      // 遗漏 = 从最新一期(idx=data.length-1)到该号最近出现的期数差
      if (frontOmission[num] === data.length) {
        frontOmission[num] = data.length - 1 - idx;
      }
    }
    for (const num of data[idx].back) {
      if (backOmission[num] === data.length) {
        backOmission[num] = data.length - 1 - idx;
      }
    }
  }
  return { front: frontOmission, back: backOmission };
}

function getAverageOmission(omission, area) {
  const vals = Object.values(omission[area]);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function getOmissionStd(omission, area, avg) {
  const vals = Object.values(omission[area]);
  const variance = vals.reduce((a, v) => a + (v - avg) ** 2, 0) / vals.length;
  return Math.sqrt(variance);
}

function getZone7(num) { return Math.floor((num - 1) / 5) + 1; }
function getZone5(num) { return Math.floor((num - 1) / 7) + 1; }

function calculateZone5Prediction(data) {
  // 5小区趋势预测
  const zone5Absence = {};
  const zone5Prediction = {};
  const dataLen = data.length;
  for (let z = 1; z <= 5; z++) zone5Absence[z] = 0;
  for (let idx = dataLen - 1; idx >= 0; idx--) {
    for (const num of data[idx].front) {
      const z5 = getZone5(num);
      if (zone5Absence[z5] === 0) zone5Absence[z5] = dataLen - 1 - idx;
    }
  }
  for (let z = 1; z <= 5; z++) {
    if (zone5Absence[z] >= 3) zone5Prediction[z] = 'must';
    else if (zone5Absence[z] >= 2) zone5Prediction[z] = 'very_likely';
    else if (zone5Absence[z] === 1) zone5Prediction[z] = 'likely_warm';
    else zone5Prediction[z] = 'warming';
  }
  return { zone5Absence, zone5Prediction };
}

// 黄金回归/斐波那契节奏（简化版）
const PHI = 0.618;
const PHI_INV = 1.618;
const FIBONACCI = [1, 1, 2, 3, 5, 8, 13, 21, 34];

function goldenRegressionBonus(omission, avgOmission, sigma) {
  let bonus = 0;
  const shallowRegression = avgOmission * PHI;
  const deepRegression = avgOmission * PHI_INV;
  const diffShallow = Math.abs(omission - shallowRegression);
  const diffDeep = Math.abs(omission - deepRegression);
  if (diffShallow < sigma * 0.5) bonus += 2;
  else if (diffShallow < sigma) bonus += 1;
  if (diffDeep < sigma * 0.5) bonus += 3;
  else if (diffDeep < sigma) bonus += 1.5;
  return Math.min(bonus, 4);
}

function fibonacciRhythmBonus(omission) {
  if (FIBONACCI.includes(omission)) {
    if (omission <= 8) return 1.5;
    if (omission === 13) return 2;
    return 1;
  }
  if (FIBONACCI.some(f => Math.abs(omission - f) === 1)) return 0.5;
  return 0;
}

// ===== 简化版评分算法 =====
function scoreFrontNumbers(trainData, strategy = 'hot') {
  const [frontFreq] = calculateFrequency(trainData);
  const recentFreq = calculateRecentFrequency(trainData);
  const omission = calculateOmission(trainData);
  const avgFrontOmission = getAverageOmission(omission, 'front');
  const omissionStd = getOmissionStd(omission, 'front', avgFrontOmission);
  const maxFreq = Math.max(...Object.values(frontFreq));
  const maxMomentum = Math.max(...Object.values(recentFreq.frontMomentum).map(m => Math.abs(m)));
  const { zone5Prediction } = calculateZone5Prediction(trainData);
  
  const lastDraw = trainData[trainData.length - 1];
  // 近10期重号率
  const recent10 = trainData.slice(-10);
  let recent10RepeatSum = 0;
  for (let i = 1; i < recent10.length; i++) {
    recent10RepeatSum += recent10[i].front.filter(n => recent10[i-1].front.includes(n)).length;
  }
  const recent10RepeatRate = recent10.length > 1 ? recent10RepeatSum / (recent10.length - 1) : 0;
  
  // 动量加速度
  const veryRecentCount = Math.min(10, trainData.length);
  const veryRecentData = trainData.slice(-veryRecentCount);
  const veryRecentFreq = {};
  for (let i = 1; i <= FRONT_RANGE; i++) veryRecentFreq[i] = 0;
  for (const draw of veryRecentData) for (const num of draw.front) veryRecentFreq[num]++;
  
  const scored = [];
  for (let num = 1; num <= FRONT_RANGE; num++) {
    let score = 0;
    const freq = frontFreq[num] || 0;
    const momentum = recentFreq.frontMomentum[num] || 0;
    const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
    const currentOmission = omission.front[num] || 0;
    
    if (strategy === 'hot') {
      // 热号4维: heatSignal + zone5Trend + repeatCooling + momentum
      const rawOmissionScore = Math.max(0, 15 - (currentOmission / avgFrontOmission) * 15);
      const omissionBaseScore = Math.min(rawOmissionScore, 12);
      const freqBoost = maxFreq > 0 ? (freq / maxFreq) * 5 : 0;
      score += (omissionBaseScore + freqBoost) * 2.0;
      
      const z5 = getZone5(num);
      const pred = zone5Prediction[z5];
      if (pred === 'must') score += 15 + 5;
      else if (pred === 'very_likely') score += 12;
      else if (pred === 'likely_warm') score += 7;
      else if (pred === 'warming') score += 3;
      else score -= 3;
      
      if (lastDraw && lastDraw.front.includes(num)) {
        const coolingPenalty = recent10RepeatRate > 2.0 ? 2 : recent10RepeatRate < 1.0 ? 1 : 1.5;
        score -= coolingPenalty;
      }
      
      const veryRecentRate = (veryRecentFreq[num] || 0) / veryRecentCount;
      const mediumRecentRate = (recentFreq.frontFreq[num] || 0) / recentFreq.recentCount;
      const acceleration = veryRecentRate - mediumRecentRate;
      const maxAccel = Math.max(...Array.from({length: FRONT_RANGE}, (_, i) => i+1)
        .map(n => ((veryRecentFreq[n] || 0) / veryRecentCount) - ((recentFreq.frontFreq[n] || 0) / recentFreq.recentCount))
        .filter(a => a > 0), 0.001);
      if (acceleration > 0 && maxAccel > 0) score += (acceleration / maxAccel) * 5 * 2.0;
      
    } else {
      // 均衡/保守4维: freqMomentum + conditionalProb(简化) + omissionDeviation + zone5Trend
      const freqBase = maxFreq > 0 ? (freq / maxFreq) * (strategy === 'balanced' ? 10 : 6) : 0;
      score += (freqBase + Math.max(0, normalizedMomentum) * (strategy === 'balanced' ? 5 : 2));
      
      // 条件概率简化版：用近5期共现频率近似
      const recent5 = trainData.slice(-5);
      let condProb = 0;
      for (const draw of recent5) {
        if (draw.front.includes(num)) condProb += 0.2;
      }
      score += condProb * (strategy === 'balanced' ? 30 : 25);
      
      // 遗漏偏离度 + 黄金回归 + 斐波那契节奏
      const omissionDeviation = currentOmission - avgFrontOmission;
      const absDeviation = Math.abs(omissionDeviation);
      const sigma2 = omissionStd * 2;
      let omissionDevRaw = 0;
      const devBaseMax = strategy === 'balanced' ? 10 : 13;
      if (absDeviation >= sigma2 && sigma2 > 0) omissionDevRaw = devBaseMax;
      else if (sigma2 > 0) omissionDevRaw = (absDeviation / sigma2) * devBaseMax;
      if (omissionDeviation > 0) {
        const highMax = strategy === 'balanced' ? 7 : 10;
        let strategyBonus = 0;
        if (omissionDeviation >= sigma2 && sigma2 > 0) strategyBonus = highMax;
        else if (sigma2 > 0) strategyBonus = (omissionDeviation / sigma2) * highMax;
        omissionDevRaw += strategyBonus;
      }
      omissionDevRaw += goldenRegressionBonus(currentOmission, avgFrontOmission, omissionStd);
      omissionDevRaw += fibonacciRhythmBonus(currentOmission);
      score += omissionDevRaw;
      
      const z5 = getZone5(num);
      const pred = zone5Prediction[z5];
      const zone5Max = strategy === 'balanced' ? 10 : 7;
      if (pred === 'must') score += zone5Max;
      else if (pred === 'very_likely') score += strategy === 'balanced' ? 7 : 4;
      else if (pred === 'likely_warm') score += strategy === 'balanced' ? 3 : 2;
      else if (pred === 'warming') score += 1;
      else score -= strategy === 'balanced' ? 2 : 1;
    }
    
    scored.push({ number: num, score, omission: currentOmission, freq });
  }
  
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function scoreBackNumbers(trainData, strategy = 'balanced') {
  const [, backFreq] = calculateFrequency(trainData);
  const recentFreq = calculateRecentFrequency(trainData);
  const omission = calculateOmission(trainData);
  const avgBackOmission = getAverageOmission(omission, 'back');
  const omissionStd = getOmissionStd(omission, 'back', avgBackOmission);
  const maxFreq = Math.max(...Object.values(backFreq));
  const lastDraw = trainData[trainData.length - 1];
  
  const scored = [];
  for (let num = 1; num <= BACK_RANGE; num++) {
    let score = 0;
    const freq = backFreq[num] || 0;
    const currentOmission = omission.back[num] || 0;
    const omissionDeviation = currentOmission - avgBackOmission;
    
    // 条件概率简化：近5期出现频率
    const recent5 = trainData.slice(-5);
    let condProb = 0;
    for (const draw of recent5) {
      if (draw.back.includes(num)) condProb += 0.5;
    }
    score += condProb * (strategy === 'hot' ? 15 : 20);
    
    // 遗漏回归 + 黄金回归 + 斐波那契节奏
    const absDeviation = Math.abs(omissionDeviation);
    const omissionNormalized = omissionStd > 0 ? Math.min(absDeviation / (2 * omissionStd), 1) : 0;
    let omissionDevRaw = (1 - omissionNormalized) * 10;
    if (strategy === 'hot') {
      if (omissionDeviation < 0) {
        const maxNeg = Math.max(...Object.values(omission.back).map(o => (o||0) - avgBackOmission).filter(d => d < 0).map(d => Math.abs(d)));
        omissionDevRaw += (maxNeg > 0 ? Math.abs(omissionDeviation) / maxNeg : 0) * 10;
      }
    } else {
      if (omissionDeviation > 0) {
        const maxPos = Math.max(...Object.values(omission.back).map(o => (o||0) - avgBackOmission).filter(d => d > 0));
        omissionDevRaw += (maxPos > 0 ? omissionDeviation / maxPos : 0) * (strategy === 'conservative' ? 5 : 4);
        if (omissionDeviation > omissionStd * 2) omissionDevRaw += strategy === 'conservative' ? 3 : 2;
      }
    }
    omissionDevRaw += goldenRegressionBonus(currentOmission, avgBackOmission, omissionStd);
    omissionDevRaw += fibonacciRhythmBonus(currentOmission);
    score += omissionDevRaw;
    
    // 频率+动量
    const freqBase = maxFreq > 0 ? (freq / maxFreq) * 10 : 0;
    const momentum = recentFreq.backMomentum[num] || 0;
    const maxMomentum = Math.max(...Object.values(recentFreq.backMomentum).map(m => Math.abs(m)));
    const normalizedMomentum = maxMomentum > 0 ? momentum / maxMomentum : 0;
    score += freqBase + Math.max(0, normalizedMomentum) * 5;
    
    // 时间衰减（简化版）
    const recent10 = trainData.slice(-10);
    let timeScore = 0;
    for (let idx = 0; idx < recent10.length; idx++) {
      if (recent10[idx].back.includes(num)) timeScore += Math.exp((idx - recent10.length + 1) / recent10.length);
    }
    score += timeScore * (strategy === 'hot' ? 10 : 15);
    
    // 重号（热号策略）
    if (strategy === 'hot' && lastDraw && lastDraw.back.includes(num)) {
      score += 10;
    }
    
    scored.push({ number: num, score, omission: currentOmission, freq });
  }
  
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ===== 执行回测 =====
function runBacktestForDraw(draw) {
  const trainData = historyData.slice(0, draw.index);
  
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🔍 ${draw.label}回测 - 训练数据: ${trainData.length}期`);
  console.log(`   实际开奖: 前区[${draw.front.join(',')}] 后区[${draw.back.join(',')}]`);
  console.log(`${'─'.repeat(60)}`);
  
  // 遗漏数据分析
  const omission = calculateOmission(trainData);
  const avgFrontOmission = getAverageOmission(omission, 'front');
  const avgBackOmission = getAverageOmission(omission, 'back');
  
  console.log('\n  📋 开奖号遗漏值分析:');
  for (const num of draw.front) {
    const om = omission.front[num] || 0;
    const dev = om - avgFrontOmission;
    const ratio = avgFrontOmission > 0 ? om / avgFrontOmission : 0;
    const goldenShallow = avgFrontOmission * PHI;
    const goldenDeep = avgFrontOmission * PHI_INV;
    const nearGolden = Math.abs(om - goldenShallow) < avgFrontOmission * 0.3 || Math.abs(om - goldenDeep) < avgFrontOmission * 0.3;
    const nearFib = FIBONACCI.includes(om);
    console.log(`    #${num}: 遗漏=${om} avg=${avgFrontOmission.toFixed(1)} 偏离=${dev.toFixed(1)} 比率=${ratio.toFixed(2)} ${dev < 0 ? '热号' : dev > avgFrontOmission ? '冷号' : '中等'} ${nearGolden ? '⭐黄金回归点' : ''} ${nearFib ? '⭐斐波那契节奏' : ''}`);
  }
  for (const num of draw.back) {
    const om = omission.back[num] || 0;
    const dev = om - avgBackOmission;
    const ratio = avgBackOmission > 0 ? om / avgBackOmission : 0;
    console.log(`    后区#${num}: 遗漏=${om} avg=${avgBackOmission.toFixed(1)} 偏离=${dev.toFixed(1)} 比率=${ratio.toFixed(2)}`);
  }
  
  const results = {};
  
  // ===== 胆拖推荐测试 =====
  for (const strategy of ['hot', 'balanced', 'conservative']) {
    const frontScored = scoreFrontNumbers(trainData, strategy);
    const backScored = scoreBackNumbers(trainData, strategy);
    
    for (const danCount of [2, 3, 4]) {
      const frontDan = frontScored.slice(0, danCount).map(s => s.number);
      // 拖码：排除胆码后的top10
      const frontTuo = frontScored.filter(s => !frontDan.includes(s.number)).slice(0, 10).map(s => s.number);
      const backDan = [backScored[0].number];
      const backTuo = backScored.filter(s => s.number !== backDan[0]).slice(0, 4).map(s => s.number);
      
      const frontDanHits = frontDan.filter(n => draw.front.includes(n));
      const frontTuoHits = frontTuo.filter(n => draw.front.includes(n));
      const frontPoolHits = [...frontDan, ...frontTuo].filter(n => draw.front.includes(n));
      const backDanHits = backDan.filter(n => draw.back.includes(n));
      const backPoolHits = [...backDan, ...backTuo].filter(n => draw.back.includes(n));
      const frontMissed = draw.front.filter(n => !frontDan.includes(n) && !frontTuo.includes(n));
      const backMissed = draw.back.filter(n => !backDan.includes(n) && !backTuo.includes(n));
      
      const key = `${strategy}_${danCount}胆`;
      results[key] = {
        frontDan, frontTuo, backDan, backTuo,
        frontDanHitCount: frontDanHits.length, frontTuoHitCount: frontTuoHits.length,
        frontPoolHitCount: frontPoolHits.length,
        backDanHitCount: backDanHits.length, backPoolHitCount: backPoolHits.length,
        frontMissed, backMissed,
        frontDanAtLeast1: frontDanHits.length >= 1,
      };
      
      console.log(`  [${key}] 前区胆[${frontDan.join(',')}]→命中${frontDanHits.length} 拖[${frontTuo.join(',')}]→命中${frontTuoHits.length} 池命中${frontPoolHits.length}/5 后区胆[${backDan.join(',')}]→命中${backDanHits.length} 池命中${backPoolHits.length}/2`);
      if (frontDanHits.length > 0) console.log(`    ✅ 胆码命中: ${frontDanHits.join(',')}`);
      if (frontMissed.length > 0) console.log(`    ❌ 漏号: ${frontMissed.join(',')}`);
    }
  }
  
  // ===== 杀号测试（简化版） =====
  // 用评分最低的号码作为杀号候选
  const frontScoredAll = scoreFrontNumbers(trainData, 'balanced');
  const frontBottom = frontScoredAll.slice(-8).map(s => s.number);
  const frontFalseKill = draw.front.filter(n => frontBottom.includes(n));
  console.log(`  [杀号模拟] 杀低评分8个[${frontBottom.join(',')}] 误杀${frontFalseKill.length}个(${frontFalseKill.join(',')})`);
  
  return results;
}

// ===== 执行 =====
const allResults = {};
for (const draw of testDraws) {
  allResults[draw.label] = runBacktestForDraw(draw);
}

// ===== 综合缺陷诊断 =====
console.log('\n' + '='.repeat(80));
console.log('🔬 综合缺陷诊断报告');
console.log('='.repeat(80));

// 收集所有漏号频率
const allFrontMissed = {};
const allBackMissed = {};
const totalTests = 0;

for (const [label, res] of Object.entries(allResults)) {
  for (const [key, detail] of Object.entries(res)) {
    for (const missed of detail.frontMissed) {
      allFrontMissed[missed] = (allFrontMissed[missed] || 0) + 1;
    }
    for (const missed of detail.backMissed) {
      allBackMissed[missed] = (allBackMissed[missed] || 0) + 1;
    }
  }
}

console.log('\n📌 前区最频繁漏号（所有策略汇总）:');
const frontMissSorted = Object.entries(allFrontMissed).sort((a, b) => b[1] - a[1]);
for (const [num, count] of frontMissSorted) {
  console.log(`  #${num}: 被漏掉${count}次`);
}

console.log('\n📌 后区最频繁漏号:');
const backMissSorted = Object.entries(allBackMissed).sort((a, b) => b[1] - a[1]);
for (const [num, count] of backMissSorted) {
  console.log(`  后区#${num}: 被漏掉${count}次`);
}

// ===== 胆码命中率对比 =====
console.log('\n📌 胆码命中率对比:');
const randomExpect3 = 5 * 3 / 35; // 3胆随机期望0.43个
for (const [label, res] of Object.entries(allResults)) {
  console.log(`  ${label}:`);
  for (const [key, detail] of Object.entries(res)) {
    const danCount = parseInt(key.split('_')[1]);
    const randomExpect = 5 * danCount / 35;
    console.log(`    ${key}: 胆码命中${detail.frontDanHitCount}/${danCount}(${(detail.frontDanHitCount/danCount*100).toFixed(1)}%) 随机期望${(randomExpect*100).toFixed(1)}% 池命中${detail.frontPoolHitCount}/5(${(detail.frontPoolHitCount/5*100).toFixed(1)}%) 胆码≥1:${detail.frontDanAtLeast1 ? '✅' : '❌'}`);
  }
}

// ===== 开奖号特征分析 =====
console.log('\n📌 两期开奖号特征:');
for (const draw of testDraws) {
  const frontSum = draw.front.reduce((a,b) => a+b, 0);
  const backSum = draw.back.reduce((a,b) => a+b, 0);
  const oddCount = draw.front.filter(n => n % 2 !== 0).length;
  const evenCount = draw.front.length - oddCount;
  const bigCount = draw.front.filter(n => n > 18).length;
  const smallCount = draw.front.length - bigCount;
  const acDiffs = new Set();
  for (let i = 0; i < draw.front.length; i++) {
    for (let j = i+1; j < draw.front.length; j++) {
      acDiffs.add(Math.abs(draw.front[i] - draw.front[j]));
    }
  }
  const acValue = acDiffs.size - draw.front.length + 1;
  const zoneDist = draw.front.map(n => `区${getZone7(n)}`);
  const zone1 = draw.front.filter(n => n <= 12).length;
  const zone2 = draw.front.filter(n => n >= 13 && n <= 24).length;
  const zone3 = draw.front.filter(n => n >= 25).length;
  
  console.log(`  ${draw.label} [${draw.front.join(',')}]:`);
  console.log(`    和值=${frontSum}(黄金区间[72-108]${frontSum >=72 && frontSum<=108 ? '✅' : '❌'}) AC=${acValue} 奇偶=${oddCount}:${evenCount} 大小=${bigCount}:${smallCount} 三区=${zone1}:${zone2}:${zone3}`);
  console.log(`    后区和值=${backSum} 后区[${draw.back.join(',')}]`);
}

// ===== 关键缺陷根因 =====
console.log('\n' + '='.repeat(80));
console.log('🔍 关键缺陷根因分析与优化方向');
console.log('='.repeat(80));

// 分析: 开奖号的遗漏/频率/区间特征 vs 算法评分排名
for (const draw of testDraws) {
  const trainData = historyData.slice(0, draw.index);
  const frontScored = scoreFrontNumbers(trainData, 'balanced');
  
  console.log(`\n  ${draw.label} 开奖号在算法评分中的排名:`);
  for (const num of draw.front) {
    const rank = frontScored.findIndex(s => s.number === num) + 1;
    const scoreDetail = frontScored.find(s => s.number === num);
    console.log(`    #${num}: 评分排名#${rank} 总分=${scoreDetail?.score?.toFixed(1) || 'N/A'} 遗漏=${scoreDetail?.omission || 0} 频率=${scoreDetail?.freq || 0} ${rank <= 14 ? '✅进入号码池' : '❌未进号码池(排名过低)'}`);
  }
  for (const num of draw.back) {
    const backScored = scoreBackNumbers(trainData, 'balanced');
    const rank = backScored.findIndex(s => s.number === num) + 1;
    const scoreDetail = backScored.find(s => s.number === num);
    console.log(`    后区#${num}: 评分排名#${rank} 总分=${scoreDetail?.score?.toFixed(1) || 'N/A'} 遗漏=${scoreDetail?.omission || 0}`);
  }
}

// ===== 诊断总结 =====
console.log('\n📌 诊断总结:');
console.log('  1. 如果开奖号排名>14（未进入14+10=24号码池）→ 算法评分维度遗漏了该号的关键特征');
console.log('  2. 如果热号策略对冷号回归的漏号率高 → 热号策略过度追热，遗漏回归信号不足');
console.log('  3. 如果保守策略对热号漏号率高 → 保守策略过度追遗漏，对近期频繁号码评分过低');
console.log('  4. 如果后区漏号率高 → 后区12选2难度大，胆码1不命中=全军覆没风险');
console.log('  5. 如果黄金回归点号码命中率高于非回归点 → 黄金回归维度有价值');
console.log('  6. 如果斐波那契节奏号码命中率高于非节奏点 → 斐波那契节奏维度有价值');

console.log('\n✅ 回测完成！');
