/* Núcleo local de simulación guiada, independiente de la interfaz. */
(() => {
  'use strict';

  const unitScale = {
    Pa:['pressure',1,0], kPa:['pressure',1000,0], bar:['pressure',100000,0], psi:['pressure',6894.757293168,0],
    K:['temperature',1,0], '°C':['temperature',1,273.15], '°F':['temperature',5/9,255.3722222222222],
    'm³/s':['flow',1,0], 'm³/h':['flow',1/3600,0], 'L/s':['flow',.001,0], 'L/min':['flow',.001/60,0],
    m:['level',1,0], cm:['level',.01,0], '%':['percent',1,0], A:['current',1,0], mA:['current',.001,0]
  };

  function baseMagnitude(value, unit) {
    const [dimension,factor,offset] = unitScale[unit] || ['unknown',1,0];
    return {dimension,value:Number(value)*factor+offset};
  }

  function convertResult(result, unit) {
    if (!result || result.on !== undefined || !unit) return result;
    const source = baseMagnitude(result.value,result.unit);
    const target = unitScale[unit];
    if (!target || source.dimension !== target[0]) return null;
    return {value:(source.value-target[2])/target[1],unit};
  }

  // La tendencia representa una intención de prueba, no una predicción hidráulica.
  class GuidedPressureScenario {
    constructor(process) { this.process = process; }
    get pressure() { return Number(this.process.pressure ?? this.process.startPressure ?? 100); }
    reset() { this.process.pressure = Number(this.process.startPressure ?? 100); }
    advance(seconds, {inletOpening = 100, outletOpening = 0} = {}) {
      if (seconds < 0) throw new RangeError('El tiempo no puede retroceder');
      if (this.process.fixed) return;
      const initial = Number(this.process.startPressure ?? 100);
      const target = Number(this.process.targetPressure ?? 500);
      const relieved = Number(this.process.reliefPressure ?? 120);
      const inlet = Math.max(0,Math.min(1,Number(inletOpening)/100));
      const outlet = Math.max(0,Math.min(1,Number(outletOpening)/100));
      const riseRate = Math.max(0,target-initial)/Math.max(.1,Number(this.process.riseSeconds ?? 10));
      const fallRate = Math.max(0,target-relieved)/Math.max(.1,Number(this.process.reliefSeconds ?? 5));
      const reliefStrength = Math.max(outlet,1-inlet);
      const netRate = riseRate*inlet*(1-outlet)-fallRate*reliefStrength;
      const next = this.pressure+netRate*seconds;
      this.process.pressure = netRate >= 0
        ? (this.pressure >= target ? this.pressure : Math.min(target,next))
        : Math.max(Math.min(relieved,this.pressure),next);
    }
  }

  class PressureThresholdControl {
    constructor(controller) { this.controller = controller; }
    evaluate(incoming) {
      if (!incoming) return null;
      const engineering = convertResult(incoming.engineering || incoming,this.controller.thresholdUnit||'kPa');
      if (!engineering) return null;
      const opening = Number(this.controller.openThreshold ?? 350);
      const closing = Math.min(Number(this.controller.closeThreshold ?? 180),opening);
      if (engineering.value >= opening) this.controller.active = true;
      else if (engineering.value <= closing) this.controller.active = false;
      const highCurrent = this.controller.highAction === 'close' ? 4 : 20;
      return {value:this.controller.active ? highCurrent : (highCurrent===20 ? 4 : 20),unit:'mA',engineering};
    }
  }

  class ValveActuator {
    position(incoming) {
      if (!incoming || incoming.value === undefined) return null;
      if (incoming.unit === '%') return {value:Math.max(0,Math.min(100,Number(incoming.value))),unit:'%'};
      const current = convertResult(incoming,'mA');
      return current ? {value:Math.max(0,Math.min(100,(current.value-4)/16*100)),unit:'%'} : null;
    }
  }

  class VariableTrend {
    constructor(variable) { this.variable=variable; }
    reset() {
      this.variable.value=Number(this.variable.startValue??this.variable.value??0);
    }
    advance(seconds) {
      const variable=this.variable;
      const mode=variable.trendMode||'static';
      if(mode==='static'||variable.source==='fill'||variable.source==='scenario'||variable.source==='inflow'||variable.source==='outflow')return;
      const initial=Number(variable.startValue??variable.value??0);
      const target=Number(variable.targetValue??initial);
      const current=Number(variable.value)||0;
      const step=Math.abs(target-initial)/Math.max(.1,Number(variable.durationSeconds??10))*Math.max(0,seconds);
      if(mode==='rise'&&target>current)variable.value=Math.min(target,current+step);
      if(mode==='fall'&&target<current)variable.value=Math.max(target,current-step);
      if(variable.type==='level'&&variable.unit==='%')variable.value=Math.max(0,Math.min(100,Number(variable.value)));
      if(variable.type==='pressure'||variable.type==='flow')variable.value=Math.max(0,Number(variable.value));
    }
  }

  class CurrentController {
    constructor(controller) { this.controller=controller; }
    evaluate(incoming) {
      const current=convertResult(incoming,'mA');
      if(!current||!Number.isFinite(current.value))return null;
      const controller=this.controller;
      if(controller.controlMode==='on_off') {
        const on=Number(controller.onCurrent??15.2),off=Number(controller.offCurrent??9.76);
        const low=controller.switchDirection==='low';
        if(low){
          if(current.value<=on)controller.active=true;
          else if(current.value>=off)controller.active=false;
        } else {
          if(current.value>=on)controller.active=true;
          else if(current.value<=off)controller.active=false;
        }
        return {value:controller.active?Number(controller.activeOutput??20):Number(controller.inactiveOutput??4),unit:'mA',input:current};
      }
      const inputLow=Number(controller.inputLow??4),inputHigh=Number(controller.inputHigh??20);
      if(inputHigh===inputLow)return null;
      const fraction=Math.max(0,Math.min(1,(current.value-inputLow)/(inputHigh-inputLow)));
      const outputLow=Number(controller.outputLow??4),outputHigh=Number(controller.outputHigh??20);
      return {value:outputLow+fraction*(outputHigh-outputLow),unit:'mA',input:current};
    }
  }

  class ProcessAction {
    constructor(process,action) { this.process=process;this.action=action; }
    apply(opening,seconds) {
      const action=this.action;
      if(action.processId&&action.processId!==this.process.id)return false;
      const fill=action.variableId==='__fill__'&&this.process.simulationMode==='volume';
      if(fill&&this.process.fixed)return false;
      const variable=fill?{value:Number(this.process.fill)||0,type:'level',unit:'%'}:this.process.variables?.find(item=>item.id===action.variableId);
      if(!variable||!Number.isFinite(Number(variable.value)))return false;
      if(!fill&&['fill','scenario','inflow','outflow'].includes(variable.source))return false;
      const strength=action.when==='closed'?1-Math.max(0,Math.min(100,opening))/100:Math.max(0,Math.min(100,opening))/100;
      if(strength<=0)return false;
      if(action.effect==='set') {
        if(strength<.5)return false;
        variable.value=Number(action.targetValue??0);
      } else {
        const delta=Math.max(0,Number(action.rate??0))*Math.max(0,seconds)*strength;
        variable.value=Number(variable.value)+(action.effect==='increase'?delta:-delta);
      }
      if(variable.type==='level'&&variable.unit==='%')variable.value=Math.max(0,Math.min(100,variable.value));
      if(variable.type==='pressure'||variable.type==='flow')variable.value=Math.max(0,variable.value);
      if(fill)this.process.fill=variable.value;
      return true;
    }
  }

  class ProcessVariableSource {
    constructor(process, variable) { this.process=process; this.variable=variable; }
    read() {
      const {process,variable}=this;
      let source;
      if(variable.source==='scenario') {
        if(variable.type!=='pressure'||process.simulationMode!=='guided_pressure')return null;
        source={value:new GuidedPressureScenario(process).pressure,unit:process.pressureUnit||'kPa'};
      } else if(variable.source==='fill') {
        if(variable.type!=='level'||process.simulationMode==='guided_pressure')return null;
        source={value:Math.max(0,Math.min(100,Number(process.fill)||0)),unit:'%'};
      } else if(variable.source==='inflow'||variable.source==='outflow') {
        if(variable.type!=='flow')return null;
        source={value:Number(process[variable.source])||0,unit:'m³/h'};
      } else {
        source={value:Number(variable.value)||0,unit:variable.unit||'%'};
      }
      return convertResult(source,variable.unit||source.unit);
    }
  }

  function compatibleMeasurement(type, reading) {
    if(!reading||reading.value===undefined)return false;
    const expected=String(type||'').replace(/^switch_/,'');
    const actual=baseMagnitude(reading.value,reading.unit).dimension;
    return expected==='level' ? actual==='level'||actual==='percent' : actual===expected;
  }

  class SwitchHysteresis {
    constructor(device) { this.device=device; }
    evaluate(reading) {
      const device=this.device;
      if(!compatibleMeasurement(device.measurement||device.variableType,reading))return null;
      const unit=device.thresholdUnit||device.unit||reading.unit;
      const observed=convertResult(reading,unit);
      if(!observed)return null;
      const direction=device.switchDirection||(device.comparison==='less'?'low':'high');
      const on=Number(device.onThreshold??device.threshold??0);
      const off=Number(device.offThreshold??device.threshold??0);
      const active=Boolean(device.switchOn);
      if(direction==='low') {
        if(observed.value<=on)device.switchOn=true;
        else if(observed.value>=off)device.switchOn=false;
      } else {
        if(observed.value>=on)device.switchOn=true;
        else if(observed.value<=off)device.switchOn=false;
      }
      return {on:Boolean(device.switchOn),unit:'ON/OFF',engineering:observed,previous:active};
    }
  }

  const api = {baseMagnitude,convertResult,GuidedPressureScenario,PressureThresholdControl,
    ValveActuator,VariableTrend,CurrentController,ProcessAction,ProcessVariableSource,compatibleMeasurement,SwitchHysteresis};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.InstrumentaSimulation = api;
})();
