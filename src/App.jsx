import { useState, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const G       = 10;
const MAX_AP  = 11;
const START_G = 200;
const GOAL    = 5000;
const MAX_DAY = 30;
const CS      = 50; // cell px

// ── Crop & Structure Data ─────────────────────────────────────────────────────
const CROPS = {
  mint:    { label:"Mint",    icon:"🌿", time:1, profit:100, cost:10  },
  wheat:   { label:"Wheat",   icon:"🌾", time:2, profit:250, cost:15  },
  cabbage: { label:"Cabbage", icon:"🥬", time:3, profit:350, cost:20  },
};

const STRUCTS = {
  farmland:     {label:"Farmland",       icon:"🟫", cost:100, desc:"Unlock this tile for farming"},
  water:        { label:"Water Tower",   icon:"💧", cost:300, desc:"Auto-waters 8 neighbors each day" },
  growth:       { label:"Growth Tower",  icon:"⚡", cost:250, desc:"+1 extra growth/day for 8 neighbors" },
  beehive:      { label:"Beehive",       icon:"🍯", cost:500, desc:"+250g passively each day" },
  tree:         { label:"Fruit Tree",    icon:"🌳", cost:150, desc:"Harvest: +100g — no water needed (1 AP)" },
  tea:          { label:"Tea Leaves",    icon:"🍵", cost:200, desc:"Harvest: +350g — needs Water Tower (1 AP)" },
  keg:          { label:"Keg",           icon:"🪣", cost:300, desc:"2× profit from Beehive, Tree & Tea nearby" },
  actionflower: { label:"Action Flower", icon:"🌸", cost:200, desc:"Blooms in 4 days — click to restore all AP (free)" },
  trapdoubler:  { label:"Trap Doubler",  icon:"✳️", cost:350, desc:"1.5× Bird Trap rewards for traps nearby" },
  plantdoubler: { label:"Plant Doubler", icon:"🌟", cost:350, desc:"1.5× harvest profit for nearby crops" },
  trap:         { label:"Bird Trap",     icon:"🪤", cost:150, desc:"Daily: eats 1 ripe adjacent crop → +750g" },
  // natural (not purchasable)
  rock:         { label:"Rock",          icon:"🪨", cost:0,   desc:"Mine: +1 rock, tile → farmland (1 AP)" },
  bigtree:      { label:"Wild Tree",     icon:"🌲", cost:0,   desc:"Chop: +1 wood, tile → farmland (1 AP)" },
};

const BUILDABLE = ["farmland","water","growth","beehive","tree","tea","keg","actionflower","trapdoubler","plantdoubler","trap"];

// ── Grid Helpers ──────────────────────────────────────────────────────────────
const mkCell = () => ({ crop:null, structure:null });

function nbrs(r, c) {
  const out = [];
  for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
    if (!dr && !dc) continue;
    const nr=r+dr, nc=c+dc;
    if (nr>=0 && nr<G && nc>=0 && nc<G) out.push([nr,nc]);
  }
  return out;
}

const hasNS = (grid,r,c,t) => nbrs(r,c).some(([nr,nc])=>grid[nr][nc].structure?.type===t);

function deepClone(g) {
  return g.map(row => row.map(cell => ({
    ...cell,
    crop:      cell.crop      ? {...cell.crop}      : null,
    structure: cell.structure ? {...cell.structure} : null,
  })));
}

function initGrid() {
  const g = Array.from({length:G}, () => Array.from({length:G}, () => mkCell()));
  [[2,2],[2,7],[7,2],[7,7],[5,5]].forEach(([r,c]) => {g[r][c].structure = { type:"farmland", tilled:false };});
  [[1,1],[8,8],[0,5],[9,4]].forEach(([r,c]) => { g[r][c].structure = {type:"rock"}; });
  [[1,8],[8,1],[2,0],[7,9]].forEach(([r,c]) => { g[r][c].structure = {type:"bigtree"}; });
  return g;
}

// ── Daily Reward Pool ─────────────────────────────────────────────────────────
const POOL = [
  {type:"structure", value:"rock"},{type:"structure", value:"bigtree"},
  {type:"structure",value:"water"}, {type:"structure",value:"growth"},
  {type:"structure",value:"beehive"}, {type:"structure",value:"tree"},
  {type:"structure",value:"tea"}, {type:"structure",value:"trap"},
  {type:"structure",value:"actionflower"}, {type:"structure",value:"plantdoubler"},
  {type:"structure",value:"trapdoubler"},
  {type:"farmland"}, {type:"farmland"},
];
const randReward = () => POOL[Math.floor(Math.random()*POOL.length)];

