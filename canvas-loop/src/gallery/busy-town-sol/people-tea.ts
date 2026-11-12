import type { View } from "@ianbicking/canvas-loop";

export type Kind = "fox" | "bear" | "cat" | "mouse" | "rabbit" | "dog" | "bird" | "frog";
export interface Thing { id: string; x: number; y: number; kind: Kind | "bus" | "flag" | "clock" | "flowers"; color: string; act: string }

export const THINGS: readonly Thing[] = [
  {id:"baker",x:87,y:482,kind:"bear",color:"#b87955",act:"loaf"},
  {id:"sweeper",x:183,y:493,kind:"fox",color:"#cd7952",act:"sweep"},
  {id:"mailcarrier",x:395,y:488,kind:"rabbit",color:"#e6d3a7",act:"letters"},
  {id:"shopkeeper",x:724,y:490,kind:"frog",color:"#79a474",act:"wave"},
  {id:"painter",x:906,y:483,kind:"dog",color:"#cba27a",act:"ladder"},
  {id:"gardener",x:129,y:283,kind:"mouse",color:"#aeb0a1",act:"water"},
  {id:"violinist",x:243,y:283,kind:"cat",color:"#bd927d",act:"music"},
  {id:"tailor",x:449,y:283,kind:"fox",color:"#cb8c63",act:"cloth"},
  {id:"librarian",x:563,y:283,kind:"bear",color:"#a78e74",act:"books"},
  {id:"astronomer",x:770,y:283,kind:"rabbit",color:"#e7d4aa",act:"stars"},
  {id:"conductor",x:44,y:566,kind:"bird",color:"#668ca0",act:"whistle"},
  {id:"cyclist",x:315,y:564,kind:"mouse",color:"#a8a79d",act:"wheel"},
  {id:"skater",x:550,y:564,kind:"cat",color:"#db9e83",act:"spin"},
  {id:"bus",x:749,y:604,kind:"bus",color:"#e3a15b",act:"drive"},
  {id:"flag",x:471,y:153,kind:"flag",color:"#db725f",act:"flutter"},
  {id:"clock",x:496,y:392,kind:"clock",color:"#f1d99d",act:"chime"},
  {id:"flowers",x:805,y:538,kind:"flowers",color:"#e8a58d",act:"bloom"},
];

function paintSpecial(v:View,thing:Thing,pose:boolean):boolean{
  const {kind,color}=thing;
  v.noStroke();
  if (kind === "bus") {
    v.fill("#dc8f57"); v.rect(1,8,149,56); v.fill("#f6d391"); v.rect(13,15,123,28);
    v.fill("#668e9c"); for(let i=0;i<4;i+=1)v.rect(20+i*29,19,22,19);
    v.fill("#3e5357"); v.circle(30,66,21); v.circle(119,66,21);
    v.fill("#f8eed0"); v.textSize(13); v.textAlign("center"); v.text("TOWN LOOP",75,57);
    return true;
  }
  if(kind==="flag") { v.fill("#534c4b");v.rect(4,0,4,72);v.fill(color);v.triangle(8,5,pose?57:50,pose?21:9,8,36);return true; }
  if(kind==="clock") {v.fill("#f7dfad");v.circle(30,30,54);v.fill("#586d70");v.circle(30,30,46);v.fill("#f9edce");v.circle(30,30,40);v.stroke("#344a4c");v.strokeWeight(3);v.line(30,30,pose?39:30,14);v.line(30,30,pose?22:42,35);return true;}
  if(kind==="flowers") {v.fill("#b07963");v.rect(3,34,65,32);for(let i=0;i<6;i+=1){const x=10+i*10;v.stroke("#668f68");v.strokeWeight(2);v.line(x,39,x,pose?13:19);v.noStroke();v.fill(i%2?"#edacaa":"#f1d68d");v.circle(x,pose?13:19,13);}return true;}
  return false;
}

