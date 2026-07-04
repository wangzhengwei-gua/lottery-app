/**
 * 胆拖玩法组件
 * 从App.jsx提取，包含号码选择、智能推荐、生成组合、回测验证、复制等功能
 */
import { useState } from 'react';
import { CONFIG } from '../utils/core/Config.js';
import { BackDanOptimizer } from '../utils/optimization/BackDanOptimizer.js';
import { FrontDanOptimizer } from '../utils/optimization/FrontDanOptimizer.js';
import { BackTuoOptimizer } from '../utils/optimization/BackTuoOptimizer.js';
import { CombinationValidator } from '../utils/optimization/CombinationValidator.js';
import { ConfidenceCalculator } from '../utils/optimization/ConfidenceCalculator.js';
import { UnifiedScorer } from '../utils/optimization/UnifiedScorer.js';
import { trackCopy } from '../utils/baiduAnalytics';

export default function DanTuoPlay({ analyzer, dataWindow }) {
  // 状态声明
  const [danNumbers, setDanNumbers] = useState([]);
  const [tuoNumbers, setTuoNumbers] = useState([]);
  const [backDanNumbers, setBackDanNumbers] = useState([]);
  const [backTuoNumbers, setBackTuoNumbers] = useState([]);
  const [dantuoResult, setDantuoResult] = useState(null);
  const [useBackFullDrag, setUseBackFullDrag] = useState(false);
  const [dantuoRecommendation, setDantuoRecommendation] = useState(null);
  const [tuoCount, setTuoCount] = useState(10);
  const [recommendStrategy, setRecommendStrategy] = useState('hot');
  const [backDanEnabled, setBackDanEnabled] = useState(false);
  const [backTuoCount, setBackTuoCount] = useState(2);
  const [danTuoBacktestResult, setDanTuoBacktestResult] = useState(null);
  const [selectionMode, setSelectionMode] = useState('dan');
  const [backSelectionMode, setBackSelectionMode] = useState('dan');
  const [copyDanTuoSuccess, setCopyDanTuoSuccess] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // 组合数计算
  const combinations = (n, k) => {
    if (k > n || k < 0) return 0;
    if (k === 0 || k === n) return 1;
    let result = 1;
    for (let i = 0; i < k; i++) {
      result = result * (n - i) / (i + 1);
    }
    return Math.round(result);
  };

  // 计算预计注数
  const calculateDanTuoBets = () => {
    if (!danNumbers.length || !tuoNumbers.length) return 0;
    const needFromTuo = 5 - danNumbers.length;
    if (needFromTuo <= 0 || needFromTuo > tuoNumbers.length) return 0;
    let frontBets = combinations(tuoNumbers.length, needFromTuo);
    if (backTuoNumbers.length > 0) {
      if (backDanEnabled && backDanNumbers.length > 0) {
        const backNeed = 2 - backDanNumbers.length;
        if (backNeed > 0 && backNeed <= backTuoNumbers.length) {
          return frontBets * combinations(backTuoNumbers.length, backNeed);
        }
      } else {
        if (backTuoNumbers.length >= 2) {
          return frontBets * combinations(backTuoNumbers.length, 2);
        }
      }
    }
    return frontBets;
  };

  // 号码切换
  const toggleDanNumber = (num) => {
    if (danNumbers.includes(num)) {
      setDanNumbers(danNumbers.filter(n => n !== num));
    } else {
      if (danNumbers.length >= 4) { alert('胆码最多选择4个！'); return; }
      if (tuoNumbers.includes(num)) { alert('该号码已在拖码中，请先从拖码中移除！'); return; }
      setDanNumbers([...danNumbers, num].sort((a, b) => a - b));
    }
  };

  const toggleTuoNumber = (num) => {
    if (tuoNumbers.includes(num)) {
      setTuoNumbers(tuoNumbers.filter(n => n !== num));
    } else {
      const maxTuoCount = 35 - danNumbers.length;
      if (tuoNumbers.length >= maxTuoCount) { alert(`拖码最多选择${maxTuoCount}个！`); return; }
      if (danNumbers.includes(num)) { alert('该号码已在胆码中，请先从胆码中移除！'); return; }
      setTuoNumbers([...tuoNumbers, num].sort((a, b) => a - b));
    }
  };

  const toggleBackDanNumber = (num) => {
    if (!backDanEnabled) { alert('后区胆码已关闭，请开启胆码开关或选择拖码！'); return; }
    if (backDanNumbers.includes(num)) {
      setBackDanNumbers(backDanNumbers.filter(n => n !== num));
    } else {
      if (backDanNumbers.length >= 1) { alert('后区胆码最多选择1个！'); return; }
      if (backTuoNumbers.includes(num)) { alert('该号码已在后区拖码中，请先从拖码中移除！'); return; }
      setBackDanNumbers([...backDanNumbers, num].sort((a, b) => a - b));
    }
  };

  const toggleBackTuoNumber = (num) => {
    if (backTuoNumbers.includes(num)) {
      setBackTuoNumbers(backTuoNumbers.filter(n => n !== num));
    } else {
      const maxBackTuoCount = backDanEnabled ? Math.min(backTuoCount, 12 - backDanNumbers.length) : Math.min(backTuoCount, 12);
      if (backTuoNumbers.length >= maxBackTuoCount) { alert(`后区拖码最多选择${maxBackTuoCount}个！`); return; }
      if (backDanEnabled && backDanNumbers.includes(num)) { alert('该号码已在后区胆码中，请先从胆码中移除！'); return; }
      setBackTuoNumbers([...backTuoNumbers, num].sort((a, b) => a - b));
    }
  };

  // 生成组合
  const handleGenerateDanTuo = () => {
    if (!danNumbers.length || !tuoNumbers.length) { alert('请选择至少1个前区胆码和1个前区拖码！'); return; }
    try {
      let result;
      if (backTuoNumbers.length > 0) {
        result = analyzer.generateDoubleDanTuo({
          frontDan: danNumbers, frontTuo: tuoNumbers,
          backDan: backDanEnabled && backDanNumbers.length > 0 ? backDanNumbers : [],
          backTuo: backTuoNumbers
        });
      } else {
        result = analyzer.generateDanTuo(danNumbers, tuoNumbers, 5);
      }
      setDantuoResult(result);
    } catch (error) { alert(`错误: ${error.message}`); }
  };

  // 复制选号
  const handleCopyDanTuoSelection = () => {
    if (!danNumbers.length || !tuoNumbers.length) { alert('请先选择前区胆码和拖码！'); return; }
    const danStr = danNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
    const tuoStr = tuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
    let copyText = `【前区】\n胆码：${danStr}\n拖码：${tuoStr}\n\n注数：${calculateDanTuoBets()}注`;
    if ((backDanEnabled && backDanNumbers.length > 0) || backTuoNumbers.length > 0) {
      const backDanStr = backDanNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
      const backTuoStr = backTuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
      copyText += `\n\n【后区】\n`;
      if (backDanEnabled && backDanNumbers.length > 0) copyText += `胆码：${backDanStr}\n`;
      if (backTuoNumbers.length > 0) copyText += `拖码：${backTuoStr}\n`;
      if (!backDanEnabled) copyText += `（纯拖模式，无胆码）\n`;
    }
    navigator.clipboard.writeText(copyText).then(() => {
      setCopyDanTuoSuccess(true);
      setTimeout(() => setCopyDanTuoSuccess(false), 2000);
    }).catch(() => alert('复制失败，请手动复制'));
  };

  // 智能推荐
  const handleRecommendDanTuo = (strategy = 'hot') => {
    setRecommendStrategy(strategy);
    const hotCold = analyzer.getHotColdNumbers(15);
    const hotNumbers = hotCold.frontHot.map(item => Number(item[0]));
    let recommendedDan, recommendedTuo, strategyName, description;
    let backDanNums = [];
    let backTuoNums = [];
    let frontDanProbInfo = [];
    let frontZoneInfo = '';
    let danCount = 4;

    try {
      const frontDanResult = FrontDanOptimizer.optimize(analyzer, danCount, strategy);
      const optimizedDan = frontDanResult.selected;
      frontDanProbInfo = frontDanResult.probabilityInfo;
      frontZoneInfo = frontDanResult.zoneInfo || '';

      if (optimizedDan.length < danCount) {
        const needCount = danCount - optimizedDan.length;
        const extraNums = (recommendedDan || hotNumbers).filter(n => !optimizedDan.includes(n)).slice(0, needCount);
        optimizedDan.push(...extraNums);
      }

      // 拖码选择 - 使用UnifiedScorer统一评分
      const allNumbers = Array.from({ length: 35 }, (_, i) => i + 1);
      const tuoCandidates = allNumbers.filter(n => !optimizedDan.includes(n));
      const maxTuo = 35 - optimizedDan.length;
      const actualTuoCount = Math.min(tuoCount, maxTuo);

      let optimizedTuo;
      try {
        // 使用统一评分器选择拖码
        const scored = UnifiedScorer.score(analyzer, 'front', strategy)
          .filter(r => !optimizedDan.includes(r.number));
        optimizedTuo = UnifiedScorer.weightedSample(scored, actualTuoCount);
        console.log('✅ 统一评分拖码选择完成');
      } catch (error) {
        console.warn('统一评分拖码选择失败，降级到简单排序:', error);
        optimizedTuo = tuoCandidates.slice(0, actualTuoCount).sort((a, b) => a - b);
      }

      recommendedDan = optimizedDan;
      recommendedTuo = optimizedTuo;
      const frontDanNote = frontDanProbInfo.slice(0, 3).map((p, idx) =>
        `${p.number.toString().padStart(2, '0')}(${idx === 0 ? '最热' : '第' + (idx + 1) + '热'})`
      ).join('、');
      description = `多维度智能评分，前区号码推荐热度：${frontDanNote}`;
    } catch (error) {
      console.warn('智能优化失败，降级:', error);
      try {
        const zoneFrequencyResult = analyzer.generateZoneFrequencyPrediction();
        recommendedDan = zoneFrequencyResult.slice(0, danCount);
        if (recommendedDan.length < danCount) recommendedDan.push(...hotNumbers.slice(0, danCount - recommendedDan.length));
        strategyName = strategy === 'hot' ? '热号策略（降级）' : strategy === 'balanced' ? '均衡策略（降级）' : '保守策略（降级）';
        description = '智能优化失败，降级到区间频率分析';
      } catch (fallbackError) {
        recommendedDan = hotNumbers.slice(0, danCount);
        strategyName = '基础策略';
        description = '降级到热号基础策略';
      }
    }

    setDanNumbers(recommendedDan);
    setTuoNumbers(recommendedTuo);

    let backRecommendationInfo = '';
    const generateBackRecommendation = (isFullDrag, danEnabled) => {
      if (!danEnabled) {
        const backTuoResult = BackTuoOptimizer.optimize(analyzer, [], backTuoCount, strategy);
        const recommendedBackTuo = backTuoResult.selected;
        setBackDanNumbers([]);
        setBackTuoNumbers(recommendedBackTuo);
        const backTuoStr = recommendedBackTuo.map(n => n.toString().padStart(2, '0')).join(' ');
        const tuoProbNote = backTuoResult.probabilityInfo.slice(0, 3).map(p => `${p.number.toString().padStart(2, '0')}(${p.probability.toFixed(1)}%)`).join('、');
        return {
          backDesc: `；后区纯拖：拖码${backTuoStr}（${recommendedBackTuo.length}个，C(${recommendedBackTuo.length},2)组合）`,
          backInfo: `推荐后区纯拖号码：${backTuoStr}。拖码概率排名：${tuoProbNote}等。从${recommendedBackTuo.length}个拖码中组合所有2码配对。`,
          recommendedBackDan: [], recommendedBackTuo
        };
      }
      const backDanResult = BackDanOptimizer.optimize(analyzer, 1, strategy);
      const recommendedBackDan = backDanResult.selected;
      let recommendedBackTuo;
      if (isFullDrag) {
        recommendedBackTuo = Array.from({ length: 12 }, (_, i) => i + 1).filter(n => !recommendedBackDan.includes(n));
      } else {
        const backTuoResult = BackTuoOptimizer.optimize(analyzer, recommendedBackDan, backTuoCount, strategy);
        recommendedBackTuo = backTuoResult.selected;
      }
      setBackDanNumbers(recommendedBackDan);
      setBackTuoNumbers(recommendedBackTuo);
      const backDanStr = recommendedBackDan.map(n => n.toString().padStart(2, '0')).join(' + ');
      const backTuoStr = recommendedBackTuo.map(n => n.toString().padStart(2, '0')).join(' ');
      const danProbNote = backDanResult.probabilityInfo.slice(0, 3).map(p => `${p.number.toString().padStart(2, '0')}(${p.probability.toFixed(1)}%)`).join('、');
      if (isFullDrag) {
        return { backDesc: `；后区一胆全拖：胆码${recommendedBackDan[0]}，拖码1-12除胆码外全部`, backInfo: `推荐后区胆码：${backDanStr}。概率排名：${danProbNote}等。其余11个号码全拖。`, recommendedBackDan, recommendedBackTuo };
      }
      return { backDesc: `；后区：胆码${backDanStr}，拖码${backTuoStr}`, backInfo: `推荐后区胆码：${backDanStr}。概率排名：${danProbNote}等。`, recommendedBackDan, recommendedBackTuo };
    };

    try {
      const backRec = generateBackRecommendation(useBackFullDrag, backDanEnabled);
      description += backRec.backDesc;
      backRecommendationInfo = backRec.backInfo;
      backDanNums = backRec.recommendedBackDan;
      backTuoNums = backRec.recommendedBackTuo;
    } catch (error) {
      console.warn('后区推荐失败:', error);
    }

    if (!backDanEnabled) {
      backRecommendationInfo += ' 当前为纯拖模式（无胆码），后区所有号码从拖码中组合。如需使用胆码，请开启后区胆码开关。';
    }

    // 生成推荐结果 + 组合质量验证
    try {
      let result;
      if (backTuoNums.length > 0) {
        result = analyzer.generateDoubleDanTuo({
          frontDan: recommendedDan, frontTuo: recommendedTuo,
          backDan: backDanEnabled && backDanNums.length > 0 ? backDanNums : [],
          backTuo: backTuoNums
        });
      } else {
        result = analyzer.generateDanTuo(recommendedDan, recommendedTuo, 5);
      }

      const frontForValidation = [...recommendedDan, ...recommendedTuo.slice(0, 5 - recommendedDan.length)];
      const backForValidation = (backDanEnabled && backDanNums.length > 0)
        ? [...backDanNums, ...backTuoNums.slice(0, 2 - backDanNums.length)]
        : backTuoNums.length >= 2 ? backTuoNums.slice(0, 2) : [];
      let validationResult = null;
      if (frontForValidation.length === 5) {
        try {
          validationResult = CombinationValidator.validate(frontForValidation, backForValidation.length >= 2 ? backForValidation : [], analyzer);
          if (validationResult && !validationResult.passed) {
            for (let retry = 0; retry < 3; retry++) {
              const adjusted = CombinationValidator.suggestAdjustment(frontForValidation, backForValidation, validationResult, analyzer);
              frontForValidation.splice(0, frontForValidation.length, ...adjusted.front);
              backForValidation.splice(0, backForValidation.length, ...adjusted.back);
              validationResult = CombinationValidator.validate(frontForValidation, backForValidation.length >= 2 ? backForValidation : [], analyzer);
              if (validationResult.passed) break;
            }
          }
        } catch (e) { console.warn('组合质量验证失败:', e); }
      }

      let confidenceResult = null;
      try { confidenceResult = ConfidenceCalculator.calculate(analyzer, validationResult, recommendedDan); } catch (e) {}

      setDantuoRecommendation({
        dan: recommendedDan, tuo: recommendedTuo,
        backDan: backDanNums, backTuo: backTuoNums,
        backRecommendationInfo, frontDanProbInfo, frontZoneInfo,
        validationResult, confidenceResult,
        strategy: strategyName, description
      });

    } catch (error) { console.error('推荐失败:', error); }
  };

  // 回测验证
  const handleDanTuoBacktest = () => {
    try {
      const result = analyzer.backtestDanTuo({
        strategy: recommendStrategy,
        danCount: danNumbers.length || 4,
        tuoCount, backDanEnabled, backTuoCount,
        backFullDrag: useBackFullDrag, backtestPeriods: 20
      });
      setDanTuoBacktestResult(result);
    } catch (error) { alert('胆拖回测验证失败: ' + error.message); }
  };

  // 一键复制
  const handleCopyDanTuo = () => {
    if (!dantuoResult || !dantuoResult.combinations.length) { alert('请先生成胆拖组合！'); return; }
    let text = `🎯 胆拖玩法 - 投注组合\n生成时间: ${dantuoResult.generatedAt}\n========================================\n\n`;
    text += `【胆拖配置】\n胆码: [${dantuoResult.danNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n拖码: [${dantuoResult.tuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n`;
    if (backTuoNumbers.length > 0) {
      if (backDanEnabled && backDanNumbers.length > 0) text += `后区胆码: [${backDanNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n`;
      text += `后区拖码: [${backTuoNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}]\n`;
      if (!backDanEnabled) text += `后区模式: 纯拖（无胆码）\n`;
    }
    text += `\n【统计信息】\n总注数: ${dantuoResult.totalBets} 注\n总费用: ${dantuoResult.cost} 元\n`;
    if (dantuoResult.danQuality) {
      text += `\n【胆码质量】\n质量评分: ${dantuoResult.danQuality.qualityScore}/100\n热号数量: ${dantuoResult.danQuality.hotDanCount}\n冷号数量: ${dantuoResult.danQuality.coldDanCount}\nAC值: ${dantuoResult.danQuality.acValue}\n奇偶比: ${dantuoResult.danQuality.oddEvenRatio}\n大小比: ${dantuoResult.danQuality.bigSmallRatio}\n`;
    }
    text += `\n【投注组合】\n`;
    dantuoResult.combinations.forEach((comb, idx) => {
      const frontStr = comb.front.map(n => n.toString().padStart(2, '0')).join(' ');
      const backStr = comb.back ? comb.back.map(n => n.toString().padStart(2, '0')).join(' ') : '';
      text += `${idx + 1}. ${frontStr}${backStr ? ' | ' + backStr : ''}\n`;
    });
    text += `\n========================================\n总计: ${dantuoResult.totalBets} 注 | ${dantuoResult.cost} 元`;
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      trackCopy('dantuo', dantuoResult.totalBets);
    }).catch(() => alert('复制失败，请手动复制'));
  };

  return (
    <section className="card dantuo-section">
      <h2>🎯 胆拖玩法</h2>

      {/* 拖码个数选择器 */}
      <div className="tuo-count-selector" style={{ marginBottom: '15px', padding: '12px', background: '#f0f4ff', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <label style={{ fontWeight: 'bold', color: '#333' }}>前区拖码个数：</label>
        <select value={tuoCount} onChange={(e) => setTuoCount(parseInt(e.target.value))} style={{ padding: '6px 12px', border: '2px solid #667eea', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold', color: '#667eea', cursor: 'pointer' }}>
          {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,22,24,25,28,30,31].map(n => (
            <option key={n} value={n}>{n}个{n === 10 ? '（推荐）' : n === 31 ? '（全覆盖）' : ''}</option>
          ))}
        </select>
        <span style={{ fontSize: '12px', color: '#444' }}>
          注数：{tuoCount > 2 ? `C(${tuoCount},2) = ${combinations(tuoCount, 2)}注` : '请选择至少3个'}
        </span>
      </div>

      {/* 后区设置栏 */}
      <div className="dantuo-option-bar" style={{ marginBottom: '15px', padding: '12px 15px', background: '#f8f0ff', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
        <label className="option-switch" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input type="checkbox" checked={backDanEnabled} onChange={(e) => { setBackDanEnabled(e.target.checked); if (!e.target.checked) { setBackDanNumbers([]); setBackSelectionMode('tuo'); } }} />
          <span className="switch-slider"></span>
          <span className="option-label">后区胆码</span>
        </label>
        <label style={{ fontWeight: 'bold', color: '#333', display: 'flex', alignItems: 'center', gap: '6px' }}>
          后区拖码个数：
          <select value={backTuoCount} onChange={(e) => setBackTuoCount(parseInt(e.target.value))} disabled={useBackFullDrag}
            style={{ padding: '4px 8px', border: `2px solid ${useBackFullDrag ? '#ccc' : '#66bb6a'}`, borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', color: useBackFullDrag ? '#999' : '#66bb6a', cursor: useBackFullDrag ? 'not-allowed' : 'pointer' }}>
            {[2,3,4,5,6,7,8,9,10,11].map(n => <option key={n} value={n}>{n}个{n === 4 ? '（推荐）' : n === 11 ? '（一胆全拖）' : ''}</option>)}
          </select>
        </label>
        {backDanEnabled && (
          <label className="option-switch" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" checked={useBackFullDrag} onChange={(e) => { setUseBackFullDrag(e.target.checked); if (e.target.checked) setBackTuoCount(11); }} />
            <span className="switch-slider"></span>
            <span className="option-label">一胆全拖</span>
          </label>
        )}
      </div>

      {/* 推荐策略 */}
      <div className="strategy-selector">
        <span className="strategy-label">推荐策略:</span>
        <span className="data-window-hint" style={{ fontSize: '0.85em', color: '#667eea', marginLeft: '10px' }}>
          统计窗口: {dataWindow > 0 ? `${dataWindow}期` : '全部'} | 智能推荐: 近30期
        </span>
        <div className="strategy-desc" style={{ fontSize: '0.82em', color: '#555', margin: '6px 0 2px 0', lineHeight: '1.6' }}>
          热号：追热号趋势 | 均衡：追均值回归 | 保守：追冷号回归
        </div>
        {['hot', 'balanced', 'conservative'].map(s => (
          <button key={s} className={`strategy-btn ${recommendStrategy === s ? 'active' : ''}`} onClick={() => handleRecommendDanTuo(s)}>
            {s === 'hot' ? '热号策略' : s === 'balanced' ? '均衡策略' : '保守策略'}
          </button>
        ))}
      </div>

      {/* 前区选择 */}
      <div className="dantuo-zone">
        <h3>前区号码 (1-35)</h3>
        <div className="number-selection">
          <div className="selection-label">
            <span className="label-text">胆码 (必选)</span>
            <span className="label-count">{danNumbers.length}/4</span>
          </div>
          <div className="selected-numbers dan-numbers">
            {danNumbers.map(num => <span key={num} className="selected-number dan" onClick={() => toggleDanNumber(num)}>{num.toString().padStart(2, '0')}</span>)}
            {danNumbers.length === 0 && <span className="placeholder">请选择1-4个胆码</span>}
          </div>
        </div>
        <div className="number-selection">
          <div className="selection-label">
            <span className="label-text">拖码 (可选)</span>
            <span className="label-count">{tuoNumbers.length}/{35 - danNumbers.length}</span>
          </div>
          <div className="selected-numbers tuo-numbers">
            {tuoNumbers.map(num => <span key={num} className="selected-number tuo" onClick={() => toggleTuoNumber(num)}>{num.toString().padStart(2, '0')}</span>)}
            {tuoNumbers.length === 0 && <span className="placeholder">请选择至少1个拖码</span>}
          </div>
        </div>
        <div className="selection-mode-toggle">
          <button className={`mode-btn ${selectionMode === 'dan' ? 'active dan-mode' : ''}`} onClick={() => setSelectionMode('dan')}>选胆码</button>
          <button className={`mode-btn ${selectionMode === 'tuo' ? 'active tuo-mode' : ''}`} onClick={() => setSelectionMode('tuo')}>选拖码</button>
        </div>
        <div className="number-picker">
          {Array.from({ length: 35 }, (_, i) => i + 1).map(num => {
            const isDan = danNumbers.includes(num);
            const isTuo = tuoNumbers.includes(num);
            return (
              <button key={num} className={`number-btn ${isDan ? 'dan-selected' : ''} ${isTuo ? 'tuo-selected' : ''}`}
                onClick={() => { if (isDan) toggleDanNumber(num); else if (isTuo) toggleTuoNumber(num); else if (selectionMode === 'dan') toggleDanNumber(num); else toggleTuoNumber(num); }}>
                {num.toString().padStart(2, '0')}
              </button>
            );
          })}
        </div>
      </div>

      {/* 后区选择 */}
      <div className="dantuo-zone back-zone back-zone-compact">
        <h3>后区号码 (1-12)</h3>
        <div className="back-zone-content">
          <div className="back-selected">
            {backDanEnabled && (
              <div className="number-selection compact">
                <div className="selection-label">
                  <span className="label-text">胆码</span>
                  <span className="label-count">{backDanNumbers.length}/1</span>
                </div>
                <div className="selected-numbers dan-numbers compact">
                  {backDanNumbers.map(num => <span key={num} className="selected-number dan small" onClick={() => toggleBackDanNumber(num)}>{num.toString().padStart(2, '0')}</span>)}
                  {backDanNumbers.length === 0 && <span className="placeholder small">未选</span>}
                </div>
              </div>
            )}
            <div className="number-selection compact">
              <div className="selection-label">
                <span className="label-text">拖码 {!backDanEnabled && <span style={{ fontSize: '0.75em', color: '#e67e22', fontWeight: 'normal' }}>(纯拖模式)</span>}</span>
                <span className="label-count">{backTuoNumbers.length}/{backDanEnabled ? (12 - backDanNumbers.length) : 12}</span>
              </div>
              <div className="selected-numbers tuo-numbers compact">
                {backTuoNumbers.map(num => <span key={num} className="selected-number tuo small" onClick={() => toggleBackTuoNumber(num)}>{num.toString().padStart(2, '0')}</span>)}
                {backTuoNumbers.length === 0 && <span className="placeholder small">未选</span>}
              </div>
            </div>
            <div className="selection-mode-toggle compact">
              {backDanEnabled && <button className={`mode-btn ${backSelectionMode === 'dan' ? 'active dan-mode' : ''}`} onClick={() => setBackSelectionMode('dan')}>胆</button>}
              <button className={`mode-btn ${backSelectionMode === 'tuo' ? 'active tuo-mode' : ''}`} onClick={() => setBackSelectionMode('tuo')}>拖</button>
            </div>
          </div>
          <div className="back-picker">
            <div className="number-picker compact">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(num => {
                const isDan = backDanEnabled && backDanNumbers.includes(num);
                const isTuo = backTuoNumbers.includes(num);
                return (
                  <button key={num} className={`number-btn ${isDan ? 'dan-selected' : ''} ${isTuo ? 'tuo-selected' : ''} compact`}
                    onClick={() => { if (isDan) toggleBackDanNumber(num); else if (isTuo) toggleBackTuoNumber(num); else if (backDanEnabled && backSelectionMode === 'dan') toggleBackDanNumber(num); else toggleBackTuoNumber(num); }}>
                    {num.toString().padStart(2, '0')}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 预览和操作按钮 */}
      <div className="dantuo-preview">
        <div className="preview-info">
          <div className="info-item"><span className="info-label">预计注数:</span><span className="info-value">{calculateDanTuoBets()} 注</span></div>
          <div className="info-item"><span className="info-label">预计费用:</span><span className="info-value cost">{calculateDanTuoBets() * 2} 元</span></div>
          {dantuoResult && dantuoResult.danQuality && (
            <div className="info-item">
              <span className="info-label">胆码质量:</span>
              <span className={`info-value quality quality-${dantuoResult.danQuality.qualityScore >= 80 ? 'high' : dantuoResult.danQuality.qualityScore >= 60 ? 'medium' : 'low'}`}>{dantuoResult.danQuality.qualityScore}/100</span>
            </div>
          )}
        </div>
        <div className="action-buttons">
          <button className="copy-selection-btn" onClick={handleCopyDanTuoSelection}
            style={{ background: copyDanTuoSuccess ? '#67c23a' : '#409eff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', marginRight: '10px' }}>
            {copyDanTuoSuccess ? '已复制' : '复制选号'}
          </button>
          <button className="generate-btn" onClick={handleGenerateDanTuo} disabled={!danNumbers.length || !tuoNumbers.length}>生成组合</button>
          <button onClick={handleDanTuoBacktest}
            style={{ background: 'linear-gradient(135deg, #17a2b8, #138496)', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', marginLeft: '10px' }}>
            回测验证
          </button>
        </div>
      </div>

      {/* 回测结果 */}
      {danTuoBacktestResult && danTuoBacktestResult.success && (
        <div style={{ marginTop: '15px', padding: '15px', background: 'linear-gradient(135deg, #e8f4f8, #d6eaf8)', borderRadius: '8px', border: '1px solid #5dade2' }}>
          <div style={{ fontWeight: 'bold', color: '#17a2b8', marginBottom: '10px' }}>
            胆拖回测结果（{danTuoBacktestResult.strategy} · {danTuoBacktestResult.backMode} · {danTuoBacktestResult.danCount}胆+{danTuoBacktestResult.tuoCount}拖）
          </div>
          <div style={{ fontSize: '0.85em', color: '#333', marginBottom: '8px' }}>{danTuoBacktestResult.summary}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px', marginBottom: '10px' }}>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
              <div style={{ fontSize: '0.75em', color: '#444' }}>前区胆码命中</div>
              <div style={{ fontWeight: 'bold', color: '#27ae60', fontSize: '1.2em' }}>{danTuoBacktestResult.avgDanHits.toFixed(2)}个/期</div>
              <div style={{ fontSize: '0.7em', color: '#555' }}>期望{danTuoBacktestResult.randomDanExpect.toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
              <div style={{ fontSize: '0.75em', color: '#444' }}>胆码命中≥1概率</div>
              <div style={{ fontWeight: 'bold', color: '#e67e22', fontSize: '1.2em' }}>{(danTuoBacktestResult.danAtLeast1Rate * 100).toFixed(1)}%</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
              <div style={{ fontSize: '0.75em', color: '#444' }}>号码池命中</div>
              <div style={{ fontWeight: 'bold', color: '#2980b9', fontSize: '1.2em' }}>{danTuoBacktestResult.avgFrontPoolHits.toFixed(2)}个/期</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
              <div style={{ fontSize: '0.75em', color: '#444' }}>后区命中</div>
              <div style={{ fontWeight: 'bold', color: '#27ae60', fontSize: '1.2em' }}>{danTuoBacktestResult.avgBackHits.toFixed(2)}个/期</div>
              <div style={{ fontSize: '0.7em', color: '#555' }}>期望{danTuoBacktestResult.randomBackExpect.toFixed(2)}</div>
            </div>
          </div>
          <div style={{ fontSize: '0.8em', color: '#444', marginBottom: '4px' }}>最近5期回测明细:</div>
          {danTuoBacktestResult.details.slice(-5).reverse().map((detail, idx) => (
            <div key={idx} style={{ padding: '6px 8px', borderBottom: '1px solid #ddd', fontSize: '0.75em', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>第{detail.periodIndex}期: 开奖 [{detail.actualDraw.front.join(' ')} + {detail.actualDraw.back.join(' ')}]</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: detail.frontDanHits > 0 ? '#27ae60' : '#999' }}>胆码命中{detail.frontDanHits}/{danTuoBacktestResult.danCount}</span>
                <span style={{ color: detail.frontAllHits > 2 ? '#27ae60' : '#e67e22' }}>号码池命中{detail.frontAllHits}/{danTuoBacktestResult.danCount + danTuoBacktestResult.tuoCount}</span>
                <span style={{ color: detail.backAllHits > 0 ? '#27ae60' : '#999' }}>后区命中{detail.backAllHits}/2</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 推荐结果 */}
      {dantuoRecommendation && (
        <div className="recommendation-tip">
          <div className="tip-header">
            <span className="tip-icon">💡</span>
            <span className="tip-title">{dantuoRecommendation.strategy}</span>
          </div>
          <p className="tip-description">{dantuoRecommendation.description}</p>
          <div className="tip-numbers"><span>前区胆码: </span><strong>{dantuoRecommendation.dan.map(n => n.toString().padStart(2, '0')).join(', ')}</strong></div>
          {dantuoRecommendation.frontDanProbInfo && dantuoRecommendation.frontDanProbInfo.length > 0 && (
            <div className="back-recommendation">
              <div className="back-rec-header"><span className="back-rec-icon"></span><span className="back-rec-title">前区推荐</span></div>
              <p className="back-rec-info">
                推荐前区胆码：{dantuoRecommendation.dan.map(n => n.toString().padStart(2, '0')).join('、')}（多维度智能评分）。前区各号码推荐热度排名：{dantuoRecommendation.frontDanProbInfo.map((p, idx) => `${p.number.toString().padStart(2, '0')}(${idx === 0 ? '最热' : '第' + (idx + 1) + '热'})`).join('、')}。
              </p>
            </div>
          )}
          {dantuoRecommendation.frontZoneInfo && (
            <div className="back-recommendation">
              <div className="back-rec-header"><span className="back-rec-icon"></span><span className="back-rec-title">区间频率</span></div>
              <p className="back-rec-info">{dantuoRecommendation.frontZoneInfo}。热区间号码出现概率更高，冷区间号码具有回归潜力，均衡搭配可提高覆盖面。</p>
            </div>
          )}
          {dantuoRecommendation.backDan && dantuoRecommendation.backDan.length > 0 && (
            <div className="tip-numbers"><span>后区胆码: </span><strong>{dantuoRecommendation.backDan.map(n => n.toString().padStart(2, '0')).join(', ')}</strong></div>
          )}
          {dantuoRecommendation.backRecommendationInfo && (
            <div className="back-recommendation">
              <div className="back-rec-header"><span className="back-rec-icon"></span><span className="back-rec-title">后区推荐</span></div>
              <p className="back-rec-info">{dantuoRecommendation.backRecommendationInfo}</p>
            </div>
          )}
          {dantuoRecommendation.validationResult && (
            <div className="back-recommendation">
              <div className="back-rec-header"><span className="back-rec-icon"></span><span className="back-rec-title">组合质量</span></div>
              <p className="back-rec-info">
                {dantuoRecommendation.validationResult.passed
                  ? `组合评分：${dantuoRecommendation.validationResult.score}分 通过。和值${dantuoRecommendation.validationResult.details.frontSum}，AC值${dantuoRecommendation.validationResult.details.acValue}，奇偶比${dantuoRecommendation.validationResult.details.oddEvenRatio}，区间覆盖${dantuoRecommendation.validationResult.details.zoneCoverage}个。`
                  : `组合评分：${dantuoRecommendation.validationResult.score}分。${dantuoRecommendation.validationResult.issues.join('；')}。`
                }
              </p>
            </div>
          )}
          {dantuoRecommendation.confidenceResult && (
            <div className="back-recommendation">
              <div className="back-rec-header"><span className="back-rec-icon"></span><span className="back-rec-title">推荐置信度</span></div>
              <p className="back-rec-info">{ConfidenceCalculator.generateDescription(dantuoRecommendation.confidenceResult)}</p>
            </div>
          )}
        </div>
      )}

      {/* 生成结果 */}
      {dantuoResult && (
        <div className="dantuo-result">
          <div className="result-header">
            <h3>生成结果</h3>
            <span className="result-summary">共 {dantuoResult.totalBets} 注 | 费用 {dantuoResult.cost} 元</span>
          </div>
          {dantuoResult.danQuality && (
            <div className="quality-details">
              <div className="quality-item"><span>热号数量:</span><span>{dantuoResult.danQuality.hotDanCount}</span></div>
              <div className="quality-item"><span>冷号数量:</span><span>{dantuoResult.danQuality.coldDanCount}</span></div>
              <div className="quality-item"><span>AC值:</span><span>{dantuoResult.danQuality.acValue}</span></div>
              <div className="quality-item"><span>奇偶比:</span><span>{dantuoResult.danQuality.oddEvenRatio}</span></div>
              <div className="quality-item"><span>大小比:</span><span>{dantuoResult.danQuality.bigSmallRatio}</span></div>
            </div>
          )}
          <div className="combinations-list">
            {dantuoResult.combinations.slice(0, 20).map((comb, idx) => (
              <div key={idx} className="combination-item">
                <span className="combo-index">{idx + 1}.</span>
                <span className="combo-front">{comb.front.map(n => n.toString().padStart(2, '0')).join(' ')}</span>
                {comb.back && comb.back.length > 0 && <span className="combo-back">| {comb.back.map(n => n.toString().padStart(2, '0')).join(' ')}</span>}
              </div>
            ))}
            {dantuoResult.totalBets > 20 && <div className="more-hint">... 还有 {dantuoResult.totalBets - 20} 注未显示</div>}
          </div>
          <div className="copy-section">
            <button className="copy-btn" onClick={handleCopyDanTuo}>{copySuccess ? '已复制' : '一键复制'}</button>
            <p className="copy-hint">复制后可粘贴到微信、QQ等聊天工具</p>
          </div>
        </div>
      )}
    </section>
  );
}
