import { useState, useEffect } from 'react';
import LotteryAnalyzer from './utils/LotteryAnalyzer.js';
import { CONFIG } from './utils/core/Config.js';
import { BackDanOptimizer } from './utils/optimization/BackDanOptimizer.js';
import { FrontDanOptimizer } from './utils/optimization/FrontDanOptimizer.js';
import { BackTuoOptimizer } from './utils/optimization/BackTuoOptimizer.js';
import { CombinationValidator } from './utils/optimization/CombinationValidator.js';
import { ConfidenceCalculator } from './utils/optimization/ConfidenceCalculator.js';
import { NumberEliminator } from './utils/optimization/NumberEliminator.js';
import { trackNumberGeneration, trackCopy, trackSave, trackDataUpdate, trackModelSelection } from './utils/baiduAnalytics';
import AuthGuard from './components/AuthGuard';
import DataVisualization from './components/DataVisualization';
import ShuangSeQiuPage from './components/ShuangSeQiuPage';
import ZoneAnalysisPanel from './components/ZoneAnalysisPanel';
import LotteryBlackboard from './components/LotteryBlackboard';
import './components/LotteryBlackboard.css';
import './App.css';

// 隐藏页面进入机制：连续点击标题7次（3秒内）可进入福彩双色球玩法页面
let titleClickCount = 0;
let titleClickTimer = null;