// ── Day Processing ────────────────────────────────────────────────────────────
function processDay(grid) {
  const g    = deepClone(grid);
  let earned = 0;
  const msgs = [];

  // 1. Age action flowers
  for (let r=0; r<G; r++) for (let c=0; c<G; c++) {
    const s = g[r][c].structure;
    if (s?.type === "actionflower" && (s.bloomLeft ?? 4) > 0) {
      s.bloomLeft = (s.bloomLeft ?? 4) - 1;
      if (s.bloomLeft === 0) msgs.push("🌸 Action Flower bloomed! Click it (Harvest mode) to restore AP.");
    }
  }

  // 2. Grow crops
  for (let r=0; r<G; r++) for (let c=0; c<G; c++) {
    const cell = g[r][c];
    if (!cell.crop || cell.crop.growthLeft === 0) continue;
    const wet = cell.crop.watered || hasNS(g,r,c,"water");
    if (!wet) { cell.crop.watered = false; continue; }
    const bonus   = hasNS(g,r,c,"growth") ? 1 : 0;
    cell.crop.growthLeft = Math.max(0, cell.crop.growthLeft - (1+bonus));
    cell.crop.watered    = hasNS(g,r,c,"water"); // keep watered only if tower adjacent
  }

  // 3. Beehive passive income
  for (let r=0; r<G; r++) for (let c=0; c<G; c++) {
    if (g[r][c].structure?.type !== "beehive") continue;
    const amt = 250 * (hasNS(g,r,c,"keg") ? 2 : 1);
    earned += amt;
    msgs.push(`🍯 Beehive +${amt}g${hasNS(g,r,c,"keg")?" (Keg ×2)":""}`);
  }

  // 4. Trap resolution (RNG)
  for (let r=0; r<G; r++) for (let c=0; c<G; c++) {
    if (g[r][c].structure?.type !== "trap") continue;
    const ready = nbrs(r,c).filter(([nr,nc]) => g[nr][nc].crop?.growthLeft === 0);
    if (!ready.length) continue;
    const [cr,cc] = ready[Math.floor(Math.random()*ready.length)];
    if (g[cr][cc].crop) {
      g[cr][cc].crop = null;

      if (g[cr][cc].structure?.type === "farmland") {
        g[cr][cc].structure.tilled = false;
      }
    }
    const amt = Math.floor(750 * (hasNS(g,r,c,"trapdoubler") ? 1.5 : 1));
    earned += amt;
    msgs.push(`🪤 Bird trap fired! +${amt}g${hasNS(g,r,c,"trapdoubler")?" (Trap Doubler!)":""}`);
  }

  return { grid:g, earned, msgs };
}

// ── Cell Visuals ──────────────────────────────────────────────────────────────
const SS = {
  water:        { bg:"#1e3a5f", border:"#3b82f6", glow:"0 0 8px #3b82f655" },
  growth:       { bg:"#3b1c08", border:"#f59e0b", glow:"0 0 8px #f59e0b55" },
  beehive:      { bg:"#3b2c00", border:"#fbbf24", glow:"0 0 8px #fbbf2455" },
  tree:         { bg:"#1a3a1a", border:"#22c55e", glow:"0 0 6px #22c55e44" },
  tea:          { bg:"#0d2f1a", border:"#10b981", glow:"0 0 6px #10b98144" },
  keg:          { bg:"#2d1a00", border:"#d97706", glow:"0 0 6px #d9770655" },
  actionflower: { bg:"#2a1040", border:"#c084fc", glow:"0 0 10px #a855f766" },
  trapdoubler:  { bg:"#1a2040", border:"#818cf8", glow:"0 0 6px #818cf844" },
  plantdoubler: { bg:"#1a3a0d", border:"#84cc16", glow:"0 0 6px #84cc1644" },
  trap:         { bg:"#4a0d0d", border:"#ef4444", glow:"0 0 8px #ef444455" },
  rock:         { bg:"#2a2520", border:"#78716c", glow:"none"               },
  bigtree:      { bg:"#1a2a10", border:"#65a30d", glow:"none"               },
};

