import { useState, useRef, useCallback, useEffect } from 'react';

const KEY = (r, c) => `${r}_${c}`;
const nbrs = (r, c, R, C) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([nr, nc]) => nr >= 0 && nr < R && nc >= 0 && nc < C);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useWumpusGame() {
  const [gridConfig, setGridConfig] = useState({ rows: 4, cols: 4, pits: 3 });
  
  const [gameState, setGameState] = useState({
    world: [],
    agentPos: [0, 0],
    wumpusPos: [-1, -1],
    wumpusAlive: true,
    goldCollected: false,
    visited: new Set(),
    safeCells: new Set(),
    KB: [],
    inferenceSteps: 0,
    gameOver: false,
    logs: [],
    statusText: '',
    overlay: { show: false, win: false, msg: '' },
    isAutoRunning: false
  });

  // Keep a mutable reference to the latest state so intervals/timeouts can access it easily
  const stateRef = useRef(gameState);
  useEffect(() => {
    stateRef.current = gameState;
  }, [gameState]);

  // --- Core game functions ---
  
  const initGame = useCallback((config = gridConfig) => {
    let R = Math.min(9, Math.max(3, config.rows));
    let C = Math.min(9, Math.max(3, config.cols));
    let NPITS = Math.min(8, Math.max(1, config.pits));
    setGridConfig({ rows: R, cols: C, pits: NPITS });

    let world = [];
    for (let r = 0; r < R; r++) {
      world.push([]);
      for (let c = 0; c < C; c++) {
        world[r].push({ hasPit: false, hasWumpus: false, hasGold: false });
      }
    }

    let pool = shuffle([...Array(R * C).keys()].map(i => [Math.floor(i / C), i % C]).filter(([r, c]) => !(r === 0 && c === 0)));
    const numPits = Math.min(NPITS, pool.length - 2);
    for (let i = 0; i < numPits; i++) {
      const [r, c] = pool[i];
      world[r][c].hasPit = true;
    }
    const [wr, wc] = pool[numPits];
    world[wr][wc].hasWumpus = true;
    const [gr, gc] = pool[numPits + 1];
    world[gr][gc].hasGold = true;

    let initialState = {
      world,
      agentPos: [0, 0],
      wumpusPos: [wr, wc],
      wumpusAlive: true,
      goldCollected: false,
      visited: new Set([KEY(0, 0)]),
      safeCells: new Set([KEY(0, 0)]),
      KB: [],
      inferenceSteps: 0,
      gameOver: false,
      logs: [{ id: Date.now(), tag: 'INIT', msg: `${R}×${C} grid · ${numPits} pits · Wumpus active · Gold placed randomly` }],
      statusText: `Agent spawned at (0,0). Initializing KB...`,
      overlay: { show: false, win: false, msg: '' },
      isAutoRunning: false
    };

    // Need to do initial KB update
    stateRef.current = initialState;
    const { KB, logs } = initialState;
    
    // Internal helper to mutate state during a step
    const internalTellKB = (r, c) => {
      const { breeze, stench } = getPercepts(r, c, world, R, C, true);
      const ns = nbrs(r, c, R, C);

      const addClause = (lits) => {
        const k = lits.map(l => (l.neg ? '¬' : '') + l.v).sort().join('∨');
        if (!KB.some(c => c.key === k)) KB.push({ key: k, lits: [...lits] });
      };

      if (!breeze) {
        addClause([{ v: `P_${r}_${c}`, neg: true }]);
        ns.forEach(([nr, nc]) => addClause([{ v: `P_${nr}_${nc}`, neg: true }]));
        logs.unshift({ id: Date.now() + Math.random(), tag: 'TELL', msg: `¬Breeze@(${r},${c}) → ¬Pit proven for ${ns.length + 1} cells` });
      } else {
        const clause = ns.map(([nr, nc]) => ({ v: `P_${nr}_${nc}`, neg: false }));
        if (clause.length) addClause(clause);
        logs.unshift({ id: Date.now() + Math.random(), tag: 'TELL', msg: `Breeze@(${r},${c}) → disjunction over ${ns.length} neighbors` });
      }

      if (!stench) {
        addClause([{ v: `W_${r}_${c}`, neg: true }]);
        ns.forEach(([nr, nc]) => addClause([{ v: `W_${nr}_${nc}`, neg: true }]));
      } else {
        const clause = ns.map(([nr, nc]) => ({ v: `W_${nr}_${nc}`, neg: false }));
        if (clause.length) addClause(clause);
        logs.unshift({ id: Date.now() + Math.random(), tag: 'TELL', msg: `Stench@(${r},${c}) → Wumpus in one of ${ns.length} neighbors` });
      }
    };

    internalTellKB(0, 0);
    const newSafe = internalRunInference(initialState.safeCells, initialState.visited, KB, R, C, logs, initialState);
    
    initialState.statusText = `Agent spawned at (0,0). ${KB.length} initial KB clauses loaded.`;
    setGameState({ ...initialState });
  }, [gridConfig]);

  // Helper inside hook to compute percepts based on a given world state
  const getPercepts = (r, c, w, R, C, wAlive) => {
    let breeze = false, stench = false, glitter = false;
    for (const [nr, nc] of nbrs(r, c, R, C)) {
      if (w[nr][nc].hasPit) breeze = true;
      if (w[nr][nc].hasWumpus && wAlive) stench = true;
    }
    if (w[r][c].hasGold) glitter = true;
    return { breeze, stench, glitter };
  };

  const internalRunInference = (safeCells, visited, KB, R, C, logs, stateContainer) => {
    let count = 0;
    
    const clauseKey = (lits) => lits.map(l => (l.neg ? '¬' : '') + l.v).sort().join('|');
    const dedupLits = (lits) => {
      const seen = new Set();
      return lits.filter(l => { const k = (l.neg ? '¬' : '') + l.v; if (seen.has(k)) return false; seen.add(k); return true; });
    };
    const resolveTwo = (c1, c2) => {
      const out = [];
      for (const l1 of c1) for (const l2 of c2) {
        if (l1.v === l2.v && l1.neg !== l2.neg) {
          out.push(dedupLits([...c1.filter(l => l !== l1), ...c2.filter(l => l !== l2)]));
        }
      }
      return out;
    };

    const resolutionProve = (varName, shouldBeNeg) => {
      stateContainer.inferenceSteps++;
      const negatedGoal = [{ v: varName, neg: !shouldBeNeg }];
      const clauseSet = new Set(KB.map(c => clauseKey(c.lits)));
      let working = [...KB.map(c => [...c.lits]), negatedGoal];
      clauseSet.add(clauseKey(negatedGoal));

      for (let round = 0; round < 500; round++) {
        const newC = []; let progress = false;
        outer: for (let i = 0; i < working.length; i++) {
          for (let j = i + 1; j < working.length; j++) {
            for (const res of resolveTwo(working[i], working[j])) {
              if (res.length === 0) return true;
              const k = clauseKey(res);
              if (!clauseSet.has(k)) { newC.push(res); clauseSet.add(k); progress = true; break outer; }
            }
          }
        }
        if (!newC.length) break;
        working = [...working, ...newC];
        if (working.length > 600) break;
      }
      return false;
    };

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const k = KEY(r, c);
        if (visited.has(k) || safeCells.has(k)) continue;

        const noPitUnit = KB.some(cl => cl.lits.length === 1 && cl.lits[0].v === `P_${r}_${c}` && cl.lits[0].neg === true);
        const noWumpUnit = KB.some(cl => cl.lits.length === 1 && cl.lits[0].v === `W_${r}_${c}` && cl.lits[0].neg === true);

        if (noPitUnit && noWumpUnit) {
          safeCells.add(k); count++;
          logs.unshift({ id: Date.now() + Math.random(), tag: 'INFER', msg: `✓ Safe proven: (${r},${c}) — ¬Pit∧¬Wumpus via KB unit clauses` });
          continue;
        }

        if (resolutionProve(`P_${r}_${c}`, true) && resolutionProve(`W_${r}_${c}`, true)) {
          safeCells.add(k); count++;
          logs.unshift({ id: Date.now() + Math.random(), tag: 'INFER', msg: `✓ Safe proven: (${r},${c}) via resolution refutation` });
        }
      }
    }
    return count;
  };

  const internalBFS = (sr, sc, goal_r, goal_c, safeCells, visited, R, C) => {
    const queue = [[sr, sc, []]];
    const seen = new Set([KEY(sr, sc)]);
    while (queue.length) {
      const [r, c, path] = queue.shift();
      if (r === goal_r && c === goal_c) return [...path, [r, c]];
      for (const [nr, nc] of nbrs(r, c, R, C)) {
        const k = KEY(nr, nc);
        if (!seen.has(k) && (safeCells.has(k) || visited.has(k))) {
          seen.add(k); queue.push([nr, nc, [...path, [r, c]]]);
        }
      }
    }
    return null;
  };

  const agentStep = useCallback(() => {
    const s = stateRef.current;
    if (s.gameOver) return;

    let newWorld = s.world.map(row => row.map(cell => ({ ...cell })));
    let newWumpusPos = [...s.wumpusPos];
    let newWumpusAlive = s.wumpusAlive;
    let newLogs = [...s.logs];

    // Move Wumpus
    if (newWumpusAlive) {
      const [wr, wc] = newWumpusPos;
      const moves = nbrs(wr, wc, gridConfig.rows, gridConfig.cols).filter(([r, c]) => !newWorld[r][c].hasPit);
      if (moves.length > 0 && Math.random() >= 0.25) {
        const [nr, nc] = moves[Math.floor(Math.random() * moves.length)];
        newWorld[wr][wc].hasWumpus = false;
        newWorld[nr][nc].hasWumpus = true;
        newWumpusPos = [nr, nc];
        newLogs.unshift({ id: Date.now() + Math.random(), tag: 'WMOV', msg: `Wumpus: (${wr},${wc}) → (${nr},${nc})` });
      }
    }

    const [ar, ac] = s.agentPos;

    const killAgent = (msg, tagMsg, win = false) => {
      setGameState(prev => ({
        ...prev, world: newWorld, wumpusPos: newWumpusPos, gameOver: true, isAutoRunning: false,
        logs: [{ id: Date.now() + Math.random(), tag: win ? 'WIN' : 'DEATH', msg: tagMsg }, ...newLogs],
        overlay: { show: true, win, msg }
      }));
    };

    if (newWumpusAlive && newWorld[ar][ac].hasWumpus) {
      killAgent(`The Wumpus crept into your chamber at (${ar},${ac})!`, `Wumpus moved onto agent at (${ar},${ac})!`);
      return;
    }

    const adjacent = nbrs(ar, ac, gridConfig.rows, gridConfig.cols);
    const safeAdjacent = shuffle(adjacent.filter(([r, c]) => s.safeCells.has(KEY(r, c)) && !s.visited.has(KEY(r, c))));
    
    let target = null;
    let moveType = '';

    if (safeAdjacent.length > 0) {
      target = safeAdjacent[0];
      moveType = 'MOVE';
      newLogs.unshift({ id: Date.now() + Math.random(), tag: 'MOVE', msg: `Safe adjacent → (${target[0]},${target[1]}) [${safeAdjacent.length} options]` });
    } else {
      const globalTargets = shuffle([...s.safeCells].filter(k => !s.visited.has(k)).map(k => k.split('_').map(Number)));
      let bestPath = null;
      for (const [tr, tc] of globalTargets) {
        const path = internalBFS(ar, ac, tr, tc, s.safeCells, s.visited, gridConfig.rows, gridConfig.cols);
        if (path && path.length > 1) {
          if (!bestPath || path.length < bestPath.length) bestPath = path;
        }
      }
      if (bestPath && bestPath.length > 1) {
        target = bestPath[1];
        const [dr, dc] = bestPath[bestPath.length - 1];
        newLogs.unshift({ id: Date.now() + Math.random(), tag: 'NAV', msg: `BFS → goal (${dr},${dc}), step to (${target[0]},${target[1]}) [path len ${bestPath.length}]` });
      } else {
        const riskMoves = shuffle(adjacent.filter(([r, c]) => !s.visited.has(KEY(r, c))));
        if (riskMoves.length > 0) {
          target = riskMoves[0];
          newLogs.unshift({ id: Date.now() + Math.random(), tag: 'RISK', msg: `Risk move → (${target[0]},${target[1]}) — no safe path` });
        } else {
          newLogs.unshift({ id: Date.now() + Math.random(), tag: 'STUCK', msg: 'No moves available — all reachable cells visited.' });
          setGameState(prev => ({ ...prev, logs: newLogs, statusText: '⚠ Agent fully stuck — exploration complete.', gameOver: true, isAutoRunning: false }));
          return;
        }
      }
    }

    // Move Agent
    const [nr, nc] = target;
    let newVisited = new Set(s.visited);
    newVisited.add(KEY(nr, nc));
    const cell = newWorld[nr][nc];

    if (cell.hasPit) {
      killAgent(`Agent fell into a pit at (${nr},${nc}) — swallowed by darkness.`, `Fell into pit at (${nr},${nc}).`);
      return;
    }
    if (cell.hasWumpus && newWumpusAlive) {
      killAgent(`The Wumpus devoured the agent at (${nr},${nc})!`, `Eaten by Wumpus at (${nr},${nc}).`);
      return;
    }
    if (cell.hasGold) {
      newWorld[nr][nc].hasGold = false;
      setGameState(prev => ({
        ...prev, agentPos: [nr, nc], world: newWorld, wumpusPos: newWumpusPos, gameOver: true, isAutoRunning: false, goldCollected: true, visited: newVisited,
        logs: [{ id: Date.now() + Math.random(), tag: 'WIN', msg: `Gold found at (${nr},${nc})! Mission complete!` }, ...newLogs],
        overlay: { show: true, win: true, msg: `Agent secured the gold at (${nr},${nc}) and escaped the cave!` }
      }));
      return;
    }

    // Tell KB and run inference
    let newKB = [...s.KB];
    let stateContainer = { inferenceSteps: s.inferenceSteps };
    
    const internalTellKB = (r, c) => {
      const { breeze, stench } = getPercepts(r, c, newWorld, gridConfig.rows, gridConfig.cols, newWumpusAlive);
      const ns = nbrs(r, c, gridConfig.rows, gridConfig.cols);
      const addClause = (lits) => {
        const k = lits.map(l => (l.neg ? '¬' : '') + l.v).sort().join('∨');
        if (!newKB.some(cl => cl.key === k)) newKB.push({ key: k, lits: [...lits] });
      };
      if (!breeze) {
        addClause([{ v: `P_${r}_${c}`, neg: true }]);
        ns.forEach(([snr, snc]) => addClause([{ v: `P_${snr}_${snc}`, neg: true }]));
        newLogs.unshift({ id: Date.now() + Math.random(), tag: 'TELL', msg: `¬Breeze@(${r},${c}) → ¬Pit proven for ${ns.length + 1} cells` });
      } else {
        const clause = ns.map(([snr, snc]) => ({ v: `P_${snr}_${snc}`, neg: false }));
        if (clause.length) addClause(clause);
        newLogs.unshift({ id: Date.now() + Math.random(), tag: 'TELL', msg: `Breeze@(${r},${c}) → disjunction over ${ns.length} neighbors` });
      }
      if (!stench) {
        addClause([{ v: `W_${r}_${c}`, neg: true }]);
        ns.forEach(([snr, snc]) => addClause([{ v: `W_${snr}_${snc}`, neg: true }]));
      } else {
        const clause = ns.map(([snr, snc]) => ({ v: `W_${snr}_${snc}`, neg: false }));
        if (clause.length) addClause(clause);
        newLogs.unshift({ id: Date.now() + Math.random(), tag: 'TELL', msg: `Stench@(${r},${c}) → Wumpus in one of ${ns.length} neighbors` });
      }
    };

    internalTellKB(nr, nc);
    let newSafeCells = new Set(s.safeCells);
    const newSafeCount = internalRunInference(newSafeCells, newVisited, newKB, gridConfig.rows, gridConfig.cols, newLogs, stateContainer);

    // Keep logs trimmed to 100 max
    if (newLogs.length > 100) newLogs.length = 100;

    setGameState(prev => ({
      ...prev,
      world: newWorld,
      agentPos: [nr, nc],
      wumpusPos: newWumpusPos,
      visited: newVisited,
      KB: newKB,
      safeCells: newSafeCells,
      inferenceSteps: stateContainer.inferenceSteps,
      logs: newLogs,
      statusText: `Agent at (${nr},${nc}) · KB: ${newKB.length} clauses · Steps: ${stateContainer.inferenceSteps} · +${newSafeCount} safe cells`
    }));

  }, [gridConfig.rows, gridConfig.cols]);

  const toggleAuto = useCallback(() => {
    setGameState(prev => ({ ...prev, isAutoRunning: !prev.isAutoRunning }));
  }, []);

  useEffect(() => {
    let timer;
    if (gameState.isAutoRunning && !gameState.gameOver) {
      timer = setInterval(() => {
        agentStep();
      }, 550);
    }
    return () => clearInterval(timer);
  }, [gameState.isAutoRunning, gameState.gameOver, agentStep]);

  const closeOverlay = useCallback(() => {
    initGame();
  }, [initGame]);

  return {
    gridConfig,
    setGridConfig,
    gameState,
    initGame,
    agentStep,
    toggleAuto,
    closeOverlay,
    getPercepts
  };
}