// 辅助模型推荐卡片组件（可展开/收起）
function ModelRecommendationCard({ rec, info, formatNums }) {
  const [expanded, setExpanded] = useState(false);
  const borderColors = { bayesian: '#9b59b6', normal: '#3498db', zhouyi: '#e67e22' };
  const modelKey = info.name === '贝叶斯动态' ? 'bayesian' : info.name === '正态分布' ? 'normal' : 'zhouyi';
  const borderColor = borderColors[modelKey] || '#9b59b6';

  // 计算下次开奖具体日期
  const nextDrawDateStr = (() => {
    const dayNames = { 1: '周一', 3: '周三', 6: '周六' };
    const now = new Date();
    const weekday = now.getDay();
    const drawDays = [1, 3, 6];
    let minDiff = 7, nextDrawDay = 1;
    for (const d of drawDays) {
      let diff = d - weekday;
      if (diff < 0) diff += 7; // 只有负数才加7
      // 如果diff=0（今天就是开奖日），检查是否已开奖
      if (diff === 0 && (now.getHours() > 21 || (now.getHours() === 21 && now.getMinutes() >= 0))) diff = 7; // 21:00后认为已开奖，找下一期
      if (diff < minDiff) { minDiff = diff; nextDrawDay = d; }
    }
    const nextDate = new Date(now);
    nextDate.setDate(nextDate.getDate() + minDiff);
    const y = nextDate.getFullYear();
    const m = String(nextDate.getMonth() + 1).padStart(2, '0');
    const d = String(nextDate.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}（${dayNames[nextDrawDay]}）`;
  })();

  return (
    <div className="back-recommendation" style={{marginBottom: '8px', borderLeft: `3px solid ${borderColor}`}}>
      <div className="back-rec-header">
        <span className="back-rec-icon">{info.icon}</span>
        <span className="back-rec-title" style={{color: borderColor}}>{info.name}模型</span>
        <button 
          className="expand-btn" 
          onClick={() => setExpanded(!expanded)}
          style={{
            marginLeft: 'auto', padding: '0 8px', fontSize: '0.8em',
            background: 'transparent', border: 'none',
            cursor: 'pointer', color: borderColor, transition: 'opacity 0.2s',
            fontWeight: '500'
          }}
        >
          {expanded ? '收起' : '点击打开详情'}
        </button>
      </div>
      <div style={{fontSize: '0.75em', color: '#555', marginBottom: '4px', marginLeft: '24px'}}>
        {nextDrawDateStr}开奖
      </div>
      <p className="back-rec-info" style={{fontWeight: '500'}}>
        前区胆码: <strong>{rec.danSelected ? formatNums(rec.danSelected) : '--'}</strong> | 
        前区拖码: <strong>{rec.tuoSelected ? formatNums(rec.tuoSelected) : '--'}</strong> | 
        后区: <strong>{rec.back && rec.back.danSelected ? formatNums(rec.back.danSelected) + ' + ' + formatNums(rec.back.tuoSelected || []) : '--'}</strong>
      </p>
      {expanded && (
        <div style={{marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #eee'}}>
          <p className="back-rec-info" style={{fontSize: '0.85em', color: '#444', marginBottom: '6px'}}>
            {rec.description}
          </p>
          {info.strengths && info.strengths.length > 0 && (
            <div style={{fontSize: '0.8em', color: '#27ae60', marginBottom: '2px'}}>
              ✅ 优势:
              <ul style={{margin: '4px 0 0 16px', padding: 0}}>
                {info.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {info.weaknesses && info.weaknesses.length > 0 && (
            <div style={{fontSize: '0.8em', color: '#e74c3c'}}>
              ️ 局限:
              <ul style={{margin: '4px 0 0 16px', padding: 0}}>
                {info.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 动态导入外部数据文件（如果存在）
let externalDataPromise = null;
try {
  // 这个导入会在打包时由 Vite 处理
  // 如果文件不存在会静默失败
  externalDataPromise = import('./data/lottery-history.txt?raw').then(module => {
    console.log('已加载外部数据文件');
    return module.default;
  }).catch(() => {
    console.log('未找到外部数据文件，使用默认数据');
    return '';
  });
} catch (e) {
  // 忽略导入错误
  externalDataPromise = Promise.resolve('');
}

const defaultData = `07 09 23 27 32 02 08
04 08 15 20 31 07 08
02 09 11 15 16 02 04
05 18 23 25 32 05 09
02 04 16 23 35 06 11
05 12 18 23 35 06 12
01 03 13 20 26 03 10
03 06 17 21 33 05 11
05 12 13 14 33 05 08
02 03 13 18 26 02 09
14 21 23 29 33 02 10
01 02 09 22 25 01 06
03 05 06 23 26 01 04
16 18 23 34 35 01 06
01 04 10 13 17 03 11
08 09 12 19 24 01 06
04 05 10 23 31 07 12
09 11 19 30 35 01 12
12 13 14 16 31 04 12
01 10 21 23 29 10 12
05 08 12 14 17 04 05
05 09 10 18 26 05 06
09 25 26 27 28 01 08
02 04 08 10 21 09 12
03 15 24 28 29 03 07
10 11 22 26 32 01 08
09 10 11 12 16 01 11
15 27 29 30 34 01 10
03 05 17 33 35 05 07
02 13 22 28 34 05 12
06 08 22 29 34 05 07
03 04 19 26 32 01 12
03 05 07 09 18 02 10
11 12 25 26 27 08 11
02 22 30 33 34 08 12
04 07 16 26 32 05 08
07 12 13 28 32 06 08
08 17 21 33 35 06 07
09 11 20 26 27 06 09
06 12 12 21 34 08 09
24 25 27 29 34 02 06
02 07 13 19 24 03 08
08 12 14 19 22 11 12
03 08 22 26 29 07 10
01 15 21 26 33 04 07
01 13 18 27 33 04 07
09 20 21 23 28 06 11
11 17 20 23 35 01 10
01 06 14 15 17 02 03
06 10 14 23 33 08 10
13 18 28 32 33 02 11
02 03 20 28 33 02 12
02 09 14 20 31 05 09
02 06 14 22 24 08 11
09 10 20 33 35 04 11`;

const modelNames = {
  weighted: '频率加权',
  regression: '均值回归',
  distribution: '正态分布',
  balanced: '平衡策略',
  omission: '遗漏分析',
  time_decay: '时间衰减',
  bayesian: '贝叶斯动态',
  rotation: '旋转矩阵',
  zhouyi: '周易时空',
  hybrid: '混合模型',
  zone_frequency: '区间频率分析'  // 新增：区间频率分析算法
};

const modelDescriptions = {
  weighted: '根据历史出现频率加权，高频号码有更高概率被选中。通过统计每个号码在历史数据中的总出现次数，赋予其相应的权重，模拟“热号恒热”的趋势。',
  regression: '基于期望值和标准差，模拟均值回归现象。认为号码的出现会围绕一个平均值波动，当某个号码长期未出时，其出现的理论概率会逐渐增加。',
  distribution: '利用正态分布特性，生成符合统计规律的号码。通过分析历史号码的分布曲线，优先选择落在大概率区间内的数值组合。',
  balanced: '混合热号和随机号，平衡稳定性与多样性。在保留高频号码的基础上，引入一定比例的随机冷门号码，防止预测结果过于单一。',
  omission: '分析遗漏期数，选择处于合理遗漏区间的号码。追踪每个号码自上次出现以来的间隔期数，寻找那些即将结束“休眠期”的潜力号码。',
  time_decay: '考虑时间因素，近期出现的号码权重更高。采用指数衰减算法，让最近几期的开奖数据对预测结果产生更大的影响力。',
  bayesian: '使用贝叶斯定理计算条件概率，动态调整预测权重。结合先验知识（如冷热状态）和新的开奖数据，不断修正每个号码的后验概率。',
  rotation: '运用组合数学旋转矩阵，多策略轮换提高覆盖度。通过特定的数学矩阵排列，确保在投入相同注数的情况下，尽可能覆盖更多的中奖组合。',
  zhouyi: '结合周易卦象与时空因子，传统智慧与现代算法融合。将开奖日期、期号等转化为易学参数，配合五行生克原理进行选号。',
  hybrid: '融合周易、贝叶斯、旋转矩阵三大模型优势，采用投票机制和智能加权。多数模型认可的号码优先，通过多维度评分筛选高质量组合，实现前后区均衡命中。',
  zone_frequency: '区间频率分析算法：前区分7区（每区5号），后区分2区（每区6号）。统计各区间的历史出现频率，选出最热区间，再从这些区间中选择高频号码，实现精准的区间定位。'
};

function App() {
  const [analyzer] = useState(new LotteryAnalyzer());
  const [dataInput, setDataInput] = useState(defaultData);
  const [stats, setStats] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [selectedModels, setSelectedModels] = useState(['weighted', 'regression']);
  const [newNumber, setNewNumber] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [groupsPerModel, setGroupsPerModel] = useState(5);
  const [recommendSampleSize, setRecommendSampleSize] = useState(80); // 推荐算法样本量
  const [dataWindow, setDataWindow] = useState(60); // 历史数据窗口：0=全部，N=最近N期（默认60期）
  const [copySuccess, setCopySuccess] = useState(false);
  const [currentRecommendation, setCurrentRecommendation] = useState(null); // 当前推荐结果
  
  // 每日号码生成缓存相关状态
  const [todayPrediction, setTodayPrediction] = useState(null); // 今日生成的号码
  const [lastGenerateTime, setLastGenerateTime] = useState(null); // 上次生成时间
  const [refreshCount, setRefreshCount] = useState(0); // 今日刷新次数
  const [isGenerating, setIsGenerating] = useState(false); // 是否正在生成
  const [showVisualization, setShowVisualization] = useState(false); // 是否显示可视化
  // 胆拖玩法状态
  const [danNumbers, setDanNumbers] = useState([]); // 胆码
  const [tuoNumbers, setTuoNumbers] = useState([]); // 拖码
  const [backDanNumbers, setBackDanNumbers] = useState([]); // 后区胆码
  const [backTuoNumbers, setBackTuoNumbers] = useState([]); // 后区拖码
  const [dantuoResult, setDantuoResult] = useState(null); // 胆拖结果
  const [useBackFullDrag, setUseBackFullDrag] = useState(false); // 是否使用后区一胆全拖
  const [dantuoRecommendation, setDantuoRecommendation] = useState(null); // 胆拖推荐
  const [tuoCount, setTuoCount] = useState(10); // 前区拖码个数（默认10个）
  const [recommendStrategy, setRecommendStrategy] = useState('hot'); // 推荐策略: hot-热号, balanced-均衡, conservative-保守
  const [hasGeneratedToday, setHasGeneratedToday] = useState(false); // 今日是否已生成（用户主动操作）
  const [backDanEnabled, setBackDanEnabled] = useState(false); // 是否启用后区胆码（默认关闭，纯拖模式）
  const [backTuoCount, setBackTuoCount] = useState(2); // 后区拖码个数（默认2个）
  const [danTuoBacktestResult, setDanTuoBacktestResult] = useState(null); // 胆拖回测结果
  const [selectionMode, setSelectionMode] = useState('dan'); // 选择模式: dan-胆码, tuo-拖码
  const [backSelectionMode, setBackSelectionMode] = useState('dan'); // 后区选择模式
  const [copyDanTuoSuccess, setCopyDanTuoSuccess] = useState(false); // 复制成功状态
  const [modelRecommendations, setModelRecommendations] = useState(null); // 辅助模型推荐结果
  const [showSSQPage, setShowSSQPage] = useState(false); // 是否显示福彩双色球玩法页面
    const [showBlackboard, setShowBlackboard] = useState(false); // 是否显示号码分布黑板
    const [showFushi, setShowFushi] = useState(false); // 是否显示复式玩法
    const [eliminationResult, setEliminationResult] = useState(null); // 杀号分析结果
    const [fushiResult, setFushiResult] = useState(null); // 复式组合结果
    const [selectedPlan, setSelectedPlan] = useState(null); // 选中的复式套餐
    const [fushiFrontSelected, setFushiFrontSelected] = useState([]); // 复式前区自动选号结果
    const [fushiBackSelected, setFushiBackSelected] = useState([]); // 复式后区自动选号结果
    const [eliminationOptions, setEliminationOptions] = useState({ recentPeriods: 30, overheatCount: 6, backOverheatCount: 6, zScoreThreshold: 1.5, consecutiveThreshold: 3, backConsecutiveThreshold: 2, mode: 'basic' }); // 杀号参数
    const [structuralOptions, setStructuralOptions] = useState({ 
      zoneBreakEnabled: true, 
      sumMin: 65, 
      sumMax: 115, 
      repeatKillCount: 3, 
      tailKillEnabled: true,
      hotPeriods: 10,
      coldPeriods: 20
    }); // 结构杀号参数
    const [showDebugInfo, setShowDebugInfo] = useState(false); // 是否显示调试信息
    const [backtestResult, setBacktestResult] = useState(null); // 回测结果
    const [recommendResult, setRecommendResult] = useState(null); // 智能推荐结果

  // 检查 URL hash 是否为 #ssq，用于隐藏页面直接访问
  useEffect(() => {
    const checkHash = () => {
      if (window.location.hash === '#ssq') {
        setShowSSQPage(true);
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  // 隐藏页面 - 标题点击处理
  const handleTitleClick = () => {
    titleClickCount++;
    if (titleClickTimer) clearTimeout(titleClickTimer);
    if (titleClickCount >= 7) {
      titleClickCount = 0;
      setShowSSQPage(true);
      window.location.hash = '#ssq';
      return;
    }
    titleClickTimer = setTimeout(() => { titleClickCount = 0; }, 3000);
  };
  const getLatestDrawFromData = () => {
    if (!analyzer.historyData || analyzer.historyData.length === 0) return null;
    
    // 最后一组数据是最新的
    const latestIndex = analyzer.historyData.length - 1;
    const latest = analyzer.historyData[latestIndex];
    const front = latest.full.slice(0, 5);
    const back = latest.full.slice(5, 7);
    
    return {
      front,
      back,
      numbers: latest.full
    };
  };

  useEffect(() => {
    loadData();
    loadTodayPrediction(); // 加载今日缓存
    loadSelectedModels(); // 加载用户选择的模型
  }, []);

  const loadData = async () => {
    // 优先使用外部数据文件，否则使用 LocalStorage 或默认数据
    let initialData = defaultData;
    
    console.log('开始加载数据...');
    console.log('defaultData 行数:', defaultData.trim().split('\n').length);
    
    // 等待外部数据文件加载
    if (externalDataPromise) {
      try {
        const externalData = await externalDataPromise;
        console.log('externalData 长度:', externalData ? externalData.length : 0);
        console.log('externalData 前100字符:', externalData ? externalData.substring(0, 100) : 'null');
        
        if (externalData && externalData.trim()) {
          const lines = externalData.trim().split('\n').filter(l => l.trim());
          console.log('externalData 行数:', lines.length);
          initialData = externalData;
          console.log('✅ 使用外部数据文件');
        } else {
          console.log('⚠️ externalData 为空');
        }
      } catch (e) {
        console.log('❌ 加载外部数据失败:', e.message);
      }
    }
    
    // 如果没有外部数据，尝试从 LocalStorage 加载
    if (initialData === defaultData) {
      const saved = localStorage.getItem('lottery_data');
      if (saved) {
        initialData = saved;
        console.log('✅ 从 LocalStorage 加载数据');
      } else {
        console.log('✅ 使用 defaultData');
      }
    }
    
    const finalLines = initialData.trim().split('\n').filter(l => l.trim());
    console.log('最终数据行数:', finalLines.length);
    console.log('第一行:', finalLines[0]);
    console.log('最后一行:', finalLines[finalLines.length - 1]);
    
    setDataInput(initialData);
    analyzer.loadHistoryData(initialData, "用户数据");
    const hotCold = analyzer.getHotColdNumbers();
    const [expFront, expBack] = analyzer.calculateExpectedValue();
    const variance = analyzer.calculateVariance();
    const sumProb = analyzer.calculateSumProbability();
    setStats({ hotCold, expFront, expBack, variance, sumProb });
    localStorage.setItem('lottery_data', initialData);
    
    // 追踪数据加载
    trackDataUpdate(analyzer.historyData.length);
  };

  const clearCache = () => {
    localStorage.removeItem('lottery_data');
    setDataInput(defaultData);
  };

  // 立即分析推荐模型
  const handleAnalyzeRecommendation = () => {
    console.log('🔴 按钮被点击了！');
    console.log('analyzer.historyData 长度:', analyzer.historyData.length);
    
    const latestDraw = getLatestDrawFromData();
    console.log('latestDraw:', latestDraw);
    
    if (!latestDraw) {
      alert('请先加载历史数据！当前数据量: ' + analyzer.historyData.length);
      return;
    }
    
    console.log('🔍 开始分析推荐模型...');
    console.log('最新开奖:', latestDraw);
    console.log('样本量:', recommendSampleSize);
    console.log('数据窗口:', dataWindow);
    
    // 设置数据窗口
    analyzer.setDataWindow(dataWindow);
    
    // 立即执行分析，不使用setTimeout
    try {
      const recommendation = analyzer.analyzeAndRecommendModel(latestDraw, recommendSampleSize);
      console.log('✅ 推荐结果:', recommendation);
      setCurrentRecommendation(recommendation);
    } catch (error) {
      console.error('❌ 分析失败:', error);
      alert('分析失败：' + error.message);
    }
  };

  // 加载今日缓存
  const loadTodayPrediction = () => {
    const today = new Date().toDateString();
    const cacheKey = `lottery_prediction_${today}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      try {
        const data = JSON.parse(cached);
        // 加载数据到状态
        setTodayPrediction(data.prediction);
        setPredictions(data.prediction); // ✅ 关键：恢复predictions状态，让号码显示出来
        setLastGenerateTime(data.timestamp);
        setRefreshCount(data.refreshCount || 0);
        // 如果检测到缓存，说明今天已经生成过
        setHasGeneratedToday(true);
        console.log('✅ 检测到今日缓存:', data.timestamp);
      } catch (e) {
        console.error('解析缓存失败:', e);
      }
    } else {
      console.log('ℹ️ 无今日缓存');
    }
  };

  // 加载用户选择的模型
  const loadSelectedModels = () => {
    const saved = localStorage.getItem('selected_models');
    if (saved) {
      try {
        const models = JSON.parse(saved);
        setSelectedModels(models);
        console.log('✅ 恢复用户选择的模型:', models);
      } catch (e) {
        console.error('解析模型选择失败:', e);
      }
    }
  };

  // 保存用户选择的模型
  const saveSelectedModels = (models) => {
    localStorage.setItem('selected_models', JSON.stringify(models));
  };

  // 保存今日缓存
  const saveTodayPrediction = (prediction, refreshCount = 0) => {
    const today = new Date().toDateString();
    const cacheKey = `lottery_prediction_${today}`;
    const data = {
      prediction,
      timestamp: new Date().toLocaleString('zh-CN'),
      refreshCount
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
    setTodayPrediction(prediction);
    setLastGenerateTime(data.timestamp);
    setRefreshCount(refreshCount);
  };

  // 检查是否可以刷新（已移除限制）
  const canRegenerate = () => {
    return true; // 不限制刷新次数
  };

  // 重新生成号码（手动刷新）
  const handleRegenerate = () => {
    console.log('🔄 重新生成按钮被点击');
    if (confirm('确定要重新生成吗？这将覆盖当前号码。')) {
      console.log('✅ 用户确认重新生成');
      const newRefreshCount = refreshCount + 1;
      setIsGenerating(true);
      
      setTimeout(() => {
        const groups = groupsPerModel || 5;
        const results = [];
        selectedModels.forEach(model => {
          // 旋转矩阵特殊处理：使用去重生成
          if (model === 'rotation') {
            const rotationResults = analyzer.generateUniqueRotationGroups(groups);
            rotationResults.forEach((group, idx) => {
              results.push({
                model,
                groupNum: idx + 1,
                front: group.front,
                back: group.back
              });
            });
          } else {
            // 其他模型：使用多组去重生成，避免后区重复
            const uniqueGroups = analyzer.generateUniqueGroups(model, groups);
            uniqueGroups.forEach((group, idx) => {
              results.push({
                model,
                groupNum: idx + 1,
                front: group.front,
                back: group.back
              });
            });
          }
          
          // 追踪每个模型的生成
          trackNumberGeneration(model, groups);
        });
        
        console.log('📊 生成的结果数量:', results.length);
        setPredictions(results);
        console.log('✅ predictions状态已更新');
        setCopySuccess(false);
        setHasGeneratedToday(true);
        setRefreshCount(newRefreshCount);
        
        // 保存今日缓存（不包括周易）
        const shouldCache = !selectedModels.includes('zhouyi');
        if (shouldCache && results.length > 0) {
          saveTodayPrediction(results, newRefreshCount);
        }
        
        setIsGenerating(false);
      }, 300);
    }
  };



  const handleGenerate = () => {
    setIsGenerating(true);
    
    setTimeout(() => {
      const groups = groupsPerModel || 5;
      const results = [];
      selectedModels.forEach(model => {
        // 旋转矩阵特殊处理：使用去重生成
        if (model === 'rotation') {
          const rotationResults = analyzer.generateUniqueRotationGroups(groups);
          rotationResults.forEach((group, idx) => {
            results.push({
              model,
              groupNum: idx + 1,
              front: group.front,
              back: group.back
            });
          });
        } else {
          // 其他模型：使用多组去重生成，避免后区重复
          const uniqueGroups = analyzer.generateUniqueGroups(model, groups);
          uniqueGroups.forEach((group, idx) => {
            results.push({
              model,
              groupNum: idx + 1,
              front: group.front,
              back: group.back
            });
          });
        }
        
        // 追踪每个模型的生成
        trackNumberGeneration(model, groups);
      });
      setPredictions(results);
      setCopySuccess(false);
      
      // 标记今日已生成（用户主动操作）
      setHasGeneratedToday(true);
      
      // 保存今日缓存（不包括周易）
      const shouldCache = !selectedModels.includes('zhouyi');
      if (shouldCache && results.length > 0) {
        // 如果是首次生成（无缓存），刷新次数为0；否则使用当前refreshCount
        const newRefreshCount = todayPrediction ? refreshCount : 0;
        saveTodayPrediction(results, newRefreshCount);
      }
      
      setIsGenerating(false);
    }, 300); // 添加轻微延迟，显示加载状态
  };

  // 胆拖玩法 - 生成组合
  const handleGenerateDanTuo = () => {
    if (danNumbers.length === 0 || tuoNumbers.length === 0) {
      alert('请选择至少1个前区胆码和1个前区拖码！');
      return;
    }

    try {
      let result;
      if (backTuoNumbers.length > 0) {
        if (backDanEnabled && backDanNumbers.length > 0) {
          // 后区有胆码的常规胆拖模式
          result = analyzer.generateDoubleDanTuo({
            frontDan: danNumbers,
            frontTuo: tuoNumbers,
            backDan: backDanNumbers,
            backTuo: backTuoNumbers
          });
        } else {
          // 后区0胆纯拖模式
          result = analyzer.generateDoubleDanTuo({
            frontDan: danNumbers,
            frontTuo: tuoNumbers,
            backDan: [],
            backTuo: backTuoNumbers
          });
        }
      } else {
        // 单区胆拖（仅前区）
        result = analyzer.generateDanTuo(danNumbers, tuoNumbers, 5);
      }
      
      setDantuoResult(result);
    } catch (error) {
      alert(`错误: ${error.message}`);
    }
  };

  // 胆拖玩法 - 切换号码选择
  const toggleDanNumber = (num) => {
    if (danNumbers.includes(num)) {
      setDanNumbers(danNumbers.filter(n => n !== num));
    } else {
      if (danNumbers.length >= 4) {
        alert('胆码最多选择4个！');
        return;
      }
      // 检查是否已在拖码中
      if (tuoNumbers.includes(num)) {
        alert('该号码已在拖码中，请先从拖码中移除！');
        return;
      }
      setDanNumbers([...danNumbers, num].sort((a, b) => a - b));
    }
  };

  const toggleTuoNumber = (num) => {
    if (tuoNumbers.includes(num)) {
      setTuoNumbers(tuoNumbers.filter(n => n !== num));
    } else {
      // 拖码数量检查：最多可以选择剩余的31个号码（35-4个胆码）
      const maxTuoCount = 35 - danNumbers.length;
      if (tuoNumbers.length >= maxTuoCount) {
        alert(`拖码最多选择${maxTuoCount}个（剩余所有号码）！`);
        return;
      }
      // 检查是否已在胆码中
      if (danNumbers.includes(num)) {
        alert('该号码已在胆码中，请先从胆码中移除！');
        return;
      }
      setTuoNumbers([...tuoNumbers, num].sort((a, b) => a - b));
    }
  };

  const toggleBackDanNumber = (num) => {
    if (!backDanEnabled) {
      alert('后区胆码已关闭，请开启胆码开关或选择拖码！');
      return;
    }
    if (backDanNumbers.includes(num)) {
      setBackDanNumbers(backDanNumbers.filter(n => n !== num));
    } else {
      if (backDanNumbers.length >= 1) {
        alert('后区胆码最多选择1个！');
        return;
      }
      if (backTuoNumbers.includes(num)) {
        alert('该号码已在后区拖码中，请先从拖码中移除！');
        return;
      }
      setBackDanNumbers([...backDanNumbers, num].sort((a, b) => a - b));
    }
  };

  const toggleBackTuoNumber = (num) => {
    if (backTuoNumbers.includes(num)) {
      setBackTuoNumbers(backTuoNumbers.filter(n => n !== num));
    } else {
      // 后区拖码数量检查：最多选择backTuoCount个
      const maxBackTuoCount = backDanEnabled ? Math.min(backTuoCount, 12 - backDanNumbers.length) : Math.min(backTuoCount, 12);
      if (backTuoNumbers.length >= maxBackTuoCount) {
        alert(`后区拖码最多选择${maxBackTuoCount}个！`);
        return;
      }
      if (backDanEnabled && backDanNumbers.includes(num)) {
        alert('该号码已在后区胆码中，请先从胆码中移除！');
        return;
      }
      setBackTuoNumbers([...backTuoNumbers, num].sort((a, b) => a - b));
    }
  };

  // 计算胆拖预计注数
  const calculateDanTuoBets = () => {
    if ((danNumbers || []).length === 0 || (tuoNumbers || []).length === 0) return 0;
    
    const needFromTuo = 5 - (danNumbers || []).length;
    if (needFromTuo <= 0 || needFromTuo > (tuoNumbers || []).length) return 0;
    
    // 计算组合数 C(n, k)
    const combinations = (n, k) => {
      if (k > n || k < 0) return 0;
      if (k === 0 || k === n) return 1;
      let result = 1;
      for (let i = 0; i < k; i++) {
        result = result * (n - i) / (i + 1);
      }
      return Math.round(result);
    };
    
    let frontBets = combinations(tuoNumbers.length, needFromTuo);
    
    // 后区注数计算：适配0胆纯拖模式
    if (backTuoNumbers.length > 0) {
      if (backDanEnabled && backDanNumbers.length > 0) {
        // 有胆码的常规胆拖模式
        const backNeed = 2 - backDanNumbers.length;
        if (backNeed > 0 && backNeed <= backTuoNumbers.length) {
          const backBets = combinations(backTuoNumbers.length, backNeed);
          return frontBets * backBets;
        }
      } else {
        // 0胆纯拖模式：从拖码中选2个
        if (backTuoNumbers.length >= 2) {
          const backBets = combinations(backTuoNumbers.length, 2);
          return frontBets * backBets;
        }
      }
    }
    
    return frontBets;
  };

  // 复制当前选择的胆拖号码
  const handleCopyDanTuoSelection = () => {
    if (danNumbers.length === 0 || tuoNumbers.length === 0) {
      alert('请先选择前区胆码和拖码！');
      return;
    }

    // 格式化胆码和拖码
    const danStr = danNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
    const tuoStr = tuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
    
    // 构建复制文本
    let copyText = `【前区】\n`;
    copyText += `胆码：${danStr}\n`;
    copyText += `拖码：${tuoStr}\n`;
    copyText += `\n注数：${calculateDanTuoBets()}注`;
    
    // 后区
    if (backDanEnabled && backDanNumbers.length > 0 || backTuoNumbers.length > 0) {
      const backDanStr = backDanNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
      const backTuoStr = backTuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
      copyText += `\n\n【后区】\n`;
      if (backDanEnabled && backDanNumbers.length > 0) {
        copyText += `胆码：${backDanStr}\n`;
      }
      if (backTuoNumbers.length > 0) {
        copyText += `拖码：${backTuoStr}\n`;
      }
      if (!backDanEnabled) {
        copyText += `（纯拖模式，无胆码）\n`;
      }
    }
    
    // 复制到剪贴板
    navigator.clipboard.writeText(copyText).then(() => {
      setCopyDanTuoSuccess(true);
      setTimeout(() => setCopyDanTuoSuccess(false), 2000);
    }).catch(err => {
      console.error('复制失败:', err);
      alert('复制失败，请手动复制');
    });
  };

  // 胆拖玩法 - 智能推荐
  const handleRecommendDanTuo = (strategy = 'hot') => {
    setRecommendStrategy(strategy);
    
    console.log('🎯 开始胆拖推荐优化（融合区间频率分析v2）');
    
    // 获取热号和冷号
    const hotCold = analyzer.getHotColdNumbers(15);
    const hotNumbers = hotCold.frontHot.map(item => Number(item[0]));
    const coldNumbers = hotCold.frontCold.map(item => Number(item[0]));
    const backHotNumbers = hotCold.backHot.map(item => Number(item[0]));
    const backColdNumbers = hotCold.backCold.map(item => Number(item[0]));
    
    let recommendedDan, recommendedTuo, strategyName, description;
    // 后区胆拖号码（局部变量，覆盖state，确保旁白与显示一致）
    let backDanNumbers = [];
    let backTuoNumbers = [];
    
    // ==================== 胆码智能推荐（FrontDanOptimizer + 降级备选）====================
    let frontDanProbInfo = [];
    let frontDanNote = '';
    let frontZoneInfo = '';
    // 胆码数量：所有策略统一为4个
    let danCount = 4;

    try {
      // 主方案：使用多维度评分 + 加权随机采样
      const frontDanResult = FrontDanOptimizer.optimize(analyzer, danCount, strategy);
      const optimizedDan = frontDanResult.selected;
      frontDanProbInfo = frontDanResult.probabilityInfo;
      frontZoneInfo = frontDanResult.zoneInfo || '';
      
      // 生成热度排名旁白
      frontDanNote = frontDanProbInfo.slice(0, 3).map((p, idx) => 
        `${p.number.toString().padStart(2, '0')}(${idx === 0 ? '最热' : '第' + (idx + 1) + '热'})`
      ).join('、');
      
      // 确保胆码数量：从旧推荐中补充差额
      if (optimizedDan.length < danCount) {
        const needCount = danCount - optimizedDan.length;
        const extraNums = recommendedDan.filter(n => !optimizedDan.includes(n)).slice(0, needCount);
        optimizedDan.push(...extraNums);
      }
      
      // 拖码选择 - 优先使用用户配置的数量，但确保不超过最大可用数
      const allNumbers = Array.from({length: 35}, (_, i) => i + 1);
      const tuoCandidates = allNumbers.filter(n => !optimizedDan.includes(n));
      const maxTuo = 35 - optimizedDan.length; // 最大可用拖码数量(4胆=31拖)
      const actualTuoCount = Math.min(tuoCount, maxTuo); // 实际使用数量：取用户选择和最大值的较小者
      
      // ==================== 方案2：使用融合区间频率的拖码优化算法 ====================
      console.log(' 方案2：调用融合区间频率的拖码优化');
      let optimizedTuo;
      try {
        optimizedTuo = analyzer.optimizeTuoSelectionWithZoneFrequency(
          optimizedDan, 
          tuoCandidates, 
          actualTuoCount, // 使用实际拖码数量（用户选择或最大值中的较小者）
          strategy
        );
        console.log('✅ 方案2成功：拖码已基于区间频率优化');
      } catch (error) {
        console.warn('️ 方案2失败，降级到普通优化:', error);
        optimizedTuo = analyzer.optimizeTuoSelection(optimizedDan, tuoCandidates, actualTuoCount);
      }
      
      // 使用优化后的胆拖组合
      recommendedDan = optimizedDan;
      recommendedTuo = optimizedTuo;
      
      // 更新描述，加入热度排名信息
      description = `多维度智能评分，前区号码推荐热度：${frontDanNote}`;
      
    } catch (error) {
      console.warn('智能优化失败，降级到区间频率分析:', error);
      // 降级方案：使用区间频率分析选胆码
      try {
        const zoneFrequencyResult = analyzer.generateZoneFrequencyPrediction();
        const candidateDanNumbers = zoneFrequencyResult.slice(0, 5);
        recommendedDan = candidateDanNumbers.slice(0, danCount);
        if (recommendedDan.length < danCount) {
          recommendedDan.push(...hotNumbers.slice(0, danCount - recommendedDan.length));
        }
        strategyName = strategy === 'hot' ? '热号策略（降级）' : strategy === 'balanced' ? '均衡策略（降级）' : '保守策略（降级）';
        description = '智能优化失败，降级到区间频率分析选胆码';
      } catch (fallbackError) {
        console.warn('降级策略也失败，使用热号基础策略:', fallbackError);
        recommendedDan = hotNumbers.slice(0, danCount);
        strategyName = '基础策略';
        description = '降级到热号基础策略';
      }
    }
    
    setDanNumbers(recommendedDan);
    setTuoNumbers(recommendedTuo);
    
    // 处理双区模式和后区胆拖
    // 无论是否开启开关，都推荐后区号码供用户参考
    let backRecommendationInfo = '';
    
    // ==================== 方案3：后区胆拖优化（多维度智能评分）====================
    console.log('🎯 方案3：后区胆拖优化（多维度智能评分）');
            
    // 提取后区推荐逻辑到内部函数，避免代码冗余
    const generateBackRecommendation = (isFullDrag, danEnabled) => {
      if (!danEnabled) {
        // 0胆纯拖模式：只推荐拖码，使用用户选择的拖码个数
        const backTuoResult = BackTuoOptimizer.optimize(analyzer, [], backTuoCount, strategy);
        const recommendedBackTuo = backTuoResult.selected;
        const backTuoProbInfo = backTuoResult.probabilityInfo;
            
        setBackDanNumbers([]);
        setBackTuoNumbers(recommendedBackTuo);
            
        const backTuoStr = recommendedBackTuo.map(n => n.toString().padStart(2, '0')).join(' ');
        const tuoProbNote = backTuoProbInfo.slice(0, 3).map(p => 
          `${p.number.toString().padStart(2, '0')}(${p.probability.toFixed(1)}%)`
        ).join('、');
            
        const backDesc = `；后区纯拖：拖码${backTuoStr}（${recommendedBackTuo.length}个，C(${recommendedBackTuo.length},2)组合）`;
        const backInfo = `推荐后区纯拖号码：${backTuoStr}。拖码概率排名：${tuoProbNote}等。从${recommendedBackTuo.length}个拖码中组合所有2码配对。`;
            
        return { backDesc, backInfo, recommendedBackDan: [], recommendedBackTuo, backDanProbInfo: [], backTuoProbInfo };
      }
      
      const backDanResult = BackDanOptimizer.optimize(analyzer, 1, strategy);
      const recommendedBackDan = backDanResult.selected;
      const backDanProbInfo = backDanResult.probabilityInfo;
          
      let recommendedBackTuo;
      let backTuoProbInfo = [];
          
      if (isFullDrag) {
        // 一胆全拖模式：排除胆码后全选
        recommendedBackTuo = Array.from({ length: 12 }, (_, i) => i + 1)
          .filter(n => !recommendedBackDan.includes(n));
      } else {
        // 智能拖码选择（多维度评分+加权随机采样，使用用户选择的拖码个数）
        const backTuoResult = BackTuoOptimizer.optimize(analyzer, recommendedBackDan, backTuoCount, strategy);
        recommendedBackTuo = backTuoResult.selected;
        backTuoProbInfo = backTuoResult.probabilityInfo;
      }
          
      setBackDanNumbers(recommendedBackDan);
      setBackTuoNumbers(recommendedBackTuo);
          
      const backDanStr = recommendedBackDan.map(n => n.toString().padStart(2, '0')).join(' + ');
      const backTuoStr = recommendedBackTuo.map(n => n.toString().padStart(2, '0')).join(' ');;
          
      // 胆码概率旁白
      const danProbNote = backDanProbInfo.slice(0, 3).map(p => 
        `${p.number.toString().padStart(2, '0')}(${p.probability.toFixed(1)}%)`
      ).join('、');
          
      // 拖码概率旁白
      const tuoProbNote = backTuoProbInfo.slice(0, 3).map(p => 
        `${p.number.toString().padStart(2, '0')}(${p.probability.toFixed(1)}%)`
      ).join('、');
          
      let backDesc = '';
      let backInfo = '';
          
      if (isFullDrag) {
        backDesc = `；后区一胆全拖：胆码${recommendedBackDan[0]}（确定性推荐），拖码1-12除胆码外全部选择`;
        backInfo = `推荐后区胆码：${backDanStr}（确定性推荐）。后区各号码被选为胆码的概率排名：${danProbNote}等。其余11个号码全拖。`;
      } else {
        backDesc = `；后区：胆码${backDanStr}（确定性推荐），拖码${backTuoStr}`;
        backInfo = `推荐后区胆码：${backDanStr}（确定性推荐）。后区各号码被选为胆码的概率排名：${danProbNote}等。拖码概率排名：${tuoProbNote}等。每次推荐直接选择评分最高的号码，结果稳定可预期。`;
      }
          
      return { backDesc, backInfo, recommendedBackDan, recommendedBackTuo, backDanProbInfo, backTuoProbInfo };
    };
        
    try {
      const isFullDrag = useBackFullDrag;
      const backRec = generateBackRecommendation(isFullDrag, backDanEnabled);
      description += backRec.backDesc;
      backRecommendationInfo = backRec.backInfo;
      // 更新后区胆拖号码，确保旁白与显示一致
      backDanNumbers = backRec.recommendedBackDan;
      backTuoNumbers = backRec.recommendedBackTuo;
      console.log('✅ 方案3成功：后区胆拖已基于多维度智能评分优化');
    } catch (error) {
      console.warn('⚠️ 方案3失败，降级到基础策略:', error);
      try {
        const isFullDrag = useBackFullDrag;
        const backRec = generateBackRecommendation(isFullDrag, backDanEnabled);
        description += backRec.backDesc;
        backRecommendationInfo = backRec.backInfo;
        // 更新后区胆拖号码，确保旁白与显示一致
        backDanNumbers = backRec.recommendedBackDan;
        backTuoNumbers = backRec.recommendedBackTuo;
      } catch (fallbackError) {
        console.warn('⚠️ 降级策略也失败:', fallbackError);
      }
    }
        
    // 不开启后区胆码开关时，显示推荐的后区号码供参考
    if (!backDanEnabled) {
      backRecommendationInfo += ' 当前为纯拖模式（无胆码），后区所有号码从拖码中组合。如需使用胆码，请开启后区胆码开关。';
    } else if (backDanNumbers.length === 0) {
      backRecommendationInfo += ' 请先选择后区胆码，或点击智能推荐自动选取。';
    }
    
    // 生成推荐结果
    try {
      let result;
      if (backTuoNumbers.length > 0) {
        if (backDanEnabled && backDanNumbers.length > 0) {
          // 后区有胆码的常规胆拖模式
          result = analyzer.generateDoubleDanTuo({
            frontDan: recommendedDan,
            frontTuo: recommendedTuo,
            backDan: backDanNumbers,
            backTuo: backTuoNumbers
          });
        } else {
          // 后区0胆纯拖模式
          result = analyzer.generateDoubleDanTuo({
            frontDan: recommendedDan,
            frontTuo: recommendedTuo,
            backDan: [],
            backTuo: backTuoNumbers
          });
        }
      } else {
        // 没有后区号码，只生成前区胆拖
        result = analyzer.generateDanTuo(recommendedDan, recommendedTuo, 5);
      }
      
      // 组合质量后验验证 + 自动微调
      const frontForValidation = [...recommendedDan, ...recommendedTuo.slice(0, 5 - recommendedDan.length)];
      const backForValidation = (backDanEnabled && backDanNumbers.length > 0) 
        ? [...backDanNumbers, ...backTuoNumbers.slice(0, 2 - backDanNumbers.length)] 
        : backTuoNumbers.length >= 2 ? backTuoNumbers.slice(0, 2) : [];
      let validationResult = null;
      let finalFront = frontForValidation;
      let finalBack = backForValidation.length >= 2 ? backForValidation : [];
      if (frontForValidation.length === 5) {
        try {
          validationResult = CombinationValidator.validate(finalFront, finalBack, analyzer);
          // 验证不通过时自动微调（最多3轮）
          if (validationResult && !validationResult.passed) {
            console.log('🔧 组合质量不达标，开始自动微调...');
            for (let retry = 0; retry < 3; retry++) {
              const adjusted = CombinationValidator.suggestAdjustment(finalFront, finalBack, validationResult, analyzer);
              finalFront = adjusted.front;
              finalBack = adjusted.back;
              validationResult = CombinationValidator.validate(finalFront, finalBack.length >= 2 ? finalBack : [], analyzer);
              if (validationResult.passed) {
                console.log('✅ 自动微调成功！组合质量评分:', validationResult.score, '分');
                break;
              }
              console.log(`  微调第${retry + 1}轮，评分: ${validationResult.score}分，继续微调...`);
            }
            if (!validationResult.passed) {
              console.log('⚠️ 3轮微调后仍未达标，保持当前最佳结果');
            }
          }
        } catch (e) {
          console.warn('⚠️ 组合质量验证失败:', e);
        }
      }
      // 用微调后的结果更新胆码和拖码
      // 微调可能替换了某个胆码，需重新确认哪些号码是胆码
      if (finalFront.length === 5 && frontForValidation.length === 5) {
        // 微调后的5个号码中，与原胆码交集的保留为胆码，其余为拖码
        // 如果原胆码被微调替换了，新号码自动成为拖码（胆码由原推荐确定）
        const originalDanSet = new Set(frontForValidation.slice(0, recommendedDan.length));
        recommendedDan = finalFront.filter(n => originalDanSet.has(n)).sort((a, b) => a - b);
        // 如果微调替换导致胆码不足，从微调结果中补充遗漏最接近的号码
        if (recommendedDan.length < frontForValidation.slice(0, recommendedDan.length).length) {
          const needed = frontForValidation.slice(0, recommendedDan.length).length - recommendedDan.length;
          const extras = finalFront.filter(n => !recommendedDan.includes(n)).slice(0, needed);
          recommendedDan.push(...extras);
          recommendedDan.sort((a, b) => a - b);
        }
        const tuoFromValidation = finalFront.filter(n => !recommendedDan.includes(n));
        // 原拖码中：不在微调后5号码中的保留（它们仍是拖码候选）
        // 注意：不能用 `!recommendedDan.includes(n) === false` 这是运算符优先级Bug
        // 正确逻辑：保留原拖码中不在finalFront(微调后5号码)里的号码
        const remainingTuo = recommendedTuo.filter(n => !finalFront.includes(n));
        recommendedTuo = [...tuoFromValidation, ...remainingTuo].sort((a, b) => a - b);
        setDanNumbers(recommendedDan);
        setTuoNumbers(recommendedTuo);
      }
            
      // 计算推荐置信度
      let confidenceResult = null;
      try {
        confidenceResult = ConfidenceCalculator.calculate(analyzer, validationResult, recommendedDan);
        console.log('📊 推荐置信度:', confidenceResult.confidence, '分（', confidenceResult.level, '）');
      } catch (e) {
        console.warn('⚠️ 置信度计算失败:', e);
      }

            setDantuoRecommendation({
        dan: recommendedDan,
        tuo: recommendedTuo,
        backDan: backDanNumbers,
        backTuo: backTuoNumbers,
        backRecommendationInfo: backRecommendationInfo, // 后区推荐信息（始终显示）
        frontDanProbInfo: frontDanProbInfo, // 前区胆码概率排名信息
        frontZoneInfo: frontZoneInfo, // 前区区间频率排名信息
        validationResult: validationResult, // 组合质量后验验证结果
        confidenceResult: confidenceResult, // 推荐置信度
        strategy: strategyName,
        description: description
      });

      // 调用3个辅助模型生成推荐
      try {
        const danCountForModel = recommendedDan.length;
        const modelRecs = analyzer.generateModelRecommendations(danCountForModel, tuoCount, strategy);
        setModelRecommendations(modelRecs);
        console.log('✅ 辅助模型推荐完成:', modelRecs);
      } catch (e) {
        console.warn('⚠️ 辅助模型推荐失败:', e);
      }
    } catch (error) {
      console.error('推荐失败:', error);
    }
  };

  // 胆拖玩法 - 一键复制
  // 胆拖回测验证
  const handleDanTuoBacktest = () => {
    try {
      const result = analyzer.backtestDanTuo({
        strategy: recommendStrategy,
        danCount: danNumbers.length || 4,
        tuoCount,
        backDanEnabled,
        backTuoCount,
        backFullDrag: useBackFullDrag,
        backtestPeriods: 20
      });
      setDanTuoBacktestResult(result);
      if (result.success) {
        console.log('✅ 胆拖回测完成:', result.summary);
      } else {
        console.warn('⚠️ 胆拖回测失败:', result.summary);
      }
    } catch (error) {
      console.error('胆拖回测验证失败:', error);
      alert('胆拖回测验证失败: ' + error.message);
    }
  };
  const handleCopyDanTuo = () => {
    if (!dantuoResult || dantuoResult.combinations.length === 0) {
      alert('请先生成胆拖组合！');
      return;
    }

    let text = `🎯 胆拖玩法 - 投注组合\n`;
    text += `生成时间: ${dantuoResult.generatedAt}\n`;
    text += `========================================\n\n`;
    
    // 胆拖信息
    text += `【胆拖配置】\n`;
    text += `胆码: [${dantuoResult.danNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n`;
    text += `拖码: [${dantuoResult.tuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n`;
    
    if (backTuoNumbers.length > 0) {
      if (backDanEnabled && backDanNumbers.length > 0) {
        text += `后区胆码: [${backDanNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n`;
      }
      text += `后区拖码: [${backTuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n`;
      if (!backDanEnabled) {
        text += `后区模式: 纯拖（无胆码）\n`;
      }
    }
    
    text += `\n【统计信息】\n`;
    text += `总注数: ${dantuoResult.totalBets} 注\n`;
    text += `总费用: ${dantuoResult.cost} 元\n`;
    
    // 质量分析
    if (dantuoResult.danQuality) {
      text += `\n【胆码质量】\n`;
      text += `质量评分: ${dantuoResult.danQuality.qualityScore}/100\n`;
      text += `热号数量: ${dantuoResult.danQuality.hotDanCount}\n`;
      text += `冷号数量: ${dantuoResult.danQuality.coldDanCount}\n`;
      text += `AC值: ${dantuoResult.danQuality.acValue}\n`;
      text += `奇偶比: ${dantuoResult.danQuality.oddEvenRatio}\n`;
      text += `大小比: ${dantuoResult.danQuality.bigSmallRatio}\n`;
    }
    
    text += `\n【投注组合】\n`;
    dantuoResult.combinations.forEach((comb, idx) => {
      const frontStr = comb.front.map(n => n.toString().padStart(2, '0')).join(' ');
      const backStr = comb.back ? comb.back.map(n => n.toString().padStart(2, '0')).join(' ') : '';
      text += `${idx + 1}. ${frontStr}${backStr ? ' | ' + backStr : ''}\n`;
    });
    
    text += `\n========================================\n`;
    text += `总计: ${dantuoResult.totalBets} 注 | ${dantuoResult.cost} 元\n`;

    // 复制到剪贴板
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      
      // 追踪复制行为
      trackCopy('dantuo', dantuoResult.totalBets);
    }).catch(err => {
      console.error('复制失败:', err);
      alert('复制失败，请手动复制');
    });
  };

  // 复式玩法 - 执行杀号分析
  const handleEliminateNumbers = () => {
    try {
      // 传递后区专属参数
      const options = {
        ...eliminationOptions,
        backOverheatCount: eliminationOptions.backOverheatCount || 6,
        backConsecutiveThreshold: eliminationOptions.backConsecutiveThreshold || 2
      };
      const result = analyzer.eliminateNumbers(options);
      setEliminationResult(result);
      setFushiResult(null);
      setSelectedPlan(null);
      setFushiFrontSelected([]);
      setFushiBackSelected([]);
      console.log('✅ 杀号分析完成:', result.summary);
    } catch (error) {
      console.error('杀号分析失败:', error);
      alert('杀号分析失败: ' + error.message);
    }
  };

  // 结构杀号分析（增强版）
  const handleStructuralEliminate = () => {
    try {
      const result = analyzer.structuralEliminate(structuralOptions);
      setEliminationResult(result);
      setFushiResult(null);
      setSelectedPlan(null);
      setFushiFrontSelected([]);
      setFushiBackSelected([]);
      console.log('✅ 结构杀号分析完成:', result.summary);
    } catch (error) {
      console.error('结构杀号分析失败:', error);
      alert('结构杀号分析失败: ' + error.message);
    }
  }; 

  // 混合杀号分析
  const handleMixedEliminate = (mergeMode) => {
    try {
      const result = analyzer.mixedEliminateNumbers({
        mergeMode,
        basicOptions: {
          ...eliminationOptions,
          backOverheatCount: eliminationOptions.backOverheatCount || 6,
          backConsecutiveThreshold: eliminationOptions.backConsecutiveThreshold || 2
        },
        structuralOptions
      });
      setEliminationResult(result);
      setFushiResult(null);
      setSelectedPlan(null);
      setFushiFrontSelected([]);
      setFushiBackSelected([]);
      console.log('✅ 混合杀号分析完成:', result.summary);
    } catch (error) {
      console.error('混合杀号分析失败:', error);
      alert('混合杀号分析失败: ' + error.message);
    }
  };

  // 回测验证
  const handleBacktest = (mode) => {
    try {
      const result = analyzer.backtestEliminate({
        mode,
        basicOptions: {
          ...eliminationOptions,
          backOverheatCount: eliminationOptions.backOverheatCount || 6,
          backConsecutiveThreshold: eliminationOptions.backConsecutiveThreshold || 2
        },
        structuralOptions,
        backtestPeriods: 20
      });
      setBacktestResult(result);
      console.log('✅ 回测验证完成:', result.summary);
    } catch (error) {
      console.error('回测验证失败:', error);
      alert('回测验证失败: ' + error.message);
    }
  };

  // 智能推荐杀号模式
  const handleRecommendMode = () => {
    try {
      const result = analyzer.recommendEliminationMode();
      setRecommendResult(result);
      setEliminationOptions({...eliminationOptions, mode: result.recommendedMode});
      // 智能推荐改变模式时也要重置套餐和选号
      if (selectedPlan) {
        setSelectedPlan(null);
        setFushiFrontSelected([]);
        setFushiBackSelected([]);
        setFushiResult(null);
      }
      console.log('✅ 智能推荐完成:', result.reason);
    } catch (error) {
      console.error('智能推荐失败:', error);
      alert('智能推荐失败: ' + error.message);
    }
  };

  // 统一执行杀号按钮逻辑
  const handleExecuteEliminate = () => {
    const mode = eliminationOptions.mode || 'basic';
    switch (mode) {
      case 'basic': handleEliminateNumbers(); break;
      case 'structural': handleStructuralEliminate(); break;
      case 'mixed_union': handleMixedEliminate('union'); break;
      case 'mixed_intersect': handleMixedEliminate('intersect'); break;
      default: handleEliminateNumbers(); break;
    }
  };
  
  // 复式玩法 - 选择套餐
  const handleSelectPlan = (plan) => {
    if (!eliminationResult) {
      alert('请先执行杀号分析！');
      return;
    }
    // 检查剩余号码是否足够
    if (eliminationResult.frontRemaining.length < plan.frontPool) {
      alert(`前区剩余号码不足：套餐需要${plan.frontPool}个，仅有${eliminationResult.frontRemaining.length}个。请减少杀号力度或选更小的套餐。`);
      return;
    }
    if (eliminationResult.backRemaining.length < plan.backPool) {
      alert(`后区剩余号码不足：套餐需要${plan.backPool}个，仅有${eliminationResult.backRemaining.length}个。请减少杀号力度或选更小的套餐。`);
      return;
    }
    setSelectedPlan(plan);
    setFushiResult(null);
    // 自动从剩余号码池中选取最优号码
    const autoResult = NumberEliminator.autoSelect(analyzer, eliminationResult.frontRemaining, eliminationResult.backRemaining, plan);
    setFushiFrontSelected(autoResult.frontSelected);
    setFushiBackSelected(autoResult.backSelected);
  };
  
  // 复式玩法 - 生成组合
  const handleGenerateFushi = () => {
    try {
      const result = analyzer.generateFushiCombinations(fushiFrontSelected, fushiBackSelected);
      setFushiResult(result);
      console.log('✅ 复式组合生成完成:', result.totalBets, '注');
    } catch (error) {
      alert('复式组合生成失败: ' + error.message);
    }
  };

  // 复制复式玩法结果 - 仅保留前区+后区
  const handleCopyFushi = () => {
    if (!fushiResult) {
      alert('请先生成复式组合！');
      return;
    }
    const frontStr = fushiResult.frontPool.map(n => n.toString().padStart(2, '0')).join(' ');
    const backStr = fushiResult.backPool.map(n => n.toString().padStart(2, '0')).join(' ');
    const text = `${frontStr} | ${backStr}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(err => {
      console.error('复制失败:', err);
      alert('复制失败，请手动复制');
    });
  }; 

  const formatPredictions = () => {
    if (predictions.length === 0) return '';
    
    let text = `🧧 发财大计 - 号码预测\n`;
    text += `生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
    text += `========================================\n\n`;
    
    // 按模型分组
    const grouped = predictions.reduce((acc, p) => {
      if (!acc[p.model]) acc[p.model] = [];
      acc[p.model].push(p);
      return acc;
    }, {});
    
    Object.entries(grouped).forEach(([model, groups]) => {
      text += `【${modelNames[model]}】\n`;
      groups.forEach((p, idx) => {
        const frontStr = p.front.map(n => n.toString().padStart(2, '0')).join(' ');
        const backStr = p.back.map(n => n.toString().padStart(2, '0')).join(' ');
        const frontSum = p.front.reduce((a, b) => a + b, 0);
        const backSum = p.back.reduce((a, b) => a + b, 0);
        const oddCount = p.front.filter(n => n % 2 !== 0).length;
        const evenCount = p.front.length - oddCount;
        // 三级标记：2:3/3:2✓ / 1:4/4:1无标记 / 0:5/5:0⚠
        const oddEvenMark = (oddCount >= 2 && oddCount <= 3) ? '✓' : (oddCount === 0 || oddCount === p.front.length) ? '⚠' : '';
        text += `第${idx + 1}组: ${frontStr} | ${backStr} (和值:${frontSum}/${backSum}, 奇偶:${oddCount}:${evenCount}${oddEvenMark})\n`;
      });
      text += '\n';
    });
    
    text += `========================================\n`;
    text += `总计: ${predictions.length} 组号码\n`;
    
    return text;
  };

  const handleCopy = async () => {
    if (predictions.length === 0) {
      alert('请先生成号码！');
      return;
    }
    
    const text = formatPredictions();
    
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      
      // 追踪复制操作
      trackCopy();
    } catch (err) {
      // 降级方案：使用传统方法
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
        trackCopy();
      } catch (err) {
        alert('复制失败，请手动复制');
      }
      document.body.removeChild(textarea);
    }
  };

  const handleSave = () => {
    if (predictions.length === 0) {
      alert('请先生成号码！');
      return;
    }
    
    const text = formatPredictions();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `发财大计_号码预测_${new Date().getTime()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // 追踪保存操作
    trackSave();
  };

  // 如果显示号码分布黑板，则直接渲染该页面
  if (showBlackboard) {
    return (
      <AuthGuard>
        <LotteryBlackboard 
          historyData={analyzer.historyData} 
          onBack={() => setShowBlackboard(false)} 
        />
      </AuthGuard>
    );
  }
  
  // 如果显示福彩双色球玩法页面，则直接渲染该页面
  if (showSSQPage) {
    return (
      <AuthGuard>
        <ShuangSeQiuPage onBack={() => {
          setShowSSQPage(false);
          window.location.hash = '';
        }} />
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="app">
        {/* 烟花背景层 */}
        <div className="fireworks-layer"></div>
        
        <header>
          <div className="header-watermark wm-1">王正伟</div>
          <div className="header-watermark wm-2">发财大计</div>
          <div className="header-watermark wm-3">王正伟</div>
          <div className="header-watermark wm-4">发财大计</div>
          <div className="header-watermark wm-5">王正伟</div>
          <div className="header-watermark wm-6">发财大计</div>
          <h1 onClick={handleTitleClick} style={{ cursor: 'default' }}>🧧 发财大计</h1>
          <p>苟富贵，勿相忘！</p>
        </header>

      <main>
        <section className="card">
          <h2>📊 统计概览</h2>
          {stats && (
            <div className="stats-container">
              <div className="stats-section">
                <h3>基础统计</h3>
                <div className="stats-grid">
                  <div><span className="label">前区期望:</span> {stats.expFront.toFixed(2)} <span className="stat-hint">(平均出现位置)</span></div>
                  <div><span className="label">后区期望:</span> {stats.expBack.toFixed(2)} <span className="stat-hint">(平均出现位置)</span></div>
                  <div><span className="label">前区标准差:</span> {stats.variance.frontStd.toFixed(2)} <span className="stat-hint">(号码离散程度)</span></div>
                  <div><span className="label">后区标准差:</span> {stats.variance.backStd.toFixed(2)} <span className="stat-hint">(号码离散程度)</span></div>
                </div>
              </div>
              
              <div className="stats-section">
                <h3>冷热号码</h3>
                <div className="stats-grid">
                  <div><span className="label">最热前区:</span> {stats.hotCold.frontHot.slice(0, 3).map(x => x[0]).join(', ')}</div>
                  <div><span className="label">最冷前区:</span> {stats.hotCold.frontCold.slice(0, 3).map(x => x[0]).join(', ')}</div>
                  <div><span className="label">最热后区:</span> {stats.hotCold.backHot.slice(0, 2).map(x => x[0]).join(', ')}</div>
                  <div><span className="label">最冷后区:</span> {stats.hotCold.backCold.slice(0, 2).map(x => x[0]).join(', ')}</div>
                </div>
              </div>
              
              <div className="stats-section">
                <h3>和值概率 TOP10</h3>
                <div className="sum-prob-grid">
                  <div>
                    <div className="prob-title">前区和值</div>
                    <div className="prob-items">
                      {Object.entries(stats.sumProb.front)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                        .map(([sum, prob]) => (
                          <span key={sum} className="prob-item">{sum} ({prob}%)</span>
                        ))}
                    </div>
                  </div>
                  <div>
                    <div className="prob-title">后区和值</div>
                    <div className="prob-items">
                      {Object.entries(stats.sumProb.back)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                        .map(([sum, prob]) => (
                          <span key={sum} className="prob-item">{sum} ({prob}%)</span>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 数据可视化 */}
        <section className="card">
          <div className="visualization-header">
            <h2>📈 数据可视化分析</h2>
            <button 
              onClick={() => setShowVisualization(!showVisualization)}
              className="toggle-visualization-btn"
            >
              {showVisualization ? '🔼 收起' : '🔽 展开'}
            </button>
          </div>
          {showVisualization && (
            <DataVisualization historyData={analyzer.historyData} />
          )}
        </section>

        {/* 最新一期开奖号码 */}
        {(() => {
          const latestDraw = getLatestDrawFromData();
          return latestDraw && (
            <section className="card latest-draw-card">
              <h2>🎯 最新一期开奖
                <button 
                  onClick={() => setShowBlackboard(true)}
                  style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    fontSize: '0.75em',
                    background: 'linear-gradient(135deg, #1a3a2a, #2d5a3d)',
                    color: '#f0e68c',
                    border: '1px solid #f0e68c',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    letterSpacing: '1px'
                  }}
                >
                  📋 小黑板
                </button>
              </h2>
              <div className="latest-draw-content">
                <div className="draw-info">
                  <span className="draw-period">最新一期</span>
                </div>
                <div className="draw-numbers">
                  <div className="front-zone">
                    <span className="zone-label">前区</span>
                    <div className="numbers">
                      {latestDraw.front.map((num, idx) => (
                        <span key={idx} className="ball front-ball">
                          {num.toString().padStart(2, '0')}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="back-zone">
                    <span className="zone-label">后区</span>
                    <div className="numbers">
                      {latestDraw.back.map((num, idx) => (
                        <span key={idx} className="ball back-ball">
                          {num.toString().padStart(2, '0')}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                {/* 中奖规则速查表 */}
                <div className="prize-quick-ref">
                  <div className="prize-quick-ref-grid">
                    <span className="prize-ref-item prize-1"><span className="prize-badge">1</span> 5+2 <small>一等奖</small></span>
                    <span className="prize-ref-item prize-2"><span className="prize-badge">2</span> 5+1 <small>二等奖</small></span>
                    <span className="prize-ref-item prize-3"><span className="prize-badge">3</span> 5+0 / 4+2 <small>三等奖</small></span>
                    <span className="prize-ref-item prize-4"><span className="prize-badge">4</span> 4+1 <small>四等奖</small></span>
                    <span className="prize-ref-item prize-5"><span className="prize-badge">5</span> 4+0 / 3+2 <small>五等奖</small></span>
                    <span className="prize-ref-item prize-6"><span className="prize-badge">6</span> 3+1 / 2+2 <small>六等奖</small></span>
                    <span className="prize-ref-item prize-7"><span className="prize-badge">7</span> 3+0 / 2+1 / 1+2 / 0+2 <small>七等奖</small></span>
                  </div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* 近60期区间分布分析 */}
        {analyzer.historyData && analyzer.historyData.length > 0 && (
          <ZoneAnalysisPanel historyData={analyzer.historyData} />
        )}

        {/* 胆拖玩法 */}
        <section className="card dantuo-section">
          <h2>🎯 胆拖玩法</h2>
          
          {/* 拖码个数选择器 */}
          <div className="tuo-count-selector" style={{
            marginBottom: '15px',
            padding: '12px',
            background: '#f0f4ff',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <label style={{ fontWeight: 'bold', color: '#333' }}>📊 前区拖码个数：</label>
            <select 
              value={tuoCount}
              onChange={(e) => setTuoCount(parseInt(e.target.value))}
              style={{
                padding: '6px 12px',
                border: '2px solid #667eea',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#667eea',
                cursor: 'pointer'
              }}
            >
              <option value={6}>6个</option>
              <option value={7}>7个</option>
              <option value={8}>8个</option>
              <option value={9}>9个</option>
              <option value={10}>10个（推荐）</option>
              <option value={11}>11个</option>
              <option value={12}>12个</option>
              <option value={13}>13个</option>
              <option value={14}>14个</option>
              <option value={15}>15个</option>
              <option value={16}>16个</option>
              <option value={17}>17个</option>
              <option value={18}>18个</option>
              <option value={19}>19个</option>
              <option value={20}>20个</option>
              <option value={22}>22个</option>
              <option value={24}>24个</option>
              <option value={25}>25个</option>
              <option value={28}>28个</option>
              <option value={30}>30个</option>
              <option value={31}>31个（全覆盖，推荐）</option>
            </select>
            <span style={{ fontSize: '12px', color: '#444' }}>
              注数：{tuoCount > 2 ? `C(${tuoCount},2) = ${tuoCount * (tuoCount - 1) / 2}注` : '请选择至少3个'}
            </span>
          </div>
          
          {/* 后区设置栏：胆码开关 + 拖码个数 + 一胆全拖 */}
          <div className="dantuo-option-bar" style={{
            marginBottom: '15px',
            padding: '12px 15px',
            background: '#f8f0ff',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '15px',
            flexWrap: 'wrap'
          }}>
            <label className="option-switch" style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
              <input 
                type="checkbox" 
                checked={backDanEnabled}
                onChange={(e) => {
                  setBackDanEnabled(e.target.checked);
                  if (!e.target.checked) {
                    // 关闭胆码时清空已选胆码
                    setBackDanNumbers([]);
                    setBackSelectionMode('tuo');
                  }
                }}
              />
              <span className="switch-slider"></span>
              <span className="option-label">🎯 后区胆码</span>
            </label>
            <label style={{ fontWeight: 'bold', color: '#333', display: 'flex', alignItems: 'center', gap: '6px' }}>
              📊 后区拖码个数：
              <select 
                value={backTuoCount}
                onChange={(e) => setBackTuoCount(parseInt(e.target.value))}
                disabled={useBackFullDrag}
                style={{
                  padding: '4px 8px',
                  border: `2px solid ${useBackFullDrag ? '#ccc' : '#66bb6a'}`,
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  color: useBackFullDrag ? '#999' : '#66bb6a',
                  cursor: useBackFullDrag ? 'not-allowed' : 'pointer'
                }}
              >
                <option value={2}>2个</option>
                <option value={3}>3个</option>
                <option value={4}>4个（推荐）</option>
                <option value={5}>5个</option>
                <option value={6}>6个</option>
                <option value={7}>7个</option>
                <option value={8}>8个</option>
                <option value={9}>9个</option>
                <option value={10}>10个</option>
                <option value={11}>11个（一胆全拖）</option>
              </select>
            </label>
            {backDanEnabled && (
              <label className="option-switch" style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                <input 
                  type="checkbox" 
                  checked={useBackFullDrag}
                  onChange={(e) => {
                    setUseBackFullDrag(e.target.checked);
                    if (e.target.checked) {
                      setBackTuoCount(11);
                    }
                  }}
                />
                <span className="switch-slider"></span>
                <span className="option-label">⚡ 一胆全拖</span>
              </label>
            )}
          </div>

          {/* 智能推荐策略选择 */}
          <div className="strategy-selector">
            <span className="strategy-label">推荐策略:</span>
            <span className="data-window-hint" style={{fontSize: '0.85em', color: '#667eea', marginLeft: '10px'}}>
              📊 统计分析窗口: {dataWindow > 0 ? `${dataWindow}期` : '全部'} | 智能推荐: 近30期
            </span>
            <div className="strategy-desc" style={{fontSize: '0.82em', color: '#555', margin: '6px 0 2px 0', lineHeight: '1.6'}}>
              🔥 热号策略：追热号趋势 | ⚖️ 均衡策略：追均值回归 | 🛡️ 保守策略：追冷号回归（多维确认）
            </div>
            <button 
              className={`strategy-btn ${recommendStrategy === 'hot' ? 'active' : ''}`}
              onClick={() => handleRecommendDanTuo('hot')}
            >
              🔥 热号策略
            </button>
            <button 
              className={`strategy-btn ${recommendStrategy === 'balanced' ? 'active' : ''}`}
              onClick={() => handleRecommendDanTuo('balanced')}
            >
              ⚖️ 均衡策略
            </button>
            <button 
              className={`strategy-btn ${recommendStrategy === 'conservative' ? 'active' : ''}`}
              onClick={() => handleRecommendDanTuo('conservative')}
            >
              🛡️ 保守策略
            </button>
          </div>

          {/* 前区选择 */}
          <div className="dantuo-zone">
            <h3>前区号码 (1-35)</h3>
            
            {/* 胆码选择 */}
            <div className="number-selection">
              <div className="selection-label">
                <span className="label-text">胆码 (必选)</span>
                <span className="label-count">{danNumbers.length}/4</span>
              </div>
              <div className="selected-numbers dan-numbers">
                {danNumbers.map(num => (
                  <span key={num} className="selected-number dan" onClick={() => toggleDanNumber(num)}>
                    {num.toString().padStart(2, '0')}
                  </span>
                ))}
                {danNumbers.length === 0 && <span className="placeholder">请选择1-4个胆码</span>}
              </div>
            </div>

            {/* 拖码选择 */}
            <div className="number-selection">
              <div className="selection-label">
                <span className="label-text">拖码 (可选)</span>
                <span className="label-count">{(tuoNumbers || []).length}/{35 - (danNumbers || []).length}</span>
              </div>
              <div className="selected-numbers tuo-numbers">
                {(tuoNumbers || []).map(num => (
                  <span key={num} className="selected-number tuo" onClick={() => toggleTuoNumber(num)}>
                    {num.toString().padStart(2, '0')}
                  </span>
                ))}
                {(tuoNumbers || []).length === 0 && <span className="placeholder">请选择至少1个拖码</span>}
              </div>
            </div>

            {/* 选择模式切换 */}
            <div className="selection-mode-toggle">
              <button
                className={`mode-btn ${selectionMode === 'dan' ? 'active dan-mode' : ''}`}
                onClick={() => setSelectionMode('dan')}
              >
                 选胆码
              </button>
              <button
                className={`mode-btn ${selectionMode === 'tuo' ? 'active tuo-mode' : ''}`}
                onClick={() => setSelectionMode('tuo')}
              >
                🔄 选拖码
              </button>
            </div>

            {/* 号码选择器 */}
            <div className="number-picker">
              {Array.from({ length: 35 }, (_, i) => i + 1).map(num => {
                const isDan = (danNumbers || []).includes(num);
                const isTuo = (tuoNumbers || []).includes(num);
                return (
                  <button
                    key={num}
                    className={`number-btn ${isDan ? 'dan-selected' : ''} ${isTuo ? 'tuo-selected' : ''}`}
                    onClick={() => {
                      if (isDan) toggleDanNumber(num);
                      else if (isTuo) toggleTuoNumber(num);
                      else if (selectionMode === 'dan') toggleDanNumber(num);
                      else toggleTuoNumber(num);
                    }}
                  >
                    {num.toString().padStart(2, '0')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 后区选择（始终显示） */}

            <div className="dantuo-zone back-zone back-zone-compact">
              <h3>后区号码 (1-12)</h3>
              
              <div className="back-zone-content">
                {/* 左侧：已选号码 */}
                <div className="back-selected">
                  {/* 后区胆码（仅当开启时显示） */}
                  {backDanEnabled && (
                  <div className="number-selection compact">
                    <div className="selection-label">
                      <span className="label-text">胆码</span>
                      <span className="label-count">{backDanNumbers.length}/1</span>
                    </div>
                    <div className="selected-numbers dan-numbers compact">
                      {backDanNumbers.map(num => (
                        <span key={num} className="selected-number dan small" onClick={() => toggleBackDanNumber(num)}>
                          {num.toString().padStart(2, '0')}
                        </span>
                      ))}
                      {backDanNumbers.length === 0 && <span className="placeholder small">未选</span>}
                    </div>
                  </div>
                  )}

                  {/* 后区拖码 */}
                  <div className="number-selection compact">
                    <div className="selection-label">
                      <span className="label-text">拖码 {!backDanEnabled && <span style={{fontSize: '0.75em', color: '#e67e22', fontWeight: 'normal'}}>(纯拖模式)</span>}</span>
                      <span className="label-count">{backTuoNumbers.length}/{backDanEnabled ? (12 - backDanNumbers.length) : 12}</span>
                    </div>
                    <div className="selected-numbers tuo-numbers compact">
                      {backTuoNumbers.map(num => (
                        <span key={num} className="selected-number tuo small" onClick={() => toggleBackTuoNumber(num)}>
                          {num.toString().padStart(2, '0')}
                        </span>
                      ))}
                      {backTuoNumbers.length === 0 && <span className="placeholder small">未选</span>}
                    </div>
                  </div>

                  {/* 后区选择模式切换 */}
                  <div className="selection-mode-toggle compact">
                    {backDanEnabled && (
                    <button
                      className={`mode-btn ${backSelectionMode === 'dan' ? 'active dan-mode' : ''}`}
                      onClick={() => setBackSelectionMode('dan')}
                    >
                      🎯 胆
                    </button>
                    )}
                    <button
                      className={`mode-btn ${backSelectionMode === 'tuo' ? 'active tuo-mode' : ''}`}
                      onClick={() => setBackSelectionMode('tuo')}
                    >
                      🔄 拖
                    </button>
                  </div>
                </div>

                {/* 右侧：号码选择器 */}
                <div className="back-picker">
                  <div className="number-picker compact">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(num => {
                      const isDan = backDanEnabled && backDanNumbers.includes(num);
                      const isTuo = backTuoNumbers.includes(num);
                      return (
                        <button
                          key={num}
                          className={`number-btn ${isDan ? 'dan-selected' : ''} ${isTuo ? 'tuo-selected' : ''} compact`}
                          onClick={() => {
                            if (isDan) toggleBackDanNumber(num);
                            else if (isTuo) toggleBackTuoNumber(num);
                            else if (backDanEnabled && backSelectionMode === 'dan') toggleBackDanNumber(num);
                            else toggleBackTuoNumber(num);
                          }}
                        >
                          {num.toString().padStart(2, '0')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

          {/* 预览和生成按钮 */}
          <div className="dantuo-preview">
            <div className="preview-info">
              <div className="info-item">
                <span className="info-label">预计注数:</span>
                <span className="info-value">{calculateDanTuoBets()} 注</span>
              </div>
              <div className="info-item">
                <span className="info-label">预计费用:</span>
                <span className="info-value cost">{calculateDanTuoBets() * 2} 元</span>
              </div>
              {dantuoResult && dantuoResult.danQuality && (
                <div className="info-item">
                  <span className="info-label">胆码质量:</span>
                  <span className={`info-value quality quality-${
                    dantuoResult.danQuality.qualityScore >= 80 ? 'high' :
                    dantuoResult.danQuality.qualityScore >= 60 ? 'medium' : 'low'
                  }`}>
                    {dantuoResult.danQuality.qualityScore}/100
                  </span>
                </div>
              )}
            </div>
            <div className="action-buttons">
              <button 
                className="copy-selection-btn"
                onClick={handleCopyDanTuoSelection}
                style={{
                  background: copyDanTuoSuccess ? '#67c23a' : '#409eff',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  transition: 'all 0.3s',
                  marginRight: '10px'
                }}
              >
                {copyDanTuoSuccess ? '✅ 已复制' : '📋 复制选号'}
              </button>
              <button 
                className="generate-btn"
                onClick={handleGenerateDanTuo}
                disabled={danNumbers.length === 0 || tuoNumbers.length === 0}
              >
                生成组合
              </button>
              <button
                onClick={handleDanTuoBacktest}
                style={{
                  background: 'linear-gradient(135deg, #17a2b8, #138496)',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '13px',
                  transition: 'all 0.3s',
                  marginLeft: '10px'
                }}
              >
                📊 回测验证
              </button>
            </div>
          </div>

          {/* 胆拖回测结果展示 */}
          {danTuoBacktestResult && danTuoBacktestResult.success && (
            <div style={{
              marginTop: '15px',
              padding: '15px',
              background: 'linear-gradient(135deg, #e8f4f8, #d6eaf8)',
              borderRadius: '8px',
              border: '1px solid #5dade2'
            }}>
              <div style={{fontWeight: 'bold', color: '#17a2b8', marginBottom: '10px', fontSize: '1.0em'}}>
                胆拖回测结果（{danTuoBacktestResult.strategy} · {danTuoBacktestResult.backMode} · {danTuoBacktestResult.danCount}胆+{danTuoBacktestResult.tuoCount}拖）
              </div>
              <div style={{fontSize: '0.85em', color: '#333', marginBottom: '8px'}}>
                {danTuoBacktestResult.summary}
              </div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px', marginBottom: '10px'}}>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd'}}>
                  <div style={{fontSize: '0.75em', color: '#444'}}>前区胆码命中</div>
                  <div style={{fontWeight: 'bold', color: '#27ae60', fontSize: '1.2em'}}>{danTuoBacktestResult.avgDanHits.toFixed(2)}个/期</div>
                  <div style={{fontSize: '0.7em', color: '#555'}}>期望{danTuoBacktestResult.randomDanExpect.toFixed(2)}</div>
                </div>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd'}}>
                  <div style={{fontSize: '0.75em', color: '#444'}}>胆码命中≥1概率</div>
                  <div style={{fontWeight: 'bold', color: '#e67e22', fontSize: '1.2em'}}>{(danTuoBacktestResult.danAtLeast1Rate * 100).toFixed(1)}%</div>
                </div>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd'}}>
                  <div style={{fontSize: '0.75em', color: '#444'}}>号码池命中</div>
                  <div style={{fontWeight: 'bold', color: '#2980b9', fontSize: '1.2em'}}>{danTuoBacktestResult.avgFrontPoolHits.toFixed(2)}个/期</div>
                </div>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd'}}>
                  <div style={{fontSize: '0.75em', color: '#444'}}>后区命中</div>
                  <div style={{fontWeight: 'bold', color: '#27ae60', fontSize: '1.2em'}}>{danTuoBacktestResult.avgBackHits.toFixed(2)}个/期</div>
                  <div style={{fontSize: '0.7em', color: '#555'}}>期望{danTuoBacktestResult.randomBackExpect.toFixed(2)}</div>
                </div>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd'}}>
                  <div style={{fontSize: '0.75em', color: '#444'}}>回测期数</div>
                  <div style={{fontWeight: 'bold', color: '#17a2b8', fontSize: '1.2em'}}>{danTuoBacktestResult.totalPeriods}期</div>
                </div>
              </div>
              {/* 最近5期回测明细 */}
              <div style={{fontSize: '0.8em', color: '#444', marginBottom: '4px'}}>最近5期回测明细:</div>
              {danTuoBacktestResult.details.slice(-5).reverse().map((detail, idx) => (
                <div key={idx} style={{padding: '6px 8px', borderBottom: '1px solid #ddd', fontSize: '0.75em', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap'}}>
                  <div>第{detail.periodIndex}期: 开奖 [{detail.actualDraw.front.join(' ')} + {detail.actualDraw.back.join(' ')}]</div>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <span style={{color: detail.frontDanHits > 0 ? '#27ae60' : '#999'}}>
                      胆码命中{detail.frontDanHits}/{danTuoBacktestResult.danCount}
                    </span>
                    <span style={{color: detail.frontAllHits > 2 ? '#27ae60' : '#e67e22'}}>
                      号码池命中{detail.frontAllHits}/{danTuoBacktestResult.danCount + danTuoBacktestResult.tuoCount}
                    </span>
                    <span style={{color: detail.backAllHits > 0 ? '#27ae60' : '#999'}}>
                      后区命中{detail.backAllHits}/2
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {dantuoRecommendation && (
            <div className="recommendation-tip">
              <div className="tip-header">
                <span className="tip-icon">💡</span>
                <span className="tip-title">{dantuoRecommendation.strategy}</span>
              </div>
              <p className="tip-description">{dantuoRecommendation.description}</p>
              <div className="tip-numbers">
                <span>前区胆码: </span>
                <strong>{dantuoRecommendation.dan.map(n => n.toString().padStart(2, '0')).join(', ')}</strong>
              </div>
              {/* 前区胆码概率排名旁白 */}
              {dantuoRecommendation.frontDanProbInfo && dantuoRecommendation.frontDanProbInfo.length > 0 && (
                <div className="back-recommendation">
                  <div className="back-rec-header">
                    <span className="back-rec-icon"></span>
                    <span className="back-rec-title">前区推荐</span>
                  </div>
                  <p className="back-rec-info">
                    推荐前区胆码：{dantuoRecommendation.dan.map(n => n.toString().padStart(2, '0')).join('、')}（多维度智能评分）。前区各号码推荐热度排名：{dantuoRecommendation.frontDanProbInfo.map((p, idx) => `${p.number.toString().padStart(2, '0')}(${idx === 0 ? '最热' : '第' + (idx + 1) + '热'})`).join('、')}。高分号码优先推荐，每次刷新可能略有变化，您也可参考排名自行选择。
                  </p>
                </div>
              )}
              {/* 前区区间频率排名 */}
              {dantuoRecommendation.frontZoneInfo && (
                <div className="back-recommendation">
                  <div className="back-rec-header">
                    <span className="back-rec-icon"></span>
                    <span className="back-rec-title">区间频率</span>
                  </div>
                  <p className="back-rec-info">
                    {dantuoRecommendation.frontZoneInfo}。热区间号码出现概率更高，冷区间号码具有回归潜力，均衡搭配可提高覆盖面。
                  </p>
                </div>
              )}
              {dantuoRecommendation.backDan && dantuoRecommendation.backDan.length > 0 && (
                <div className="tip-numbers">
                  <span>后区胆码: </span>
                  <strong>{dantuoRecommendation.backDan.map(n => n.toString().padStart(2, '0')).join(', ')}</strong>
                </div>
              )}
              {/* 始终显示后区推荐信息 */}
              {dantuoRecommendation.backRecommendationInfo && (
                <div className="back-recommendation">
                  <div className="back-rec-header">
                    <span className="back-rec-icon"></span>
                    <span className="back-rec-title">后区推荐</span>
                  </div>
                  <p className="back-rec-info">{dantuoRecommendation.backRecommendationInfo}</p>
                </div>
              )}
              {/* 组合质量后验验证信息 */}
              {dantuoRecommendation.validationResult && !dantuoRecommendation.validationResult.passed && (
                <div className="back-recommendation">
                  <div className="back-rec-header">
                    <span className="back-rec-icon"></span>
                    <span className="back-rec-title">组合质量</span>
                  </div>
                  <p className="back-rec-info">
                    组合评分：{dantuoRecommendation.validationResult.score}分。{dantuoRecommendation.validationResult.issues.join('；')}。{dantuoRecommendation.validationResult.suggestions.length > 0 ? `建议：${dantuoRecommendation.validationResult.suggestions.join('；')}` : ''}
                  </p>
                </div>
              )}
              {dantuoRecommendation.validationResult && dantuoRecommendation.validationResult.passed && (
                <div className="back-recommendation">
                  <div className="back-rec-header">
                    <span className="back-rec-icon"></span>
                    <span className="back-rec-title">组合质量</span>
                  </div>
                  <p className="back-rec-info">
                    组合评分：{dantuoRecommendation.validationResult.score}分✅ 通过。和值{dantuoRecommendation.validationResult.details.frontSum}，AC值{dantuoRecommendation.validationResult.details.acValue}，奇偶比{dantuoRecommendation.validationResult.details.oddEvenRatio}，区间覆盖{dantuoRecommendation.validationResult.details.zoneCoverage}个。
                  </p>
                </div>
              )}
              {/* 推荐置信度 */}
              {dantuoRecommendation.confidenceResult && (
                <div className="back-recommendation">
                  <div className="back-rec-header">
                    <span className="back-rec-icon"></span>
                    <span className="back-rec-title">推荐置信度</span>
                  </div>
                  <p className="back-rec-info">
                    {ConfidenceCalculator.generateDescription(dantuoRecommendation.confidenceResult)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 辅助模型推荐 */}
          {modelRecommendations && dantuoRecommendation && (
            <div className="model-recommendations-section">
              <div className="tip-header">
                <span className="tip-icon">🧪</span>
                <span className="tip-title">辅助模型推荐（仅供参考）</span>
              </div>
              <p className="tip-description" style={{fontSize: '0.8em', color: '#555', marginBottom: '8px'}}>
                以下3个模型独立于主推荐算法，各模型基于不同理论，推荐结果仅供参考对比。
              </p>
              {['bayesian', 'normal', 'zhouyi'].map(modelKey => {
                const rec = modelRecommendations[modelKey];
                if (!rec || !rec.danSelected || !rec.tuoSelected) return null;
                const info = rec.modelInfo;
                const formatNums = (nums) => (nums || []).filter(n => n != null).map(n => n.toString().padStart(2, '0')).join(' ');
                return (
                  <ModelRecommendationCard key={modelKey} rec={rec} info={info} formatNums={formatNums} />
                );
              })}
            </div>
          )}

          {/* 结果展示 */}
          {dantuoResult && (
            <div className="dantuo-result">
              <div className="result-header">
                <h3>生成结果</h3>
                <span className="result-summary">
                  共 {dantuoResult.totalBets} 注 | 费用 {dantuoResult.cost} 元
                </span>
              </div>
              
              {/* 胆码质量详情 */}
              {dantuoResult.danQuality && (
                <div className="quality-details">
                  <div className="quality-item">
                    <span>热号数量:</span>
                    <span>{dantuoResult.danQuality.hotDanCount}</span>
                  </div>
                  <div className="quality-item">
                    <span>冷号数量:</span>
                    <span>{dantuoResult.danQuality.coldDanCount}</span>
                  </div>
                  <div className="quality-item">
                    <span>AC值:</span>
                    <span>{dantuoResult.danQuality.acValue}</span>
                  </div>
                  <div className="quality-item">
                    <span>奇偶比:</span>
                    <span>{dantuoResult.danQuality.oddEvenRatio}</span>
                  </div>
                  <div className="quality-item">
                    <span>大小比:</span>
                    <span>{dantuoResult.danQuality.bigSmallRatio}</span>
                  </div>
                </div>
              )}

              {/* 组合列表 */}
              <div className="combinations-list">
                {dantuoResult.combinations.slice(0, 20).map((comb, idx) => (
                  <div key={idx} className="combination-item">
                    <span className="combo-index">{idx + 1}.</span>
                    <span className="combo-front">
                      {comb.front.map(n => n.toString().padStart(2, '0')).join(' ')}
                    </span>
                    {comb.back && comb.back.length > 0 && (
                      <span className="combo-back">
                        | {comb.back.map(n => n.toString().padStart(2, '0')).join(' ')}
                      </span>
                    )}
                  </div>
                ))}
                {dantuoResult.totalBets > 20 && (
                  <div className="more-hint">
                    ... 还有 {dantuoResult.totalBets - 20} 注未显示
                  </div>
                )}
              </div>

              {/* 复制按钮 */}
              <div className="copy-section">
                <button 
                  className="copy-btn"
                  onClick={handleCopyDanTuo}
                >
                  {copySuccess ? '✅ 已复制' : '📋 一键复制'}
                </button>
                <p className="copy-hint">复制后可粘贴到微信、QQ等聊天工具</p>
              </div>
            </div>
          )}
        </section>

        {/* 复式玩法 */}
        <section className="card fushi-section">
          <h2>🚫 复式玩法 - 杀号+小型套餐</h2>
          <p style={{fontSize: '0.85em', color: '#333', marginBottom: '10px'}}>
            先杀掉过热号码（近30期出现过多→热度可能下降），再从剩余号码中选一个小型套餐自动填充最优号码，生成所有复式组合。
          </p>

          {/* 杀号模式选择 */}
          <div style={{
            marginBottom: '10px'
          }}>
            {/* 推荐提示 */}
            <div style={{
              padding: '8px 12px',
              background: 'linear-gradient(135deg, #e8f5e9, #c8e6c9)',
              border: '2px solid #4caf50',
              borderRadius: '8px',
              marginBottom: '10px',
              fontSize: '0.85em',
              color: '#2e7d32'
            }}>
              <strong>💡 回测推荐：</strong>混合-交集模式（双重验证）表现最优，前区命中率86%、后区95%，误杀最少
            </div>
            <div style={{display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap'}}>
              {[ 
                {key: 'basic', label: '基础杀号', desc: '6种统计算法', color: '#e74c3c', emoji: ''}, 
                {key: 'structural', label: '结构杀号', desc: '5种规律算法', color: '#2e7d32', emoji: ''}, 
                {key: 'mixed_union', label: '混合-并集', desc: '11种联合(激进)', color: '#8e44ad', emoji: ''}, 
                {key: 'mixed_intersect', label: '混合-交集', desc: '双重验证(保守)', color: '#2980b9', emoji: ''} 
              ].map(m => (
                <button
                  key={m.key}
                  onClick={() => {
                    setEliminationOptions({...eliminationOptions, mode: m.key});
                    // 切换模式时重置套餐和选号，避免逻辑混乱
                    if (selectedPlan) {
                      setSelectedPlan(null);
                      setFushiFrontSelected([]);
                      setFushiBackSelected([]);
                      setFushiResult(null);
                    }
                  }}
                  style={{
                    flex: '1 1 0',
                    minWidth: '120px',
                    padding: '8px 6px',
                    borderRadius: '8px',
                    border: (eliminationOptions.mode || 'basic') === m.key ? `2px solid ${m.color}` : '1px solid #ccc',
                    background: (eliminationOptions.mode || 'basic') === m.key ? `rgba(${m.color === '#e74c3c' ? '231,76,60' : m.color === '#2e7d32' ? '46,125,50' : m.color === '#8e44ad' ? '142,68,173' : '41,128,190'},0.15)` : '#f9f9f9',
                    color: (eliminationOptions.mode || 'basic') === m.key ? m.color : '#333',
                    cursor: 'pointer',
                    fontWeight: (eliminationOptions.mode || 'basic') === m.key ? 'bold' : 'normal',
                    transition: 'all 0.2s',
                    fontSize: '0.85em',
                    textAlign: 'center'
                  }}
                >
                  {m.emoji} {m.label}<br/>
                  <span style={{fontSize: '0.75em', opacity: 0.9, color: '#555'}}>{m.desc}</span>
                </button>
              ))}
            </div>
            {/* 智能推荐按钮 */}
            <button
              onClick={handleRecommendMode}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #f39c12',
                background: 'linear-gradient(135deg, #fff8e1, #fff3cd)',
                color: '#e67e22',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.85em',
                transition: 'all 0.2s'
              }}
            >
              智能推荐模式（根据当前数据特征自动选择最优杀号方式）
            </button>
            {recommendResult && (
              <div style={{marginTop: '8px', padding: '10px', background: '#fff3cd', borderRadius: '6px', border: '1px solid #f39c12', fontSize: '0.85em'}}>
                <div style={{fontWeight: 'bold', color: '#e67e22'}}>推荐结果: {recommendResult.modeNames[recommendResult.recommendedMode]}</div>
                <div style={{color: '#444', marginTop: '4px'}}>{recommendResult.reason}</div>
                <div style={{color: '#555', marginTop: '4px', fontSize: '0.8em'}}>
                  各模式评分: 基础{recommendResult.scores.basic} / 结构{recommendResult.scores.structural} / 并集{recommendResult.scores.mixed_union} / 交集{recommendResult.scores.mixed_intersect}
                </div>
              </div>
            )}
          </div>

          {/* 杀号参数设置 */}
          <div className="elimination-options" style={{
            marginBottom: '15px',
            padding: '12px',
            background: '#fff8f0',
            borderRadius: '8px',
            border: '1px solid #ffecd2',
            color: '#333',
            position: 'relative',
            zIndex: 2
          }}>
            <div style={{fontWeight: 'bold', color: '#e67e22', marginBottom: '8px'}}>⚙️ 杀号参数配置</div>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px'}}>
              <div>
                <label style={{fontSize: '0.85em', color: '#333'}}>近N期过热检测: </label>
                <select value={eliminationOptions.recentPeriods} onChange={(e) => setEliminationOptions({...eliminationOptions, recentPeriods: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                  <option value={3}>3期</option>
                  <option value={5}>5期</option>
                  <option value={8}>8期</option>
                  <option value={10}>10期</option>
                  <option value={20}>20期</option>
                  <option value={30}>30期（推荐）</option>
                  <option value={50}>50期</option>
                </select>
              </div>
              <div>
                <label style={{fontSize: '0.85em', color: '#333'}}>前区过热出现次数: </label>
                <select value={eliminationOptions.overheatCount} onChange={(e) => setEliminationOptions({...eliminationOptions, overheatCount: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                  <option value={2}>≥2次（短窗口用）</option>
                  <option value={3}>≥3次</option>
                  <option value={4}>≥4次</option>
                  <option value={5}>≥5次</option>
                  <option value={6}>≥6次（推荐）</option>
                  <option value={7}>≥7次</option>
                </select>
              </div>
              <div>
                <label style={{fontSize: '0.85em', color: '#333'}}>后区过热出现次数: </label>
                <select value={eliminationOptions.backOverheatCount} onChange={(e) => setEliminationOptions({...eliminationOptions, backOverheatCount: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                  <option value={2}>≥2次（短窗口用）</option>
                  <option value={3}>≥3次</option>
                  <option value={4}>≥4次</option>
                  <option value={5}>≥5次</option>
                  <option value={6}>≥6次（推荐）</option>
                  <option value={7}>≥7次</option>
                </select>
              </div>
              <div>
                <label style={{fontSize: '0.85em', color: '#333'}}>Z-score阈值: </label>
                <select value={eliminationOptions.zScoreThreshold} onChange={(e) => setEliminationOptions({...eliminationOptions, zScoreThreshold: parseFloat(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                  <option value={1.0}>1.0（宽松）</option>
                  <option value={1.5}>1.5（推荐）</option>
                  <option value={2.0}>2.0（严格）</option>
                </select>
              </div>
              <div>
                <label style={{fontSize: '0.85em', color: '#333'}}>前区连续出现期数: </label>
                <select value={eliminationOptions.consecutiveThreshold} onChange={(e) => setEliminationOptions({...eliminationOptions, consecutiveThreshold: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                  <option value={2}>≥2期</option>
                  <option value={3}>≥3期（推荐）</option>
                  <option value={4}>≥4期</option>
                </select>
              </div>
              <div>
                <label style={{fontSize: '0.85em', color: '#333'}}>后区连续出现期数: </label>
                <select value={eliminationOptions.backConsecutiveThreshold} onChange={(e) => setEliminationOptions({...eliminationOptions, backConsecutiveThreshold: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                  <option value={2}>≥2期（推荐，后区号码少）</option>
                  <option value={3}>≥3期</option>
                </select>
              </div>
            </div>
            <div style={{fontSize: '0.8em', color: '#555', marginTop: '8px'}}>
              6种杀号算法：近30期过热(≥6次)、Z-score偏离、连续出现、二项分布检验、趋势动量、重号饱和。后区由于号码少(12个)，单号概率高(16.7%)，使用相同阈值(≥6次)保持保守策略。
            </div>
          </div>

          {/* 结构杀号参数配置（仅在结构模式下显示） */}
          {(eliminationOptions.mode === 'structural') && (
            <div className="elimination-options" style={{
              marginBottom: '15px',
              padding: '12px',
              background: '#f0fff4',
              borderRadius: '8px',
              border: '1px solid #c6f6d5',
              color: '#333'
            }}>
              <div style={{fontWeight: 'bold', color: '#2e7d32', marginBottom: '8px'}}>🔧 结构杀号参数配置</div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px'}}>
                <div>
                  <label style={{fontSize: '0.85em', color: '#333'}}>启用7区断区杀号: </label>
                  <select value={structuralOptions.zoneBreakEnabled} onChange={(e) => setStructuralOptions({...structuralOptions, zoneBreakEnabled: e.target.value === 'true'})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                    <option value="true">✅ 启用（推荐）</option>
                    <option value="false">❌ 禁用</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize: '0.85em', color: '#333'}}>和值范围过滤: </label>
                  <select value={`${structuralOptions.sumMin}-${structuralOptions.sumMax}`} onChange={(e) => {
                    const [min, max] = e.target.value.split('-').map(Number);
                    setStructuralOptions({...structuralOptions, sumMin: min, sumMax: max});
                  }} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                    <option value="60-120">60-120（宽松）</option>
                    <option value="65-115">65-115（推荐）</option>
                    <option value="70-110">70-110（严格）</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize: '0.85em', color: '#444'}}>重号杀号数量: </label>
                  <select value={structuralOptions.repeatKillCount} onChange={(e) => setStructuralOptions({...structuralOptions, repeatKillCount: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                    <option value={2}>杀2个（保守）</option>
                    <option value={3}>杀3个（推荐）</option>
                    <option value={4}>杀4个（激进）</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize: '0.85em', color: '#444'}}>启用尾数杀号: </label>
                  <select value={structuralOptions.tailKillEnabled} onChange={(e) => setStructuralOptions({...structuralOptions, tailKillEnabled: e.target.value === 'true'})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                    <option value="true">✅ 启用（推荐）</option>
                    <option value="false">❌ 禁用</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize: '0.85em', color: '#333'}}>热号检测期数: </label>
                  <select value={structuralOptions.hotPeriods} onChange={(e) => setStructuralOptions({...structuralOptions, hotPeriods: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                    <option value={10}>10期（推荐）</option>
                    <option value={15}>15期</option>
                    <option value={20}>20期</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize: '0.85em', color: '#333'}}>冷号检测期数: </label>
                  <select value={structuralOptions.coldPeriods} onChange={(e) => setStructuralOptions({...structuralOptions, coldPeriods: parseInt(e.target.value)})} style={{padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333', backgroundColor: '#ffffff', WebkitAppearance: 'none', appearance: 'none'}}>
                    <option value={20}>20期（推荐）</option>
                    <option value={30}>30期</option>
                    <option value={40}>40期</option>
                  </select>
                </div>
              </div>
              <div style={{fontSize: '0.8em', color: '#555', marginTop: '8px'}}>
                5种结构杀号算法：7区断区预测、和值范围过滤、重号杀号增强、尾数频率杀号、冷热号综合过滤。基于彩票开奖规律的结构化分析。
              </div>
            </div>
          )}

          {/* 执行杀号按钮 + 回测按钮 */}
          <div style={{display: 'flex', gap: '10px', marginBottom: '15px'}}>
            <button
              onClick={handleExecuteEliminate}
              className="eliminate-btn"
              style={{
                flex: 1,
                background: (eliminationOptions.mode || 'basic') === 'structural' 
                  ? 'linear-gradient(135deg, #2e7d32, #1b5e20)' 
                  : (eliminationOptions.mode || 'basic') === 'mixed_union' ? 'linear-gradient(135deg, #8e44ad, #6c3483)' 
                  : (eliminationOptions.mode || 'basic') === 'mixed_intersect' ? 'linear-gradient(135deg, #2980b9, #1a5276)' 
                  : 'linear-gradient(135deg, #e74c3c, #c0392b)',
                color: '#fff',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '15px'
              }}
            >
              执行{(({basic: '基础', structural: '结构', mixed_union: '混合并集', mixed_intersect: '混合交集'})[eliminationOptions.mode || 'basic'] || '基础')}杀号分析
            </button>
            <button
              onClick={() => handleBacktest(eliminationOptions.mode || 'basic')}
              style={{
                flex: '0 0 100px',
                background: 'linear-gradient(135deg, #17a2b8, #138496)',
                color: '#fff',
                border: 'none',
                padding: '12px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
            >
              回测验证
            </button>
          </div>

          {/* 回测结果展示 - 始终可见，不受套餐选择影响 */}
          {backtestResult && backtestResult.success && (
            <div style={{
              marginTop: '15px',
              padding: '15px',
              background: 'linear-gradient(135deg, #e8f4f8, #d6eaf8)',
              borderRadius: '8px',
              border: '1px solid #5dade2'
            }}>
              <div style={{fontWeight: 'bold', color: '#17a2b8', marginBottom: '10px', fontSize: '1.0em'}}>
                回测验证结果（{backtestResult.modeName}）
              </div>
              <div style={{fontSize: '0.85em', color: '#333', marginBottom: '8px'}}>
                {backtestResult.summary}
              </div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px', marginBottom: '10px'}}>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc'}}>
                  <div style={{fontSize: '0.8em', color: '#333'}}>前区命中率</div>
                  <div style={{fontWeight: 'bold', color: '#27ae60', fontSize: '1.3em'}}>{(backtestResult.frontAccuracy * 100).toFixed(1)}%</div>
                </div>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc'}}>
                  <div style={{fontSize: '0.8em', color: '#333'}}>后区命中率</div>
                  <div style={{fontWeight: 'bold', color: '#27ae60', fontSize: '1.3em'}}>{(backtestResult.backAccuracy * 100).toFixed(1)}%</div>
                </div>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc'}}>
                  <div style={{fontSize: '0.8em', color: '#333'}}>前区误杀</div>
                  <div style={{fontWeight: 'bold', color: '#e74c3c', fontSize: '1.1em'}}>{backtestResult.avgFrontWrongKill.toFixed(1)}个/期</div>
                </div>
                <div style={{textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc'}}>
                  <div style={{fontSize: '0.8em', color: '#333'}}>回测期数</div>
                  <div style={{fontWeight: 'bold', color: '#17a2b8', fontSize: '1.1em'}}>{backtestResult.totalPeriods}期</div>
                </div>
              </div>
              {/* 最近5期回测明细 */}
              <div style={{fontSize: '0.8em', color: '#333', marginBottom: '4px'}}>最近5期回测明细:</div>
              {backtestResult.details.slice(-5).reverse().map((detail, idx) => (
                <div key={idx} style={{padding: '6px 8px', borderBottom: '1px solid #ccc', fontSize: '0.75em', display: 'flex', justifyContent: 'space-between'}}>
                  <div>第{detail.periodIndex}期: 开奖 [{detail.nextDraw.front.join(' ')} + {detail.nextDraw.back.join(' ')}]</div>
                  <div style={{color: detail.frontWrongKill > 0 ? '#e74c3c' : '#27ae60'}}>
                    保留命中{detail.frontCorrectKeep}/5 + 误杀{detail.frontWrongKill}个 | 前区命中{(detail.frontAccuracy * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          )}
          {eliminationResult && (
            <div className="elimination-result">
              {/* 杀号摘要 */}
              <div className="elimination-summary" style={{
                padding: '10px',
                background: '#e3f2fd',
                borderRadius: '6px',
                marginBottom: '12px',
                fontSize: '0.9em',
                fontWeight: '500',
                color: '#333',
                position: 'relative',
                zIndex: 2
              }}>
                {eliminationResult.summary}
              </div>

              {/* 算法详情 - 展示每种算法的具体杀号 */}
              <div className="elimination-algorithms">
                <div style={{fontWeight: 'bold', marginBottom: '6px', color: '#333'}}>📊 杀号算法详情（共{eliminationResult.algorithmDetails.length}种）</div>
                {eliminationResult.algorithmDetails.map((algo, idx) => (
                  <div key={idx} style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid #eee',
                    fontSize: '0.85em'
                  }}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <div>
                        <strong>{algo.source ? `[${algo.source}] ` : ''}{algo.name}</strong>
                        <span style={{color: '#555', marginLeft: '6px', fontSize: '0.8em'}}>{algo.description}</span>
                      </div>
                      <div style={{color: '#e74c3c', whiteSpace: 'nowrap'}}>
                        前区{algo.frontCount}个 / 后区{algo.backCount}个
                      </div>
                    </div>
                    {algo.frontNumbers && algo.frontNumbers.length > 0 && (
                      <div style={{marginTop: '4px', fontSize: '0.8em', color: '#c0392b'}}>
                        前区杀号: {algo.frontNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}
                      </div>
                    )}
                    {algo.backNumbers && algo.backNumbers.length > 0 && (
                      <div style={{marginTop: '2px', fontSize: '0.8em', color: '#2980b9'}}>
                        后区杀号: {algo.backNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 调试信息开关 */}
              <div style={{marginTop: '12px', marginBottom: '8px'}}>
                <button
                  onClick={() => setShowDebugInfo(!showDebugInfo)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #9b59b6',
                    background: showDebugInfo ? '#9b59b6' : '#fff',
                    color: showDebugInfo ? '#fff' : '#9b59b6',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '0.85em',
                    transition: 'all 0.2s'
                  }}
                >
                  {showDebugInfo ? '🔍 隐藏调试信息' : '🔍 显示调试信息'}
                </button>
              </div>

              {/* 调试信息展示 */}
              {showDebugInfo && eliminationResult && (
                <div className="debug-info" style={{
                  marginTop: '12px',
                  padding: '12px',
                  background: '#ffffff',
                  borderRadius: '8px',
                  border: '1px dashed #9b59b6',
                  fontSize: '0.8em',
                  color: '#333',
                  position: 'relative',
                  zIndex: 2,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <div style={{fontWeight: 'bold', marginBottom: '8px', color: '#7b1fa2'}}>🐛 调试信息</div>
                  
                  {/* 杀号统计 */}
                  <div style={{marginBottom: '10px'}}>
                    <strong style={{color: '#333'}}>杀号统计：</strong>
                    <ul style={{margin: '4px 0 0 20px', padding: 0, color: '#333'}}>
                      <li>前区杀掉: {eliminationResult.frontEliminated.length}个，保留: {eliminationResult.frontRemaining.length}个</li>
                      <li>后区杀掉: {eliminationResult.backEliminated.length}个，保留: {eliminationResult.backRemaining.length}个</li>
                      <li>杀号模式: {eliminationOptions.mode === 'basic' ? '基础杀号' : eliminationOptions.mode === 'structural' ? '结构杀号' : eliminationOptions.mode === 'mixed_union' ? '混合并集' : '混合交集'}</li>
                    </ul>
                  </div>

                  {/* 参数配置 */}
                  <div style={{marginBottom: '10px'}}>
                    <strong style={{color: '#333'}}>当前参数：</strong>
                    <ul style={{margin: '4px 0 0 20px', padding: 0, color: '#333'}}>
                      <li>近N期窗口: {eliminationOptions.recentPeriods}期</li>
                      <li>前区过热阈值: ≥{eliminationOptions.overheatCount}次</li>
                      <li>后区过热阈值: ≥{eliminationOptions.backOverheatCount}次</li>
                      <li>Z-score阈值: {eliminationOptions.zScoreThreshold}</li>
                      <li>连续出现阈值: {eliminationOptions.consecutiveThreshold}期</li>
                    </ul>
                  </div>

                  {/* 各算法详细数据 */}
                  <div>
                    <strong style={{color: '#333'}}>各算法详细数据：</strong>
                    {eliminationResult.algorithmDetails.map((algo, idx) => (
                      <div key={idx} style={{marginLeft: '10px', marginTop: '6px', paddingBottom: '6px', borderBottom: '1px solid #e0d0f0', color: '#333'}}>
                        <div><strong style={{color: '#333'}}>{algo.name}:</strong></div>
                        <div style={{marginLeft: '10px', fontSize: '0.9em'}}>
                          前区: {algo.frontCount}个 {algo.frontNumbers && algo.frontNumbers.length > 0 && `(${algo.frontNumbers.join(', ')})`}<br/>
                          后区: {algo.backCount}个 {algo.backNumbers && algo.backNumbers.length > 0 && `(${algo.backNumbers.join(', ')})`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 套餐选择 */}
              <div className="fushi-plan-selector" style={{marginTop: '12px'}}>
                <div style={{fontWeight: 'bold', marginBottom: '8px', color: '#2e7d32'}}>📋 选择复式套餐</div>
                <p style={{fontSize: '0.8em', color: '#555', marginBottom: '8px'}}>杀号后从剩余号码池自动选取最优号码填充套餐，X+Y表示前区X个号码选5+后区Y个号码选2</p>
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px', marginBottom: '12px'}}>
                  {NumberEliminator.FUSHI_PLANS.map(plan => {
                    const bets = NumberEliminator.calcPlanBets(plan);
                    const canSelect = eliminationResult && eliminationResult.frontRemaining.length >= plan.frontPool && eliminationResult.backRemaining.length >= plan.backPool;
                    const isActive = selectedPlan && selectedPlan.key === plan.key;
                    
                    // 根据套餐大小设置不同颜色
                    let bgColor, borderColor, textColor, hoverBgColor;
                    if (plan.frontPool <= 6) {
                      // 小套餐 - 绿色系
                      bgColor = isActive ? 'linear-gradient(135deg, #a8e6cf, #88d8b0)' : 'linear-gradient(135deg, #f0fff4, #e6ffed)';
                      borderColor = isActive ? '#2ecc71' : '#27ae60';
                      textColor = isActive ? '#1a5c2e' : '#2d5a3f';
                      hoverBgColor = 'linear-gradient(135deg, #88d8b0, #6bcf9f)';
                    } else if (plan.frontPool <= 7) {
                      // 中套餐 - 蓝色系
                      bgColor = isActive ? 'linear-gradient(135deg, #74b9ff, #0984e3)' : 'linear-gradient(135deg, #e3f2fd, #bbdefb)';
                      borderColor = isActive ? '#0984e3' : '#3498db';
                      textColor = isActive ? '#ffffff' : '#1e3a5f';
                      hoverBgColor = 'linear-gradient(135deg, #0984e3, #74b9ff)';
                    } else {
                      // 大套餐 - 橙红色系
                      bgColor = isActive ? 'linear-gradient(135deg, #ff7675, #e17055)' : 'linear-gradient(135deg, #ffeaa7, #fab1a0)';
                      borderColor = isActive ? '#d63031' : '#e17055';
                      textColor = isActive ? '#ffffff' : '#6c2c1a';
                      hoverBgColor = 'linear-gradient(135deg, #e17055, #ff7675)';
                    }
                    
                    return (
                      <button
                        key={plan.key}
                        onClick={() => canSelect && handleSelectPlan(plan)}
                        disabled={!canSelect}
                        className={`fushi-plan-btn ${isActive ? 'active' : ''} ${!canSelect ? 'disabled' : ''}`}
                        style={{
                          padding: '12px 8px',
                          borderRadius: '10px',
                          border: isActive ? '3px solid ' + borderColor : '2px solid ' + borderColor,
                          background: !canSelect ? '#f5f5f5' : bgColor,
                          color: !canSelect ? '#ccc' : textColor,
                          cursor: canSelect ? 'pointer' : 'not-allowed',
                          fontWeight: isActive ? 'bold' : 'normal',
                          textAlign: 'center',
                          transition: 'all 0.3s ease',
                          boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.15)' : canSelect ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                          transform: isActive ? 'scale(1.05)' : 'scale(1)',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                        onMouseEnter={(e) => {
                          if (canSelect && !isActive) {
                            e.currentTarget.style.background = hoverBgColor;
                            e.currentTarget.style.transform = 'scale(1.03)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = bgColor;
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
                          }
                        }}
                      >
                        {isActive && (
                          <div style={{
                            position: 'absolute',
                            top: '-10px',
                            right: '-10px',
                            width: '40px',
                            height: '40px',
                            background: 'rgba(255,255,255,0.3)',
                            borderRadius: '50%',
                            transform: 'rotate(45deg)'
                          }} />
                        )}
                        <div style={{fontSize: '1.3em', fontWeight: 'bold', marginBottom: '4px'}}>{plan.key}</div>
                        <div style={{fontSize: '0.75em', opacity: 0.9}}>
                          <div>{bets.totalBets}注</div>
                          <div style={{fontWeight: 'bold', fontSize: '1.1em'}}>{bets.cost}元</div>
                        </div>
                        {!canSelect && (
                          <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%) rotate(-45deg)',
                            fontSize: '0.8em',
                            color: '#555',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap'
                          }}>号码不足</div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {!eliminationResult && <div style={{fontSize: '0.8em', color: '#555'}}>请先执行杀号分析</div>}
              </div>

              {/* 自动选号结果展示 */}
              {selectedPlan && fushiFrontSelected.length > 0 && (
                <div className="fushi-auto-select" style={{marginTop: '12px', padding: '10px', background: '#e8f5e9', borderRadius: '6px'}}>
                  <div style={{fontWeight: 'bold', marginBottom: '6px', color: '#2e7d32'}}>🎯 {selectedPlan.key}套餐 - 自动选号结果</div>
                  <div style={{fontSize: '0.85em', marginBottom: '6px'}}>
                    <span style={{color: '#e74c3c'}}>🔴 前区杀号({eliminationResult.frontEliminated.length}个):</span> {eliminationResult.frontEliminated.map(n => n.toString().padStart(2, '0')).join(', ')}
                  </div>
                  <div style={{fontSize: '0.85em', marginBottom: '6px'}}>
                    <span style={{color: '#e74c3c'}}>🔵 后区杀号({eliminationResult.backEliminated.length}个):</span> {eliminationResult.backEliminated.map(n => n.toString().padStart(2, '0')).join(', ')}
                  </div>
                  <div style={{marginBottom: '8px'}}>
                    <div style={{fontWeight: 'bold', fontSize: '0.85em', color: '#333'}}>✅ 前区自动选号({fushiFrontSelected.length}个):</div>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px'}}>
                      {fushiFrontSelected.map(num => (
                        <span key={num} style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          background: 'rgba(103,194,58,0.15)',
                          border: '1px solid #67c23a',
                          color: '#2e7d32',
                          fontWeight: 'bold',
                          fontSize: '0.9em',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {num.toString().padStart(2, '0')}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{fontWeight: 'bold', fontSize: '0.85em', color: '#333'}}>✅ 后区自动选号({fushiBackSelected.length}个):</div>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px'}}>
                      {fushiBackSelected.map(num => (
                        <span key={num} style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          background: 'rgba(52,152,219,0.15)',
                          border: '1px solid #3498db',
                          color: '#2980b9',
                          fontWeight: 'bold',
                          fontSize: '0.9em',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {num.toString().padStart(2, '0')}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{fontSize: '0.8em', color: '#444', marginTop: '6px'}}>注：选号基于综合评分（频率+遗漏+趋势动量+时间衰减）自动选取最优号码</div>
                </div>
              )}

              {/* 号码全景图 - 杀号+被选展示 */}
              {eliminationResult && (
                <div className="elimination-numbers" style={{marginTop: '12px'}}>
                  {/* 前区号码展示 */}
                  <div style={{marginBottom: '12px'}}>
                    <div style={{fontWeight: 'bold', marginBottom: '6px', fontSize: '0.9em'}}>🔴 前区号码 (1-35) — 杀号结果</div>
                    <div className="fushi-number-picker" style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
                      {Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1).map(num => {
                        const isEliminated = eliminationResult.frontEliminated.includes(num);
                        const reasons = eliminationResult.reasons[num] || [];
                        return (
                          <button
                            key={num}
                            className={`fushi-number-btn ${isEliminated ? 'eliminated' : ''}`}
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '6px',
                              border: isEliminated ? '2px solid #e74c3c' : '1px solid #ddd',
                              background: isEliminated ? 'rgba(231,76,60,0.15)' : '#fff',
                              color: isEliminated ? '#e74c3c' : '#333',
                              fontSize: '0.85em',
                              fontWeight: isEliminated ? 'bold' : 'normal',
                              textDecoration: isEliminated ? 'line-through' : 'none',
                              position: 'relative',
                              cursor: 'default',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title={isEliminated ? `杀号原因: ${reasons.join('、')}` : '保留号码'}
                          >
                            {num.toString().padStart(2, '0')}
                            {isEliminated && <span style={{position: 'absolute', top: '-2px', right: '-2px', fontSize: '8px', background: '#e74c3c', color: '#fff', borderRadius: '4px', padding: '0 3px'}}>×</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* 后区号码展示 */}
                  <div>
                    <div style={{fontWeight: 'bold', marginBottom: '6px', fontSize: '0.9em'}}>🔵 后区号码 (1-12) — 杀号结果</div>
                    <div className="fushi-number-picker" style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
                      {Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1).map(num => {
                        const isEliminated = eliminationResult.backEliminated.includes(num);
                        const reasons = eliminationResult.reasons[num] || [];
                        return (
                          <button
                            key={num}
                            className={`fushi-number-btn ${isEliminated ? 'eliminated' : ''}`}
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '6px',
                              border: isEliminated ? '2px solid #e74c3c' : '1px solid #ddd',
                              background: isEliminated ? 'rgba(231,76,60,0.15)' : '#fff',
                              color: isEliminated ? '#e74c3c' : '#333',
                              fontSize: '0.85em',
                              fontWeight: isEliminated ? 'bold' : 'normal',
                              textDecoration: isEliminated ? 'line-through' : 'none',
                              position: 'relative',
                              cursor: 'default',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title={isEliminated ? `杀号原因: ${reasons.join('、')}` : '保留号码'}
                          >
                            {num.toString().padStart(2, '0')}
                            {isEliminated && <span style={{position: 'absolute', top: '-2px', right: '-2px', fontSize: '8px', background: '#e74c3c', color: '#fff', borderRadius: '4px', padding: '0 3px'}}>×</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{fontSize: '0.8em', color: '#555', marginTop: '6px'}}>选择套餐后系统自动从保留号码中选最优号码</div>
                </div>
              )}

              {/* 生成复式组合按钮 */}
              {selectedPlan && fushiFrontSelected.length > 0 && (
                <button
                  onClick={handleGenerateFushi}
                  className="fushi-generate-btn"
                  style={{
                    background: 'linear-gradient(135deg, #67c23a, #27ae60)',
                    color: '#fff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '16px',
                    width: '100%',
                    marginTop: '12px',
                    boxShadow: '0 2px 8px rgba(103, 194, 58, 0.3)'
                  }}
                >
                  🎯 生成{selectedPlan.key}复式组合
                </button>
              )}

              {/* 复式组合结果 */}
              {fushiResult && (
                <div className="fushi-result" style={{marginTop: '15px'}}>
                  <div className="result-header">
                    <h3>复式组合结果</h3>
                    <span className="result-summary">
                      共 {fushiResult.totalBets} 注 | 费用 {fushiResult.cost} 元
                    </span>
                  </div>

                  {/* 前区+后区号码展示 */}
                  <div style={{padding: '15px', background: '#f8f9fa', borderRadius: '8px', marginTop: '10px'}}>
                    <div style={{marginBottom: '8px'}}>
                      <span style={{color: '#e74c3c', fontWeight: 'bold', marginRight: '8px'}}>前区:</span>
                      <span style={{fontSize: '1.1em', fontFamily: 'monospace'}}>
                        {fushiResult.frontPool.map(n => n.toString().padStart(2, '0')).join(' ')}
                      </span>
                      <span style={{color: '#555', marginLeft: '6px', fontSize: '0.85em'}}>({fushiResult.frontPool.length}个选{fushiResult.frontCount})</span>
                    </div>
                    <div>
                      <span style={{color: '#3498db', fontWeight: 'bold', marginRight: '8px'}}>后区:</span>
                      <span style={{fontSize: '1.1em', fontFamily: 'monospace'}}>
                        {fushiResult.backPool.map(n => n.toString().padStart(2, '0')).join(' ')}
                      </span>
                      <span style={{color: '#555', marginLeft: '6px', fontSize: '0.85em'}}>({fushiResult.backPool.length}个选{fushiResult.backCount})</span>
                    </div>
                  </div>

                  {/* 复制按钮 */}
                  <div className="copy-section">
                    <button
                      className="copy-btn"
                      onClick={handleCopyFushi}
                      style={{
                        background: copySuccess ? '#67c23a' : '#409eff',
                        color: '#fff',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '14px',
                        marginTop: '10px'
                      }}
                    >
                      {copySuccess ? '✅ 已复制' : '📋 一键复制'}
                    </button>
                    <p className="copy-hint">复制后可粘贴到微信、QQ等聊天工具</p>
                  </div>
                </div>
              )}
            </div>
          )}

        </section>
        {(() => {
          const latestDraw = getLatestDrawFromData();
          if (!latestDraw) return null;
          
          // 如果没有当前推荐结果，显示分析按钮
          if (!currentRecommendation) {
            return (
              <section className="card model-recommendation-card">
                <h2>💡 智能推荐模型</h2>
                <div className="recommendation-setup">
                  <div className="setup-info">
                    <p>📊 基于最新开奖号码，智能分析各模型表现，为您推荐最佳预测模型</p>
                    <div className="sample-size-control">
                      <label>🎯 分析样本量：</label>
                      <select 
                        value={recommendSampleSize}
                        onChange={(e) => setRecommendSampleSize(parseInt(e.target.value))}
                        className="sample-size-select"
                      >
                        <option value={50}>50组（快速）</option>
                        <option value={60}>60组（标准）</option>
                        <option value={80}>80组（推荐）</option>
                        <option value={100}>100组（精确）</option>
                        <option value={150}>150组（极致）</option>
                      </select>
                      <span className="control-hint">影响推荐的准确性</span>
                    </div>
                    <div className="sample-size-control">
                      <label>📅 数据窗口：</label>
                      <select 
                        value={dataWindow}
                        onChange={(e) => setDataWindow(parseInt(e.target.value))}
                        className="sample-size-select"
                      >
                        <option value={0}>全部数据</option>
                        <option value={30}>最近30期</option>
                        <option value={50}>最近50期</option>
                        <option value={60}>最近60期（推荐）</option>
                        <option value={80}>最近80期</option>
                        <option value={100}>最近100期</option>
                        <option value={150}>最近150期</option>
                      </select>
                      <span className="control-hint">统计分析使用的数据范围（默认60期）</span>
                    </div>
                  </div>
                  <button 
                    onClick={handleAnalyzeRecommendation} 
                    className="analyze-button"
                    style={{backgroundColor: '#67c23a', boxShadow: '0 2px 4px rgba(103, 194, 58, 0.3)'}}
                  >
                    🔍 立即分析推荐模型
                  </button>
                </div>
              </section>
            );
          }
          
          // 显示推荐结果
          const { recommendedModel, allModels, reason, alternativeSuggestion, analysisTime, dataVolume, sampleSize } = currentRecommendation;
          
          return (
            <section className="card model-recommendation-card">
              <div className="recommendation-header">
                <h2>💡 智能推荐模型</h2>
                <div className="header-controls">
                  <div className="controls-row">
                    <div className="sample-size-control-inline">
                      <label>每组数量：</label>
                      <select 
                        value={recommendSampleSize}
                        onChange={(e) => {
                          setRecommendSampleSize(parseInt(e.target.value));
                          // 样本量变化后自动重新分析
                          setTimeout(() => handleAnalyzeRecommendation(), 100);
                        }}
                        className="sample-size-select-small"
                      >
                        <option value={50}>50组</option>
                        <option value={60}>60组</option>
                        <option value={80}>80组</option>
                        <option value={100}>100组</option>
                        <option value={150}>150组</option>
                      </select>
                    </div>
                    <div className="sample-size-control-inline">
                      <label>使用数据：</label>
                      <select 
                        value={dataWindow}
                        onChange={(e) => {
                          setDataWindow(parseInt(e.target.value));
                          // 数据窗口变化后自动重新分析
                          setTimeout(() => handleAnalyzeRecommendation(), 100);
                        }}
                        className="sample-size-select-small"
                      >
                        <option value={0}>全部</option>
                        <option value={30}>30期</option>
                        <option value={50}>50期</option>
                        <option value={80}>80期</option>
                        <option value={100}>100期</option>
                        <option value={150}>150期</option>
                      </select>
                    </div>
                  </div>
                  <div className="re-analyze-row">
                    <button 
                      onClick={handleAnalyzeRecommendation} 
                      className="re-analyze-button"
                    >
                      🔄 重新分析
                    </button>
                  </div>
                </div>
              </div>
              <div className="recommendation-content">
                <div className="recommended-model">
                  <div className="recommend-badge">⭐ 推荐使用</div>
                  <div className="model-name">{recommendedModel.name}</div>
                  <div className="recommend-reason">
                    {reason.split('\n').map((line, idx) => (
                      <div key={idx}>{line}</div>
                    ))}
                  </div>
                  
                  <div className="model-stats">
                    <div className="stat-item">
                      <span className="stat-label">前区命中率</span>
                      <span className="stat-value">{recommendedModel.stats.frontHitRate}%</span>
                      <span className="stat-hint">(期望: {recommendedModel.stats.expectedFrontRate}%)</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">后区命中率</span>
                      <span className="stat-value highlight">{recommendedModel.stats.backHitRate}%</span>
                      <span className="stat-hint">(期望: {recommendedModel.stats.expectedBackRate}%)</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">平均总命中</span>
                      <span className="stat-value">{recommendedModel.stats.avgTotalHits}/7</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">样本数量</span>
                      <span className="stat-value">{recommendedModel.stats.sampleCount}组</span>
                    </div>
                  </div>
                  
                  {alternativeSuggestion && (
                    <div className="alternative-suggestion">{alternativeSuggestion}</div>
                  )}
                </div>
                
                <div className="all-models-comparison">
                  <div className="comparison-title">📊 全部模型表现对比（共{allModels.length}个）</div>
                  <div className="comparison-list">
                    {allModels.map((model, idx) => (
                      <div 
                        key={model.key} 
                        className={`comparison-item ${idx === 0 ? 'best' : ''}`}
                      >
                        <div className="model-rank">#{idx + 1}</div>
                        <div className="model-info">
                          <div className="model-name-small">
                            {model.name}
                            {idx === 0 && <span className="crown-icon">👑</span>}
                          </div>
                          <div className="model-characteristics">
                            {model.characteristics.map((char, cIdx) => (
                              <span key={cIdx} className="char-tag">{char}</span>
                            ))}
                          </div>
                          <div className="model-stats-small">
                            <span className="front-stat">前区: {model.stats.frontHitRate}% (期望{model.stats.expectedFrontRate}%)</span>
                            <span className="back-stat">后区: {model.stats.backHitRate}% (期望{model.stats.expectedBackRate}%)</span>
                            <span className="total-stat">总计: {model.stats.avgTotalHits}/7</span>
                            <span className="sample-stat">({model.stats.sampleCount}组)</span>
                          </div>
                        </div>
                        {idx === 0 && <div className="best-badge">最佳</div>}
                      </div>
                    ))}
                  </div>
                  
                  <div className="analysis-footer">
                    <span className="analysis-time">分析时间: {analysisTime}</span>
                    <span className="data-volume-info">📊 基于{dataVolume}期历史数据 | 每模型{sampleSize}组样本</span>
                    <span className="analysis-tip">💡 提示：建议结合多个模型使用，提高覆盖率</span>
                  </div>
                </div>
              </div>
            </section>
          );
        })()}

        <section className="card">
          <h2>📝 数据管理</h2>
          <div className="add-number-form">
            <input 
              type="text" 
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              placeholder="输入新数据 (如: 01 02 03 04 05 06 07)"
            />
            <button 
              className="secondary" 
              style={{width: 'auto', marginTop: 0}}
              onClick={() => {
                if (newNumber.trim()) {
                  const newData = dataInput + '\n' + newNumber;
                  setDataInput(newData);
                  setNewNumber('');
                  analyzer.loadHistoryData(newData, "用户数据");
                  // 重新计算统计
                  const hotCold = analyzer.getHotColdNumbers();
                  const [expFront, expBack] = analyzer.calculateExpectedValue();
                  const variance = analyzer.calculateVariance();
                  const sumProb = analyzer.calculateSumProbability();
                  setStats({ hotCold, expFront, expBack, variance, sumProb });
                  localStorage.setItem('lottery_data', newData);
                }
              }}
            >添加数据</button>
          </div>
          
          <div className="history-toggle" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? '收起历史数据' : `查看历史数据 (${analyzer.historyData.length}组)`}
          </div>
          
          {showHistory && (
            <div className="history-list">
              {analyzer.historyData.map((item, index) => (
                <div key={index} className="history-item">
                  <span className="index">#{index + 1}</span>
                  <span className="nums">{item.full.map(n => n.toString().padStart(2, '0')).join(' ')}</span>
                </div>
              ))}
            </div>
          )}

          <textarea 
            value={dataInput} 
            onChange={(e) => setDataInput(e.target.value)}
            placeholder="或者在这里批量粘贴历史数据..."
          />
          <div className="button-group">
            <button onClick={loadData} className="secondary">更新分析</button>
            <button onClick={clearCache} className="secondary" style={{backgroundColor: '#909399'}}>重置数据</button>
          </div>
        </section>

        <section className="card">
          <h2> 智能预测</h2>
          
          <div className="model-descriptions">
            {Object.keys(modelNames).map(m => (
              <div key={m} className={`model-desc-item ${selectedModels.includes(m) ? 'active' : ''}`}>
                <label className="model-desc-label">
                  <input 
                    type="checkbox" 
                    checked={selectedModels.includes(m)}
                    onChange={(e) => {
                      let newModels;
                      if (e.target.checked) {
                        newModels = [...selectedModels, m];
                      } else {
                        newModels = selectedModels.filter(x => x !== m);
                      }
                      setSelectedModels(newModels);
                      saveSelectedModels(newModels); // ✅ 保存用户选择
                      // 追踪模型选择变化
                      trackModelSelection(newModels);
                    }}
                  />
                  <div className="model-desc-content">
                    <strong>{modelNames[m]}</strong>：{modelDescriptions[m]}
                  </div>
                </label>
              </div>
            ))}
          </div>
          
          <div className="generate-control">
            <label>每组模型生成：</label>
            <input 
              type="number" 
              value={groupsPerModel || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setGroupsPerModel('');
                } else {
                  const num = parseInt(val);
                  if (!isNaN(num) && num > 0) {
                    setGroupsPerModel(num);
                  }
                }
              }}
              min="1"
              placeholder="输入组数"
            />
            <span>组</span>
          </div>
          
          {/* 根据用户是否主动生成过显示不同的按钮 */}
          {!hasGeneratedToday ? (
            // 未生成：显示首次生成按钮
            <button onClick={handleGenerate} style={{backgroundColor: '#67c23a', boxShadow: '0 2px 4px rgba(103, 194, 58, 0.3)'}} disabled={isGenerating}>
              {isGenerating ? '⏳ 生成中...' : '🎯 一键生成号码'}
            </button>
          ) : (
            // 已生成：显示缓存信息横幅
            <div className="cache-info-banner">
              <div className="cache-status">
                <span className="status-icon">✅</span>
                <span className="status-text">使用今日缓存</span>
              </div>
              <div className="cache-details">
                <span className="cache-time">📅 生成时间: {lastGenerateTime}</span>
                <span className="refresh-count">🔄 今日已刷新: {refreshCount}次</span>
              </div>
              <button 
                onClick={handleRegenerate}
                className="regenerate-button"
              >
                🔄 重新生成
              </button>
            </div>
          )}
          
          {predictions.length > 0 && (
            <div className="action-buttons">
              <button 
                onClick={handleCopy} 
                className={`secondary ${copySuccess ? 'success' : ''}`}
                style={{
                  backgroundColor: copySuccess ? '#67c23a' : '#409eff',
                  boxShadow: copySuccess ? '0 2px 4px rgba(103, 194, 58, 0.3)' : '0 2px 4px rgba(64, 158, 255, 0.3)'
                }}
              >
                {copySuccess ? '✓ 已复制' : '📋 一键复制'}
              </button>
              <button 
                onClick={handleSave} 
                className="secondary"
                style={{
                  backgroundColor: '#e6a23c',
                  boxShadow: '0 2px 4px rgba(230, 162, 60, 0.3)'
                }}
              >
                💾 保存为文件
              </button>
            </div>
          )}
          
          <div className="results">
            {Object.entries(
              predictions.reduce((acc, p) => {
                if (!acc[p.model]) acc[p.model] = [];
                acc[p.model].push(p);
                return acc;
              }, {})
            ).map(([model, groups]) => (
              <div key={model} className="model-result-card">
                <div className="result-header">
                  <span className="tag">{modelNames[model]}</span>
                </div>
                <div className="result-body">
                  {groups.map((p, idx) => (
                    <div key={idx} className="prediction-group">
                      <div className="group-row">
                        <div className="group-numbers">
                          <div className="nums front">{p.front.map(n => n.toString().padStart(2, '0')).join(' ')}</div>
                          <div className="nums back">{p.back.map(n => n.toString().padStart(2, '0')).join(' ')}</div>
                        </div>
                      </div>
                      <div className="group-sums">
                        <div className="sum-item">
                          <span className="sum-label">前区和值</span>
                          <span className="sum-number">{p.front.reduce((a, b) => a + b, 0)}</span>
                        </div>
                        <div className="sum-item">
                          <span className="sum-label">后区和值</span>
                          <span className="sum-number">{p.back.reduce((a, b) => a + b, 0)}</span>
                        </div>
                        <div className="sum-item">
                          <span className="sum-label">前区奇偶</span>
                          <span className="sum-number" style={{fontSize: '0.85em'}}>{(() => {
                            const oddCount = p.front.filter(n => n % 2 !== 0).length;
                            const evenCount = p.front.length - oddCount;
                            const ratio = `${oddCount}:${evenCount}`;
                            // 三级评价：理想(2:3/3:2)✓ / 良好(1:4/4:1) / 偏态(0:5/5:0)⚠
                            if (oddCount >= 2 && oddCount <= 3) return `${ratio} ✓`;
                            if (oddCount === 1 || oddCount === p.front.length - 1) return `${ratio}`;
                            return `${ratio} ⚠`;
                          })()}</span>
                        </div>
                      </div>
                      {groups.length > 1 && <div className="group-separator"></div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
    </AuthGuard>
  );
}

export default App;