function cellVis(cell, r, c, grid) {
  const { type, crop, structure:s } = cell;
  console.log("cell", r, c, cell.tilled, cell);
  if (s && s.type !== "farmland") {

    if (s.type === "actionflower") {
      const bl  = s.bloomLeft ?? 4;
      const rdy = bl === 0;
      return {
        icon:   rdy ? "🌸" : "🌱",
        bg:     rdy ? "#3d0d6e" : "#1a2a1a",
        border: rdy ? "#c084fc" : "#374151",
        glow:   rdy ? "0 0 14px #a855f7aa" : "none",
        sub:    rdy ? "BLOOM!" : `${bl}d`,
        subCol: rdy ? "#e879f9" : "#6b7280",
        dim:    false,
      };
    }

    const st  = SS[s.type] || { bg:"#1c1917", border:"#57534e", glow:"none" };
    let   sub = "";
    let   sc  = "#6b7280";

    if (s.type === "tea") {
      const wet = hasNS(grid,r,c,"water");
      sub = wet ? "ready" : "dry!";
      sc  = wet ? "#10b981" : "#f87171";
    }

    return {
      icon: STRUCTS[s.type]?.icon || "?",
      bg: st.bg,
      border: st.border,
      glow: st.glow,
      sub,
      subCol: sc,
      dim: false
    };
  }

  if (cell.structure?.type === "farmland" && crop) {
    const def  = CROPS[crop.type];
    const rdy  = crop.growthLeft === 0;
    const wet  = crop.watered || hasNS(grid,r,c,"water");
    if (rdy) return { icon:def.icon, bg:"#0d3321", border:"#22c55e", glow:"0 0 10px #22c55e77", sub:"READY", subCol:"#4ade80", dim:false };
    if (wet) return { icon:def.icon, bg:"#143222", border:"#166534", glow:"none", sub:`${crop.growthLeft}d`, subCol:"#6b7280", dim:false };
    return     { icon:def.icon, bg:"#2a1500", border:"#92400e", glow:"none", sub:"DRY!", subCol:"#f87171", dim:true };
  }

  if (cell.structure?.type === "farmland") return { icon: "", bg:cell.structure?.tilled ?"#844b13":"#1a0f05", border:cell.structure?.tilled ?"#e87b0d":"#44403c", glow:"none", sub:"", dim:false };

  return { icon:"", bg:"#0c0a09", border:"#1c1917", glow:"none", sub:"", dim:false };
}

