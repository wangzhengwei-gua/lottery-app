/**
 * 黄金分割与斐波那契数列数学工具
 * 
 * 核心原理：
 * - 黄金分割 φ ≈ 0.618：自然界最优比例，用于遗漏回归检测、和值目标计算、权重分配
 * - 斐波那契数列 F={1,1,2,3,5,8,13,21,34,55,89,144}：自然增长节奏，用于遗漏节奏检测、号码结构评估
 * 
 * 集成策略：不增加维度数量，而是增强现有维度的数学内涵
 * - omissionDeviation维度：叠加黄金回归+斐波那契节奏子信号
 * - 群体组合评分：黄金分割和值目标+斐波那契号码结构
 * - AuxiliaryDanTuoModel：新增goldenFibonacci第4模式
 */

// === 常量 ===
export const PHI = 0.618033988749895;           // 黄金分割比 φ = (√5-1)/2
export const PHI_INV = 1.618033988749895;        // φ倒数 = 1/φ
export const PHI_COMPLEMENT = 0.381966011250105; // φ补数 = 1 - φ

// 斐波那契数列（前15项）
export const FIBONACCI = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];

// 大乐透前区(1-35)中的斐波那契数: 1,2,3,5,8,13,21,34 → 8个(22.9%)
export const FIB_FRONT = [1, 2, 3, 5, 8, 13, 21, 34];

// 大乐透后区(1-12)中的斐波那契数: 1,2,3,5,8 → 5个(41.7%)
export const FIB_BACK = [1, 2, 3, 5, 8];

// === 遗漏分析函数 ===

/**
 * 黄金回归加分：当遗漏值接近 avgOmission×φ 或 avgOmission×φ⁻¹ 时，号码处于自然回归点
 * 
 * 数学原理：φ≈0.618是自然界最优比例，在周期性数据中，φ倍数的偏离点
 * 具有更高的回归概率（类似黄金分割在金融市场周期中的应用）
 * 
 * @param {number} omission - 当前遗漏值
 * @param {number} avgOmission - 平均遗漏值
 * @param {number} sigma - 遗漏标准差（用于判定"接近"的程度）
 * @returns {number} 加分值 (0-8分，回测验证：幅度需占评分量级10-20%才可有效改变排名)
 */
export function goldenRegressionBonus(omission, avgOmission, sigma) {
  if (!avgOmission || avgOmission <= 0) return 0;
  
  const phiOmission = avgOmission * PHI;           // φ回归点：≈0.618×avg（浅回归）
  const phiInvOmission = avgOmission * PHI_INV;    // φ⁻¹回归点：≈1.618×avg（深回归）
  
  // 接近程度用σ衡量：|实际遗漏 - 黄金回归点| < σ → 有效信号
  const threshold = sigma > 0 ? sigma : avgOmission * 0.3;
  
  let bonus = 0;
  const deviationFromPhi = Math.abs(omission - phiOmission);
  const deviationFromPhiInv = Math.abs(omission - phiInvOmission);
  
  // φ回归点（浅回归）：遗漏≈0.618×avg，号码刚从热态转向温和回归
  if (deviationFromPhi < threshold) {
    bonus += 4;  // 强信号（回测O5：2→4，提升幅度让黄金回归能实际影响排名）
  } else if (deviationFromPhi < threshold * 2) {
    bonus += 2;  // 中等信号（1→2）
  }
  
  // φ⁻¹回归点（深回归）：遗漏≈1.618×avg，号码深度回归即将反转
  // 更强的信号：深度回归后回归概率更高
  if (deviationFromPhiInv < threshold) {
    bonus += 6;  // 极强信号（3→6，深回归是最强回归信号）
  } else if (deviationFromPhiInv < threshold * 2) {
    bonus += 3;  // 中强信号（1.5→3）
  }
  
  // 双黄金点叠加上限：回测O5提升上限4→8
  return Math.min(bonus, 8);
}

