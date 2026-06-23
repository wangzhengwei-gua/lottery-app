import { useState, useMemo } from 'react';
import './CompoundCalculator.css';

/**
 * 计算组合数 C(n, k)
 */
function combination(n, k) {
  if (n < k || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  // 使用较小值优化计算
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/**
 * 格式化金额（千分位）
 */
function formatMoney(num) {
  return num.toLocaleString('zh-CN');
}

// 彩种配置
const LOTTERY_CONFIG = {
  dlt: {
    name: '大乐透',
    front: { name: '前区', min: 1, max: 35, pickMin: 5, pickMax: 20 },
    back: { name: '后区', min: 1, max: 12, pickMin: 2, pickMax: 12 },
    frontColor: '#e74c3c',
    backColor: '#3498db',
    pricePerBet: 2,
  },
  ssq: {
    name: '双色球',
    front: { name: '红球', min: 1, max: 33, pickMin: 6, pickMax: 20 },
    back: { name: '蓝球', min: 1, max: 16, pickMin: 1, pickMax: 16 },
    frontColor: '#e74c3c',
    backColor: '#3498db',
    pricePerBet: 2,
  },
};

/**
 * 复式价格计算器组件
 * 支持大乐透和双色球的复式投注金额计算
 */
function CompoundCalculator() {
  const [lotteryType, setLotteryType] = useState('dlt'); // dlt-大乐透, ssq-双色球
  const [frontSelected, setFrontSelected] = useState([]); // 前区/红球已选
  const [backSelected, setBackSelected] = useState([]); // 后区/蓝球已选
  const [multiplier, setMultiplier] = useState(1); // 倍投数
  const [showPrizeDetails, setShowPrizeDetails] = useState(false); // 是否显示中奖详情

  const config = LOTTERY_CONFIG[lotteryType];

  // 切换彩种时重置选择
  const handleSwitchType = (type) => {
    if (type === lotteryType) return;
    setLotteryType(type);
    setFrontSelected([]);
    setBackSelected([]);
    setMultiplier(1);
  };

  // 切换前区/红球号码选择
  const toggleFront = (num) => {
    if (frontSelected.includes(num)) {
      setFrontSelected(frontSelected.filter(n => n !== num));
    } else {
      if (frontSelected.length >= config.front.pickMax) {
        return;
      }
      setFrontSelected([...frontSelected, num].sort((a, b) => a - b));
    }
  };

  // 切换后区/蓝球号码选择
  const toggleBack = (num) => {
    if (backSelected.includes(num)) {
      setBackSelected(backSelected.filter(n => n !== num));
    } else {
      if (backSelected.length >= config.back.pickMax) {
        return;
      }
      setBackSelected([...backSelected, num].sort((a, b) => a - b));
    }
  };

  // 一键清空
  const handleClear = () => {
    setFrontSelected([]);
    setBackSelected([]);
    setMultiplier(1);
  };

  // 全选后区/蓝球
  const handleSelectAllBack = () => {
    const all = Array.from({ length: config.back.max }, (_, i) => i + 1);
    setBackSelected(all);
  };

  /**
   * 计算中奖收益信息
   * 
   * 复式投注中奖规则：
   * - 复式投注是将所有可能的单式组合都买了
   * - 如果开奖号码在你选的号码范围内，则对应的那一注中奖
   * - 例如：前区选10个、后区选5个，共C(10,5)×C(5,2)=2520注
   *   如果开奖的7个号都在你选的15个号内，则有C(5,5)×C(2,2)=1注中一等奖
   */
  function calcPrizeInfo(frontCount, backCount, type, mult, cost) {
    if (!frontCount || !backCount) return null;

    const prizes = [];
    let totalWin = 0;

    if (type === 'dlt') {
      // 大乐透奖项配置（固定奖金）
      const dltPrizes = [
        { name: '一等奖', match: '5+2', basePrize: 10000000, desc: '前区5个+后区2个' },
        { name: '二等奖', match: '5+1', basePrize: 300000, desc: '前区5个+后区1个' },
        { name: '三等奖', match: '5+0', basePrize: 10000, desc: '前区5个+后区0个' },
        { name: '四等奖', match: '4+2', basePrize: 3000, desc: '前区4个+后区2个' },
        { name: '五等奖', match: '4+1', basePrize: 300, desc: '前区4个+后区1个' },
        { name: '六等奖', match: '3+2', basePrize: 200, desc: '前区3个+后区2个' },
        { name: '七等奖', match: '4+0', basePrize: 100, desc: '前区4个+后区0个' },
        { name: '八等奖', match: '3+1', basePrize: 15, desc: '前区3个+后区1个' },
        { name: '九等奖', match: '2+2', basePrize: 15, desc: '前区2个+后区2个' },
        { name: '十等奖', match: '3+0', basePrize: 5, desc: '前区3个+后区0个' },
        { name: '十一等奖', match: '2+1', basePrize: 5, desc: '前区2个+后区1个' },
        { name: '十二等奖', match: '1+2', basePrize: 5, desc: '前区1个+后区2个' },
        { name: '十三等奖', match: '0+2', basePrize: 5, desc: '前区0个+后区2个' },
      ];

      // 计算每个奖项的中奖注数
      dltPrizes.forEach(prize => {
        const [fMatch, bMatch] = prize.match.split('+').map(Number);
        
        // 复式投注中奖注数 = 从选中的前区号中选fMatch个的组合数 × 从选中的后区号中选bMatch个的组合数
        // 注意：这里不乘以未选中号码的组合，因为复式只买选中号码的所有组合
        const frontComb = combination(frontCount, fMatch);
        const backComb = combination(backCount, bMatch);
        
        const winBets = frontComb * backComb;
        const winAmount = winBets * prize.basePrize * mult;
        
        if (winBets > 0) {
          prizes.push({
            ...prize,
            winBets,
            winAmount,
            roi: cost > 0 ? ((winAmount - cost) / cost * 100).toFixed(1) : 0,
          });
          totalWin += winAmount;
        }
      });
    } else {
      // 双色球奖项配置
      const ssqPrizes = [
        { name: '一等奖', match: '6+1', basePrize: 5000000, desc: '红球6个+蓝球1个' },
        { name: '二等奖', match: '6+0', basePrize: 100000, desc: '红球6个+蓝球0个' },
        { name: '三等奖', match: '5+1', basePrize: 3000, desc: '红球5个+蓝球1个' },
        { name: '四等奖', match: '5+0', basePrize: 200, desc: '红球5个+蓝球0个' },
        { name: '五等奖', match: '4+1', basePrize: 200, desc: '红球4个+蓝球1个' },
        { name: '六等奖', match: '3+1', basePrize: 10, desc: '红球3个+蓝球1个' },
        { name: '七等奖', match: '4+0', basePrize: 10, desc: '红球4个+蓝球0个' },
        { name: '八等奖', match: '2+1', basePrize: 10, desc: '红球2个+蓝球1个' },
        { name: '九等奖', match: '1+1', basePrize: 5, desc: '红球1个+蓝球1个' },
        { name: '十等奖', match: '0+1', basePrize: 5, desc: '红球0个+蓝球1个' },
      ];

      // 计算每个奖项的中奖注数
      ssqPrizes.forEach(prize => {
        const [fMatch, bMatch] = prize.match.split('+').map(Number);
        
        // 复式投注中奖注数 = 从选中的红球中选fMatch个的组合数 × 从选中的蓝球中选bMatch个的组合数
        const frontComb = combination(frontCount, fMatch);
        const backComb = combination(backCount, bMatch);
        
        const winBets = frontComb * backComb;
        const winAmount = winBets * prize.basePrize * mult;
        
        if (winBets > 0) {
          prizes.push({
            ...prize,
            winBets,
            winAmount,
            roi: cost > 0 ? ((winAmount - cost) / cost * 100).toFixed(1) : 0,
          });
          totalWin += winAmount;
        }
      });
    }

    return {
      prizes: prizes.filter(p => p.winBets > 0),
      totalWin,
      netProfit: totalWin - cost,
      roi: cost > 0 ? ((totalWin - cost) / cost * 100).toFixed(1) : 0,
    };
  }

  // 计算注数和金额
  const calcResult = useMemo(() => {
    const frontCount = frontSelected.length;
    const backCount = backSelected.length;

    // 判断是否满足最低选择要求
    const frontValid = frontCount >= config.front.pickMin;
    const backValid = backCount >= config.back.pickMin;

    let bets = 0;
    let totalAmount = 0;
    let formula = '';

    if (frontValid && backValid) {
      const frontComb = combination(frontCount, config.front.pickMin);
      const backComb = lotteryType === 'dlt'
        ? combination(backCount, config.back.pickMin)
        : backCount; // 双色球蓝球只选1个
      bets = frontComb * backComb;
      totalAmount = bets * config.pricePerBet * multiplier;

      if (lotteryType === 'dlt') {
        formula = `C(${frontCount}, ${config.front.pickMin}) × C(${backCount}, ${config.back.pickMin}) = ${frontComb} × ${backComb} = ${formatMoney(bets)}注`;
      } else {
        formula = `C(${frontCount}, ${config.front.pickMin}) × ${backCount} = ${frontComb} × ${backComb} = ${formatMoney(bets)}注`;
      }
    }

    // 计算中奖收益（基于复式组合覆盖的所有可能）
    const prizeInfo = calcPrizeInfo(frontCount, backCount, lotteryType, multiplier, totalAmount);

    return {
      frontCount,
      backCount,
      frontValid,
      backValid,
      bets,
      totalAmount,
      formula,
      isCompound: frontCount > config.front.pickMin || backCount > config.back.pickMin,
      prizeInfo,
    };
  }, [frontSelected, backSelected, multiplier, lotteryType, config]);

  return (
    <section className="card compound-calculator-section">
      <div className="compound-calc-header">
        <h2>🧮 复式价格计算器</h2>
        <button className="compound-clear-btn" onClick={handleClear}>
          🗑️ 清空
        </button>
      </div>

      {/* 彩种切换 */}
      <div className="lottery-type-tabs">
        <button
          className={`lottery-tab ${lotteryType === 'dlt' ? 'active' : ''}`}
          onClick={() => handleSwitchType('dlt')}
        >
          🎱 大乐透
        </button>
        <button
          className={`lottery-tab ${lotteryType === 'ssq' ? 'active' : ''}`}
          onClick={() => handleSwitchType('ssq')}
        >
          🔴 双色球
        </button>
      </div>

      <div className="compound-calc-hint">
        {lotteryType === 'dlt'
          ? `前区选${config.front.pickMin}-${config.front.pickMax}个(1-35)，后区选${config.back.pickMin}-${config.back.pickMax}个(1-12)`
          : `红球选${config.front.pickMin}-${config.front.pickMax}个(1-33)，蓝球选${config.back.pickMin}-${config.back.pickMax}个(1-16)`
        }
      </div>

      {/* 前区/红球选择 */}
      <div className="compound-zone">
        <div className="compound-zone-header">
          <span className="zone-name" style={{ color: config.frontColor }}>
            {config.front.name} ({config.front.min}-{config.front.max})
          </span>
          <span className="zone-count">
            已选 <strong style={{ color: config.frontColor }}>{frontSelected.length}</strong> / {config.front.pickMax}
            {frontSelected.length < config.front.pickMin && (
              <span className="zone-warn">（至少选{config.front.pickMin}个）</span>
            )}
          </span>
        </div>
        <div className="compound-ball-grid">
          {Array.from({ length: config.front.max }, (_, i) => i + 1).map(num => (
            <button
              key={num}
              className={`calc-ball ${frontSelected.includes(num) ? 'selected front' : ''}`}
              onClick={() => toggleFront(num)}
            >
              {num.toString().padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>

      {/* 后区/蓝球选择 */}
      <div className="compound-zone">
        <div className="compound-zone-header">
          <span className="zone-name" style={{ color: config.backColor }}>
            {config.back.name} ({config.back.min}-{config.back.max})
          </span>
          <span className="zone-count">
            已选 <strong style={{ color: config.backColor }}>{backSelected.length}</strong> / {config.back.pickMax}
            {backSelected.length < config.back.pickMin && (
              <span className="zone-warn">（至少选{config.back.pickMin}个）</span>
            )}
          </span>
          {backSelected.length < config.back.max && (
            <button className="select-all-btn" onClick={handleSelectAllBack}>全选</button>
          )}
        </div>
        <div className="compound-ball-grid back-grid">
          {Array.from({ length: config.back.max }, (_, i) => i + 1).map(num => (
            <button
              key={num}
              className={`calc-ball ${backSelected.includes(num) ? 'selected back' : ''}`}
              onClick={() => toggleBack(num)}
            >
              {num.toString().padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>

      {/* 倍投设置 */}
      <div className="multiplier-row">
        <label className="multiplier-label">倍投：</label>
        <button
          className="multiplier-btn"
          onClick={() => setMultiplier(Math.max(1, multiplier - 1))}
          disabled={multiplier <= 1}
        >
          −
        </button>
        <input
          type="number"
          className="multiplier-input"
          value={multiplier}
          min="1"
          max="99"
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val >= 1 && val <= 99) {
              setMultiplier(val);
            } else if (e.target.value === '') {
              setMultiplier(1);
            }
          }}
        />
        <button
          className="multiplier-btn"
          onClick={() => setMultiplier(Math.min(99, multiplier + 1))}
          disabled={multiplier >= 99}
        >
          +
        </button>
        <span className="multiplier-quick">
          {[1, 3, 5, 10].map(m => (
            <button
              key={m}
              className={`quick-mult-btn ${multiplier === m ? 'active' : ''}`}
              onClick={() => setMultiplier(m)}
            >
              {m}倍
            </button>
          ))}
        </span>
      </div>

      {/* 计算结果 */}
      <div className="compound-result">
        {calcResult.frontValid && calcResult.backValid ? (
          <>
            <div className="result-formula">{calcResult.formula}</div>
            <div className="result-summary">
              <div className="result-item">
                <span className="result-label">总注数</span>
                <span className="result-value">{formatMoney(calcResult.bets)}</span>
                <span className="result-unit">注</span>
              </div>
              <div className="result-divider">×</div>
              <div className="result-item">
                <span className="result-label">每注</span>
                <span className="result-value">{config.pricePerBet}</span>
                <span className="result-unit">元</span>
              </div>
              {multiplier > 1 && (
                <>
                  <div className="result-divider">×</div>
                  <div className="result-item">
                    <span className="result-label">倍投</span>
                    <span className="result-value">{multiplier}</span>
                    <span className="result-unit">倍</span>
                  </div>
                </>
              )}
              <div className="result-divider">=</div>
              <div className="result-item total">
                <span className="result-label">总金额</span>
                <span className="result-value total-amount">¥{formatMoney(calcResult.totalAmount)}</span>
              </div>
            </div>
            {calcResult.isCompound && (
              <div className="result-tag">📌 复式投注</div>
            )}
            {!calcResult.isCompound && (
              <div className="result-tag single">📌 单式投注</div>
            )}

            {/* 中奖收益分析 */}
            {calcResult.prizeInfo && calcResult.prizeInfo.prizes.length > 0 && (
              <div className="prize-analysis">
                <div className="prize-header">
                  <span className="prize-title">💰 中奖收益分析（假设全中）</span>
                  <button 
                    className="toggle-prize-btn"
                    onClick={() => setShowPrizeDetails(!showPrizeDetails)}
                  >
                    {showPrizeDetails ? '收起' : '展开详情'}
                  </button>
                </div>
                
                {/* 总收益概览 */}
                <div className="prize-summary">
                  <div className="summary-item">
                    <span className="summary-label">总奖金</span>
                    <span className="summary-value win">¥{formatMoney(calcResult.prizeInfo.totalWin)}</span>
                  </div>
                  <div className="summary-divider">-</div>
                  <div className="summary-item">
                    <span className="summary-label">成本</span>
                    <span className="summary-value cost">¥{formatMoney(calcResult.totalAmount)}</span>
                  </div>
                  <div className="summary-divider">=</div>
                  <div className={`summary-item net ${calcResult.prizeInfo.netProfit >= 0 ? 'profit' : 'loss'}`}>
                    <span className="summary-label">净利润</span>
                    <span className="summary-value">
                      {calcResult.prizeInfo.netProfit >= 0 ? '+' : ''}¥{formatMoney(Math.abs(calcResult.prizeInfo.netProfit))}
                    </span>
                  </div>
                  <div className="summary-divider">→</div>
                  <div className={`summary-item roi ${parseFloat(calcResult.prizeInfo.roi) >= 0 ? 'positive' : 'negative'}`}>
                    <span className="summary-label">产出比</span>
                    <span className="summary-value">{calcResult.prizeInfo.roi}%</span>
                  </div>
                </div>

                {/* 各奖项明细 */}
                {showPrizeDetails && (
                  <div className="prize-details">
                    <table className="prize-table">
                      <thead>
                        <tr>
                          <th>奖项</th>
                          <th>中奖条件</th>
                          <th>中奖注数</th>
                          <th>奖金/注</th>
                          <th>总奖金</th>
                          <th>产出比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calcResult.prizeInfo.prizes.map((prize, idx) => (
                          <tr key={idx}>
                            <td className="prize-name">{prize.name}</td>
                            <td className="prize-match">{prize.desc}</td>
                            <td className="prize-bets">{formatMoney(prize.winBets)}</td>
                            <td className="prize-amount">¥{formatMoney(prize.basePrize * multiplier)}</td>
                            <td className="prize-total">¥{formatMoney(prize.winAmount)}</td>
                            <td className={`prize-roi ${parseFloat(prize.roi) >= 0 ? 'positive' : 'negative'}`}>{prize.roi}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="result-placeholder">
            <span className="placeholder-icon">👆</span>
            <span>请选择号码进行计算</span>
            {!calcResult.frontValid && <span className="placeholder-hint">{config.front.name}至少选{config.front.pickMin}个</span>}
            {!calcResult.backValid && <span className="placeholder-hint">{config.back.name}至少选{config.back.pickMin}个</span>}
          </div>
        )}
      </div>
    </section>
  );
}

export default CompoundCalculator;
