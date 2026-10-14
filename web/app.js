(() => {
  'use strict';

  const STORAGE_KEY = 'instrumentalab.flow-diagram.v2';
  const THEME_KEY = 'instrumentalab.theme';
  const canvas = document.querySelector('#canvas');
  const svg = document.querySelector('#connections');
  const viewport = document.querySelector('#viewport');
  const inspector = document.querySelector('#inspector');
  const toastEl = document.querySelector('#toast');
  const kinds = {
    process: {label:'Tanque / tubería', icon:'▤', subtitle:'Objeto físico'},
    variable: {label:'Lectura de variable', icon:'PV', subtitle:'Variable instrumentada'},
    instrument: {label:'Sensor / transmisor', icon:'◉', subtitle:'Instrumentación de campo'},
    controller: {label:'Controlador', icon:'⌁', subtitle:'Sistema de control'},
    final: {label:'Elemento final', icon:'⌖', subtitle:'Elemento final de control'}
  };
  const mediumLabels = {electrical:'eléctrica', hydraulic:'hidráulica', pneumatic:'neumática', mechanical:'mecánica', wireless:'inalámbrica'};
  const unitOptions = {
    pressure:['kPa','Pa','bar','psi'], temperature:['°C','°F','K'], flow:['m³/h','L/min','m³/s'],
    level:['%','m','cm'], current:['mA','A'], percent:['%']
  };
  const {baseMagnitude,convertResult,ValveActuator,VariableTrend,
    CurrentController,ProcessAction,ProcessVariableSource,compatibleMeasurement,SwitchHysteresis} = globalThis.InstrumentaSimulation;
  const defaultState = () => {
    const nodes = [
      {id:'pipe-demo',kind:'process',subtype:'Línea de proceso',tag:'PL-101',name:'Línea de proceso',x:95,y:250,
        simulationMode:'variables',pressureUnit:'kPa',startPressure:100,pressure:100,targetPressure:500,
        riseSeconds:10,reliefPressure:120,reliefSeconds:5,fixed:false,capacity:10,fill:0,inflow:0,outflow:0,
        variables:[
          {id:'pipe-pressure-demo',tag:'P-101',type:'pressure',unit:'kPa',source:'manual',trendMode:'rise',value:100,startValue:100,targetValue:500,durationSeconds:10},
          {id:'pipe-temperature-demo',tag:'T-101',type:'temperature',unit:'°C',source:'manual',trendMode:'static',value:28,startValue:28,targetValue:28,durationSeconds:10}
        ]},
      {id:'pv-demo',kind:'variable',tag:'PV-101',name:'Presión de línea',x:460,y:72,variableType:'pressure',processId:'pipe-demo',processVariableId:'pipe-pressure-demo',fixed:false,value:100,unit:'kPa'},
      {id:'pt-demo',kind:'instrument',tag:'PT-101',name:'Transmisor de presión',x:850,y:100,instrumentType:'sensor_transmitter',measurement:'pressure',integrated:true,fixed:false,value:4,unit:'mA',calibrationInputLow:0,calibrationInputHigh:500,calibrationInputUnit:'kPa',calibrationOutputLow:4,calibrationOutputHigh:20},
      {id:'pic-demo',kind:'controller',tag:'PIC-101',name:'Controlador 4–20 mA',x:850,y:490,fixed:false,value:4,unit:'mA',controlMode:'on_off',onCurrent:15.2,offCurrent:9.76,activeOutput:20,inactiveOutput:4,active:false,inputLow:4,inputHigh:20,outputLow:4,outputHigh:20},
      {id:'pcv-demo',kind:'final',tag:'PCV-101',name:'Válvula de descarga',x:460,y:535,fixed:false,value:0,unit:'%',processRole:'outlet',processActions:[{id:'action-demo',processId:'pipe-demo',variableId:'pipe-pressure-demo',when:'open',effect:'decrease',rate:116}]}
    ];
    const edges = [
      {id:'e1',from:'pipe-demo',to:'pv-demo',fromSide:'top',toSide:'left',variableId:'pipe-pressure-demo',medium:'hydraulic'},
      {id:'e2',from:'pv-demo',to:'pt-demo',fromSide:'right',toSide:'left',medium:'electrical'},
      {id:'e3',from:'pt-demo',to:'pic-demo',fromSide:'bottom',toSide:'top',medium:'electrical'},
      {id:'e4',from:'pic-demo',to:'pcv-demo',fromSide:'left',toSide:'right',medium:'electrical'},
      {id:'e5',from:'pcv-demo',to:'pipe-demo',fromSide:'left',toSide:'bottom',medium:'mechanical'}
    ];
    return {nodes,edges,elapsedSeconds:0};
  };
  let state = loadState();
  let selectedId = null;
  let pendingFrom = null;
  let connectFrom = null;
  let zoom = 1;
  let saveTimer;
  let toastTimer;
  let drag = null;
  let connectionDrag = null;
  let simulationTimer = null;
  let simulationLastTime = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return defaultState();
      return normalizeState(parsed);
    } catch { return defaultState(); }
  }
  function defaultVariableSource() { return 'manual'; }
  function makeProcessVariable(process,type='pressure',seed={}) {
    const source=seed.source||defaultVariableSource(process,type);
    const unit=seed.unit||(source==='scenario'?process.pressureUnit||'kPa':source==='fill'?'%':(unitOptions[type]||['%'])[0]);
    let number=1;
    while(process.variables?.some(variable=>variable.tag===`${type[0].toUpperCase()}-${number}`))number++;
    return {id:seed.id||crypto.randomUUID(),tag:seed.tag||`${type[0].toUpperCase()}-${number}`,
      type,unit,source,value:Number(seed.value??0),trendMode:seed.trendMode||'static',
      startValue:Number(seed.startValue??seed.value??0),targetValue:Number(seed.targetValue??seed.value??0),
      durationSeconds:Number(seed.durationSeconds??10)};
  }
  function normalizeState(candidate) {
    const processes=new Map(candidate.nodes.filter(node=>node.kind==='process').map(process=>{
      process.variables=Array.isArray(process.variables)?process.variables:[];
      process.simulationMode=process.simulationMode||'volume';
      if(process.simulationMode==='guided_pressure'){
        process.simulationMode='variables';
        for(const variable of process.variables.filter(item=>item.type==='pressure'&&item.source==='scenario')){
          const inUnit=value=>convertResult({value:Number(value),unit:process.pressureUnit||'kPa'},variable.unit||process.pressureUnit||'kPa')?.value??Number(value);
          variable.source='manual';variable.trendMode='rise';
          variable.startValue=inUnit(process.startPressure??100);
          variable.targetValue=inUnit(process.targetPressure??500);
          variable.durationSeconds=Number(process.riseSeconds??10);
          variable.value=inUnit(process.pressure??process.startPressure??100);
        }
      }
      for(const variable of process.variables){
        delete variable.name;
        variable.trendMode=variable.trendMode||'static';
        variable.startValue=Number(variable.startValue??variable.value??0);
        variable.targetValue=Number(variable.targetValue??variable.value??0);
        variable.durationSeconds=Number(variable.durationSeconds??10);
      }
      return [process.id,process];
    }));
    for(const node of candidate.nodes.filter(item=>item.kind==='variable'&&item.processId)) {
      const process=processes.get(node.processId);
      if(!process)continue;
      const existing=process.variables.find(variable=>variable.id===node.processVariableId);
      if(existing)continue;
      const type=String(node.variableType||'pressure').replace(/^switch_/,'');
      const created=makeProcessVariable(process,type,{tag:node.tag,unit:node.unit,value:node.value});
      process.variables.push(created);
      node.processVariableId=created.id;
    }
    for(const edge of candidate.edges) {
      const source=processes.get(edge.from);
      const target=candidate.nodes.find(node=>node.id===edge.to);
      if(source&&target?.kind==='variable'&&!edge.variableId)edge.variableId=target.processVariableId;
      if(source&&target?.kind==='instrument'&&!edge.variableId){
        const type=String(target.measurement||'pressure').replace(/^switch_/,'');
        let matching=source.variables.filter(variable=>variable.type===type);
        if(!matching.length){source.variables.push(makeProcessVariable(source,type));matching=source.variables.filter(variable=>variable.type===type);}
        if(matching.length===1)edge.variableId=matching[0].id;
      }
    }
    for(const controller of candidate.nodes.filter(node=>node.kind==='controller')){
      if(controller.name==='Controlador de presión')controller.name='Controlador 4–20 mA';
      if(controller.controlMode==='translate')controller.controlMode='progressive';
      if(controller.controlMode==='threshold'){
        const edge=candidate.edges.find(item=>item.to===controller.id);
        const source=candidate.nodes.find(node=>node.id===edge?.from);
        const toCurrent=pressure=>{
          const measured=convertResult({value:Number(pressure),unit:controller.thresholdUnit||'kPa'},source?.calibrationInputUnit||'kPa');
          const low=Number(source?.calibrationInputLow??0),high=Number(source?.calibrationInputHigh??500);
          return measured&&high!==low?Number(source?.calibrationOutputLow??4)+(measured.value-low)/(high-low)*(Number(source?.calibrationOutputHigh??20)-Number(source?.calibrationOutputLow??4)):null;
        };
        controller.onCurrent=toCurrent(controller.openThreshold??350)??15.2;
        controller.offCurrent=toCurrent(controller.closeThreshold??180)??9.76;
        controller.activeOutput=controller.highAction==='close'?4:20;
        controller.inactiveOutput=controller.activeOutput===20?4:20;
        controller.controlMode='on_off';
      }
    }
    for(const final of candidate.nodes.filter(node=>node.kind==='final')){
      if(Array.isArray(final.processActions))continue;
      final.processActions=[];
      for(const edge of candidate.edges.filter(item=>item.from===final.id)){
        const process=processes.get(edge.to);
        const variable=process?.variables.find(item=>item.type==='pressure'&&item.trendMode==='rise');
        if(variable){
          const rise=(Number(process.targetPressure??500)-Number(process.startPressure??100))/Math.max(.1,Number(process.riseSeconds??10));
          const relief=(Number(process.targetPressure??500)-Number(process.reliefPressure??120))/Math.max(.1,Number(process.reliefSeconds??5));
          const rate=convertResult({value:Math.max(0,rise+relief),unit:process.pressureUnit||'kPa'},variable.unit||process.pressureUnit||'kPa')?.value??Math.max(0,rise+relief);
          final.processActions.push({id:crypto.randomUUID(),processId:process.id,variableId:variable.id,when:final.processRole==='inlet'?'closed':'open',effect:'decrease',rate});
        }
      }
    }
    return candidate;
  }
  function persist(show = false) {
    document.querySelector('#save-state').textContent = 'Guardando…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        document.querySelector('#save-state').textContent = 'Guardado local';
        document.querySelector('#save-button').innerHTML = '<span>✓</span> Guardado';
        if (show) toast('Diagrama guardado en este navegador.');
      } catch { toast('No se pudo guardar en el almacenamiento local.'); }
    }, 180);
  }
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2300);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function nodeById(id) { return state.nodes.find(node => node.id === id); }
  function edgesIn(id) { return state.edges.filter(edge => edge.to === id); }
  function edgesOut(id) { return state.edges.filter(edge => edge.from === id); }
  function outputChannel(node) { return node ? `${node.tag}.out` : ''; }
  function toM3PerHour(value, unit) {
    if (unit === 'm³/s') return value * 3600;
    if (unit === 'L/min') return value * 0.06;
    return value;
  }
  function translate(value, inputLow, inputHigh, outputLow, outputHigh, inputUnit, outputUnit) {
    if (!value || value.value === undefined) return null;
    const source = baseMagnitude(value.value, value.unit || inputUnit);
    const low = baseMagnitude(inputLow, inputUnit);
    const high = baseMagnitude(inputHigh, inputUnit);
    if (source.dimension !== low.dimension || low.dimension !== high.dimension || high.value === low.value) return null;
    const fraction = (source.value - low.value) / (high.value - low.value);
    return {value: outputLow + fraction * (outputHigh - outputLow), unit: outputUnit};
  }
  function processFill(node) { return Math.max(0, Math.min(100, Number(node.fill) || 0)); }
  function processVariableById(process,id) { return process?.variables?.find(variable=>variable.id===id); }

  function processVariableReading(node) {
    const process = nodeById(node.processId);
    if (!process) return null;
    const variable=processVariableById(process,node.processVariableId);
    if(!variable||variable.type!==magnitudeType(node))return null;
    const reading=new ProcessVariableSource(process,variable).read();
    return reading?convertResult(reading,node.unit||reading.unit):null;
  }

  function valueOf(node, seen = new Set()) {
    if (!node || seen.has(node.id)) return null;
    seen.add(node.id);
    if (node.fixed) {
      if (node.kind === 'process') return node.simulationMode==='volume'
        ? {value:processFill(node),unit:'%'} : {value:(node.variables||[]).length,unit:'variables'};
      if (isSwitch(node)) return {on: Boolean(node.switchOn), unit:'ON/OFF'};
      const fixed={value:Number(node.value) || 0,unit:node.unit || '%'};
      if(node.kind==='instrument'&&['transmitter','sensor_transmitter'].includes(node.instrumentType)) {
        const current=convertResult(fixed,'mA');
        const low=Number(node.calibrationOutputLow??4),high=Number(node.calibrationOutputHigh??20);
        if(current&&high!==low)fixed.engineering={
          value:Number(node.calibrationInputLow??0)+(current.value-low)/(high-low)*(Number(node.calibrationInputHigh??100)-Number(node.calibrationInputLow??0)),
          unit:node.calibrationInputUnit||(unitOptions[magnitudeType(node)]||['%'])[0]
        };
      }
      return fixed;
    }
    if (node.kind === 'process') return node.simulationMode === 'volume'
      ? {value:processFill(node),unit:'%'} : {value:(node.variables||[]).length,unit:'variables'};
    if (node.kind === 'variable') {
      if (isSwitch(node)) {
        const source = edgesIn(node.id).map(edge => nodeById(edge.from)).find(Boolean);
        const incoming = node.processId ? processVariableReading(node) : valueOf(source, seen);
        if (incoming?.on !== undefined) return incoming;
        return new SwitchHysteresis(node).evaluate(incoming);
      }
      if (node.processId) return processVariableReading(node);
      return {value:Number(node.value)||0,unit:node.unit||'%'};
    }
    if (node.kind === 'instrument') {
      const incomingEdge=edgesIn(node.id)[0];
      const source=nodeById(incomingEdge?.from);
      let incoming=null;
      if(source?.kind==='process') {
        const bound=processVariableById(source,incomingEdge.variableId);
        if(bound?.type===magnitudeType(node))incoming=new ProcessVariableSource(source,bound).read();
      } else if(source) incoming=valueOf(source,seen);
      if(incoming?.value!==undefined&&!compatibleMeasurement(node.measurement,incoming))return null;
      if(isSwitch(node)){
        if(incoming?.on!==undefined)return incoming;
        return new SwitchHysteresis(node).evaluate(incoming);
      }
      if(incoming?.on!==undefined)return null;
      if (incoming?.value === undefined) return incoming;
      if (node.instrumentType === 'transmitter' || node.instrumentType === 'sensor_transmitter') {
        const translated = translate(incoming, Number(node.calibrationInputLow ?? 0), Number(node.calibrationInputHigh ?? 100),
          Number(node.calibrationOutputLow ?? 4), Number(node.calibrationOutputHigh ?? 20),
          node.calibrationInputUnit || incoming.unit || node.measurement, 'mA');
        if (translated) translated.engineering = {value:incoming.value,unit:incoming.unit};
        return translated;
      }
      return convertResult(incoming,node.unit) || incoming;
    }
    if (node.kind === 'controller') {
      const source = edgesIn(node.id).map(edge => nodeById(edge.from)).find(Boolean);
      const incoming = source ? valueOf(source, seen) : null;
      if (incoming?.value === undefined) return null;
      return new CurrentController(node).evaluate(incoming);
    }
    if (node.kind === 'final') {
      const source = edgesIn(node.id).map(edge => nodeById(edge.from)).find(Boolean);
      const incoming = source ? valueOf(source, seen) : null;
      return new ValveActuator().position(incoming);
    }
    return null;
  }
  function processControlInputs(process) {
    const result={inletOpening:100,outletOpening:0,inletConnected:false,outletConnected:false};
    for(const edge of edgesIn(process.id)) {
      const actuator=nodeById(edge.from);
      if(actuator?.kind!=='final')continue;
      const position=valueOf(actuator);
      if(!position || !Number.isFinite(position.value))continue;
      const opening=Math.max(0,Math.min(100,Number(position.value)));
      if(actuator.processRole==='inlet') {
        result.inletConnected=true;
        result.inletOpening=Math.min(result.inletOpening,opening);
      } else {
        result.outletConnected=true;
        result.outletOpening=Math.max(result.outletOpening,opening);
      }
    }
    return result;
  }
  function isSwitch(node) { return node.instrumentType==='switch' || node.variableType?.startsWith('switch_') || node.measurement?.startsWith('switch_'); }
  function magnitudeType(node) {
    const value = node.variableType || node.measurement || 'pressure';
    return value.replace('switch_','');
  }
  function formatValue(result, digits = 1) {
    if (!result) return '—';
    if (result.on !== undefined) return result.on ? 'ON' : 'OFF';
    return `${Number(result.value).toFixed(digits)} ${result.unit || ''}`.trim();
  }
  function descriptor(node) {
    if (node.kind === 'process') {
      const action=processControlInputs(node);
      const control=action.inletConnected?`entrada ${action.inletOpening.toFixed(0)} %`:action.outletConnected?`salida ${action.outletOpening.toFixed(0)} %`:'';
      return node.simulationMode === 'volume'
        ? `${node.subtype} · ${Number(node.capacity).toFixed(1)} m³${control?` · ${control}`:''}`
        : `${node.subtype} · tendencias por variable`;
    }
    if (node.kind === 'variable') return `${node.variableType.replaceAll('_',' ')}${node.processId ? ' · proceso asociado' : ''}`;
    if (node.kind === 'instrument') return `${node.instrumentType.replaceAll('_',' ')} · ${node.measurement.replaceAll('_',' ')}`;
    if (node.kind === 'controller') return node.fixed ? 'Salida de prueba constante' : node.controlMode === 'on_off' ? 'Decisión ON/OFF desde mA' : 'Respuesta progresiva desde mA';
    return `${node.processRole==='inlet'?'Válvula de entrada':'Válvula de salida'} · ${(node.processActions||[]).length} acciones`;
  }
  function currentValue(node) {
    return valueOf(node);
  }
  function typeLabel(type) {
    return ({pressure:'Presión',temperature:'Temperatura',flow:'Caudal',level:'Nivel'})[String(type||'').replace(/^switch_/,'')]||'Variable';
  }
  function cardVisual(node,value) {
    if(node.kind==='process') {
      const line=node.subtype==='Línea de proceso';
      const art=line
        ? '<svg viewBox="0 0 112 42" aria-hidden="true"><path d="M7 12h16v18H7m16-9h65m0-9h17v18H88M41 14l9 7-9 7m26-14 9 7-9 7"/></svg>'
        : '<svg viewBox="0 0 112 42" aria-hidden="true"><path d="M28 4h56v34H28zM28 22c14-6 28 6 42 0 6-3 10-3 14 0M48 4v-4m16 4v-4"/></svg>';
      const chips=(node.variables||[]).slice(0,4).map(variable=>`<span>${escapeHtml(variable.tag)} · ${escapeHtml(typeLabel(variable.type))}</span>`).join('');
      return `<div class="process-visual"><div class="process-art">${art}</div><div class="process-inventory"><b>${(node.variables||[]).length} variables</b><div>${chips||'<span>Sin variables</span>'}</div></div></div>`;
    }
    if(node.kind==='variable') {
      const process=nodeById(node.processId);
      return `<div class="card-flow-label"><span>${isSwitch(node)?'CONTACTO':'MAGNITUD'}</span><strong>${escapeHtml(typeLabel(node.variableType))}</strong><span>${escapeHtml(process?.tag||'PRUEBA')}</span></div>`;
    }
    if(node.kind==='instrument') {
      const transmitter=['transmitter','sensor_transmitter'].includes(node.instrumentType);
      return `<div class="card-flow-label"><span>${escapeHtml(typeLabel(node.measurement))}</span><strong>→</strong><span>${transmitter?'4–20 mA':node.instrumentType==='switch'?'ON / OFF':'LECTURA'}</span></div>`;
    }
    if(node.kind==='controller')return `<div class="card-flow-label"><span>mA ENTRA</span><strong>◇</strong><span>${node.controlMode==='on_off'?'ON / OFF':'PROGRESIVO'}</span></div>`;
    const opening=value?.value===undefined?0:Math.max(0,Math.min(100,Number(value.value)));
    return `<div class="valve-visual"><span>${node.processRole==='inlet'?'ALIMENTACIÓN':'DESCARGA'}</span><div class="valve-track"><i style="width:${opening}%"></i></div><b>${opening.toFixed(0)} %</b></div>`;
  }

  function render() {
    canvas.style.height=`${Math.max(1080,...state.nodes.map(node=>Number(node.y||0)+260))}px`;
    canvas.style.width=`${Math.max(1800,...state.nodes.map(node=>Number(node.x||0)+300))}px`;
    canvas.querySelectorAll('.node').forEach(el => el.remove());
    document.querySelector('#canvas-hint').classList.toggle('visible', state.nodes.length === 0);
    for (const node of state.nodes) {
      const meta = kinds[node.kind];
      const value = currentValue(node);
      const unitText = value?.on !== undefined ? '' : (value?.unit ? `<small>${escapeHtml(value.unit)}</small>` : '');
      const textValue = node.kind==='process'&&node.simulationMode!=='volume'?String((node.variables||[]).length):value?.on !== undefined ? (value.on ? 'ON' : 'OFF') : (value ? Number(value.value).toFixed(1) : (node.kind === 'controller' ? 'Sin señal' : 'Sin lectura'));
      const status = node.kind==='process'?'Objeto con variables':value ? (value.on !== undefined ? 'Estado discreto' : 'Valor disponible') : 'Esperando entrada';
      const element = document.createElement('article');
      element.className = `node ${node.kind}${node.kind==='process'&&node.simulationMode==='variables'?' variables-mode':''}${selectedId === node.id ? ' selected' : ''}`;
      element.dataset.id = node.id;
      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;
      element.innerHTML = `<div class="node-header"><span class="node-icon">${meta.icon}</span><span class="node-title"><strong>${escapeHtml(node.tag)}</strong><small>${escapeHtml(node.name)}</small></span><button class="node-more" title="Editar tarjeta">···</button></div><div class="node-body"><div class="node-summary">${escapeHtml(descriptor(node))}</div><div class="node-visual">${cardVisual(node,value)}</div><div class="node-value">${escapeHtml(textValue)} ${unitText}</div><div class="node-meta"><span class="node-state"><i></i>${escapeHtml(status)}</span><span>${edgesIn(node.id).length} ↙ · ${edgesOut(node.id).length} ↗</span></div></div><div class="port-row">${['top','right','bottom','left'].map(side=>`<button class="port ${side}${pendingFrom?.id===node.id&&pendingFrom.side===side?' pending':''}" title="Conectar desde ${side}" aria-label="Conector ${side}" data-side="${side}"></button>`).join('')}</div>`;
      element.addEventListener('click', event => {
        if (event.target.closest('.port')) return;
        selectNode(node.id);
      });
      element.querySelector('.node-more').addEventListener('click', event => { event.stopPropagation(); selectNode(node.id); });
      element.querySelectorAll('.port').forEach(port => port.addEventListener('pointerdown', event => {
        event.stopPropagation();
        startConnection(event, node.id,port.dataset.side);
      }));
      element.querySelector('.node-header').addEventListener('pointerdown', event => startDrag(event,node.id,element));
      canvas.append(element);
    }
    drawEdges();
    document.querySelector('#node-count').textContent = state.nodes.length;
    document.querySelector('#connection-count').textContent = `${state.edges.length} conexión${state.edges.length === 1 ? '' : 'es'}`;
    document.querySelector('#status-message').textContent = state.nodes.length ? `${state.nodes.length} objetos en el diagrama` : 'Diagrama listo';
    if (selectedId && nodeById(selectedId)) renderInspector(nodeById(selectedId));
    else { selectedId = null; inspectorPage='home'; showEmptyInspector(); }
  }
  function portAnchor(node,side) {
    const element=Array.from(canvas.querySelectorAll('.node')).find(card=>card.dataset.id===node.id);
    const width=element?.offsetWidth||240,height=element?.offsetHeight||175;
    const points={top:[width/2,0,0,-1],right:[width,height/2,1,0],bottom:[width/2,height,0,1],left:[0,height/2,-1,0]};
    const [x,y,nx,ny]=points[side]||points.right;
    return {x:node.x+x,y:node.y+y,nx,ny};
  }
  function edgeSides(edge,from,to) {
    if(edge.fromSide&&edge.toSide)return [edge.fromSide,edge.toSide];
    const dx=(to.x+120)-(from.x+120),dy=(to.y+85)-(from.y+85);
    return Math.abs(dx)>=Math.abs(dy)
      ? [dx>=0?'right':'left',dx>=0?'left':'right']
      : [dy>=0?'bottom':'top',dy>=0?'top':'bottom'];
  }
  function curvedPath(start,end) {
    const distance=Math.hypot(end.x-start.x,end.y-start.y);
    const bend=Math.max(45,Math.min(170,distance*.38));
    return `M ${start.x} ${start.y} C ${start.x+start.nx*bend} ${start.y+start.ny*bend}, ${end.x+end.nx*bend} ${end.y+end.ny*bend}, ${end.x} ${end.y}`;
  }
  function drawEdges() {
    svg.innerHTML = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#88958f"/></marker></defs>';
    for (const edge of state.edges) {
      const from = nodeById(edge.from), to = nodeById(edge.to);
      if (!from || !to) continue;
      const [fromSide,toSide]=edgeSides(edge,from,to);
      const start=portAnchor(from,fromSide),end=portAnchor(to,toSide);
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',curvedPath(start,end));path.setAttribute('class',`edge ${edge.medium}`);path.setAttribute('marker-end','url(#arrow)');path.setAttribute('data-edge',edge.id);
      path.addEventListener('click',()=>{state.edges=state.edges.filter(item=>item.id!==edge.id);render();persist();toast('Conexión eliminada.');});
      svg.append(path);
      const label=document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x',(start.x+end.x)/2);label.setAttribute('y',(start.y+end.y)/2-7);label.setAttribute('text-anchor','middle');label.setAttribute('class','edge-label');label.textContent=mediumLabels[edge.medium]||edge.medium;svg.append(label);
    }
    if (connectionDrag) {
      const from = nodeById(connectionDrag.from);
      if (from) {
        const rect = canvas.getBoundingClientRect();
        const start=portAnchor(from,connectionDrag.fromSide);
        const end={x:(connectionDrag.clientX-rect.left)/zoom,y:(connectionDrag.clientY-rect.top)/zoom,nx:0,ny:0};
        const path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',curvedPath(start,end));
        path.setAttribute('class', 'edge electrical connection-preview');
        svg.append(path);
      }
    }
  }
  function startConnection(event, id, side) {
    if (event.button !== 0) return;
    event.preventDefault();
    if(pendingFrom&&pendingFrom.id!==id) {
      const from=pendingFrom;
      pendingFrom=null;
      requestConnection(from.id,id,from.side,side);
      return;
    }
    connectionDrag = {from:id,fromSide:side,startX:event.clientX,startY:event.clientY,clientX:event.clientX, clientY:event.clientY};
    document.querySelector('#status-message').textContent = 'Arrastra hacia cualquier punto de otra tarjeta';
    document.addEventListener('pointermove', moveConnection);
    document.addEventListener('pointerup', finishConnection, {once:true});
    drawEdges();
  }
  function moveConnection(event) {
    if (!connectionDrag) return;
    connectionDrag.clientX = event.clientX;
    connectionDrag.clientY = event.clientY;
    drawEdges();
  }
  function finishConnection(event) {
    const origin=connectionDrag;
    const targetPort = document.elementFromPoint(event.clientX, event.clientY)?.closest('.port');
    connectionDrag = null;
    document.removeEventListener('pointermove', moveConnection);
    drawEdges();
    if (!origin) return;
    const target=targetPort?.closest('.node')?.dataset.id;
    if(target&&target!==origin.from) {
      pendingFrom=null;
      requestConnection(origin.from,target,origin.fromSide,targetPort.dataset.side);
      return;
    }
    if(Math.hypot(event.clientX-origin.startX,event.clientY-origin.startY)<6) {
      pendingFrom=pendingFrom?.id===origin.from&&pendingFrom.side===origin.fromSide?null:{id:origin.from,side:origin.fromSide};
      render();
      document.querySelector('#status-message').textContent=pendingFrom?'Elige cualquier punto de otra tarjeta':'Diagrama listo';
    } else {
      document.querySelector('#status-message').textContent = 'Diagrama listo';
    }
  }
  function startDrag(event,id,element) {
    if (event.button !== 0) return;
    if(selectedId!==id)inspectorPage='home';
    selectedId = id;
    element.classList.add('selected');
    renderInspector(nodeById(id));
    drag={id,element,startX:event.clientX,startY:event.clientY,originX:nodeById(id).x,originY:nodeById(id).y};
    element.setPointerCapture(event.pointerId);
    element.addEventListener('pointermove',moveDrag);
    element.addEventListener('pointerup',endDrag,{once:true});
  }
  function moveDrag(event) {
    if (!drag) return;
    const node=nodeById(drag.id);if(!node)return;
    node.x=Math.max(0,drag.originX+(event.clientX-drag.startX)/zoom);
    node.y=Math.max(0,drag.originY+(event.clientY-drag.startY)/zoom);
    drag.element.style.left=`${node.x}px`;drag.element.style.top=`${node.y}px`;drawEdges();
  }
  function endDrag() { if(drag){drag.element.removeEventListener('pointermove',moveDrag);drag=null;persist();} }

  function requestConnection(fromId,toId,fromSide,toSide) {
    const source=nodeById(fromId),target=nodeById(toId);
    if(!source||!target||source.id===target.id)return;
    if(state.edges.some(edge=>edge.from===fromId&&edge.to===toId)){toast('Estas tarjetas ya están conectadas.');return;}
    if(source.kind==='process'&&!['variable','instrument'].includes(target.kind)){
      toast('Primero extrae una variable del objeto.');return;
    }
    if(target.kind==='variable'&&source.kind!=='process'){
      toast('Una tarjeta de variable debe salir de un tanque o tubería.');return;
    }
    if(['variable','instrument','controller','final'].includes(target.kind)&&edgesIn(toId).length){
      toast('Esta tarjeta ya tiene una fuente. Elimina esa conexión para cambiarla.');return;
    }
    if(target.kind==='instrument'&&source.kind==='variable'&&magnitudeType(source)!==magnitudeType(target)){
      toast(`El instrumento de ${typeLabel(target.measurement).toLowerCase()} no puede medir ${typeLabel(source.variableType).toLowerCase()}.`);return;
    }
    if(target.kind==='instrument'&&source.kind==='instrument'&&magnitudeType(source)!==magnitudeType(target)){
      toast('Los instrumentos deben medir la misma magnitud.');return;
    }
    if(target.kind==='controller'&&!(source.kind==='controller'||(source.kind==='instrument'&&['transmitter','sensor_transmitter'].includes(source.instrumentType)))){
      toast('El controlador necesita una señal en mA de un transmisor.');return;
    }
    const variableGroup=document.querySelector('#connection-variable-group');
    variableGroup.hidden=true;
    if(source.kind==='process') {
      const choices=(source.variables||[]).filter(variable=>variable.type===magnitudeType(target));
      if(!choices.length){toast(`Añade ${typeLabel(magnitudeType(target)).toLowerCase()} dentro de ${source.tag}.`);return;}
      const select=document.querySelector('#connection-variable');
      select.innerHTML=choices.map(variable=>`<option value="${escapeHtml(variable.id)}" ${variable.id===target.processVariableId?'selected':''}>${escapeHtml(variable.tag)} · ${escapeHtml(typeLabel(variable.type))}</option>`).join('');
      variableGroup.hidden=false;
    }
    connectFrom={from:fromId,to:toId,fromSide,toSide};
    document.querySelector('#connection-route').textContent=`${source.tag} → ${target.tag}`;
    document.querySelector('#connection-dialog').showModal();
  }
  document.querySelector('#confirm-connection').addEventListener('click',event=>{
    event.preventDefault();if(!connectFrom)return;
    const medium=document.querySelector('#connection-medium').value;
    const target=nodeById(connectFrom.to), source=nodeById(connectFrom.from);
    const variableId=source.kind==='process'?document.querySelector('#connection-variable').value:undefined;
    state.edges.push({id:crypto.randomUUID(),...connectFrom,medium,...(variableId?{variableId}:{})});
    if(target.kind==='variable'&&source.kind==='process'){
      const variable=processVariableById(source,variableId);
      target.processId=source.id;target.processVariableId=variableId;target.fixed=false;
      target.unit=variable.unit;target.variableType=isSwitch(target)?`switch_${variable.type}`:variable.type;
    }
    if(target.kind==='process'&&source.kind==='variable'&&magnitudeType(source)==='flow')target.flowVariableId=source.id;
    if(source.kind==='final'&&target.kind==='process'){
      selectedId=source.id;
      inspectorPage='actions';
    }
    document.querySelector('#connection-dialog').close();pendingFrom=null;connectFrom=null;render();persist();toast('Conexión creada.');
  });

  let inspectorPage='home';
  function selectNode(id) { if(selectedId!==id)inspectorPage='home';selectedId=id;render(); }
  function showEmptyInspector() {
    inspector.innerHTML='<div class="inspector-empty"><div class="inspector-art">↺</div><h2>Selecciona una tarjeta</h2><div class="inspector-flow"><span>▤ Objeto</span><b>→</b><span>PV Variable</span><b>→</b><span>PT Instrumento</span><b>→</b><span>◇ Control</span><b>→</b><span>⌖ Válvula</span></div></div>';
  }
  function optionList(options,selected) { return options.map(([value,label])=>`<option value="${escapeHtml(value)}" ${value===selected?'selected':''}>${escapeHtml(label)}</option>`).join(''); }
  function field(label,name,value,type='text',help='') { return `<div class="field"><label>${escapeHtml(label)}</label><input name="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${escapeHtml(value)}">${help?`<div class="field-help">${escapeHtml(help)}</div>`:''}</div>`; }
  function selectField(label,name,options,selected) { return `<div class="field"><label>${escapeHtml(label)}</label><select name="${name}">${optionList(options,selected)}</select></div>`; }
  function renderInspector(node) {
    const meta=kinds[node.kind];
    const pages=[];
    const addPage=(id,icon,label,html)=>pages.push({id,icon,label,html});
    if(node.kind==='process') {
      addPage('object','▤','Objeto',`<div class="inspector-section">${selectField('Forma','subtype',[['Tanque','Tanque'],['Línea de proceso','Tubería / línea']],node.subtype)}${selectField('Simulación','simulationMode',[['variables','Tendencias por variable'],['volume','Balance de llenado']],node.simulationMode||'variables')}</div>`);
      addPage('inventory','◉','Variables',processInventorySection(node));
      if(node.simulationMode==='volume')addPage('fill','▥','Llenado',`<div class="inspector-section">${field('Capacidad (m³)','capacity',node.capacity,'number')}<div class="field-row">${field('Llenado (%)','fill',node.fill,'number')}${field('Entrada (m³/h)','inflow',node.inflow,'number')}</div>${field('Salida (m³/h)','outflow',node.outflow,'number')}<label class="check-field"><input type="checkbox" name="fixed" ${node.fixed?'checked':''}><span>Fijar llenado</span></label>${calculatedProcess(node)}</div>`);
    } else if(node.kind==='variable') {
      const opts=[['pressure','Presión'],['temperature','Temperatura'],['flow','Caudal'],['level','Nivel'],['switch_pressure','Switch de presión'],['switch_temperature','Switch de temperatura'],['switch_flow','Switch de caudal'],['switch_level','Switch de nivel']];
      const sources=[['','Valor independiente'],...state.nodes.filter(item=>item.kind==='process').flatMap(process=>(process.variables||[]).map(variable=>[`${process.id}|${variable.id}`,`${process.tag} / ${variable.tag} · ${typeLabel(variable.type)}`]))];
      addPage('source','◎','Fuente',`<div class="inspector-section">${selectField('Variable del objeto','sourceVariableRef',sources,node.processId&&node.processVariableId?`${node.processId}|${node.processVariableId}`:'')}${node.processVariableId?`<div class="source-badge">${escapeHtml(typeLabel(node.variableType))} · ${escapeHtml(nodeById(node.processId)?.tag||'')}</div>${selectField('Representación','variableMode',[['analog','Valor analógico'],['switch','Contacto ON / OFF']],isSwitch(node)?'switch':'analog')}`:selectField('Magnitud','variableType',opts,node.variableType)}</div>`);
      if(isSwitch(node))addPage('switch','◐','Contacto',switchSection(node));
      addPage('test','⚑','Prueba',fixedSection(node));
    } else if(node.kind==='instrument') {
      addPage('measure','◉','Medición',`<div class="inspector-section">${selectField('Función','instrumentType',[['sensor','Sensor'],['transmitter','Transmisor'],['sensor_transmitter','Sensor + transmisor'],['switch','Switch']],node.instrumentType)}${selectField('Mide','measurement',[['pressure','Presión'],['temperature','Temperatura'],['flow','Caudal'],['level','Nivel']],magnitudeType(node))}${instrumentSourceSection(node)}<label class="check-field"><input type="checkbox" name="integrated" ${node.integrated?'checked':''}><span>Sensor integrado</span></label></div>`);
      if(node.instrumentType==='switch')addPage('switch','◐','Contacto',switchSection(node));
      if(node.instrumentType==='transmitter'||node.instrumentType==='sensor_transmitter')addPage('calibration','⌁','Calibración',calibrationSection(node));
      addPage('test','⚑','Prueba',fixedSection(node));
    } else if(node.kind==='controller') {
      addPage('logic','◇','Modo',`<div class="inspector-section">${selectField('Respuesta a la señal','controlMode',[['progressive','Progresiva'],['on_off','ON / OFF']],node.controlMode||'progressive')}</div>`);
      addPage('response','⌁','Respuesta',node.controlMode==='on_off'?controllerCurrentSwitchSection(node):controllerTranslationSection(node));
      addPage('test','⚑','Prueba',fixedSection(node));
    } else {
      addPage('valve','⌖','Válvula',`<div class="inspector-section">${selectField('Ubicación','processRole',[['outlet','Salida / descarga'],['inlet','Entrada / alimentación']],node.processRole||'outlet')}<div class="signal-map"><span>4 mA · cerrada</span><span>20 mA · abierta</span></div></div>`);
      addPage('actions','↗','Acciones',processActionsSection(node));
      addPage('test','⚑','Prueba',fixedSection(node));
    }
    const incoming=edgesIn(node.id).map(edge=>{const other=nodeById(edge.from);return other?`← ${escapeHtml(other.tag)} <span>· ${mediumLabels[edge.medium]}</span>`:''}).filter(Boolean);
    const outgoing=edgesOut(node.id).map(edge=>{const other=nodeById(edge.to);return other?`→ ${escapeHtml(other.tag)} <span>· ${mediumLabels[edge.medium]}</span>`:''}).filter(Boolean);
    addPage('identity','✎','Etiqueta',`<div class="inspector-section">${field('Etiqueta','tag',node.tag)}${field('Nombre secundario','name',node.name)}</div><div class="inspector-footer"><button class="button danger" id="delete-node">Eliminar tarjeta</button></div>`);
    addPage('connections','⇄','Conexiones',`<div class="inspector-section"><div class="inspector-connections">${incoming.length?incoming.join('<br>'):'Sin entradas'}<br>${outgoing.length?outgoing.join('<br>'):'Sin salidas'}</div></div>`);
    const active=pages.find(page=>page.id===inspectorPage);
    if(inspectorPage!=='home'&&!active)inspectorPage='home';
    const home=`<div class="inspector-menu"><div class="inspector-menu-heading">${escapeHtml(meta.label)}</div><div class="inspector-menu-grid">${pages.map(page=>`<button class="section-tile" data-page="${page.id}" title="${escapeHtml(page.label)}" aria-label="${escapeHtml(page.label)}"><span class="section-tile-icon">${page.icon}</span></button>`).join('')}</div></div>`;
    const content=inspectorPage==='home'?home:`<div class="inspector-page-bar"><button class="back-button" id="inspector-back" aria-label="Volver al menú">←</button><strong>${escapeHtml(active.label)}</strong></div>${active.html}`;
    inspector.innerHTML=`<div class="inspector-head"><span class="node-icon ${node.kind}">${meta.icon}</span><div><h2>${escapeHtml(node.tag)}</h2><small>${escapeHtml(node.name)}</small></div><button class="node-more" id="close-inspector" style="margin-left:auto">×</button></div>${content}`;
    inspector.querySelector('#close-inspector').addEventListener('click',()=>{selectedId=null;inspectorPage='home';showEmptyInspector();render();});
    inspector.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{inspectorPage=button.dataset.page;renderInspector(node);inspector.scrollTop=0;}));
    inspector.querySelector('#inspector-back')?.addEventListener('click',()=>{inspectorPage='home';renderInspector(node);inspector.scrollTop=0;});
    inspector.querySelector('#delete-node')?.addEventListener('click',()=>deleteNode(node.id));
    inspector.querySelectorAll('.object-variable input,.object-variable select').forEach(control=>{control.dataset.variableField=control.name;});
    inspector.querySelectorAll('.action-row input,.action-row select').forEach(control=>{control.dataset.actionField=control.name;});
    inspector.querySelectorAll('input:not([data-variable-field]):not([data-action-field]),select:not([data-variable-field]):not([data-action-field])').forEach(control=>control.addEventListener('change',()=>{
      if(control.name==='sourceVariableRef'){
        const previous=valueOf(node);
        state.edges=state.edges.filter(edge=>!(edge.to===node.id&&nodeById(edge.from)?.kind==='process'));
        if(!control.value){
          node.processId='';node.processVariableId='';node.fixed=true;
          if(previous?.value!==undefined)node.value=previous.value;
        } else {
          const [processId,variableId]=control.value.split('|');
          const process=nodeById(processId),variable=processVariableById(process,variableId);
          if(process&&variable){
            node.processId=processId;node.processVariableId=variableId;node.fixed=false;
            node.variableType=isSwitch(node)?`switch_${variable.type}`:variable.type;
            node.unit=variable.unit;node.thresholdUnit=variable.unit;
            state.edges.push({id:crypto.randomUUID(),from:processId,to:node.id,fromSide:'right',toSide:'left',variableId,medium:'hydraulic'});
          }
        }
        render();persist();return;
      }
      if(control.name==='edgeVariableId'){
        const edge=edgesIn(node.id)[0];
        if(edge)edge.variableId=control.value;
        render();persist();return;
      }
      if(control.name==='variableMode'){
        node.variableType=control.value==='switch'?`switch_${magnitudeType(node)}`:magnitudeType(node);
        node.switchOn=false;node.thresholdUnit=node.unit;
        render();persist();return;
      }
      const previousValue=node[control.name];
      if(control.name==='fixed'||control.name==='integrated')node[control.name]=control.checked;
      else if(control.name==='switchOn')node.switchOn=control.value==='true';
      else if(['capacity','fill','inflow','outflow','value','threshold','onThreshold','offThreshold','calibrationInputLow','calibrationInputHigh','calibrationOutputLow','calibrationOutputHigh','inputLow','inputHigh','outputLow','outputHigh','onCurrent','offCurrent','activeOutput','inactiveOutput'].includes(control.name))node[control.name]=Number(control.value);
      else node[control.name]=control.value;
      if(control.name==='thresholdUnit') {
        for(const key of ['onThreshold','offThreshold']) {
          if(node[key]!==undefined) node[key]=convertResult({value:node[key],unit:previousValue||node.unit},node.thresholdUnit)?.value??node[key];
        }
      }
      if(control.name==='simulationMode'&&node.kind==='process')for(const variable of node.variables||[]){
        if(['fill','inflow','outflow'].includes(variable.source)&&node.simulationMode!=='volume')variable.source='manual';
      }
      if(control.name==='switchDirection'&&node.kind==='controller'){
        node.active=false;
        if((node.switchDirection==='low'&&Number(node.onCurrent)>Number(node.offCurrent))||
          (node.switchDirection==='high'&&Number(node.onCurrent)<Number(node.offCurrent))){
          [node.onCurrent,node.offCurrent]=[node.offCurrent,node.onCurrent];
        }
      } else if(control.name==='switchDirection'){
        node.switchOn=false;
        if((node.switchDirection==='low'&&Number(node.onThreshold)>Number(node.offThreshold))||
          (node.switchDirection==='high'&&Number(node.onThreshold)<Number(node.offThreshold))){
          [node.onThreshold,node.offThreshold]=[node.offThreshold,node.onThreshold];
        }
      }
      if(control.name==='variableType'&&control.value.startsWith('switch_'))node.variableType=control.value;
      if(control.name==='instrumentType'&&control.value==='switch'&&!node.measurement.startsWith('switch_'))node.measurement=`switch_${node.measurement}`;
      if(control.name==='instrumentType'&&control.value!=='switch'&&node.measurement.startsWith('switch_'))node.measurement=node.measurement.slice(7);
      if(['variableType','measurement','instrumentType'].includes(control.name)){
        const choices=node.kind==='instrument'&&['transmitter','sensor_transmitter'].includes(node.instrumentType)?['mA']:[...(unitOptions[magnitudeType(node)]||['%'])];
        if(node.kind==='variable'&&node.variableType==='level'&&node.processId&&!node.fixed)choices.splice(0,choices.length,'%');
        if(!choices.includes(node.unit))node.unit=choices[0];
        if(node.kind==='instrument'&&control.name==='measurement')node.calibrationInputUnit=(unitOptions[magnitudeType(node)]||['%'])[0];
        if(isSwitch(node)){
          const thresholdChoices=unitOptions[magnitudeType(node)]||['%'];
          if(!thresholdChoices.includes(node.thresholdUnit)){
            node.thresholdUnit=thresholdChoices[0];
            node.onThreshold=node.switchDirection==='low'?10:100;
            node.offThreshold=node.switchDirection==='low'?14:90;
            node.switchOn=false;
          }
        }
      }
      render();persist();
    }));
    bindProcessInventory(node);
    bindProcessActions(node);
  }
  function processInventorySection(process) {
    const rows=(process.variables||[]).map(variable=>{
      const sources=[['manual','Valor de esta variable']];
      if(variable.type==='level'&&process.simulationMode==='volume')sources.push(['fill','↗ Llenado del objeto']);
      if(variable.type==='flow'&&process.simulationMode==='volume')sources.push(['inflow','↗ Entrada nominal'],['outflow','↗ Salida nominal']);
      const units=variable.source==='fill'?['%']:(unitOptions[variable.type]||['%']);
      const reading=new ProcessVariableSource(process,variable).read();
      const behavior=variable.source==='manual'?selectField('Con el tiempo','trendMode',[['static','— Estática'],['rise','↗ Subir'],['fall','↘ Bajar']],variable.trendMode||'static'):'';
      const values=variable.source!=='manual'?'':variable.trendMode==='rise'||variable.trendMode==='fall'
        ? `<div class="field-row">${field('Inicio','startValue',variable.startValue??variable.value,'number')}${field('Meta','targetValue',variable.targetValue??variable.value,'number')}</div><div class="field-row">${field('Tiempo (s)','durationSeconds',variable.durationSeconds??10,'number')}${field('Actual','value',variable.value,'number')}</div>`
        :field('Valor fijo','value',variable.value,'number');
      return `<div class="object-variable" data-variable-id="${escapeHtml(variable.id)}"><div class="object-variable-head"><span class="type-mark ${variable.type}">${escapeHtml(variable.type[0].toUpperCase())}</span><strong>${escapeHtml(variable.tag)}</strong><span class="object-variable-reading">${escapeHtml(formatValue(reading))}</span><button class="mini-action" data-extract-variable="${escapeHtml(variable.id)}" title="Sacar tarjeta al diagrama">↗</button><button class="mini-action remove" data-remove-variable="${escapeHtml(variable.id)}" title="Eliminar variable">×</button></div><div class="field-row">${selectField('Magnitud','type',[['pressure','Presión'],['temperature','Temperatura'],['flow','Caudal'],['level','Nivel']],variable.type)}${field('Etiqueta','tag',variable.tag)}</div><div class="field-row">${selectField('Origen','source',sources,variable.source)}${selectField('Unidad','unit',units.map(unit=>[unit,unit]),variable.unit)}</div>${behavior}${values}</div>`;
    }).join('');
    return `<div class="inspector-section inventory-section"><div class="inspector-label">Variables del objeto <span class="count-pill">${(process.variables||[]).length}</span></div><div class="variable-add-grid">${[['pressure','P · Presión'],['temperature','T · Temperatura'],['flow','F · Caudal'],['level','L · Nivel']].map(([type,label])=>`<button class="variable-add" data-add-variable="${type}">＋ ${label}</button>`).join('')}</div>${rows||'<div class="inventory-empty">Añade una magnitud al objeto</div>'}</div>`;
  }
  function bindProcessInventory(process) {
    if(process.kind!=='process')return;
    inspector.querySelectorAll('[data-add-variable]').forEach(button=>button.addEventListener('click',()=>{
      process.variables.push(makeProcessVariable(process,button.dataset.addVariable));render();persist();
    }));
    inspector.querySelectorAll('[data-variable-id]').forEach(row=>{
      const variable=processVariableById(process,row.dataset.variableId);
      row.querySelectorAll('input,select').forEach(control=>{
        control.dataset.variableField=control.name;
        control.addEventListener('change',()=>{
          if(control.name==='tag'&&(!control.value.trim()||process.variables.some(item=>item.id!==variable.id&&item.tag===control.value.trim()))){
            toast('La etiqueta debe ser única dentro del objeto.');render();return;
          }
          const oldUnit=variable.unit;
          if(['value','startValue','targetValue','durationSeconds'].includes(control.name))variable[control.name]=Number(control.value);
          else variable[control.name]=control.name==='tag'?control.value.trim():control.value;
          if(control.name==='type'){
            variable.source=defaultVariableSource(process,variable.type);
            variable.unit=variable.source==='fill'?'%':unitOptions[variable.type][0];
            variable.trendMode='static';variable.value=0;variable.startValue=0;variable.targetValue=0;
            for(const card of state.nodes.filter(item=>item.kind==='variable'&&item.processVariableId===variable.id)){
              card.variableType=isSwitch(card)?`switch_${variable.type}`:variable.type;
              card.unit=variable.unit;
              card.thresholdUnit=variable.unit;
            }
          }
          if(control.name==='source'){
            variable.trendMode='static';
            if(variable.source==='fill')variable.unit='%';
          }
          if(control.name==='trendMode'){
            variable.startValue=Number(variable.value)||0;
            if(variable.trendMode==='rise'&&Number(variable.targetValue)<=variable.startValue)variable.targetValue=variable.startValue+100;
            if(variable.trendMode==='fall'&&Number(variable.targetValue)>=variable.startValue)variable.targetValue=variable.type==='temperature'?variable.startValue-100:Math.max(0,variable.startValue-100);
          }
          if(control.name==='startValue')variable.value=variable.startValue;
          if(control.name==='value'&&variable.trendMode==='static'){
            variable.startValue=variable.value;variable.targetValue=variable.value;
          }
          if(control.name==='unit'&&oldUnit!==variable.unit&&variable.source==='manual'){
            for(const key of ['value','startValue','targetValue'])variable[key]=convertResult({value:variable[key],unit:oldUnit},variable.unit)?.value??variable[key];
            for(const final of state.nodes.filter(item=>item.kind==='final'))for(const action of final.processActions||[]){
              if(action.processId!==process.id||action.variableId!==variable.id)continue;
              if(action.targetValue!==undefined)action.targetValue=convertResult({value:action.targetValue,unit:oldUnit},variable.unit)?.value??action.targetValue;
              if(action.rate!==undefined){
                const converted=convertResult({value:action.rate,unit:oldUnit},variable.unit);
                const zero=convertResult({value:0,unit:oldUnit},variable.unit);
                if(converted&&zero)action.rate=converted.value-zero.value;
              }
            }
          }
          render();persist();
        });
      });
    });
    inspector.querySelectorAll('[data-extract-variable]').forEach(button=>button.addEventListener('click',()=>{
      extractProcessVariable(process,processVariableById(process,button.dataset.extractVariable));
    }));
    inspector.querySelectorAll('[data-remove-variable]').forEach(button=>button.addEventListener('click',()=>{
      removeProcessVariable(process,button.dataset.removeVariable);
    }));
  }
  function extractProcessVariable(process,variable) {
    if(!variable)return;
    const count=state.nodes.filter(node=>node.kind==='variable'&&node.processId===process.id).length;
    const node={id:crypto.randomUUID(),kind:'variable',tag:`PV-${state.nodes.length+101}`,name:typeLabel(variable.type),
      x:process.x+300+(count%2)*35,y:Math.max(20,process.y-95+count*175),variableType:variable.type,
      processId:process.id,processVariableId:variable.id,fixed:false,value:variable.value,unit:variable.unit,
      switchDirection:'high',onThreshold:100,offThreshold:90,switchOn:false};
    state.nodes.push(node);
    state.edges.push({id:crypto.randomUUID(),from:process.id,to:node.id,fromSide:'right',toSide:'left',variableId:variable.id,medium:'hydraulic'});
    selectedId=node.id;render();persist();toast(`${variable.tag} extraída como tarjeta.`);
  }
  function removeProcessVariable(process,id) {
    const variable=processVariableById(process,id);
    if(!variable||!confirm(`¿Eliminar ${variable.tag} del objeto?`))return;
    const reading=new ProcessVariableSource(process,variable).read();
    process.variables=process.variables.filter(item=>item.id!==id);
    for(const final of state.nodes.filter(item=>item.kind==='final'))final.processActions=(final.processActions||[]).filter(action=>!(action.processId===process.id&&action.variableId===id));
    for(const card of state.nodes.filter(item=>item.kind==='variable'&&item.processVariableId===id)){
      card.processId='';card.processVariableId='';card.fixed=true;
      if(reading)card.value=reading.value;
    }
    state.edges=state.edges.filter(edge=>!(edge.from===process.id&&edge.variableId===id));
    render();persist();toast('Variable eliminada; sus tarjetas quedaron como valores de prueba.');
  }
  function fixedSection(node) {
    const switchMode=isSwitch(node);
    const type=magnitudeType(node);
    const available=node.kind==='controller'?['mA']:node.kind==='final'?['%']:(node.kind==='instrument'&&(node.instrumentType==='transmitter'||node.instrumentType==='sensor_transmitter'))?['mA']:[...(unitOptions[type]||['%'])];
    if(node.kind==='variable'&&node.variableType==='level'&&node.processId&&!node.fixed)available.splice(0,available.length,'%');
    const shownUnit=node.unit||available[0];
    const units=switchMode?'':selectField('Unidad de lectura','unit',available.map(unit=>[unit,unit]),available.includes(shownUnit)?shownUnit:available[0]);
    const fixedControl=switchMode?`<div class="field"><label>Estado fijo</label><select name="switchOn"><option value="true" ${node.switchOn?'selected':''}>ON</option><option value="false" ${!node.switchOn?'selected':''}>OFF</option></select></div>`:field('Valor fijo','value',node.value??0,'number');
    return `<div class="inspector-section"><div class="inspector-label">Valor de prueba</div><label class="check-field"><input type="checkbox" name="fixed" ${node.fixed?'checked':''}><span>Usar valor constante para esta tarjeta</span></label>${units}${node.fixed?fixedControl:`<div class="field-help">La tarjeta usa la entrada conectada o el valor calculado del proceso.</div>`}</div>`;
  }
  function instrumentSourceSection(node) {
    const edge=edgesIn(node.id)[0];
    const source=nodeById(edge?.from);
    if(source?.kind==='process') {
      const choices=(source.variables||[]).filter(variable=>variable.type===magnitudeType(node));
      return choices.length?selectField('Variable medida','edgeVariableId',[["",'Selecciona una variable'],...choices.map(variable=>[variable.id,`${variable.tag} · ${typeLabel(variable.type)}`])],choices.some(variable=>variable.id===edge.variableId)?edge.variableId:'')
        :'<div class="source-badge warning">Sin variable compatible en el objeto</div>';
    }
    if(source) {
      const matching=source.kind==='variable'||source.kind==='instrument'?magnitudeType(source)===magnitudeType(node):true;
      return `<div class="source-badge${matching?'':' warning'}">${matching?'↘':'!'} ${escapeHtml(source.tag)} · ${matching?'Fuente conectada':'Magnitud incompatible'}</div>`;
    }
    return '<div class="source-badge muted">○ Sin fuente conectada</div>';
  }
  function switchSection(node) {
    const units=unitOptions[magnitudeType(node)]||['%'];
    const direction=node.switchDirection||(node.comparison==='less'?'low':'high');
    const on=node.onThreshold??node.threshold??0,off=node.offThreshold??node.threshold??0;
    return `<div class="inspector-section switch-section"><div class="inspector-label">Contacto ON / OFF</div>${selectField('Actuar cuando la magnitud','switchDirection',[['high','Sube'],['low','Baja']],direction)}${selectField('Unidad de umbral','thresholdUnit',units.map(unit=>[unit,unit]),node.thresholdUnit||node.unit||units[0])}<div class="switch-thresholds"><div class="switch-limit on"><span>● ON</span>${field(direction==='low'?'Al bajar hasta':'Al subir hasta','onThreshold',on,'number')}</div><div class="switch-limit off"><span>○ OFF</span>${field(direction==='low'?'Al subir hasta':'Al bajar hasta','offThreshold',off,'number')}</div></div></div>`;
  }
  function calibrationSection(node) {
    const units = unitOptions[magnitudeType(node)] || ['%'];
    const selected = node.calibrationInputUnit || units[0];
    return `<div class="inspector-section"><div class="inspector-label">Calibración de salida</div><div class="field-help">La entrada se escala a una salida normalizada de corriente.</div><div class="field-row">${field('Entrada mínima','calibrationInputLow',node.calibrationInputLow??0,'number')}${field('Entrada máxima','calibrationInputHigh',node.calibrationInputHigh??100,'number')}</div>${selectField('Unidad de entrada','calibrationInputUnit',units.map(unit=>[unit,unit]),selected)}<div class="field-row">${field('Salida mínima (mA)','calibrationOutputLow',node.calibrationOutputLow??4,'number')}${field('Salida máxima (mA)','calibrationOutputHigh',node.calibrationOutputHigh??20,'number')}</div></div>`;
  }
  function controllerTranslationSection(node) {
    return `<div class="inspector-section"><div class="inspector-label">mA de entrada → mA de salida</div><div class="field-row">${field('Entrada mínima','inputLow',node.inputLow??4,'number')}${field('Entrada máxima','inputHigh',node.inputHigh??20,'number')}</div><div class="field-row">${field('Salida mínima','outputLow',node.outputLow??4,'number')}${field('Salida máxima','outputHigh',node.outputHigh??20,'number')}</div></div>`;
  }
  function controllerCurrentSwitchSection(node) {
    return `<div class="inspector-section"><div class="inspector-label">Decisión por corriente</div>${selectField('Actuar cuando la corriente','switchDirection',[['high','Sube'],['low','Baja']],node.switchDirection||'high')}<div class="field-row">${field('ON desde (mA)','onCurrent',node.onCurrent??15.2,'number')}${field('OFF desde (mA)','offCurrent',node.offCurrent??9.76,'number')}</div><div class="field-row">${field('Orden ON (mA)','activeOutput',node.activeOutput??20,'number')}${field('Orden OFF (mA)','inactiveOutput',node.inactiveOutput??4,'number')}</div></div>`;
  }
  function processActionsSection(final) {
    const processes=edgesOut(final.id).map(edge=>nodeById(edge.to)).filter(node=>node?.kind==='process');
    const choices=processes.flatMap(process=>[
      ...(process.simulationMode==='volume'?[[`${process.id}|__fill__`,`${process.tag} / Llenado · %`]]:[]),
      ...(process.variables||[]).filter(variable=>variable.source==='manual').map(variable=>[`${process.id}|${variable.id}`,`${process.tag} / ${variable.tag} · ${typeLabel(variable.type)}`])
    ]);
    if(!processes.length)return '<div class="inspector-section"><div class="source-badge muted">○ Conecta la válvula a un objeto</div></div>';
    if(!choices.length)return '<div class="inspector-section"><div class="source-badge muted">○ Añade variables al objeto conectado</div></div>';
    const rows=(final.processActions||[]).map((action,index)=>{
      const selected=`${action.processId||processes[0].id}|${action.variableId}`;
      const process=processes.find(item=>item.id===action.processId);
      const unit=action.variableId==='__fill__'?'%':process?.variables?.find(item=>item.id===action.variableId)?.unit||'';
      const targetChoices=choices.some(([id])=>id===selected)?choices:[['','Selecciona destino'],...choices];
      return `<div class="action-row" data-action-id="${escapeHtml(action.id)}"><div class="action-head"><strong>Orden ${index+1}</strong><button class="mini-action remove" data-remove-action="${escapeHtml(action.id)}" title="Eliminar orden">×</button></div>${selectField('Variable afectada','actionTarget',targetChoices,selected)}<div class="field-row">${selectField('Cuando la válvula','when',[['open','Abre'],['closed','Cierra']],action.when||'open')}${selectField('Efecto','effect',[['decrease','Bajar'],['increase','Subir'],['set','Fijar']],action.effect||'decrease')}</div>${action.effect==='set'?field(`Fijar en (${unit})`,'targetValue',action.targetValue??0,'number'):field(`Cambio (${unit}/s)`,'rate',action.rate??0,'number')}</div>`;
    }).join('');
    return `<div class="inspector-section"><div class="inspector-label">Órdenes al objeto conectado</div><div class="source-badge">↘ ${processes.map(process=>escapeHtml(process.tag)).join(' · ')} · ${choices.length} destinos</div><div class="signal-map"><span>0 % cerrada</span><span>100 % abierta</span></div>${rows}<button class="add-action" id="add-process-action">＋ Añadir acción</button></div>`;
  }
  function bindProcessActions(final) {
    if(final.kind!=='final')return;
    inspector.querySelector('#add-process-action')?.addEventListener('click',()=>{
      const process=edgesOut(final.id).map(edge=>nodeById(edge.to)).find(node=>node?.kind==='process'&&(node.simulationMode==='volume'||node.variables?.some(variable=>variable.source==='manual')));
      if(!process)return;
      const variable=process.variables?.find(item=>item.source==='manual');
      final.processActions ||= [];
      final.processActions.push({id:crypto.randomUUID(),processId:process.id,variableId:variable?.id||'__fill__',when:'open',effect:'decrease',rate:10});
      render();persist();
    });
    inspector.querySelectorAll('[data-action-id]').forEach(row=>{
      const action=final.processActions?.find(item=>item.id===row.dataset.actionId);
      if(!action)return;
      row.querySelectorAll('input,select').forEach(control=>{
        control.dataset.actionField=control.name;
        control.addEventListener('change',()=>{
          if(control.name==='actionTarget'){
            if(!control.value)return;
            [action.processId,action.variableId]=control.value.split('|');
          } else if(control.name==='rate'||control.name==='targetValue')action[control.name]=Number(control.value);
          else action[control.name]=control.value;
          render();persist();
        });
      });
    });
    inspector.querySelectorAll('[data-remove-action]').forEach(button=>button.addEventListener('click',()=>{
      final.processActions=final.processActions.filter(item=>item.id!==button.dataset.removeAction);
      render();persist();
    }));
  }
  function processActuationText(node) {
    const action=processControlInputs(node);
    const inlet=action.inletConnected?`entrada ${action.inletOpening.toFixed(0)} % abierta`:'entrada libre';
    const outlet=action.outletConnected?`salida ${action.outletOpening.toFixed(0)} % abierta`:'salida sin válvula';
    return `${inlet} · ${outlet}`;
  }
  function calculatedProcess(node) {
    const action=processControlInputs(node);
    const inlet=(Number(node.inflow)||0)*action.inletOpening/100;
    const outlet=(Number(node.outflow)||0)*(action.outletConnected?action.outletOpening/100:1);
    return `<div class="calculated-box"><span>Contenido actual · ${Number(node.capacity||0).toFixed(1)} m³ capacidad</span><b>${(Number(node.capacity||0)*processFill(node)/100).toFixed(2)} m³ · ${processFill(node).toFixed(1)} % lleno</b><span class="actuation-readout" style="margin-top:6px">Entrada efectiva ${inlet.toFixed(2)} · salida efectiva ${outlet.toFixed(2)} m³/h</span></div>`;
  }
  function deleteNode(id) {
    const target=nodeById(id);
    if(target?.kind==='process')for(const final of state.nodes.filter(node=>node.kind==='final'))final.processActions=(final.processActions||[]).filter(action=>action.processId!==id);
    if(target?.kind==='process')for(const card of state.nodes.filter(node=>node.kind==='variable'&&node.processId===id)){
      const reading=processVariableReading(card);
      card.processId='';card.processVariableId='';card.fixed=true;
      if(reading?.value!==undefined)card.value=reading.value;
    }
    state.nodes=state.nodes.filter(node=>node.id!==id);
    state.edges=state.edges.filter(edge=>edge.from!==id&&edge.to!==id);
    for(const node of state.nodes){if(node.processId===id){node.processId='';node.processVariableId='';}if(node.flowVariableId===id)node.flowVariableId='';}
    selectedId=null;render();persist();toast('Tarjeta eliminada.');
  }
  function addNode(kind) {
    const index=state.nodes.length;
    const node={id:crypto.randomUUID(),kind,tag:`${({process:'PR',variable:'PV',instrument:'I',controller:'C',final:'FE'})[kind]}-${String(index+101).padStart(3,'0')}`,name:kinds[kind].label,x:75+(index%4)*270,y:75+Math.floor(index/4)*190,fixed:false,value:0,unit:'%'};
    if(kind==='process')Object.assign(node,{subtype:'Tanque',name:'Nuevo tanque',simulationMode:'variables',capacity:10,fill:0,inflow:0,outflow:0,variables:[]});
    if(kind==='variable')Object.assign(node,{name:'Nueva variable',variableType:'pressure',processId:'',processVariableId:'',value:100,unit:'kPa',fixed:true,thresholdUnit:'kPa',onThreshold:100,offThreshold:90,switchDirection:'high',switchOn:false});
    if(kind==='instrument')Object.assign(node,{name:'Nuevo instrumento',instrumentType:'sensor',measurement:'pressure',integrated:false,value:100,unit:'kPa',fixed:false,switchOn:false,switchDirection:'high',onThreshold:100,offThreshold:90,thresholdUnit:'kPa',calibrationInputLow:0,calibrationInputHigh:100,calibrationInputUnit:'kPa',calibrationOutputLow:4,calibrationOutputHigh:20});
    if(kind==='controller')Object.assign(node,{name:'Nuevo controlador',value:12,unit:'mA',fixed:false,controlMode:'progressive',inputLow:4,inputHigh:20,outputLow:4,outputHigh:20,onCurrent:15.2,offCurrent:9.76,activeOutput:20,inactiveOutput:4,active:false});
    if(kind==='final')Object.assign(node,{name:'Nuevo elemento final',value:0,unit:'%',fixed:false,processRole:'outlet',processActions:[]});
    state.nodes.push(node);selectedId=node.id;inspectorPage='home';render();persist();toast(`${kinds[kind].label} añadida al diagrama.`);
  }

  document.querySelectorAll('[data-create]').forEach(button=>button.addEventListener('click',()=>addNode(button.dataset.create)));
  function addPressureExample(role) {
    const inlet=role==='inlet';
    const suffix=String(state.nodes.length+101);
    const baseY=state.nodes.length ? Math.max(...state.nodes.map(node=>Number(node.y)||0))+270 : 250;
    const ids=Array.from({length:5},()=>crypto.randomUUID());
    const pressureId=crypto.randomUUID();
    const nodes=[
      {id:ids[0],kind:'process',subtype:'Línea de proceso',tag:`PL-${suffix}`,name:'Línea de proceso',x:95,y:baseY,simulationMode:'variables',fixed:false,capacity:10,fill:0,inflow:0,outflow:0,variables:[
        {id:pressureId,tag:`P-${suffix}`,type:'pressure',unit:'kPa',source:'manual',trendMode:'rise',value:100,startValue:100,targetValue:500,durationSeconds:10},
        {id:crypto.randomUUID(),tag:`T-${suffix}`,type:'temperature',unit:'°C',source:'manual',trendMode:'static',value:28,startValue:28,targetValue:28,durationSeconds:10}
      ]},
      {id:ids[1],kind:'variable',tag:`PV-${suffix}`,name:'Presión de línea',x:460,y:baseY-178,variableType:'pressure',processId:ids[0],processVariableId:pressureId,fixed:false,value:100,unit:'kPa'},
      {id:ids[2],kind:'instrument',tag:`PT-${suffix}`,name:'Transmisor de presión',x:850,y:baseY-150,instrumentType:'sensor_transmitter',measurement:'pressure',integrated:true,fixed:false,value:4,unit:'mA',calibrationInputLow:0,calibrationInputHigh:500,calibrationInputUnit:'kPa',calibrationOutputLow:4,calibrationOutputHigh:20},
      {id:ids[3],kind:'controller',tag:`PIC-${suffix}`,name:'Controlador 4–20 mA',x:850,y:baseY+240,fixed:false,value:inlet?20:4,unit:'mA',controlMode:'on_off',onCurrent:15.2,offCurrent:9.76,activeOutput:inlet?4:20,inactiveOutput:inlet?20:4,active:false,inputLow:4,inputHigh:20,outputLow:4,outputHigh:20},
      {id:ids[4],kind:'final',tag:`PCV-${suffix}`,name:inlet?'Válvula de entrada':'Válvula de descarga',x:460,y:baseY+285,fixed:false,value:inlet?100:0,unit:'%',processRole:role,processActions:[{id:crypto.randomUUID(),processId:ids[0],variableId:pressureId,when:inlet?'closed':'open',effect:'decrease',rate:116}]}
    ];
    const pairs=[[0,1,'hydraulic','top','left'],[1,2,'electrical','right','left'],[2,3,'electrical','bottom','top'],[3,4,'electrical','left','right'],[4,0,'mechanical','left','bottom']];
    state.nodes.push(...nodes);
    state.edges.push(...pairs.map(([from,to,medium,fromSide,toSide])=>({id:crypto.randomUUID(),from:ids[from],to:ids[to],medium,fromSide,toSide,...(from===0?{variableId:pressureId}:{})})));
    selectedId=ids[0];inspectorPage='home';render();persist();
    requestAnimationFrame(()=>fitCanvas(nodes));
    toast(`Lazo de ${inlet?'cierre de entrada':'apertura de salida'} añadido. Inicia la simulación.`);
  }
  document.querySelector('#add-pressure-example').addEventListener('click',()=>addPressureExample('outlet'));
  document.querySelector('#add-inlet-example').addEventListener('click',()=>addPressureExample('inlet'));
  document.querySelector('#save-button').addEventListener('click',()=>persist(true));
  document.querySelector('#export-button').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='instrumentalab-diagrama.json';a.click();URL.revokeObjectURL(url);toast('Copia del diagrama descargada.');
  });
  document.querySelector('#import-button').addEventListener('click',()=>document.querySelector('#import-file').click());
  document.querySelector('#import-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{const candidate=JSON.parse(await file.text());if(!Array.isArray(candidate.nodes)||!Array.isArray(candidate.edges))throw new Error();state=normalizeState(candidate);selectedId=null;render();persist();toast('Diagrama importado.');}
    catch{toast('El archivo no contiene un diagrama válido.');}event.target.value='';
  });
  document.querySelector('#clear-board').addEventListener('click',()=>{if(!confirm('¿Crear un diagrama nuevo? Esto reemplazará el diagrama guardado en este navegador.'))return;stopSimulation();state={nodes:[],edges:[],elapsedSeconds:0};selectedId=null;pendingFrom=null;showEmptyInspector();render();persist();toast('Diagrama nuevo creado.');});
  document.querySelector('#simulate').addEventListener('click',()=>{
    if (simulationTimer) stopSimulation(); else startSimulation();
  });
  document.querySelector('#reset-scenario').addEventListener('click',()=>{
    for(const node of state.nodes){
      if(node.kind==='process')for(const variable of node.variables||[])new VariableTrend(variable).reset();
      if(node.kind==='controller'&&node.controlMode==='on_off')node.active=false;
    }
    state.elapsedSeconds=0;refreshLiveValues();persist();toast('Tendencias reiniciadas.');
  });
  function startSimulation() {
    simulationLastTime = performance.now();
    simulationTimer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, (now - simulationLastTime) / 1000);
      simulationLastTime = now;
      advanceSimulation(elapsed);
    }, 1000);
    document.querySelector('#simulate').innerHTML = '<span>■</span> Detener simulación';
    document.querySelector('#status-message').textContent = 'Simulación en tiempo real · 1 s';
    toast('Simulación iniciada: cada segundo real actualiza el proceso.');
  }
  function stopSimulation() {
    if (simulationTimer) clearInterval(simulationTimer);
    simulationTimer = null;
    simulationLastTime = null;
    document.querySelector('#simulate').innerHTML = '<span>▶</span> Iniciar simulación';
    document.querySelector('#status-message').textContent = 'Simulación detenida';
  }
  function advanceSimulation(seconds) {
    state.elapsedSeconds = (state.elapsedSeconds || 0) + seconds;
    const processes=state.nodes.filter(node=>node.kind==='process');
    const actuationAtStart=new Map(processes.map(process=>[process.id,processControlInputs(process)]));
    const finalAtStart=new Map(state.nodes.filter(node=>node.kind==='final').map(final=>[final.id,valueOf(final)?.value]));
    for (const process of processes) {
      const actuation=actuationAtStart.get(process.id);
      for(const variable of process.variables||[])new VariableTrend(variable).advance(seconds);
      if(process.simulationMode==='volume') {
        let inputFlow = Number(process.inflow) || 0;
        const flowInput = edgesIn(process.id).map(edge => nodeById(edge.from)).find(node => node && magnitudeType(node) === 'flow' && node.kind === 'variable');
        if (flowInput) {
          const result = valueOf(flowInput);
          if (result?.value != null) inputFlow = toM3PerHour(Number(result.value), result.unit);
        }
        inputFlow*=actuation.inletOpening/100;
        const outputFlow=(Number(process.outflow)||0)*(actuation.outletConnected?actuation.outletOpening/100:1);
        const delta = ((inputFlow - outputFlow) * seconds / 3600) / (Number(process.capacity) || 1) * 100;
        if (!process.fixed) process.fill = Math.max(0, Math.min(100, (Number(process.fill) || 0) + delta));
      }
      for(const edge of edgesIn(process.id)){
        const final=nodeById(edge.from);
        if(final?.kind!=='final')continue;
        const opening=finalAtStart.get(final.id);
        if(opening===undefined)continue;
        for(const action of final.processActions||[])new ProcessAction(process,action).apply(opening,seconds);
      }
    }
    refreshLiveValues();
    persist();
  }
  function refreshLiveValues() {
    for(const node of state.nodes) {
      const element=Array.from(canvas.querySelectorAll('.node')).find(card=>card.dataset.id===node.id);
      if(!element)continue;
      const result=currentValue(node);
      element.querySelector('.node-summary').textContent=descriptor(node);
      element.querySelector('.node-visual').innerHTML=cardVisual(node,result);
      element.querySelector('.node-value').textContent=node.kind==='process'&&node.simulationMode!=='volume'?`${(node.variables||[]).length} variables`:formatValue(result);
      element.querySelector('.node-state').lastChild.textContent=node.kind==='process'?' Objeto con variables':result?.on!==undefined?' Estado discreto':result?' Valor disponible':' Esperando entrada';
    }
    const selected=nodeById(selectedId);
    if(selected?.kind==='process') {
      inspector.querySelectorAll('.object-variable').forEach(row=>{
        const variable=processVariableById(selected,row.dataset.variableId);
        const output=row.querySelector('.object-variable-reading');
        if(variable&&output)output.textContent=formatValue(new ProcessVariableSource(selected,variable).read());
        const currentField=row.querySelector('input[name="value"]');
        if(variable&&currentField&&document.activeElement!==currentField)currentField.value=String(variable.value);
      });
      const display=inspector.querySelector('.calculated-box b');
      const actuationDisplay=inspector.querySelector('.actuation-readout');
      if(selected.simulationMode==='volume') {
        if(display)display.textContent=`${((Number(selected.capacity)||0)*processFill(selected)/100).toFixed(2)} m³ · ${processFill(selected).toFixed(1)} % lleno`;
        if(actuationDisplay) {
          const action=processControlInputs(selected);
          const inlet=(Number(selected.inflow)||0)*action.inletOpening/100;
          const outlet=(Number(selected.outflow)||0)*(action.outletConnected?action.outletOpening/100:1);
          actuationDisplay.textContent=`Entrada efectiva ${inlet.toFixed(2)} · salida efectiva ${outlet.toFixed(2)} m³/h`;
        }
      }
    }
    if(simulationTimer)document.querySelector('#status-message').textContent=`Simulación · ${Math.floor(state.elapsedSeconds)} s reales`;
  }
  document.querySelector('#zoom-in').addEventListener('click',()=>setZoom(Math.min(1.4,zoom+.1)));
  document.querySelector('#zoom-out').addEventListener('click',()=>setZoom(Math.max(.6,zoom-.1)));
  document.querySelector('#fit-canvas').addEventListener('click',()=>fitCanvas());
  function setZoom(value){zoom=value;canvas.style.transform=`scale(${zoom})`;document.querySelector('#zoom-label').textContent=`${Math.round(zoom*100)}%`;}
  function fitCanvas(nodes=state.nodes){
    if(!nodes.length){setZoom(1);viewport.scrollTo({left:0,top:0});return;}
    const minX=Math.min(...nodes.map(node=>Number(node.x)||0));
    const minY=Math.min(...nodes.map(node=>Number(node.y)||0));
    const maxX=Math.max(...nodes.map(node=>(Number(node.x)||0)+250));
    const maxY=Math.max(...nodes.map(node=>{
      const card=Array.from(canvas.querySelectorAll('.node')).find(element=>element.dataset.id===node.id);
      return (Number(node.y)||0)+(card?.offsetHeight||180);
    }));
    const factor=Math.min(1,Math.max(.35,Math.min((viewport.clientWidth-36)/(maxX-minX+36),(viewport.clientHeight-36)/(maxY-minY+36))));
    setZoom(factor);
    viewport.scrollTo({left:Math.max(0,minX*factor-18),top:Math.max(0,minY*factor-18),behavior:'smooth'});
  }
  function applyTheme(theme) {
    const dark=theme==='dark';
    document.body.dataset.theme=dark?'dark':'light';
    const button=document.querySelector('#theme-toggle');
    button.textContent=dark?'☀':'☾';
    button.setAttribute('aria-label',dark?'Activar modo claro':'Activar modo oscuro');
    button.title=dark?'Activar modo claro':'Activar modo oscuro';
  }
  const savedTheme=localStorage.getItem(THEME_KEY);
  applyTheme(savedTheme||'light');
  document.querySelector('#theme-toggle').addEventListener('click',()=>{
    const next=document.body.dataset.theme==='dark'?'light':'dark';
    localStorage.setItem(THEME_KEY,next);
    applyTheme(next);
  });

  render();
  if(!localStorage.getItem(STORAGE_KEY))requestAnimationFrame(fitCanvas);
  if(!localStorage.getItem(STORAGE_KEY))persist();
})();