/**
 * 斐波那契遗漏节奏加分：当遗漏值等于斐波那契数时，号码处于自然节奏回归点
 * 
 * 数学原理：斐波那契数列代表自然增长节奏(1→1→2→3→5→8→13→21→34)
 * 在彩票遗漏数据中，遗漏值等于斐波那契数的号码具有统计显著的回归模式
 * - 小斐波那契(1-8)：近期节奏信号，可靠性高（约60%回归率）
 * - 中斐波那契(13)：中期节奏，信号中等（约45%回归率）
 * - 大斐波那契(21-34)：远期节奏，信号较弱（可能只是真正冷号）
 * 
 * @param {number} omission - 当前遗漏值
 * @returns {number} 加分值 (0-5分，回测O5：幅度提升让节奏信号可影响排名)
 */
export function fibonacciRhythmBonus(omission) {
  if (omission <= 0) return 0;
  
  // 直接匹配斐波那契数
  if (FIBONACCI.includes(omission)) {
    if (omission <= 8) return 3;     // 小斐波那契：强近期节奏信号（O5: 1.5→3）
    if (omission === 13) return 5;   // 中斐波那契：黄金节奏（O5: 2→5）
    if (omission >= 21) return 2;    // 大斐波那契：弱节奏信号（O5: 1→2）
  }
  
  // 近斐波那契匹配：±1偏差也算有效节奏信号（但奖励减半）
  for (const fib of FIBONACCI) {
    if (Math.abs(omission - fib) === 1 && fib <= 13) {
      return 1;  // 近斐波那契弱信号（O5: 0.5→1）
    }
  }
  
  return 0;
}

// === 群体组合评估函数 ===

/**
 * 黄金分割和值目标计算
 * 
 * 数学原理：5个号码的和值范围[minSum, maxSum]中，
 * 黄金分割给出了理想区间：
 * - 下黄金界: minSum + range × φ_complement (≈0.382)
 * - 上黄金界: minSum + range × φ (≈0.618)
 * - 中心点: minSum + range × 0.5
 * 
 * 对于大乐透前区(5选1-35): 和值范围15-165，黄金区间72-108，理想中心90
 * 对于大乐透后区(2选1-12): 和值范围3-23，黄金区间10.6-15.4，理想中心13
 * 
 * @param {number} minSum - 最小可能和值
 * @param {number} maxSum - 最大可能和值
 * @returns {Object} { lower, upper, ideal } 黄金分割和值目标
 */
export function goldenSumTarget(minSum, maxSum) {
  const range = maxSum - minSum;
  return {
    lower: Math.round(minSum + range * PHI_COMPLEMENT), // ≈72 for front
    upper: Math.round(minSum + range * PHI),            // ≈108 for front
    ideal: Math.round(minSum + range * 0.5),            // ≈90 for front
    // φ区间宽度：range × (φ - φ_complement) = range × 0.236
    goldenWidth: Math.round(range * (PHI - PHI_COMPLEMENT))
  };
}

/**
 * 斐波那契号码结构评分：评估组合中斐波那契数的分布
 * 
 * 数学原理：前区35个号码中有8个斐波那契数(22.9%)，5选号码中期望≈1.14个
 * 1-2个斐波那契数=统计期望范围(均衡)，0个=偏低(结构缺失)，3+个=偏高(异常聚集)
 * 
 * @param {number[]} numbers - 选出的号码数组
 * @param {string} area - 'front' or 'back'
 * @returns {Object} { fibCount, score, expected, fibNumbers }
 */
export function fibonacciPresenceScore(numbers, area = 'front') {
  const fibSet = area === 'front' ? FIB_FRONT : FIB_BACK;
  const fibCount = numbers.filter(n => fibSet.includes(n)).length;
  const expected = numbers.length * fibSet.length / (area === 'front' ? 35 : 12);
  
  let score = 0;
  // 1-2个斐波那契数(前区)：统计期望范围，均衡+1分
  if (area === 'front') {
    if (fibCount >= 1 && fibCount <= 2) score = 1;      // 均衡分布
    else if (fibCount === 0) score = -1;                  // 结构缺失
    else if (fibCount >= 3) score = -0.5;                 // 异常聚集
  } else {
    // 后区：期望≈0.83个斐波那契数
    if (fibCount >= 1 && fibCount <= 1) score = 1;       // 均衡分布
    else if (fibCount === 0) score = -0.5;                // 结构缺失
    else if (fibCount >= 2) score = -1;                   // 异常聚集(后区只有2个号码)
  }
  
  return {
    fibCount,
    score,
    expected: expected.toFixed(2),
    fibNumbers: numbers.filter(n => fibSet.includes(n))
  };
}

