import { useState, useEffect } from 'react';
import LotteryAnalyzer from './utils/LotteryAnalyzer.js';
import { trackDataUpdate } from './utils/baiduAnalytics';
import AuthGuard from './components/AuthGuard';
import DataVisualization from './components/DataVisualization';
import ShuangSeQiuPage from './components/ShuangSeQiuPage';
import ZoneAnalysisPanel from './components/ZoneAnalysisPanel';
import LotteryBlackboard from './components/LotteryBlackboard';
import CompoundCalculator from './components/CompoundCalculator';
import DanTuoPlay from './components/DanTuoPlay';
import FushiPlay from './components/FushiPlay';
import SinglePlay from './components/SinglePlay';
import './components/LotteryBlackboard.css';
import './App.css';

// 隐藏页面进入机制：连续点击标题7次（3秒内）可进入福彩双色球玩法页面
let titleClickCount = 0;
let titleClickTimer = null;

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

function App() {
  const [analyzer] = useState(new LotteryAnalyzer());
  const [dataInput, setDataInput] = useState(defaultData);
  const [stats, setStats] = useState(null);
  const [newNumber, setNewNumber] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [recommendSampleSize, setRecommendSampleSize] = useState(80); // 推荐算法样本量
  const [dataWindow, setDataWindow] = useState(60); // 历史数据窗口：0=全部，N=最近N期（默认60期）
  const [currentRecommendation, setCurrentRecommendation] = useState(null); // 当前推荐结果
  const [showVisualization, setShowVisualization] = useState(false); // 是否显示可视化
  const [showSSQPage, setShowSSQPage] = useState(false); // 是否显示福彩双色球玩法页面
  const [showBlackboard, setShowBlackboard] = useState(false); // 是否显示号码分布黑板
  const [activePlayMode, setActivePlayMode] = useState('dantuo'); // 玩法标签页: dantuo/fushi/single

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

        {/* 玩法区标签页 */}
        <div className="play-mode-tabs">
          <button className={`play-mode-tab ${activePlayMode === 'dantuo' ? 'active' : ''}`} onClick={() => setActivePlayMode('dantuo')}>🎯 胆拖</button>
          <button className={`play-mode-tab ${activePlayMode === 'fushi' ? 'active' : ''}`} onClick={() => setActivePlayMode('fushi')}>📋 复式</button>
          <button className={`play-mode-tab ${activePlayMode === 'single' ? 'active' : ''}`} onClick={() => setActivePlayMode('single')}>📝 单式</button>
        </div>
        {activePlayMode === 'dantuo' && <DanTuoPlay analyzer={analyzer} dataWindow={dataWindow} />}
        {activePlayMode === 'fushi' && <FushiPlay analyzer={analyzer} />}
        {activePlayMode === 'single' && <SinglePlay analyzer={analyzer} dataWindow={dataWindow} />}

        {/* 复式价格计算器 */}
        <CompoundCalculator />

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

      </main>
    </div>
    </AuthGuard>
  );
}

export default App;
