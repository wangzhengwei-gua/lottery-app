/**
 * 区间趋势预测共享工具
 * 提供5小区（前区）和4小区（后区）的趋势预测计算
 * 统一FrontDanOptimizer/DanTuoOptimizer/BackDanOptimizer/BackTuoOptimizer的区间预测逻辑
 */

/**
 * 计算前区5小区动态趋势预测
 * @param {Array} activeData - 历史数据数组
 * @param {Function} getZone5 - 区间映射函数，默认 Math.ceil(num/7)
 * @param {Object} options - 可选配置 { shortWindow, longWindow }
 * @returns {Object} { zone5Absence, zone5RecentHit, zone5Trend, zone5Prediction }
 */
export function computeZone5Prediction(activeData, getZone5 = (num) => Math.ceil(num / 7), options = {}) {
  const shortWindow = options.shortWindow || Math.min(Math.max(10, Math.floor(activeData.length * 0.33)), activeData.length);
  const longWindow = options.longWindow || Math.min(Math.max(10, Math.floor(activeData.length * 0.67)), activeData.length);

  const zone5Absence = {};
  const zone5RecentHit = {};
  const zone5Trend = {};
  const zone5Prediction = {};

  for (let z = 1; z <= 5; z++) {
    zone5Absence[z] = 0;
    // 从最后一期往前统计连续不出期数
    for (let i = activeData.length - 1; i >= 0; i--) {
      const hasZone = activeData[i].front.some(n => getZone5(n) === z);
      if (hasZone) break;
      zone5Absence[z]++;
    }

    // 近shortWindow期频率
    const r10Data = activeData.slice(-shortWindow);
    let zone5ShortFreq = 0;
    for (const draw of r10Data) {
      for (const num of draw.front) {
        if (getZone5(num) === z) zone5ShortFreq++;
      }
    }
    zone5RecentHit[z] = shortWindow > 0 ? zone5ShortFreq / shortWindow : 0;

    // 近longWindow期频率
    const r30Data = activeData.slice(-longWindow);
    let zone5LongFreq = 0;
    for (const draw of r30Data) {
      for (const num of draw.front) {
        if (getZone5(num) === z) zone5LongFreq++;
      }
    }
    const longHitRate = longWindow > 0 ? zone5LongFreq / longWindow : 0;
    zone5Trend[z] = longHitRate > 0 ? zone5RecentHit[z] / longHitRate : 1;

    // 预测等级
    const absence = zone5Absence[z];
    const trend = zone5Trend[z];
    if (absence >= 3) zone5Prediction[z] = 'must';
    else if (absence >= 2) zone5Prediction[z] = 'very_likely';
    else if (absence >= 1) zone5Prediction[z] = 'likely_warm';
    else if (trend >= 1.2) zone5Prediction[z] = 'warming';
    else if (trend < 0.8) zone5Prediction[z] = 'unlikely_cool';
    else zone5Prediction[z] = 'normal';
  }

  return { zone5Absence, zone5RecentHit, zone5Trend, zone5Prediction };
}

/**
 * 计算后区4小区动态趋势预测
 * @param {Array} activeData - 历史数据数组
 * @param {Function} getBackZone4 - 区间映射函数，默认 Math.ceil(num/3)
 * @param {Object} options - 可选配置 { shortWindow, longWindow }
 * @returns {Object} { backZone4Absence, backZone4RecentHit, backZone4Trend, backZone4Prediction }
 */
