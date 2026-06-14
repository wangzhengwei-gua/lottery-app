/**
 * 彩票分析系统配置常量
 * 基于208期历史数据优化
 */

export const CONFIG = {
  // 基础配置
  FRONT_COUNT: 5,           // 前区号码数量
  BACK_COUNT: 2,            // 后区号码数量
  FRONT_RANGE: 35,          // 前区号码范围 1-35
  BACK_RANGE: 12,           // 后区号码范围 1-12
  MAX_ITERATIONS: 1000,     // 最大迭代次数（防止无限循环）
  HOT_NUMBERS_COUNT: 10,    // 热号数量
  COLD_NUMBERS_COUNT: 10,   // 冷号数量
  
  // 算法特定配置
  ROTATION_HIGH_FREQ: 15,   // 旋转矩阵高频号数量
  ROTATION_LOW_FREQ: 6,     // 旋转矩阵后区高频号数量
  BAYESIAN_CANDIDATE_FRONT: 18,  // 贝叶斯前区候选数量
  BAYESIAN_CANDIDATE_BACK: 10,   // 贝叶斯后区候选数量
  DISTRIBUTION_TRY_COUNT: 500,   // 分布策略尝试次数
  TIME_DECAY_FACTOR: 0.95,  // 时间衰减因子
  HYBRID_MODEL_COUNT: 3,    // 混合模型使用的模型数量
  QUALITY_SCORE_THRESHOLD: 75,  // 质量评分阈值
  RECENT_DRAWS_FOR_TREND: 30,  // 用于趋势分析的最近期数（3个智能推荐模型统一使用30期样本）
  ADAPTIVE_WEIGHT_WINDOW: 30,  // 自适应权重窗口大小（与趋势分析窗口同步）
  
  // 后区多样性控制参数
  BACK_WEIGHT_CAP: 3,       // 后区权重上限（防止热号权重过大）
  BACK_RANDOM_BONUS: 0.5,   // 后区随机加分（给冷号更多机会）
  BACK_NOISE_FACTOR: 0.3,   // 后区权重噪声因子（增加随机性）
  BACK_STRATIFIED_ODD: true, // 后区分层采样：保证奇偶分布
  
  // 前区多样性控制参数
  FRONT_WEIGHT_CAP: 5,      // 前区权重上限
  FRONT_RANDOM_BONUS: 0.3,  // 前区随机加分
  FRONT_NOISE_FACTOR: 0.15, // 前区权重噪声因子
  
  // 条件概率与关联性控制参数
  CONDITIONAL_WEIGHT: 0.15,      // 前区条件概率基础权重
  CORRELATION_WEIGHT: 0.10,      // 号码关联性权重
  BACK_CONDITIONAL_WEIGHT: 0.20, // 后区条件概率基础权重
  UNIQUE_BACK_ATTEMPTS: 15,      // 单组后区唯一性尝试次数
  UNIQUE_BACK_TOTAL_FACTOR: 30,  // 总尝试次数倍数因子
  
  // 质量评估参数（基于208期数据）
  AC_VALUE_MIN: 3,          // AC值最小可接受值
  AC_VALUE_MAX: 7,          // AC值最大可接受值
  AC_VALUE_IDEAL_MIN: 4,    // AC值理想范围下限
  AC_VALUE_IDEAL_MAX: 6,    // AC值理想范围上限
  CONSECUTIVE_GROUPS_MAX: 2, // 最大连号组数
  GAP_VARIANCE_MIN: 8,      // 间距方差最小值
  GAP_VARIANCE_MAX: 55,     // 间距方差最大值
  SUM_RANGE_MIN: 65,        // 和值合理范围下限
  SUM_RANGE_MAX: 115,       // 和值合理范围上限
  SPAN_DIFF_THRESHOLD: 12,  // 跨度差异阈值
  SUM_DIFF_THRESHOLD: 35,   // 和值差异阈值
};
