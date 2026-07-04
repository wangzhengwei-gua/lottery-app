/**
 * 彩票分析系统 - 模块导出入口
 * 
 * 📑 使用说明：
 * 这个文件是模块化重构的统一入口
 * 保持与原有 lotteryLogic.js 完全兼容的API
 * 
 * ✅ 已完成模块：
 * - core/Config.js - 配置常量
 * - core/Utils.js - 通用工具函数
 * - analysis/FrequencyAnalyzer.js - 频率分析器
 * - analysis/OmissionCalculator.js - 遗漏值计算器
 * - analysis/TrendAnalyzer.js - 趋势分析器
 * - analysis/CorrelationAnalyzer.js - 关联性分析器
 * - analysis/ConditionalProbability.js - 条件概率计算器
 * - optimization/UnifiedScorer.js - 统一评分器
 * - algorithms/BaseModel.js - 算法基类
 * - algorithms/FrequencyWeighted.js - 频率加权模型
 * - algorithms/OmissionAnalysis.js - 遗漏分析模型
 * - algorithms/NormalDistribution.js - 正态分布模型
 * - algorithms/BayesianDynamic.js - 贝叶斯动态模型
 * - algorithms/ZoneFrequency.js - 区间频率模型
 */

// 导入主类
import LotteryAnalyzer from './LotteryAnalyzer.js';

// 导入配置
import { CONFIG } from './core/Config.js';
import * as Utils from './core/Utils.js';

// 导入数据分析模块
import { FrequencyAnalyzer } from './analysis/FrequencyAnalyzer.js';
import { OmissionCalculator } from './analysis/OmissionCalculator.js';
import { TrendAnalyzer } from './analysis/TrendAnalyzer.js';
import { CorrelationAnalyzer } from './analysis/CorrelationAnalyzer.js';
import { ConditionalProbability } from './analysis/ConditionalProbability.js';

// 导入统一评分器
import { UnifiedScorer } from './optimization/UnifiedScorer.js';

// 导入算法模块（精简版：5个模型）
import { BaseModel } from './algorithms/BaseModel.js';
import { FrequencyWeightedModel } from './algorithms/FrequencyWeighted.js';
import { OmissionAnalysisModel } from './algorithms/OmissionAnalysis.js';
import { NormalDistributionModel } from './algorithms/NormalDistribution.js';
import { BayesianDynamicModel } from './algorithms/BayesianDynamic.js';
import { ZoneFrequencyModel } from './algorithms/ZoneFrequency.js';

export {
  // 主类（推荐使用）
  LotteryAnalyzer,
  // 配置和工具
  CONFIG,
  Utils,
  // 数据分析模块
  FrequencyAnalyzer,
  OmissionCalculator,
  TrendAnalyzer,
  CorrelationAnalyzer,
  ConditionalProbability,
  // 统一评分器
  UnifiedScorer,
  // 算法模块
  BaseModel,
  FrequencyWeightedModel,
  OmissionAnalysisModel,
  NormalDistributionModel,
  BayesianDynamicModel,
  ZoneFrequencyModel
};

// 默认导出主类
export default LotteryAnalyzer;