function outfit(id:string):string{
  if(id==="baker")return "#f4ead4";
  if(id==="mailcarrier")return "#54849d";
  if(id==="shopkeeper")return "#d4a765";
  if(id==="painter")return "#ebe6c8";
  if(id==="astronomer")return "#71728d";
  if(id==="violinist")return "#b86662";
  return "#547d82";
}

function props(v:View,thing:Thing):void{
  if(thing.id==="baker"){v.noStroke();v.fill("#f9f1db");v.rect(13,5,30,8);v.rect(19,0,18,10);}
  if(thing.id==="mailcarrier"){v.noStroke();v.fill("#d9ae70");v.rect(34,52,16,13);}
  if(thing.id==="painter"){v.noStroke();v.fill("#d27c60");v.rect(14,6,28,6);}
  if(thing.id==="sweeper"){v.stroke("#9b7156");v.strokeWeight(2);v.line(50,52,54,82);v.noStroke();v.fill("#e5c99d");v.ellipse(54,80,13,5);}
  if(thing.id==="gardener"){v.noStroke();v.fill("#89aec0");v.ellipse(47,65,17,13);v.rect(40,54,15,9);}
  if(thing.id==="violinist"){v.noStroke();v.fill("#a86f49");v.ellipse(44,58,17,10);v.stroke("#695648");v.strokeWeight(2);v.line(49,51,51,35);}
  if(thing.id==="tailor"){v.noStroke();v.fill("#dfb488");v.triangle(43,48,49,65,37,65);v.circle(43,51,6);}
  if(thing.id==="librarian"){v.noStroke();v.fill("#be8b61");v.rect(37,52,17,14);v.fill("#f8e4bd");v.rect(39,54,13,11);}
  if(thing.id==="astronomer"){v.stroke("#dfbc7d");v.strokeWeight(5);v.line(44,47,59,32);v.noStroke();v.fill("#f4d997");v.circle(58,32,9);}
  if(thing.id==="conductor"){v.noStroke();v.fill("#344f66");v.rect(11,7,34,7);v.rect(17,0,22,10);}
  if(thing.id==="cyclist"){v.noStroke();v.fill("#e8bf7c");v.rect(15,8,27,6);}
  if(thing.id==="skater"){v.noStroke();v.fill("#426b77");v.rect(17,4,26,6);}
}

export function paintSprite(v: View, thing: Thing, pose: boolean): void {
  const {kind,color}=thing;
  if(paintSpecial(v,thing,pose))return;
  v.noStroke();
  // A character is drawn around a fixed foot position in a 56×84 sprite.
  const ears=kind==="rabbit"?23:kind==="fox"||kind==="cat"?13:kind==="mouse"?10:0;
  v.fill("#495459");v.ellipse(19,76,16,8);v.ellipse(38,76,16,8);
  v.fill(outfit(thing.id));v.ellipse(28,57,36,40);
  if(kind==="fox"||kind==="cat") {v.fill(color);v.triangle(9,62,-3,pose?44:55,14,51);}
  v.fill(color);
  if(ears){v.ellipse(14,17,kind==="rabbit"?12:15,ears*1.6);v.ellipse(42,17,kind==="rabbit"?12:15,ears*1.6);}
  v.circle(28,27,39);
  v.fill("#f3d6ac");v.ellipse(28,35,24,17);
  v.fill("#263d43");v.circle(21,27,3.5);v.circle(35,27,3.5);v.circle(28,36,3);
  v.noFill();v.stroke("#34474a");v.strokeWeight(1.6);v.arc(28,39,5,0,Math.PI);
  v.stroke(color);v.strokeWeight(7);v.line(13,48,pose?2:8,pose?30:61);v.line(43,48,pose?55:49,pose?32:61);
  if(kind==="bird"){v.noStroke();v.fill("#e7bc70");v.triangle(28,34,48,38,28,42);}
  props(v,thing);
}
