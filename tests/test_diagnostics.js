'use strict';
const assert=require('node:assert/strict');
const {UnitConverter,VariableSpec,CriticalSystem,Equipment,DiagnosticEngine,createCompressorTemplate}=require('../web/diagnostics.js');

const compressor=createCompressorTemplate();
assert.equal(compressor.systems.length,3);
assert.deepEqual(compressor.systems.map(system=>system.variables.length),[5,3,2]);
assert.equal(compressor.validate().length,0);
assert.equal(compressor.approved,false);
const lubrication=compressor.systems[0];
const readings=Object.fromEntries(lubrication.variables.map(variable=>[variable.id,{value:variable.normal,unit:variable.unit}]));
const engine=new DiagnosticEngine();
assert.throws(()=>engine.evaluateSystem(compressor,lubrication.id,readings),/validarse/);
compressor.approve();
const normal=engine.evaluateSystem(compressor,lubrication.id,readings);
assert.equal(normal.status,'normal');
assert.equal(normal.counts.normal,5);
assert.equal(normal.counts.warning,0);
assert.equal(normal.counts.alarm,0);
assert.throws(()=>engine.evaluateSystem(compressor,lubrication.id,{}),/Faltan 5/);
const pressure=lubrication.variables.find(variable=>variable.tag==='PI-101');
readings[pressure.id]={value:32,unit:'psi'};
assert.equal(engine.evaluateSystem(compressor,lubrication.id,readings).status,'warning');
readings[pressure.id]={value:20,unit:'psi'};
assert.equal(engine.evaluateSystem(compressor,lubrication.id,readings).status,'alarm');
readings[pressure.id]={value:UnitConverter.convert(43,'psi','kPa'),unit:'kPa'};
assert.equal(engine.evaluateSystem(compressor,lubrication.id,readings).status,'normal');

const range=new VariableSpec({tag:'TI-1',name:'Temperatura',type:'temperature',unit:'°C',rule:'range',normal:40,min:30,max:50,alarmMin:20,alarmMax:60});
assert.equal(range.assess(104,'°F').status,'normal');
assert.equal(range.assess(130,'°F').status,'warning');
assert.equal(range.assess(150,'°F').status,'alarm');
assert.equal(range.assess(20,'°C').status,'alarm');
assert.equal(range.assess(60,'°C').status,'alarm');
assert.equal(range.assess(30,'°C').status,'normal');
assert.equal(range.assess(104,'°F').difference,0);
assert.ok(Math.abs(UnitConverter.convert(0,'°C','°F')-32)<1e-10);
assert.equal(UnitConverter.compatible('psi','°C'),false);
assert.equal(UnitConverter.parseReading('43,5'),43.5);
assert.equal(UnitConverter.parseReading('43.5'),43.5);
assert.equal(UnitConverter.parseReading('-2,25'),-2.25);
assert.equal(UnitConverter.parseReading('12,34,5'),null);
assert.throws(()=>range.assess(40,'psi'),/no válida/);
assert.equal(new VariableSpec({tag:'X',name:'X',type:'pressure',unit:'psi',rule:'range',normal:60,min:50,max:70,alarmMin:55,alarmMax:80}).validate().length>0,true);

const zero=new VariableSpec({tag:'F-1',name:'Caudal',type:'flow',unit:'m³/h',rule:'maximum',normal:0,max:10,alarmMax:20});
assert.equal(zero.assess(0).percentDifference,null);
assert.equal(zero.assess(15).status,'warning');
assert.equal(zero.assess(21).status,'alarm');
assert.equal(zero.assess(20).status,'alarm');
const equipment=new Equipment({tag:'E-1',name:'Equipo',unit:'U-1',service:'Servicio',systems:[
  new CriticalSystem({name:'Sistema',variables:[zero,zero]})
]});
assert.match(equipment.validate().join(' '),/Etiqueta repetida/);
compressor.revokeApproval();
assert.throws(()=>engine.evaluateSystem(compressor,lubrication.id,readings),/validarse/);
console.log('Diagnóstico web: plantilla, validación, unidades, reglas y alarmas correctas.');
