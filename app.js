'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const scene = $('scene'), viewport = $('viewport');
  const KEY = 'scalpterm-design-01-docked-v2';
  const W = 2544, H = 1314;
  const instruments = {
    BTCUSDT: {price:64120,step:1,digits:0,range:185},
    ETHUSDT: {price:2640.20,step:.05,digits:2,range:12},
    SOLUSDT: {price:148.25,step:.01,digits:2,range:1.7},
    XRPUSDT: {price:.5868,step:.0001,digits:4,range:.009}
  };
  let modules = [], serial = 0, scale = 1, selected = new Set(), active = null;
  let locked = false, rowHeight = 20, digitSize = 13, noMotion = false;
  let zoom = 'fit', theme = 'system', history = [], drag = null, maximized = null, toastTimer;
  let tree = null, splitSerial = 0, splitDrag = null, canvasW = W, canvasH = H;
  const elements = new Map();
  const fmt = (v, d) => v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:false});
  const short = v => v >= 1000000 ? (v/1000000).toFixed(1)+'m' : v >= 1000 ? (v/1000).toFixed(v>=10000?0:1)+'k' : String(Math.round(v));
  function random(seed) { return () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; }; }
  const seedOf = text => [...text].reduce((v,c)=>v*31+c.charCodeAt(0),7) >>> 0;
  function notify(message) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
  function snapshot() { return JSON.stringify({modules,tree}); }
  function remember() { history.push(snapshot()); if(history.length>30) history.shift(); $('undo').disabled=false; }
  function save() {
      try {localStorage.setItem(KEY,JSON.stringify({modules,tree,locked,rowHeight,digitSize,noMotion,zoom,theme})); $('save-state').textContent='Розкладку збережено локально';}
      catch { $('save-state').textContent='Збереження недоступне'; }
  }
  function initial() {
    serial=0; modules=[];
    Object.keys(instruments).forEach((symbol,i)=>{
      const group=String.fromCharCode(65+i), x=i*637;
      modules.push({id:++serial,type:'chart',symbol,market:'F',group,x,y:0,w:633,h:350,timeframe:'1m',offset:0});
      modules.push({id:++serial,type:'dom',symbol,market:'F',group,x,y:354,w:314.5,h:960,offset:0});
      modules.push({id:++serial,type:'dom',symbol,market:'S',group,x:x+318.5,y:354,w:314.5,h:960,offset:0});
    });
    tree=split('x',Array.from({length:4},(_,i)=>split('y',[leaf(i*3+1),split('x',[leaf(i*3+2),leaf(i*3+3)])],[350,960])));
  }
  function leaf(id){return {id};}
  function split(axis,children,weights){return {splitId:++splitSerial,axis,children,weights:weights||children.map(()=>1)};}
  function leaves(n){return !n?[]:n.children?n.children.flatMap(leaves):[n.id];}
  function walk(n,fn){if(!n)return;fn(n);if(n.children)n.children.forEach(c=>walk(c,fn));}
  function removeLeaf(n,id){if(!n)return null;if(!n.children)return n.id===id?null:n;const children=[],weights=[];n.children.forEach((c,i)=>{const child=removeLeaf(c,id);if(child){children.push(child);weights.push(n.weights[i]);}});if(!children.length)return null;if(children.length===1)return children[0];return {...n,children,weights};}
  function replaceNode(n,target,replacement){if(n===target)return replacement;if(n.children)n.children=n.children.map(c=>replaceNode(c,target,replacement));return n;}
  function findLeaf(id){let result=null;walk(tree,n=>{if(!n.children&&n.id===id)result=n;});return result;}
  function minSize(n){if(!n)return {w:220,h:150};if(!n.children)return {w:220,h:150};const sizes=n.children.map(minSize);return n.axis==='x'?{w:sizes.reduce((s,m)=>s+m.w,0)+(sizes.length-1)*4,h:Math.max(...sizes.map(m=>m.h))}:{w:Math.max(...sizes.map(m=>m.w)),h:sizes.reduce((s,m)=>s+m.h,0)+(sizes.length-1)*4};}
  function allocate(total,weights,mins){const out=weights.map(()=>0),pending=new Set(weights.map((_,i)=>i));let rest=total;while(pending.size){const sum=[...pending].reduce((s,i)=>s+weights[i],0);let fixed=false;for(const i of [...pending]){const v=rest*weights[i]/sum;if(v<mins[i]){out[i]=mins[i];rest-=mins[i];pending.delete(i);fixed=true;break;}}if(!fixed){const sum2=[...pending].reduce((s,i)=>s+weights[i],0);pending.forEach(i=>out[i]=rest*weights[i]/sum2);break;}}return out;}
  function layout(n,x,y,w,h){if(!n)return;if(!n.children){const m=modules.find(m=>m.id===n.id);if(m)Object.assign(m,{x,y,w,h});return;}const horizontal=n.axis==='x',available=(horizontal?w:h)-(n.children.length-1)*4,mins=n.children.map(c=>minSize(c)[horizontal?'w':'h']);const lengths=allocate(available,n.weights,mins);let cursor=horizontal?x:y;n.children.forEach((child,i)=>{layout(child,horizontal?cursor:x,horizontal?y:cursor,horizontal?lengths[i]:w,horizontal?h:lengths[i]);cursor+=lengths[i];if(i<n.children.length-1){const bar=document.createElement('div');bar.className='splitter '+(horizontal?'split-x':'split-y');bar.dataset.split=n.splitId;bar.dataset.boundary=i;Object.assign(bar.style,{left:(horizontal?cursor:x)+'px',top:(horizontal?y:cursor)+'px',width:(horizontal?4:w)+'px',height:(horizontal?h:4)+'px'});bar.addEventListener('pointerdown',e=>startSplit(e,n,i,lengths));scene.append(bar);cursor+=4;}});}
  function relayout(){scene.querySelectorAll('.splitter').forEach(e=>e.remove());const min=minSize(tree);canvasW=Math.max(W,min.w);canvasH=Math.max(H,min.h);layout(tree,0,0,canvasW,canvasH);}
  function restore() {
    try {
      const s=JSON.parse(localStorage.getItem(KEY));
      if(!s || !Array.isArray(s.modules) || !s.modules.length) return false;
      const ids=new Set();
      if(!s.modules.every(m=>{
        if(!m || !Number.isInteger(m.id) || ids.has(m.id)) return false;
        ids.add(m.id);
        return ['chart','dom'].includes(m.type) && Object.hasOwn(instruments,m.symbol) && ['F','S'].includes(m.market) && ['x','y','w','h'].every(k=>Number.isFinite(m[k])) && m.x>=0 && m.y>=0 && m.w>=220 && m.h>=150 && Number.isFinite(m.offset) && /^[A-D—]$/.test(m.group) && (m.type!=='chart'||['1m','5m','15m'].includes(m.timeframe));
      })) return false;
      let validTree=true;const treeIds=[],splitIds=new Set();
      function validate(n,depth=0){if(!n||depth>200){validTree=false;return;}if(n.children){if(!['x','y'].includes(n.axis)||!Array.isArray(n.children)||n.children.length<2||!Array.isArray(n.weights)||n.weights.length!==n.children.length||!n.weights.every(v=>Number.isFinite(v)&&v>0)||!Number.isInteger(n.splitId)||splitIds.has(n.splitId)){validTree=false;return;}splitIds.add(n.splitId);n.children.forEach(c=>validate(c,depth+1));}else treeIds.push(n.id);}
      validate(s.tree);if(!validTree||treeIds.length!==ids.size||new Set(treeIds).size!==ids.size||!treeIds.every(id=>ids.has(id)))return false;
      modules=s.modules;tree=s.tree;splitSerial=Math.max(0,...splitIds);serial=Math.max(...modules.map(m=>m.id)); locked=!!s.locked;
      rowHeight=[18,20,24].includes(s.rowHeight)?s.rowHeight:20; digitSize=[12,13,14].includes(s.digitSize)?s.digitSize:13;
      noMotion=!!s.noMotion; zoom=['fit','1','0.75','0.5'].includes(s.zoom)?s.zoom:'fit'; theme=['system','light','dark'].includes(s.theme)?s.theme:'system'; return true;
    } catch { return false; }
  }
  function cssToken(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function resolvedTheme() { return theme==='system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : theme; }
  function applyTheme(redraw=true) {
    document.documentElement.dataset.theme=resolvedTheme();
    document.documentElement.style.colorScheme=resolvedTheme();
    if($('theme')) $('theme').value=theme;
    if(redraw) modules.forEach(m=>{const el=elements.get(m.id);if(el)redrawModule(m,el);});
  }
  function applySettings() {
    document.documentElement.style.setProperty('--row',rowHeight+'px');
    document.documentElement.style.setProperty('--digits',digitSize+'px');
    document.body.classList.toggle('locked',locked); document.body.classList.toggle('no-motion',noMotion);
    $('density').value=String(rowHeight); $('font-size').value=String(digitSize); $('reduced-motion').checked=noMotion; $('zoom').value=zoom; applyTheme(false);
    $('lock').setAttribute('aria-pressed',String(locked)); $('lock').textContent=locked?'Розкладку зафіксовано':'Фіксувати розкладку';
  }
  function fit() {
    const cw=canvasW, ch=canvasH;
    scene.style.width=cw+'px'; scene.style.height=ch+'px';
    scale=zoom==='fit'?Math.min((viewport.clientWidth-16)/cw,(viewport.clientHeight-16)/ch,1):Number(zoom);
    scene.style.transform=`scale(${scale})`;
    // A containing sizing element avoids scrollbars from the unscaled layout box.
    scene.style.position='absolute'; scene.style.left='8px'; scene.style.top='8px';
    let spacer=$('scene-spacer'); if(!spacer){spacer=document.createElement('div');spacer.id='scene-spacer';spacer.setAttribute('aria-hidden','true');viewport.append(spacer);}
    spacer.style.width=cw*scale+'px';spacer.style.height=ch*scale+'px';spacer.style.pointerEvents='none';
    $('scale-label').textContent=Math.round(scale*100)+'%';
  }
  function setRect(el,m) { Object.assign(el.style,{left:m.x+'px',top:m.y+'px',width:m.w+'px',height:m.h+'px'}); }
  function updateSelection() {
    elements.forEach((el,id)=>{el.classList.toggle('selected',selected.has(id));el.classList.toggle('active',id===active); if(!el.classList.contains('maximized'))el.style.zIndex=id===active?'20':'1';});
    $('selection-note').textContent=selected.size>1?`Вибрано модулів: ${selected.size}`:'Ctrl + клік — вибрати кілька модулів';
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
      const el=document.createElement('section');el.className='module';el.dataset.id=m.id;el.setAttribute('aria-label',`${m.type==='chart'?'Графік':'Стакан'} ${m.symbol} ${m.market==='F'?'ф’ючерс':'спот'}`);
      setRect(el,m);
      el.innerHTML=`<div class="module-header"><span class="group-tag">${m.group}</span><span class="module-symbol">${m.symbol}</span><span class="market-tag ${m.market==='S'?'spot':''}">${m.market==='F'?'FUT':'SPOT'}</span><span class="module-actions"><button data-action="maximize" aria-label="Розгорнути модуль" title="Розгорнути / відновити">⛶</button><button data-action="close" aria-label="Закрити модуль" title="Закрити модуль">×</button></span></div><div class="module-content"></div><div class="module-footer"></div>`;
      scene.append(el);elements.set(m.id,el);
      const body=el.querySelector('.module-content'), footer=el.querySelector('.module-footer');
      if(m.type==='chart') {
        body.innerHTML=`<div class="chart-tools"><button data-time="1m">1хв</button><button data-time="5m">5хв</button><button data-time="15m">15хв</button><span class="exchange">BINANCE</span><select aria-label="Ринок графіка"><option value="F">Ф’ючерс</option><option value="S">Спот</option></select></div><canvas class="chart-canvas" role="img" aria-label="Демонстраційний свічковий графік ${m.symbol}"></canvas>`;
        body.querySelector('select').value=m.market;
        body.querySelector('select').onchange=e=>{m.market=e.target.value;el.querySelector('.market-tag').textContent=m.market==='F'?'FUT':'SPOT';el.querySelector('.market-tag').classList.toggle('spot',m.market==='S');el.setAttribute('aria-label',`Графік ${m.symbol} ${m.market==='F'?'ф’ючерс':'спот'}`);drawChart(m,el);save();};
        body.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{m.timeframe=b.dataset.time;drawChart(m,el);save();});
        footer.innerHTML='<span>Умовна історія</span><span class="right">Статичний макет</span>';
        drawChart(m,el);
      } else {
        body.innerHTML=`<div class="dom-meta"><span>BINANCE <strong>· USDT</strong></span><span class="cluster-key">Bid × Ask</span><span class="readonly">${m.market==='S'?'Спостереження':'Демо'}</span></div><div class="dom-grid" aria-label="Кластер Bid × Ask, лента пройденого обсягу, обсяг заявок, ціна"></div>`;
        footer.innerHTML=`<button class="dom-footer-button" data-action="center" title="Повернути до найкращих цін">◎ До ринку</button><span class="right">Крок ${fmt(instruments[m.symbol].step,instruments[m.symbol].digits)}</span>`;
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
    $('module-count').textContent=`${modules.filter(m=>m.type==='chart').length} графіки · ${modules.filter(m=>m.type==='dom').length} DOM`;
    updateSelection();fit();
  }
  function drawChart(m,el) {
    const canvas=el.querySelector('canvas'); if(!canvas)return;
    const w=canvas.clientWidth,h=canvas.clientHeight; if(!w||!h)return;
    const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    const c=canvas.getContext('2d');c.scale(dpr,dpr);c.fillStyle=cssToken('--chart-bg');c.fillRect(0,0,w,h);
    el.querySelectorAll('[data-time]').forEach(b=>b.classList.toggle('on',b.dataset.time===m.timeframe));
    const info=instruments[m.symbol],rng=random(seedOf(m.symbol+m.market+m.timeframe));
    const pw=w-69,ph=h-32,n=Math.max(24,Math.floor(pw/7)),base=info.price*(m.market==='F'?1:.9994),range=info.range;
    c.strokeStyle=cssToken('--chart-grid');c.lineWidth=1;c.font='10px "Segoe UI",sans-serif';
    for(let i=0;i<5;i++){const y=18+i*(ph-32)/4;c.beginPath();c.moveTo(0,y+.5);c.lineTo(pw,y+.5);c.stroke();c.fillStyle=cssToken('--chart-axis');c.fillText(fmt(base+range*(.5-i/4),info.digits),pw+7,y+3);}
    for(let i=0;i<5;i++){const x=14+i*(pw-28)/4;c.strokeStyle=cssToken('--chart-grid-subtle');c.beginPath();c.moveTo(x,0);c.lineTo(x,ph);c.stroke();c.fillStyle=cssToken('--chart-axis-muted');c.fillText(['14:00','14:15','14:30','14:45','15:00'][i],Math.max(3,x-13),h-10);}
    let prev=.58;const candles=[];
    for(let i=0;i<n;i++){let close=Math.max(.13,Math.min(.86,prev+(rng()-.49)*.12 + Math.sin(i*.25)*.01));const open=prev;const high=Math.max(open,close)+rng()*.055,low=Math.min(open,close)-rng()*.05; candles.push({open,close,high,low,volume:rng()});prev=close;}
    const xStep=(pw-14)/n, y=v=>18+(1-v)*(ph-36);
    candles.forEach((v,i)=>{const x=8+i*xStep,up=v.close>=v.open,col=up?cssToken('--buy'):cssToken('--sell');c.strokeStyle=col;c.beginPath();c.moveTo(x+.5,y(v.high));c.lineTo(x+.5,y(v.low));c.stroke();c.fillStyle=col;c.fillRect(x-xStep*.3,Math.min(y(v.open),y(v.close)),Math.max(2,xStep*.6),Math.max(1,Math.abs(y(v.open)-y(v.close))));c.globalAlpha=.2;c.fillRect(x-xStep*.3,ph-v.volume*24,xStep*.6,v.volume*24);c.globalAlpha=1;});
    const lastY=y(candles.at(-1).close);c.setLineDash([3,4]);c.strokeStyle=cssToken('--chart-last-line');c.beginPath();c.moveTo(0,lastY);c.lineTo(pw,lastY);c.stroke();c.setLineDash([]);c.fillStyle=cssToken('--chart-last-bg');c.fillRect(pw,lastY-9,69,18);c.fillStyle=cssToken('--chart-last-text');c.font='11px "Segoe UI",sans-serif';c.fillText(fmt(base+(candles.at(-1).close-.5)*range,info.digits),pw+5,lastY+4);
    c.fillStyle=cssToken('--chart-axis-muted');c.font='10px "Segoe UI",sans-serif';c.fillText('ДЕМО',10,14);
  }
  function drawDom(m,el) {
    const grid=el.querySelector('.dom-grid');if(!grid)return;
    const info=instruments[m.symbol],rows=Math.ceil(grid.clientHeight/rowHeight),middle=Math.floor(rows*.45),rng=random(seedOf(m.symbol+m.market)),base=Math.round((info.price*(m.market==='F'?1:.9994))/info.step)*info.step;
    let html='';
    for(let i=0;i<rows;i++) {
      const level=middle-i+m.offset,price=base+level*info.step,ask=level>=1,best=level===1?'best-ask':level===0?'best-bid':'',vol=500+rng()*35000*(rng()<.13?5:1);
      const width=Math.min(100,vol/115000*100),heavy=vol>95000;
      const clusterRng=random(seedOf(m.symbol+m.market+'cluster'+level));
      const bidCluster=80+clusterRng()*9000*(clusterRng()<.12?4:1);
      const askCluster=80+clusterRng()*9000*(clusterRng()<.12?4:1);
      const tradedVolume=bidCluster+askCluster;
      const bidImbalance=bidCluster>askCluster*3&&bidCluster>1500;
      const askImbalance=askCluster>bidCluster*3&&askCluster>1500;
      const clusterClass=bidImbalance?' imbalance-bid':askImbalance?' imbalance-ask':'';
      const delta=askCluster-bidCluster,deltaText=(delta>=0?'+':'')+fmt(delta,0);
      html+=`<div class="dom-row ${ask?'ask':'bid'} ${best}"><div class="cluster${clusterClass}" data-tip="Кластер Bid × Ask · ${fmt(price,info.digits)}\nBid: ${fmt(bidCluster,0)} USDT\nAsk: ${fmt(askCluster,0)} USDT\nDelta: ${deltaText} USDT"><span class="cluster-bid">${short(bidCluster)}</span><span class="cluster-x">×</span><span class="cluster-ask">${short(askCluster)}</span></div><div class="tape-volume" data-tip="Пройдений обсяг · ${fmt(price,info.digits)}\nУсього: ${fmt(tradedVolume,0)} USDT">${short(tradedVolume)}</div><div class="depth ${heavy?'heavy':''}" data-tip="${ask?'Ask':'Bid'} · ${fmt(price,info.digits)}\nОбсяг заявок: ${fmt(vol,0)} USDT\nДемонстраційні дані"><span class="depth-bar" style="width:${width}%"></span><span class="depth-amount">${short(vol)}</span></div><div class="price ${Math.round(price/info.step)%5===0?'major':''}" ${best?`data-tip="${best==='best-ask'?'Best ask':'Best bid'} · ${fmt(price,info.digits)}"`:''}>${fmt(price,info.digits)}</div></div>`;
    }
    grid.innerHTML=html;
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
    if(kind==='groups'){if(!tree||!tree.children||tree.axis!=='x'||tree.children.length!==4){notify('Команда доступна для чотирьох груп у ряд');return;}remember();tree.weights=[1,1,1,1];}
    else if(kind==='charts'){
      const pairs=[];walk(tree,n=>{if(n.children&&n.axis==='y'&&n.children.length===2&&!n.children[0].children&&modules.find(m=>m.id===n.children[0].id)?.type==='chart')pairs.push(n);});
      if(pairs.length<2){notify('Потрібні щонайменше дві групи «графік над DOM»');return;}remember();pairs.forEach(n=>n.weights=[350,960]);
    }else{
      const list=modules.filter(m=>selected.has(m.id));if(list.length<2){notify('Виберіть суміжний блок: Ctrl + клік по заголовках');return;}
      let block=null;walk(tree,n=>{const ids=leaves(n);if(ids.length===list.length&&ids.every(id=>selected.has(id)))block=n;});
      if(!block){notify('Виберіть усі модулі одного суміжного блоку. Інші модулі залишаться на місці.');return;}
      remember();const ordered=leaves(block);tree=replaceNode(tree,block,split(kind==='horizontal'?'x':'y',ordered.map(leaf)));
    }
    exitMax();
    render();save();notify('Модулі вирівняно · дію можна скасувати');
  }
  function closeMenu(){$('align-menu').hidden=true;$('align-open').setAttribute('aria-expanded','false');}
  $('align-open').onclick=()=>{const visible=$('align-menu').hidden;$('align-menu').hidden=!visible;$('align-open').setAttribute('aria-expanded',String(visible));};
  document.querySelectorAll('[data-align]').forEach(b=>b.onclick=()=>{align(b.dataset.align);closeMenu();});
  document.addEventListener('click',e=>{if(!e.target.closest('.menu-anchor'))closeMenu();});
  $('layout-four').onclick=()=>{if(locked){notify('Спершу розблокуйте розкладку');return;}remember();exitMax();initial();selected.clear();active=null;render();save();closeMenu();notify('Застосовано шаблон 4 + 8 · попередній простір можна відновити');};
  $('undo').onclick=()=>{if(!history.length)return;exitMax();const prev=JSON.parse(history.pop());modules=prev.modules;tree=prev.tree;serial=Math.max(serial,...modules.map(m=>m.id));selected.clear();active=null;$('undo').disabled=!history.length;render();save();};
  $('lock').onclick=()=>{locked=!locked;applySettings();save();};
  $('add-open').onclick=()=>{if(locked){notify('Спершу розблокуйте розкладку');return;}$('add-dialog').showModal();};
  $('settings-open').onclick=()=>$('settings-dialog').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('add-form').onsubmit=e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);remember();exitMax();
    const type=f.get('type'),symbol=f.get('symbol'),group=String.fromCharCode(65+Object.keys(instruments).indexOf(symbol)),id=++serial;
    const target=findLeaf(active)||findLeaf(modules.at(-1)?.id);
    modules.push({id,type,symbol,market:f.get('market'),group,x:0,y:0,w:type==='chart'?633:314.5,h:type==='chart'?350:760,timeframe:'1m',offset:0});
    tree=target?replaceNode(tree,target,split('x',[target,leaf(id)])):leaf(id);
    selected=new Set([id]);active=id;render();save();$('add-dialog').close();
  };
  $('zoom').onchange=e=>{exitMax();zoom=e.target.value;fit();save();};
  $('theme').onchange=e=>{theme=e.target.value;applyTheme();save();};
  $('density').onchange=e=>{rowHeight=Number(e.target.value);applySettings();modules.forEach(m=>redraw(m,elements.get(m.id)));save();};
  $('font-size').onchange=e=>{digitSize=Number(e.target.value);applySettings();save();};
  $('reduced-motion').onchange=e=>{noMotion=e.target.checked;applySettings();save();};
  scene.addEventListener('pointerdown',e=>{if(e.target===scene){selected.clear();active=null;updateSelection();}});
  scene.addEventListener('pointermove',e=>{
    const target=e.target.closest('[data-tip]');if(!target||drag){$('tooltip').hidden=true;return;}
    const tip=$('tooltip');tip.textContent=target.dataset.tip;tip.hidden=false;tip.style.left=Math.max(8,Math.min(e.clientX+14,window.innerWidth-tip.offsetWidth-10))+'px';tip.style.top=Math.max(8,Math.min(e.clientY+14,window.innerHeight-tip.offsetHeight-30))+'px';
  });scene.addEventListener('pointerleave',()=>$('tooltip').hidden=true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){exitMax();closeMenu();$('tooltip').hidden=true;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,select')){e.preventDefault();$('undo').click();}});
  const themeMedia=window.matchMedia('(prefers-color-scheme: dark)');
  themeMedia.addEventListener?.('change',()=>{if(theme==='system')applyTheme();});
  window.addEventListener('resize',()=>{exitMax();fit();});
  if(!restore())initial();applySettings();render();
})();
