/**
 * 复式玩法组件
 * 从App.jsx提取，包含杀号分析、套餐选择、自动选号、生成组合等功能
 * 参数精简：杀号参数移入可折叠"高级设置"，默认"混合-交集"模式
 */
import { useState } from 'react';
import { CONFIG } from '../utils/core/Config.js';
import { NumberEliminator } from '../utils/optimization/NumberEliminator.js';
import { UnifiedScorer } from '../utils/optimization/UnifiedScorer.js';
import { FushiSelector } from '../utils/optimization/FushiSelector.js';

export default function FushiPlay({ analyzer }) {
  // 状态
  const [eliminationResult, setEliminationResult] = useState(null);
  const [fushiResult, setFushiResult] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [fushiFrontSelected, setFushiFrontSelected] = useState([]);
  const [fushiBackSelected, setFushiBackSelected] = useState([]);
  const [eliminationOptions, setEliminationOptions] = useState({
    recentPeriods: 30, overheatCount: 6, backOverheatCount: 6,
    consecutiveThreshold: 3, backConsecutiveThreshold: 2,
    mode: 'mixed_intersect'
  });
  const [structuralOptions, setStructuralOptions] = useState({
    zoneBreakEnabled: true, sumMin: 65, sumMax: 115,
    tailKillEnabled: true
  });
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [backtestResult, setBacktestResult] = useState(null);
  const [fushiBacktestResult, setFushiBacktestResult] = useState(null);
  const [fushiBacktestLoading, setFushiBacktestLoading] = useState(false);
  const [fushiBtPlanKey, setFushiBtPlanKey] = useState('10+5');
  const [fushiBtPeriods, setFushiBtPeriods] = useState(50);
  const [recommendResult, setRecommendResult] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  // 手动杀号状态
  const [manualFrontKill, setManualFrontKill] = useState([]);
  const [manualBackKill, setManualBackKill] = useState([]);

  // 有效剩余号码 = 全部号码 - 算法杀号(如果执行了) - 手动杀号
  // 不依赖算法杀号，用户可直接手动杀号
  const allFront = Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1);
  const allBack = Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1);
  const algoFrontKilled = eliminationResult ? eliminationResult.frontEliminated : [];
  const algoBackKilled = eliminationResult ? eliminationResult.backEliminated : [];
  const effectiveFrontRemaining = allFront.filter(n => !algoFrontKilled.includes(n) && !manualFrontKill.includes(n));
  const effectiveBackRemaining = allBack.filter(n => !algoBackKilled.includes(n) && !manualBackKill.includes(n));

  // 手动杀号切换
  const toggleManualFrontKill = (num) => {
    setManualFrontKill(prev => prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num]);
    if (selectedPlan) { setFushiResult(null); setSelectedPlan(null); setFushiFrontSelected([]); setFushiBackSelected([]); }
  };
  const toggleManualBackKill = (num) => {
    setManualBackKill(prev => prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num]);
    if (selectedPlan) { setFushiResult(null); setSelectedPlan(null); setFushiFrontSelected([]); setFushiBackSelected([]); }
  };
  const clearManualKill = () => {
    setManualFrontKill([]);
    setManualBackKill([]);
    if (selectedPlan) { setFushiResult(null); setSelectedPlan(null); setFushiFrontSelected([]); setFushiBackSelected([]); }
  };

  // 杀号分析
  const handleEliminateNumbers = () => {
    try {
      const result = analyzer.eliminateNumbers({
        ...eliminationOptions,
        backOverheatCount: eliminationOptions.backOverheatCount || 6,
        backConsecutiveThreshold: eliminationOptions.backConsecutiveThreshold || 2
      });
      setEliminationResult(result);
      resetSelection();
    } catch (error) { alert('杀号分析失败: ' + error.message); }
  };

  const handleStructuralEliminate = () => {
    try {
      const result = analyzer.structuralEliminate(structuralOptions);
      setEliminationResult(result);
      resetSelection();
    } catch (error) { alert('结构杀号分析失败: ' + error.message); }
  };

  const handleMixedEliminate = () => {
    try {
      const result = analyzer.mixedEliminateNumbers({
        basicOptions: { ...eliminationOptions, backOverheatCount: eliminationOptions.backOverheatCount || 6, backConsecutiveThreshold: eliminationOptions.backConsecutiveThreshold || 2 },
        structuralOptions
      });
      setEliminationResult(result);
      resetSelection();
    } catch (error) { alert('混合杀号分析失败: ' + error.message); }
  };

  const resetSelection = () => {
    setFushiResult(null);
    setSelectedPlan(null);
    setFushiFrontSelected([]);
    setFushiBackSelected([]);
    setManualFrontKill([]);
    setManualBackKill([]);
  };

  const handleBacktest = (mode) => {
    try {
      const result = analyzer.backtestEliminate({
        mode,
        basicOptions: { ...eliminationOptions, backOverheatCount: eliminationOptions.backOverheatCount || 6, backConsecutiveThreshold: eliminationOptions.backConsecutiveThreshold || 2 },
        structuralOptions, backtestPeriods: 20
      });
      setBacktestResult(result);
    } catch (error) { alert('回测验证失败: ' + error.message); }
  };

  // 选号命中率端到端回测（杀号+选号→对比开奖号）
  // 固定用 mixed_intersect 模式（交集，误杀最少），与 currentMode 解耦
  const handleFushiBacktest = (planKey) => {
    const key = planKey || fushiBtPlanKey;
    setFushiBacktestLoading(true);
    const plan = NumberEliminator.FUSHI_PLANS.find(p => p.key === key) || NumberEliminator.FUSHI_PLANS[0];
    // setTimeout 让 loading 状态先渲染（回测需重建多期 analyzer，较耗时）
    setTimeout(() => {
      try {
        const result = analyzer.backtestFushiSelect({
          plan,
          mode: 'mixed_intersect',
          strategy: 'balanced',
          basicOptions: { ...eliminationOptions, backOverheatCount: eliminationOptions.backOverheatCount || 6, backConsecutiveThreshold: eliminationOptions.backConsecutiveThreshold || 2 },
          structuralOptions,
          backtestPeriods: fushiBtPeriods
        });
        setFushiBacktestResult(result);
      } catch (error) { alert('选号命中率回测失败: ' + error.message); }
      finally { setFushiBacktestLoading(false); }
    }, 50);
  };

  const handleRecommendMode = () => {
    try {
      const result = analyzer.recommendEliminationMode();
      setRecommendResult(result);
      setEliminationOptions({ ...eliminationOptions, mode: result.recommendedMode });
      if (selectedPlan) resetSelection();
    } catch (error) { alert('智能推荐失败: ' + error.message); }
  };

  const handleExecuteEliminate = () => {
    const mode = eliminationOptions.mode || 'basic';
    switch (mode) {
      case 'basic': handleEliminateNumbers(); break;
      case 'structural': handleStructuralEliminate(); break;
      case 'mixed_intersect': handleMixedEliminate(); break;
      default: handleEliminateNumbers(); break;
    }
  };

  // 套餐选择 - 使用FushiSelector群体组合优化选号
  const handleSelectPlan = (plan) => {
    if (effectiveFrontRemaining.length < plan.frontPool) {
      alert(`前区有效剩余号码不足：套餐需要${plan.frontPool}个，仅有${effectiveFrontRemaining.length}个（请减少杀号数量）。`);
      return;
    }
    if (effectiveBackRemaining.length < plan.backPool) {
      alert(`后区有效剩余号码不足：套餐需要${plan.backPool}个，仅有${effectiveBackRemaining.length}个（请减少杀号数量）。`);
      return;
    }
    setSelectedPlan(plan);
    setFushiResult(null);

    // 使用FushiSelector群体组合优化选号（个体分40%+结构分60%）
    try {
      const result = FushiSelector.select(analyzer, effectiveFrontRemaining, effectiveBackRemaining, plan, 'balanced');
      setFushiFrontSelected(result.frontSelected);
      setFushiBackSelected(result.backSelected);
    } catch (error) {
      console.warn('FushiSelector选号失败，降级到UnifiedScorer:', error);
      try {
        const frontScored = UnifiedScorer.score(analyzer, 'front', 'balanced')
          .filter(r => effectiveFrontRemaining.includes(r.number));
        const frontSelected = frontScored.slice(0, plan.frontPool).map(r => r.number).sort((a, b) => a - b);
        const backScored = UnifiedScorer.score(analyzer, 'back', 'balanced')
          .filter(r => effectiveBackRemaining.includes(r.number));
        const backSelected = backScored.slice(0, plan.backPool).map(r => r.number).sort((a, b) => a - b);
        setFushiFrontSelected(frontSelected);
        setFushiBackSelected(backSelected);
      } catch (err2) {
        const autoResult = NumberEliminator.autoSelect(analyzer, effectiveFrontRemaining, effectiveBackRemaining, plan);
        setFushiFrontSelected(autoResult.frontSelected);
        setFushiBackSelected(autoResult.backSelected);
      }
    }
  };

  const handleGenerateFushi = () => {
    try {
      const result = analyzer.generateFushiCombinations(fushiFrontSelected, fushiBackSelected);
      setFushiResult(result);
    } catch (error) { alert('复式组合生成失败: ' + error.message); }
  };

  const handleCopyFushi = () => {
    if (!fushiResult) { alert('请先生成复式组合！'); return; }
    const frontStr = fushiResult.frontPool.map(n => n.toString().padStart(2, '0')).join(', ');
    const backStr = fushiResult.backPool.map(n => n.toString().padStart(2, '0')).join(', ');
    let text = `【前区复式】\n号码：${frontStr}\n选号方式：${fushiResult.frontPool.length}个选${fushiResult.frontCount}\n\n`;
    text += `【后区复式】\n号码：${backStr}\n选号方式：${fushiResult.backPool.length}个选${fushiResult.backCount}\n\n`;
    text += `注数：${fushiResult.totalBets}注\n费用：${fushiResult.cost}元`;
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(() => alert('复制失败，请手动复制'));
  };

  const modeNames = { basic: '基础', structural: '结构', mixed_intersect: '混合交集' };
  const modeColors = { basic: '#e74c3c', structural: '#2e7d32', mixed_intersect: '#2980b9' };
  const currentMode = eliminationOptions.mode || 'mixed_intersect';

  return (
    <section className="card fushi-section">
      <h2>📋 复式玩法 - 杀号+小型套餐</h2>
      <p style={{ fontSize: '0.85em', color: '#333', marginBottom: '10px' }}>
        先杀掉过热号码，再从剩余号码中选一个小型套餐自动填充最优号码，生成所有复式组合。
      </p>

      {/* 杀号模式选择 */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ padding: '8px 12px', background: 'linear-gradient(135deg, #e8f5e9, #c8e6c9)', border: '2px solid #4caf50', borderRadius: '8px', marginBottom: '10px', fontSize: '0.85em', color: '#2e7d32' }}>
          <strong>回测推荐：</strong>混合-交集模式（双重验证）表现最优，前区命中率86%、后区95%，误杀最少
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
          {[
            { key: 'basic', label: '基础杀号', desc: '3种统计算法' },
            { key: 'structural', label: '结构杀号', desc: '3种规律算法' },
            { key: 'mixed_intersect', label: '混合-交集', desc: '6种联合双重验证' }
          ].map(m => (
            <button key={m.key} onClick={() => { setEliminationOptions({ ...eliminationOptions, mode: m.key }); if (selectedPlan) resetSelection(); }}
              style={{
                flex: '1 1 0', minWidth: '120px', padding: '8px 6px', borderRadius: '8px',
                border: currentMode === m.key ? `2px solid ${modeColors[m.key]}` : '1px solid #ccc',
                background: currentMode === m.key ? `${modeColors[m.key]}22` : '#f9f9f9',
                color: currentMode === m.key ? modeColors[m.key] : '#333',
                cursor: 'pointer', fontWeight: currentMode === m.key ? 'bold' : 'normal',
                transition: 'all 0.2s', fontSize: '0.85em', textAlign: 'center'
              }}>
              {m.label}<br />
              <span style={{ fontSize: '0.75em', opacity: 0.9, color: '#555' }}>{m.desc}</span>
            </button>
          ))}
        </div>
        <button onClick={handleRecommendMode}
          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #f39c12', background: 'linear-gradient(135deg, #fff8e1, #fff3cd)', color: '#e67e22', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85em' }}>
          智能推荐模式（根据当前数据特征自动选择最优杀号方式）
        </button>
        {recommendResult && (
          <div style={{ marginTop: '8px', padding: '10px', background: '#fff3cd', borderRadius: '6px', border: '1px solid #f39c12', fontSize: '0.85em' }}>
            <div style={{ fontWeight: 'bold', color: '#e67e22' }}>推荐结果: {recommendResult.modeNames[recommendResult.recommendedMode]}</div>
            <div style={{ color: '#444', marginTop: '4px' }}>{recommendResult.reason}</div>
          </div>
        )}
      </div>

      {/* 高级设置 - 可折叠 */}
      <div style={{ marginBottom: '15px' }}>
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #aaa', background: '#f5f5f5', color: '#555', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85em', width: '100%' }}>
          {showAdvanced ? '收起高级设置' : '展开高级设置（杀号参数配置）'}
        </button>
        {showAdvanced && (
          <div className="elimination-options" style={{ marginTop: '8px', padding: '12px', background: '#fff8f0', borderRadius: '8px', border: '1px solid #ffecd2', color: '#333' }}>
            <div style={{ fontWeight: 'bold', color: '#e67e22', marginBottom: '8px' }}>杀号参数配置</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.85em' }}>近N期过热检测: </label>
                <select value={eliminationOptions.recentPeriods} onChange={(e) => setEliminationOptions({ ...eliminationOptions, recentPeriods: parseInt(e.target.value) })} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {[3, 5, 8, 10, 20, 30, 50].map(n => <option key={n} value={n}>{n}期{n === 30 ? '（推荐）' : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85em' }}>前区过热次数: </label>
                <select value={eliminationOptions.overheatCount} onChange={(e) => setEliminationOptions({ ...eliminationOptions, overheatCount: parseInt(e.target.value) })} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {[2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>≥{n}次{n === 6 ? '（推荐）' : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85em' }}>后区过热次数: </label>
                <select value={eliminationOptions.backOverheatCount} onChange={(e) => setEliminationOptions({ ...eliminationOptions, backOverheatCount: parseInt(e.target.value) })} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {[2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>≥{n}次{n === 6 ? '（推荐）' : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85em' }}>前区连续出现: </label>
                <select value={eliminationOptions.consecutiveThreshold} onChange={(e) => setEliminationOptions({ ...eliminationOptions, consecutiveThreshold: parseInt(e.target.value) })} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {[2, 3, 4].map(n => <option key={n} value={n}>≥{n}期{n === 3 ? '（推荐）' : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85em' }}>后区连续出现: </label>
                <select value={eliminationOptions.backConsecutiveThreshold} onChange={(e) => setEliminationOptions({ ...eliminationOptions, backConsecutiveThreshold: parseInt(e.target.value) })} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {[2, 3].map(n => <option key={n} value={n}>≥{n}期{n === 2 ? '（推荐）' : ''}</option>)}
                </select>
              </div>
            </div>
            {eliminationOptions.mode === 'structural' && (
              <div style={{ marginTop: '10px', padding: '10px', background: '#f0fff4', borderRadius: '6px', border: '1px solid #c6f6d5' }}>
                <div style={{ fontWeight: 'bold', color: '#2e7d32', marginBottom: '8px' }}>结构杀号参数</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.85em' }}>断区杀号: </label>
                    <select value={structuralOptions.zoneBreakEnabled} onChange={(e) => setStructuralOptions({ ...structuralOptions, zoneBreakEnabled: e.target.value === 'true' })} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                      <option value="true">启用</option>
                      <option value="false">禁用</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.85em' }}>和值范围: </label>
                    <select value={`${structuralOptions.sumMin}-${structuralOptions.sumMax}`} onChange={(e) => { const [min, max] = e.target.value.split('-').map(Number); setStructuralOptions({ ...structuralOptions, sumMin: min, sumMax: max }); }} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                      <option value="60-120">60-120（宽松）</option>
                      <option value="65-115">65-115（推荐）</option>
                      <option value="70-110">70-110（严格）</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.85em' }}>重号杀号数: </label>
                    <select value={structuralOptions.repeatKillCount} onChange={(e) => setStructuralOptions({ ...structuralOptions, repeatKillCount: parseInt(e.target.value) })} style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                      {[2, 3, 4].map(n => <option key={n} value={n}>杀{n}个{n === 3 ? '（推荐）' : ''}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 执行杀号 + 回测 */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        <button onClick={handleExecuteEliminate}
          style={{ flex: 1, background: `linear-gradient(135deg, ${modeColors[currentMode]}, ${modeColors[currentMode]}dd)`, color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
          执行{modeNames[currentMode]}杀号分析
        </button>
        <button onClick={() => handleBacktest(currentMode)}
          style={{ flex: '0 0 100px', background: 'linear-gradient(135deg, #17a2b8, #138496)', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
          杀号回测
        </button>
        <div style={{ flex: '0 0 150px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', gap: '3px' }}>
            {['8+3', '10+5', '15+5'].map(k => (
              <button key={k} onClick={() => setFushiBtPlanKey(k)} disabled={fushiBacktestLoading}
                style={{ flex: 1, padding: '4px', fontSize: '11px', borderRadius: '4px', border: fushiBtPlanKey === k ? '2px solid #5a4bd1' : '1px solid #ccc', background: fushiBtPlanKey === k ? '#6c5ce7' : '#fff', color: fushiBtPlanKey === k ? '#fff' : '#5a4bd1', cursor: 'pointer', fontWeight: 'bold' }}>
                {k}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '3px' }}>
            {[20, 50, 100].map(p => (
              <button key={p} onClick={() => setFushiBtPeriods(p)} disabled={fushiBacktestLoading}
                style={{ flex: 1, padding: '4px', fontSize: '11px', borderRadius: '4px', border: fushiBtPeriods === p ? '2px solid #5a4bd1' : '1px solid #ccc', background: fushiBtPeriods === p ? '#6c5ce7' : '#fff', color: fushiBtPeriods === p ? '#fff' : '#5a4bd1', cursor: 'pointer', fontWeight: 'bold' }}>
                {p}期
              </button>
            ))}
          </div>
          <button onClick={() => handleFushiBacktest()} disabled={fushiBacktestLoading}
            style={{ background: 'linear-gradient(135deg, #6c5ce7, #5a4bd1)', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', cursor: fushiBacktestLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '13px', opacity: fushiBacktestLoading ? 0.7 : 1 }}>
            {fushiBacktestLoading ? '回测中...' : `选号命中率回测(${fushiBtPlanKey},${fushiBtPeriods}期)`}
          </button>
        </div>
      </div>

      {/* 回测结果 */}
      {backtestResult && backtestResult.success && (
        <div style={{ marginTop: '15px', padding: '15px', background: 'linear-gradient(135deg, #e8f4f8, #d6eaf8)', borderRadius: '8px', border: '1px solid #5dade2' }}>
          <div style={{ fontWeight: 'bold', color: '#17a2b8', marginBottom: '10px' }}>回测验证结果（{backtestResult.modeName}）</div>
          <div style={{ fontSize: '0.85em', color: '#333', marginBottom: '8px' }}>{backtestResult.summary}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>前区命中率</div>
              <div style={{ fontWeight: 'bold', color: '#27ae60', fontSize: '1.3em' }}>{(backtestResult.frontAccuracy * 100).toFixed(1)}%</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>后区命中率</div>
              <div style={{ fontWeight: 'bold', color: '#27ae60', fontSize: '1.3em' }}>{(backtestResult.backAccuracy * 100).toFixed(1)}%</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>前区误杀</div>
              <div style={{ fontWeight: 'bold', color: '#e74c3c', fontSize: '1.1em' }}>{backtestResult.avgFrontWrongKill.toFixed(1)}个/期</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>回测期数</div>
              <div style={{ fontWeight: 'bold', color: '#17a2b8', fontSize: '1.1em' }}>{backtestResult.totalPeriods}期</div>
            </div>
          </div>
          <div style={{ fontSize: '0.8em', color: '#333', marginBottom: '4px' }}>最近5期回测明细:</div>
          {backtestResult.details.slice(-5).reverse().map((detail, idx) => (
            <div key={idx} style={{ padding: '6px 8px', borderBottom: '1px solid #ccc', fontSize: '0.75em', display: 'flex', justifyContent: 'space-between' }}>
              <div>第{detail.periodIndex}期: 开奖 [{detail.nextDraw.front.join(' ')} + {detail.nextDraw.back.join(' ')}]</div>
              <div style={{ color: detail.frontWrongKill > 0 ? '#e74c3c' : '#27ae60' }}>
                保留命中{detail.frontCorrectKeep}/5 + 误杀{detail.frontWrongKill}个 | 前区命中{(detail.frontAccuracy * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 选号命中率回测结果（端到端：杀号+选号→对比开奖号） */}
      {fushiBacktestResult && fushiBacktestResult.success && (
        <div style={{ marginTop: '15px', padding: '15px', background: 'linear-gradient(135deg, #ede7f6, #d1c4e9)', borderRadius: '8px', border: '1px solid #6c5ce7' }}>
          <div style={{ fontWeight: 'bold', color: '#5a4bd1', marginBottom: '10px' }}>选号命中率回测（{fushiBacktestResult.plan.key}套餐 · 端到端）</div>
          <div style={{ fontSize: '0.85em', color: '#333', marginBottom: '8px' }}>{fushiBacktestResult.summary}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>前区池命中</div>
              <div style={{ fontWeight: 'bold', color: '#27ae60', fontSize: '1.3em' }}>{fushiBacktestResult.avgFrontHits.toFixed(2)}/5</div>
              <div style={{ fontSize: '0.7em', color: '#888' }}>随机{fushiBacktestResult.randomFrontExpect.toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>后区池命中</div>
              <div style={{ fontWeight: 'bold', color: '#27ae60', fontSize: '1.3em' }}>{fushiBacktestResult.avgBackHits.toFixed(2)}/2</div>
              <div style={{ fontSize: '0.7em', color: '#888' }}>随机{fushiBacktestResult.randomBackExpect.toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>前区全中率</div>
              <div style={{ fontWeight: 'bold', color: '#6c5ce7', fontSize: '1.3em' }}>{(fushiBacktestResult.frontAllHitRate * 100).toFixed(1)}%</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>后区全中率</div>
              <div style={{ fontWeight: 'bold', color: '#6c5ce7', fontSize: '1.3em' }}>{(fushiBacktestResult.backAllHitRate * 100).toFixed(1)}%</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '0.8em' }}>前区误杀</div>
              <div style={{ fontWeight: 'bold', color: '#e74c3c', fontSize: '1.1em' }}>{fushiBacktestResult.avgFrontWrongKill.toFixed(2)}个/期</div>
            </div>
          </div>
          <div style={{ fontSize: '0.8em', color: '#333', marginBottom: '4px' }}>最近5期明细（开奖号 vs 选号池命中）:</div>
          {fushiBacktestResult.details.slice(-5).reverse().map((detail, idx) => (
            <div key={idx} style={{ padding: '6px 8px', borderBottom: '1px solid #ccc', fontSize: '0.75em', display: 'flex', justifyContent: 'space-between' }}>
              <div>第{detail.periodIndex}期: 开奖 [{detail.actualDraw.front.join(' ')} + {detail.actualDraw.back.join(' ')}]</div>
              <div style={{ color: detail.frontHits >= 4 ? '#27ae60' : detail.frontHits >= 3 ? '#f39c12' : '#e74c3c' }}>
                前区{detail.frontHits}/5 后区{detail.backHits}/2
              </div>
            </div>
          ))}
          <div style={{ fontSize: '0.75em', color: '#666', marginTop: '6px' }}>说明：前区池命中=开奖5个号中有几个落在选号池内；全中率=5个全在池内的期数占比。对比"随机"基线可看出算法增益。</div>
        </div>
      )}

      {/* 手动杀号（独立，不依赖算法杀号，可直接操作） */}
      <div style={{ marginTop: '12px', padding: '10px', background: '#fff0f0', borderRadius: '8px', border: '1px solid #ffcccc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ fontWeight: 'bold', color: '#c0392b' }}>✋ 手动杀号（点击号码添加/取消，无需先执行算法杀号）</div>
          {(manualFrontKill.length > 0 || manualBackKill.length > 0) && (
            <button onClick={clearManualKill}
              style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c', cursor: 'pointer', fontSize: '0.8em' }}>
              清空手动杀号
            </button>
          )}
        </div>
        <p style={{ fontSize: '0.8em', color: '#555', marginBottom: '8px' }}>直接选择要杀掉的号码，算法推荐时自动排除。有效剩余：前区{effectiveFrontRemaining.length}个 / 后区{effectiveBackRemaining.length}个</p>

        {/* 前区手动杀号 - 显示全部35个号 */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '0.85em', marginBottom: '4px', color: '#e74c3c' }}>前区(红) — 已手动杀{manualFrontKill.length}个{algoFrontKilled.length > 0 && `，算法杀${algoFrontKilled.length}个（灰色不可点）`}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {allFront.map(num => {
              const isManualKilled = manualFrontKill.includes(num);
              const isAlgoKilled = algoFrontKilled.includes(num);
              return (
                <button key={num} onClick={() => !isAlgoKilled && toggleManualFrontKill(num)} disabled={isAlgoKilled}
                  style={{ width: '32px', height: '32px', borderRadius: '6px', border: isManualKilled ? '2px solid #e74c3c' : isAlgoKilled ? '1px solid #bbb' : '1px solid #ddd', background: isManualKilled ? 'rgba(231,76,60,0.25)' : isAlgoKilled ? '#e0e0e0' : '#fff', color: isManualKilled ? '#e74c3c' : isAlgoKilled ? '#888' : '#333', fontSize: '0.8em', fontWeight: isManualKilled ? 'bold' : 'normal', cursor: isAlgoKilled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', textDecoration: isAlgoKilled ? 'line-through' : 'none' }}>
                  {num.toString().padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </div>

        {/* 后区手动杀号 - 显示全部12个号 */}
        <div>
          <div style={{ fontSize: '0.85em', marginBottom: '4px', color: '#3498db' }}>后区(蓝) — 已手动杀{manualBackKill.length}个{algoBackKilled.length > 0 && `，算法杀${algoBackKilled.length}个（灰色不可点）`}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {allBack.map(num => {
              const isManualKilled = manualBackKill.includes(num);
              const isAlgoKilled = algoBackKilled.includes(num);
              return (
                <button key={num} onClick={() => !isAlgoKilled && toggleManualBackKill(num)} disabled={isAlgoKilled}
                  style={{ width: '32px', height: '32px', borderRadius: '6px', border: isManualKilled ? '2px solid #e74c3c' : isAlgoKilled ? '1px solid #bbb' : '1px solid #ddd', background: isManualKilled ? 'rgba(231,76,60,0.25)' : isAlgoKilled ? '#e0e0e0' : '#fff', color: isManualKilled ? '#e74c3c' : isAlgoKilled ? '#888' : '#333', fontSize: '0.8em', fontWeight: isManualKilled ? 'bold' : 'normal', cursor: isAlgoKilled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', textDecoration: isAlgoKilled ? 'line-through' : 'none' }}>
                  {num.toString().padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 杀号结果 */}
      {(effectiveFrontRemaining.length > 0 || eliminationResult) && (
        <div className="elimination-result">
          {eliminationResult && (
            <>
          <div className="elimination-summary" style={{ padding: '10px', background: '#e3f2fd', borderRadius: '6px', marginBottom: '12px', fontSize: '0.9em', fontWeight: '500', color: '#333' }}>
            {eliminationResult.summary}
          </div>

          {/* 杀号算法详情 */}
          <div className="elimination-algorithms">
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>杀号算法详情（共{eliminationResult.algorithmDetails.length}种）</div>
            {eliminationResult.algorithmDetails.map((algo, idx) => (
              <div key={idx} style={{ padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: '0.85em' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><strong>{algo.source ? `[${algo.source}] ` : ''}{algo.name}</strong><span style={{ color: '#555', marginLeft: '6px', fontSize: '0.8em' }}>{algo.description}</span></div>
                  <div style={{ color: '#e74c3c', whiteSpace: 'nowrap' }}>前区{algo.frontCount}个 / 后区{algo.backCount}个</div>
                </div>
                {algo.frontNumbers && algo.frontNumbers.length > 0 && <div style={{ marginTop: '4px', fontSize: '0.8em', color: '#c0392b' }}>前区杀号: {algo.frontNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}</div>}
                {algo.backNumbers && algo.backNumbers.length > 0 && <div style={{ marginTop: '2px', fontSize: '0.8em', color: '#2980b9' }}>后区杀号: {algo.backNumbers.map(n => n.toString().padStart(2, '0')).join(', ')}</div>}
              </div>
            ))}
          </div>

          {/* 号码全景图 */}
          <div className="elimination-numbers" style={{ marginTop: '12px' }}>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '0.9em' }}>前区号码 (1-35) — 杀号结果</div>
              <div className="fushi-number-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {Array.from({ length: CONFIG.FRONT_RANGE }, (_, i) => i + 1).map(num => {
                  const isEliminated = eliminationResult.frontEliminated.includes(num);
                  return (
                    <button key={num} className={`fushi-number-btn ${isEliminated ? 'eliminated' : ''}`}
                      style={{ width: '36px', height: '36px', borderRadius: '6px', border: isEliminated ? '2px solid #e74c3c' : '1px solid #ddd', background: isEliminated ? 'rgba(231,76,60,0.15)' : '#fff', color: isEliminated ? '#e74c3c' : '#333', fontSize: '0.85em', fontWeight: isEliminated ? 'bold' : 'normal', textDecoration: isEliminated ? 'line-through' : 'none', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title={isEliminated ? `杀号原因: ${(eliminationResult.reasons[num] || []).join('、')}` : '保留号码'}>
                      {num.toString().padStart(2, '0')}
                      {isEliminated && <span style={{ position: 'absolute', top: '-2px', right: '-2px', fontSize: '8px', background: '#e74c3c', color: '#fff', borderRadius: '4px', padding: '0 3px' }}>×</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '0.9em' }}>后区号码 (1-12) — 杀号结果</div>
              <div className="fushi-number-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {Array.from({ length: CONFIG.BACK_RANGE }, (_, i) => i + 1).map(num => {
                  const isEliminated = eliminationResult.backEliminated.includes(num);
                  return (
                    <button key={num} className={`fushi-number-btn ${isEliminated ? 'eliminated' : ''}`}
                      style={{ width: '36px', height: '36px', borderRadius: '6px', border: isEliminated ? '2px solid #e74c3c' : '1px solid #ddd', background: isEliminated ? 'rgba(231,76,60,0.15)' : '#fff', color: isEliminated ? '#e74c3c' : '#333', fontSize: '0.85em', fontWeight: isEliminated ? 'bold' : 'normal', textDecoration: isEliminated ? 'line-through' : 'none', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title={isEliminated ? `杀号原因: ${(eliminationResult.reasons[num] || []).join('、')}` : '保留号码'}>
                      {num.toString().padStart(2, '0')}
                      {isEliminated && <span style={{ position: 'absolute', top: '-2px', right: '-2px', fontSize: '8px', background: '#e74c3c', color: '#fff', borderRadius: '4px', padding: '0 3px' }}>×</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          </>)}

          {/* 套餐选择 */}
          <div className="fushi-plan-selector" style={{ marginTop: '12px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#2e7d32' }}>选择复式套餐</div>
            <p style={{ fontSize: '0.8em', color: '#555', marginBottom: '8px' }}>杀号后从剩余号码池自动选取最优号码填充套餐，X+Y表示前区X个号码选5+后区Y个号码选2</p>
            {/* 视觉分级图例 */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '10px', fontSize: '0.75em', color: '#555', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: 'linear-gradient(135deg, #e8f5e9, #c8e6c9)', border: '1px solid #27ae60' }}></span>小型(≤6)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: 'linear-gradient(135deg, #e3f2fd, #bbdefb)', border: '1px solid #3498db' }}></span>中型(7)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: 'linear-gradient(135deg, #fff3e0, #ffe0b2)', border: '1px solid #e67e22' }}></span>大型(≥8)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px', marginBottom: '12px' }}>
              {NumberEliminator.FUSHI_PLANS.map(plan => {
                const bets = NumberEliminator.calcPlanBets(plan);
                const canSelect = effectiveFrontRemaining.length >= plan.frontPool && effectiveBackRemaining.length >= plan.backPool;
                const isActive = selectedPlan && selectedPlan.key === plan.key;
                // 视觉分级：小套餐(≤6)绿色系、中套餐(7)蓝色系、大套餐(≥8)橙红色系
                const colors = plan.frontPool <= 6
                  ? { border: '#27ae60', activeBorder: '#1b5e20', bg: 'linear-gradient(135deg, #e8f5e9, #c8e6c9)', activeBg: 'linear-gradient(135deg, #a8e6cf, #88d8b0)', text: '#1a5c2e', activeText: '#1a5c2e' }
                  : plan.frontPool === 7
                    ? { border: '#3498db', activeBorder: '#1565c0', bg: 'linear-gradient(135deg, #e3f2fd, #bbdefb)', activeBg: 'linear-gradient(135deg, #90caf9, #64b5f6)', text: '#1e3a5f', activeText: '#1e3a5f' }
                    : { border: '#e67e22', activeBorder: '#bf360c', bg: 'linear-gradient(135deg, #fff3e0, #ffe0b2)', activeBg: 'linear-gradient(135deg, #ffcc80, #ffa726)', text: '#bf360c', activeText: '#bf360c' };
                return (
                  <button key={plan.key} onClick={() => canSelect && handleSelectPlan(plan)} disabled={!canSelect}
                    className={`fushi-plan-btn ${isActive ? 'active' : ''} ${!canSelect ? 'disabled' : ''}`}
                    style={{ padding: '12px 8px', borderRadius: '10px', border: isActive ? `3px solid ${colors.activeBorder}` : `2px solid ${colors.border}`, background: !canSelect ? '#e0e0e0' : isActive ? colors.activeBg : colors.bg, color: !canSelect ? '#888' : isActive ? colors.activeText : colors.text, cursor: canSelect ? 'pointer' : 'not-allowed', fontWeight: isActive ? 'bold' : 'normal', textAlign: 'center', transition: 'all 0.3s', transform: isActive ? 'scale(1.05)' : 'scale(1)' }}>
                    <div style={{ fontSize: '1.3em', fontWeight: 'bold', marginBottom: '4px' }}>{plan.key}</div>
                    <div style={{ fontSize: '0.75em' }}><div>{bets.totalBets}注</div><div style={{ fontWeight: 'bold', fontSize: '1.1em' }}>{bets.cost}元</div></div>
                    {!canSelect && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-45deg)', fontSize: '0.8em', color: '#666', fontWeight: 'bold', whiteSpace: 'nowrap' }}>号码不足</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 自动选号结果 */}
          {selectedPlan && fushiFrontSelected.length > 0 && (
            <div className="fushi-auto-select" style={{ marginTop: '12px', padding: '10px', background: '#e8f5e9', borderRadius: '6px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#2e7d32' }}>{selectedPlan.key}套餐 - 自动选号结果</div>
              {eliminationResult && (
                <div style={{ fontSize: '0.85em', marginBottom: '6px' }}>
                  <span style={{ color: '#e74c3c' }}>前区算法杀号({eliminationResult.frontEliminated.length}个):</span> {eliminationResult.frontEliminated.map(n => n.toString().padStart(2, '0')).join(', ')}
                </div>
              )}
              {manualFrontKill.length > 0 && (
                <div style={{ fontSize: '0.85em', marginBottom: '6px' }}>
                  <span style={{ color: '#e74c3c' }}>前区手动杀号({manualFrontKill.length}个):</span> {manualFrontKill.slice().sort((a, b) => a - b).map(n => n.toString().padStart(2, '0')).join(', ')}
                </div>
              )}
              {eliminationResult && (
                <div style={{ fontSize: '0.85em', marginBottom: '6px' }}>
                  <span style={{ color: '#e74c3c' }}>后区算法杀号({eliminationResult.backEliminated.length}个):</span> {eliminationResult.backEliminated.map(n => n.toString().padStart(2, '0')).join(', ')}
                </div>
              )}
              {manualBackKill.length > 0 && (
                <div style={{ fontSize: '0.85em', marginBottom: '6px' }}>
                  <span style={{ color: '#e74c3c' }}>后区手动杀号({manualBackKill.length}个):</span> {manualBackKill.slice().sort((a, b) => a - b).map(n => n.toString().padStart(2, '0')).join(', ')}
                </div>
              )}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '0.85em' }}>前区自动选号({fushiFrontSelected.length}个):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                  {fushiFrontSelected.map(num => <span key={num} style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(103,194,58,0.15)', border: '1px solid #67c23a', color: '#2e7d32', fontWeight: 'bold', fontSize: '0.9em' }}>{num.toString().padStart(2, '0')}</span>)}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '0.85em' }}>后区自动选号({fushiBackSelected.length}个):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                  {fushiBackSelected.map(num => <span key={num} style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(52,152,219,0.15)', border: '1px solid #3498db', color: '#2980b9', fontWeight: 'bold', fontSize: '0.9em' }}>{num.toString().padStart(2, '0')}</span>)}
                </div>
              </div>
              {/* 012路分布分析 */}
              <div style={{ marginTop: '8px', padding: '8px', background: '#f0f4c8', borderRadius: '6px', border: '1px solid #cddc39' }}>
                <div style={{ fontWeight: 'bold', fontSize: '0.85em', color: '#558b2f', marginBottom: '4px' }}>📊 012路分布分析</div>
                <div style={{ fontSize: '0.8em', color: '#333' }}>
                  <div style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>前区: </span>
                    {[0, 1, 2].map(r => {
                      const nums = fushiFrontSelected.filter(n => n % 3 === r);
                      return (
                        <span key={r} style={{ marginRight: '8px' }}>
                          {r}路({nums.length}个): {nums.length > 0 ? nums.map(n => n.toString().padStart(2, '0')).join(' ') : '无'}
                        </span>
                      );
                    })}
                  </div>
                  <div>
                    <span style={{ color: '#3498db', fontWeight: 'bold' }}>后区: </span>
                    {[0, 1, 2].map(r => {
                      const nums = fushiBackSelected.filter(n => n % 3 === r);
                      return (
                        <span key={r} style={{ marginRight: '8px' }}>
                          {r}路({nums.length}个): {nums.length > 0 ? nums.map(n => n.toString().padStart(2, '0')).join(' ') : '无'}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '0.8em', color: '#444', marginTop: '6px' }}>注：选号基于UnifiedScorer 6维评分（频率+遗漏+趋势+区间+条件概率+和值回归）+ FushiSelector结构优化（区间覆盖+冷热搭配+012路平衡）自动选取最优号码</div>
            </div>
          )}

          {/* 生成按钮 */}
          {selectedPlan && fushiFrontSelected.length > 0 && (
            <button onClick={handleGenerateFushi} className="fushi-generate-btn"
              style={{ background: 'linear-gradient(135deg, #67c23a, #27ae60)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', width: '100%', marginTop: '12px' }}>
              生成{selectedPlan.key}复式组合
            </button>
          )}

          {/* 复式组合结果 */}
          {fushiResult && (
            <div className="fushi-result" style={{ marginTop: '15px' }}>
              <div className="result-header">
                <h3>复式组合结果</h3>
                <span className="result-summary">共 {fushiResult.totalBets} 注 | 费用 {fushiResult.cost} 元</span>
              </div>
              <div style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px', marginTop: '10px' }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#e74c3c', fontWeight: 'bold', marginRight: '8px' }}>前区:</span>
                  <span style={{ fontSize: '1.1em', fontFamily: 'monospace' }}>{fushiResult.frontPool.map(n => n.toString().padStart(2, '0')).join(' ')}</span>
                  <span style={{ color: '#555', marginLeft: '6px', fontSize: '0.85em' }}>({fushiResult.frontPool.length}个选{fushiResult.frontCount})</span>
                </div>
                <div>
                  <span style={{ color: '#3498db', fontWeight: 'bold', marginRight: '8px' }}>后区:</span>
                  <span style={{ fontSize: '1.1em', fontFamily: 'monospace' }}>{fushiResult.backPool.map(n => n.toString().padStart(2, '0')).join(' ')}</span>
                  <span style={{ color: '#555', marginLeft: '6px', fontSize: '0.85em' }}>({fushiResult.backPool.length}个选{fushiResult.backCount})</span>
                </div>
              </div>
              <div className="copy-section">
                <button className="copy-btn" onClick={handleCopyFushi}
                  style={{ background: copySuccess ? '#67c23a' : '#409eff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', marginTop: '10px' }}>
                  {copySuccess ? '已复制' : '一键复制'}
                </button>
                <p className="copy-hint">复制后可粘贴到微信、QQ等聊天工具</p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
