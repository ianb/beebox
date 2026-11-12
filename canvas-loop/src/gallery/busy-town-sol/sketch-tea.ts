import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";
import { paintTown } from "./town-tea.js";
import { THINGS, paintSprite, type Thing } from "./people-tea.js";

export const canvas = { width: 1000, height: 700 };
export const params = {
  dusk: { type: "boolean", default: false },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;
type Params = ParamValues<typeof params>;
export interface Model { frame: number; hover: string; acts: Readonly<Record<string, number>> }

export function init(): Model { return { frame: 0, hover: "", acts: {} }; }

function bounds(t: Thing, x: number, y: number): boolean {
  if(t.kind==="bus") return Math.abs(x-t.x)<81 && Math.abs(y-t.y)<44;
  if(t.kind==="flag") return x>t.x-6 && x<t.x+64 && y>t.y-75 && y<t.y+7;
  const upper=t.y<300;
  return Math.abs(x-t.x)<(upper?24:31) && y>t.y-(upper?67:83) && y<t.y+10;
}
function hit(x: number, y: number): string { return THINGS.findLast(t=>bounds(t,x,y))?.id ?? ""; }

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch(msg.type){
    case "tick": return { ...model, frame: msg.frame };
    case "mousemove": { const hover=hit(msg.x,msg.y); return hover===model.hover?model:{...model,hover}; }
    case "mousedown": {
      const id=hit(msg.x,msg.y);if(!id)return model;u.handled(id);
      const chain:Readonly<Record<string,string>>={baker:"sweeper",violinist:"skater",bus:"conductor",flag:"astronomer",clock:"mailcarrier"};
      const other=chain[id];
      return {...model,acts:{...model.acts,[id]:model.frame,...(other?{[other]:model.frame+8}:{})}};
    }
    case "trigger": return msg.name==="reset"?init():model;
    case "mouseup":
    case "keydown":
    case "keyup":
    case "param": return model;
  }
}

function label(v: View, text: string, x: number, y: number): void {
  v.noStroke();v.fill("#fff3d9");v.rect(x-34,y-17,68,20);
  v.fill("#405657");v.textSize(11);v.textAlign("center");v.text(text,x,y-3);
}

function notes(v: View,x: number,y: number,age: number): void {
  v.noStroke();v.fill("#506f86");v.textSize(22);v.text("♪",x+age*.5,y-age*.8);
  v.text("♫",x+14+age*.3,y-23-age*.5);
}

function actEffectA(v: View,t:Thing,age:number): void {
  const x=t.x,y=t.y, s=Math.sin(age*.2);
  v.noStroke();
  switch(t.act){
    case "loaf": v.fill("#e6ad69");v.ellipse(x+28,y-46-age*.08,31,16);for(let i=0;i<3;i+=1){v.fill("#fff4d8");v.circle(x+23+i*8,y-66-(age+i*13)%28,4);}break;
    case "sweep":v.stroke("#8a644d");v.strokeWeight(3);v.line(x+25,y-38,x+35+s*14,y+5);v.noStroke();v.fill("#e1cf9e");v.ellipse(x+35+s*14,y+5,22,7);break;
    case "letters":for(let i=0;i<4;i+=1){v.fill("#fff4d7");v.rect(x+10+i*8+age*.18,y-57-i*13-age*.3,15,10);}break;
    case "wave":v.fill("#f1dbab");v.circle(x+34,y-72+s*8,8);break;
    case "ladder":v.stroke("#956c54");v.strokeWeight(4);v.line(x+27,y-5,x+27+s*7,y-119);v.line(x+48,y-5,x+48+s*7,y-119);for(let i=0;i<5;i+=1)v.line(x+27+s*7,y-16-i*20,x+48+s*7,y-16-i*20);break;
    case "water":v.fill("#85afc9");for(let i=0;i<6;i+=1)v.circle(x+20+i*7,y-30+((age+i*9)%40),4);break;
    case "music":notes(v,x,y-78,age);break;
    case "cloth":v.fill("#da8b8b");v.triangle(x+24,y-54,x+75+s*9,y-67,x+67,y-16);break;
    default:break;
  }
}

