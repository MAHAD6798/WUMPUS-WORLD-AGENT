import React, { useEffect, useMemo } from 'react';
import './index.css';
import { useWumpusGame } from './hooks/useWumpusGame';

const KEY = (r, c) => `${r}_${c}`;

function App() {
  const {
    gridConfig, setGridConfig,
    gameState, initGame, agentStep, toggleAuto, closeOverlay, getPercepts
  } = useWumpusGame();

  const {
    world, agentPos, wumpusAlive, visited, safeCells, KB, inferenceSteps,
    gameOver, logs, statusText, overlay, isAutoRunning, goldCollected
  } = gameState;

  // Initialize game on first mount
  useEffect(() => {
    initGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfigChange = (e) => {
    const { id, value } = e.target;
    setGridConfig(prev => ({ ...prev, [id.replace('in-', '')]: parseInt(value) || 3 }));
  };

  const R = gridConfig.rows;
  const C = gridConfig.cols;

  // Render grid cells
  const gridCells = useMemo(() => {
    if (!world || world.length === 0) return null;
    const cells = [];
    for (let r = R - 1; r >= 0; r--) {
      for (let c = 0; c < C; c++) {
        const [ar, ac] = agentPos;
        const isAgent = (ar === r && ac === c);
        const isVis = visited.has(KEY(r, c));
        const isSafe = safeCells.has(KEY(r, c));
        const cell = world[r] && world[r][c] ? world[r][c] : { hasPit: false, hasWumpus: false, hasGold: false };
        
        let cls = '', icon = '', lbl = '';

        if (isAgent) {
          const { breeze, stench } = getPercepts(r, c, world, R, C, wumpusAlive);
          if (breeze && stench) { cls = 's-both'; icon = '🤖'; lbl = 'BOTH!'; }
          else if (breeze) { cls = 's-breeze'; icon = '🤖'; lbl = 'BREEZE!'; }
          else if (stench) { cls = 's-stench'; icon = '🤖'; lbl = 'STENCH!'; }
          else { cls = 's-agent'; icon = '🤖'; lbl = 'AGENT'; }
        } else if (isVis) {
          const { breeze, stench, glitter } = getPercepts(r, c, world, R, C, wumpusAlive);
          if (glitter) { cls = 's-gold'; icon = '💎'; lbl = 'GLITTER'; }
          else if (breeze && stench) { cls = 's-both'; icon = '⚡'; lbl = 'BOTH'; }
          else if (breeze) { cls = 's-breeze'; icon = '🌀'; lbl = 'BREEZE'; }
          else if (stench) { cls = 's-stench'; icon = '☠️'; lbl = 'STENCH'; }
          else { cls = 's-visited'; icon = '🔵'; lbl = 'CLEAR'; }
        } else if (isSafe) {
          cls = 's-safe'; icon = '✅'; lbl = 'SAFE';
        } else {
          cls = 's-unknown'; icon = '❓'; lbl = '?????';
        }

        if (gameOver) {
          if (cell.hasPit) { cls = 's-pit'; icon = '🕳️'; lbl = 'PIT'; }
          else if (cell.hasWumpus) { cls = 's-wumpus'; icon = '👹'; lbl = 'WUMPUS'; }
          else if (cell.hasGold && !isAgent) { cls = 's-gold'; icon = '💎'; lbl = 'GOLD'; }
          
          if (isAgent) {
            if (goldCollected) { cls = 's-win'; icon = '🏆'; lbl = 'WIN!'; }
            else if (cell.hasPit || cell.hasWumpus) { cls = 's-pit'; icon = '💀'; lbl = 'DEAD'; }
          }
        }

        cells.push(
          <div key={KEY(r, c)} className={`cell ${cls}`} data-coord={`${r},${c}`}>
            <div className="cell-icon">{icon}</div>
            <span className="cell-lbl">{lbl}</span>
          </div>
        );
      }
    }
    return cells;
  }, [world, agentPos, visited, safeCells, gameOver, goldCollected, wumpusAlive, R, C, getPercepts]);

  // Percepts logic for sidebar
  const currentPercepts = useMemo(() => {
    if (!world || world.length === 0) return null;
    const [ar, ac] = agentPos;
    const { breeze, stench, glitter } = getPercepts(ar, ac, world, R, C, wumpusAlive);
    const badges = [];
    if (breeze) badges.push(<span key="b" className="pbadge pb-b">🌀 Breeze</span>);
    if (stench) badges.push(<span key="s" className="pbadge pb-s">☠️ Stench</span>);
    if (glitter) badges.push(<span key="g" className="pbadge pb-g">💎 Glitter!</span>);
    if (badges.length === 0) badges.push(<span key="none" className="pb-none">— none detected —</span>);
    return badges;
  }, [agentPos, world, R, C, wumpusAlive, getPercepts]);

  return (
    <div id="app">
      <div className="hdr">
        <div className="hdr-left">
          <div className="hdr-accent"></div>
          <div className="hdr-titles">
            <h1>WUMPUS WORLD</h1>
            <div className="sub">Propositional Logic · Resolution Refutation · BFS Pathfinding · Dynamic Exploration</div>
          </div>
        </div>
        <div className="hdr-right">
          <div className="hdr-stat"><div className="hdr-stat-lbl">Inference Steps</div><div className="hdr-stat-val hsv-c">{inferenceSteps}</div></div>
          <div className="hdr-stat"><div className="hdr-stat-lbl">Cells Visited</div><div className="hdr-stat-val hsv-g">{visited.size}</div></div>
          <div className="hdr-stat"><div className="hdr-stat-lbl">KB Clauses</div><div className="hdr-stat-val hsv-a">{KB.length}</div></div>
          <div className="hdr-stat"><div className="hdr-stat-lbl">Safe Proven</div><div className="hdr-stat-val hsv-p">{safeCells.size}</div></div>
        </div>
      </div>

      <div className="ctrl">
        <span className="ctrl-lbl">Grid</span>
        <div className="ctrl-section">
          <div className="ctrl-field"><label>Rows</label><input type="number" id="in-rows" value={gridConfig.rows} onChange={handleConfigChange} min="3" max="9" /></div>
          <div className="ctrl-field"><label>Cols</label><input type="number" id="in-cols" value={gridConfig.cols} onChange={handleConfigChange} min="3" max="9" /></div>
          <div className="ctrl-field"><label>Pits</label><input type="number" id="in-pits" value={gridConfig.pits} onChange={handleConfigChange} min="1" max="8" /></div>
        </div>
        <div className="divider"></div>
        <button className="btn btn-new" onClick={() => initGame()}>⬡ New Episode</button>
        <button className="btn btn-step" onClick={agentStep}>▶ Step</button>
        <button className={`btn btn-auto ${isAutoRunning ? 'running' : ''}`} onClick={toggleAuto}>
          {isAutoRunning ? '⏹ Stop' : '⏩ Auto Run'}
        </button>
      </div>

      <div id="status-bar">
        <span className="scursor">▌</span>
        <span id="status-text">{statusText}</span>
      </div>

      <div className="main">
        <div className="map-panel">
          <div className="panel-title"><span className="pt-accent"></span>Cave Map — (row, col) · Agent spawns at (0,0) bottom-left</div>
          <div id="grid-wrap">
            <div id="grid" style={{ gridTemplateColumns: `repeat(${C}, 80px)` }}>
              {gridCells}
            </div>
          </div>
        </div>

        <div className="sidebar">
          <div className="panel">
            <div className="ptitle"><span className="ptitle-bar"></span>Active Percepts</div>
            <div className="percept-row" id="percept-display">{currentPercepts}</div>
          </div>
          <div className="panel">
            <div className="ptitle"><span className="ptitle-bar"></span>Knowledge Base · CNF</div>
            <div className="kb-scroll" id="kb-display">
              {KB.length === 0 ? <span style={{ fontSize: '9px', color: 'var(--txt3)' }}>— empty —</span> : 
                [...KB].slice(-24).map((cl, idx) => (
                  <div key={idx} className="kb-row">
                    {cl.key.split('∨').map((tok, i, arr) => (
                      <React.Fragment key={i}>
                        <span className={tok.startsWith('¬') ? 'kb-neg' : 'kb-pos'}>{tok}</span>
                        {i < arr.length - 1 && <span className="kb-op"> ∨ </span>}
                      </React.Fragment>
                    ))}
                  </div>
                ))
              }
            </div>
          </div>
          <div className="panel">
            <div className="ptitle"><span className="ptitle-bar"></span>Legend</div>
            <div className="legend-grid">
              <div className="leg"><div className="ld ld-unk">?</div>Unknown</div>
              <div className="leg"><div className="ld ld-saf">✓</div>Safe (proven)</div>
              <div className="leg"><div className="ld ld-vis">·</div>Visited</div>
              <div className="leg"><div className="ld ld-agt">@</div>Agent</div>
              <div className="leg"><div className="ld ld-pit">●</div>Pit (Red)</div>
              <div className="leg"><div className="ld ld-wmp">!</div>Wumpus (Red)</div>
              <div className="leg"><div className="ld ld-gld">★</div>Gold</div>
              <div className="leg"><div className="ld ld-brz">~</div>Breeze/Stench</div>
            </div>
          </div>
          <div className="panel">
            <div className="ptitle"><span className="ptitle-bar"></span>Agent Log</div>
            <div className="log-area" id="log">
              {logs.map((l) => (
                <div key={l.id} className="log-row">
                  <span className={`log-tag lt-${l.tag}`}>{l.tag}</span>
                  <span className="log-msg">{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {overlay.show && (
        <div id="overlay" className="show">
          <div className={`ov-box ${overlay.win ? 'ov-win' : 'ov-lose'}`}>
            <div className="ov-icon">{overlay.win ? '🏆' : '💀'}</div>
            <div className="ov-title">{overlay.win ? 'VICTORY' : 'DEFEATED'}</div>
            <div className="ov-sub">{overlay.msg}</div>
            <div className="ov-stats">
              <div className="ov-s"><div className="ov-sl">Inference Steps</div><div className="ov-sv">{inferenceSteps}</div></div>
              <div className="ov-s"><div className="ov-sl">Cells Visited</div><div className="ov-sv">{visited.size}</div></div>
              <div className="ov-s"><div className="ov-sl">KB Clauses</div><div className="ov-sv">{KB.length}</div></div>
              <div className="ov-s"><div className="ov-sl">Safe Proven</div><div className="ov-sv">{safeCells.size}</div></div>
            </div>
            <button className="ov-btn" onClick={closeOverlay}>▶ Play Again</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
