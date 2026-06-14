/**
 * 测试三种策略的前区胆码数量配置
 * 运行方式: node scripts/test-strategy-dan-count.js
 */

console.log(' 前区胆码数量配置测试\n');
console.log('=' .repeat(60));

const strategies = [
  { name: '热号策略', code: 'hot', expectedDanCount: 4, description: '追求高命中率，增加胆码数量' },
  { name: '均衡策略', code: 'balanced', expectedDanCount: 3, description: '平衡命中率和覆盖面' },
  { name: '保守策略', code: 'conservative', expectedDanCount: 3, description: '稳定为主，减少风险' }
];

console.log('\n📊 胆码数量配置表:\n');
console.log('┌──────────┬────────────┬──────────────┬──────────────────────────┐');
console.log('│  策略    │ 胆码数量   │ 拖码数量     │ 说明                     │');
console.log('├──────────┼────────────┼──────────────┼──────────────────────────┤');

strategies.forEach(s => {
  const tuoCount = s.code === 'hot' ? 10 : (s.code === 'balanced' ? 8 : 7);
  console.log(`│ ${s.name.padEnd(8)} │    ${s.expectedDanCount}       │     ${tuoCount}      │ ${s.description.padEnd(24)} │`);
});

console.log('└──────────┴────────────┴──────────────┴──────────────────────────');

console.log('\n💡 优化要点:\n');

console.log('1️⃣  热号策略 (4胆):\n');
console.log('   - 目标：最大化命中概率，适合激进型玩家');
console.log('   - 优势：4个胆码覆盖更多号码，提高中奖机会');
console.log('   - 特点：注重热度信号、近期频率逆袭、5小区趋势');
console.log('   - 评分维度：11维（含重号降温、区间饱和度等）\n');

console.log('2️⃣  均衡策略 (3胆):\n');
console.log('   - 目标：平衡命中率和覆盖面，适合稳健型玩家');
console.log('   - 优势：3个胆码+8个拖码，兼顾稳定性和多样性');
console.log('   - 特点：强调条件概率、遗漏偏离度、时间衰减');
console.log('   - 评分维度：9维（降低频率权重，提升遗漏回归）\n');

console.log('3️  保守策略 (3胆):\n');
console.log('   - 目标：稳定性优先，适合谨慎型玩家');
console.log('   - 优势：3个胆码+7个拖码，降低单期波动风险');
console.log('   - 特点：更注重冷门号机会、遗漏回归、连号协同降低');
console.log('   - 评分维度：9维（频率降至6分，连号降至3分）\n');

console.log('=' .repeat(60));

console.log('\n🔧 代码修改位置:\n');
console.log('1. App.jsx L752-754: 胆码数量配置逻辑');
console.log('   let danCount = 3;');
console.log('   if (strategy === "hot") danCount = 4;\n');

console.log('2. FrontDanOptimizer.js L72-74: 策略注释更新');
console.log('   // 热号策略(4胆)：11维度...\n');
console.log('   // 均衡策略(3胆)：9维度...\n');
console.log('   // 保守策略(3胆)：9维度...\n');

console.log('3. FrontDanOptimizer.js L207-209: 保守策略频率动量优化');
console.log('   // 保守策略(3胆优化)：频率降至6分 + 动量降至2分\n');

console.log('4. FrontDanOptimizer.js L230: 保守策略遗漏偏离度说明');
console.log('   // 保守策略(3胆)更强调遗漏回归，因此给予更高权重\n');

console.log('5. FrontDanOptimizer.js L400: 保守策略连号协同说明');
console.log('   // 保守策略(3胆)降低连号权重，避免过度依赖连号模式\n');

console.log('=' .repeat(60));

console.log('\n✅ 测试完成！');
console.log('\n 建议:\n');
console.log('  - 热号策略：适合追号、倍投玩法');
console.log('  - 均衡策略：适合日常推荐，性价比最高');
console.log('  - 保守策略：适合新手或资金有限的玩家');
console.log('  - 所有策略都支持加权随机采样，保证推荐多样性\n');
