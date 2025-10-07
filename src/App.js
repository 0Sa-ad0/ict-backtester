import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { Upload, Play, TrendingUp, TrendingDown, DollarSign, Percent, AlertCircle, Layers, Calendar } from 'lucide-react';
import Papa from 'papaparse';

const ICTMultiTFBacktester = () => {
  const [timeframes, setTimeframes] = useState({
    m1: null,
    m5: null,
    h1: null,
    h4: null,
    daily: null
  });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({
    initialBalance: 10000,
    riskPerTrade: 2,
    riskRewardRatio: 3,
    useKillZones: true,
    minConfluence: 2, // Lowered for easier testing
    useM1: false,
    obLookback: 20,
    fvgMinPips: 10,
    stopLossPips: 20,
    maxTradesPerDay: 3
  });

  const parseCSV = (file, isDaily = false) => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const parsed = [];
            
            for (let i = 1; i < results.data.length; i++) {
              const row = results.data[i];
              if (!row || !row[0]) continue;
              
              // Split by tab
              const parts = String(row[0]).split('\t').map(p => p.trim());
              if (parts.length < 7) continue;
              
              let candle;
              if (isDaily) {
                // Daily format: DATE, OPEN, HIGH, LOW, CLOSE, TICKVOL, VOL, SPREAD
                candle = {
                  date: parts[0],
                  time: '00:00',
                  open: parseFloat(parts[1]),
                  high: parseFloat(parts[2]),
                  low: parseFloat(parts[3]),
                  close: parseFloat(parts[4]),
                  volume: parseFloat(parts[5]) || 0,
                  timestamp: new Date(parts[0])
                };
              } else {
                // Intraday format: DATE, TIME, OPEN, HIGH, LOW, CLOSE, TICKVOL, VOL, SPREAD
                candle = {
                  date: parts[0],
                  time: parts[1],
                  open: parseFloat(parts[2]),
                  high: parseFloat(parts[3]),
                  low: parseFloat(parts[4]),
                  close: parseFloat(parts[5]),
                  volume: parseFloat(parts[6]) || 0,
                  timestamp: new Date(`${parts[0]} ${parts[1]}`)
                };
              }
              
              // Validate candle
              if (!isNaN(candle.open) && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close) && 
                  candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 &&
                  !isNaN(candle.timestamp.getTime())) {
                parsed.push(candle);
              }
            }
            
            console.log(`Parsed ${parsed.length} valid candles from ${isDaily ? 'Daily' : 'Intraday'} data`);
            resolve(parsed);
          } catch (error) {
            console.error('Parse error:', error);
            reject(error);
          }
        },
        error: reject
      });
    });
  };

  const handleFileUpload = async (event, tf) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setLoading(true);
    try {
      const isDaily = tf === 'daily';
      const parsedData = await parseCSV(file, isDaily);
      console.log(`${tf.toUpperCase()}: Loaded ${parsedData.length} bars`);
      setTimeframes(prev => ({ ...prev, [tf]: parsedData }));
      setLoading(false);
    } catch (error) {
      console.error(`Error parsing ${tf}:`, error);
      alert(`Error loading ${tf} file. Check console for details.`);
      setLoading(false);
    }
  };

  const isKillZone = (date) => {
    const hour = date.getUTCHours();
    // London: 7-10 GMT, New York: 12-15 GMT
    return (hour >= 7 && hour < 10) || (hour >= 12 && hour < 15);
  };

  const findSwingPoints = (data, lookback = 5) => {
    const swings = [];
    for (let i = lookback; i < data.length - lookback; i++) {
      const highs = data.slice(i - lookback, i + lookback + 1).map(d => d.high);
      const lows = data.slice(i - lookback, i + lookback + 1).map(d => d.low);
      
      if (data[i].high === Math.max(...highs)) {
        swings.push({ index: i, type: 'high', price: data[i].high, timestamp: data[i].timestamp });
      }
      if (data[i].low === Math.min(...lows)) {
        swings.push({ index: i, type: 'low', price: data[i].low, timestamp: data[i].timestamp });
      }
    }
    return swings;
  };

  const determineMarketStructure = (swings) => {
    if (swings.length < 4) return { bias: 'neutral', structure: [] };
    
    const recentSwings = swings.slice(-6);
    const highs = recentSwings.filter(s => s.type === 'high');
    const lows = recentSwings.filter(s => s.type === 'low');
    
    if (highs.length >= 2 && lows.length >= 2) {
      const higherHighs = highs[highs.length - 1].price > highs[highs.length - 2].price;
      const higherLows = lows[lows.length - 1].price > lows[lows.length - 2].price;
      const lowerHighs = highs[highs.length - 1].price < highs[highs.length - 2].price;
      const lowerLows = lows[lows.length - 1].price < lows[lows.length - 2].price;
      
      if (higherHighs && higherLows) return { bias: 'bullish', structure: recentSwings };
      if (lowerHighs && lowerLows) return { bias: 'bearish', structure: recentSwings };
    }
    
    return { bias: 'neutral', structure: recentSwings };
  };

  const findOrderBlocks = (data, lookback = 20) => {
    const orderBlocks = [];
    
    for (let i = lookback; i < data.length - 1; i++) {
      const prevCandles = data.slice(i - lookback, i);
      const avgRange = prevCandles.reduce((sum, d) => sum + (d.high - d.low), 0) / lookback;
      const currentRange = data[i].high - data[i].low;
      const nextMove = Math.abs(data[i + 1].close - data[i].close);
      
      // Bullish OB: Large move up after this candle
      if (nextMove > avgRange * 1.5 && data[i + 1].close > data[i].close) {
        orderBlocks.push({
          index: i,
          type: 'bullish',
          high: data[i].high,
          low: data[i].low,
          open: data[i].open,
          close: data[i].close,
          timestamp: data[i].timestamp,
          strength: nextMove / avgRange
        });
      }
      
      // Bearish OB: Large move down after this candle
      if (nextMove > avgRange * 1.5 && data[i + 1].close < data[i].close) {
        orderBlocks.push({
          index: i,
          type: 'bearish',
          high: data[i].high,
          low: data[i].low,
          open: data[i].open,
          close: data[i].close,
          timestamp: data[i].timestamp,
          strength: nextMove / avgRange
        });
      }
    }
    
    return orderBlocks.slice(-100); // Keep last 100
  };

  const findFVG = (data, minPips = 10) => {
    const fvgs = [];
    const pipSize = 0.0001;
    
    for (let i = 1; i < data.length - 1; i++) {
      // Bullish FVG: gap between [i-1].high and [i+1].low
      const bullishGap = data[i + 1].low - data[i - 1].high;
      if (bullishGap > minPips * pipSize && bullishGap < 0.01) { // reasonable gap
        fvgs.push({
          index: i,
          type: 'bullish',
          top: data[i + 1].low,
          bottom: data[i - 1].high,
          mid: (data[i + 1].low + data[i - 1].high) / 2,
          timestamp: data[i].timestamp,
          size: bullishGap / pipSize
        });
      }
      
      // Bearish FVG: gap between [i-1].low and [i+1].high
      const bearishGap = data[i - 1].low - data[i + 1].high;
      if (bearishGap > minPips * pipSize && bearishGap < 0.01) {
        fvgs.push({
          index: i,
          type: 'bearish',
          top: data[i - 1].low,
          bottom: data[i + 1].high,
          mid: (data[i - 1].low + data[i + 1].high) / 2,
          timestamp: data[i].timestamp,
          size: bearishGap / pipSize
        });
      }
    }
    
    return fvgs.slice(-50); // Keep last 50
  };

  const findLiquidityZones = (data, lookback = 100) => {
    const zones = [];
    const tolerance = 0.0005; // 5 pips
    
    if (data.length < lookback) return zones;
    
    const recentData = data.slice(-lookback);
    const highs = recentData.map(d => d.high);
    const lows = recentData.map(d => d.low);
    
    // Find equal highs
    const highFreq = {};
    highs.forEach(h => {
      const rounded = Math.round(h / tolerance) * tolerance;
      highFreq[rounded] = (highFreq[rounded] || 0) + 1;
    });
    
    // Find equal lows
    const lowFreq = {};
    lows.forEach(l => {
      const rounded = Math.round(l / tolerance) * tolerance;
      lowFreq[rounded] = (lowFreq[rounded] || 0) + 1;
    });
    
    // Add significant liquidity zones
    Object.entries(highFreq).forEach(([price, count]) => {
      if (count >= 3) {
        zones.push({ type: 'sell_side', price: parseFloat(price), touches: count });
      }
    });
    
    Object.entries(lowFreq).forEach(([price, count]) => {
      if (count >= 3) {
        zones.push({ type: 'buy_side', price: parseFloat(price), touches: count });
      }
    });
    
    return zones;
  };

  const calculateConfluence = (price, type, dailyBias, h4OBs, h1FVGs, liquidityZones) => {
    let score = 0;
    const tolerance = 0.002; // 20 pips
    
    // Daily bias alignment (strongest)
    if (dailyBias.bias === type) score += 2;
    
    // H4 Order Block confluence
    const nearOB = h4OBs.filter(ob => 
      ob.type === type && 
      price >= ob.low - tolerance && 
      price <= ob.high + tolerance
    );
    score += nearOB.length * 1.5;
    
    // H1 FVG confluence
    const nearFVG = h1FVGs.filter(fvg => 
      fvg.type === type && 
      price >= fvg.bottom - tolerance && 
      price <= fvg.top + tolerance
    );
    score += nearFVG.length;
    
    // Liquidity zone confluence
    const liqType = type === 'bullish' ? 'buy_side' : 'sell_side';
    const nearLiq = liquidityZones.filter(zone => 
      zone.type === liqType && 
      Math.abs(price - zone.price) < tolerance
    );
    score += nearLiq.length * 0.5;
    
    return score;
  };

  const runBacktest = () => {
    if (!timeframes.m5 || !timeframes.h1 || !timeframes.h4 || !timeframes.daily) {
      alert('Please upload M5, H1, H4, and Daily timeframes at minimum!');
      return;
    }
    
    setLoading(true);
    
    setTimeout(() => {
      const { initialBalance, riskPerTrade, riskRewardRatio, useKillZones, minConfluence, stopLossPips, maxTradesPerDay } = settings;
      
      let balance = initialBalance;
      let trades = [];
      let equity = [];
      let peak = initialBalance;
      let maxDrawdown = 0;
      
      // Analyze higher timeframes
      const dailySwings = findSwingPoints(timeframes.daily, 3);
      const dailyBias = determineMarketStructure(dailySwings);
      
      const h4Swings = findSwingPoints(timeframes.h4, 5);
      const h4Bias = determineMarketStructure(h4Swings);
      const h4OrderBlocks = findOrderBlocks(timeframes.h4, 20);
      
      const h1Swings = findSwingPoints(timeframes.h1, 5);
      const h1FVGs = findFVG(timeframes.h1, settings.fvgMinPips);
      const h1Liquidity = findLiquidityZones(timeframes.h1);
      
      // Entry timeframe
      const entryTF = settings.useM1 && timeframes.m1 ? timeframes.m1 : timeframes.m5;
      const m5OrderBlocks = findOrderBlocks(entryTF, settings.obLookback);
      
      let tradesThisDay = 0;
      let lastTradeDate = '';
      
      // Main trading loop on M5/M1
      for (let i = 200; i < entryTF.length - 100; i++) {
        const candle = entryTF[i];
        const currentDate = candle.date;
        
        // Reset daily trade counter
        if (currentDate !== lastTradeDate) {
          tradesThisDay = 0;
          lastTradeDate = currentDate;
        }
        
        if (tradesThisDay >= maxTradesPerDay) continue;
        
        // Kill zone filter
        if (useKillZones && !isKillZone(candle.timestamp)) continue;
        
        // Must align with daily bias
        if (dailyBias.bias === 'neutral') continue;
        
        // BULLISH SETUP
        if (dailyBias.bias === 'bullish' && h4Bias.bias === 'bullish') {
          const confluence = calculateConfluence(candle.close, 'bullish', dailyBias, h4OrderBlocks, h1FVGs, h1Liquidity);
          
          if (confluence >= minConfluence) {
            // Look for bullish entry: OB or FVG touch
            const bullishOB = m5OrderBlocks.find(ob => 
              ob.type === 'bullish' && 
              candle.low <= ob.high && 
              candle.low >= ob.low
            );
            
            const bullishFVG = h1FVGs.find(fvg => 
              fvg.type === 'bullish' && 
              candle.low <= fvg.top && 
              candle.low >= fvg.bottom
            );
            
            if (bullishOB || bullishFVG) {
              const entry = candle.close;
              const stopLoss = candle.low - (stopLossPips * 0.0001);
              const riskPips = (entry - stopLoss) / 0.0001;
              const takeProfit = entry + (entry - stopLoss) * riskRewardRatio;
              const riskAmount = balance * (riskPerTrade / 100);
              
              // Simulate trade
              let outcome = 'none';
              let exitIndex = i;
              
              for (let j = i + 1; j < Math.min(i + 200, entryTF.length); j++) {
                if (entryTF[j].low <= stopLoss) {
                  outcome = 'loss';
                  balance -= riskAmount;
                  exitIndex = j;
                  break;
                }
                if (entryTF[j].high >= takeProfit) {
                  outcome = 'win';
                  balance += riskAmount * riskRewardRatio;
                  exitIndex = j;
                  break;
                }
              }
              
              if (outcome !== 'none') {
                trades.push({
                  timestamp: candle.timestamp,
                  exitTimestamp: entryTF[exitIndex].timestamp,
                  type: 'long',
                  entry,
                  stopLoss,
                  takeProfit,
                  outcome,
                  pnl: outcome === 'win' ? riskAmount * riskRewardRatio : -riskAmount,
                  balance,
                  confluence,
                  riskPips: riskPips.toFixed(1),
                  setup: bullishOB ? 'OB' : 'FVG'
                });
                tradesThisDay++;
                i = exitIndex; // Skip to exit
              }
            }
          }
        }
        
        // BEARISH SETUP
        if (dailyBias.bias === 'bearish' && h4Bias.bias === 'bearish') {
          const confluence = calculateConfluence(candle.close, 'bearish', dailyBias, h4OrderBlocks, h1FVGs, h1Liquidity);
          
          if (confluence >= minConfluence) {
            const bearishOB = m5OrderBlocks.find(ob => 
              ob.type === 'bearish' && 
              candle.high >= ob.low && 
              candle.high <= ob.high
            );
            
            const bearishFVG = h1FVGs.find(fvg => 
              fvg.type === 'bearish' && 
              candle.high >= fvg.bottom && 
              candle.high <= fvg.top
            );
            
            if (bearishOB || bearishFVG) {
              const entry = candle.close;
              const stopLoss = candle.high + (stopLossPips * 0.0001);
              const riskPips = (stopLoss - entry) / 0.0001;
              const takeProfit = entry - (stopLoss - entry) * riskRewardRatio;
              const riskAmount = balance * (riskPerTrade / 100);
              
              let outcome = 'none';
              let exitIndex = i;
              
              for (let j = i + 1; j < Math.min(i + 200, entryTF.length); j++) {
                if (entryTF[j].high >= stopLoss) {
                  outcome = 'loss';
                  balance -= riskAmount;
                  exitIndex = j;
                  break;
                }
                if (entryTF[j].low <= takeProfit) {
                  outcome = 'win';
                  balance += riskAmount * riskRewardRatio;
                  exitIndex = j;
                  break;
                }
              }
              
              if (outcome !== 'none') {
                trades.push({
                  timestamp: candle.timestamp,
                  exitTimestamp: entryTF[exitIndex].timestamp,
                  type: 'short',
                  entry,
                  stopLoss,
                  takeProfit,
                  outcome,
                  pnl: outcome === 'win' ? riskAmount * riskRewardRatio : -riskAmount,
                  balance,
                  confluence,
                  riskPips: riskPips.toFixed(1),
                  setup: bearishOB ? 'OB' : 'FVG'
                });
                tradesThisDay++;
                i = exitIndex;
              }
            }
          }
        }
        
        // Track equity
        if (i % 100 === 0) {
          equity.push({ timestamp: candle.timestamp, balance });
          if (balance > peak) peak = balance;
          const drawdown = ((peak - balance) / peak) * 100;
          if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }
      }
      
      // Calculate metrics
      const wins = trades.filter(t => t.outcome === 'win').length;
      const losses = trades.filter(t => t.outcome === 'loss').length;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      const totalProfit = trades.filter(t => t.outcome === 'win').reduce((sum, t) => sum + t.pnl, 0);
      const totalLoss = Math.abs(trades.filter(t => t.outcome === 'loss').reduce((sum, t) => sum + t.pnl, 0));
      const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
      const netProfit = balance - initialBalance;
      const returnPct = ((balance - initialBalance) / initialBalance) * 100;
      
      const avgWin = wins > 0 ? totalProfit / wins : 0;
      const avgLoss = losses > 0 ? totalLoss / losses : 0;
      const expectancy = trades.length > 0 ? ((wins / trades.length) * avgWin - (losses / trades.length) * avgLoss) : 0;
      
      setResults({
        trades,
        equity,
        metrics: {
          totalTrades: trades.length,
          wins,
          losses,
          winRate: winRate.toFixed(2),
          profitFactor: profitFactor.toFixed(2),
          netProfit: netProfit.toFixed(2),
          returnPct: returnPct.toFixed(2),
          maxDrawdown: maxDrawdown.toFixed(2),
          finalBalance: balance.toFixed(2),
          dailyBias: dailyBias.bias,
          h4Bias: h4Bias.bias,
          avgWin: avgWin.toFixed(2),
          avgLoss: avgLoss.toFixed(2),
          expectancy: expectancy.toFixed(2)
        },
        analysis: {
          dailySwings: dailySwings.length,
          h4OrderBlocks: h4OrderBlocks.length,
          h1FVGs: h1FVGs.length,
          h1Liquidity: h1Liquidity.length
        }
      });
      
      if (trades.length === 0) {
        alert(`⚠️ No trades found!\n\nPossible reasons:\n- Daily/H4 bias not aligned\n- Min confluence too high (try 2.0)\n- Kill zones filter too restrictive\n- No valid setups in data period\n\nTry lowering Min Confluence or disabling Kill Zones.`);
      }
      
      setLoading(false);
    }, 100);
  };

  const filesLoaded = Object.values(timeframes).filter(tf => tf !== null).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center justify-center gap-2">
            <Layers className="text-blue-400" />
            Multi-Timeframe ICT Backtester
          </h1>
          <p className="text-slate-300">Professional Top-Down Analysis: Daily → H4 → H1 → M5/M1</p>
        </div>

        {/* File Upload Grid */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-blue-500/30">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Upload size={20} />
            Upload Timeframes ({filesLoaded}/5)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[
              { key: 'm1', label: 'M1 (Optional)', color: 'purple', required: false },
              { key: 'm5', label: 'M5 (Entry)*', color: 'green', required: true },
              { key: 'h1', label: 'H1 (FVG)*', color: 'blue', required: true },
              { key: 'h4', label: 'H4 (OB)*', color: 'orange', required: true },
              { key: 'daily', label: 'Daily (Bias)*', color: 'red', required: true }
            ].map(tf => (
              <div key={tf.key} className="text-center">
                <label className={`block bg-${tf.color}-600 hover:bg-${tf.color}-700 text-white px-4 py-3 rounded-lg cursor-pointer transition text-sm font-bold`}>
                  {tf.label}
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFileUpload(e, tf.key)}
                    className="hidden"
                  />
                </label>
                {timeframes[tf.key] && (
                  <div className="mt-2">
                    <p className="text-green-400 text-xs font-bold">✓ {timeframes[tf.key].length.toLocaleString()} bars</p>
                    {timeframes[tf.key].length > 0 && (
                      <p className="text-slate-500 text-xs">
                        {new Date(timeframes[tf.key][0].timestamp).toLocaleDateString()} - {new Date(timeframes[tf.key][timeframes[tf.key].length - 1].timestamp).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
                {!timeframes[tf.key] && tf.required && (
                  <p className="text-yellow-400 text-xs mt-1">⚠️ Required</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Settings */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">Strategy Parameters</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-slate-400">Balance ($)</label>
              <input
                type="number"
                value={settings.initialBalance}
                onChange={(e) => setSettings({...settings, initialBalance: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400">Risk (%)</label>
              <input
                type="number"
                step="0.5"
                value={settings.riskPerTrade}
                onChange={(e) => setSettings({...settings, riskPerTrade: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400">R:R Ratio</label>
              <input
                type="number"
                step="0.5"
                value={settings.riskRewardRatio}
                onChange={(e) => setSettings({...settings, riskRewardRatio: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 flex items-center gap-1">
                Min Confluence
                <span className="cursor-help" title="Higher = more selective. Score from Daily bias (2), H4 OB (1.5), H1 FVG (1), Liquidity (0.5)">ℹ️</span>
              </label>
              <input
                type="number"
                step="0.5"
                value={settings.minConfluence}
                onChange={(e) => setSettings({...settings, minConfluence: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">2=Relaxed, 3=Balanced, 4+=Strict</p>
            </div>
            <div>
              <label className="text-sm text-slate-400">Stop Loss (pips)</label>
              <input
                type="number"
                value={settings.stopLossPips}
                onChange={(e) => setSettings({...settings, stopLossPips: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400">Max Trades/Day</label>
              <input
                type="number"
                value={settings.maxTradesPerDay}
                onChange={(e) => setSettings({...settings, maxTradesPerDay: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 flex items-center gap-1">
                FVG Min (pips)
                <span className="cursor-help" title="Minimum gap size to be considered a Fair Value Gap">ℹ️</span>
              </label>
              <input
                type="number"
                value={settings.fvgMinPips}
                onChange={(e) => setSettings({...settings, fvgMinPips: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">10-15 pips typical</p>
            </div>
            <div className="flex items-end">
              <label className="flex items-center text-white text-sm cursor-help" title="Only trade during London (7-10 GMT) or New York (12-15 GMT) sessions">
                <input
                  type="checkbox"
                  checked={settings.useKillZones}
                  onChange={(e) => setSettings({...settings, useKillZones: e.target.checked})}
                  className="mr-2"
                />
                Kill Zones Only
              </label>
            </div>
            <div className="flex items-end">
              <label className="flex items-center text-white text-sm cursor-help" title="Use 1-minute chart for entries instead of 5-minute (requires M1 data)">
                <input
                  type="checkbox"
                  checked={settings.useM1}
                  onChange={(e) => setSettings({...settings, useM1: e.target.checked})}
                  className="mr-2"
                  disabled={!timeframes.m1}
                />
                Use M1 Entry
              </label>
            </div>
            <div className="flex items-end">
              <button
                onClick={runBacktest}
                disabled={filesLoaded < 4 || loading}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white px-4 py-2 rounded-lg transition font-bold"
              >
                {loading ? '⏳ Running...' : '🚀 Run Backtest'}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {results && (
          <>
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-lg p-4 border border-green-500">
                <div className="flex items-center gap-2 text-green-100 mb-2">
                  <DollarSign size={18} />
                  <span className="text-sm font-bold">Net Profit</span>
                </div>
                <p className="text-3xl font-bold text-white">${results.metrics.netProfit}</p>
                <p className="text-sm text-green-100 mt-1">{results.metrics.returnPct}% return</p>
              </div>

              <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-4 border border-blue-500">
                <div className="flex items-center gap-2 text-blue-100 mb-2">
                  <Percent size={18} />
                  <span className="text-sm font-bold">Win Rate</span>
                </div>
                <p className="text-3xl font-bold text-white">{results.metrics.winRate}%</p>
                <p className="text-sm text-blue-100 mt-1">{results.metrics.wins}W / {results.metrics.losses}L</p>
              </div>

              <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg p-4 border border-purple-500">
                <div className="flex items-center gap-2 text-purple-100 mb-2">
                  <TrendingUp size={18} />
                  <span className="text-sm font-bold">Profit Factor</span>
                </div>
                <p className="text-3xl font-bold text-white">{results.metrics.profitFactor}</p>
                <p className="text-sm text-purple-100 mt-1">{results.metrics.totalTrades} trades</p>
              </div>

              <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-lg p-4 border border-orange-500">
                <div className="flex items-center gap-2 text-orange-100 mb-2">
                  <TrendingDown size={18} />
                  <span className="text-sm font-bold">Max DD</span>
                </div>
                <p className="text-3xl font-bold text-white">{results.metrics.maxDrawdown}%</p>
                <p className="text-sm text-orange-100 mt-1">Peak to trough</p>
              </div>

              <div className="bg-gradient-to-br from-pink-600 to-pink-700 rounded-lg p-4 border border-pink-500">
                <div className="flex items-center gap-2 text-pink-100 mb-2">
                  <Calendar size={18} />
                  <span className="text-sm font-bold">Expectancy</span>
                </div>
                <p className="text-3xl font-bold text-white">${results.metrics.expectancy}</p>
                <p className="text-sm text-pink-100 mt-1">Per trade</p>
              </div>
            </div>

            {/* Market Analysis */}
            <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
              <h3 className="text-xl font-bold text-white mb-4">Multi-Timeframe Analysis</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-700 rounded p-4">
                  <p className="text-sm text-slate-400">Daily Bias</p>
                  <p className={`text-2xl font-bold ${results.metrics.dailyBias === 'bullish' ? 'text-green-400' : results.metrics.dailyBias === 'bearish' ? 'text-red-400' : 'text-slate-400'}`}>
                    {results.metrics.dailyBias.toUpperCase()}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{results.analysis.dailySwings} swing points</p>
                </div>
                <div className="bg-slate-700 rounded p-4">
                  <p className="text-sm text-slate-400">H4 Structure</p>
                  <p className={`text-2xl font-bold ${results.metrics.h4Bias === 'bullish' ? 'text-green-400' : results.metrics.h4Bias === 'bearish' ? 'text-red-400' : 'text-slate-400'}`}>
                    {results.metrics.h4Bias.toUpperCase()}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{results.analysis.h4OrderBlocks} order blocks</p>
                </div>
                <div className="bg-slate-700 rounded p-4">
                  <p className="text-sm text-slate-400">H1 FVGs</p>
                  <p className="text-2xl font-bold text-blue-400">{results.analysis.h1FVGs}</p>
                  <p className="text-xs text-slate-400 mt-1">Fair value gaps</p>
                </div>
                <div className="bg-slate-700 rounded p-4">
                  <p className="text-sm text-slate-400">Liquidity Zones</p>
                  <p className="text-2xl font-bold text-purple-400">{results.analysis.h1Liquidity}</p>
                  <p className="text-xs text-slate-400 mt-1">Equal highs/lows</p>
                </div>
              </div>
            </div>

            {/* Performance Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <h3 className="text-xl font-bold text-white mb-4">Trade Statistics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Average Win</span>
                    <span className="text-green-400 font-bold">${results.metrics.avgWin}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Average Loss</span>
                    <span className="text-red-400 font-bold">${results.metrics.avgLoss}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Expectancy</span>
                    <span className="text-blue-400 font-bold">${results.metrics.expectancy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Final Balance</span>
                    <span className="text-white font-bold">${results.metrics.finalBalance}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <h3 className="text-xl font-bold text-white mb-4">Risk Metrics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Risk per Trade</span>
                    <span className="text-white font-bold">{settings.riskPerTrade}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">R:R Ratio</span>
                    <span className="text-white font-bold">1:{settings.riskRewardRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Drawdown</span>
                    <span className="text-orange-400 font-bold">{results.metrics.maxDrawdown}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Profit Factor</span>
                    <span className="text-purple-400 font-bold">{results.metrics.profitFactor}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Equity Curve */}
            <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
              <h3 className="text-xl font-bold text-white mb-4">Equity Curve</h3>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={results.equity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis 
                    dataKey="timestamp" 
                    tick={{fill: '#94a3b8', fontSize: 12}} 
                    tickFormatter={(v) => new Date(v).toLocaleDateString()} 
                  />
                  <YAxis tick={{fill: '#94a3b8'}} domain={['dataMin - 500', 'dataMax + 500']} />
                  <Tooltip
                    contentStyle={{backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px'}}
                    labelStyle={{color: '#e2e8f0'}}
                    formatter={(value) => [`${value.toFixed(2)}`, 'Balance']}
                    labelFormatter={(v) => new Date(v).toLocaleString()}
                  />
                  <Area type="monotone" dataKey="balance" fill="#3b82f680" stroke="#3b82f6" strokeWidth={2} />
                  <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={3} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Win/Loss Distribution */}
            <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
              <h3 className="text-xl font-bold text-white mb-4">Win/Loss Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[
                  { name: 'Wins', value: results.metrics.wins, fill: '#10b981' },
                  { name: 'Losses', value: results.metrics.losses, fill: '#ef4444' }
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{fill: '#94a3b8'}} />
                  <YAxis tick={{fill: '#94a3b8'}} />
                  <Tooltip
                    contentStyle={{backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px'}}
                    labelStyle={{color: '#e2e8f0'}}
                  />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Trade Journal */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h3 className="text-xl font-bold text-white mb-4">Trade Journal (Last 30 Trades)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700">
                      <th className="pb-3 pr-4">Entry Time</th>
                      <th className="pb-3 pr-4">Exit Time</th>
                      <th className="pb-3 pr-4">Type</th>
                      <th className="pb-3 pr-4">Setup</th>
                      <th className="pb-3 pr-4">Entry</th>
                      <th className="pb-3 pr-4">SL</th>
                      <th className="pb-3 pr-4">TP</th>
                      <th className="pb-3 pr-4">Risk (pips)</th>
                      <th className="pb-3 pr-4">Result</th>
                      <th className="pb-3 pr-4">P&L</th>
                      <th className="pb-3 pr-4">Confluence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.trades.slice(-30).reverse().map((trade, idx) => (
                      <tr key={idx} className="border-b border-slate-700 text-slate-300 hover:bg-slate-700/50">
                        <td className="py-3 pr-4 text-xs">{new Date(trade.timestamp).toLocaleString()}</td>
                        <td className="py-3 pr-4 text-xs">{new Date(trade.exitTimestamp).toLocaleString()}</td>
                        <td className="py-3 pr-4">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${trade.type === 'long' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                            {trade.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="px-2 py-1 rounded text-xs bg-blue-900 text-blue-300 font-bold">
                            {trade.setup}
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-mono">{trade.entry.toFixed(5)}</td>
                        <td className="py-3 pr-4 font-mono text-xs">{trade.stopLoss.toFixed(5)}</td>
                        <td className="py-3 pr-4 font-mono text-xs">{trade.takeProfit.toFixed(5)}</td>
                        <td className="py-3 pr-4 text-yellow-400">{trade.riskPips}</td>
                        <td className="py-3 pr-4">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${trade.outcome === 'win' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                            {trade.outcome.toUpperCase()}
                          </span>
                        </td>
                        <td className={`py-3 pr-4 font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${trade.pnl.toFixed(2)}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="px-2 py-1 rounded text-xs bg-purple-900 text-purple-300 font-bold">
                            {trade.confluence.toFixed(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Info Guide */}
        {!results && filesLoaded === 0 && (
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-8 border border-blue-500/30">
            <div className="text-center mb-6">
              <AlertCircle size={56} className="mx-auto text-blue-400 mb-4" />
              <h3 className="text-2xl font-bold text-white mb-2">Professional Multi-Timeframe ICT Strategy</h3>
              <p className="text-slate-400">Top-down analysis using institutional order flow concepts</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
              <div className="bg-slate-700/50 rounded-lg p-5 border border-slate-600">
                <h4 className="font-bold text-white mb-3 text-lg flex items-center gap-2">
                  <span className="text-2xl">📊</span> Timeframe Hierarchy
                </h4>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li><strong className="text-red-400">Daily:</strong> Overall market bias & direction</li>
                  <li><strong className="text-orange-400">H4:</strong> Institutional order blocks & structure</li>
                  <li><strong className="text-blue-400">H1:</strong> Fair value gaps & liquidity zones</li>
                  <li><strong className="text-green-400">M5:</strong> Precise entry execution</li>
                  <li><strong className="text-purple-400">M1:</strong> Optional ultra-precise entries</li>
                </ul>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-5 border border-slate-600">
                <h4 className="font-bold text-white mb-3 text-lg flex items-center gap-2">
                  <span className="text-2xl">🎯</span> Entry Requirements
                </h4>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>✅ Daily & H4 bias must align</li>
                  <li>✅ Touch H4 order block or H1 FVG</li>
                  <li>✅ Confluence score ≥ minimum threshold</li>
                  <li>✅ Inside kill zone hours (London/NY)</li>
                  <li>✅ Respect daily trade limit</li>
                </ul>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-5 border border-slate-600">
                <h4 className="font-bold text-white mb-3 text-lg flex items-center gap-2">
                  <span className="text-2xl">🔥</span> ICT Core Concepts
                </h4>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li><strong className="text-yellow-400">Order Blocks:</strong> Last candle before impulse move</li>
                  <li><strong className="text-cyan-400">FVG:</strong> Price imbalance gaps for retracement</li>
                  <li><strong className="text-pink-400">Liquidity:</strong> Equal highs/lows for stop hunts</li>
                  <li><strong className="text-green-400">Kill Zones:</strong> High volatility trading windows</li>
                </ul>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-5 border border-slate-600">
                <h4 className="font-bold text-white mb-3 text-lg flex items-center gap-2">
                  <span className="text-2xl">⚡</span> Risk Management
                </h4>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li><strong>Risk:</strong> 1-2% per trade recommended</li>
                  <li><strong>R:R:</strong> Minimum 1:3 ratio</li>
                  <li><strong>Stop Loss:</strong> Below/above structure (20 pips)</li>
                  <li><strong>Daily Limit:</strong> Max 3 trades to avoid overtrading</li>
                </ul>
              </div>
            </div>

            <div className="mt-8 p-4 bg-blue-900/30 border border-blue-500/50 rounded-lg">
              <p className="text-blue-300 text-center text-sm">
                <strong>Pro Tip:</strong> Higher confluence scores (3+) = higher probability trades. The strategy waits for perfect alignment across timeframes before entering.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ICTMultiTFBacktester;