/**
 * 彩票分析器 - 模块化重构版本
 * 
 * 📑 说明：
 * 这是模块化重构后的统一入口类
 * 整合了所有分析模块和算法模型
 * 保持与原有 lotteryLogic.js 完全兼容的API
 */

import { CONFIG } from './core/Config.js';
import { FrequencyAnalyzer } from './analysis/FrequencyAnalyzer.js';
import { OmissionCalculator } from './analysis/OmissionCalculator.js';
import { TrendAnalyzer } from './analysis/TrendAnalyzer.js';
import { CorrelationAnalyzer } from './analysis/CorrelationAnalyzer.js';
import { ConditionalProbability } from './analysis/ConditionalProbability.js';
import { UnifiedScorer } from './optimization/UnifiedScorer.js';
import { BackDanOptimizer } from './optimization/BackDanOptimizer.js';
import { FrontDanOptimizer } from './optimization/FrontDanOptimizer.js';
import { BackTuoOptimizer } from './optimization/BackTuoOptimizer.js';

// 导入算法模型（精简版：11→5，移除周易/混合/旋转/平衡/时间衰减/均值回归）
import { BayesianDynamicModel } from './algorithms/BayesianDynamic.js';
import { ZoneFrequencyModel } from './algorithms/ZoneFrequency.js';
import { FrequencyWeightedModel } from './algorithms/FrequencyWeighted.js';
import { OmissionAnalysisModel } from './algorithms/OmissionAnalysis.js';
import { NormalDistributionModel } from './algorithms/NormalDistribution.js';
import { NumberEliminator } from './optimization/NumberEliminator.js';
import { StructuralEliminator } from './optimization/StructuralEliminator.js';