function actEffectB(v: View,t:Thing,age:number,frame:number): void {
  const x=t.x,y=t.y,s=Math.sin(age*.2);
  v.noStroke();
  switch(t.act){
    case "books":for(let i=0;i<4;i+=1){v.fill(i%2?"#d58f67":"#6a9690");v.rect(x+23+i*9,y-46-(age%18)*.5-i*5,7,20);}break;
    case "stars":for(let i=0;i<5;i+=1){v.fill("#f9e5a0");v.circle(x-44+i*19,y-89+Math.sin(frame*.12+i)*9,4+(i%2)*3);}break;
    case "whistle":notes(v,x,y-72,age*.6);break;
    case "wheel":v.noFill();v.stroke("#4c6266");v.strokeWeight(3);v.circle(x+20,y-4,30+age*.3);v.circle(x-24,y-4,30+age*.3);break;
    case "spin":v.noFill();v.stroke("#e8bd83");v.strokeWeight(3);v.arc(x,y-45,35,age*.13,age*.13+Math.PI*1.5);break;
    case "drive":v.fill("#e8ddc4");for(let i=0;i<3;i+=1)v.ellipse(x-90-i*14,y+16,19,8);break;
    case "flutter":v.fill("#f2c36f");v.circle(x+61,y-50+s*8,5);break;
    case "chime":v.noFill();v.stroke("#eecb7e");v.strokeWeight(3);v.circle(x,y-27,65+age*.8);break;
    case "bloom":v.fill("#f8dfa1");for(let i=0;i<5;i+=1)v.circle(x-24+i*12,y-59-age*.38,4);break;
    default:break;
  }
}

function drawThing(v: View,t:Thing,model:DeepReadonly<Model>):void{
  const age=model.frame-(model.acts[t.id]??-1000);
  const active=age>=0&&age<72;
  const hovered=model.hover===t.id;
  const bus=t.kind==="bus";
  const flag=t.kind==="flag";
  const special=bus||flag||t.kind==="clock"||t.kind==="flowers";
  const width=bus?152:flag?70:special?72:56;
  const height=bus?78:flag?76:special?72:84;
  const pose=active&&age%28<18;
  const sprite=v.sprite({key:`town-${t.id}-${pose?"act":"idle"}`,width,height},()=>paintSprite(v,t,pose));
  const idle=Math.sin(model.frame*.055+t.x)*1.4;
  const hop=hovered?Math.sin(model.frame*.22)*3.8:0;
  const busShift=bus&&active?Math.sin(Math.min(age,70)/70*Math.PI)*96:0;
  v.push();v.translate(t.x+busShift,t.y+idle-hop);
  if(t.y<300&&!special)v.scale(.75);
  if(!special){
    const angle=active?(t.act==="spin"?age*.13:Math.sin(age*.22)*.09):Math.sin(model.frame*.045+t.x)*.012;
    v.rotate(angle);
  } else if(flag) v.rotate(Math.sin(model.frame*.11)*.035);
  v.image(sprite,-width/2,-height);
  v.pop();
  if(active){actEffectA(v,t,age);actEffectB(v,t,age,model.frame);}
  if(hovered){
    v.noFill();v.stroke("#fff6ce");v.strokeWeight(2);v.circle(t.x,t.y-height*.56,Math.min(width,66)+8+Math.sin(model.frame*.25)*4);
    label(v,t.id.toUpperCase(),t.x,t.y-height-8);
  }
}

export function draw(v:View,model:DeepReadonly<Model>,p:Params):void{
  v.cache(`busy-town-${p.dusk}`,()=>paintTown(v,p.dusk));
  for(const t of THINGS)drawThing(v,t,model);
  // A few tiny looping marks make the printed street breathe even at rest.
  v.noFill();v.stroke("#f9edcd");v.strokeWeight(2);
  for(let i=0;i<3;i+=1){const x=52+i*324;const dy=Math.sin(model.frame*.06+i)*5;v.arc(x,533+dy,10,0,Math.PI);}
  v.noStroke();v.fill("#4a6262");v.textAlign("left");v.textSize(11);
  v.text("WILLOW WICK • click anyone and see what happens",27,686);
}