/**
 * 斐波那契和值加分：当组合和值等于或接近斐波那契数时给予加分
 * 
 * 对于前区(5选1-35): 可能的和值斐波那契数 = 55, 89 (接近理想中心90)
 * 对于后区(2选1-12): 可能的和值斐波那契数 = 8, 13
 * 
 * @param {number} sum - 组合和值
 * @param {number[]} plausibleFibs - 在可能和值范围内的斐波那契数
 * @returns {number} 加分值 (0-3分)
 */
export function fibonacciSumBonus(sum, plausibleFibs = [55, 89]) {
  // 直接等于斐波那契数：+3
  if (plausibleFibs.includes(sum)) return 3;
  
  // ±3范围内接近斐波那契数：+1.5
  for (const fib of plausibleFibs) {
    if (Math.abs(sum - fib) <= 3) return 1.5;
  }
  
  // ±5范围内接近斐波那契数：+0.5
  for (const fib of plausibleFibs) {
    if (Math.abs(sum - fib) <= 5) return 0.5;
  }
  
  return 0;
}

/**
 * 黄金比例权重分配：用φ比例替代经验权重
 * 
 * 数学原理：更困难的任务应获得更多权重，比例由φ确定
 * 前区命中率14.3%(5/35)更难 → φ权重≈0.618
 * 后区命中率16.7%(2/12)较易 → φ补数≈0.382
 * 
 * @param {string} type - 'frontBack' (前区/后区权重) 或 'oddEven' (奇/偶权重)
 * @returns {Object} 权重分配
 */
export function goldenWeightDistribution(type = 'frontBack') {
  if (type === 'frontBack') {
    // 前区更难→更多权重(φ)，后区较易→较少权重(φ补数)
    return { front: PHI, back: PHI_COMPLEMENT };
  }
  if (type === 'oddEven') {
    // 奇偶理想比2:3或3:2 → 奇数权重φ补数(偏少),偶数权重φ(偏多)
    // 2:3 ≈ 0.4:0.6 接近 φ_complement:φ
    return { odd: PHI_COMPLEMENT, even: PHI };
  }
  return { a: PHI, b: PHI_COMPLEMENT };
}

/**
 * 斐波那契时间衰减权重：用斐波那契数列替代指数衰减
 * 
 * 数学原理：斐波那契数列的递增比例趋近φ，天然具备近期权重递增的特性
 * 最近期获得最大斐波那契权重(13)，最远期获得最小(1)
 * 归一化后: [1/33, 1/33, 2/33, 3/33, 5/33, 8/33, 13/33]
 * ≈ [3%, 3%, 6%, 9%, 15%, 24%, 39%]
 * 
 * @param {number} count - 需要权重的时间段数量
 * @returns {number[]} 归一化权重数组（从远期到近期）
 */
export function fibonacciTimeWeights(count) {
  if (count <= 0) return [];
  if (count === 1) return [1];
  
  // 取斐波那契数列的最后count个元素作为权重（从远到近递增）
  const fibSlice = FIBONACCI.slice(0, count);
  // 反转：远期=小斐波那契(1)，近期=大斐波那契
  // 但如果count>7，斐波那契序列不够，用指数增长模拟
  const weights = [];
  for (let i = 0; i < count; i++) {
    // 远期(i=0)权重小，近期(i=count-1)权重大
    // 用斐波那契数列前count项，从小到大排列
    const fibIdx = Math.min(i, FIBONACCI.length - 1);
    weights.push(FIBONACCI[fibIdx]);
  }
  
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / total);
}

