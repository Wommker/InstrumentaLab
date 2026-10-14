'use strict';

const assert = require('node:assert/strict');
const {
  convertResult, GuidedPressureScenario, PressureThresholdControl, ValveActuator,
  ProcessVariableSource, compatibleMeasurement, SwitchHysteresis,
  VariableTrend, CurrentController, ProcessAction
} = require('../web/simulation.js');

function runLoop(role) {
  const process = {
    startPressure:100, pressure:100, targetPressure:500, riseSeconds:10,
    reliefPressure:120, reliefSeconds:5, fixed:false
  };
  const controller = {
    thresholdUnit:'kPa', openThreshold:350, closeThreshold:180,
    highAction:role === 'inlet' ? 'close' : 'open', active:false
  };
  const scenario = new GuidedPressureScenario(process);
  const law = new PressureThresholdControl(controller);
  const valve = new ValveActuator();
  const step = () => {
    const measured = {value:process.pressure,unit:'kPa'};
    const transmitted = {value:4 + measured.value / 500 * 16,unit:'mA',engineering:measured};
    const order = law.evaluate(transmitted);
    const opening = valve.position(order).value;
    scenario.advance(1,{
      inletOpening:role === 'inlet' ? opening : 100,
      outletOpening:role === 'outlet' ? opening : 0
    });
    return {opening,order};
  };
  for(let second=0;second<7;second++)step();
  assert.equal(process.pressure,380);
  const active=step();
  assert.equal(active.order.value,role === 'inlet' ? 4 : 20);
  assert.equal(active.opening,role === 'inlet' ? 0 : 100);
  assert.equal(process.pressure,304);
  step();
  step();
  assert.equal(process.pressure,152);
  const returned=step();
  assert.equal(returned.opening,role === 'inlet' ? 100 : 0);
  assert.equal(process.pressure,192);
}

runLoop('outlet');
runLoop('inlet');
assert.ok(Math.abs(convertResult({value:100,unit:'psi'},'kPa').value-689.4757293168)<1e-9);
assert.equal(new ValveActuator().position({value:12,unit:'mA'}).value,50);

const pipe={simulationMode:'guided_pressure',pressure:200,pressureUnit:'kPa'};
const pressure={type:'pressure',source:'scenario',unit:'psi'};
const temperature={type:'temperature',source:'manual',unit:'°C',value:42};
const pressureReading=new ProcessVariableSource(pipe,pressure).read();
assert.ok(Math.abs(pressureReading.value-29.0075475)<1e-6);
assert.deepEqual(new ProcessVariableSource(pipe,temperature).read(),{value:42,unit:'°C'});
assert.equal(compatibleMeasurement('temperature',pressureReading),false);
assert.equal(compatibleMeasurement('switch_pressure',pressureReading),true);
assert.equal(compatibleMeasurement('switch_level',{value:55,unit:'%'}),true);

const high={measurement:'switch_pressure',thresholdUnit:'kPa',switchDirection:'high',onThreshold:300,offThreshold:250,switchOn:false};
const highSwitch=new SwitchHysteresis(high);
assert.equal(highSwitch.evaluate({value:280,unit:'kPa'}).on,false);
assert.equal(highSwitch.evaluate({value:44,unit:'psi'}).on,true);
assert.equal(highSwitch.evaluate({value:270,unit:'kPa'}).on,true);
assert.equal(highSwitch.evaluate({value:245,unit:'kPa'}).on,false);
assert.equal(highSwitch.evaluate({value:30,unit:'°C'}),null);

const low={variableType:'switch_temperature',thresholdUnit:'°C',switchDirection:'low',onThreshold:10,offThreshold:14,switchOn:false};
const lowSwitch=new SwitchHysteresis(low);
assert.equal(lowSwitch.evaluate({value:9,unit:'°C'}).on,true);
assert.equal(lowSwitch.evaluate({value:12,unit:'°C'}).on,true);
assert.equal(lowSwitch.evaluate({value:15,unit:'°C'}).on,false);
for(const [type,unit] of [['flow','m³/h'],['level','%']]){
  const device={variableType:`switch_${type}`,thresholdUnit:unit,switchDirection:'high',onThreshold:70,offThreshold:60,switchOn:false};
  const contact=new SwitchHysteresis(device);
  assert.equal(contact.evaluate({value:72,unit}).on,true);
  assert.equal(contact.evaluate({value:65,unit}).on,true);
  assert.equal(contact.evaluate({value:55,unit}).on,false);
}

