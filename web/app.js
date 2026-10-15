(() => {
  'use strict';
  const D=globalThis.InstrumentaDiagnostics;
  const KEY='instrumentalab.field-verification.v1';
  const TYPES={pressure:'Presión',temperature:'Temperatura',level:'Nivel',flow:'Caudal'};
  const ICONS=[['compressor','Compresor'],['pump','Bomba'],['motor','Motor'],['tank','Tanque'],['valve','Válvula'],['process','Proceso'],['oil','Lubricación'],['seal','Sellos'],['gear','Engranaje']];
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const format=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))
    ?new Intl.NumberFormat('es-VE',{maximumFractionDigits:2}).format(Number(value)):'—';
  const choices=(values,current)=>values.map(value=>'<option value="'+escape(value)+'"'+(value===current?' selected':'')+'>'+escape(value)+'</option>').join('');

  class FieldApp {
    constructor(){
      this.app=document.getElementById('app');
      this.toast=document.getElementById('toast');
      let saved=null;
      try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch(_){}
      this.equipments=Array.isArray(saved?.equipments)&&saved.equipments.length
        ?saved.equipments.map(item=>new D.Equipment(item)):[];
      for(const item of this.equipments){
        item.unitNumber=['12','16'].includes(String(item.unitNumber))?String(item.unitNumber):
          (String(item.tag).startsWith('16-')?'16':'12');
      }
      for(const [unit,tag] of [['12','12-K-001'],['16','16-K-006A']]){
        if(this.equipments.some(item=>item.tag===tag))continue;
        const item=D.createCompressorTemplate();item.unitNumber=unit;item.tag=tag;
        item.name='Compresor';item.unit=unit;item.service='Gas de proceso · ejemplo';
        this.equipments.push(item);
      }
      if(!this.equipments.length){const item=D.createCompressorTemplate();item.unitNumber='12';item.tag='12-K-001';this.equipments.push(item);}
      this.unitNumber=['12','16'].includes(String(saved?.unitNumber))?String(saved.unitNumber):
        (this.equipments.find(item=>item.id===saved?.equipmentId)?.unitNumber||'12');
      this.equipmentId=this.equipments.some(item=>item.id===saved?.equipmentId&&item.unitNumber===this.unitNumber)
        ?saved.equipmentId:(this.equipments.find(item=>item.unitNumber===this.unitNumber)?.id||this.equipments[0].id);
      this.systemId=saved?.systemId||null;
      this.mode=saved?.mode==='creator'?'creator':'field';
      this.fieldView='home';
      this.variableId=null;
      this.creatorView='home';
      this.creatorVariableId=null;
      this.readings=saved?.readings&&typeof saved.readings==='object'?saved.readings:{};
      this.results=saved?.results&&typeof saved.results==='object'?saved.results:{};
      this.findings={};
      this.drafts={};
      this.openIconPicker=null;
      this.app.addEventListener('click',event=>this.click(event));
      document.querySelector('.mode-tabs').addEventListener('click',event=>this.click(event));
      this.app.addEventListener('change',event=>this.change(event));
      this.app.addEventListener('input',event=>this.input(event));
      this.render();
    }
    equipment(){return this.equipments.find(item=>item.id===this.equipmentId)||this.equipments[0];}
    system(){
      const equipment=this.equipment();
      const system=equipment.systems.find(item=>item.id===this.systemId)||equipment.systems[0]||null;
      this.systemId=system?.id||null;
      return system;
    }
    records(equipment=this.equipment()){
      this.readings[equipment.id]??={};
      return this.readings[equipment.id];
    }
    persist(){
      try{localStorage.setItem(KEY,JSON.stringify({
        mode:this.mode,equipmentId:this.equipmentId,unitNumber:this.unitNumber,systemId:this.systemId,results:this.results,
        equipments:this.equipments.map(item=>item.toJSON()),readings:this.readings
      }));}catch(_){this.notify('No se pudo guardar en este navegador');}
    }
    notify(text){
      this.toast.textContent=text;
      this.toast.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer=setTimeout(()=>this.toast.classList.remove('show'),3500);
    }
    iconImage(key,extra=''){
      const selected=ICONS.some(([id])=>id===key)?key:'process';
      return '<img class="icon-svg '+extra+'" src="./icons/'+selected+'.svg" alt="" aria-hidden="true">';
    }
    iconPicker(scope,id,selected){
      const pickerId=scope+':'+id,open=this.openIconPicker===pickerId;
      const options=open?'<div class="icon-picker-options" role="group" aria-label="Seleccionar icono">'+ICONS.map(([key,label])=>
        '<button type="button" class="icon-option'+(key===selected?' selected':'')+'" title="'+label+'" aria-label="'+label+
        '" data-action="choose-icon" data-scope="'+scope+'" data-id="'+escape(id)+'" data-icon="'+key+'">'+this.iconImage(key)+'</button>').join('')+'</div>':'';
      return '<div class="icon-picker"><button type="button" class="icon-picker-toggle" data-action="toggle-icon-picker" data-scope="'+scope+
        '" data-id="'+escape(id)+'">'+this.iconImage(selected)+'<span>Cambiar icono</span><span aria-hidden="true">'+(open?'⌃':'⌄')+'</span></button>'+options+'</div>';
    }
    variableTile(variable,index,record,result){
      const draft=this.drafts[variable.id],value=draft?.value??record?.value??'';
      const unit=draft?.unit??record?.unit??variable.unit;
      const units=D.TYPE_UNITS[variable.type].filter(candidate=>D.UnitConverter.compatible(candidate,variable.unit));
      const status=result?.results.find(entry=>entry.variableId===variable.id);
      return '<article class="square-tile instrument-tile'+(status?' '+status.status:'')+'" data-variable="'+escape(variable.id)+'">'+
        '<span class="tile-index">'+String(index+1).padStart(2,'0')+'</span><strong>'+escape(variable.tag)+'</strong><small>'+escape(variable.name)+
        '</small><div class="instrument-reading"><input aria-label="Valor observado '+escape(variable.tag)+'" type="text" inputmode="decimal" enterkeyhint="decimal" data-read="value" value="'+escape(value)+'" placeholder="Valor">'+
        '<select aria-label="Unidad '+escape(variable.tag)+'" data-read="unit">'+choices(units,unit)+'</select></div>'+
        '<span class="tile-reading'+(status?' '+status.status:'')+'">'+(status?this.findingLabel(status,variable,record):'')+'</span></article>';
    }
    systemRollup(result){
      if(!result||result.status==='pending')return {status:'',label:''};
      if(result.counts.warning>0)return {status:'warning',label:'⚠ Alerta'};
      if(result.counts.alarm>0)return {status:'warning',label:'⚠ Advertencia'};
      return {status:'normal',label:'✓ Conforme'};
    }
    equipmentLevelErrors(equipment=this.equipment()){
      const variableErrors=new Set(equipment.systems.flatMap(system=>system.variables.flatMap(variable=>variable.validate())));
      const seen=new Set();
      for(const system of equipment.systems)for(const variable of system.variables){
        const tag=variable.tag.trim().toLowerCase();
        if(tag&&seen.has(tag))variableErrors.add('Etiqueta repetida: '+variable.tag);
        if(tag)seen.add(tag);
      }
      return equipment.validate().filter(error=>!variableErrors.has(error));
    }
    invalidate(equipment=this.equipment()){
      equipment.revokeApproval();
      delete this.readings[equipment.id];
      for(const system of equipment.systems){
        delete this.results[system.id];
        for(const variable of system.variables)delete this.findings[variable.id];
      }
      this.drafts={};
      this.persist();
    }
    findingLabel(finding,variable,record=null){
      const reading=record?format(record.value)+' '+record.unit:format(finding.observed)+' '+variable.unit;
      if(finding.status==='normal')return '✓ Conforme · '+reading;
      if(finding.status==='warning'){
        const deviates=variable.rule!=='range'&&finding.percentDifference!==null&&Math.abs(finding.percentDifference)>variable.maxDeviationPercent;
        const ideal=variable.rule==='range'?'Rango ideal '+format(variable.min)+'–'+format(variable.max)+' '+variable.unit:
          'Valor ideal '+format(variable.normal)+' '+variable.unit;
        return deviates?'⚠ '+ideal+' · excede '+format(variable.maxDeviationPercent)+'% de desviación máxima permitida':
          variable.rule==='range'?'⚠ Fuera del '+ideal+' · lectura '+reading:'⚠ Advertencia · '+ideal+' · lectura '+reading;
      }
      const low=variable.rule!=='maximum'&&finding.observed<=Number(variable.alarmMin);
      const threshold=low?variable.alarmMin:variable.alarmMax;
      return '⛔ Valor en alarma '+(low?'baja; menor o igual a ':'alta; mayor o igual a ')+format(threshold)+' '+variable.unit+' · lectura '+reading;
    }
    picker(){
      return '<label class="equipment-picker"><span>Equipo</span><select id="equipment-select">'+
        this.equipments.map(item=>'<option value="'+escape(item.id)+'"'+(item.id===this.equipmentId?' selected':'')+'>'+
          escape((item.tag||'Sin tag')+' · '+(item.name||'Nuevo equipo'))+'</option>').join('')+'</select></label>';
    }
    units(){
      return '<div class="unit-selector" role="group" aria-label="Unidad">'+['12','16'].map(unit=>
        '<button class="unit-button'+(this.unitNumber===unit?' active':'')+'" data-action="select-unit" data-unit="'+unit+'">'+unit+'</button>').join('')+'</div>';
    }
    equipmentTiles(action){
      const items=this.equipments.filter(item=>item.unitNumber===this.unitNumber);
      return '<div class="equipment-grid">'+items.map(item=>'<button class="equipment-tile'+
        (item.id===this.equipmentId?' selected':'')+'" data-action="'+action+'" data-id="'+escape(item.id)+'">'+this.iconImage(item.icon,'tile-icon')+'<span class="tile-tag">'+
        escape(item.tag||'SIN TAG')+'</span><strong>'+escape(item.name||'Equipo sin nombre')+'</strong><small>'+escape(item.service||'Servicio sin definir')+
        '</small></button>').join('')+(action==='edit-equipment'?'<button class="equipment-tile add-tile" data-action="new-equipment"><span>＋</span><strong>Agregar equipo</strong></button>':'')+
        '</div>';
    }
    systems(equipment,creator=false){
      const records=this.records(equipment);
      return '<div class="system-nav" role="tablist" aria-label="Sistemas críticos">'+
        equipment.systems.map(system=>{
          const count=system.variables.filter(variable=>records[variable.id]).length;
          const result=!creator?this.results[system.id]:null;
          const complete=!creator&&count>0&&count===system.variables.length;
          const status=result?.status||'';
          const tab='<button type="button" role="tab" aria-selected="'+(system.id===this.systemId)+
            '" class="system-tab'+(system.id===this.systemId?' active':'')+(complete?' complete':'')+(status?' '+status:'')+
            '" data-action="select-system" data-id="'+escape(system.id)+'">'+this.iconImage(system.icon,'system-icon')+
            '<span>'+escape(system.name)+'</span><small>'+
            (creator?system.variables.length+' variables':(result?(status==='normal'?'✓ Conforme':status==='warning'?'⚠ Advertencia':status==='alarm'?'⛔ Alarma':'Pendiente')+' · ':'')+count+' de '+system.variables.length+' lecturas')+
            '</small></button>';
          return creator?'<div class="system-card-editor">'+tab+'</div>':tab;
        }).join('')+
        (creator?'<button class="system-tab add-system" data-action="add-system">＋ <span>Agregar sistema</span></button>':'')+
        '</div>';
    }
    reference(variable){
      let limits='';
      if(variable.rule==='range')limits='Rango '+format(variable.min)+'–'+format(variable.max)+' '+escape(variable.unit)+
        ' · Alarma ≤'+format(variable.alarmMin)+' / ≥'+format(variable.alarmMax);
      if(variable.rule==='minimum')limits='Mínimo '+format(variable.min)+' '+escape(variable.unit)+' · Alarma ≤'+format(variable.alarmMin);
      if(variable.rule==='maximum')limits='Máximo '+format(variable.max)+' '+escape(variable.unit)+' · Alarma ≥'+format(variable.alarmMax);
      return '<div class="reference">Normal: <strong>'+format(variable.normal)+' '+escape(variable.unit)+'</strong><small>'+limits+' · Advertencia por desviación > ±'+format(variable.maxDeviationPercent)+'%</small></div>';
    }
    row(variable,record,result,approved){
      const draft=this.drafts[variable.id];
      const value=draft?.value??record?.value??'';
      const unit=draft?.unit??record?.unit??variable.unit;
      const units=D.TYPE_UNITS[variable.type].filter(candidate=>D.UnitConverter.compatible(candidate,variable.unit));
      const difference=result?'<div class="assessment '+result.status+'"><strong>'+STATUS[result.status]+'</strong><span>Desviación: '+
        (result.difference>=0?'+':'')+format(result.difference)+' '+escape(result.unit)+
        (result.percentDifference===null?'':' · '+(result.percentDifference>=0?'+':'')+format(result.percentDifference)+'%')+'</span></div>':'';
      return '<article class="reading-row" data-variable="'+escape(variable.id)+'"><div class="reading-controls"><label><span>Valor observado</span><input type="text" inputmode="decimal" enterkeyhint="decimal" data-read="value" value="'+
        escape(value)+'" placeholder="0,0"></label><label><span>Unidad</span><select data-read="unit">'+choices(units,unit)+
        '</select></label></div>'+
        (record&&approved?this.reference(variable):'<div class="reference-hidden">◌ '+
          (record?'Referencia pendiente de validar en el Creador':'Referencia oculta hasta registrar la lectura')+'</div>')+
        difference+'</article>';
    }
    field(){
      const equipment=this.equipment(),system=this.system(),records=this.records(equipment);
      if(equipment.approved&&system)for(const item of system.variables){
        const saved=records[item.id];
        if(saved&&!this.findings[item.id])try{this.findings[item.id]=item.assess(saved.value,saved.unit,item.maxDeviationPercent);}catch(_){}
      }
      const count=system?system.variables.filter(variable=>records[variable.id]).length:0;
      const result=system?this.results[system.id]:null;
      const variable=system?.variables.find(item=>item.id===this.variableId)||system?.variables[0];
      const back=this.fieldView==='reading'?'variables':this.fieldView==='variables'?'systems':this.fieldView==='systems'?'home':null;
      let content='';
      if(this.fieldView==='home'){
        content='<div class="unit-picker">'+this.units()+'</div><div class="screen-title"><div><h1>Equipos</h1></div></div>'+
          this.equipmentTiles('select-field-equipment')+'<div class="screen-foot"><button class="button secondary" data-action="new-check">↺ Nueva verificación</button></div>';
      }else if(this.fieldView==='systems'){
        content='<div class="screen-title"><div><h1>'+escape(equipment.tag)+'</h1></div><span class="progress">'+
          equipment.systems.length+' sistemas</span></div><div class="square-grid system-tiles">'+equipment.systems.map((item,index)=>{
            const done=item.variables.filter(entry=>records[entry.id]).length;
            const diagnosis=this.results[item.id];
            const rollup=this.systemRollup(diagnosis),status=rollup.status,label=rollup.label;
            return '<button class="square-tile '+status+'" data-action="open-system" data-id="'+escape(item.id)+'">'+this.iconImage(item.icon,'tile-icon')+'<span class="tile-index">'+
              String(index+1).padStart(2,'0')+'</span><strong>'+escape(item.name)+'</strong><small>'+(label?label+' · ':'')+done+' / '+item.variables.length+' verificadas</small></button>';
          }).join('')+'</div><div class="screen-foot"><button class="button secondary" data-action="new-check">↺ Nueva verificación</button></div>';
      }else if(this.fieldView==='variables'){
        content='<div class="screen-title"><div><p class="eyebrow">SISTEMA CRÍTICO</p><h1>'+escape(system?.name||'Sin sistema')+
          '</h1></div><span class="progress">'+count+' / '+(system?.variables.length||0)+'</span></div>'+
          '<div class="square-grid instrument-tiles">'+(system?.variables.map((item,index)=>
            this.variableTile(item,index,records[item.id],result)).join('')||'<div class="empty">Agrega variables en el Creador.</div>')+'</div><div class="screen-foot">'+
          (equipment.approved?'':'<span class="foot-warning">⚠ Límites de ejemplo: valida el equipo en Creador.</span>')+
          '</div>';
      }else{
        const index=system?.variables.indexOf(variable)??-1;
        const finding=this.findings[variable?.id]||result?.results.find(item=>item.variableId===variable?.id);
        content='<div class="screen-title"><div><p class="eyebrow">LECTURA '+(index+1)+' DE '+(system?.variables.length||0)+'</p><h1>'+
          escape(variable?.tag||'Variable')+'</h1><p>'+escape(variable?.name||'')+'</p></div><span class="type-pill">'+
          (TYPES[variable?.type]||'')+'</span></div>'+ (variable?this.row(variable,records[variable.id],
          finding,equipment.approved):'<div class="empty">Variable no disponible.</div>')+
          '<div class="screen-foot"><span class="foot-hint">Variable '+(index+1)+' de '+system.variables.length+'</span></div>';
      }
      return '<div class="field-shell"><div class="instrument"><div class="instrument-body">'+content+'</div><div class="instrument-softkeys"><button data-action="field-home">⌂ Inicio</button>'+
        '<button data-action="field-back"'+(back?'':' disabled')+'>‹ Atrás</button>'+
        (this.fieldView==='reading'?'<button data-action="next-variable">Siguiente ›</button><button data-action="validate-reading" data-id="'+escape(variable?.id||'')+'">Validar</button>':
          this.fieldView==='variables'?'<button data-action="diagnose">Diagnóstico general</button>':'<button disabled>Selecciona</button>')+
        '</div></div></div>';
    }
    editorField(scope,key,label,value,id=''){
      return '<label class="field"><span>'+label+'</span><input type="text" data-edit="'+scope+'" data-key="'+key+'"'+
        (id?' data-id="'+escape(id)+'"':'')+' value="'+escape(value??'')+'"></label>';
    }
    numericField(variable,key,label){
      return '<label class="field"><span>'+label+'</span><input type="number" inputmode="decimal" step="any" data-edit="variable" data-key="'+
        key+'" data-id="'+escape(variable.id)+'" value="'+escape(variable[key]??'')+'" placeholder="—"></label>';
    }
    systemEditor(system){
      if(!system)return '<div class="empty">Crea o selecciona un sistema.</div>';
      return '<label class="field"><span>Nombre del sistema</span><input type="text" data-edit="system" data-key="name" data-id="'+escape(system.id)+'" value="'+escape(system.name)+'"></label>'+
        '<label class="field icon-field"><span>Icono del sistema</span>'+this.iconPicker('system',system.id,system.icon)+'</label>'+
        '<button class="button text-danger system-delete" data-action="delete-system">Eliminar sistema</button>';
    }
    variableEditor(variable){
      const id=' data-edit="variable" data-id="'+escape(variable.id)+'"';
      return '<article class="variable-editor"><div class="variable-editor-head"><span class="variable-tag">'+
        escape(variable.tag||'NUEVA')+'</span><strong>'+escape(variable.name||'Nueva variable')+
        '</strong><button class="icon-danger" data-action="delete-variable" data-id="'+escape(variable.id)+
        '" aria-label="Eliminar variable">×</button></div><div class="form-grid variable-grid">'+
        this.editorField('variable','tag','Tag',variable.tag,variable.id)+
        this.editorField('variable','name','Nombre de variable',variable.name,variable.id)+
        '<label class="field"><span>Magnitud</span><select'+id+' data-key="type">'+
        Object.keys(TYPES).map(type=>'<option value="'+type+'"'+(variable.type===type?' selected':'')+'>'+TYPES[type]+'</option>').join('')+
        '</select></label><label class="field"><span>Unidad</span><select'+id+' data-key="unit">'+
        choices(D.TYPE_UNITS[variable.type],variable.unit)+'</select></label>'+
        '<label class="field"><span>Regla</span><select'+id+' data-key="rule">'+
        [['range','Dentro de rango'],['minimum','Mínimo requerido'],['maximum','Máximo permitido']].map(([key,label])=>
          '<option value="'+key+'"'+(variable.rule===key?' selected':'')+'>'+label+'</option>').join('')+
        '</select></label>'+this.numericField(variable,'normal','Valor normal')+
        (variable.rule!=='maximum'?this.numericField(variable,'min','Mínimo')+this.numericField(variable,'alarmMin','Alarma baja'):'')+
        (variable.rule!=='minimum'?this.numericField(variable,'max','Máximo')+this.numericField(variable,'alarmMax','Alarma alta'):'')+
        this.numericField(variable,'maxDeviationPercent','Desviación máxima del valor normal (%)')+
        '</div><div class="variable-live-errors" aria-live="polite">'+variable.validate().map(escape).join('<br>')+'</div></article>';
    }
    creator(){
      const equipment=this.equipment(),system=this.system(),errors=equipment.validate(),displayErrors=this.equipmentLevelErrors(equipment);
      const selected=system?.variables.find(item=>item.id===this.creatorVariableId)||system?.variables[0];
      if(this.creatorView==='home')return '<div class="creator-page creator-home"><div class="unit-picker">'+this.units()+
        '</div><div class="screen-title"><div><p class="eyebrow">CREADOR</p><h1>Equipos registrados</h1></div></div>'+
        this.equipmentTiles('edit-equipment')+'</div>';
      if(this.creatorView==='equipment')return '<div class="creator-page"><div class="creator-screen-nav"><button class="button secondary" data-action="creator-home">‹ Unidades / equipos</button>'+
        '<span>'+escape(equipment.tag||'Nuevo equipo')+'</span></div><section class="editor-section"><div class="section-heading"><h2>Identificación del equipo</h2></div>'+
        '<div class="form-grid equipment-fields">'+this.editorField('equipment','tag','Tag',equipment.tag)+
        '<label class="field"><span>Unidad</span><select data-edit="equipment" data-key="unitNumber">'+choices(['12','16'],String(equipment.unitNumber))+'</select></label>'+
        this.editorField('equipment','name','Nombre del equipo',equipment.name)+this.editorField('equipment','service','Servicio asociado',equipment.service)+
        '<label class="field wide"><span>Descripción</span><textarea data-edit="equipment" data-key="description" rows="2">'+escape(equipment.description)+
        '</textarea></label></div><label class="field icon-field"><span>Icono del equipo</span>'+this.iconPicker('equipment',equipment.id,equipment.icon)+'</label><div class="creator-bottom"><button class="button text-danger" data-action="delete-equipment">Eliminar equipo</button>'+
        '<button class="button primary" data-action="creator-next">Siguiente ›</button></div></section></div>';
      return '<div class="creator-page creator-systems"><div class="creator-screen-nav"><button class="button secondary" data-action="creator-home">‹ Equipos</button>'+
        '<span>'+escape(equipment.tag||'Equipo')+' · '+escape(equipment.name||'')+'</span><button class="button secondary" data-action="creator-equipment">‹ Identificación</button></div>'+
        '<div class="creator-systems-nav"><div class="column-title">Sistemas</div>'+this.systems(equipment,true)+'</div>'+
        '<div class="creator-columns"><section class="creator-column system-editor-column"><div class="column-title">Sistema seleccionado</div>'+this.systemEditor(system)+
        '</section><section class="creator-column"><div class="column-title">Variables</div>'+(system?
          '<div class="variable-list-heading"><strong>'+escape(system.name)+'</strong><button class="button secondary" data-action="add-variable">＋</button></div>'+
          '<div class="creator-variable-list">'+system.variables.map(variable=>'<button class="creator-variable'+(variable.id===selected?.id?' active':'')+
            '" data-action="select-editor-variable" data-id="'+escape(variable.id)+'"><strong>'+escape(variable.tag||'NUEVA')+'</strong><span>'+
            escape(variable.name||'Sin nombre')+'</span></button>').join('')+'</div>'
          :'<div class="empty">Agrega un sistema para empezar.</div>')+'</section><section class="creator-column variable-settings">'+(selected?
          '<div class="column-title">Modificar variable</div>'+this.variableEditor(selected)
          :'<div class="empty">Selecciona una variable para editar sus límites.</div>')+'</section></div>'+
        '<section class="creator-validation"><div class="validation-heading"><div><div class="column-title">Validación del equipo</div>'+
        '<p>La validación aplica a todos los sistemas y variables de este equipo.</p></div>'+
        '<button class="button primary validate-equipment" data-action="approve"'+(errors.length?' disabled':'')+'>✓ Validar equipo</button></div>'+
        (equipment.provisional?'<p class="validation-note">Valores de ejemplo: reemplázalos por datos aprobados.</p>':'')+
        (displayErrors.length?'<p class="validation-errors" data-validation-summary>'+displayErrors.slice(0,8).map(escape).join('<br>')+'</p>':'<p class="validation-note" data-validation-summary>'+(errors.length?'Los errores de variables aparecen junto a su editor.':'Todos los datos requeridos son válidos.')+'</p>')+
        '</section></div>';
    }
    render(){
      document.getElementById('tab-field').classList.toggle('active',this.mode==='field');
      document.getElementById('tab-creator').classList.toggle('active',this.mode==='creator');
      this.app.innerHTML=this.mode==='field'?this.field():this.creator();
    }
    findVariable(id){
      for(const system of this.equipment().systems){
        const variable=system.variables.find(item=>item.id===id);
        if(variable)return variable;
      }
      return null;
    }
    refreshValidation(errors=this.equipment().validate()){
      const displayErrors=this.equipmentLevelErrors();
      const summary=this.app.querySelector('[data-validation-summary]');
      if(summary){summary.classList.toggle('validation-errors',displayErrors.length>0);summary.classList.toggle('validation-note',!displayErrors.length);
        summary.innerHTML=displayErrors.length?displayErrors.slice(0,8).map(escape).join('<br>'):errors.length?'Los errores de variables aparecen junto a su editor.':'Todos los datos requeridos son válidos.';}
      const button=this.app.querySelector('[data-action="approve"]');
      if(button)button.disabled=errors.length>0;
      const variable=this.findVariable(this.creatorVariableId||this.system()?.variables[0]?.id);
      const live=this.app.querySelector('.variable-live-errors');
      if(live&&variable)live.innerHTML=variable.validate().map(escape).join('<br>');
    }
    edit(target,rerender=true){
      const equipment=this.equipment(),scope=target.dataset.edit,key=target.dataset.key;
      const object=scope==='equipment'?equipment:scope==='system'?equipment.systems.find(item=>item.id===target.dataset.id):this.findVariable(target.dataset.id);
      if(!object||!key)return;
      const value=target.value;
      if(String(object[key]??'')===String(value))return;
      if(scope==='variable'&&key==='unit'&&value!==object.unit){
        const old=object.unit;
        for(const field of ['normal','min','max','alarmMin','alarmMax']){
          if(object[field]!==null)object[field]=D.UnitConverter.convert(object[field],old,value);
        }
        if(!D.UnitConverter.compatible(old,value))this.notify('Unidad incompatible: vuelve a introducir los límites');
        object.unit=value;
      }else if(scope==='variable'&&key==='type'&&value!==object.type){
        object.type=value;object.unit=D.TYPE_UNITS[value][0];
        for(const field of ['normal','min','max','alarmMin','alarmMax'])object[field]=null;
        this.notify('Nueva magnitud: introduce los valores de referencia');
      }else if(scope==='variable'&&['normal','min','max','alarmMin','alarmMax','maxDeviationPercent'].includes(key)){
        object[key]=value===''?null:Number(value);
      }else object[key]=value;
      if(scope==='equipment'&&key==='unitNumber'){this.unitNumber=value;object.unit=value;}
      this.invalidate(equipment);
      if(rerender)this.render();
      else this.refreshValidation();
    }
    saveReading(id){
      const system=this.system(),equipment=this.equipment();
      const row=[...this.app.querySelectorAll('.reading-row,.instrument-tile')].find(item=>item.dataset.variable===id),variable=this.findVariable(id);
      if(!row||!variable)return {ok:false};
      const input=row.querySelector('[data-read="value"]'),unit=row.querySelector('[data-read="unit"]').value;
      const value=D.UnitConverter.parseReading(input.value);
      if(value===null){this.notify('Ingresa un número válido, por ejemplo 43,5');input.focus();return {ok:false};}
      if(!D.UnitConverter.compatible(unit,variable.unit)){this.notify('La unidad no corresponde a la magnitud');return {ok:false};}
      this.records(equipment)[variable.id]={value,unit,recordedAt:new Date().toISOString()};
      delete this.drafts[variable.id];delete this.results[system.id];delete this.findings[variable.id];
      if(equipment.approved){
        try{this.findings[variable.id]=variable.assess(value,unit,variable.maxDeviationPercent);}
        catch(error){this.notify(error.message);return {ok:false};}
      }
      this.persist();
      return {ok:true,status:this.findings[variable.id]?.status||null};
    }
    saveInlineReadings(){
      const system=this.system();
      if(!system)return true;
      for(const variable of system.variables){
        const row=[...this.app.querySelectorAll('.instrument-tile')].find(item=>item.dataset.variable===variable.id);
        const input=row?.querySelector('[data-read="value"]');
        if(!input)continue;
        if(input.value.trim()){
          if(!this.saveReading(variable.id).ok)return false;
        }else if(this.drafts[variable.id]){
          delete this.records()[variable.id];delete this.drafts[variable.id];delete this.findings[variable.id];
        }
      }
      return true;
    }
    diagnoseSystem(system,equipment=this.equipment()){
      this.results[system.id]=new D.DiagnosticEngine().evaluateSystem(equipment,system.id,this.records(equipment));
    }
    validateReading(button){
      const outcome=this.saveReading(button.dataset.id);
      if(!outcome.ok)return;
      this.render();
      const finding=this.findings[button.dataset.id];
      this.notify(finding?this.findingLabel(finding,this.findVariable(button.dataset.id),this.records()[button.dataset.id]):'Lectura guardada. Valida límites en el Creador.');
    }
    action(button){
      const action=button.dataset.action,equipment=this.equipment(),system=this.system();
      if(action==='mode-field'||action==='mode-creator'){
        this.mode=action==='mode-field'?'field':'creator';
        if(this.mode==='creator')this.creatorView='home';this.persist();this.render();return;
      }
      if(action==='creator-home'){this.creatorView='home';this.render();return;}
      if(action==='creator-equipment'){this.creatorView='equipment';this.render();return;}
      if(action==='creator-next'){this.creatorView='systems';this.creatorVariableId=null;this.render();return;}
      if(action==='select-unit'){
        this.unitNumber=button.dataset.unit;
        this.equipmentId=this.equipments.find(item=>item.unitNumber===this.unitNumber)?.id||this.equipmentId;
        this.systemId=this.equipment().systems[0]?.id||null;this.findings={};this.persist();this.render();return;
      }
      if(action==='edit-equipment'){
        this.equipmentId=button.dataset.id;this.unitNumber=this.equipment().unitNumber;this.creatorView='equipment';
        this.creatorVariableId=null;this.systemId=this.equipment().systems[0]?.id||null;this.mode='creator';this.persist();this.render();return;
      }
      if(action==='select-field-equipment'){
        this.equipmentId=button.dataset.id;this.unitNumber=this.equipment().unitNumber;this.systemId=this.equipment().systems[0]?.id||null;
        this.fieldView='systems';this.variableId=null;this.findings={};this.persist();this.render();return;
      }
      if(action==='select-editor-variable'){this.creatorVariableId=button.dataset.id;this.render();return;}
      if(action==='choose-icon'){
        const target=button.dataset.scope==='equipment'?equipment:equipment.systems.find(item=>item.id===button.dataset.id);
        if(!target)return;
        target.icon=button.dataset.icon;this.openIconPicker=null;this.persist();this.render();return;
      }
      if(action==='toggle-icon-picker'){
        const picker=button.dataset.scope+':'+button.dataset.id;
        this.openIconPicker=this.openIconPicker===picker?null:picker;this.render();return;
      }
      if(action==='field-home'){this.fieldView='home';this.render();return;}
      if(action==='field-back'){
        if(this.fieldView==='variables'){
          if(!this.saveInlineReadings())return;
          if(equipment.approved)try{for(const item of equipment.systems)this.diagnoseSystem(item,equipment);}catch(error){this.notify(error.message);}
          this.persist();this.fieldView='systems';this.render();return;
        }
        this.fieldView=this.fieldView==='reading'?'variables':'home';this.render();return;
      }
      if(action==='open-system'){
        this.systemId=button.dataset.id;this.fieldView='variables';this.variableId=null;this.persist();this.render();return;
      }
      if(action==='open-variable'){
        this.variableId=button.dataset.id;this.fieldView='reading';this.render();return;
      }
      if(action==='next-variable'){
        const input=this.app.querySelector('.reading-row [data-read="value"]');
        const hasValue=Boolean(input&&input.value.trim()!=='');
        if(hasValue&&!this.saveReading(this.variableId).ok)return;
        const index=system?.variables.findIndex(item=>item.id===this.variableId)??-1;
        if(index>=0&&index<system.variables.length-1){this.variableId=system.variables[index+1].id;this.render();}
        else{this.fieldView='variables';this.render();}
        if(hasValue)this.notify('Lectura registrada automáticamente');return;
      }
      if(action==='select-system'){
        this.systemId=button.dataset.id;this.creatorVariableId=null;this.persist();this.render();
        return;
      }
      if(action==='new-check'){
        if(!confirm('¿Iniciar una nueva verificación de '+(equipment.tag||equipment.name)+'? Se borrarán las lecturas de este equipo, pero no sus límites.'))return;
        delete this.readings[equipment.id];for(const item of equipment.systems)delete this.results[item.id];
        for(const item of equipment.systems)for(const variable of item.variables)delete this.findings[variable.id];
        this.findings={};this.drafts={};this.persist();this.render();
        this.notify('Nueva verificación lista');return;
      }
      if(action==='new-equipment'||action==='add-compressor'){
        const item=action==='new-equipment'?new D.Equipment({name:'Nuevo equipo',unit:this.unitNumber,unitNumber:this.unitNumber}):D.createCompressorTemplate();
        if(action==='add-compressor'){item.tag='';item.name='Nuevo compresor';item.unit=this.unitNumber;item.unitNumber=this.unitNumber;}
        this.equipments.push(item);this.equipmentId=item.id;this.systemId=item.systems[0]?.id||null;this.mode='creator';this.creatorView='equipment';this.creatorVariableId=null;this.persist();this.render();return;
      }
      if(action==='delete-equipment'){
        if(this.equipments.length===1){this.notify('Debe quedar al menos un equipo');return;}
        if(!confirm('¿Eliminar este equipo y sus lecturas locales?'))return;
        this.equipments=this.equipments.filter(item=>item.id!==equipment.id);
        delete this.readings[equipment.id];
        for(const item of equipment.systems){delete this.results[item.id];for(const variable of item.variables)delete this.findings[variable.id];}
        this.equipmentId=this.equipments.find(item=>item.unitNumber===this.unitNumber)?.id||this.equipments[0].id;this.unitNumber=this.equipment().unitNumber;
        this.systemId=null;this.mode='creator';this.creatorView='home';this.creatorVariableId=null;
        this.fieldView='home';this.variableId=null;this.findings={};this.drafts={};
        this.persist();this.render();this.notify('Equipo eliminado');return;
      }
      if(action==='add-system'){
        const name=prompt('Nombre del sistema crítico:');
        if(name===null)return;
        if(!name.trim()){this.notify('Escribe un nombre de sistema');return;}
        const item=new D.CriticalSystem({name:name.trim()});
        equipment.systems.push(item);this.systemId=item.id;this.creatorVariableId=null;this.invalidate(equipment);this.render();return;
      }
      if(action==='delete-system'){
        if(!system||!confirm('¿Eliminar este sistema y sus variables?'))return;
        equipment.systems=equipment.systems.filter(item=>item.id!==system.id);
        this.systemId=equipment.systems[0]?.id||null;this.invalidate(equipment);this.render();return;
      }
      if(action==='add-variable'){
        if(!system)return;
        const variable=new D.VariableSpec({tag:'',name:'',type:'pressure',unit:'psi'});
        system.variables.push(variable);this.creatorVariableId=variable.id;
        this.invalidate(equipment);this.render();return;
      }
      if(action==='delete-variable'){
        if(!system||!confirm('¿Eliminar esta variable?'))return;
        system.variables=system.variables.filter(item=>item.id!==button.dataset.id);this.creatorVariableId=null;
        this.invalidate(equipment);this.render();return;
      }
      if(action==='approve'){
        try{equipment.approve();this.creatorView='home';this.persist();this.render();this.notify('Equipo validado y guardado');}
        catch(error){this.notify(error.message);}
        return;
      }
      if(action==='validate-reading'){this.validateReading(button);return;}
      if(action==='diagnose'){
        if(!this.saveInlineReadings())return;
        try{
          this.results[system.id]=new D.DiagnosticEngine().evaluateSystem(equipment,system.id,this.records(equipment));
          this.persist();this.fieldView='variables';this.render();
        }catch(error){this.notify(error.message);}
      }
    }
    click(event){const button=event.target.closest('[data-action]');if(button)this.action(button);}
    change(event){
      const target=event.target;
      if(target.id==='equipment-select'){
        this.equipmentId=target.value;this.systemId=null;this.fieldView='home';this.variableId=null;this.drafts={};
        this.persist();this.render();return;
      }
      if(target.dataset.read==='unit'){
        const row=target.closest('.reading-row,.instrument-tile'),input=row?.querySelector('[data-read="value"]');
        const variable=this.findVariable(row?.dataset.variable),previous=this.drafts[variable?.id]?.unit||this.records()[variable?.id]?.unit||variable?.unit;
        const amount=D.UnitConverter.parseReading(input?.value||'');
        if(amount!==null&&previous!==target.value){
          const converted=D.UnitConverter.convert(amount,previous,target.value);
          if(converted!==null&&input)input.value=String(Number(converted.toPrecision(8)));
        }
        this.capture(target);this.render();return;
      }
      if(target.dataset.edit){this.edit(target,target.tagName==='SELECT');return;}
      if(target.dataset.read==='value')this.capture(target);
    }
    input(event){
      if(event.target.dataset.read==='value'){this.capture(event.target);return;}
      if(event.target.dataset.edit)this.edit(event.target,false);
    }
    capture(target){
      const row=target.closest('.reading-row,.instrument-tile');
      if(!row)return;
      const id=row.dataset.variable;
      this.drafts[id]={value:row.querySelector('[data-read="value"]').value,unit:row.querySelector('[data-read="unit"]').value};
    }
  }
  new FieldApp();
})();