class LotteryAnalyzer {
  constructor() {
    this.frontNumbers = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1);
    this.backNumbers = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1);
    this.historyData = [];
    this.dataWindow = 0; // 历史数据窗口：0=全部数据，N=最近N期数据
    
    // 缓存机制
    this.cache = {
      frequency: null,
      expectedValue: null,
      variance: null,
      hotCold: null,
      omission: null,
      timeDecayWeights: null,
      sumTrend: null,
      spanAnalysis: null,
      repeatNumbers: null,
      modelPerformance: null,
      backPairFrequency: null,
      conditionalProbability: null,
      numberCorrelation: null,
      dataVersion: 0
    };

    // 初始化分析器（延迟初始化，在加载数据后）
    this.frequencyAnalyzer = null;
    this.omissionCalculator = null;
    this.trendAnalyzer = null;
    this.correlationAnalyzer = null;
    this.conditionalProbability = null;
    
    // 初始化算法模型
    this.models = {};
  }

  /**
   * 初始化所有分析器和模型
   * 在加载数据后调用
   */
  _initializeAnalyzers() {
    const getActiveData = () => this.getActiveData();
    
    // 初始化分析器（传递 null 作为 historyData，使用 getActiveData 函数）
    this.frequencyAnalyzer = new FrequencyAnalyzer(null, getActiveData);
    this.omissionCalculator = new OmissionCalculator(null, getActiveData, this.frontNumbers, this.backNumbers);
    this.trendAnalyzer = new TrendAnalyzer(null, getActiveData);
    this.correlationAnalyzer = new CorrelationAnalyzer(null, getActiveData, this.frontNumbers, this.backNumbers);
    this.conditionalProbability = new ConditionalProbability(null, getActiveData, this.frontNumbers, this.backNumbers);
    
    // 初始化算法模型
    const modelDeps = {
      frequencyAnalyzer: this.frequencyAnalyzer,
      omissionCalculator: this.omissionCalculator,
      trendAnalyzer: this.trendAnalyzer,
      correlationAnalyzer: this.correlationAnalyzer,
      conditionalProbability: this.conditionalProbability,
      getActiveData,
      frontNumbers: this.frontNumbers,
      backNumbers: this.backNumbers
    };
    
    this.models = {
      bayesian: new BayesianDynamicModel(modelDeps),
      zoneFrequency: new ZoneFrequencyModel(modelDeps),
      frequencyWeighted: new FrequencyWeightedModel(modelDeps),
      omissionAnalysis: new OmissionAnalysisModel(modelDeps),
      normalDistribution: new NormalDistributionModel(modelDeps)
    };
  }

  /**
   * 设置历史数据窗口
   */
  setDataWindow(window) {
    const newWindow = Math.max(0, Math.min(window, this.historyData.length));
    if (newWindow !== this.dataWindow) {
      this.dataWindow = newWindow;
      this.clearCache();
      console.log(`📊 历史数据窗口已设置为: ${newWindow === 0 ? '全部' : `最近${newWindow}期`}（共${this.historyData.length}期数据）`);
    }
  }

  /**
   * 获取当前窗口内的活跃数据
   */
  getActiveData() {
    if (this.dataWindow > 0) {
      return this.historyData.slice(-this.dataWindow);
    }
    return this.historyData;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache = {
      frequency: null,
      expectedValue: null,
      variance: null,
      hotCold: null,
      omission: null,
      timeDecayWeights: null,
      sumTrend: null,
      spanAnalysis: null,
      repeatNumbers: null,
      modelPerformance: null,
      backPairFrequency: null,
      conditionalProbability: null,
      numberCorrelation: null,
      dataVersion: this.cache.dataVersion + 1
    };
  }

  /**
   * 加载历史数据
   */
  loadHistoryData(dataStr, sourceName = "默认数据") {
    this.historyData = [];
    this.clearCache();
    
    const lines = dataStr.trim().split('\n');
    let count = 0;
    for (const line of lines) {
      if (line.trim()) {
        const numbers = line.trim().split(/\s+/).map(Number);
        
        if (numbers.length !== 7) {
          console.warn(`跳过无效数据行: ${line} (号码数量不为7)`);
          continue;
        }
        
        const front = numbers.slice(0, CONFIG.FRONT_COUNT);
        const back = numbers.slice(CONFIG.FRONT_COUNT);
        
        const isValidFront = front.every(n => n >= 1 && n <= CONFIG.FRONT_RANGE);
        const isValidBack = back.every(n => n >= 1 && n <= CONFIG.BACK_RANGE);
        
        if (!isValidFront || !isValidBack) {
          console.warn(`跳过无效数据行: ${line} (号码超出范围)`);
          continue;
        }
        
        const hasDuplicate = new Set(front).size !== front.length || new Set(back).size !== back.length;
        if (hasDuplicate) {
          console.warn(`跳过无效数据行: ${line} (存在重复号码)`);
          continue;
        }
        
        this.historyData.push({
          front,
          back,
          full: numbers,
          source: sourceName
        });
        count++;
      }
    }
    
    // 数据顺序确认：数据文件line1=最旧, line211=最新，已按时间顺序排列
    // historyData[0]=最旧期, historyData[n-1]=最新期，无需反转
    console.log(` 数据已加载: ${this.historyData.length}期, 最旧=${JSON.stringify(this.historyData[0]?.front?.slice(0,3))}... 最新=${JSON.stringify(this.historyData[this.historyData.length-1]?.front?.slice(0,3))}...`);

    // 数据加载完成后初始化分析器
    if (count > 0) {
      this._initializeAnalyzers();
    }
    
    return count;
  }

  /**
   * 频率分析（委托给 FrequencyAnalyzer）
   */
  analyzeFrequency() {
    if (!this.frequencyAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.frequencyAnalyzer.analyzeFrequency();
  }

  /**
   * 获取热号冷号（委托给 FrequencyAnalyzer）
   */
  getHotColdNumbers(topN = CONFIG.HOT_NUMBERS_COUNT) {
    if (!this.frequencyAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.frequencyAnalyzer.getHotColdNumbers(topN);
  }

  /**
   * 遗漏值计算（委托给 OmissionCalculator）
   */
  calculateOmission() {
    if (!this.omissionCalculator) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.omissionCalculator.calculateOmission();
  }

  /**
   * 趋势分析（委托给 TrendAnalyzer）
   */
  analyzeSumTrend() {
    if (!this.trendAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.trendAnalyzer.analyzeSumTrend();
  }

  /**
   * 跨度分析（委托给 TrendAnalyzer）
   */
  analyzeSpan() {
    if (!this.trendAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.trendAnalyzer.analyzeSpan();
  }

  /**
   * 重号分析（委托给 TrendAnalyzer）
   */
  analyzeRepeatNumbers() {
    if (!this.trendAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.trendAnalyzer.analyzeRepeatNumbers();
  }

  /**
   * 条件概率计算（委托给 ConditionalProbability）
   */
  calculateConditionalProbability() {
    if (!this.conditionalProbability) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.conditionalProbability.calculateConditionalProbability();
  }

  /**
   * 号码关联性分析（委托给 CorrelationAnalyzer）
   */
  calculateNumberCorrelation(num1, num2, isFront = true) {
    if (!this.correlationAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    return this.correlationAnalyzer.calculateCorrelation(num1, num2, isFront);
  }

  /**
   * AC值计算
   */
  calculateACValue(numbers) {
    const diffs = new Set();
    for (let i = 0; i < numbers.length; i++) {
      for (let j = i + 1; j < numbers.length; j++) {
        diffs.add(Math.abs(numbers[i] - numbers[j]));
      }
    }
    return diffs.size - numbers.length + 1;
  }

  /**
   * 连号分析
   */
  analyzeConsecutiveNumbers(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const groups = [];
    let currentGroup = [sorted[0]];
    
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) {
        currentGroup.push(sorted[i]);
      } else {
        if (currentGroup.length > 1) {
          groups.push([...currentGroup]);
        }
        currentGroup = [sorted[i]];
      }
    }
    
    if (currentGroup.length > 1) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  /**
   * 加权采样（无放回）
   */
  weightedSampleNoReplacement(pool, weights, k) {
    const selected = [];
    const poolCopy = [...pool];
    const weightsCopy = [...weights];
    
    for (let i = 0; i < k; i++) {
      if (poolCopy.length === 0) break;
      
      const cumulativeWeights = [];
      let sum = 0;
      for (const w of weightsCopy) {
        sum += w;
        cumulativeWeights.push(sum);
      }
      
      const random = Math.random() * sum;
      let left = 0, right = cumulativeWeights.length - 1;
      let idx = right;
      
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (cumulativeWeights[mid] >= random) {
          idx = mid;
          right = mid - 1;
        } else {
          left = mid + 1;
        }
      }
      
      selected.push(poolCopy[idx]);
      poolCopy.splice(idx, 1);
      weightsCopy.splice(idx, 1);
    }
    
    return selected;
  }

  /**
   * 随机采样
   */
  randomSample(pool, count) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  // ==================== 预测方法（委托给对应模型）====================

  /**
   * 贝叶斯动态预测
   */
  generateBayesianPrediction() {
    if (!this.models.bayesian) {
      throw new Error('模型未初始化，请先调用 loadHistoryData()');
    }
    return this.models.bayesian.predict();
  }

  /**
   * 区间频率预测
   */
  generateZoneFrequencyPrediction(seed = null) {
    if (!this.models.zoneFrequency) {
      throw new Error('模型未初始化，请先调用 loadHistoryData()');
    }
    return this.models.zoneFrequency.predict();
  }

  /**
   * 通用预测分派（精简版：5个模型）
   * @param {string} modelKey - weighted/omission/distribution/zone_frequency/bayesian
   */
  generateStatisticalPrediction(modelKey = 'weighted') {
    const modelMap = {
      weighted: 'frequencyWeighted',
      omission: 'omissionAnalysis',
      distribution: 'normalDistribution',
      zone_frequency: 'zoneFrequency',
      bayesian: 'bayesian'
    };
    const modelProp = modelMap[modelKey];
    if (!modelProp || !this.models[modelProp]) {
      // 降级到频率加权
      if (!this.models.frequencyWeighted) {
        throw new Error('模型未初始化，请先调用 loadHistoryData()');
      }
      return this.models.frequencyWeighted.predict();
    }
    return this.models[modelProp].predict();
  }

  /**
   * 遗漏分析预测
   */
  generateOmissionBasedPrediction() {
    if (!this.models.omissionAnalysis) {
      throw new Error('模型未初始化，请先调用 loadHistoryData()');
    }
    return this.models.omissionAnalysis.predict();
  }

  /**
   * 获取时间衰减权重（内联实现，原TimeDecayModel已移除）
   * BackDanOptimizer/BackTuoOptimizer依赖此方法
   * @returns {Object} { front: {号码: 权重}, back: {号码: 权重} }
   */
  calculateTimeDecayWeights() {
    if (!this.frequencyAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    const activeData = this.getActiveData();
    const frontWeights = {};
    const backWeights = {};
    for (let i = 1; i <= CONFIG.FRONT_RANGE; i++) frontWeights[i] = 0;
    for (let i = 1; i <= CONFIG.BACK_RANGE; i++) backWeights[i] = 0;
    const decayFactor = CONFIG.TIME_DECAY_FACTOR;
    for (let idx = 0; idx < activeData.length; idx++) {
      const draw = activeData[idx];
      const timeWeight = Math.pow(decayFactor, activeData.length - 1 - idx);
      for (const num of draw.front) frontWeights[num] += timeWeight;
      for (const num of draw.back) backWeights[num] += timeWeight;
    }
    return { front: frontWeights, back: backWeights };
  }

  /**
   * 生成单式胆拖
   */
  generateDanTuo(danNumbers, tuoNumbers, frontCount = CONFIG.FRONT_COUNT) {
    // 验证输入
    if (!danNumbers || !tuoNumbers || danNumbers.length === 0 || tuoNumbers.length === 0) {
      throw new Error('胆码和拖码都不能为空');
    }

    const danCount = danNumbers.length;
    const needFromTuo = frontCount - danCount;

    if (danCount >= frontCount) {
      throw new Error(`胆码数量(${danCount})不能大于等于前区号码数(${frontCount})`);
    }

    if (needFromTuo > tuoNumbers.length) {
      throw new Error(`需要从拖码中选择${needFromTuo}个，但拖码只有${tuoNumbers.length}个`);
    }

    if (danCount < 1) {
      throw new Error('胆码至少需要1个');
    }

    // 检查胆码和拖码是否有重复
    const danSet = new Set(danNumbers);
    const hasOverlap = tuoNumbers.some(n => danSet.has(n));
    if (hasOverlap) {
      throw new Error('胆码和拖码不能有重复号码');
    }

    // 从拖码中选择needFromTuo个号码的所有组合
    const tuoCombinations = this.combinations(tuoNumbers, needFromTuo);
    
    // 用条件概率选最优后区（替代硬编码[1,2])
    const conditionalProb = this.conditionalProbability.calculateConditionalProbability();
    const optimalBack = this.enumerateBackPairs(conditionalProb);

    // 生成所有完整组合
    const combinations = tuoCombinations.map(tuoSelection => {
      const fullCombination = [...danNumbers, ...tuoSelection].sort((a, b) => a - b);
      return {
        front: fullCombination,
        back: optimalBack, // 条件概率最优后区
        danNumbers: danNumbers,
        tuoNumbers: tuoSelection,
        combinationType: '前区胆拖'
      };
    });

    // 计算注数
    const totalBets = combinations.length;

    return {
      danNumbers: danNumbers.sort((a, b) => a - b),
      tuoNumbers: tuoNumbers.sort((a, b) => a - b),
      danCount,
      tuoCount: tuoNumbers.length,
      needFromTuo,
      totalBets,
      combinations,
      cost: totalBets * 2, // 假设每注2元
      generatedAt: new Date().toLocaleString('zh-CN')
    };
  }

  /**
   * 组合计算工具方法
   */
  combinations(arr, k) {
    if (k > arr.length || k <= 0) return [];
    if (k === arr.length) return [arr];
    if (k === 1) return arr.map(item => [item]);

    const result = [];
    for (let i = 0; i <= arr.length - k; i++) {
      const head = arr[i];
      const tailCombinations = this.combinations(arr.slice(i + 1), k - 1);
      tailCombinations.forEach(tail => {
        result.push([head, ...tail]);
      });
    }
    return result;
  }

  /**
   * 枚举最优后区配对（基于条件概率评分）
   * 从所有C(12,2)=66种后区配对中选择评分最高的1组
   * @param {Object} conditionalProb - 条件概率数据 {front, back, confidence}
   * @returns {number[]} 最优2个后区号码
   */
  enumerateBackPairs(conditionalProb) {
    const confidence = conditionalProb.confidence || 0.3;
    let bestPair = [1, 2]; // 兜底
    let bestScore = -Infinity;

    // 枚举所有66种配对
    for (let a = 1; a <= CONFIG.BACK_RANGE; a++) {
      for (let b = a + 1; b <= CONFIG.BACK_RANGE; b++) {
        let score = 0;
        // 条件概率得分
        score += (conditionalProb.back[a] || 0) * CONFIG.BACK_CONDITIONAL_WEIGHT * confidence * 10;
        score += (conditionalProb.back[b] || 0) * CONFIG.BACK_CONDITIONAL_WEIGHT * confidence * 10;
        // 频率得分
        const [, backCounter] = this.frequencyAnalyzer.analyzeFrequency();
        const freqA = (backCounter[String(a)] || backCounter[a] || 0) * 0.2;
        const freqB = (backCounter[String(b)] || backCounter[b] || 0) * 0.2;
        score += freqA + freqB;
        // 遗漏回归得分
        const omission = this.omissionCalculator.calculateOmission();
        const avgOmission = this.omissionCalculator.getAverageOmission('back');
        const omissionA = omission.back[a] || 0;
        const omissionB = omission.back[b] || 0;
        if (omissionA > avgOmission) score += (omissionA - avgOmission) * 0.3;
        if (omissionB > avgOmission) score += (omissionB - avgOmission) * 0.3;
        // 历史配对频率
        const backPairFreq = this.cache.backPairFrequency;
        if (backPairFreq) {
          const pairKey = `${a}-${b}`;
          score += (backPairFreq[pairKey] || 0) * 0.1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestPair = [a, b];
        }
      }
    }
    return bestPair;
  }

  /**
   * 生成复式胆拖
   */
  generateDoubleDanTuo(params) {
    const { frontDan, frontTuo, backDan, backTuo } = params;

    // 生成前区组合
    const frontResult = this.generateDanTuo(frontDan, frontTuo, CONFIG.FRONT_COUNT);

    // 处理后区
    let backCombinations = [];
    if (backDan && backDan.length > 0 && backTuo && backTuo.length > 0) {
      // 后区有胆码的常规胆拖模式
      const backNeed = CONFIG.BACK_COUNT - backDan.length;
      if (backNeed > 0) {
        const backTuoCombs = this.combinations(backTuo, backNeed);
        backCombinations = backTuoCombs.map(backSel => [...backDan, ...backSel].sort((a, b) => a - b));
      } else {
        backCombinations = [backDan.sort((a, b) => a - b)];
      }
    } else if (backTuo && backTuo.length >= 2 && (!backDan || backDan.length === 0)) {
      // 后区0胆纯拖模式：从拖码中选2个组合
      const backTuoCombs = this.combinations(backTuo, CONFIG.BACK_COUNT);
      backCombinations = backTuoCombs.map(backSel => backSel.sort((a, b) => a - b));
    } else {
      // 后区不使用胆拖，使用默认值
      backCombinations = [[1, 2]];
    }

    // 组合前后区
    const fullCombinations = [];
    const isPureTuo = !backDan || backDan.length === 0;
    frontResult.combinations.forEach(frontComb => {
      backCombinations.forEach(back => {
        fullCombinations.push({
          front: frontComb.front,
          back: back,
          danNumbers: frontComb.danNumbers,
          tuoNumbers: frontComb.tuoNumbers,
          backDan: backDan || [],
          backTuo: backTuo || [],
          combinationType: isPureTuo ? '前区胆拖+后区纯拖' : '双区胆拖'
        });
      });
    });

    return {
      ...frontResult,
      backDan: backDan || [],
      backTuo: backTuo || [],
      backCombinations: backCombinations.length,
      totalBets: fullCombinations.length,
      combinations: fullCombinations,
      cost: fullCombinations.length * 2
    };
  }

  /**
   * 计算命中数
   */
  calculateHits(prediction, actualDraw) {
    const predFront = new Set(prediction.slice(0, CONFIG.FRONT_COUNT));
    const predBack = new Set(prediction.slice(CONFIG.FRONT_COUNT));
    const actualFront = new Set(actualDraw.front);
    const actualBack = new Set(actualDraw.back);
    
    let hits = 0;
    predFront.forEach(num => {
      if (actualFront.has(num)) hits++;
    });
    predBack.forEach(num => {
      if (actualBack.has(num)) hits++;
    });
    
    return hits;
  }

  /**
   * 统计连号对数
   */
  countConsecutivePairs(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    let pairs = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) {
        pairs++;
      }
    }
    return pairs;
  }

  /**
   * 获取质量评级
   */
  getQualityRating(score) {
    if (score >= 90) return 'S级 (极佳)';
    if (score >= 80) return 'A级 (优秀)';
    if (score >= 70) return 'B级 (良好)';
    if (score >= 60) return 'C级 (一般)';
    return 'D级 (较差)';
  }

  /**
   * 计算胆码质量评分
   */
  calculateDanQualityScore(metrics) {
    let score = 70; // 基础分

    // 热号加分
    if (metrics.hotDanCount >= 1 && metrics.hotDanCount <= 2) {
      score += 10;
    } else if (metrics.hotDanCount > 2) {
      score -= 5; // 太多热号可能不好
    }

    // 冷号惩罚
    if (metrics.coldDanCount > 1) {
      score -= 10;
    }

    // AC值评分
    if (metrics.acValue >= 2 && metrics.acValue <= 4) {
      score += 10;
    } else if (metrics.acValue < 2 || metrics.acValue > 5) {
      score -= 5;
    }

    // 奇偶平衡
    const oddEvenDiff = Math.abs(metrics.oddCount - metrics.evenCount);
    if (oddEvenDiff <= 1) {
      score += 5;
    } else if (oddEvenDiff > 2) {
      score -= 5;
    }

    // 大小平衡
    const bigSmallDiff = Math.abs(metrics.bigCount - metrics.smallCount);
    if (bigSmallDiff <= 1) {
      score += 5;
    } else if (bigSmallDiff > 2) {
      score -= 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 分析胆码质量
   */
  // eslint-disable-next-line no-unused-vars
  analyzeDanQuality(danNumbers, tuoNumbers) {
    // 胆码的冷热分析
    const hotColdAnalysis = this.getHotColdNumbers(10);
    const hotNumbers = hotColdAnalysis.frontHot.map(item => Number(item[0]));
    const coldNumbers = hotColdAnalysis.frontCold.map(item => Number(item[0]));

    let hotDanCount = 0;
    let coldDanCount = 0;
    danNumbers.forEach(num => {
      if (hotNumbers.includes(num)) hotDanCount++;
      if (coldNumbers.includes(num)) coldDanCount++;
    });

    // 胆码的AC值贡献
    const acValue = this.calculateACValue(danNumbers);

    // 胆码的和值贡献
    const danSum = danNumbers.reduce((a, b) => a + b, 0);

    // 胆码的奇偶比
    const oddCount = danNumbers.filter(n => n % 2 !== 0).length;
    const evenCount = danNumbers.length - oddCount;

    // 胆码的大小比（以18为界）
    const bigCount = danNumbers.filter(n => n > 18).length;
    const smallCount = danNumbers.length - bigCount;

    return {
      hotDanCount,
      coldDanCount,
      acValue,
      danSum,
      oddEvenRatio: `${oddCount}:${evenCount}`,
      bigSmallRatio: `${bigCount}:${smallCount}`,
      qualityScore: this.calculateDanQualityScore({
        hotDanCount,
        coldDanCount,
        acValue,
        oddCount,
        evenCount,
        bigCount,
        smallCount,
        danCount: danNumbers.length
      })
    };
  }

  /**
   * 增强版组合质量评估 - 多维度综合评价
   */
  evaluateCombinationQuality(combination, context = {}) {
    const { front } = combination;
    let qualityScore = 0;
    const details = {};

    // 1. AC值评估 (20%权重)
    const acValue = this.calculateACValue(front);
    details.acValue = acValue;
    if (acValue >= 2 && acValue <= 4) {
      qualityScore += 20;
    } else if (acValue >= 1 && acValue <= 5) {
      qualityScore += 10;
    } else {
      qualityScore += 5;
    }

    // 2. 和值评估 (15%权重)
    const sum = front.reduce((a, b) => a + b, 0);
    details.sum = sum;
    const expectedSum = 90; // 理论平均和值
    const sumDeviation = Math.abs(sum - expectedSum);
    if (sumDeviation <= 15) {
      qualityScore += 15;
    } else if (sumDeviation <= 25) {
      qualityScore += 10;
    } else {
      qualityScore += 5;
    }

    // 3. 奇偶比评估 (15%权重)
    const oddCount = front.filter(n => n % 2 !== 0).length;
    const evenCount = front.length - oddCount;
    details.oddEvenRatio = `${oddCount}:${evenCount}`;
    const oddEvenDiff = Math.abs(oddCount - evenCount);
    if (oddEvenDiff <= 1) {
      qualityScore += 15;
    } else if (oddEvenDiff <= 2) {
      qualityScore += 10;
    } else {
      qualityScore += 5;
    }

    // 4. 大小比评估 (15%权重)
    const bigCount = front.filter(n => n > 18).length;
    const smallCount = front.length - bigCount;
    details.bigSmallRatio = `${bigCount}:${smallCount}`;
    const bigSmallDiff = Math.abs(bigCount - smallCount);
    if (bigSmallDiff <= 1) {
      qualityScore += 15;
    } else if (bigSmallDiff <= 2) {
      qualityScore += 10;
    } else {
      qualityScore += 5;
    }

    // 5. 区间分布评估 (15%权重)
    const zone1 = front.filter(n => n >= 1 && n <= 12).length; // 一区
    const zone2 = front.filter(n => n >= 13 && n <= 24).length; // 二区
    const zone3 = front.filter(n => n >= 25 && n <= 35).length; // 三区
    details.zoneDistribution = `${zone1}:${zone2}:${zone3}`;
    
    // 理想分布是每个区都有号码，且分布相对均匀
    const hasAllZones = zone1 > 0 && zone2 > 0 && zone3 > 0;
    if (hasAllZones) {
      qualityScore += 15;
    } else if (zone1 > 0 && zone2 > 0 || zone2 > 0 && zone3 > 0 || zone1 > 0 && zone3 > 0) {
      qualityScore += 10; // 至少覆盖两个区
    } else {
      qualityScore += 5; // 只覆盖一个区
    }

    // 6. 连号评估 (10%权重)
    const consecutivePairs = this.countConsecutivePairs(front);
    details.consecutivePairs = consecutivePairs;
    if (consecutivePairs <= 1) {
      qualityScore += 10; // 最多1对连号为佳
    } else if (consecutivePairs <= 2) {
      qualityScore += 5;
    } else {
      qualityScore += 0; // 连号过多
    }

    // 7. 重号评估 (10%权重) - 与上期重复号码
    if (context.lastDraw && context.lastDraw.front) {
      const repeatCount = front.filter(n => context.lastDraw.front.includes(n)).length;
      details.repeatCount = repeatCount;
      if (repeatCount <= 2) {
        qualityScore += 10; // 0-2个重号为佳
      } else if (repeatCount <= 3) {
        qualityScore += 5;
      } else {
        qualityScore += 0; // 重号过多
      }
    } else {
      qualityScore += 5; // 无上期数据时给基础分
    }

    return {
      totalScore: Math.min(100, qualityScore),
      details,
      rating: this.getQualityRating(qualityScore)
    };
  }

  /**
   * 计算胆码评分
   */
  calculateDanScore(number, context = {}) {
    const { 
      hotColdData, 
      omissionData, 
      trendData,
      conditionalProb,
      recentPatterns 
    } = context;
    
    // 动态权重调整：根据近期趋势调整各因子权重
    const weights = this.calculateDynamicWeights(context);
    
    let score = 0;
    
    // 1. 频率得分 (动态权重)
    if (hotColdData) {
      const freqRank = hotColdData.frontHot.findIndex(item => Number(item[0]) === number);
      if (freqRank !== -1) {
        score += weights.frequency * (1 - freqRank / 10); // 排名越靠前得分越高
      }
    }
    
    // 2. 遗漏值得分 (动态权重) - 适度遗漏最佳
    if (omissionData) {
      const omission = omissionData.front[number] || 0;
      const avgOmission = Object.values(omissionData.front).reduce((a,b) => a+b, 0) / 
                         Object.values(omissionData.front).length;
      
      // 遗漏值在平均值的0.8-1.2倍之间得满分
      const ratio = omission / avgOmission;
      let omissionScore = 0;
      if (ratio >= 0.8 && ratio <= 1.2) {
        omissionScore = weights.omission;
      } else if (ratio < 0.8) {
        omissionScore = weights.omission * (ratio / 0.8); // 遗漏太少递减
      } else {
        omissionScore = weights.omission * Math.max(0, 1 - (ratio - 1.2) / 2); // 遗漏太多递减
      }
      score += omissionScore;
    }
    
    // 3. 趋势得分 (动态权重)
    if (trendData && trendData.trendScores) {
      score += weights.trend * (trendData.trendScores[number] || 0) * 100; // 放大趋势影响
    }
    
    // 4. 条件概率得分 (动态权重)
    if (conditionalProb) {
      score += weights.conditional * (conditionalProb.front[number] || 0) * 100; // 放大条件概率影响
    }
    
    // 5. 近期模式匹配得分 (动态权重)
    if (recentPatterns && recentPatterns.patternMatch) {
      score += weights.pattern * (recentPatterns.patternMatch[number] || 0) * 100;
    }
    
    // 6. 位置偏好得分 (动态权重) - 某些号码在特定位置出现频率更高
    if (recentPatterns && recentPatterns.positionPreference) {
      score += weights.position * (recentPatterns.positionPreference[number] || 0) * 100;
    }
    
    return Math.min(100, Math.max(0, score));
  }

  /**
   * 计算动态权重 - 根据近期趋势调整各因子的重要性
   */
  calculateDynamicWeights(context = {}) {
    // 默认权重
    const defaultWeights = {
      frequency: 25,      // 频率权重
      omission: 20,       // 遗漏权重
      trend: 20,          // 趋势权重
      conditional: 15,    // 条件概率权重
      pattern: 10,        // 模式匹配权重
      position: 10        // 位置偏好权重
    };
    
    // 如果有近期数据，根据趋势调整权重
    if (context.trendData && context.trendData.volatility) {
      const volatility = context.trendData.volatility;
      
      // 高波动期：增加趋势和条件概率的权重
      if (volatility > 0.7) {
        return {
          frequency: 20,
          omission: 15,
          trend: 25,
          conditional: 20,
          pattern: 10,
          position: 10
        };
      }
      // 低波动期：增加频率和遗漏的权重
      else if (volatility < 0.3) {
        return {
          frequency: 30,
          omission: 25,
          trend: 15,
          conditional: 10,
          pattern: 10,
          position: 10
        };
      }
    }
    
    // 正常情况使用默认权重
    return defaultWeights;
  }

  /**
   * 优化拖码选择（统一评分器）
   * 使用UnifiedScorer的5维度归一化评分，替代旧版DanTuoOptimizer
   */
  optimizeTuoSelectionWithZoneFrequency(danNumbers, candidateNumbers, targetCount = 10, strategy = 'balanced') {
    if (!this.frequencyAnalyzer) {
      throw new Error('分析器未初始化，请先调用 loadHistoryData()');
    }
    const scored = UnifiedScorer.score(this, 'front', strategy)
      .filter(r => !danNumbers.includes(r.number));
    return UnifiedScorer.weightedSample(scored, targetCount);
  }

  /**
   * 生成唯一的多组号码（通用）
   * 精简版：仅支持5个保留模型（bayesian/weighted/omission/distribution/zone_frequency）
   */
  generateUniqueGroups(model, groups) {
    const results = [];
    const usedBackKeys = new Set();
    
    const generateComb = (modelKey) => {
      switch (modelKey) {
        case 'bayesian':
          return this.generateBayesianPrediction();
        case 'zone_frequency':
          return this.generateZoneFrequencyPrediction();
        case 'omission':
          return this.generateOmissionBasedPrediction();
        default:
          return this.generateStatisticalPrediction(modelKey);
      }
    };
    
    for (let i = 0; i < groups; i++) {
      const comb = generateComb(model);
      const front = comb.slice(0, CONFIG.FRONT_COUNT);
      const back = comb.slice(CONFIG.FRONT_COUNT);
      const backKey = [...back].sort((a, b) => a - b).join(',');
      
      if (!usedBackKeys.has(backKey)) {
        usedBackKeys.add(backKey);
        results.push({ front, back });
      }
    }
    
    // 如果数量不足，继续生成
    while (results.length < groups) {
      const comb = generateComb(model);
      const front = comb.slice(0, CONFIG.FRONT_COUNT);
      const back = comb.slice(CONFIG.FRONT_COUNT);
      results.push({ front, back });
    }
    
    return results;
  }

  // ==================== 模型推荐功能 ====================

  /**
   * 分析并推荐最佳模型
   */
  analyzeAndRecommendModel(latestDraw, customSampleSize = null) {
    if (!latestDraw || !latestDraw.front || !latestDraw.back) {
      return null;
    }

    // 生成缓存键（基于最新开奖号码和样本量）
    const sampleSizeKey = customSampleSize || 'auto';
    const cacheKey = `recommendation_${latestDraw.front.join(',')}_${latestDraw.back.join(',')}_${sampleSizeKey}`;
    const now = Date.now();
    
    // 根据历史数据量动态调整缓存时间
    const dataVolume = this.historyData.length;
    let CACHE_DURATION;
    if (dataVolume >= 200) {
      CACHE_DURATION = 5 * 60 * 1000; // 200+期：缓存5分钟（更稳定）
    } else if (dataVolume >= 100) {
      CACHE_DURATION = 4 * 60 * 1000; // 100-200期：缓存4分钟
    } else {
      CACHE_DURATION = 3 * 60 * 1000; // <100期：缓存3分钟
    }

    // 检查缓存是否有效
    if (this.cache.recommendation && 
        this.cache.recommendation.key === cacheKey) {
      const cacheAge = now - this.cache.recommendation.timestamp;
      const cacheAgeMinutes = Math.floor(cacheAge / 60000);
      
      if (cacheAge < CACHE_DURATION) {
        console.log(`✅ 使用缓存的推荐结果（已缓存${cacheAgeMinutes}分钟，有效期3分钟）`);
        return this.cache.recommendation.data;
      } else {
        console.log(`⏰ 缓存已过期（${cacheAgeMinutes}分钟 > 3分钟），重新计算...`);
      }
    }

    console.log(`🔄 开始重新计算推荐结果（大样本分析，历史数据${dataVolume}期）...`);

    // 生成各模型的预测结果（精简版：5个模型）
    let sampleCount;
    if (customSampleSize) {
      sampleCount = customSampleSize;
      console.log(`📊 使用用户指定的样本量: ${customSampleSize}组/模型`);
    } else {
      sampleCount = dataVolume >= 200 ? 80 : dataVolume >= 100 ? 60 : 50;
      console.log(`📊 使用自动样本量: ${sampleCount}组/模型（基于${dataVolume}期数据）`);
    }

    // 统一预测生成函数
    const generatePredictions = (modelKey, count) => {
      const preds = [];
      for (let i = 0; i < count; i++) {
        const pred = this.generateUniqueGroups(modelKey, 1)[0];
        preds.push({
          front: pred.front,
          back: pred.back
        });
      }
      return preds;
    };

    const bayesianPreds = generatePredictions('bayesian', sampleCount);
    const weightedPreds = generatePredictions('weighted', sampleCount);
    const omissionPreds = generatePredictions('omission', sampleCount);
    const distributionPreds = generatePredictions('distribution', sampleCount);
    const zoneFreqPreds = generatePredictions('zone_frequency', sampleCount);

    // 计算每个模型的命中率
    const calculateHitRate = (predictions, actual) => {
      let totalFrontHits = 0;
      let totalBackHits = 0;
      const totalPredictions = predictions.length;

      predictions.forEach(pred => {
        const frontSet = new Set(actual.front);
        const backSet = new Set(actual.back);
        pred.front.forEach(num => { if (frontSet.has(num)) totalFrontHits++; });
        pred.back.forEach(num => { if (backSet.has(num)) totalBackHits++; });
      });

      return {
        frontHitRate: (totalFrontHits / (totalPredictions * 5) * 100).toFixed(1),
        backHitRate: (totalBackHits / (totalPredictions * 2) * 100).toFixed(1),
        totalHits: totalFrontHits + totalBackHits,
        avgTotalHits: ((totalFrontHits + totalBackHits) / totalPredictions).toFixed(2),
        sampleCount: totalPredictions,
        expectedFrontRate: 14.3,
        expectedBackRate: 16.7
      };
    };

    const bayesianStats = calculateHitRate(bayesianPreds, latestDraw);
    const weightedStats = calculateHitRate(weightedPreds, latestDraw);
    const omissionStats = calculateHitRate(omissionPreds, latestDraw);
    const distributionStats = calculateHitRate(distributionPreds, latestDraw);
    const zoneFreqStats = calculateHitRate(zoneFreqPreds, latestDraw);

    // 综合评分算法
    const calculateScore = (stats) => {
      const frontWeight = 0.55;
      const backWeight = 0.45;
      const baseScore = parseFloat(stats.frontHitRate) * frontWeight +
                       parseFloat(stats.backHitRate) * backWeight;
      const stabilityFactor = stats.sampleCount >= 80 ? 1.0 :
                             stats.sampleCount >= 60 ? 0.99 :
                             stats.sampleCount >= 50 ? 0.97 : 0.95;
      const coverageFactor = Math.min(stats.sampleCount / 80, 1.0);
      const expectedTotal = parseFloat(stats.expectedFrontRate) * frontWeight +
                           parseFloat(stats.expectedBackRate) * backWeight;
      const performanceRatio = baseScore / expectedTotal;
      const bonusFactor = performanceRatio > 1.2 ? 1.05 :
                         performanceRatio > 1.1 ? 1.03 : 1.0;
      return baseScore * stabilityFactor * (0.8 + 0.2 * coverageFactor) * bonusFactor;
    };

    const models = [
      { name: '贝叶斯动态', key: 'bayesian', stats: bayesianStats, score: calculateScore(bayesianStats), predictions: bayesianPreds, characteristics: ['概率统计', '动态调整', '遗漏分析'] },
      { name: '频率加权', key: 'weighted', stats: weightedStats, score: calculateScore(weightedStats), predictions: weightedPreds, characteristics: ['历史频率', '条件概率', '加权选择'] },
      { name: '遗漏分析', key: 'omission', stats: omissionStats, score: calculateScore(omissionStats), predictions: omissionPreds, characteristics: ['遗漏回归', '条件概率', '关联性'] },
      { name: '正态分布', key: 'distribution', stats: distributionStats, score: calculateScore(distributionStats), predictions: distributionPreds, characteristics: ['统计分布', '和值引导', '组合评估'] },
      { name: '区间频率分析', key: 'zone_frequency', stats: zoneFreqStats, score: calculateScore(zoneFreqStats), predictions: zoneFreqPreds, characteristics: ['区间定位', '频率统计', '热区选号'] }
    ];

    // 按分数排序
    models.sort((a, b) => b.score - a.score);

    const bestModel = models[0];
    const secondModel = models[1];
    const thirdModel = models[2];

    // 找出各维度的最佳模型
    const bestFrontModel = [...models].sort((a, b) =>
      parseFloat(b.stats.frontHitRate) - parseFloat(a.stats.frontHitRate)
    )[0];
    const bestBackModel = [...models].sort((a, b) =>
      parseFloat(b.stats.backHitRate) - parseFloat(a.stats.backHitRate)
    )[0];

    // 生成推荐理由
    let reason = '';
    const bestBackRate = parseFloat(bestModel.stats.backHitRate);
    const bestFrontRate = parseFloat(bestModel.stats.frontHitRate);
    const secondBackRate = parseFloat(secondModel.stats.backHitRate);

    if (bestBackRate > 50) {
      reason = `${bestModel.name}在后区预测上表现卓越（命中率${bestModel.stats.backHitRate}%），远超随机期望（16.7%）；`;
    } else if (bestBackRate > 40) {
      reason = `${bestModel.name}后区命中率较高（${bestModel.stats.backHitRate}%），明显优于随机选择；`;
    } else if (bestFrontRate > 18) {
      reason = `${bestModel.name}在前区预测上表现出色（命中率${bestModel.stats.frontHitRate}%），优于随机期望（14.3%）；`;
    } else {
      reason = `综合多维度分析，${bestModel.name}在${dataVolume}期历史数据中整体表现最优；`;
    }

    const scoreDiffPercent = ((bestModel.score - secondModel.score) / secondModel.score * 100).toFixed(1);
    if (bestBackRate > secondBackRate * 1.4) {
      reason += '且后区命中率大幅领先其他模型。';
    } else if (scoreDiffPercent < 3) {
      reason += `与第二名差距微小（仅${scoreDiffPercent}%），建议结合使用。`;
    } else {
      reason += `综合得分领先第二名${scoreDiffPercent}%。`;
    }

    const charStr = bestModel.characteristics.join('、');
    reason += `\n💡 特色：${charStr}`;
    if (bestFrontModel.key !== bestModel.key) {
      reason += `\n🎯 前区最佳: ${bestFrontModel.name} (${bestFrontModel.stats.frontHitRate}%)`;
    }
    if (bestBackModel.key !== bestModel.key) {
      reason += `\n🎯 后区最佳: ${bestBackModel.name} (${bestBackModel.stats.backHitRate}%)`;
    }

    let alternativeSuggestion = '';
    if (thirdModel && parseFloat(thirdModel.stats.backHitRate) > 40) {
      alternativeSuggestion = `\n🔄 备选方案：${thirdModel.name}在后区也有不错表现（${thirdModel.stats.backHitRate}%），可交叉参考。`;
    }

    const result = {
      recommendedModel: bestModel,
      allModels: models,
      reason,
      alternativeSuggestion,
      latestDraw,
      analysisTime: new Date().toLocaleString('zh-CN'),
      dataVolume: dataVolume,
      sampleSize: sampleCount
    };

    // 缓存结果
    this.cache.recommendation = {
      key: cacheKey,
      timestamp: now,
      data: result
    };

    console.log(`✅ 推荐结果已缓存（有效期${CACHE_DURATION/60000}分钟，数据量${dataVolume}期）`);
    console.log(`📊 最佳模型: ${bestModel.name} (得分: ${bestModel.score.toFixed(2)})`);
    console.log(`📈 样本量: 各模型${sampleCount}组（总计${sampleCount * 5}组）`);
    console.log(`📋 各模型得分:`, models.map(m => `${m.name}:${m.score.toFixed(2)}`).join(', '));

    return result;
  }

  /**
   * 评估模型性能（精简版：5个模型）
   */
  evaluateModelPerformance(windowSize = 20) {
    const cacheKey = `modelPerformance_${windowSize}`;
    if (this.cache.modelPerformance && this.cache.modelPerformance.key === cacheKey) {
      return this.cache.modelPerformance.result;
    }

    const modelKeys = ['bayesian', 'weighted', 'omission', 'distribution', 'zone_frequency'];
    const defaultWeights = {};
    modelKeys.forEach(k => defaultWeights[k] = 1.0 / modelKeys.length);

    if (this.historyData.length < windowSize + 5) {
      this.cache.modelPerformance = { key: cacheKey, result: defaultWeights };
      return defaultWeights;
    }

    const modelScores = {};
    modelKeys.forEach(k => modelScores[k] = 0);
    let testCount = 0;

    for (let i = this.historyData.length - windowSize; i < this.historyData.length; i++) {
      const actualDraw = this.historyData[i];
      const tempAnalyzer = new LotteryAnalyzer();
      const historyForPrediction = this.historyData.slice(0, i);
      const dataStr = historyForPrediction.map(d =>
        `${d.front.join(' ')} ${d.back.join(' ')}`
      ).join('\n');
      tempAnalyzer.loadHistoryData(dataStr, '临时数据');

      try {
        for (const key of modelKeys) {
          const pred = tempAnalyzer.generateUniqueGroups(key, 1)[0];
          const hits = this.calculateHits([...pred.front, ...pred.back], actualDraw);
          modelScores[key] += hits;
        }
        testCount++;
      } catch (error) {
        console.warn('模型评估出错:', error.message);
      }
    }

    const avgScores = {};
    modelKeys.forEach(k => avgScores[k] = testCount > 0 ? modelScores[k] / testCount : 0);

    const totalScore = Object.values(avgScores).reduce((a, b) => a + b, 0);
    let weights;
    if (totalScore > 0) {
      weights = {};
      modelKeys.forEach(k => weights[k] = avgScores[k] / totalScore);
    } else {
      weights = { ...defaultWeights };
    }

    // 平滑因子
    const smoothingFactor = 0.7;
    const smoothedWeights = {};
    modelKeys.forEach(k =>
      smoothedWeights[k] = weights[k] * smoothingFactor + defaultWeights[k] * (1 - smoothingFactor)
    );
    const smoothedTotal = Object.values(smoothedWeights).reduce((a, b) => a + b, 0);
    const finalWeights = {};
    modelKeys.forEach(k => finalWeights[k] = smoothedWeights[k] / smoothedTotal);

    this.cache.modelPerformance = { key: cacheKey, result: finalWeights };
    return finalWeights;
  }

  // ==================== 其他辅助方法 ====================

  /**
   * 计算期望值
   */
  calculateExpectedValue() {
    if (this.cache.expectedValue) {
      return this.cache.expectedValue;
    }
    
    const [frontCounter, backCounter] = this.analyzeFrequency();
    const totalFront = Object.values(frontCounter).reduce((a, b) => a + b, 0);
    const totalBack = Object.values(backCounter).reduce((a, b) => a + b, 0);
    
    const expFront = totalFront > 0 
      ? Object.entries(frontCounter).reduce((sum, [num, count]) => sum + Number(num) * count, 0) / totalFront 
      : (CONFIG.FRONT_RANGE + 1) / 2; // 默认值为中间值 18
      
    const expBack = totalBack > 0 
      ? Object.entries(backCounter).reduce((sum, [num, count]) => sum + Number(num) * count, 0) / totalBack 
      : (CONFIG.BACK_RANGE + 1) / 2; // 默认值为中间值 6.5
      
    const result = [expFront, expBack];
    this.cache.expectedValue = result;
    return result;
  }

  /**
   * 计算方差
   */
  calculateVariance() {
    if (this.cache.variance) {
      return this.cache.variance;
    }
    
    const [frontCounter, backCounter] = this.analyzeFrequency();
    const [expFront, expBack] = this.calculateExpectedValue();
    const totalFront = Object.values(frontCounter).reduce((a, b) => a + b, 0);
    const totalBack = Object.values(backCounter).reduce((a, b) => a + b, 0);
    
    const varFront = totalFront > 0 
      ? Object.entries(frontCounter).reduce((sum, [num, count]) => sum + count * Math.pow(Number(num) - expFront, 2), 0) / totalFront 
      : 0;
      
    const varBack = totalBack > 0 
      ? Object.entries(backCounter).reduce((sum, [num, count]) => sum + count * Math.pow(Number(num) - expBack, 2), 0) / totalBack 
      : 0;
      
    const result = {
      frontVar: varFront,
      frontStd: Math.sqrt(varFront),
      backVar: varBack,
      backStd: Math.sqrt(varBack)
    };
    
    this.cache.variance = result;
    return result;
  }

  /**
   * 计算和值概率
   */
  calculateSumProbability() {
    const sumCount = { front: {}, back: {} };
    
    // 统计历史数据中的和值分布
    for (const data of this.getActiveData()) {
      const frontSum = data.front.reduce((a, b) => a + b, 0);
      const backSum = data.back.reduce((a, b) => a + b, 0);
      
      sumCount.front[frontSum] = (sumCount.front[frontSum] || 0) + 1;
      sumCount.back[backSum] = (sumCount.back[backSum] || 0) + 1;
    }
    
    // 计算概率
    const activeData = this.getActiveData();
    const totalDraws = activeData.length || 1;
    const frontProb = {};
    const backProb = {};
    
    for (const [sum, count] of Object.entries(sumCount.front)) {
      frontProb[sum] = (count / totalDraws * 100).toFixed(1);
    }
    
    for (const [sum, count] of Object.entries(sumCount.back)) {
      backProb[sum] = (count / totalDraws * 100).toFixed(1);
    }
    
    return { front: frontProb, back: backProb };
  }

  /**
   * 复式玩法 - 杀号分析
   * @param {Object} options - 杀号配置选项
   * @returns {Object} 杀号结果
   */
  eliminateNumbers(options = {}) {
    return NumberEliminator.eliminate(this, options);
  }

  /**
   * 结构杀号分析（增强版）
   * @param {Object} options - 杀号配置选项
   * @returns {Object} 杀号结果
   */
  structuralEliminate(options = {}) {
    return StructuralEliminator.eliminate(this, options);
  }

  /** 回测验证 */
  backtestEliminate(options = {}) {
    return StructuralEliminator.backtest(this, options);
  }

  /**
   * 胆拖玩法回测验证 - 用历史数据测试胆拖推荐命中率
   * @param {Object} options - 回测参数
   * @param {string} options.strategy - 推荐策略: hot/balanced/conservative
   * @param {number} options.danCount - 前区胆码数量（默认4）
   * @param {number} options.tuoCount - 前区拖码数量
   * @param {boolean} options.backDanEnabled - 是否启用后区胆码
   * @param {number} options.backTuoCount - 后区拖码数量
   * @param {boolean} options.backFullDrag - 是否一胆全拖
   * @param {number} options.backtestPeriods - 回测期数（默认20）
   * @returns {Object} 回测结果
   */
  backtestDanTuo(options = {}) {
    const strategy = options.strategy || 'hot';
    const danCount = options.danCount || 4;
    const tuoCount = options.tuoCount || 10;
    const backDanEnabled = options.backDanEnabled !== false;
    const backTuoCount = options.backTuoCount || 4;
    const backFullDrag = options.backFullDrag || false;
    const periods = options.backtestPeriods || 20;

    const activeData = this.getActiveData();
    if (activeData.length < periods + 30) {
      return {
        success: false,
        summary: `历史数据不足（需要${periods + 30}期，当前${activeData.length}期）`,
        details: [],
        frontDanHitRate: 0,
        frontTuoHitRate: 0,
        backHitRate: 0
      };
    }

    const results = [];
    const testStart = activeData.length - periods;

    for (let i = testStart; i < activeData.length; i++) {
      const actualDraw = activeData[i];
      const trainData = activeData.slice(0, i);
      if (trainData.length < 30) continue;

      // 创建临时 analyzer 使用训练数据
      // 需要通过 loadHistoryData 正确初始化所有分析器
      const trainDataStr = trainData.map(d => d.full.join(' ')).join('\n');
      const tempAnalyzer = new LotteryAnalyzer();
      tempAnalyzer.loadHistoryData(trainDataStr, '回测训练数据');

      // 前区胆码推荐
      let frontDan = [];
      let frontTuo = [];
      let backDan = [];
      let backTuo = [];

      try {
        const frontDanResult = FrontDanOptimizer.optimize(tempAnalyzer, danCount, strategy);
        frontDan = frontDanResult.selected;

        // 前区拖码推荐
        const allFront = Array.from({length: 35}, (_, k) => k + 1);
        const tuoCandidates = allFront.filter(n => !frontDan.includes(n));
        frontTuo = tempAnalyzer.optimizeTuoSelectionWithZoneFrequency(frontDan, tuoCandidates, tuoCount, strategy);
      } catch (e) {
        console.warn('胆拖回测-前区推荐失败:', e);
        continue;
      }

      // 后区推荐
      try {
        if (backDanEnabled) {
          const backDanResult = BackDanOptimizer.optimize(tempAnalyzer, 1, strategy);
          backDan = backDanResult.selected;

          if (backFullDrag) {
            backTuo = Array.from({length: 12}, (_, k) => k + 1).filter(n => !backDan.includes(n));
          } else {
            const backTuoResult = BackTuoOptimizer.optimize(tempAnalyzer, backDan, backTuoCount, strategy);
            backTuo = backTuoResult.selected;
          }
        } else {
          const backTuoResult = BackTuoOptimizer.optimize(tempAnalyzer, [], backTuoCount, strategy);
          backTuo = backTuoResult.selected;
        }
      } catch (e) {
        console.warn('胆拖回测-后区推荐失败:', e);
      }

      // 计算命中情况
      const frontDanHits = frontDan.filter(n => actualDraw.front.includes(n)).length;
      const frontTuoHits = frontTuo.filter(n => actualDraw.front.includes(n)).length;
      const frontAllHits = [...frontDan, ...frontTuo].filter(n => actualDraw.front.includes(n)).length;
      const backDanHits = backDan.filter(n => actualDraw.back.includes(n)).length;
      const backTuoHits = backTuo.filter(n => actualDraw.back.includes(n)).length;
      const backAllHits = [...backDan, ...backTuo].filter(n => actualDraw.back.includes(n)).length;

      // 前区胆码是否至少命中1个
      const frontDanAtLeast1 = frontDanHits >= 1;
      // 前区总号码池（胆+拖）命中数
      const frontPoolCoverage = frontAllHits;
      // 后区号码池命中率
      const backCoverage = backAllHits;

      results.push({
        periodIndex: i + 1,
        actualDraw: { front: actualDraw.front, back: actualDraw.back },
        frontDan,
        frontTuo,
        backDan,
        backTuo,
        frontDanHits,
        frontTuoHits,
        frontAllHits,
        backDanHits,
        backTuoHits,
        backAllHits,
        frontDanAtLeast1,
        frontPoolCoverage,
        backCoverage
      });
    }
    
    if (results.length === 0) {
      return {
        success: false,
        summary: '回测无有效结果',
        details: [],
        frontDanHitRate: 0,
        frontTuoHitRate: 0,
        backHitRate: 0
      };
    }

    // 统计汇总
    const avgDanHits = results.reduce((a, r) => a + r.frontDanHits, 0) / results.length;
    const danAtLeast1Rate = results.filter(r => r.frontDanAtLeast1).length / results.length;
    const avgFrontPoolHits = results.reduce((a, r) => a + r.frontAllHits, 0) / results.length;
    const avgFrontTuoHits = results.reduce((a, r) => a + r.frontTuoHits, 0) / results.length;
    const avgBackHits = results.reduce((a, r) => a + r.backAllHits, 0) / results.length;
    const avgBackDanHits = results.reduce((a, r) => a + r.backDanHits, 0) / results.length;
    const avgBackTuoHits = results.reduce((a, r) => a + r.backTuoHits, 0) / results.length;

    // 随机基线：从35个号码中选danCount个胆码，期望命中5*danCount/35
    const randomDanExpect = 5 * danCount / 35;
    // 从tuoCount个拖码中选(5-danCount)个，期望命中(5-danCount)*tuoCount/35
    const frontNeedFromTuo = 5 - danCount;
    const randomTuoExpect = frontNeedFromTuo * tuoCount / 35;
    // 随机基线后区
    const randomBackExpect = backDanEnabled ? (2 * (backDan.length || 1) / 12 + 2 * backTuoCount / 12) : (2 * backTuoCount / 12);

    const strategyName = strategy === 'hot' ? '热号策略' : strategy === 'balanced' ? '均衡策略' : '保守策略';
    const backModeName = backDanEnabled ? (backFullDrag ? '一胆全拖' : '胆拖模式') : '纯拖模式';

    const summary = `${strategyName}回测${results.length}期（${backModeName}）：` +
      `前区胆码命中${avgDanHits.toFixed(2)}个/期（随机期望${randomDanExpect.toFixed(2)}个），` +
      `胆码至少命中1个概率${(danAtLeast1Rate * 100).toFixed(1)}%，` +
      `前区号码池（胆+拖）命中${avgFrontPoolHits.toFixed(2)}个/期，` +
      `后区命中${avgBackHits.toFixed(2)}个/期（随机期望${randomBackExpect.toFixed(2)}个）`;

    return {
      success: true,
      strategy: strategyName,
      backMode: backModeName,
      summary,
      details: results,
      danCount,
      tuoCount,
      backDanEnabled,
      backTuoCount,
      avgDanHits,
      danAtLeast1Rate,
      avgFrontPoolHits,
      avgFrontTuoHits,
      avgBackHits,
      avgBackDanHits,
      avgBackTuoHits,
      randomDanExpect,
      randomTuoExpect,
      randomBackExpect,
      totalPeriods: results.length
    };
  }

  /** 混合模式杀号 */
  mixedEliminateNumbers(options = {}) {
    return StructuralEliminator.mixedEliminate(this, options);
  }

  /** 智能推荐杀号模式 */
  recommendEliminationMode() {
    return StructuralEliminator.recommendMode(this);
  }

  /**
   * 复式玩法 - 生成复式组合
   * @param {number[]} frontNumbers - 前区号码池
   * @param {number[]} backNumbers - 后区号码池
   * @returns {Object} 复式组合结果
   */
  generateFushiCombinations(frontNumbers, backNumbers) {
    return NumberEliminator.generateFushiCombinations(frontNumbers, backNumbers);
  }

  /**
   * 计算后区配对频率
   */
  calculateBackPairFrequency() {
    if (this.cache.backPairFrequency) {
      return this.cache.backPairFrequency;
    }
    
    const pairFreq = {};
    for (const data of this.getActiveData()) {
      const pairKey = [...data.back].sort((a, b) => a - b).join(',');
      pairFreq[pairKey] = (pairFreq[pairKey] || 0) + 1;
    }
    
    this.cache.backPairFrequency = pairFreq;
    return pairFreq;
  }
}

export default LotteryAnalyzer;
