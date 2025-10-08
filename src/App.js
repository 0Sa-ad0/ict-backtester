import React, { useState } from 'react';
import { Play, TrendingUp, Award, Bell, Target, BarChart3, Zap, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import Papa from 'papaparse';

const CompleteTradingSystem = () => {
  const [files, setFiles] = useState({ m5: null, h1: null, h4: null, daily: null });
  const [mode, setMode] = useState('backtest');
  const [strategy, setStrategy] = useState('combined');
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const [liveSignals, setLiveSignals] = useState([]);
  const [forwardTest, setForwardTest] = useState(null);
  const [backtestResult, setBacktestResult] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [settings, setSettings] = useState({
    strongBodyMin: 0.5,
    lookbackPeriod: 20,
    wickMinPercent: 0.6,
    minConfluence: 2.0,
    fvgMinPips: 10,
    stopLossPips: 15,
    riskRewardRatio: 2,
    useTrailingStop: true,
    trailingStopPips: 15,
    useKillZones: false,
    maxTradesPerDay: 5,
    forwardTestDays: 30,
    optimizeFrom: 70,
    optimizeTo: 100
  });

  const parseCSV = (file, isDaily = false) => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        delimiter: '\t',
        complete: (results) => {
          try {
            const parsed = [];
            for (let i = 1; i < results.data.length; i++) {
              const row = results.data[i];
              if (!row || row.length === 0) continue;
              
              let parts;
              if (typeof row[0] === 'string' && row.length === 1) {
                parts = row[0].split('\t');
              } else if (Array.isArray(row)) {
                parts = row;
              } else continue;
              
              parts = parts.map(p => String(p).replace(/[<>]/g, '').trim()).filter(p => p);
              if (parts.length < 5) continue;
              
              let candle;
              if (isDaily) {
                candle = {
                  date: parts[0],
                  time: '00:00',
                  open: parseFloat(parts[1]),
                  high: parseFloat(parts[2]),
                  low: parseFloat(parts[3]),
                  close: parseFloat(parts[4]),
                  volume: parseFloat(parts[5] || 0),
                  timestamp: new Date(parts[0])
                };
              } else {
                candle = {
                  date: parts[0],
                  time: parts[1],
                  open: parseFloat(parts[2]),
                  high: parseFloat(parts[3]),
                  low: parseFloat(parts[4]),
                  close: parseFloat(parts[5]),
                  volume: parseFloat(parts[6] || 0),
                  timestamp: new Date(`${parts[0]} ${parts[1]}`)
                };
              }
              
              const isValid = 
                !isNaN(candle.open) && candle.open > 0 &&
                !isNaN(candle.high) && candle.high > 0 &&
                !isNaN(candle.low) && candle.low > 0 &&
                !isNaN(candle.close) && candle.close > 0 &&
                candle.high >= candle.low &&
                !isNaN(candle.timestamp.getTime()) &&
                candle.timestamp.getFullYear() > 2000;
              
              if (isValid) parsed.push(candle);
            }
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        },
        error: reject
      });
    });
  };

  const handleFileUpload = async (e, tf) => {
    const file = e.target.files[0];
    if (!file) return;
    const isDaily = tf === 'daily';
    const data = await parseCSV(file, isDaily);
    setFiles(prev => ({ ...prev, [tf]: data }));
  };

  const detectPriceAction = (data, params) => {
    const signals = [];
    const { strongBodyMin, lookbackPeriod, wickMinPercent } = params;
    
    for (let i = lookbackPeriod; i < data.length; i++) {
      const c = data[i];
      const body = Math.abs(c.close - c.open);
      const range = c.high - c.low;
      const bodyPercent = range > 0 ? body / range : 0;
      
      const isGreen = c.close > c.open;
      const isRed = c.close < c.open;
      
      const recentHigh = Math.max(...data.slice(i - lookbackPeriod, i).map(d => d.high));
      const recentLow = Math.min(...data.slice(i - lookbackPeriod, i).map(d => d.low));
      const momentum = i >= 3 ? c.close - data[i - 3].close : 0;
      
      const momentumLong = isGreen && bodyPercent >= strongBodyMin && momentum > 0;
      const momentumShort = isRed && bodyPercent >= strongBodyMin && momentum < 0;
      
      const breakoutLong = isGreen && bodyPercent >= strongBodyMin && c.high > recentHigh;
      const breakoutShort = isRed && bodyPercent >= strongBodyMin && c.low < recentLow;
      
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWickPct = range > 0 ? lowerWick / range : 0;
      const upperWickPct = range > 0 ? upperWick / range : 0;
      
      const rejectionLong = isGreen && lowerWickPct >= wickMinPercent && c.low <= recentLow * 1.001;
      const rejectionShort = isRed && upperWickPct >= wickMinPercent && c.high >= recentHigh * 0.999;
      
      if (momentumLong || breakoutLong || rejectionLong) {
        signals.push({
          index: i,
          type: 'long',
          setup: momentumLong ? 'momentum' : breakoutLong ? 'breakout' : 'rejection',
          price: c.close,
          timestamp: c.timestamp,
          bodyPercent: (bodyPercent * 100).toFixed(1)
        });
      }
      
      if (momentumShort || breakoutShort || rejectionShort) {
        signals.push({
          index: i,
          type: 'short',
          setup: momentumShort ? 'momentum' : breakoutShort ? 'breakout' : 'rejection',
          price: c.close,
          timestamp: c.timestamp,
          bodyPercent: (bodyPercent * 100).toFixed(1)
        });
      }
    }
    
    return signals;
  };

  const findOrderBlocks = (data, lookback = 20) => {
    const obs = [];
    for (let i = lookback; i < data.length - 1; i++) {
      const avgMove = data.slice(i - lookback, i).reduce((sum, d, idx, arr) => {
        if (idx === 0) return 0;
        return sum + Math.abs(arr[idx].close - arr[idx - 1].close);
      }, 0) / lookback;
      
      const move = Math.abs(data[i + 1].close - data[i].close);
      if (move > avgMove * 1.5) {
        obs.push({
          index: i,
          type: data[i + 1].close > data[i].close ? 'bullish' : 'bearish',
          high: data[i].high,
          low: data[i].low,
          timestamp: data[i].timestamp
        });
      }
    }
    return obs.slice(-50);
  };

  const findFVG = (data, minPips = 10) => {
    const fvgs = [];
    const pipSize = 0.0001;
    
    for (let i = 1; i < data.length - 1; i++) {
      const bullGap = data[i + 1].low - data[i - 1].high;
      if (bullGap > minPips * pipSize && bullGap < 0.01) {
        fvgs.push({
          type: 'bullish',
          top: data[i + 1].low,
          bottom: data[i - 1].high,
          timestamp: data[i].timestamp
        });
      }
      
      const bearGap = data[i - 1].low - data[i + 1].high;
      if (bearGap > minPips * pipSize && bearGap < 0.01) {
        fvgs.push({
          type: 'bearish',
          top: data[i - 1].low,
          bottom: data[i + 1].high,
          timestamp: data[i].timestamp
        });
      }
    }
    return fvgs.slice(-30);
  };

  const calculateConfluence = (signal, h4OBs, h1FVGs) => {
    let score = 0;
    const tolerance = 0.002;
    
    const nearOB = h4OBs.filter(ob => 
      ob.type === signal.type && 
      signal.price >= ob.low - tolerance && 
      signal.price <= ob.high + tolerance
    );
    score += nearOB.length * 1.5;
    
    const nearFVG = h1FVGs.filter(fvg => 
      fvg.type === signal.type && 
      signal.price >= fvg.bottom - tolerance && 
      signal.price <= fvg.top + tolerance
    );
    score += nearFVG.length;
    
    return score;
  };

  const runBacktest = (params, isForward = false) => {
    const data = files.m5;
    if (!data || data.length < 200) return null;
    
    const splitIdx = Math.floor(data.length * (params.optimizeFrom / 100));
    const testData = isForward ? data.slice(splitIdx) : data.slice(0, splitIdx);
    
    let balance = 10000;
    const initialBalance = 10000;
    let trades = [];
    let peak = 10000;
    let maxDD = 0;
    
    let h4OBs = [], h1FVGs = [];
    if (strategy === 'combined' && files.h4 && files.h1) {
      h4OBs = findOrderBlocks(files.h4, 20);
      h1FVGs = findFVG(files.h1, params.fvgMinPips);
    }
    
    let signals = detectPriceAction(testData, params);
    
    if (strategy === 'combined') {
      signals = signals.map(sig => ({
        ...sig,
        confluence: calculateConfluence(sig, h4OBs, h1FVGs)
      })).filter(sig => sig.confluence >= params.minConfluence);
    }
    
    let tradesThisDay = 0;
    let lastDate = '';
    
    for (const signal of signals) {
      const candle = testData[signal.index];
      const currentDate = candle.date;
      
      if (currentDate !== lastDate) {
        tradesThisDay = 0;
        lastDate = currentDate;
      }
      
      if (tradesThisDay >= params.maxTradesPerDay) continue;
      
      if (params.useKillZones) {
        const hour = candle.timestamp.getUTCHours();
        if (!((hour >= 7 && hour < 10) || (hour >= 12 && hour < 15))) continue;
      }
      
      const entry = signal.price;
      let outcome = 'none';
      let exitPrice = entry;
      let exitReason = '';
      let pnl = 0;
      
      if (signal.type === 'long') {
        let sl = entry - (params.stopLossPips * 0.0001);
        const tp = entry + (params.stopLossPips * params.riskRewardRatio * 0.0001);
        
        for (let j = signal.index + 1; j < Math.min(signal.index + 100, testData.length); j++) {
          const c = testData[j];
          
          if (params.useTrailingStop) {
            const newSL = c.close - (params.trailingStopPips * 0.0001);
            if (newSL > sl) sl = newSL;
          }
          
          if (c.low <= sl) {
            outcome = 'loss';
            exitPrice = sl;
            exitReason = 'SL';
            pnl = (sl - entry) / 0.0001 * 0.10;
            balance += pnl;
            break;
          }
          if (c.high >= tp) {
            outcome = 'win';
            exitPrice = tp;
            exitReason = 'TP';
            pnl = (tp - entry) / 0.0001 * 0.10;
            balance += pnl;
            break;
          }
        }
      } else {
        let sl = entry + (params.stopLossPips * 0.0001);
        const tp = entry - (params.stopLossPips * params.riskRewardRatio * 0.0001);
        
        for (let j = signal.index + 1; j < Math.min(signal.index + 100, testData.length); j++) {
          const c = testData[j];
          
          if (params.useTrailingStop) {
            const newSL = c.close + (params.trailingStopPips * 0.0001);
            if (newSL < sl) sl = newSL;
          }
          
          if (c.high >= sl) {
            outcome = 'loss';
            exitPrice = sl;
            exitReason = 'SL';
            pnl = (entry - sl) / 0.0001 * 0.10;
            balance += pnl;
            break;
          }
          if (c.low <= tp) {
            outcome = 'win';
            exitPrice = tp;
            exitReason = 'TP';
            pnl = (entry - tp) / 0.0001 * 0.10;
            balance += pnl;
            break;
          }
        }
      }
      
      if (outcome !== 'none') {
        trades.push({
          timestamp: signal.timestamp,
          type: signal.type,
          setup: signal.setup,
          entry,
          exitPrice,
          outcome,
          pnl,
          balance,
          confluence: signal.confluence || 0,
          bodyPercent: signal.bodyPercent,
          reason: exitReason
        });
        tradesThisDay++;
        
        if (balance > peak) peak = balance;
        const dd = ((peak - balance) / peak) * 100;
        if (dd > maxDD) maxDD = dd;
      }
    }
    
    if (trades.length === 0) return null;
    
    const wins = trades.filter(t => t.outcome === 'win').length;
    const losses = trades.filter(t => t.outcome === 'loss').length;
    const winRate = (wins / trades.length) * 100;
    const totalProfit = trades.filter(t => t.outcome === 'win').reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = Math.abs(trades.filter(t => t.outcome === 'loss').reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
    const netProfit = balance - initialBalance;
    const returnPct = (netProfit / initialBalance) * 100;
    const avgWin = wins > 0 ? totalProfit / wins : 0;
    const avgLoss = losses > 0 ? totalLoss / losses : 0;
    const expectancy = (wins / trades.length) * avgWin - (losses / trades.length) * avgLoss;
    
    return {
      trades,
      metrics: {
        totalTrades: trades.length,
        wins,
        losses,
        winRate: winRate.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        netProfit: netProfit.toFixed(2),
        returnPct: returnPct.toFixed(2),
        maxDrawdown: maxDD.toFixed(2),
        finalBalance: balance.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        expectancy: expectancy.toFixed(2)
      }
    };
  };

  const runOptimization = async () => {
    if (!files.m5) {
      alert('Upload M5 data first!');
      return;
    }
    
    setOptimizing(true);
    setProgress(0);
    await new Promise(r => setTimeout(r, 100));
    
    const combos = [];
    const ranges = {
      strongBodyMin: [0.4, 0.5, 0.6, 0.7],
      lookbackPeriod: [15, 20, 25],
      wickMinPercent: [0.5, 0.6, 0.7],
      minConfluence: [1.5, 2.0, 2.5, 3.0],
      fvgMinPips: [8, 10, 12, 15],
      stopLossPips: [15, 20, 25],
      riskRewardRatio: [2, 2.5, 3],
      useKillZones: [true, false],
      maxTradesPerDay: [3, 5, 7]
    };
    
    for (const strongBody of ranges.strongBodyMin) {
      for (const lookback of ranges.lookbackPeriod) {
        for (const wick of ranges.wickMinPercent) {
          for (const conf of ranges.minConfluence) {
            for (const fvg of ranges.fvgMinPips) {
              for (const sl of ranges.stopLossPips) {
                for (const rr of ranges.riskRewardRatio) {
                  for (const kz of ranges.useKillZones) {
                    for (const maxTrades of ranges.maxTradesPerDay) {
                      combos.push({
                        strongBodyMin: strongBody,
                        lookbackPeriod: lookback,
                        wickMinPercent: wick,
                        minConfluence: conf,
                        fvgMinPips: fvg,
                        stopLossPips: sl,
                        riskRewardRatio: rr,
                        useTrailingStop: true,
                        trailingStopPips: sl,
                        useKillZones: kz,
                        maxTradesPerDay: maxTrades,
                        optimizeFrom: 70,
                        optimizeTo: 100
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    
    const allResults = [];
    for (let i = 0; i < combos.length; i++) {
      const result = runBacktest(combos[i], false);
      if (result && result.metrics.totalTrades >= 10 && parseFloat(result.metrics.profitFactor) > 1.0) {
        allResults.push({
          params: combos[i],
          ...result.metrics
        });
      }
      
      if (i % 50 === 0) {
        setProgress((i / combos.length) * 100);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    
    allResults.sort((a, b) => parseFloat(b.returnPct) - parseFloat(a.returnPct));
    
    setResults(allResults.slice(0, 20));
    setProgress(100);
    setOptimizing(false);
  };

  const runForwardTest = () => {
    if (!files.m5) {
      alert('Upload M5 data!');
      return;
    }
    
    const result = runBacktest(settings, true);
    setForwardTest(result);
  };

  const generateLiveSignals = () => {
    if (!files.m5) return;
    
    const data = files.m5;
    const lastCandles = data.slice(-100);
    
    let h4OBs = [], h1FVGs = [];
    if (strategy === 'combined' && files.h4 && files.h1) {
      h4OBs = findOrderBlocks(files.h4, 20);
      h1FVGs = findFVG(files.h1, settings.fvgMinPips);
    }
    
    let signals = detectPriceAction(lastCandles, settings);
    
    if (strategy === 'combined') {
      signals = signals.map(sig => ({
        ...sig,
        confluence: calculateConfluence(sig, h4OBs, h1FVGs)
      })).filter(sig => sig.confluence >= settings.minConfluence);
    }
    
    const recentSignals = signals.slice(-10).map(sig => {
      const entry = sig.price;
      const sl = sig.type === 'long' 
        ? entry - (settings.stopLossPips * 0.0001)
        : entry + (settings.stopLossPips * 0.0001);
      const tp = sig.type === 'long'
        ? entry + (settings.stopLossPips * settings.riskRewardRatio * 0.0001)
        : entry - (settings.stopLossPips * settings.riskRewardRatio * 0.0001);
      
      return {
        ...sig,
        entry: entry.toFixed(5),
        sl: sl.toFixed(5),
        tp: tp.toFixed(5),
        slPips: settings.stopLossPips,
        tpPips: (settings.stopLossPips * settings.riskRewardRatio).toFixed(0),
        timeframe: 'M5',
        trailingStop: settings.useTrailingStop ? `${settings.trailingStopPips} pips` : 'No'
      };
    });
    
    setLiveSignals(recentSignals);
  };

  const filesLoaded = Object.values(files).filter(f => f !== null).length;
  
  const checkResults = (metrics) => {
    const redFlags = [];
    const greenFlags = [];
    
    if (parseFloat(metrics.winRate) > 70) redFlags.push("Win rate >70% (overfitting risk)");
    else if (parseFloat(metrics.winRate) >= 40) greenFlags.push("Win rate in healthy range (40-70%)");
    else redFlags.push("Win rate <40% (too low)");
    
    if (parseFloat(metrics.profitFactor) < 1.5) redFlags.push("Profit Factor <1.5 (weak edge)");
    else greenFlags.push("Profit Factor ≥1.5 (good edge)");
    
    if (parseFloat(metrics.maxDrawdown) > 30) redFlags.push("Max Drawdown >30% (too risky)");
    else greenFlags.push("Max Drawdown ≤30% (acceptable risk)");
    
    if (metrics.totalTrades < 50) redFlags.push("Less than 50 trades (not enough data)");
    else greenFlags.push("Sufficient trade sample");
    
    if (parseFloat(metrics.expectancy) < 0) redFlags.push("Negative expectancy (mathematical loser)");
    else greenFlags.push("Positive expectancy");
    
    return { redFlags, greenFlags, passed: redFlags.length === 0 };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-purple-900 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-5xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Zap className="text-yellow-400" size={48} />
            Complete Trading System
          </h1>
          <p className="text-slate-300 text-lg">4-Phase Mathematical Validation</p>
        </div>

        {/* Progress Tracker */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-purple-500/30">
          <h2 className="text-xl font-bold text-white mb-4">📍 Testing Progress</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className={`p-4 rounded-lg border-2 ${files.m5 ? 'border-green-500 bg-green-900/20' : 'border-slate-600'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{files.m5 ? '✅' : '⭕'}</span>
                <div>
                  <h3 className="text-white font-bold text-sm">Step 1: Upload Data</h3>
                  <p className="text-slate-400 text-xs">M5 CSV Required</p>
                </div>
              </div>
              {files.m5 && <p className="text-green-400 text-xs">{files.m5.length.toLocaleString()} candles loaded</p>}
            </div>
            
            <div className={`p-4 rounded-lg border-2 ${backtestResult ? 'border-green-500 bg-green-900/20' : 'border-slate-600'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{backtestResult ? '✅' : '⭕'}</span>
                <div>
                  <h3 className="text-white font-bold text-sm">Step 2: Backtest</h3>
                  <p className="text-slate-400 text-xs">Test on 70% data</p>
                </div>
              </div>
              {backtestResult && <p className="text-green-400 text-xs">PF: {backtestResult.metrics.profitFactor}</p>}
            </div>
            
            <div className={`p-4 rounded-lg border-2 ${results ? 'border-green-500 bg-green-900/20' : 'border-slate-600'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{results ? '✅' : '⭕'}</span>
                <div>
                  <h3 className="text-white font-bold text-sm">Step 3: Optimize</h3>
                  <p className="text-slate-400 text-xs">Find best params</p>
                </div>
              </div>
              {results && <p className="text-green-400 text-xs">Top: {results[0].returnPct}%</p>}
            </div>
            
            <div className={`p-4 rounded-lg border-2 ${forwardTest ? 'border-green-500 bg-green-900/20' : 'border-slate-600'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{forwardTest ? '✅' : '⭕'}</span>
                <div>
                  <h3 className="text-white font-bold text-sm">Step 4: Forward Test</h3>
                  <p className="text-slate-400 text-xs">Validate on 30%</p>
                </div>
              </div>
              {forwardTest && <p className="text-green-400 text-xs">WR: {forwardTest.metrics.winRate}%</p>}
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-purple-500/30">
          <h2 className="text-xl font-bold text-white mb-4">📂 Step 1: Upload Data ({filesLoaded}/4)</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {['m5', 'h1', 'h4', 'daily'].map(tf => (
              <div key={tf}>
                <label className={`block bg-gradient-to-r ${tf === 'm5' ? 'from-green-600 to-green-700' : 'from-blue-600 to-blue-700'} hover:opacity-90 text-white px-4 py-3 rounded-lg cursor-pointer transition text-center font-bold`}>
                  {tf.toUpperCase()} {tf === 'm5' ? '(REQUIRED)' : '(Optional)'}
                  <input type="file" accept=".csv" onChange={(e) => handleFileUpload(e, tf)} className="hidden" />
                </label>
                {files[tf] && (
                  <p className="text-green-400 text-xs mt-2 text-center font-bold">
                    ✓ {files[tf].length.toLocaleString()} bars
                  </p>
                )}
              </div>
            ))}
          </div>
          {!files.m5 && (
            <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-500 rounded text-center">
              <p className="text-yellow-300 text-sm font-bold">⚠️ M5 data is REQUIRED to start testing</p>
            </div>
          )}
        </div>

        {/* Mode Selection */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">🎯 Select Testing Mode</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <button
              onClick={() => setMode('backtest')}
              disabled={!files.m5}
              className={`p-4 rounded-lg border-2 transition ${mode === 'backtest' ? 'border-green-500 bg-green-900/30' : 'border-slate-600 hover:border-green-500/50'} ${!files.m5 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <BarChart3 className="mx-auto mb-2 text-green-400" size={32} />
              <h3 className="text-white font-bold">Backtest</h3>
              <p className="text-slate-400 text-sm mt-1">Test on 70% historical</p>
            </button>
            
            <button
              onClick={() => setMode('optimize')}
              disabled={!files.m5}
              className={`p-4 rounded-lg border-2 transition ${mode === 'optimize' ? 'border-purple-500 bg-purple-900/30' : 'border-slate-600 hover:border-purple-500/50'} ${!files.m5 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Zap className="mx-auto mb-2 text-purple-400" size={32} />
              <h3 className="text-white font-bold">Auto-Optimize</h3>
              <p className="text-slate-400 text-sm mt-1">Find best settings</p>
            </button>
            
            <button
              onClick={() => setMode('forward')}
              disabled={!files.m5}
              className={`p-4 rounded-lg border-2 transition ${mode === 'forward' ? 'border-blue-500 bg-blue-900/30' : 'border-slate-600 hover:border-blue-500/50'} ${!files.m5 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Target className="mx-auto mb-2 text-blue-400" size={32} />
              <h3 className="text-white font-bold">Forward Test</h3>
              <p className="text-slate-400 text-sm mt-1">Validate on 30%</p>
            </button>
            
            <button
              onClick={() => setMode('live')}
              disabled={!files.m5}
              className={`p-4 rounded-lg border-2 transition ${mode === 'live' ? 'border-yellow-500 bg-yellow-900/30' : 'border-slate-600 hover:border-yellow-500/50'} ${!files.m5 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Bell className="mx-auto mb-2 text-yellow-400" size={32} />
              <h3 className="text-white font-bold">Live Signals</h3>
              <p className="text-slate-400 text-sm mt-1">Get trade alerts</p>
            </button>
          </div>
        </div>

        {/* Parameters */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">⚙️ Parameters</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-slate-400">Strong Body %</label>
              <input
                type="number"
                step="0.1"
                value={settings.strongBodyMin * 100}
                onChange={(e) => setSettings({...settings, strongBodyMin: +e.target.value / 100})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400">Lookback</label>
              <input
                type="number"
                value={settings.lookbackPeriod}
                onChange={(e) => setSettings({...settings, lookbackPeriod: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
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
              <label className="text-sm text-slate-400">Risk:Reward</label>
              <input
                type="number"
                step="0.5"
                value={settings.riskRewardRatio}
                onChange={(e) => setSettings({...settings, riskRewardRatio: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400">Min Confluence</label>
              <input
                type="number"
                step="0.5"
                value={settings.minConfluence}
                onChange={(e) => setSettings({...settings, minConfluence: +e.target.value})}
                className="w-full bg-slate-700 text-white rounded px-3 py-2 mt-1"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center text-white text-sm">
                <input
                  type="checkbox"
                  checked={settings.useTrailingStop}
                  onChange={(e) => setSettings({...settings, useTrailingStop: e.target.checked})}
                  className="mr-2"
                />
                Trailing Stop
              </label>
            </div>
            <div className="flex items-end">
              <label className="flex items-center text-white text-sm">
                <input
                  type="checkbox"
                  checked={settings.useKillZones}
                  onChange={(e) => setSettings({...settings, useKillZones: e.target.checked})}
                  className="mr-2"
                />
                Kill Zones Only
              </label>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <button
            onClick={async () => {
              setLoading(true);
              await new Promise(r => setTimeout(r, 100)); // Small delay for UI update
              const result = runBacktest(settings, false);
              setBacktestResult(result);
              setLoading(false);
              
              // Scroll to results
              setTimeout(() => {
                const resultsEl = document.querySelector('.backtest-results');
                if (resultsEl) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 100);
            }}
            disabled={!files.m5 || mode !== 'backtest' || loading}
            className="bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-lg font-bold text-lg transition"
          >
            {loading && mode === 'backtest' ? '⏳ Running...' : '📊 Run Backtest'}
          </button>
          
          <button
            onClick={runOptimization}
            disabled={!files.m5 || optimizing || mode !== 'optimize'}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-lg font-bold text-lg transition"
          >
            {optimizing ? `⏳ ${progress.toFixed(0)}%` : '⚡ Auto-Optimize'}
          </button>
          
          <button
            onClick={async () => {
              setLoading(true);
              await new Promise(r => setTimeout(r, 100));
              runForwardTest();
              setLoading(false);
              
              setTimeout(() => {
                const resultsEl = document.querySelector('.forward-results');
                if (resultsEl) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 100);
            }}
            disabled={!files.m5 || mode !== 'forward' || loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-lg font-bold text-lg transition"
          >
            {loading && mode === 'forward' ? '⏳ Running...' : '🎯 Forward Test'}
          </button>
          
          <button
            onClick={async () => {
              setLoading(true);
              await new Promise(r => setTimeout(r, 100));
              generateLiveSignals();
              setLoading(false);
              
              setTimeout(() => {
                const resultsEl = document.querySelector('.live-signals');
                if (resultsEl) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 100);
            }}
            disabled={!files.m5 || mode !== 'live' || loading}
            className="bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-lg font-bold text-lg transition"
          >
            {loading && mode === 'live' ? '⏳ Running...' : '🔔 Generate Signals'}
          </button>
        </div>

        {optimizing && (
          <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-purple-500">
            <h3 className="text-white font-bold mb-4">⏳ Optimizing...</h3>
            <div className="bg-slate-700 rounded-full h-6 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-slate-400 text-center mt-2">{progress.toFixed(0)}% Complete</p>
          </div>
        )}

        {/* BACKTEST RESULTS */}
        {mode === 'backtest' && backtestResult && (() => {
          const check = checkResults(backtestResult.metrics);
          return (
            <div className="backtest-results bg-slate-800 rounded-lg p-6 mb-6 border border-green-500">
              <h2 className="text-2xl font-bold text-white mb-4">📊 Backtest Results (70% Historical Data)</h2>
              
              {check.redFlags.length > 0 && (
                <div className="mb-4 p-4 bg-red-900/30 border-2 border-red-500 rounded-lg">
                  <h3 className="text-red-400 font-bold text-lg mb-2 flex items-center gap-2">
                    <XCircle size={24} /> RED FLAGS - STRATEGY FAILED
                  </h3>
                  <ul className="space-y-1 text-sm text-red-300 mb-3">
                    {check.redFlags.map((flag, i) => <li key={i}>❌ {flag}</li>)}
                  </ul>
                  <p className="text-red-200 text-sm font-bold bg-red-900/50 p-3 rounded">
                    ⛔ DO NOT PROCEED - Strategy has no edge. Don't waste time optimizing.
                  </p>
                </div>
              )}
              
              {check.passed && (
                <div className="mb-4 p-4 bg-green-900/30 border-2 border-green-500 rounded-lg">
                  <h3 className="text-green-400 font-bold text-lg mb-2 flex items-center gap-2">
                    <CheckCircle size={24} /> ALL CHECKS PASSED
                  </h3>
                  <ul className="space-y-1 text-sm text-green-300 mb-3">
                    {check.greenFlags.map((flag, i) => <li key={i}>✅ {flag}</li>)}
                  </ul>
                  <p className="text-green-200 text-sm font-bold bg-green-900/50 p-3 rounded">
                    ✅ PROCEED TO OPTIMIZATION - Strategy shows basic edge on historical data
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-lg p-4">
                  <p className="text-green-100 text-sm mb-1">Net Profit</p>
                  <p className="text-white text-2xl font-bold">${backtestResult.metrics.netProfit}</p>
                  <p className="text-green-100 text-xs">{backtestResult.metrics.returnPct}%</p>
                </div>
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-4">
                  <p className="text-blue-100 text-sm mb-1">Win Rate</p>
                  <p className="text-white text-2xl font-bold">{backtestResult.metrics.winRate}%</p>
                  <p className="text-blue-100 text-xs">{backtestResult.metrics.wins}W/{backtestResult.metrics.losses}L</p>
                </div>
                <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg p-4">
                  <p className="text-purple-100 text-sm mb-1">Profit Factor</p>
                  <p className="text-white text-2xl font-bold">{backtestResult.metrics.profitFactor}</p>
                  <p className="text-purple-100 text-xs">{backtestResult.metrics.totalTrades} trades</p>
                </div>
                <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-lg p-4">
                  <p className="text-orange-100 text-sm mb-1">Max DD</p>
                  <p className="text-white text-2xl font-bold">{backtestResult.metrics.maxDrawdown}%</p>
                </div>
                <div className="bg-gradient-to-br from-pink-600 to-pink-700 rounded-lg p-4">
                  <p className="text-pink-100 text-sm mb-1">Expectancy</p>
                  <p className="text-white text-2xl font-bold">${backtestResult.metrics.expectancy}</p>
                </div>
              </div>
              
              {check.passed && (
                <div className="mt-4 p-4 bg-blue-900/30 border border-blue-500 rounded-lg text-center">
                  <p className="text-blue-300 font-bold mb-2">📍 NEXT STEP</p>
                  <p className="text-white text-sm">Click "Auto-Optimize" mode → Find best parameter combination</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* OPTIMIZATION RESULTS */}
        {mode === 'optimize' && results && results.length > 0 && (
          <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-purple-500">
            <h2 className="text-2xl font-bold text-white mb-4">🏆 Top 20 Optimized Results</h2>
            
            <div className="mb-6 p-4 bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border border-yellow-500/50 rounded-lg">
              <h3 className="text-xl font-bold text-yellow-400 mb-3">🥇 #1 Best Settings</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                <div>
                  <p className="text-slate-400">Return</p>
                  <p className="text-white font-bold text-xl">{results[0].returnPct}%</p>
                </div>
                <div>
                  <p className="text-slate-400">Win Rate</p>
                  <p className="text-white font-bold text-xl">{results[0].winRate}%</p>
                </div>
                <div>
                  <p className="text-slate-400">Profit Factor</p>
                  <p className="text-white font-bold text-xl">{results[0].profitFactor}</p>
                </div>
                <div>
                  <p className="text-slate-400">Trades</p>
                  <p className="text-white font-bold text-xl">{results[0].totalTrades}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-slate-900/50 p-3 rounded">
                <div><span className="text-slate-400">SL:</span> <span className="text-white font-bold">{results[0].params.stopLossPips} pips</span></div>
                <div><span className="text-slate-400">R:R:</span> <span className="text-white font-bold">1:{results[0].params.riskRewardRatio}</span></div>
                <div><span className="text-slate-400">Body%:</span> <span className="text-white font-bold">{(results[0].params.strongBodyMin * 100).toFixed(0)}%</span></div>
                <div><span className="text-slate-400">Confluence:</span> <span className="text-white font-bold">{results[0].params.minConfluence}</span></div>
              </div>
              <button
                onClick={() => setSettings(results[0].params)}
                className="mt-4 w-full bg-yellow-600 hover:bg-yellow-700 text-black font-bold py-3 rounded-lg"
              >
                ⚡ USE THESE SETTINGS
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="pb-3 text-left">Rank</th>
                    <th className="pb-3 text-left">Return%</th>
                    <th className="pb-3 text-left">Win%</th>
                    <th className="pb-3 text-left">PF</th>
                    <th className="pb-3 text-left">Trades</th>
                    <th className="pb-3 text-left">MaxDD</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 10).map((r, idx) => (
                    <tr key={idx} className="border-b border-slate-700 hover:bg-slate-700/50">
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded font-bold ${idx === 0 ? 'bg-yellow-500 text-black' : idx < 3 ? 'bg-slate-600 text-white' : 'text-slate-400'}`}>
                          #{idx + 1}
                        </span>
                      </td>
                      <td className="py-3 text-green-400 font-bold">{r.returnPct}%</td>
                      <td className="py-3 text-blue-400">{r.winRate}%</td>
                      <td className="py-3 text-purple-400">{r.profitFactor}</td>
                      <td className="py-3 text-slate-300">{r.totalTrades}</td>
                      <td className="py-3 text-orange-400">{r.maxDrawdown}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 p-4 bg-blue-900/30 border border-blue-500 rounded-lg text-center">
              <p className="text-blue-300 font-bold mb-2">📍 NEXT STEP</p>
              <p className="text-white text-sm">Click "Use These Settings" → Switch to "Forward Test" → Validate on unseen 30%</p>
            </div>
          </div>
        )}

        {/* FORWARD TEST RESULTS */}
        {mode === 'forward' && forwardTest && (
          <div className="forward-results bg-slate-800 rounded-lg p-6 mb-6 border border-blue-500">
            <h2 className="text-2xl font-bold text-white mb-4">🎯 Forward Test (30% Unseen Data)</h2>
            
            {backtestResult && (() => {
              const btWR = parseFloat(backtestResult.metrics.winRate);
              const fwWR = parseFloat(forwardTest.metrics.winRate);
              const wrDiff = Math.abs(btWR - fwWR);
              const fwProfit = parseFloat(forwardTest.metrics.netProfit);
              const fwPF = parseFloat(forwardTest.metrics.profitFactor);
              
              const passed = wrDiff <= 15 && fwProfit > 0 && fwPF >= 1.3;
              
              return (
                <>
                  {!passed && (
                    <div className="mb-4 p-4 bg-red-900/30 border-2 border-red-500 rounded-lg">
                      <h3 className="text-red-400 font-bold text-lg mb-2 flex items-center gap-2">
                        <XCircle size={24} /> FORWARD TEST FAILED
                      </h3>
                      <ul className="space-y-1 text-sm text-red-300 mb-3">
                        {wrDiff > 15 && <li>❌ Win rate changed by {wrDiff.toFixed(1)}% ({'>'}15% = doesn't generalize)</li>}
                        {fwProfit <= 0 && <li>❌ Negative profit on new data</li>}
                        {fwPF < 1.3 && <li>❌ Profit Factor too low ({fwPF.toFixed(2)})</li>}
                      </ul>
                      <p className="text-red-200 text-sm font-bold bg-red-900/50 p-3 rounded">
                        ⛔ STRATEGY OVERFITTED - Works on past but not future. DO NOT TRADE.
                      </p>
                    </div>
                  )}
                  
                  {passed && (
                    <div className="mb-4 p-4 bg-green-900/30 border-2 border-green-500 rounded-lg">
                      <h3 className="text-green-400 font-bold text-lg mb-2 flex items-center gap-2">
                        <CheckCircle size={24} /> FORWARD TEST PASSED
                      </h3>
                      <ul className="space-y-1 text-sm text-green-300 mb-3">
                        <li>✅ Win rate stable (BT: {btWR.toFixed(1)}% → FW: {fwWR.toFixed(1)}%)</li>
                        <li>✅ Positive profit on unseen data (${fwProfit.toFixed(2)})</li>
                        <li>✅ Good profit factor ({fwPF.toFixed(2)})</li>
                      </ul>
                      <p className="text-green-200 text-sm font-bold bg-green-900/50 p-3 rounded">
                        ✅ STRATEGY VALIDATED - Ready for live signal generation!
                      </p>
                    </div>
                  )}
                  
                  <div className="mb-4 p-3 bg-slate-900/50 rounded border border-blue-500/50">
                    <h4 className="text-blue-400 font-bold text-sm mb-2">📊 Backtest vs Forward:</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                      <div>
                        <p className="text-slate-400">Win Rate</p>
                        <p className="text-white">{btWR.toFixed(1)}% → {fwWR.toFixed(1)}%</p>
                        <p className={wrDiff <= 10 ? 'text-green-400' : wrDiff <= 15 ? 'text-yellow-400' : 'text-red-400'}>
                          Δ {wrDiff.toFixed(1)}% {wrDiff <= 15 ? '✅' : '❌'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Profit</p>
                        <p className="text-white">${backtestResult.metrics.netProfit} → ${forwardTest.metrics.netProfit}</p>
                        <p className={fwProfit > 0 ? 'text-green-400' : 'text-red-400'}>
                          {fwProfit > 0 ? '✅ Positive' : '❌ Negative'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Profit Factor</p>
                        <p className="text-white">{backtestResult.metrics.profitFactor} → {forwardTest.metrics.profitFactor}</p>
                        <p className={fwPF >= 1.3 ? 'text-green-400' : 'text-red-400'}>
                          {fwPF >= 1.3 ? '✅ Good' : '❌ Weak'}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-lg p-4">
                <p className="text-green-100 text-sm mb-1">Net Profit</p>
                <p className="text-white text-2xl font-bold">${forwardTest.metrics.netProfit}</p>
                <p className="text-green-100 text-xs">{forwardTest.metrics.returnPct}%</p>
              </div>
              <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-4">
                <p className="text-blue-100 text-sm mb-1">Win Rate</p>
                <p className="text-white text-2xl font-bold">{forwardTest.metrics.winRate}%</p>
                <p className="text-blue-100 text-xs">{forwardTest.metrics.wins}W/{forwardTest.metrics.losses}L</p>
              </div>
              <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg p-4">
                <p className="text-purple-100 text-sm mb-1">Profit Factor</p>
                <p className="text-white text-2xl font-bold">{forwardTest.metrics.profitFactor}</p>
              </div>
              <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-lg p-4">
                <p className="text-orange-100 text-sm mb-1">Max DD</p>
                <p className="text-white text-2xl font-bold">{forwardTest.metrics.maxDrawdown}%</p>
              </div>
              <div className="bg-gradient-to-br from-pink-600 to-pink-700 rounded-lg p-4">
                <p className="text-pink-100 text-sm mb-1">Expectancy</p>
                <p className="text-white text-2xl font-bold">${forwardTest.metrics.expectancy}</p>
              </div>
            </div>
            
            {backtestResult && parseFloat(forwardTest.metrics.netProfit) > 0 && (
              <div className="mt-4 p-4 bg-blue-900/30 border border-blue-500 rounded-lg text-center">
                <p className="text-blue-300 font-bold mb-2">📍 NEXT STEP</p>
                <p className="text-white text-sm">Switch to "Live Signals" → Paper trade 20 signals → Go live with 0.01 lot</p>
              </div>
            )}
          </div>
        )}

        {/* LIVE SIGNALS */}
        {mode === 'live' && liveSignals.length > 0 && (
          <div className="live-signals bg-slate-800 rounded-lg p-6 mb-6 border border-yellow-500">
            <h2 className="text-2xl font-bold text-white mb-4">🔔 Live Trading Signals (Last 10)</h2>
            <div className="space-y-4">
              {liveSignals.map((sig, idx) => (
                <div key={idx} className={`p-4 rounded-lg border-2 ${sig.type === 'long' ? 'border-green-500 bg-green-900/20' : 'border-red-500 bg-red-900/20'}`}>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                    <div>
                      <p className="text-slate-400 text-xs">TIME</p>
                      <p className="text-white font-bold text-sm">{new Date(sig.timestamp).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">DIRECTION</p>
                      <p className={`font-bold text-lg ${sig.type === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                        {sig.type === 'long' ? '🟢 LONG' : '🔴 SHORT'}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">SETUP</p>
                      <p className="text-white font-bold text-sm capitalize">{sig.setup}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">ENTRY</p>
                      <p className="text-yellow-400 font-bold">{sig.entry}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">STOP LOSS</p>
                      <p className="text-red-400 font-bold">{sig.sl}</p>
                      <p className="text-slate-500 text-xs">({sig.slPips} pips)</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">TAKE PROFIT</p>
                      <p className="text-green-400 font-bold">{sig.tp}</p>
                      <p className="text-slate-500 text-xs">({sig.tpPips} pips)</p>
                    </div>
                  </div>
                  <div className="mt-3 p-3 bg-slate-900/50 rounded">
                    <p className="text-yellow-300 font-bold text-sm">⚡ EXACT ENTRY INSTRUCTIONS:</p>
                    <p className="text-white text-sm mt-1">
                      {sig.type === 'long' ? '1. BUY' : '1. SELL'} at {sig.entry} | 
                      2. SL: {sig.sl} ({sig.slPips} pips) | 
                      3. TP: {sig.tp} ({sig.tpPips} pips) | 
                      4. {sig.trailingStop !== 'No' ? `Activate ${sig.trailingStop} trailing` : 'Fixed TP'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 bg-yellow-900/30 border border-yellow-500 rounded-lg">
              <h3 className="text-yellow-400 font-bold mb-2">📝 Paper Trading Instructions:</h3>
              <ol className="text-white text-sm space-y-2">
                <li>1. Write down each signal in Excel/Notebook</li>
                <li>2. Track what WOULD happen if you entered (don't enter real money yet)</li>
                <li>3. After 20 paper trades, calculate your actual win rate</li>
                <li>4. If win rate ≈ forward test (±10%) → Go live with 0.01 lot</li>
                <li>5. If win rate &lt; forward test → Execution problem (slippage/timing)</li>
              </ol>
            </div>
          </div>
        )}

        {/* Initial Info Panel */}
        {!backtestResult && !results && !forwardTest && !liveSignals.length && (
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-8 border border-purple-500/30">
            <div className="text-center mb-6">
              <AlertTriangle size={56} className="mx-auto text-purple-400 mb-4" />
              <h3 className="text-3xl font-bold text-white mb-2">🎯 4-PHASE MATHEMATICAL TESTING</h3>
              <p className="text-slate-400 text-lg">Binary Answer: Strategy WORKS or DOESN'T WORK</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-slate-900/50 rounded-lg p-5 border border-green-500/30">
                <h4 className="text-xl font-bold text-green-400 mb-3">✅ IF ALL TESTS PASS:</h4>
                <div className="space-y-2 text-sm text-slate-300">
                  <p>• Backtest: Win rate 40-50%, PF &gt;1.5</p>
                  <p>• Optimize: Best result has PF &gt;2.0</p>
                  <p>• Forward: Similar to backtest (±15%)</p>
                  <p>• Live Signals: Paper trade confirms edge</p>
                </div>
                <div className="mt-4 p-3 bg-green-900/30 rounded">
                  <p className="text-green-300 font-bold">→ STRATEGY WORKS</p>
                  <p className="text-slate-400 text-xs mt-1">Go live with 0.01 lot, track 50 trades</p>
                </div>
              </div>

              <div className="bg-slate-900/50 rounded-lg p-5 border border-red-500/30">
                <h4 className="text-xl font-bold text-red-400 mb-3">❌ IF ANY TEST FAILS:</h4>
                <div className="space-y-2 text-sm text-slate-300">
                  <p>• Backtest: Win rate &lt;40%, PF &lt;1.5</p>
                  <p>• Optimize: Top results weak or extreme</p>
                  <p>• Forward: Win rate drops &gt;15%</p>
                  <p>• Live Signals: Can't execute or wrong WR</p>
                </div>
                <div className="mt-4 p-3 bg-red-900/30 rounded">
                  <p className="text-red-300 font-bold">→ STRATEGY DOESN'T WORK</p>
                  <p className="text-slate-400 text-xs mt-1">Don't trade it. Try different approach.</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border-2 border-blue-500/50 rounded-lg p-6 mb-6">
              <h4 className="text-2xl font-bold text-blue-400 mb-4 text-center">📋 TESTING CHECKLIST</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/50 rounded p-4">
                  <p className="text-yellow-400 font-bold mb-2">1️⃣ BACKTEST</p>
                  <ul className="text-xs text-slate-300 space-y-1">
                    <li>□ Upload M5 CSV</li>
                    <li>□ Run backtest on 70%</li>
                    <li>□ Check: WR, PF, DD, Trades</li>
                    <li>□ All green? → Continue</li>
                    <li>□ Any red? → STOP</li>
                  </ul>
                </div>
                <div className="bg-slate-900/50 rounded p-4">
                  <p className="text-purple-400 font-bold mb-2">2️⃣ OPTIMIZE</p>
                  <ul className="text-xs text-slate-300 space-y-1">
                    <li>□ Run 1000+ combos</li>
                    <li>□ Check top result PF &gt;2.0</li>
                    <li>□ Not extreme params</li>
                    <li>□ Click "Use Settings"</li>
                    <li>□ Passed? → Continue</li>
                  </ul>
                </div>
                <div className="bg-slate-900/50 rounded p-4">
                  <p className="text-blue-400 font-bold mb-2">3️⃣ FORWARD</p>
                  <ul className="text-xs text-slate-300 space-y-1">
                    <li>□ Test on unseen 30%</li>
                    <li>□ Compare to backtest</li>
                    <li>□ WR within ±15%?</li>
                    <li>□ Positive profit?</li>
                    <li>□ Passed? → Continue</li>
                  </ul>
                </div>
                <div className="bg-slate-900/50 rounded p-4">
                  <p className="text-yellow-400 font-bold mb-2">4️⃣ LIVE SIG</p>
                  <ul className="text-xs text-slate-300 space-y-1">
                    <li>□ Generate signals</li>
                    <li>□ Paper trade 20</li>
                    <li>□ Track win rate</li>
                    <li>□ Matches forward?</li>
                    <li>□ GO LIVE 0.01 lot</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-yellow-900/30 border-2 border-yellow-500 rounded-lg p-6 text-center">
              <p className="text-yellow-400 font-bold text-2xl mb-3">⚡ START NOW</p>
              <p className="text-white text-lg mb-2">Upload M5 CSV file above</p>
              <p className="text-slate-400 text-sm">
                Need 10,000+ candles (2+ months) | Optional: H1, H4, Daily for ICT confluence
              </p>
              <div className="mt-4 flex items-center justify-center gap-2 text-slate-300 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-green-400">●</span> Backtest
                </div>
                <span>→</span>
                <div className="flex items-center gap-1">
                  <span className="text-purple-400">●</span> Optimize
                </div>
                <span>→</span>
                <div className="flex items-center gap-1">
                  <span className="text-blue-400">●</span> Forward
                </div>
                <span>→</span>
                <div className="flex items-center gap-1">
                  <span className="text-yellow-400">●</span> Live
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                <h5 className="font-bold text-white mb-2 text-sm">📊 What Gets Tested:</h5>
                <ul className="space-y-1 text-xs text-slate-400">
                  <li>• Price Action: Momentum, breakouts, rejections</li>
                  <li>• ICT: Order blocks, FVG, confluence</li>
                  <li>• Risk: Fixed SL/TP, trailing stops</li>
                  <li>• Stats: Win rate, PF, DD, expectancy</li>
                </ul>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                <h5 className="font-bold text-white mb-2 text-sm">⏱️ Time Required:</h5>
                <ul className="space-y-1 text-xs text-slate-400">
                  <li>• Backtest: 10 seconds</li>
                  <li>• Optimization: 2-3 minutes (1000+ tests)</li>
                  <li>• Forward test: 10 seconds</li>
                  <li>• Live signals: Instant</li>
                  <li><strong className="text-white">Total: ~5 minutes to full validation</strong></li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompleteTradingSystem;