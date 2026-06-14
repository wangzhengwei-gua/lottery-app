/**
 * 测试热号策略拖码推荐的区间分布
 * 运行方式: node scripts/test-hot-strategy-zone-distribution.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 模拟数据生成器
function generateMockData(count) {
  const data = [];
  for (let i = 0; i < count; i++) {
    // 随机生成前区5个号码（1-35）
    const front = new Set();
    while (front.size < 5) {
      front.add(Math.floor(Math.random() * 35) + 1);
    }
    
    // 随机生成后区2个号码（1-12）
    const back = new Set();
    while (back.size < 2) {
      back.add(Math.floor(Math.random() * 12) + 1);
    }
    
    data.push({
      front: Array.from(front).sort((a, b) => a - b),
      back: Array.from(back).sort((a, b) => a - b),
      date: `2026-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`
    });
  }
  return data;
}

// 7小区划分函数
function getZone(num) {
  if (num <= 5) return 1;
  if (num <= 10) return 2;
  if (num <= 15) return 3;
  if (num <= 20) return 4;
  if (num <= 25) return 5;
  if (num <= 30) return 6;
  return 7;
}

// 分析区间分布
function analyzeZoneDistribution(danNumbers, tuoNumbers) {
  const allNumbers = [...danNumbers, ...tuoNumbers];
  const zoneCounts = {};
  
  for (let z = 1; z <= 7; z++) {
    zoneCounts[z] = 0;
  }
  
  for (const num of allNumbers) {
    const zone = getZone(num);
    zoneCounts[zone]++;
  }
  
  // 计算连号对数
  let consecutivePairs = 0;
  const sorted = [...allNumbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i-1] === 1) {
      consecutivePairs++;
    }
  }
  
  // 统计各区内的连号情况
  const zoneConsecutive = {};
  for (let z = 1; z <= 7; z++) {
    const zoneNums = allNumbers.filter(n => getZone(n) === z).sort((a, b) => a - b);
    let pairs = 0;
    for (let i = 1; i < zoneNums.length; i++) {
      if (zoneNums[i] - zoneNums[i-1] === 1) {
        pairs++;
      }
    }
    zoneConsecutive[z] = pairs;
  }
  
  return {
    zoneCounts,
    totalConsecutive: consecutivePairs,
    zoneConsecutive,
    coveredZones: Object.values(zoneCounts).filter(c => c > 0).length
  };
}

console.log(' 热号策略拖码推荐区间分布测试\n');
console.log('=' .repeat(60));

// 生成模拟历史数据
const mockHistory = generateMockData(100);
console.log(`\n📊 生成了 ${mockHistory.length} 期模拟历史数据`);

// 模拟胆码和拖码选择
console.log('\n🎯 测试场景：胆码4个 + 拖码10个（热号策略）\n');

// 运行多次测试
const testCount = 20;
const results = [];

for (let i = 0; i < testCount; i++) {
  // 随机选择4个胆码
  const danPool = Array.from({length: 35}, (_, idx) => idx + 1);
  const danNumbers = [];
  for (let j = 0; j < 4; j++) {
    const idx = Math.floor(Math.random() * danPool.length);
    danNumbers.push(danPool[idx]);
    danPool.splice(idx, 1);
  }
  danNumbers.sort((a, b) => a - b);
  
  // 随机选择10个拖码（简化版，实际应该调用DanTuoOptimizer）
  const tuoPool = danPool;
  const tuoNumbers = [];
  for (let j = 0; j < 10; j++) {
    const idx = Math.floor(Math.random() * tuoPool.length);
    tuoNumbers.push(tuoPool[idx]);
    tuoPool.splice(idx, 1);
  }
  tuoNumbers.sort((a, b) => a - b);
  
  const analysis = analyzeZoneDistribution(danNumbers, tuoNumbers);
  results.push({
    dan: danNumbers,
    tuo: tuoNumbers,
    ...analysis
  });
}

// 统计分析结果
console.log(' 测试结果汇总（' + testCount + '次模拟）:\n');

// 区间覆盖统计
const coverageStats = {};
for (let z = 1; z <= 7; z++) {
  coverageStats[z] = { min: Infinity, max: 0, avg: 0, total: 0 };
}

results.forEach(r => {
  for (let z = 1; z <= 7; z++) {
    const count = r.zoneCounts[z];
    coverageStats[z].total += count;
    coverageStats[z].min = Math.min(coverageStats[z].min, count);
    coverageStats[z].max = Math.max(coverageStats[z].max, count);
  }
});

for (let z = 1; z <= 7; z++) {
  coverageStats[z].avg = (coverageStats[z].total / testCount).toFixed(1);
}

console.log(' 各区间号码数量分布:');
console.log('┌──────┬─────────┬─────────┬─────────┐');
console.log('│ 区间 │  最小值  │  平均值  │  最大值  │');
console.log('├──────┼─────────┼─────────┼─────────┤');
for (let z = 1; z <= 7; z++) {
  console.log(`│  区${z}  │   ${coverageStats[z].min.toString().padStart(2)}    │  ${coverageStats[z].avg.padStart(4)}  │   ${coverageStats[z].max.toString().padStart(2)}    │`);
}
console.log('└──────┴─────────┴─────────┴─────────┘');

// 连号统计
const consecutiveStats = results.map(r => r.totalConsecutive);
const avgConsecutive = (consecutiveStats.reduce((a, b) => a + b, 0) / testCount).toFixed(1);
const maxConsecutive = Math.max(...consecutiveStats);

console.log(`\n🔗 连号统计:`);
console.log(`  - 平均连号对数: ${avgConsecutive}`);
console.log(`  - 最大连号对数: ${maxConsecutive}`);

// 同区连号统计
const zoneConsecutiveAvg = {};
for (let z = 1; z <= 7; z++) {
  const total = results.reduce((sum, r) => sum + (r.zoneConsecutive[z] || 0), 0);
  zoneConsecutiveAvg[z] = (total / testCount).toFixed(1);
}

console.log(`\n🏠 各区内连号情况（平均每区连号对数）:`);
for (let z = 1; z <= 7; z++) {
  if (parseFloat(zoneConsecutiveAvg[z]) > 0) {
    console.log(`  - 区${z}: ${zoneConsecutiveAvg[z]} 对`);
  }
}

// 展示几个典型示例
console.log('\n\n📋 典型示例（前3次测试）:\n');
for (let i = 0; i < 3; i++) {
  const r = results[i];
  console.log(`测试 #${i + 1}:`);
  console.log(`  胆码: [${r.dan.join(', ')}]`);
  console.log(`  拖码: [${r.tuo.join(', ')}]`);
  console.log(`  区间分布: `, Object.entries(r.zoneCounts)
    .filter(([_, count]) => count > 0)
    .map(([zone, count]) => `区${zone}:${count}个`)
    .join(', ')
  );
  console.log(`  覆盖区间: ${r.coveredZones}/7`);
  console.log(`  总连号: ${r.totalConsecutive}对`);
  console.log('');
}

console.log('=' .repeat(60));
console.log('\n✅ 测试完成！');
console.log('\n💡 优化建议:');
console.log('  1. 理想情况下，14个号码应覆盖至少5-6个区间');
console.log('  2. 单个区间不应超过3个号码（避免过度集中）');
console.log('  3. 总连号对数控制在2-3对以内较为合理');
console.log('  4. 同一区内连号不超过2对');
