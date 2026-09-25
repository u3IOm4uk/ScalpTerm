'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const category = new URLSearchParams(location.search).get('category');
  let state = null, activeTab = 0, pendingImport = null, sequence = 0;
  const pending = new Map();
  const clientId=crypto.randomUUID();
  const channel=new BroadcastChannel('scalpterm-settings-v1');
  const option = (value,label) => `<option value="${value}">${label}</option>`;
  const select = (key,label,choices,help='') => `<label class="setting-field"><span>${label}</span><select data-setting="${key}">${choices.map(([value,text])=>option(value,text)).join('')}</select>${help?`<small>${help}</small>`:''}</label>`;
  const checkbox = (key,label,help='') => `<label class="setting-check"><input type="checkbox" data-setting="${key}"><span><strong>${label}</strong>${help?`<small>${help}</small>`:''}</span></label>`;
  const card = (title,body) => `<section class="settings-card"><h2>${title}</h2>${body}</section>`;
  const note = text => `<p class="setting-note">${text}</p>`;
  const button = (action,label,value='') => `<button type="button" data-action="${action}"${value?` data-value="${value}"`:''}>${label}</button>`;

  const sections = {
    view: {
      title:'Вигляд',description:'Оформлення робочого простору та розміщення модулів.',tabs:[
        {label:'Тема',render:()=>card('Тема інтерфейсу',select('theme','Тема',[['system','Як у системі'],['light','Світла'],['dark','Темна']],'Вибір відразу застосовується до термінала та цього вікна.'))},
        {label:'Розкладка',render:()=>card('Розташування модулів',
          `<div class="setting-actions">${button('align','Однакова ширина груп','groups')}${button('align','Однакова висота графіків','charts')}</div>`+
          `<p class="setting-note">Для вирівнювання вибраного блока спершу позначте його модулі в терміналі через Ctrl + клік.</p>`+
          `<div class="setting-actions">${button('align','Порівну поруч','horizontal')}${button('align','Порівну вертикально','vertical')}</div>`+
          checkbox('locked','Фіксувати розкладку','Забороняє перетягування, зміну розміру й додавання модулів.')+
          card('Шаблон і перенесення розкладки',
          `${button('reset-layout','Відновити шаблон 4 графіки + 8 DOM')}`+
          `<p class="setting-note">Шаблон замінить поточне розміщення; дію можна скасувати через «Основне» або Ctrl + Z.</p>`+
          `<div class="setting-actions">${button('export','Експортувати JSON')}<label class="file-button">Обрати JSON для імпорту<input id="import-file" type="file" accept=".json,application/json"></label></div>`+
          `<p id="import-preview" class="setting-note" hidden></p><button id="apply-import" type="button" data-action="import" disabled hidden>Застосувати імпорт</button>`))},
        {label:'Масштаб і щільність',render:()=>card('Робочий простір',select('zoom','Масштаб',[['fit','Вмістити все · 100%'],['0.75','75%'],['0.5','50%']],'Ширина й висота модулів підлаштовуються під вікно; масштаб зменшується лише вручну.'))+
          card('Цифри та рядки стакана',select('rowHeight','Висота цінового рядка',[[18,'Щільно · 18 px'],[20,'Стандартно · 20 px'],[24,'Вільніше · 24 px']])+select('digitSize','Розмір цифр',[[12,'12 px'],[13,'13 px'],[14,'14 px']],'У вузьких стаканах шрифт додатково адаптується до ширини.'))}
      ]
    },
    dom: {
      title:'Стакани',description:'Типові параметри DOM і подання умовних ринкових даних.',tabs:[
        {label:'Кластер',render:()=>card('Таймфрейм за замовчуванням',select('defaultClusterFrame','Для нових стаканів',[['1m','1 хвилина'],['5m','5 хвилин'],['15m','15 хвилин']],'Відкриті стакани зберігають власний вибір таймфрейму.')+button('apply-all-cluster','Застосувати до всіх відкритих стаканів'))+note('Кластер показує загальний виконаний обсяг на пройдених цінах поточної незавершеної свічки. Наведення відкриває Бід, Аск і Дельту.')},
        {label:'Рядки',render:()=>card('Щільність і цифри',select('rowHeight','Висота цінового рядка',[[18,'Щільно · 18 px'],[20,'Стандартно · 20 px'],[24,'Вільніше · 24 px']])+select('digitSize','Розмір цифр',[[12,'12 px'],[13,'13 px'],[14,'14 px']]))},
        {label:'Стрічка',render:()=>card('Квадрати угод',select('tapeScale','Розмір квадратів',[[.75,'Менші'],[1,'Звичайні'],[1.25,'Більші']],'Розмір усе одно обмежується фактичною шириною стрічки.'))+note('У прототипі стрічка містить демонстраційні угоди. Порядок колонок: кластер, стрічка, заявки, ціна.')}
      ]
    },
    chart: {
      title:'Графіки',description:'Типові параметри графіків і відображення свічок.',tabs:[
        {label:'Таймфрейм',render:()=>card('Для нових графіків',select('defaultChartFrame','Початковий таймфрейм',[['1m','1 хвилина'],['5m','5 хвилин'],['15m','15 хвилин']],'Відкриті графіки зберігають власний таймфрейм.')+button('apply-all-chart','Застосувати до всіх відкритих графіків'))},
        {label:'Обсяги',render:()=>card('Подання свічок',checkbox('showChartVolume','Показувати стовпчики обсягу','Вмикає або приховує демонстраційні обсяги внизу кожного графіка.'))},
        {label:'Синхронізація',render:()=>card('Інструмент групи',note('У новій групі графік і два стакани використовують один інструмент. Його вибір у будь-якому модулі групи оновлює інші два.')+note('Таймфрейми графіка та кожного стакана залишаються незалежними.'))}
      ]
    },
    hotkeys: {
      title:'Гарячі клавіші',description:'Команди, які зараз працюють у прототипі.',tabs:[
        {label:'Основне',render:()=>card('Робочий простір',`<dl class="shortcut-list"><div><dt>Скасувати зміну компонування</dt><dd><kbd>Ctrl</kbd> + <kbd>Z</kbd></dd></div><div><dt>Закрити меню або відновити розгорнутий модуль</dt><dd><kbd>Esc</kbd></dd></div></dl>`)},
        {label:'Модулі',render:()=>card('Вибір і розміщення',`<dl class="shortcut-list"><div><dt>Додати модуль до вибору</dt><dd><kbd>Ctrl</kbd> + клік</dd></div><div><dt>Перемістити модуль</dt><dd>Перетягнути заголовок</dd></div><div><dt>Змінити розмір</dt><dd>Перетягнути спільну межу</dd></div><div><dt>Прокрутити стакан</dt><dd>Коліщатко миші над DOM</dd></div></dl>`)+note('Зміна призначення клавіш стане окремою функцією десктопного застосунку; прототип показує лише реалізовані команди.')}
      ]
    }
  };

  const section=sections[category]||sections.view;
  document.title=`${section.title} · ScalpTerm`;
  $('window-title').textContent=section.title;
  $('window-description').textContent=section.description;
  function feedback(message,isError=false){$('settings-feedback').textContent=message;$('settings-feedback').classList.toggle('error',isError);}
  function setTheme(){if(!state)return;document.documentElement.dataset.theme=state.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):state.theme;}
  function request(action,extra={}){
    const requestId=++sequence;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('Немає відповіді від головного вікна.'));},8000);
      pending.set(requestId,{resolve,reject,timeout});
      const message={type:'scalpterm-settings-request',clientId,requestId,action,...extra};
      if(location.protocol==='file:'&&window.opener&&!window.opener.closed)window.opener.postMessage(message,'*');
      else channel.postMessage(message);
    });
  }
  function handleResponse(event){
    if(event.data?.type!=='scalpterm-settings-result'||event.data.clientId!==clientId)return;
    const item=pending.get(event.data.requestId);if(!item)return;
    clearTimeout(item.timeout);pending.delete(event.data.requestId);
    if(event.data.ok){state=event.data.state;setTheme();syncControls();item.resolve(event.data.data);}
    else item.reject(new Error(event.data.error||'Дію не виконано.'));
  }
  channel.onmessage=handleResponse;
  window.addEventListener('message',event=>{if(event.source===window.opener)handleResponse(event);});
  function syncControls(){if(!state)return;document.querySelectorAll('[data-setting]').forEach(control=>{const value=state[control.dataset.setting];if(control.type==='checkbox')control.checked=!!value;else control.value=String(value);});}
  function showTab(index){
    activeTab=index;
    $('settings-tabs').innerHTML=section.tabs.map((tab,i)=>`<button type="button" role="tab" id="tab-${i}" aria-controls="settings-panel" aria-selected="${i===index}" tabindex="${i===index?0:-1}" data-tab="${i}">${tab.label}</button>`).join('');
    $('settings-content').innerHTML=`<div id="settings-panel" role="tabpanel" aria-labelledby="tab-${index}">${section.tabs[index].render()}</div>`;
    syncControls();
  }
  $('settings-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-tab]');if(tab)showTab(Number(tab.dataset.tab));});
  $('settings-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();showTab((activeTab+(event.key==='ArrowRight'?1:-1)+section.tabs.length)%section.tabs.length);$('settings-tabs').querySelector('[aria-selected="true"]').focus();});
  $('settings-content').addEventListener('change',async event=>{
    const control=event.target;
    if(control.id==='import-file'){
      pendingImport=null;const file=control.files?.[0],preview=$('import-preview'),apply=$('apply-import');
      if(!file)return;
      try{const candidate=JSON.parse(await file.text());if(!candidate||!Array.isArray(candidate.modules)||!candidate.tree)throw new Error('У файлі немає розкладки ScalpTerm.');pendingImport=candidate;preview.textContent=`${file.name} · модулів: ${candidate.modules.length}. Натисніть «Застосувати імпорт», щоб замінити поточну розкладку.`;preview.hidden=false;apply.hidden=false;apply.disabled=false;feedback('Файл перевірено. Імпорт ще не застосовано.');}
      catch(error){preview.textContent=error.message;preview.hidden=false;apply.hidden=true;feedback('Не вдалося прочитати файл.',true);}
      return;
    }
    if(!control.matches('[data-setting]'))return;
    let value=control.type==='checkbox'?control.checked:control.value;
    if(['rowHeight','digitSize','tapeScale'].includes(control.dataset.setting))value=Number(value);
    try{await request('set',{key:control.dataset.setting,value});feedback('Зміни застосовано й збережено.');}
    catch(error){feedback(error.message,true);syncControls();}
  });
  $('settings-content').addEventListener('click',async event=>{
    const target=event.target.closest('[data-action]');if(!target)return;
    const action=target.dataset.action;
    try{
      if(action==='export'){
        const json=await request('export');const link=document.createElement('a');const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));link.href=url;link.download='scalpterm-layout.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('Розкладку експортовано.');return;
      }
      if(action==='import'){
        if(!pendingImport)throw new Error('Спершу виберіть файл JSON.');
        await request('import',{value:pendingImport});pendingImport=null;$('import-preview').hidden=true;$('apply-import').hidden=true;feedback('Розкладку імпортовано й відкрито в головному вікні.');return;
      }
      await request(action,action==='align'?{value:target.dataset.value}:{});
      feedback(action==='reset-layout'?'Стандартну розкладку відновлено.':'Зміни застосовано.');
    }catch(error){feedback(error.message,true);}
  });
  $('close-window').onclick=()=>window.close();
  window.addEventListener('focus',()=>{if(state)request('get').catch(error=>feedback(error.message,true));});
  showTab(0);
  request('get').then(()=>feedback('Зміни застосовуються до відкритого ScalpTerm.')).catch(error=>feedback(error.message,true));
})();