for(const [type,unit,start,target,mode] of [
  ['pressure','kPa',100,500,'rise'],['temperature','°C',20,40,'rise'],
  ['flow','m³/h',80,20,'fall'],['level','%',70,30,'fall']
]){
  const variable={type,unit,source:'manual',trendMode:mode,value:start,startValue:start,targetValue:target,durationSeconds:10};
  const trend=new VariableTrend(variable);
  trend.advance(5);
  assert.equal(variable.value,(start+target)/2);
  trend.advance(10);
  assert.equal(variable.value,target);
  trend.reset();
  assert.equal(variable.value,start);
}
const staticVariable={type:'temperature',unit:'°C',source:'manual',trendMode:'static',value:22,startValue:22,targetValue:50,durationSeconds:2};
new VariableTrend(staticVariable).advance(10);
assert.equal(staticVariable.value,22);

const progressive={controlMode:'progressive',inputLow:4,inputHigh:20,outputLow:20,outputHigh:4};
assert.equal(new CurrentController(progressive).evaluate({value:12,unit:'mA'}).value,12);
assert.equal(new CurrentController(progressive).evaluate({value:25,unit:'mA'}).value,4);
assert.equal(new CurrentController(progressive).evaluate({value:200,unit:'kPa'}),null);
const relay={controlMode:'on_off',onCurrent:15.2,offCurrent:9.76,activeOutput:20,inactiveOutput:4,active:false};
const law=new CurrentController(relay);
assert.equal(law.evaluate({value:15.3,unit:'mA',engineering:{value:0,unit:'kPa'}}).value,20);
assert.equal(law.evaluate({value:12,unit:'mA'}).value,20);
assert.equal(law.evaluate({value:9,unit:'mA'}).value,4);

const controlled={id:'tank',simulationMode:'variables',variables:[
  {id:'p',type:'pressure',unit:'kPa',source:'manual',value:300},
  {id:'t',type:'temperature',unit:'°C',source:'manual',value:30}
]};
assert.equal(new ProcessAction(controlled,{processId:'tank',variableId:'p',when:'open',effect:'decrease',rate:20}).apply(50,2),true);
assert.equal(controlled.variables[0].value,280);
new ProcessAction(controlled,{processId:'tank',variableId:'t',when:'open',effect:'increase',rate:5}).apply(100,2);
assert.equal(controlled.variables[1].value,40);
assert.equal(new ProcessAction(controlled,{processId:'other',variableId:'p',when:'open',effect:'decrease',rate:99}).apply(100,1),false);
const tank={id:'volume',simulationMode:'volume',fill:50,variables:[]};
new ProcessAction(tank,{processId:'volume',variableId:'__fill__',when:'closed',effect:'set',targetValue:75}).apply(0,1);
assert.equal(tank.fill,75);
tank.fixed=true;
assert.equal(new ProcessAction(tank,{processId:'volume',variableId:'__fill__',when:'closed',effect:'decrease',rate:50}).apply(0,1),false);
assert.equal(tank.fill,75);

for(const role of ['outlet','inlet']){
  const variable={id:'pressure',type:'pressure',unit:'kPa',source:'manual',trendMode:'rise',value:100,startValue:100,targetValue:500,durationSeconds:10};
  const process={id:'line',simulationMode:'variables',variables:[variable]};
  const controller={controlMode:'on_off',onCurrent:15.2,offCurrent:9.76,activeOutput:role==='outlet'?20:4,inactiveOutput:role==='outlet'?4:20,active:false};
  const currentLaw=new CurrentController(controller);
  const actuator=new ValveActuator();
  const action={processId:'line',variableId:'pressure',when:role==='outlet'?'open':'closed',effect:'decrease',rate:116};
  const values=[];
  for(let second=0;second<11;second++){
    const signal={value:4+variable.value/500*16,unit:'mA'};
    const opening=actuator.position(currentLaw.evaluate(signal)).value;
    new VariableTrend(variable).advance(1);
    new ProcessAction(process,action).apply(opening,1);
    values.push(variable.value);
  }
  assert.equal(values[6],380);
  assert.equal(values[7],304);
  assert.equal(values[9],152);
  assert.equal(values[10],192);
}
console.log('Simulación web: lazos por mA, tendencias, acciones múltiples y switches correctos.');
