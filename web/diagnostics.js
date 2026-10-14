/* Modelo local de equipos y verificación de lecturas. No sustituye límites del fabricante. */
(() => {
  'use strict';

  const UNIT_DEFINITIONS = Object.freeze({
    Pa:{dimension:'pressure',factor:1,offset:0},
    kPa:{dimension:'pressure',factor:1000,offset:0},
    bar:{dimension:'pressure',factor:100000,offset:0},
    psi:{dimension:'pressure',factor:6894.757293168,offset:0},
    '°C':{dimension:'temperature',factor:1,offset:273.15},
    '°F':{dimension:'temperature',factor:5/9,offset:255.3722222222222},
    K:{dimension:'temperature',factor:1,offset:0},
    '%':{dimension:'percent',factor:1,offset:0},
    m:{dimension:'length',factor:1,offset:0},
    cm:{dimension:'length',factor:.01,offset:0},
    'm³/h':{dimension:'flow',factor:1/3600,offset:0},
    'L/min':{dimension:'flow',factor:1/60000,offset:0}
  });
  const TYPE_UNITS = Object.freeze({
    pressure:['psi','kPa','bar','Pa'],
    temperature:['°C','°F','K'],
    level:['%','m','cm'],
    flow:['m³/h','L/min']
  });
  const SEVERITY = Object.freeze({normal:0,warning:1,alarm:2});
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const makeId = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  class UnitConverter {
    static compatible(from,to) {
      return Boolean(UNIT_DEFINITIONS[from]&&UNIT_DEFINITIONS[to]&&UNIT_DEFINITIONS[from].dimension===UNIT_DEFINITIONS[to].dimension);
    }
    static convert(value,from,to) {
      if(!finite(value)||!this.compatible(from,to))return null;
      const source=UNIT_DEFINITIONS[from],target=UNIT_DEFINITIONS[to];
      const base=Number(value)*source.factor+source.offset;
      return (base-target.offset)/target.factor;
    }
    static convertDelta(value,from,to) {
      if(!finite(value)||!this.compatible(from,to))return null;
      return Number(value)*UNIT_DEFINITIONS[from].factor/UNIT_DEFINITIONS[to].factor;
    }
  }

  class VariableSpec {
    constructor(data={}) {
      this.id=data.id||makeId();
      this.tag=String(data.tag||'');
      this.name=String(data.name||'');
      this.type=TYPE_UNITS[data.type]?data.type:'pressure';
      this.unit=TYPE_UNITS[this.type].includes(data.unit)?data.unit:TYPE_UNITS[this.type][0];
      this.rule=['range','minimum','maximum'].includes(data.rule)?data.rule:'range';
      for(const key of ['normal','min','max','alarmMin','alarmMax'])this[key]=finite(data[key])?Number(data[key]):null;
    }
    validate() {
      const errors=[];
      if(!this.tag.trim())errors.push('Etiqueta de variable vacía');
      if(!this.name.trim())errors.push(`${this.tag||'Variable'}: nombre vacío`);
      if(!finite(this.normal))errors.push(`${this.tag}: falta el valor normal`);
      if(this.rule==='minimum'||this.rule==='range'){
        if(!finite(this.min)||!finite(this.alarmMin))errors.push(`${this.tag}: faltan mínimo y alarma baja`);
        else if(Number(this.alarmMin)>Number(this.min))errors.push(`${this.tag}: la alarma baja debe ser menor o igual al mínimo`);
        if(finite(this.normal)&&finite(this.min)&&Number(this.normal)<Number(this.min))errors.push(`${this.tag}: el valor normal está bajo el mínimo`);
      }
      if(this.rule==='maximum'||this.rule==='range'){
        if(!finite(this.max)||!finite(this.alarmMax))errors.push(`${this.tag}: faltan máximo y alarma alta`);
        else if(Number(this.alarmMax)<Number(this.max))errors.push(`${this.tag}: la alarma alta debe ser mayor o igual al máximo`);
        if(finite(this.normal)&&finite(this.max)&&Number(this.normal)>Number(this.max))errors.push(`${this.tag}: el valor normal supera el máximo`);
      }
      if(this.rule==='range'&&finite(this.min)&&finite(this.max)&&Number(this.min)>Number(this.max))errors.push(`${this.tag}: mínimo mayor que máximo`);
      return errors;
    }
    assess(observed,unit=this.unit) {
      const value=UnitConverter.convert(observed,unit,this.unit);
      if(value===null)throw new Error(`${this.tag}: lectura o unidad no válida`);
      if(this.validate().length)throw new Error(`${this.tag}: referencia incompleta`);
      let status='normal';
      if((this.rule!=='maximum'&&value<Number(this.alarmMin))||(this.rule!=='minimum'&&value>Number(this.alarmMax)))status='alarm';
      else if((this.rule!=='maximum'&&value<Number(this.min))||(this.rule!=='minimum'&&value>Number(this.max)))status='warning';
      const difference=value-Number(this.normal);
      return {
        variableId:this.id,tag:this.tag,name:this.name,type:this.type,unit:this.unit,
        observed:value,normal:Number(this.normal),difference,
        percentDifference:Number(this.normal)===0?null:difference/Math.abs(Number(this.normal))*100,
        status,rule:this.rule,min:this.min,max:this.max,alarmMin:this.alarmMin,alarmMax:this.alarmMax
      };
    }
    toJSON() { return {...this}; }
  }

  class CriticalSystem {
    constructor(data={}) {
      this.id=data.id||makeId();
      this.name=String(data.name||'');
      this.description=String(data.description||'');
      this.variables=(Array.isArray(data.variables)?data.variables:[]).map(item=>new VariableSpec(item));
    }
    validate() {
      const errors=[];
      if(!this.name.trim())errors.push('Sistema sin nombre');
      if(!this.variables.length)errors.push(`${this.name||'Sistema'}: agrega variables`);
      for(const variable of this.variables)errors.push(...variable.validate());
      return errors;
    }
    toJSON() { return {...this,variables:this.variables.map(item=>item.toJSON())}; }
  }

  class Equipment {
    constructor(data={}) {
      this.id=data.id||makeId();
      this.tag=String(data.tag||'');
      this.unit=String(data.unit||'');
      this.service=String(data.service||'');
      this.name=String(data.name||'');
      this.description=String(data.description||'');
      this.approved=Boolean(data.approved);
      this.approvedAt=data.approvedAt||null;
      this.provisional=Boolean(data.provisional);
      this.systems=(Array.isArray(data.systems)?data.systems:[]).map(item=>new CriticalSystem(item));
    }
    validate() {
      const errors=[];
      for(const key of ['tag','unit','service','name'])if(!this[key].trim())errors.push(`Equipo: falta ${({tag:'tag',unit:'unidad',service:'servicio',name:'nombre'})[key]}`);
      if(!this.systems.length)errors.push('Agrega al menos un sistema crítico');
      const tags=new Set();
      for(const system of this.systems){
        errors.push(...system.validate());
        for(const variable of system.variables){
          if(tags.has(variable.tag.trim().toLowerCase()))errors.push(`Etiqueta repetida: ${variable.tag}`);
          tags.add(variable.tag.trim().toLowerCase());
        }
      }
      return errors;
    }
    revokeApproval() { this.approved=false;this.approvedAt=null; }
    approve() {
      const errors=this.validate();
      if(errors.length)throw new Error(errors[0]);
      this.approved=true;this.approvedAt=new Date().toISOString();this.provisional=false;
    }
    toJSON() { return {...this,systems:this.systems.map(item=>item.toJSON())}; }
  }

  class DiagnosticEngine {
    evaluateSystem(equipment,systemId,records={}) {
      const item=equipment instanceof Equipment?equipment:new Equipment(equipment);
      if(!item.approved||item.validate().length)throw new Error('Los límites del equipo deben validarse en el Creador');
      const system=item.systems.find(entry=>entry.id===systemId);
      if(!system)throw new Error('Sistema no encontrado');
      const missing=system.variables.filter(variable=>!records[variable.id]||!finite(records[variable.id].value));
      if(missing.length)throw new Error(`Faltan ${missing.length} lectura(s) registradas`);
      const results=system.variables.map(variable=>variable.assess(records[variable.id].value,records[variable.id].unit));
      const counts={normal:0,warning:0,alarm:0};
      for(const result of results)counts[result.status]++;
      const status=results.reduce((current,result)=>SEVERITY[result.status]>SEVERITY[current]?result.status:current,'normal');
      return {equipmentId:item.id,systemId,systemName:system.name,status,counts,results,evaluatedAt:new Date().toISOString()};
    }
  }

  const variable=(tag,name,type,unit,rule,normal,min,max,alarmMin,alarmMax)=>new VariableSpec({tag,name,type,unit,rule,normal,min,max,alarmMin,alarmMax});
  const compressorSystems=()=>[
    new CriticalSystem({name:'Sistema de lubricación',description:'Aceite, bombas y sellos',variables:[
      variable('LI-101','Nivel del tanque de aceite','level','%','range',70,50,85,35,95),
      variable('TI-101','Temperatura de salida de la bomba de aceite','temperature','°C','range',45,30,60,20,75),
      variable('TI-102','Temperatura de entrada al tanque','temperature','°C','range',42,30,55,20,70),
      variable('PI-101','Presión de salida de la bomba de aceite','pressure','psi','minimum',43,35,null,25,null),
      variable('PDI-101','Presión diferencial en los sellos','pressure','psi','minimum',15,10,null,5,null)
    ]}),
    new CriticalSystem({name:'Variables de proceso',description:'Succión, descarga y depuración',variables:[
      variable('PI-201','Presión de salida final','pressure','psi','range',160,140,180,120,200),
      variable('PI-202','Presión de entrada','pressure','psi','range',40,30,50,20,60),
      variable('LI-201','Nivel del depurador','level','%','maximum',40,null,60,null,80)
    ]}),
    new CriticalSystem({name:'Sellos secos',description:'Presiones del sistema de sellado',variables:[
      variable('PI-301','Presión del sistema de sellos','pressure','psi','minimum',65,55,null,45,null),
      variable('PI-302','Presión del tanque de sellos','pressure','psi','range',20,15,25,10,30)
    ]})
  ];
  const createCompressorTemplate=()=>new Equipment({
    tag:'K-101',unit:'Unidad de compresión 1',service:'Gas de proceso · ejemplo',
    name:'Compresor de demostración',
    description:'Cifras ilustrativas. Verificar con la ficha técnica y los procedimientos del equipo antes de usar en campo.',
    provisional:true,approved:false,systems:compressorSystems()
  });

  const api={UNIT_DEFINITIONS,TYPE_UNITS,makeId,UnitConverter,VariableSpec,CriticalSystem,Equipment,DiagnosticEngine,compressorSystems,createCompressorTemplate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  globalThis.InstrumentaDiagnostics=api;
})();