// ── Main Game Component ───────────────────────────────────────────────────────
export default function FarmGame() {
  const [grid,    setGrid]    = useState(initGrid);
  const [gold,    setGold]    = useState(START_G);
  const [ap,      setAP]      = useState(MAX_AP);
  const [day,     setDay]     = useState(1);
  const [wood,    setWood]    = useState(0);
  const [rock,    setRock]    = useState(0);
  const [mode,    setMode]    = useState("till");
  const [crop,    setCrop]    = useState("mint");
  const [build,   setBuild]   = useState("water");
  const [reward,  setReward]  = useState(null);
  const [rewardOptions, setRewardOptions] = useState(null);
  const [rewUsed, setRewUsed] = useState(false);
  const [msgs,    setMsgs]    = useState(["🌿 Welcome! Till land → Plant seeds → Water → Harvest. Press Next Day to advance."]);
  const [hovered, setHovered] = useState(null);
  const [status,  setStatus]  = useState("playing"); // playing | won | lost

  const log = useCallback((m) => setMsgs(p => [m, ...p].slice(0,12)), []);

  // ── Cell Click Handler ────────────────────────────────────────────────────
  const handleClick = useCallback((r, c) => {
    if (status !== "playing") return;
    const cell = grid[r][c];
    
    // ── HARVEST ──────────────────────────────────────────────────────────────
    if (mode === "harvest") {
      // Action Flower — free, no AP
      if (cell.structure?.type === "actionflower" && (cell.structure.bloomLeft??4) === 0) {
        const ng = deepClone(grid);
        ng[r][c].structure.bloomLeft = 4;
        setGrid(ng);
        setAP(MAX_AP);
        log("🌸 Action Flower harvested! AP fully restored! Flower resets.");
        return;
      }
      if (ap <= 0) { log("❌ No AP left! Press Next Day."); return; }

      // Ripe crop
      if (cell.crop?.growthLeft === 0) {
        const def = CROPS[cell.crop.type];
        const pd  = hasNS(grid,r,c,"plantdoubler");
        const gain = Math.floor(def.profit * (pd ? 1.5 : 1));
        const ng   = deepClone(grid);
        ng[r][c].crop = null;
        if (ng[r][c].structure?.type === "farmland") {
          ng[r][c].structure.tilled = false;
        }
        setGrid(ng); setGold(p=>p+gain); setAP(p=>p-1);
        log(`${def.icon} Harvested ${def.label} → +${gain}g${pd?" 🌟×1.5":""}`);
        return;
      }
      // Fruit tree
      if (cell.structure?.type === "tree") {
        const keg = hasNS(grid,r,c,"keg");
        const gain = 100 * (keg ? 2 : 1);
        setGold(p=>p+gain); setAP(p=>p-1);
        log(`🌳 Fruit Tree → +${gain}g${keg?" 🪣×2":""}`);
        return;
      }
      // Tea
      if (cell.structure?.type === "tea") {
        if (!hasNS(grid,r,c,"water")) { log("🍵 Tea needs a Water Tower nearby!"); return; }
        const keg  = hasNS(grid,r,c,"keg");
        const gain = 350 * (keg ? 2 : 1);
        setGold(p=>p+gain); setAP(p=>p-1);
        log(`🍵 Tea Leaves → +${gain}g${keg?" 🪣×2":""}`);
        return;
      }
      // Rock
      if (cell.structure?.type === "rock") {
        const ng = deepClone(grid);
        ng[r][c].structure = { type:"farmland", tilled:false };
        setGrid(ng); setRock(p=>p+1); setAP(p=>p-1);
        log("🪨 Mined rock! +1 rock. Plot cleared to farmland.");
        return;
      }
      // Wild tree
      if (cell.structure?.type === "bigtree") {
        const ng = deepClone(grid);
        ng[r][c].structure = { type:"farmland", tilled:false };
        setGrid(ng); setWood(p=>p+1); setAP(p=>p-1);
        log("🌲 Chopped tree! +1 wood. Plot cleared to farmland.");
        return;
      }
      log("❓ Nothing to harvest here. Try a ripe crop, tree, tea, rock or wild tree.");
      return;
    }

    // ── TILL ──────────────────────────────────────────────────────────────────
    if (mode === "till") {
      if (ap <= 0) { log("❌ No AP left!"); return; }

      if (cell.structure?.type !== "farmland") {
        log("❌ Can only till farmland.");
        return;
      }

      if (cell.crop) {
        log("❌ Remove crop before tilling.");
        return;
      }

      if (cell.structure.tilled) {
        log("ℹ️ Already tilled.");
        return;
      }

      const ng = deepClone(grid);
      ng[r][c].structure.tilled = true;

      setGrid(ng);
      setAP(p=>p-1);

      log("⛏ Land tilled.");
      return;
    }

    // ── PLANT ─────────────────────────────────────────────────────────────────
    if (mode === "plant") {
      if (ap <= 0) { log("❌ No AP left!"); return; }
      if (cell.structure?.type !== "farmland" || !cell.structure.tilled || cell.crop) { log("❌ Plant on empty farmland only."); return; }
      const def = CROPS[crop];
      if (gold < def.cost) { log(`❌ Need ${def.cost}g for ${def.label} seeds. Current: ${gold}g`); return; }
      const ng = deepClone(grid);
      ng[r][c].crop = { type:crop, growthLeft:def.time, watered:false };
      setGrid(ng); setGold(p=>p-def.cost); setAP(p=>p-1);
      log(`${def.icon} Planted ${def.label} — grows in ${def.time} day${def.time>1?"s":""}. Cost ${def.cost}g.`);
      return;
    }

    // ── WATER ─────────────────────────────────────────────────────────────────
    if (mode === "water") {
      if (ap <= 0) { log("❌ No AP left!"); return; }
      if (!cell.crop) { log("❌ No crop here to water."); return; }
      if (cell.crop.watered || hasNS(grid,r,c,"water")) { log("💧 Already watered (or has Water Tower)!"); return; }
      const ng = deepClone(grid);
      ng[r][c].crop.watered = true;
      setGrid(ng); setAP(p=>p-1);
      log(`💧 Watered ${CROPS[cell.crop.type].label}.`);
      return;
    }

    // ── BUILD ─────────────────────────────────────────────────────────────────
    if (mode === "build") {
      if (build === "farmland") {
        if (cell.structure) {
          log("❌ Tile already has something.");
          return;
        }

        if (gold < 100) {
          log("❌ Need 100g to buy farmland.");
          return;
        }

        const ng = deepClone(grid);
        ng[r][c].structure = { type:"farmland", tilled:false };

        setGrid(ng);
        setGold(p=>p-100);

        log("🟫 Farmland purchased!");
        return;
      }
      if (cell.structure) { log("❌ Tile already has a structure. Harvest it first."); return; }
      if (cell.crop)      { log("❌ Tile has a crop. Harvest it first."); return; }
      const def = STRUCTS[build];
      if (!def || !BUILDABLE.includes(build)) { log("❌ Select a buildable structure."); return; }
      if (gold < def.cost) { log(`❌ Need ${def.cost}g to build ${def.label}. Have ${gold}g.`); return; }
      const ng = deepClone(grid);
      ng[r][c].structure = { type:build, ...(build==="actionflower" ? {bloomLeft:4} : {}) };
      setGrid(ng); setGold(p=>p-def.cost);
      log(`🏗 Built ${def.icon} ${def.label} for ${def.cost}g.`);
      return;
    }

    // ── REWARD ────────────────────────────────────────────────────────────────
    if (mode === "reward") {
      if (!reward || rewUsed) { log("❌ No unused daily reward."); return; }
      if (reward.type === "farmland") {
        if (cell.unlocked || cell.structure) { log("❌ Place farmland on empty tile."); return; }
        const ng = deepClone(grid);
        ng[r][c].structure = { type:"farmland", tilled:false };
        setGrid(ng); setRewUsed(true); setMode("plant");
        log("🟫 Free farmland placed!");
      } else if (reward.type === "structure") {
        if (cell.structure) { log("❌ Clear structure first."); return; }
        if (cell.crop)      { log("❌ Remove crop first."); return; }
        const stype = reward.value;
        const ng = deepClone(grid);
        ng[r][c].structure = { type:stype, ...(stype==="actionflower" ? {bloomLeft:4} : {}) };
        setGrid(ng); setRewUsed(true); setMode("build");
        log(`🎁 Placed free ${STRUCTS[stype]?.icon} ${STRUCTS[stype]?.label}!`);
      }
      return;
    }
  }, [grid, gold, ap, mode, crop, build, reward, rewUsed, status, log]);

  // ── Next Day ──────────────────────────────────────────────────────────────
  const nextDay = useCallback(() => {
    if (status !== "playing") return;
    const { grid:ng, earned, msgs:dm } = processDay(grid);
    const newGold = gold + earned;
    const newDay  = day + 1;

    // Roll reward; auto-claim gold rewards
    const options = Array.from({ length: 3 }, () => randReward());
    //the finalgold is diff in case we want to add a gold reward that is auto-claimed later
    const finalGold = newGold;

    setGrid(ng);
    setGold(finalGold);
    setAP(MAX_AP);
    setDay(newDay);
    setRewardOptions(options);
    setReward(null);
    setRewUsed(false);
    setMsgs(prev => [
      `🌅 Day ${newDay} — passive income +${earned}g`,
      ...dm,
      ...prev,
    ].slice(0,12));

    if (finalGold >= GOAL) { setStatus("won"); return; }
    if (newDay > MAX_DAY)  { setStatus("lost"); }
  }, [grid, gold, day, status]);

  // ── Restart ───────────────────────────────────────────────────────────────
  const restart = () => {
    setGrid(initGrid()); setGold(START_G); setAP(MAX_AP); setDay(1);
    setWood(0); setRock(0); setMode("till"); setCrop("mint"); setBuild("water");
    setReward(null); setRewUsed(false); setStatus("playing");
    setMsgs(["🌿 New game! Till land, plant crops, and reach 5000g in 30 days."]);
  };

  // ── Hover Tooltip ─────────────────────────────────────────────────────────
  const hoverTip = hovered ? (() => {
    const [r,c] = hovered;
    const { type, crop:cr, structure:s } = grid[r][c];
    if (s) {
      const def = STRUCTS[s.type];
      if (s.type === "actionflower") return `🌸 Action Flower — ${(s.bloomLeft??4)===0?"BLOOMED! Click (harvest) to restore AP":`${s.bloomLeft??4} days to bloom`}`;
      return `${def?.icon||"?"} ${def?.label||s.type} — ${def?.desc||""}`;
    }
    if (cr) {
      const def = CROPS[cr.type];
      const wet = cr.watered || hasNS(grid,r,c,"water");
      if (cr.growthLeft===0) return `${def.icon} ${def.label} — ✅ READY to harvest! (+${def.profit}g)`;
      return `${def.icon} ${def.label} — ${wet?`${cr.growthLeft} day(s) left`:"❌ DRY — needs water or Water Tower"}`;
    }
    if (grid[r][c].structure?.type === "farmland") return "🟫 Empty farmland — switch to Plant mode to sow seeds";
    return "⬛ Empty land — unlock via reward or clearing obstacles";
  })() : null;

  // ── Derived ───────────────────────────────────────────────────────────────
  const pct = Math.min(100, (gold/GOAL)*100);

  const MODES = [
    { id:"till",    label:"⛏ Till",    col:"#78350f", hi:"#fbbf24" },
    { id:"plant",   label:"🌱 Plant",   col:"#14532d", hi:"#22c55e" },
    { id:"water",   label:"💧 Water",   col:"#1e3a5f", hi:"#60a5fa" },
    { id:"harvest", label:"🌾 Harvest", col:"#1a3a1a", hi:"#4ade80" },
    { id:"build",   label:"🏗 Build",   col:"#2d1b69", hi:"#818cf8" },
  ];

  return (
    <div style={{
      background:"linear-gradient(150deg,#080604 0%,#120b03 55%,#0b1009 100%)",
      minHeight:"100vh",
      fontFamily:"'Georgia','Times New Roman',serif",
      color:"#fef3c7",
      padding:"14px 10px",
      userSelect:"none",
    }}>

      {/* ── Win / Lose overlay ── */}
      {status !== "playing" && (
        <div style={{
          position:"fixed",inset:0,background:"#000000e0",zIndex:100,
          display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,
        }}>
          <div style={{fontSize:80}}>{status==="won"?"🏆":"💀"}</div>
          <div style={{fontSize:34,color:status==="won"?"#fbbf24":"#ef4444"}}>
            {status==="won"?"Victory!":"Farm Bankrupt"}
          </div>
          <div style={{color:"#a8a29e",fontSize:14,textAlign:"center",maxWidth:340}}>
            {status==="won"
              ? `You reached ${GOAL}g on Day ${day}! Outstanding farmer!`
              : `Day ${MAX_DAY} passed. Final gold: ${gold}g — needed ${GOAL}g.`}
          </div>
          <button onClick={restart} style={{
            marginTop:8,background:"#1c1917",border:"2px solid #fbbf24",
            borderRadius:8,padding:"10px 28px",color:"#fbbf24",
            fontFamily:"inherit",fontSize:15,cursor:"pointer",letterSpacing:1,
          }}>Play Again</button>
        </div>
      )}

      {/* ── Title ── */}
      <div style={{textAlign:"center",marginBottom:10}}>
        <div style={{fontSize:9,letterSpacing:4,textTransform:"uppercase",color:"#57534e",marginBottom:3}}>Turn-Based Farm Sim</div>
        <h1 style={{margin:0,fontSize:21,fontWeight:400,letterSpacing:1,textShadow:"0 0 24px #16a34a33"}}>
          🌿 Mint Farm — Day {day} / {MAX_DAY}
        </h1>
      </div>

      {/* ── Stat Cards ── */}
      <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap",marginBottom:8}}>
        {[
          { l:"Day",  v:`${day}/${MAX_DAY}`, c:"#fbbf24" },
          { l:"Gold", v:`${gold}g`,          c:"#fde68a" },
          { l:"AP",   v:`${ap}/${MAX_AP}`,   c:ap>3?"#86efac":"#f87171" },
          { l:"Wood", v:wood,                 c:"#a3e635" },
          { l:"Rock", v:rock,                 c:"#a8a29e" },
          { l:"Goal", v:`${GOAL}g`,           c:"#c4b5fd" },
        ].map(s => (
          <div key={s.l} style={{
            background:"#1c1917",border:`1px solid ${s.c}33`,
            borderRadius:7,padding:"5px 12px",textAlign:"center",minWidth:55,
          }}>
            <div style={{fontSize:15,fontWeight:700,color:s.c,fontFamily:"monospace"}}>{s.v}</div>
            <div style={{fontSize:8,color:"#6b7280",textTransform:"uppercase",letterSpacing:1.5,marginTop:1}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── Goal Progress Bar ── */}
      <div style={{maxWidth:540,margin:"0 auto 8px",background:"#1c1917",borderRadius:5,height:7,border:"1px solid #292524",overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#22c55e,#fbbf24)",borderRadius:5,transition:"width 0.5s"}}/>
      </div>

      {/* ── Mode Buttons ── */}
      <div style={{display:"flex",gap:5,justifyContent:"center",flexWrap:"wrap",marginBottom:8}}>
        {MODES.map(m => (
          <button key={m.id} onClick={()=>setMode(m.id)} style={{
            background:mode===m.id ? m.col+"cc" : "#1c1917",
            border:`1.5px solid ${mode===m.id ? m.hi : m.col}`,
            borderRadius:6,padding:"5px 12px",
            color:mode===m.id?"#fef3c7":"#a8a29e",
            fontFamily:"inherit",fontSize:11,cursor:"pointer",
            boxShadow:mode===m.id?`0 0 8px ${m.hi}44`:"none",
            transition:"all 0.12s",
          }}>{m.label}</button>
        ))}
        {/* Reward mode button — only when reward exists */}
        {rewardOptions && !rewUsed && (
          <button onClick={()=>setMode("reward")} style={{
            background:mode==="reward"?"#7c2d1288":"#1c1917",
            border:`1.5px solid #f97316`,
            borderRadius:6,padding:"5px 12px",
            color:mode==="reward"?"#fef3c7":"#fb923c",
            fontFamily:"inherit",fontSize:11,cursor:"pointer",
            boxShadow:mode==="reward"?"0 0 8px #f9731644":"none",
            transition:"all 0.12s",
          }}>🎁 Reward</button>
        )}
        <button onClick={nextDay} style={{
          background:"#1e3a5f",border:"1.5px solid #3b82f6",
          borderRadius:6,padding:"5px 14px",color:"#93c5fd",
          fontFamily:"inherit",fontSize:11,cursor:"pointer",
          boxShadow:"0 0 8px #3b82f633",transition:"all 0.12s",
        }}>⏭ Next Day</button>
      </div>

      {/* ── Plant sub-panel ── */}
      {mode === "plant" && (
        <div style={{display:"flex",gap:5,justifyContent:"center",marginBottom:8,flexWrap:"wrap"}}>
          {Object.entries(CROPS).map(([k,v]) => (
            <button key={k} onClick={()=>setCrop(k)} style={{
              background:crop===k?"#14532d":"#1c1917",
              border:`1px solid ${crop===k?"#22c55e":"#44403c"}`,
              borderRadius:6,padding:"4px 13px",color:"#fef3c7",
              fontFamily:"inherit",fontSize:11,cursor:"pointer",textAlign:"center",
            }}>
              {v.icon} {v.label}
              <span style={{display:"block",fontSize:8,color:"#fbbf24"}}>{v.cost}g · {v.time}d → {v.profit}g</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Build sub-panel ── */}
      {mode === "build" && (
        <div style={{display:"flex",gap:4,justifyContent:"center",flexWrap:"wrap",maxWidth:640,margin:"0 auto 8px"}}>
          {BUILDABLE.map(k => {
            const v   = STRUCTS[k];
            const ok  = gold >= v.cost;
            const sel = build === k;
            return (
              <button key={k} onClick={()=>setBuild(k)} title={v.desc} style={{
                background:sel?"#2d1b69":"#1c1917",
                border:`1px solid ${sel?"#818cf8":ok?"#44403c":"#292524"}`,
                borderRadius:6,padding:"3px 9px",
                color:ok?"#fef3c7":"#6b7280",
                fontFamily:"inherit",fontSize:10,cursor:"pointer",textAlign:"center",
                opacity:ok?1:0.55,transition:"all 0.1s",
              }}>
                {v.icon} {v.label}
                <span style={{display:"block",fontSize:8,color:ok?"#fbbf24":"#6b7280"}}>{v.cost}g</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Daily Reward Banner ── */}
      {rewardOptions && !rewUsed && (
        <div style={{textAlign:"center",marginBottom:8}}>
          <div style={{marginBottom:6,fontSize:11,color:"#fbbf24"}}>
            🎁 Choose ONE reward:
          </div>

        <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
          {rewardOptions.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setReward(r);
                      setRewardOptions(null);
                      setMode("reward");
                    }}
                    style={{
                      background:"#1c1917",
                      border:"1px solid #44403c",
                      borderRadius:8,
                      padding:"8px 14px",
                      cursor:"pointer",
                      color:"#fef3c7",
                      fontFamily:"inherit",
                      fontSize:11,
                    }}
                  >
                    {r.type === "farmland"
                      ? "🟫 Farmland"
                      : `${STRUCTS[r.value]?.icon} ${STRUCTS[r.value]?.label}`}
                  </button>
                ))}
              </div>
            </div>
        )}

      {/* ── Grid ── */}
      <div style={{display:"flex",justifyContent:"center",marginBottom:6}}>
        <div style={{
          display:"grid",
          gridTemplateColumns:`repeat(${G},${CS}px)`,
          gap:2,background:"#0c0a09",
          border:"2px solid #292524",borderRadius:10,
          padding:5,boxShadow:"0 14px 44px #000000aa",
        }}>
          {Array.from({length:G},(_,r) =>
            Array.from({length:G},(_,c) => {
              const cell  = grid[r][c];
              const isHov = hovered && hovered[0]===r && hovered[1]===c;
              const v     = cellVis(cell, r, c, grid);
              return (
                <div
                  key={`${r}-${c}`}
                  onClick={()=>handleClick(r,c)}
                  onMouseEnter={()=>setHovered([r,c])}
                  onMouseLeave={()=>setHovered(null)}
                  style={{
                    width:CS, height:CS,
                    background:v.bg,
                    border:`${isHov?"2px":"1.5px"} solid ${isHov?"#fbbf24":v.border}`,
                    borderRadius:4,
                    display:"flex",flexDirection:"column",
                    alignItems:"center",justifyContent:"center",
                    fontSize:19,cursor:"pointer",
                    boxShadow:isHov?"0 0 12px #fbbf2466":v.glow,
                    opacity:v.dim?0.38:1,
                    transform:isHov?"scale(1.12)":"scale(1)",
                    transition:"all 0.09s ease",
                    position:"relative",zIndex:isHov?2:1,
                  }}
                >
                  <span>{v.icon}</span>
                  {v.sub && (
                    <span style={{
                      fontSize:7.5,color:v.subCol||"#9ca3af",
                      lineHeight:1,marginTop:1,fontFamily:"monospace",
                    }}>{v.sub}</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Hover Tooltip ── */}
      <div style={{textAlign:"center",minHeight:16,marginBottom:6}}>
        {hoverTip && (
          <span style={{fontSize:10,color:"#fde68a",fontFamily:"monospace"}}>{hoverTip}</span>
        )}
      </div>

      {/* ── Message Log ── */}
      <div style={{
        maxWidth:560,margin:"0 auto 8px",background:"#1c1917",
        border:"1px solid #292524",borderRadius:8,padding:"7px 11px",
        maxHeight:86,overflowY:"auto",
      }}>
        <div style={{fontSize:8,letterSpacing:2,textTransform:"uppercase",color:"#57534e",marginBottom:3}}>Activity Log</div>
        {msgs.map((m,i) => (
          <div key={i} style={{
            fontSize:10,
            color:i===0?"#fde68a":"#6b7280",
            padding:"1px 0",
            borderBottom:i===0?"1px solid #2a2520":"none",
          }}>{m}</div>
        ))}
      </div>

      {/* ── Legend ── */}
      <div style={{maxWidth:580,margin:"0 auto",display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center"}}>
        {[
          ["🟫","Farmland"],["🌿","Mint"],["🌾","Wheat"],["🥬","Cabbage"],
          ["💧","Water"],["⚡","Growth"],["🍯","Beehive"],["🌳","F.Tree"],
          ["🍵","Tea"],["🪣","Keg"],["🌸","A.Flower"],["🪤","Trap"],
          ["✳️","Trap×"],["🌟","Plant×"],["🪨","Rock"],["🌲","Tree"],
        ].map(([ic,lb]) => (
          <div key={lb} style={{display:"flex",alignItems:"center",gap:2,fontSize:8,color:"#57534e"}}>
            <span style={{fontSize:10}}>{ic}</span>{lb}
          </div>
        ))}
      </div>

      {/* ── Quick How-To ── */}
      <div style={{maxWidth:560,margin:"8px auto 0",background:"#1c1917",border:"1px solid #292524",borderRadius:8,padding:"7px 12px"}}>
        <div style={{fontSize:8,letterSpacing:2,textTransform:"uppercase",color:"#57534e",marginBottom:4}}>How To Play</div>
        <div style={{fontSize:9,color:"#6b7280",lineHeight:1.8,fontFamily:"monospace"}}>
          1. <span style={{color:"#fbbf24"}}>⛏ Till</span> empty land → 
          2. <span style={{color:"#22c55e"}}>🌱 Plant</span> seeds → 
          3. <span style={{color:"#60a5fa"}}>💧 Water</span> (or build Water Tower) → 
          4. <span style={{color:"#4ade80"}}>🌾 Harvest</span> when READY<br/>
          Each action costs 1 AP. Press <span style={{color:"#93c5fd"}}>⏭ Next Day</span> to grow crops &amp; collect passive income.<br/>
          <span style={{color:"#fb923c"}}>🎁 Daily reward</span> is free — use Reward mode to place it. Goal: reach <span style={{color:"#c4b5fd"}}>{GOAL}g</span> in {MAX_DAY} days!
        </div>
      </div>
    </div>
  );
}