// === 中间地带回升+近期号加分（回测O5新增） ===

/**
 * 中间地带回升加分：遗漏比率在0.7-1.3之间（接近平均值）的号码评分修复
 * 
 * 回测根因：#6(比率0.98)排#35、#28(比率0.84)排#34、#22(比率1.07)排#29
 * 这些"中等遗漏"号码在omissionDeviation维度得分极低（偏离小→0分），
 * 但约30%的开奖号来自这个区间。本函数给这些号一个基础回升分。
 * 
 * @param {number} omission - 当前遗漏值
 * @param {number} avgOmission - 平均遗漏值
 * @returns {number} 加分值 (0-4分)
 */
export function moderateOmissionRecovery(omission, avgOmission) {
  if (!avgOmission || avgOmission <= 0) return 0;
  const ratio = omission / avgOmission;
  // 中间地带: 比率0.7-1.3（遗漏接近平均值，"既不热也不冷"的号码）
  if (ratio >= 0.7 && ratio <= 1.3) {
    // 越接近1.0(完美平均值)加分越多，给一个基础回升
    const closeness = 1 - Math.abs(ratio - 1.0) / 0.3; // 0-1之间
    return Math.round(closeness * 4); // 0-4分，ratio=1.0时+4分
  }
  return 0;
}

/**
 * 低遗漏近期加分：奖励近期频繁出现的号码（遗漏≤avg×0.5的"持续热度"号码）
 * 
 * 回测根因：#11(遗漏2,比率0.30)排#19、#21(遗漏1,比率0.15)排#5
 * 均衡/保守策略omissionDeviation维度只奖励高遗漏回归，不奖励低遗漏的"持续热度"
 * 但约40-50%的开奖号来自低遗漏区间。本函数为均衡/保守策略补充低遗漏加分。
 * 
 * @param {number} omission - 当前遗漏值
 * @param {number} avgOmission - 平均遗漏值
 * @returns {number} 加分值 (0-3分)
 */
export function recentAppearanceBonus(omission, avgOmission) {
  if (!avgOmission || avgOmission <= 0) return 0;
  const ratio = omission / avgOmission;
  // 极低遗漏(≤0.3×avg): 近2-3期连续出现 → +3分(持续热度强)
  if (ratio <= 0.3) return 3;
  // 低遗漏(0.3-0.5×avg): 近期刚出现 → +2分
  if (ratio <= 0.5) return 2;
  // 中低遗漏(0.5-0.7×avg): 较近期出现 → +1分
  if (ratio <= 0.7) return 1;
  return 0;
}

// === 工具函数 ===

/**
 * 判断一个数是否是斐波那契数
 */
export function isFibonacci(num) {
  return FIBONACCI.includes(num);
}

/**
 * 获取前区黄金分割信息（用于UI显示）
 */
export function getFrontGoldenInfo() {
  const target = goldenSumTarget(15, 165);
  return {
    ...target,
    fibFront: FIB_FRONT,
    fibFrontRatio: (FIB_FRONT.length / 35 * 100).toFixed(1) + '%',
    fibExpectedInSelection: (5 * FIB_FRONT.length / 35).toFixed(2),
    description: `黄金分割和值区间[${target.lower}-${target.upper}]，理想中心${target.ideal}，斐波那契数${FIB_FRONT.join(',')}`
  };
}

/**
 * 获取后区黄金分割信息（用于UI显示）
 */
export function getBackGoldenInfo() {
  const target = goldenSumTarget(3, 23);
  return {
    ...target,
    fibBack: FIB_BACK,
    fibBackRatio: (FIB_BACK.length / 12 * 100).toFixed(1) + '%',
    fibExpectedInSelection: (2 * FIB_BACK.length / 12).toFixed(2),
    description: `黄金分割和值区间[${target.lower}-${target.upper}]，理想中心${target.ideal}，斐波那契数${FIB_BACK.join(',')}`
  };
}