export function computeZone4Prediction(activeData, getBackZone4 = (num) => Math.ceil(num / 3), options = {}) {
  const shortWindow = options.shortWindow || Math.min(10, activeData.length);
  const longWindow = options.longWindow || Math.min(20, activeData.length);

  const backZone4Absence = {};
  const backZone4RecentHit = {};
  const backZone4Trend = {};
  const backZone4Prediction = {};

  for (let z = 1; z <= 4; z++) {
    backZone4Absence[z] = 0;
    // 从最后一期往前统计连续不出期数
    for (let i = activeData.length - 1; i >= 0; i--) {
      const hasZone = activeData[i].back.some(n => getBackZone4(n) === z);
      if (hasZone) break;
      backZone4Absence[z]++;
    }

    // 近shortWindow期频率
    const r10Data = activeData.slice(-shortWindow);
    let zone4ShortFreq = 0;
    for (const draw of r10Data) {
      for (const num of draw.back) {
        if (getBackZone4(num) === z) zone4ShortFreq++;
      }
    }
    backZone4RecentHit[z] = shortWindow > 0 ? zone4ShortFreq / shortWindow : 0;

    // 近longWindow期频率
    const r20Data = activeData.slice(-longWindow);
    let zone4LongFreq = 0;
    for (const draw of r20Data) {
      for (const num of draw.back) {
        if (getBackZone4(num) === z) zone4LongFreq++;
      }
    }
    const longHitRate = longWindow > 0 ? zone4LongFreq / longWindow : 0;
    backZone4Trend[z] = longHitRate > 0 ? backZone4RecentHit[z] / longHitRate : 1;

    // 预测等级
    const absence = backZone4Absence[z];
    const trend = backZone4Trend[z];
    if (absence >= 3) backZone4Prediction[z] = 'must';
    else if (absence >= 2) backZone4Prediction[z] = 'very_likely';
    else if (absence >= 1) backZone4Prediction[z] = 'likely_warm';
    else if (trend >= 1.2) backZone4Prediction[z] = 'warming';
    else if (trend < 0.8) backZone4Prediction[z] = 'unlikely_cool';
    else backZone4Prediction[z] = 'normal';
  }

  return { backZone4Absence, backZone4RecentHit, backZone4Trend, backZone4Prediction };
}

/**
 * 格式化区间趋势预测日志
 * @param {Object} prediction - 预测结果对象
 * @param {Object} absence - 连续不出期数对象
 * @param {Object} trend - 趋势比值对象
 * @param {number} zoneCount - 区间数量(5或4)
 * @param {Function} zoneRangeFormatter - 区间范围格式化函数
 * @param {string} label - 日志标签
 * @returns {string} 格式化后的日志字符串
 */
// === 区间映射函数（统一导出，消除各优化器重复定义） ===

/**
 * 前区5小区映射：区1(1-7),区2(8-14),区3(15-21),区4(22-28),区5(29-35)
 * 85.4%只有3-4个小区出号，连续不出2期后100%回归
 */
export function getZone5(num) {
  return Math.ceil(num / 7);
}

/**
 * 前区7小区映射：区1(01-05),区2(06-10),区3(11-15),区4(16-20),区5(21-25),区6(26-30),区7(31-35)
 * 用于区间饱和度调节等辅助维度
 */
export function getZone7(num) {
  if (num <= 5) return 1;
  if (num <= 10) return 2;
  if (num <= 15) return 3;
  if (num <= 20) return 4;
  if (num <= 25) return 5;
  if (num <= 30) return 6;
  return 7;
}

/**
 * 后区4小区映射：区1(1-3),区2(4-6),区3(7-9),区4(10-12)
 * 85.4%恰好2个4小区出号，连续不出1期后96-100%回归
 */
export function getBackZone4(num) {
  return Math.ceil(num / 3);
}

export function formatZonePredictionLog(prediction, absence, trend, zoneCount, zoneRangeFormatter, label) {
  const order = { must: 0, very_likely: 1, likely_warm: 2, warming: 3, normal: 4, unlikely_cool: 5 };
  return Object.entries(prediction)
    .sort((a, b) => (order[a[1]] || 4) - (order[b[1]] || 4))
    .map(([z, p]) => {
      const range = zoneRangeFormatter(parseInt(z));
      const trendVal = trend[z];
      return `区${z}(${range})[${p}]连续不出${absence[z]}期/趋势${trendVal > 1 ? '升' : '降'}${trendVal.toFixed(2)}`;
    })
    .join(', ');
}