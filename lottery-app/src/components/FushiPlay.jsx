/**
 * 复式玩法组件
 * 从App.jsx提取，包含杀号分析、套餐选择、自动选号、生成组合等功能
 * 参数精简：杀号参数移入可折叠"高级设置"，默认"混合-交集"模式
 */
import { useState } from 'react';
import { CONFIG } from '../utils/core/Config.js';
import { NumberEliminator } from '../utils/optimization/NumberEliminator.js';
import { UnifiedScorer } from '../utils/optimization/UnifiedScorer.js';

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
  const [recommendResult, setRecommendResult] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  // 手动杀号状态
  const [manualFrontKill, setManualFrontKill] = useState([]);
  const [manualBackKill, setManualBackKill] = useState([]);

  // 有效剩余号码 = 算法杀号后剩余 - 手动杀号
  const effectiveFrontRemaining = eliminationResult
    ? eliminationResult.frontRemaining.filter(n => !manualFrontKill.includes(n))
    : [];
  const effectiveBackRemaining = eliminationResult
    ? eliminationResult.backRemaining.filter(n => !manualBackKill.includes(n))
    : [];

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

  // 套餐选择 - 使用UnifiedScorer统一评分选号
  const handleSelectPlan = (plan) => {
    if (!eliminationResult) { alert('请先执行杀号分析！'); return; }
    if (effectiveFrontRemaining.length < plan.frontPool) {
      alert(`前区有效剩余号码不足：套餐需要${plan.frontPool}个，仅有${effectiveFrontRemaining.length}个（算法杀号+手动杀号后）。`);
      return;
    }
    if (effectiveBackRemaining.length < plan.backPool) {
      alert(`后区有效剩余号码不足：套餐需要${plan.backPool}个，仅有${effectiveBackRemaining.length}个（算法杀号+手动杀号后）。`);
      return;
    }
    setSelectedPlan(plan);
    setFushiResult(null);

    // 使用UnifiedScorer从有效剩余号码中选最优号码
    try {
      const frontScored = UnifiedScorer.score(analyzer, 'front', 'balanced')
        .filter(r => effectiveFrontRemaining.includes(r.number));
      const frontSelected = frontScored.slice(0, plan.frontPool).map(r => r.number).sort((a, b) => a - b);

      const backScored = UnifiedScorer.score(analyzer, 'back', 'balanced')
        .filter(r => effectiveBackRemaining.includes(r.number));
      const backSelected = backScored.slice(0, plan.backPool).map(r => r.number).sort((a, b) => a - b);

      setFushiFrontSelected(frontSelected);
      setFushiBackSelected(backSelected);
    } catch (error) {
      console.warn('UnifiedScorer选号失败，降级到原算法:', error);
      const autoResult = NumberEliminator.autoSelect(analyzer, effectiveFrontRemaining, effectiveBackRemaining, plan);
      setFushiFrontSelected(autoResult.frontSelected);
      setFushiBackSelected(autoResult.backSelected);
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
          style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #aaa', background: '#f5f5f5', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85em', width: '100%' }}>
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
          回测验证
        </button>
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

      {/* 杀号结果 */}
      {eliminationResult && (
        <div className="elimination-result">
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

          {/* 手动杀号 */}
          <div style={{ marginTop: '12px', padding: '10px', background: '#fff0f0', borderRadius: '8px', border: '1px solid #ffcccc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ fontWeight: 'bold', color: '#c0392b' }}>✋ 手动杀号（点击号码添加/取消）</div>
              {(manualFrontKill.length > 0 || manualBackKill.length > 0) && (
                <button onClick={clearManualKill}
                  style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c', cursor: 'pointer', fontSize: '0.8em' }}>
                  清空手动杀号
                </button>
              )}
            </div>
            <p style={{ fontSize: '0.8em', color: '#555', marginBottom: '8px' }}>在算法杀号基础上，可自行补充需要杀掉的号码。有效剩余：前区{effectiveFrontRemaining.length}个 / 后区{effectiveBackRemaining.length}个</p>

            {/* 前区手动杀号 */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '0.85em', marginBottom: '4px', color: '#e74c3c' }}>前区(红) — 剩余{eliminationResult.frontRemaining.length}个，已手动杀{manualFrontKill.length}个</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {eliminationResult.frontRemaining.map(num => {
                  const isManualKilled = manualFrontKill.includes(num);
                  return (
                    <button key={num} onClick={() => toggleManualFrontKill(num)}
                      style={{ width: '32px', height: '32px', borderRadius: '6px', border: isManualKilled ? '2px solid #e74c3c' : '1px solid #ddd', background: isManualKilled ? 'rgba(231,76,60,0.25)' : '#fff', color: isManualKilled ? '#e74c3c' : '#333', fontSize: '0.8em', fontWeight: isManualKilled ? 'bold' : 'normal', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                      {num.toString().padStart(2, '0')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 后区手动杀号 */}
            <div>
              <div style={{ fontSize: '0.85em', marginBottom: '4px', color: '#3498db' }}>后区(蓝) — 剩余{eliminationResult.backRemaining.length}个，已手动杀{manualBackKill.length}个</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {eliminationResult.backRemaining.map(num => {
                  const isManualKilled = manualBackKill.includes(num);
                  return (
                    <button key={num} onClick={() => toggleManualBackKill(num)}
                      style={{ width: '32px', height: '32px', borderRadius: '6px', border: isManualKilled ? '2px solid #e74c3c' : '1px solid #ddd', background: isManualKilled ? 'rgba(231,76,60,0.25)' : '#fff', color: isManualKilled ? '#e74c3c' : '#333', fontSize: '0.8em', fontWeight: isManualKilled ? 'bold' : 'normal', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                      {num.toString().padStart(2, '0')}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

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
                const canSelect = eliminationResult && effectiveFrontRemaining.length >= plan.frontPool && effectiveBackRemaining.length >= plan.backPool;
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
                    style={{ padding: '12px 8px', borderRadius: '10px', border: isActive ? `3px solid ${colors.activeBorder}` : `2px solid ${colors.border}`, background: !canSelect ? '#f5f5f5' : isActive ? colors.activeBg : colors.bg, color: !canSelect ? '#ccc' : isActive ? colors.activeText : colors.text, cursor: canSelect ? 'pointer' : 'not-allowed', fontWeight: isActive ? 'bold' : 'normal', textAlign: 'center', transition: 'all 0.3s', transform: isActive ? 'scale(1.05)' : 'scale(1)' }}>
                    <div style={{ fontSize: '1.3em', fontWeight: 'bold', marginBottom: '4px' }}>{plan.key}</div>
                    <div style={{ fontSize: '0.75em' }}><div>{bets.totalBets}注</div><div style={{ fontWeight: 'bold', fontSize: '1.1em' }}>{bets.cost}元</div></div>
                    {!canSelect && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-45deg)', fontSize: '0.8em', color: '#555', fontWeight: 'bold', whiteSpace: 'nowrap' }}>号码不足</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 自动选号结果 */}
          {selectedPlan && fushiFrontSelected.length > 0 && (
            <div className="fushi-auto-select" style={{ marginTop: '12px', padding: '10px', background: '#e8f5e9', borderRadius: '6px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#2e7d32' }}>{selectedPlan.key}套餐 - 自动选号结果</div>
              <div style={{ fontSize: '0.85em', marginBottom: '6px' }}>
                <span style={{ color: '#e74c3c' }}>前区算法杀号({eliminationResult.frontEliminated.length}个):</span> {eliminationResult.frontEliminated.map(n => n.toString().padStart(2, '0')).join(', ')}
              </div>
              {manualFrontKill.length > 0 && (
                <div style={{ fontSize: '0.85em', marginBottom: '6px' }}>
                  <span style={{ color: '#e74c3c' }}>前区手动杀号({manualFrontKill.length}个):</span> {manualFrontKill.slice().sort((a, b) => a - b).map(n => n.toString().padStart(2, '0')).join(', ')}
                </div>
              )}
              <div style={{ fontSize: '0.85em', marginBottom: '6px' }}>
                <span style={{ color: '#e74c3c' }}>后区算法杀号({eliminationResult.backEliminated.length}个):</span> {eliminationResult.backEliminated.map(n => n.toString().padStart(2, '0')).join(', ')}
              </div>
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
              <div style={{ fontSize: '0.8em', color: '#444', marginTop: '6px' }}>注：选号基于UnifiedScorer统一评分（频率+遗漏+趋势+区间+条件概率）自动选取最优号码</div>
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
