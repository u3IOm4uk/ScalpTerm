'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const scene = $('scene'), viewport = $('viewport');
  const KEY = 'scalpterm-design-01-docked-v2';
  const instruments = {
    BTCUSDT: {price:64120,step:1,digits:0,range:185},
    ETHUSDT: {price:2640.20,step:.05,digits:2,range:12},
    SOLUSDT: {price:148.25,step:.01,digits:2,range:1.7},
    XRPUSDT: {price:.5868,step:.0001,digits:4,range:.009}
  };
  const clusterFrames = {'1m':1,'5m':5,'15m':15};
  const orderSizes = [100,200,300,400,500];
  const chartWidthDefault = 7, chartWidthMin = 3, chartWidthMax = 24;
  const chartPriceScaleMin = .5, chartPriceScaleMax = 4;
  let modules = [], serial = 0, scale = 1, selected = new Set(), active = null;
  let locked = false, rowHeight = 20, digitSize = 13;
  let defaultClusterFrame = '1m', defaultChartFrame = '1m', showChartVolume = true, tapeScale = 1;
  let zoom = 'fit', theme = 'system', history = [], drag = null, maximized = null, toastTimer;
  let tree = null, splitSerial = 0, splitDrag = null, canvasW = 0, canvasH = 0;
  const elements = new Map();
  const settingsWindows = new Map();
  const settingsChannel = new BroadcastChannel('scalpterm-settings-v1');
  const fmt = (v, d) => v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:false});
  const short = v => v >= 1000000 ? (v/1000000).toFixed(1)+'m' : v >= 1000 ? (v/1000).toFixed(v>=10000?0:1)+'k' : String(Math.round(v));
  function random(seed) { return () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; }; }
  function clusterSeedOf(text) {
    let seed=[...text].reduce((v,c)=>(Math.imul(v,31)+c.charCodeAt(0))>>>0,7);
    seed=Math.imul(seed^(seed>>>16),0x7feb352d);
    seed=Math.imul(seed^(seed>>>15),0x846ca68b);
    return (seed^(seed>>>16))>>>0;
  }
  function demoDepthVolume(symbol,market,priceTick) {
    const rng=random(clusterSeedOf(`${symbol}:${market}:depth:${priceTick}`));
    return 500+rng()*35000*(rng()<.13?5:1);
  }
  const marketStreams=new Map();
  const streamStepMs=5000;
  function getMarketStream(symbol,market) {
    const key=`${symbol}:${market}`;
    if(marketStreams.has(key))return marketStreams.get(key);
    const info=instruments[symbol],clock=Date.now(),priceTick=Math.round(info.price*(market==='F'?1:.9994)/info.step);
    const rng=random(clusterSeedOf(`${key}:${Math.floor(clock/1000)}`));
    const stream={symbol,market,info,clock,priceTick,rng,trades:[],depth:new Map(),candles:{},frameStarts:{}};
    let historicalTick=priceTick;
    for(let i=180;i>0;i--){
      const move=rng();historicalTick+=move<.18?-1:move>.82?1:0;
      stream.trades.push({tick:historicalTick,volume:Math.round(250+rng()*2200),isBuy:rng()>.5,time:clock-i*streamStepMs});
    }
    const offset=priceTick-historicalTick;
    stream.trades.forEach(trade=>trade.tick+=offset);
    for(const [frame,minutes] of Object.entries(clusterFrames)){
      const historyRng=random(clusterSeedOf(`${key}:${frame}:candles`)),candles=[];
      let close=priceTick*info.step;
      for(let i=0;i<640;i++){
        const open=close+(historyRng()-.5)*info.range*.12*Math.sqrt(minutes);
        const high=Math.max(open,close)+historyRng()*info.range*.035;
        const low=Math.min(open,close)-historyRng()*info.range*.035;
        candles.unshift({open,high,low,close,volume:.1+historyRng()*.8});close=open;
      }
      stream.candles[frame]=candles;
      stream.frameStarts[frame]=Math.floor(clock/(minutes*60000))*minutes*60000;
    }
    marketStreams.set(key,stream);
    return stream;
  }
  function advanceMarketStream(stream) {
    const {rng,info}=stream;
    const move=rng();
    stream.priceTick=Math.max(1,stream.priceTick+(move<.13?-2:move<.43?-1:move<.57?0:move<.87?1:2));
    stream.clock+=streamStepMs;
    const trade={tick:stream.priceTick,volume:Math.round(300+rng()*3000*(rng()<.06?4:1)),isBuy:move>=.57,time:stream.clock};
    stream.trades.push(trade);
    while(stream.trades.length&&stream.trades[0].time<stream.clock-15*60000)stream.trades.shift();
    for(let i=0;i<3;i++){
      const tick=i===0?trade.tick:stream.priceTick+Math.floor(rng()*25)-12;
      const old=stream.depth.get(tick)??demoDepthVolume(stream.symbol,stream.market,tick);
      stream.depth.set(tick,Math.max(300,Math.min(200000,i===0?old-trade.volume:old*(.68+rng()*.64))));
    }
    if(stream.depth.size>300){for(const tick of stream.depth.keys()){if(Math.abs(tick-stream.priceTick)>80)stream.depth.delete(tick);}}
    const price=stream.priceTick*info.step;
    for(const [frame,minutes] of Object.entries(clusterFrames)){
      const frameStart=Math.floor(stream.clock/(minutes*60000))*minutes*60000;
      const candles=stream.candles[frame];
      if(frameStart!==stream.frameStarts[frame]){
        const open=candles.at(-1).close;
        candles.push({open,high:Math.max(open,price),low:Math.min(open,price),close:price,volume:0});
        if(candles.length>640)candles.shift();
        stream.frameStarts[frame]=frameStart;
      }
      const current=candles.at(-1);
      current.high=Math.max(current.high,price);current.low=Math.min(current.low,price);
      current.close=price;current.volume=Math.min(1,current.volume+trade.volume/25000);
    }
  }
  function notify(message) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
  function snapshot() { return JSON.stringify({modules,tree}); }
  function remember() { history.push(snapshot()); if(history.length>30) history.shift(); $('undo').disabled=false; }
  function save() {
      try {localStorage.setItem(KEY,JSON.stringify({modules,tree,locked,rowHeight,digitSize,defaultClusterFrame,defaultChartFrame,showChartVolume,tapeScale,zoom,theme}));return true;}
      catch { notify('Збереження недоступне');return false; }
  }
  function initial() {
    serial=0; modules=[];
    Object.keys(instruments).forEach((symbol,i)=>{
      const group=String.fromCharCode(65+i), x=i*637;
      modules.push({id:++serial,type:'chart',symbol,market:'F',group,x,y:0,w:633,h:350,timeframe:defaultChartFrame,chartCandleWidth:chartWidthDefault,chartPriceScale:1,offset:0});
      modules.push({id:++serial,type:'dom',symbol,market:'F',group,x,y:354,w:314.5,h:960,offset:0,clusterTimeframe:defaultClusterFrame});
      modules.push({id:++serial,type:'dom',symbol,market:'S',group,x:x+318.5,y:354,w:314.5,h:960,offset:0,clusterTimeframe:defaultClusterFrame});
    });
    tree=split('x',Array.from({length:4},(_,i)=>split('y',[leaf(i*3+1),split('x',[leaf(i*3+2),leaf(i*3+3)])],[430,880])));
  }
  function leaf(id){return {id};}
  function split(axis,children,weights){return {splitId:++splitSerial,axis,children,weights:weights||children.map(()=>1)};}
  function leaves(n){return !n?[]:n.children?n.children.flatMap(leaves):[n.id];}
  function walk(n,fn){if(!n)return;fn(n);if(n.children)n.children.forEach(c=>walk(c,fn));}
  function removeLeaf(n,id){if(!n)return null;if(!n.children)return n.id===id?null:n;const children=[],weights=[];n.children.forEach((c,i)=>{const child=removeLeaf(c,id);if(child){children.push(child);weights.push(n.weights[i]);}});if(!children.length)return null;if(children.length===1)return children[0];return {...n,children,weights};}
  function replaceNode(n,target,replacement){if(n===target)return replacement;if(n.children)n.children=n.children.map(c=>replaceNode(c,target,replacement));return n;}
  function findLeaf(id){let result=null;walk(tree,n=>{if(!n.children&&n.id===id)result=n;});return result;}
  function minSize(n){if(!n)return {w:48,h:64};if(!n.children)return {w:modules.find(m=>m.id===n.id)?.type==='dom'?48:96,h:64};const sizes=n.children.map(minSize);return n.axis==='x'?{w:sizes.reduce((s,m)=>s+m.w,0)+(sizes.length-1)*4,h:Math.max(...sizes.map(m=>m.h))}:{w:Math.max(...sizes.map(m=>m.w)),h:sizes.reduce((s,m)=>s+m.h,0)+(sizes.length-1)*4};}
  function allocate(total,weights,mins){const minimum=mins.reduce((sum,value)=>sum+value,0);if(minimum>total)return mins.map(value=>value*total/minimum);const out=weights.map(()=>0),pending=new Set(weights.map((_,i)=>i));let rest=total;while(pending.size){const sum=[...pending].reduce((s,i)=>s+weights[i],0);let fixed=false;for(const i of [...pending]){const v=rest*weights[i]/sum;if(v<mins[i]){out[i]=mins[i];rest-=mins[i];pending.delete(i);fixed=true;break;}}if(!fixed){const sum2=[...pending].reduce((s,i)=>s+weights[i],0);pending.forEach(i=>out[i]=rest*weights[i]/sum2);break;}}return out;}
  function layout(n,x,y,w,h){if(!n)return;if(!n.children){const m=modules.find(m=>m.id===n.id);if(m)Object.assign(m,{x,y,w,h});return;}const horizontal=n.axis==='x',available=(horizontal?w:h)-(n.children.length-1)*4,mins=n.children.map(c=>minSize(c)[horizontal?'w':'h']);const lengths=allocate(available,n.weights,mins);let cursor=horizontal?x:y;n.children.forEach((child,i)=>{layout(child,horizontal?cursor:x,horizontal?y:cursor,horizontal?lengths[i]:w,horizontal?h:lengths[i]);cursor+=lengths[i];if(i<n.children.length-1){const bar=document.createElement('div');bar.className='splitter '+(horizontal?'split-x':'split-y');bar.dataset.split=n.splitId;bar.dataset.boundary=i;Object.assign(bar.style,{left:(horizontal?cursor:x)+'px',top:(horizontal?y:cursor)+'px',width:(horizontal?4:w)+'px',height:(horizontal?h:4)+'px'});bar.addEventListener('pointerdown',e=>startSplit(e,n,i,lengths));scene.append(bar);cursor+=4;}});}
  function relayout(){scene.querySelectorAll('.splitter').forEach(e=>e.remove());canvasW=Math.max(1,viewport.clientWidth-16);canvasH=Math.max(1,viewport.clientHeight-16);layout(tree,0,0,canvasW,canvasH);}
  function restore() {
    try {
      const s=JSON.parse(localStorage.getItem(KEY));
      if(!s || !Array.isArray(s.modules) || !s.modules.length) return false;
      const ids=new Set();
      if(!s.modules.every(m=>{
        if(!m || !Number.isInteger(m.id) || ids.has(m.id)) return false;
        ids.add(m.id);
        return ['chart','dom'].includes(m.type) && (m.symbol===null||Object.hasOwn(instruments,m.symbol)) && (m.market===null||['F','S'].includes(m.market)) && ['x','y','w','h'].every(k=>Number.isFinite(m[k])) && m.x>=0 && m.y>=0 && m.w>0 && m.h>0 && Number.isFinite(m.offset) && /^(?:[A-Z]|G\d+|—)$/.test(m.group) && (m.linkedGroup===undefined||typeof m.linkedGroup==='boolean') && (m.type!=='chart'||(['1m','5m','15m'].includes(m.timeframe) && (m.chartCandleWidth===undefined||Number.isFinite(m.chartCandleWidth)&&m.chartCandleWidth>=chartWidthMin&&m.chartCandleWidth<=chartWidthMax) && (m.chartPriceScale===undefined||Number.isFinite(m.chartPriceScale)&&m.chartPriceScale>=chartPriceScaleMin&&m.chartPriceScale<=chartPriceScaleMax))) && (m.type!=='dom'||((m.clusterTimeframe===undefined||Object.hasOwn(clusterFrames,m.clusterTimeframe)) && (m.orderSize===undefined||orderSizes.includes(m.orderSize))));
      })) return false;
      let validTree=true;const treeIds=[],splitIds=new Set();
      function validate(n,depth=0){if(!n||depth>200){validTree=false;return;}if(n.children){if(!['x','y'].includes(n.axis)||!Array.isArray(n.children)||n.children.length<2||!Array.isArray(n.weights)||n.weights.length!==n.children.length||!n.weights.every(v=>Number.isFinite(v)&&v>0)||!Number.isInteger(n.splitId)||splitIds.has(n.splitId)){validTree=false;return;}splitIds.add(n.splitId);n.children.forEach(c=>validate(c,depth+1));}else treeIds.push(n.id);}
      validate(s.tree);if(!validTree||treeIds.length!==ids.size||new Set(treeIds).size!==ids.size||!treeIds.every(id=>ids.has(id)))return false;
      modules=s.modules;modules.forEach(m=>{m.market??='F';if(m.type==='dom'){m.clusterTimeframe??='1m';m.orderSize??=100;}else{m.chartCandleWidth??=chartWidthDefault;m.chartPriceScale??=1;}});tree=s.tree;
      walk(tree,n=>{if(n.axis==='y'&&n.weights?.length===2&&n.weights[0]===350&&n.weights[1]===960)n.weights=[430,880];});
      splitSerial=Math.max(0,...splitIds);serial=Math.max(...modules.map(m=>m.id)); locked=!!s.locked;
      rowHeight=[18,20,24].includes(s.rowHeight)?s.rowHeight:20; digitSize=[12,13,14].includes(s.digitSize)?s.digitSize:13;
      defaultClusterFrame=Object.hasOwn(clusterFrames,s.defaultClusterFrame)?s.defaultClusterFrame:'1m';
      defaultChartFrame=['1m','5m','15m'].includes(s.defaultChartFrame)?s.defaultChartFrame:'1m';
      showChartVolume=s.showChartVolume!==false;
      tapeScale=[.75,1,1.25].includes(s.tapeScale)?s.tapeScale:1;
      zoom=['fit','1'].includes(s.zoom)?'fit':['0.75','0.5'].includes(s.zoom)?s.zoom:'fit'; theme=['system','light','dark'].includes(s.theme)?s.theme:'system'; return true;
    } catch { return false; }
  }
  function cssToken(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function resolvedTheme() { return theme==='system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : theme; }
  function applyTheme(redraw=true) {
    document.documentElement.dataset.theme=resolvedTheme();
    document.documentElement.style.colorScheme=resolvedTheme();
    if(redraw) modules.forEach(m=>{const el=elements.get(m.id);if(el)redrawModule(m,el);});
  }
  function applySettings() {
    document.documentElement.style.setProperty('--row',rowHeight+'px');
    document.documentElement.style.setProperty('--digits',digitSize+'px');
    document.body.classList.toggle('locked',locked); applyTheme(false);
  }
  function fit() {
    const cw=canvasW, ch=canvasH;
    scene.style.width=cw+'px'; scene.style.height=ch+'px';
    scale=zoom==='fit'?1:Number(zoom);
    scene.style.transform=`scale(${scale})`;
    // A containing sizing element avoids scrollbars from the unscaled layout box.
    scene.style.position='absolute'; scene.style.left='8px'; scene.style.top='8px';
    let spacer=$('scene-spacer'); if(!spacer){spacer=document.createElement('div');spacer.id='scene-spacer';spacer.setAttribute('aria-hidden','true');viewport.append(spacer);}
    spacer.style.width=cw*scale+'px';spacer.style.height=ch*scale+'px';spacer.style.pointerEvents='none';
  }
  function setRect(el,m) { Object.assign(el.style,{left:m.x+'px',top:m.y+'px',width:m.w+'px',height:m.h+'px'}); }
  function updateSelection() {
    elements.forEach((el,id)=>{el.classList.toggle('selected',selected.has(id));el.classList.toggle('active',id===active); if(!el.classList.contains('maximized'))el.style.zIndex=id===active?'20':'1';});
  }
  function choose(id,multi=false) {
    active=id;
    if(multi){if(selected.has(id))selected.delete(id);else selected.add(id);}
    else if(!selected.has(id) || selected.size===1) selected=new Set([id]);
    updateSelection();
  }
  function render() {
    elements.forEach(el=>el.remove()); elements.clear();
    relayout();
    for(const m of modules) {
      const el=document.createElement('section');el.className='module';el.dataset.id=m.id;el.setAttribute('aria-label',`${m.type==='chart'?'Графік':'Стакан'} ${m.symbol||'без інструмента'} ${m.market==='F'?'ф’ючерс':m.market==='S'?'спот':'без ринку'}`);
      setRect(el,m);
      const symbolOptions=`<option value="">Інструмент…</option>${Object.keys(instruments).map(symbol=>`<option value="${symbol}">${symbol}</option>`).join('')}`;
      const exchangeIcon=m.symbol?'<span class="exchange-icon" role="img" aria-label="Binance" title="Binance"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 15.2 4.7 12 7.9 8.8 4.7ZM4.7 8.8 7.9 12 4.7 15.2 1.5 12ZM19.3 8.8 22.5 12 19.3 15.2 16.1 12ZM12 16.1 15.2 19.3 12 22.5 8.8 19.3ZM12 8.3 15.7 12 12 15.7 8.3 12Z"/></svg></span>':'';
      const marketText=m.market==='S'?'SPOT':'FUT';
      const nextMarket=m.market==='F'?'спот':'ф’ючерс';
      const marketControl=`<button type="button" class="market-tag market-toggle ${m.market==='S'?'spot':''}" aria-label="Ринок: ${m.market==='S'?'спот':'ф’ючерс'}. Натисніть, щоб обрати ${nextMarket}" title="Перемкнути на ${nextMarket}">${marketText}</button>`;
      const timeframeControl=m.type==='chart'?'<select class="chart-timeframe-picker" aria-label="Таймфрейм графіка" title="Таймфрейм графіка"><option value="1m">1 хв</option><option value="5m">5 хв</option><option value="15m">15 хв</option></select>':'';
      el.innerHTML=`<div class="module-header ${m.type==='chart'?'chart-header':''}"><span class="group-tag">${m.group}</span><span class="symbol-control">${exchangeIcon}<select class="module-symbol-picker" aria-label="Інструмент модуля">${symbolOptions}</select></span>${timeframeControl}${marketControl}<span class="module-actions"><button data-action="maximize" aria-label="Розгорнути модуль" title="Розгорнути / відновити">⛶</button><button data-action="close" aria-label="Закрити модуль" title="Закрити модуль">×</button></span></div><div class="module-content"></div><div class="module-footer"></div>`;
      const symbolPicker=el.querySelector('.module-symbol-picker');symbolPicker.value=m.symbol||'';
      symbolPicker.onchange=e=>{const symbol=e.target.value||null;if(m.linkedGroup)modules.filter(item=>item.linkedGroup&&item.group===m.group).forEach(item=>item.symbol=symbol);else m.symbol=symbol;render();save();};
      el.querySelector('.market-toggle').onclick=()=>{m.market=m.market==='F'?'S':'F';render();save();};
      scene.append(el);elements.set(m.id,el);
      const body=el.querySelector('.module-content'), footer=el.querySelector('.module-footer');
      if(m.type==='chart') {
        body.innerHTML=`<canvas class="chart-canvas" role="img" aria-label="Свічковий графік ${m.symbol||'без інструмента'}. Коліщатко масштабує свічки; перетягування шкали цін змінює вертикальний масштаб, шкали часу — горизонтальний" title="Коліщатко: масштаб свічок · Цінова шкала: вертикальний масштаб · Часова шкала: горизонтальний масштаб"></canvas><div class="module-empty chart-empty" hidden></div>`;
        el.querySelector('.chart-timeframe-picker').onchange=e=>{m.timeframe=e.target.value;drawChart(m,el);save();};
        bindChartScale(m,el);
        footer.remove();
        drawChart(m,el);
      } else {
        body.innerHTML='<div class="dom-grid" aria-label="Кластер загального обсягу, стрічка угод, обсяг заявок, ціна"></div><div class="module-empty dom-empty" hidden></div>';
        if(m.market==='F'){
          const picker=document.createElement('div');
          picker.className='order-size-picker';
          picker.setAttribute('role','group');
          picker.setAttribute('aria-label','Обсяг угоди, USDT');
          picker.innerHTML=`<span class="order-size-label">USDT</span>${orderSizes.map(size=>`<button type="button" data-order-size="${size}" aria-pressed="${(m.orderSize??100)===size}">${size}</button>`).join('')}`;
          picker.addEventListener('click',event=>{const button=event.target.closest('[data-order-size]');if(!button)return;m.orderSize=Number(button.dataset.orderSize);picker.querySelectorAll('[data-order-size]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));save();});
          body.append(picker);
        }
        footer.innerHTML=`<button class="dom-footer-button" data-action="center" title="Повернути до найкращих цін">◎ До ринку</button><label class="cluster-frame">Кластер <select aria-label="Таймфрейм кластера"><option value="1m">1 хв</option><option value="5m">5 хв</option><option value="15m">15 хв</option></select></label><span class="right">Крок ${m.symbol?fmt(instruments[m.symbol].step,instruments[m.symbol].digits):'—'}</span>`;
        const frameSelect=footer.querySelector('.cluster-frame select');frameSelect.value=m.clusterTimeframe||'1m';
        frameSelect.setAttribute('aria-label',`Таймфрейм кластера ${m.symbol||'без інструмента'}, ${m.market==='F'?'ф’ючерс':m.market==='S'?'спот':'без ринку'}`);
        frameSelect.onchange=e=>{m.clusterTimeframe=e.target.value;drawDom(m,el);save();};
        const grid=body.querySelector('.dom-grid');grid.addEventListener('wheel',e=>{if(e.ctrlKey)return;e.preventDefault();m.offset+=Math.sign(e.deltaY)*3;drawDom(m,el);save();},{passive:false});
        drawDom(m,el);
      }
      el.addEventListener('pointerdown',e=>{if(!e.target.closest('button,select,input'))choose(m.id,e.ctrlKey||e.metaKey);});
      el.querySelector('.module-header').addEventListener('pointerdown',e=>startDrag(e,m,el));
      el.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
        if(b.dataset.action==='close'){if(locked){notify('Спершу розблокуйте розкладку');return;}remember();exitMax();modules=modules.filter(x=>x.id!==m.id);tree=removeLeaf(tree,m.id);selected.delete(m.id);render();save();}
        if(b.dataset.action==='center'){m.offset=0;drawDom(m,el);save();}
        if(b.dataset.action==='maximize')toggleMax(m,el);
      });
    }
    updateSelection();fit();
  }
  function bindChartScale(m,el) {
    const canvas=el.querySelector('.chart-canvas');
    let dragAxis=null;
    const axisAt=(event)=>{
      const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*canvas.clientWidth/rect.width,y=(event.clientY-rect.top)*canvas.clientHeight/rect.height;
      if(x>=canvas.clientWidth-69&&y<canvas.clientHeight-32)return 'price';
      if(y>=canvas.clientHeight-32&&x<canvas.clientWidth-69)return 'time';
      return null;
    };
    canvas.addEventListener('wheel',event=>{
      if(event.ctrlKey)return;
      event.preventDefault();
      m.chartCandleWidth=Math.max(chartWidthMin,Math.min(chartWidthMax,m.chartCandleWidth*(event.deltaY<0?1.12:1/1.12)));
      drawChart(m,el);save();
    },{passive:false});
    canvas.addEventListener('pointerdown',event=>{
      const axis=axisAt(event);if(!axis||event.button!==0)return;
      dragAxis={axis,startX:event.clientX,startY:event.clientY,startValue:axis==='price'?m.chartPriceScale:m.chartCandleWidth,displayScale:canvas.getBoundingClientRect().width/canvas.clientWidth};
      canvas.setPointerCapture(event.pointerId);event.preventDefault();
    });
    canvas.addEventListener('pointermove',event=>{
      if(!dragAxis){canvas.style.cursor=axisAt(event)==='price'?'ns-resize':axisAt(event)==='time'?'ew-resize':'crosshair';return;}
      const delta=(dragAxis.axis==='price'?event.clientY-dragAxis.startY:event.clientX-dragAxis.startX)/dragAxis.displayScale;
      const value=dragAxis.startValue*Math.exp(delta/140);
      if(dragAxis.axis==='price')m.chartPriceScale=Math.max(chartPriceScaleMin,Math.min(chartPriceScaleMax,value));
      else m.chartCandleWidth=Math.max(chartWidthMin,Math.min(chartWidthMax,value));
      drawChart(m,el);
    });
    const endDrag=()=>{if(dragAxis){dragAxis=null;save();}};
    canvas.addEventListener('pointerup',endDrag);
    canvas.addEventListener('pointercancel',endDrag);
    canvas.addEventListener('lostpointercapture',endDrag);
  }
  function drawChart(m,el) {
    const canvas=el.querySelector('canvas'); if(!canvas)return;
    el.querySelector('.chart-timeframe-picker').value=m.timeframe;
    const empty=el.querySelector('.module-empty');
    if(!m.symbol||!m.market){canvas.hidden=true;empty.hidden=false;empty.textContent=!m.symbol?'Оберіть інструмент у заголовку':'Оберіть ринок графіка';return;}
    canvas.hidden=false;empty.hidden=true;
    const w=canvas.clientWidth,h=canvas.clientHeight; if(!w||!h)return;
    const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    const c=canvas.getContext('2d');c.scale(dpr,dpr);c.fillStyle=cssToken('--chart-bg');c.fillRect(0,0,w,h);
    const stream=getMarketStream(m.symbol,m.market),info=stream.info;
    const pw=w-69,ph=h-32,plotTop=8,plotHeight=Math.max(1,ph-18),base=stream.priceTick*info.step,range=info.range;
    const candleWidth=m.chartCandleWidth||chartWidthDefault,priceScale=m.chartPriceScale||1;
    canvas.dataset.candleWidth=String(candleWidth);canvas.dataset.priceScale=String(priceScale);
    canvas.dataset.lastPrice=fmt(stream.priceTick*info.step,info.digits);
    canvas.dataset.streamTime=String(stream.clock);
    const visibleCount=Math.max(1,Math.min(640,Math.floor((pw-14)/candleWidth)));
    const visible=stream.candles[m.timeframe].slice(-visibleCount),centerY=plotTop+plotHeight/2;
    const y=value=>centerY+(base-value)/range*plotHeight*priceScale;
    const x=index=>pw-8-(visible.length-1-index)*candleWidth;
    c.strokeStyle=cssToken('--chart-grid');c.lineWidth=1;c.font='10px "Segoe UI",sans-serif';
    const axisLines=h<160?3:5;
    for(let i=0;i<axisLines;i++){
      const axisY=plotTop+i*plotHeight/(axisLines-1);
      c.beginPath();c.moveTo(0,axisY+.5);c.lineTo(pw,axisY+.5);c.stroke();
      c.fillStyle=cssToken('--chart-axis');
      c.fillText(fmt(base+(.5-i/(axisLines-1))*range/priceScale,info.digits),pw+7,axisY+3);
    }
    const labelCount=Math.min(w<270?3:5,visible.length),frameMinutes=clusterFrames[m.timeframe]||1;
    for(let i=0;i<labelCount;i++){
      const index=labelCount===1?0:Math.round(i*(visible.length-1)/(labelCount-1)),labelX=x(index);
      const time=new Date(stream.frameStarts[m.timeframe]-(visible.length-1-index)*frameMinutes*60000);
      const label=`${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;
      c.strokeStyle=cssToken('--chart-grid-subtle');c.beginPath();c.moveTo(labelX,0);c.lineTo(labelX,ph);c.stroke();
      c.fillStyle=cssToken('--chart-axis-muted');c.fillText(label,Math.max(3,labelX-13),h-10);
    }
    c.save();c.beginPath();c.rect(0,plotTop,pw,plotHeight);c.clip();
    visible.forEach((v,i)=>{
      const candleX=x(i),up=v.close>=v.open,col=up?cssToken('--buy'):cssToken('--sell');
      c.strokeStyle=col;c.beginPath();c.moveTo(candleX+.5,y(v.high));c.lineTo(candleX+.5,y(v.low));c.stroke();
      c.fillStyle=col;c.fillRect(candleX-candleWidth*.3,Math.min(y(v.open),y(v.close)),Math.max(2,candleWidth*.6),Math.max(1,Math.abs(y(v.open)-y(v.close))));
      if(showChartVolume){c.globalAlpha=.2;c.fillRect(candleX-candleWidth*.3,plotTop+plotHeight-v.volume*24,Math.max(2,candleWidth*.6),v.volume*24);c.globalAlpha=1;}
    });
    const last=visible.at(-1),lastY=y(last.close);
    c.setLineDash([3,4]);c.strokeStyle=cssToken('--chart-last-line');c.beginPath();c.moveTo(0,lastY);c.lineTo(pw,lastY);c.stroke();c.setLineDash([]);c.restore();
    const markerY=Math.max(9,Math.min(ph-9,lastY));
    c.fillStyle=cssToken('--chart-last-bg');c.fillRect(pw,markerY-9,69,18);
    c.fillStyle=cssToken('--chart-last-text');c.font='11px "Segoe UI",sans-serif';c.fillText(fmt(last.close,info.digits),pw+5,markerY+4);
  }
  function clusterFromTrades(m) {
    const stream=getMarketStream(m.symbol,m.market),frameStart=stream.frameStarts[m.clusterTimeframe];
    const levels=new Map();let maxVolume=0;
    for(const trade of stream.trades){
      if(trade.time<frameStart)continue;
      const value=levels.get(trade.tick)||{bid:0,ask:0};
      value[trade.isBuy?'ask':'bid']+=trade.volume;
      levels.set(trade.tick,value);
      maxVolume=Math.max(maxVolume,value.bid+value.ask);
    }
    return {levels,maxVolume};
  }
  function drawDom(m,el) {
    const grid=el.querySelector('.dom-grid');if(!grid)return;
    const empty=el.querySelector('.module-empty');
    const picker=el.querySelector('.order-size-picker');
    if(!m.symbol||!m.market){grid.hidden=true;if(picker)picker.hidden=true;empty.hidden=false;empty.textContent=!m.symbol?'Оберіть інструмент у заголовку':'Оберіть ринок стакана';return;}
    grid.hidden=false;empty.hidden=true;
    if(picker)picker.hidden=false;
    const stream=getMarketStream(m.symbol,m.market),info=stream.info,rows=Math.ceil(grid.clientHeight/rowHeight),middle=Math.floor(rows*.45),baseTick=stream.priceTick;
    grid.dataset.lastPrice=fmt(baseTick*info.step,info.digits);grid.dataset.streamTime=String(stream.clock);
    const {levels:clusterLevels,maxVolume:clusterMax}=clusterFromTrades(m);
    let html='';
    for(let i=0;i<rows;i++) {
      const level=middle-i+m.offset,priceTick=baseTick+level,price=priceTick*info.step,ask=level>=1,best=level===1?'best-ask':level===0?'best-bid':'',vol=stream.depth.get(priceTick)??demoDepthVolume(m.symbol,m.market,priceTick);
      const width=Math.min(100,vol/115000*100),heavy=vol>95000;
      const executed=clusterLevels.get(priceTick);
      let clusterHtml='<div class="cluster"></div>';
      if(executed){
        const total=executed.bid+executed.ask,delta=executed.ask-executed.bid;
        const deltaText=(delta>=0?'+':'')+fmt(delta,0);
        const side=delta>0?'buy':delta<0?'sell':'neutral';
        const fill=(total/clusterMax*100).toFixed(1);
        clusterHtml=`<div class="cluster delta-${side}" data-tip="Бід: ${fmt(executed.bid,0)}\nАск: ${fmt(executed.ask,0)}\nДельта: ${deltaText}"><span class="cluster-fill" style="width:${fill}%"></span><span class="cluster-total">${short(total)}</span></div>`;
      }
      html+=`<div class="dom-row ${ask?'ask':'bid'} ${best}">${clusterHtml}<div class="tape-lane"></div><div class="depth ${heavy?'heavy':''}" data-tip="${ask?'Ask':'Bid'} · ${fmt(price,info.digits)}\nОбсяг заявок: ${fmt(vol,0)} USDT"><span class="depth-bar" style="width:${width}%"></span><span class="depth-amount">${short(vol)}</span></div><div class="price ${priceTick%5===0?'major':''}" ${best?`data-tip="${best==='best-ask'?'Best ask':'Best bid'} · ${fmt(price,info.digits)}"`:''}>${fmt(price,info.digits)}</div></div>`;
    }
    grid.innerHTML=html;

    const firstRow=grid.querySelector('.dom-row');
    const tapeWidth=firstRow?.querySelector('.tape-lane')?.clientWidth||0;
    if(picker){const pickerWidth=Math.max(0,Math.min(32,tapeWidth-2));picker.style.left=((firstRow?.querySelector('.cluster')?.clientWidth||0)+(tapeWidth-pickerWidth)/2)+'px';picker.style.width=pickerWidth+'px';}
    const rightFixed=(firstRow?.querySelector('.depth')?.clientWidth||0)+(firstRow?.querySelector('.price')?.clientWidth||0);
    const count=Math.max(1,Math.floor(tapeWidth/7));
    for(let age=0;age<count;age++) {
      const trade=stream.trades.at(-1-age);if(!trade)break;
      const row=middle-(trade.tick-baseTick)+m.offset,size=Math.min(tapeWidth-7,Math.max(3,Math.round(Math.sqrt(trade.volume/25)*tapeScale))),right=5+age*7;
      if(size<3||row<0||row>=rows||right+size>tapeWidth-2||picker&&row*rowHeight+rowHeight/2+size/2>picker.offsetTop)continue;
      const square=document.createElement('span');
      square.className='trade-square'+(trade.isBuy?'':' sell')+(age>count*.7?' old':'');
      Object.assign(square.style,{width:size+'px',height:size+'px',right:(rightFixed+right)+'px',top:(row*rowHeight+rowHeight/2)+'px'});
      square.dataset.tip=`Угода · ${trade.isBuy?'покупець':'продавець'}\nЦіна: ${fmt(trade.tick*info.step,info.digits)}\nОбсяг: ${trade.volume.toLocaleString('en-US')} USDT\nНові угоди — праворуч`;
      if(size>=23)square.textContent=short(trade.volume);
      grid.append(square);
    }
  }
  function redraw(m,el){if(m.type==='dom')drawDom(m,el);else drawChart(m,el);}
  const redrawModule=redraw;
  function exitMax() {
    if(!maximized)return;
    const m=modules.find(x=>x.id===maximized),el=elements.get(maximized);if(m&&el){el.classList.remove('maximized');el.style.transform='';setRect(el,m);redraw(m,el);}maximized=null;scene.classList.remove('focusing');updateSelection();
  }
  function toggleMax(m,el) {
    if(maximized===m.id){exitMax();return;}
    exitMax();maximized=m.id;el.classList.add('maximized');scene.classList.add('focusing');
    const vw=(viewport.clientWidth-16)/scale,vh=(viewport.clientHeight-16)/scale;
    const width=m.type==='dom'?Math.min(580,vw*scale):Math.min(1200,vw*scale);
    Object.assign(el.style,{left:((vw-width/scale)/2+viewport.scrollLeft/scale)+'px',top:(viewport.scrollTop/scale)+'px',width:width+'px',height:(vh*scale)+'px',transform:`scale(${1/scale})`,transformOrigin:'top left'});redraw(m,el);
    notify('Розгорнутий модуль · Esc — повернутися');
  }
  function startDrag(e,m,el) {
    if(locked||maximized||e.button!==0||e.target.closest('button,select,input')||e.ctrlKey||e.metaKey)return;
    e.preventDefault();active=m.id;selected=new Set([m.id]);updateSelection();
    drag={id:m.id,x:e.clientX,y:e.clientY,target:null,side:null};
    el.classList.add('dragging');document.body.classList.add('selecting');el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove',moveDrag);el.addEventListener('pointerup',endDrag,{once:true});el.addEventListener('pointercancel',endDrag,{once:true});
  }
  function moveDrag(e) {
    if(!drag)return;
    if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return;
    const rect=scene.getBoundingClientRect(),x=(e.clientX-rect.left)/scale,y=(e.clientY-rect.top)/scale;
    const target=modules.find(m=>m.id!==drag.id&&x>=m.x&&x<m.x+m.w&&y>=m.y&&y<m.y+m.h);
    const preview=$('dock-preview');if(!target){drag.target=null;preview.hidden=true;return;}
    const rx=(x-target.x)/target.w,ry=(y-target.y)/target.h;
    const side=rx<.22?'left':rx>.78?'right':ry<.3?'top':ry>.7?'bottom':'swap';
    drag.target=target.id;drag.side=side;const box={...target};
    if(side==='left'||side==='right'){box.w/=2;if(side==='right')box.x+=box.w;}
    if(side==='top'||side==='bottom'){box.h/=2;if(side==='bottom')box.y+=box.h;}
    setRect(preview,box);preview.textContent={left:'Вставити ліворуч',right:'Вставити праворуч',top:'Вставити зверху',bottom:'Вставити знизу',swap:'Поміняти місцями'}[side];preview.hidden=false;
  }
  function endDrag(e) {
    const el=e.currentTarget;el.classList.remove('dragging');el.removeEventListener('pointermove',moveDrag);el.removeEventListener('pointerup',endDrag);el.removeEventListener('pointercancel',endDrag);
    if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
    document.body.classList.remove('selecting');$('dock-preview').hidden=true;
    if(drag&&drag.target!==null){remember();const source=drag.id,target=drag.target;
      if(drag.side==='swap'){walk(tree,n=>{if(!n.children){if(n.id===source)n.id=target;else if(n.id===target)n.id=source;}});}
      else {tree=removeLeaf(tree,source);const dest=findLeaf(target),before=['left','top'].includes(drag.side),axis=['left','right'].includes(drag.side)?'x':'y';tree=replaceNode(tree,dest,split(axis,before?[leaf(source),dest]:[dest,leaf(source)]));}
      drag=null;render();save();notify('Модуль пристиковано');
    }else drag=null;
  }
  function startSplit(e,node,index,lengths){if(locked||maximized||e.button!==0)return;e.preventDefault();remember();splitDrag={node,index,lengths:[...lengths],start:node.axis==='x'?e.clientX:e.clientY};document.body.classList.add('selecting');window.addEventListener('pointermove',moveSplit);window.addEventListener('pointerup',endSplit,{once:true});window.addEventListener('pointercancel',endSplit,{once:true});}
  function moveSplit(e){if(!splitDrag)return;const {node,index,lengths,start}=splitDrag,pos=node.axis==='x'?e.clientX:e.clientY,key=node.axis==='x'?'w':'h',delta=(pos-start)/scale,aMin=minSize(node.children[index])[key],bMin=minSize(node.children[index+1])[key],total=lengths[index]+lengths[index+1],a=Math.max(aMin,Math.min(total-bMin,lengths[index]+delta));node.weights=[...lengths];node.weights[index]=a;node.weights[index+1]=total-a;relayout();modules.forEach(m=>{const el=elements.get(m.id);setRect(el,m);redraw(m,el);});}
  function endSplit(){splitDrag=null;document.body.classList.remove('selecting');window.removeEventListener('pointermove',moveSplit);window.removeEventListener('pointerup',endSplit);window.removeEventListener('pointercancel',endSplit);fit();save();}
  function align(kind) {
    if(locked){notify('Спершу розблокуйте розкладку');return;}
    if(kind==='groups'){if(!tree||!tree.children||tree.axis!=='x'||tree.children.length<2){notify('Потрібні щонайменше дві групи поруч');return;}remember();tree.weights=tree.children.map(()=>1);}
    else if(kind==='charts'){
      const pairs=[];walk(tree,n=>{if(n.children&&n.axis==='y'&&n.children.length===2&&!n.children[0].children&&modules.find(m=>m.id===n.children[0].id)?.type==='chart')pairs.push(n);});
      if(pairs.length<2){notify('Потрібні щонайменше дві групи «графік над DOM»');return;}remember();pairs.forEach(n=>n.weights=[430,880]);
    }else{
      const list=modules.filter(m=>selected.has(m.id));if(list.length<2){notify('Виберіть суміжний блок: Ctrl + клік по заголовках');return;}
      let block=null;walk(tree,n=>{const ids=leaves(n);if(ids.length===list.length&&ids.every(id=>selected.has(id)))block=n;});
      if(!block){notify('Виберіть усі модулі одного суміжного блоку. Інші модулі залишаться на місці.');return;}
      remember();const ordered=leaves(block);tree=replaceNode(tree,block,split(kind==='horizontal'?'x':'y',ordered.map(leaf)));
    }
    exitMax();
    render();save();notify('Модулі вирівняно · дію можна скасувати');
  }
  function closeMenu(){for(const name of ['main','add','settings']){$(name+'-menu').hidden=true;$(name+'-open').setAttribute('aria-expanded','false');}}
  function toggleMenu(name){const willOpen=$(name+'-menu').hidden;closeMenu();$(name+'-menu').hidden=!willOpen;$(name+'-open').setAttribute('aria-expanded',String(willOpen));}
  $('main-open').onclick=()=>toggleMenu('main');
  $('settings-open').onclick=()=>toggleMenu('settings');
  document.addEventListener('click',e=>{if(!e.target.closest('.menu-anchor'))closeMenu();});
  function resetLayout(){if(locked){notify('Спершу розблокуйте розкладку');return false;}remember();exitMax();initial();selected.clear();active=null;render();save();notify('Застосовано шаблон 4 + 8 · попередній простір можна відновити');return true;}
  $('undo').onclick=()=>{if(!history.length)return;exitMax();const prev=JSON.parse(history.pop());modules=prev.modules;tree=prev.tree;serial=Math.max(serial,...modules.map(m=>m.id));selected.clear();active=null;$('undo').disabled=!history.length;render();save();closeMenu();};
  $('save-now').onclick=()=>{const saved=save();closeMenu();if(saved)notify('Робочий простір збережено локально');};
  function openAddMenu(){closeMenu();$('add-menu').hidden=false;$('add-open').setAttribute('aria-expanded','true');}
  const addAnchor=document.querySelector('.add-anchor');
  addAnchor.addEventListener('pointerenter',openAddMenu);
  addAnchor.addEventListener('pointerleave',closeMenu);
  addAnchor.addEventListener('focusin',openAddMenu);
  addAnchor.addEventListener('focusout',e=>{if(!addAnchor.contains(e.relatedTarget))closeMenu();});
  $('add-open').onclick=openAddMenu;
  function nextGroupLabel(){const used=new Set(modules.map(m=>m.group));for(let i=65;i<=90;i++){const label=String.fromCharCode(i);if(!used.has(label))return label;}let n=27;while(used.has(`G${n}`))n++;return `G${n}`;}
  function addModule(kind){
    if(locked){notify('Спершу розблокуйте розкладку');closeMenu();return;}
    remember();exitMax();
    if(kind==='group'){
      const group=nextGroupLabel(),chartId=++serial,futId=++serial,spotId=++serial;
      modules.push({id:chartId,type:'chart',symbol:null,market:'F',group,linkedGroup:true,x:0,y:0,w:633,h:350,timeframe:defaultChartFrame,chartCandleWidth:chartWidthDefault,chartPriceScale:1,offset:0});
      modules.push({id:futId,type:'dom',symbol:null,market:'F',group,linkedGroup:true,x:0,y:0,w:314.5,h:960,offset:0,clusterTimeframe:defaultClusterFrame});
      modules.push({id:spotId,type:'dom',symbol:null,market:'S',group,linkedGroup:true,x:0,y:0,w:314.5,h:960,offset:0,clusterTimeframe:defaultClusterFrame});
      const groupTree=split('y',[leaf(chartId),split('x',[leaf(futId),leaf(spotId)])],[430,880]);
      if(tree?.children&&tree.axis==='x'){tree.children.push(groupTree);tree.weights.push(tree.weights.at(-1)||1);}
      else tree=tree?split('x',[tree,groupTree]):groupTree;
      selected=new Set([chartId]);active=chartId;
    }else{
      const id=++serial,target=findLeaf(active)||findLeaf(modules.at(-1)?.id);
      modules.push({id,type:kind,symbol:null,market:'F',group:'—',x:0,y:0,w:kind==='chart'?633:314.5,h:kind==='chart'?350:760,offset:0,...(kind==='chart'?{timeframe:defaultChartFrame,chartCandleWidth:chartWidthDefault,chartPriceScale:1}:{clusterTimeframe:defaultClusterFrame})});
      tree=target?replaceNode(tree,target,split('x',[target,leaf(id)])):leaf(id);
      selected=new Set([id]);active=id;
    }
    render();save();closeMenu();
  }
  document.querySelectorAll('#add-menu [data-add]').forEach(button=>button.onclick=()=>addModule(button.dataset.add));
  function settingsState(){return {theme,zoom,locked,rowHeight,digitSize,defaultClusterFrame,defaultChartFrame,showChartVolume,tapeScale,selectionCount:selected.size,moduleCount:modules.length};}
  function openSettings(category){
    const existing=settingsWindows.get(category);
    if(existing&&!existing.closed){existing.focus();return;}
    const url=new URL('settings.html',location.href);url.searchParams.set('category',category);
    const popup=window.open(url.href,'scalpterm-settings-'+category,'popup=yes,width=760,height=640,resizable=yes,scrollbars=yes');
    if(!popup){notify('Браузер заблокував вікно налаштувань');return;}
    settingsWindows.set(category,popup);popup.focus();
  }
  document.querySelectorAll('[data-settings]').forEach(button=>button.onclick=()=>{const category=button.dataset.settings;closeMenu();openSettings(category);});
  function setSetting(key,value){
    if(key==='theme'&&['system','light','dark'].includes(value)){theme=value;applyTheme();}
    else if(key==='zoom'&&['fit','0.75','0.5'].includes(value)){exitMax();zoom=value;fit();}
    else if(key==='locked'&&typeof value==='boolean'){locked=value;applySettings();}
    else if(key==='rowHeight'&&[18,20,24].includes(value)){rowHeight=value;applySettings();modules.filter(m=>m.type==='dom').forEach(m=>redraw(m,elements.get(m.id)));}
    else if(key==='digitSize'&&[12,13,14].includes(value)){digitSize=value;applySettings();}
    else if(key==='defaultClusterFrame'&&Object.hasOwn(clusterFrames,value))defaultClusterFrame=value;
    else if(key==='defaultChartFrame'&&['1m','5m','15m'].includes(value))defaultChartFrame=value;
    else if(key==='showChartVolume'&&typeof value==='boolean'){showChartVolume=value;modules.filter(m=>m.type==='chart').forEach(m=>redraw(m,elements.get(m.id)));}
    else if(key==='tapeScale'&&[.75,1,1.25].includes(value)){tapeScale=value;modules.filter(m=>m.type==='dom').forEach(m=>redraw(m,elements.get(m.id)));}
    else return false;
    save();return true;
  }
  function handleSettingsRequest(request,respond){
    if(!request||request.type!=='scalpterm-settings-request')return;
    let ok=true,error='',data=null;
    try{
      if(request.action==='get')data=settingsState();
      else if(request.action==='set')ok=setSetting(request.key,request.value);
      else if(request.action==='align'){if(!['horizontal','vertical','groups','charts'].includes(request.value))ok=false;else align(request.value);}
      else if(request.action==='reset-layout')ok=resetLayout();
      else if(request.action==='apply-all-cluster'){if(!Object.hasOwn(clusterFrames,defaultClusterFrame))ok=false;else{modules.filter(m=>m.type==='dom').forEach(m=>m.clusterTimeframe=defaultClusterFrame);render();save();}}
      else if(request.action==='apply-all-chart'){modules.filter(m=>m.type==='chart').forEach(m=>m.timeframe=defaultChartFrame);render();save();}
      else if(request.action==='export'){save();data=JSON.stringify({exportVersion:1,...JSON.parse(localStorage.getItem(KEY))},null,2);}
      else if(request.action==='import'){
        const previous=localStorage.getItem(KEY);
        if(!request.value||typeof request.value!=='object'||Array.isArray(request.value))ok=false;
        else{
          localStorage.setItem(KEY,JSON.stringify(request.value));
          if(!restore()){if(previous===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,previous);ok=false;}
          else{exitMax();selected.clear();active=null;applySettings();render();save();}
        }
      }else ok=false;
    }catch(e){ok=false;error=e.message;}
    respond({type:'scalpterm-settings-result',clientId:request.clientId,requestId:request.requestId,ok,error:error||(!ok?'Дію не виконано. Перевірте дані або стан розкладки.':''),data,state:settingsState()});
  }
  settingsChannel.onmessage=event=>handleSettingsRequest(event.data,response=>settingsChannel.postMessage(response));
  window.addEventListener('message',event=>{
    if(![...settingsWindows.values()].includes(event.source))return;
    handleSettingsRequest(event.data,response=>event.source.postMessage(response,'*'));
  });
  scene.addEventListener('pointerdown',e=>{if(e.target===scene){selected.clear();active=null;updateSelection();}});
  scene.addEventListener('pointermove',e=>{
    const target=e.target.closest('[data-tip]');if(!target||drag){$('tooltip').hidden=true;return;}
    const tip=$('tooltip');tip.textContent=target.dataset.tip;tip.hidden=false;tip.style.left=Math.max(8,Math.min(e.clientX+14,window.innerWidth-tip.offsetWidth-10))+'px';tip.style.top=Math.max(8,Math.min(e.clientY+14,window.innerHeight-tip.offsetHeight-30))+'px';
  });scene.addEventListener('pointerleave',()=>$('tooltip').hidden=true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){exitMax();closeMenu();$('tooltip').hidden=true;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,select')){e.preventDefault();$('undo').click();}});
  const themeMedia=window.matchMedia('(prefers-color-scheme: dark)');
  themeMedia.addEventListener?.('change',()=>{if(theme==='system')applyTheme();});
  window.addEventListener('resize',()=>{exitMax();relayout();modules.forEach(m=>{const el=elements.get(m.id);if(el){setRect(el,m);redraw(m,el);}});fit();});
  if(!restore())initial();applySettings();render();
  window.setInterval(()=>{
    const activeStreams=new Set(modules.filter(m=>m.symbol&&m.market).map(m=>`${m.symbol}:${m.market}`));
    for(const key of activeStreams){const [symbol,market]=key.split(':');advanceMarketStream(getMarketStream(symbol,market));}
    for(const m of modules){const el=elements.get(m.id);if(el&&m.symbol&&m.market)redraw(m,el);}
  },650);
})();
