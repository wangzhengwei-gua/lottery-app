/**
 * 单式玩法组件（原"智能预测"）
 * 从App.jsx提取，包含模型选择、号码生成、复制、保存等功能
 */
import { useState, useEffect } from 'react';
import { trackNumberGeneration, trackCopy, trackSave, trackModelSelection } from '../utils/baiduAnalytics';

const modelNames = {
  weighted: '频率加权',
  distribution: '正态分布',
  omission: '遗漏分析',
  bayesian: '贝叶斯动态',
  zone_frequency: '区间频率分析'
};

const modelDescriptions = {
  weighted: '根据历史出现频率加权，高频号码有更高概率被选中。',
  distribution: '利用正态分布特性，生成符合统计规律的号码。',
  omission: '分析遗漏期数，选择处于合理遗漏区间的号码。',
  bayesian: '使用贝叶斯定理计算条件概率，动态调整预测权重。',
  zone_frequency: '前区分7区后区分2区，统计各区间频率选高频号码。'
};

export default function SinglePlay({ analyzer, dataWindow }) {
  const [predictions, setPredictions] = useState([]);
  const [selectedModels, setSelectedModels] = useState(['weighted', 'regression']);
  const [groupsPerModel, setGroupsPerModel] = useState(5);
  const [hasGeneratedToday, setHasGeneratedToday] = useState(false);
  const [lastGenerateTime, setLastGenerateTime] = useState(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [todayPrediction, setTodayPrediction] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // 加载用户选择的模型
  useEffect(() => {
    const saved = localStorage.getItem('selected_models');
    if (saved) {
      try {
        const models = JSON.parse(saved);
        setSelectedModels(models);
      } catch (e) { /* ignore */ }
    }

    // 检查今日缓存
    const today = new Date().toDateString();
    const cacheKey = `lottery_prediction_${today}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        setTodayPrediction(data.prediction);
        setLastGenerateTime(data.timestamp);
        setRefreshCount(data.refreshCount || 0);
        setHasGeneratedToday(true);
      } catch (e) { /* ignore */ }
    }
  }, []);

  const saveSelectedModels = (models) => {
    localStorage.setItem('selected_models', JSON.stringify(models));
  };

  const saveTodayPrediction = (prediction, rCount = 0) => {
    const today = new Date().toDateString();
    const cacheKey = `lottery_prediction_${today}`;
    const data = { prediction, timestamp: new Date().toLocaleString('zh-CN'), refreshCount: rCount };
    localStorage.setItem(cacheKey, JSON.stringify(data));
    setTodayPrediction(prediction);
    setLastGenerateTime(data.timestamp);
    setRefreshCount(rCount);
  };

  const generateNumbers = (models, groups, rCount) => {
    const results = [];
    models.forEach(model => {
      const uniqueGroups = analyzer.generateUniqueGroups(model, groups);
      uniqueGroups.forEach((group, idx) => {
        results.push({ model, groupNum: idx + 1, front: group.front, back: group.back });
      });
      trackNumberGeneration(model, groups);
    });
    setPredictions(results);
    setCopySuccess(false);
    setHasGeneratedToday(true);
    setRefreshCount(rCount);

    const shouldCache = true;
    if (shouldCache && results.length > 0) {
      saveTodayPrediction(results, rCount);
    }
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const groups = groupsPerModel || 5;
      const rCount = todayPrediction ? refreshCount : 0;
      generateNumbers(selectedModels, groups, rCount);
      setIsGenerating(false);
    }, 300);
  };

  const handleRegenerate = () => {
    if (!confirm('确定要重新生成吗？这将覆盖当前号码。')) return;
    const newRefreshCount = refreshCount + 1;
    setIsGenerating(true);
    setTimeout(() => {
      generateNumbers(selectedModels, groupsPerModel || 5, newRefreshCount);
      setIsGenerating(false);
    }, 300);
  };

  const formatPredictions = () => {
    if (predictions.length === 0) return '';
    let text = `🧧 发财大计 - 号码预测\n生成时间: ${new Date().toLocaleString('zh-CN')}\n========================================\n\n`;
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
        const oddEvenMark = (oddCount >= 2 && oddCount <= 3) ? '✓' : (oddCount === 0 || oddCount === p.front.length) ? '⚠' : '';
        text += `第${idx + 1}组: ${frontStr} | ${backStr} (和值:${frontSum}/${backSum}, 奇偶:${oddCount}:${evenCount}${oddEvenMark})\n`;
      });
      text += '\n';
    });
    text += `========================================\n总计: ${predictions.length} 组号码`;
    return text;
  };

  const handleCopy = async () => {
    if (predictions.length === 0) { alert('请先生成号码！'); return; }
    const text = formatPredictions();
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      trackCopy();
    } catch (err) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); trackCopy(); }
      catch (e) { alert('复制失败，请手动复制'); }
      document.body.removeChild(textarea);
    }
  };

  const handleSave = () => {
    if (predictions.length === 0) { alert('请先生成号码！'); return; }
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
    trackSave();
  };

  return (
    <section className="card">
      <h2>📝 单式玩法 - 智能预测</h2>

      <div className="model-descriptions">
        {Object.keys(modelNames).map(m => (
          <div key={m} className={`model-desc-item ${selectedModels.includes(m) ? 'active' : ''}`}>
            <label className="model-desc-label">
              <input
                type="checkbox"
                checked={selectedModels.includes(m)}
                onChange={(e) => {
                  let newModels;
                  if (e.target.checked) newModels = [...selectedModels, m];
                  else newModels = selectedModels.filter(x => x !== m);
                  setSelectedModels(newModels);
                  saveSelectedModels(newModels);
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
            if (val === '') setGroupsPerModel('');
            else { const num = parseInt(val); if (!isNaN(num) && num > 0) setGroupsPerModel(num); }
          }}
          min="1"
          placeholder="输入组数"
        />
        <span>组</span>
      </div>

      {!hasGeneratedToday ? (
        <button onClick={handleGenerate} style={{ backgroundColor: '#67c23a', boxShadow: '0 2px 4px rgba(103, 194, 58, 0.3)' }} disabled={isGenerating}>
          {isGenerating ? '⏳ 生成中...' : '🎯 一键生成号码'}
        </button>
      ) : (
        <div className="cache-info-banner">
          <div className="cache-status">
            <span className="status-icon">✅</span>
            <span className="status-text">使用今日缓存</span>
          </div>
          <div className="cache-details">
            <span className="cache-time">📅 生成时间: {lastGenerateTime}</span>
            <span className="refresh-count">🔄 今日已刷新: {refreshCount}次</span>
          </div>
          <button onClick={handleRegenerate} className="regenerate-button">🔄 重新生成</button>
        </div>
      )}

      {predictions.length > 0 && (
        <div className="action-buttons">
          <button
            onClick={handleCopy}
            className={`secondary ${copySuccess ? 'success' : ''}`}
            style={{ backgroundColor: copySuccess ? '#67c23a' : '#409eff', boxShadow: copySuccess ? '0 2px 4px rgba(103, 194, 58, 0.3)' : '0 2px 4px rgba(64, 158, 255, 0.3)' }}
          >
            {copySuccess ? '✓ 已复制' : '📋 一键复制'}
          </button>
          <button
            onClick={handleSave}
            className="secondary"
            style={{ backgroundColor: '#e6a23c', boxShadow: '0 2px 4px rgba(230, 162, 60, 0.3)' }}
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
                      <span className="sum-number" style={{ fontSize: '0.85em' }}>
                        {(() => {
                          const oddCount = p.front.filter(n => n % 2 !== 0).length;
                          const evenCount = p.front.length - oddCount;
                          const ratio = `${oddCount}:${evenCount}`;
                          if (oddCount >= 2 && oddCount <= 3) return `${ratio} ✓`;
                          if (oddCount === 1 || oddCount === p.front.length - 1) return `${ratio}`;
                          return `${ratio} ⚠`;
                        })()}
                      </span>
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
  );
}
