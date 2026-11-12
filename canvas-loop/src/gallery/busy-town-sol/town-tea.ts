import type { View } from "@ianbicking/canvas-loop";

const INK = "#35454c";

function mark(v: View, points: [number, number][], color: string, width = 3): void {
  v.noFill(); v.stroke(color); v.strokeWeight(width); v.brush("ink");
  v.gesture({ pressure: "taper", wobble: 0.65 }); v.curve(points);
}

function block(v: View, x: number, y: number, w: number, h: number, color: string): void {
  v.noStroke(); v.fill(color); v.rect(x, y, w, h);
  v.noFill(); v.stroke(INK); v.strokeWeight(2.5); v.brush("ink"); v.rect(x, y, w, h);
}

function window(v: View, x: number, y: number, color: string): void {
  block(v, x, y, 47, 56, "#f6d497");
  v.noStroke(); v.fill(color); v.rect(x + 6, y + 7, 35, 39);
  v.fill("#ffffff8a"); v.rect(x + 9, y + 9, 4, 25);
  mark(v, [[x+23,y+5],[x+23,y+48]], INK, 2);
  block(v, x - 4, y + 49, 55, 8, "#efbd7b");
}

export function paintOccupiedWindowTrim(v: View): void {
  for (const x of [105, 219, 425, 539, 747]) {
    v.noStroke(); v.fill("#ead0a0"); v.rect(x, 277, 47, 7);
    v.fill("#614e4b"); v.rect(x - 4, 283, 55, 3);
    v.fill("#f7dfb7"); v.rect(x, 228, 3, 49); v.rect(x + 44, 228, 3, 49);
  }
}

function shop(v: View, x: number, w: number, color: string, name: string, awning: string): void {
  block(v, x, 185, w, 326, color);
  block(v, x - 7, 170, w + 14, 20, "#f5d5a5");
  for (let i = 0; i < 5; i += 1) {
    const wx = x + 24 + i * ((w - 72) / 4);
    window(v, wx, 228, i % 2 ? "#7ac4bc" : "#94cfc9");
  }
  v.noStroke(); v.fill("#fdf0d5"); v.rect(x + 7, 355, w - 14, 66);
  v.fill(awning); v.rect(x + 6, 416, w - 12, 22);
  for (let i = 0; i < 8; i += 1) {
    v.fill(i % 2 ? "#fff2d1" : awning); v.rect(x + 8 + i * ((w - 16) / 8), 438, (w - 16) / 8, 32);
  }
  block(v, x + 20, 476, 64, 35, "#eed5a7");
  v.noStroke(); v.fill(INK); v.textAlign("center"); v.textFont("Georgia"); v.textStyle("bold"); v.textSize(20); v.text(name, x + w / 2, 399); v.textStyle("normal");
}

function stars(v:View,dusk:boolean):void{
  if(!dusk)return;
  v.noStroke();v.fill("#f8e8bc");
  for(let i=0;i<18;i+=1)v.circle(18+i*53,33+(i*43)%95,2+i%3);
}

export function paintTown(v: View, dusk: boolean): void {
  v.paper({ scale: 3, contrast: 0.7, seed: 21 });
  v.background(dusk ? "#506984" : "#b8e1d8");
  stars(v,dusk);
  v.noStroke(); v.fill(dusk ? "#f7e2a8" : "#fff0b8"); v.circle(846, 83, 80);
  v.fill(dusk ? "#7295a2" : "#eaf3d7");
  for (let i = 0; i < 8; i += 1) v.ellipse(i * 147 - 30, 140 + i % 2 * 13, 165, 57);
  // Rooflines are staggered so the page reads as a street rather than a grid.
  shop(v, 24, 300, "#e9a77e", "BUN & BELL", "#bf6a62");
  shop(v, 344, 302, "#f4cc86", "POST & PARCEL", "#6d9e9d");
  shop(v, 665, 309, "#a9c6aa", "ODD & ENDS", "#e89d71");
  v.noStroke(); v.fill("#865e5a"); v.triangle(12,170,174,86,335,170);
  v.fill("#557b82"); v.triangle(333,170,495,100,656,170);
  v.fill("#6e8f77"); v.triangle(654,170,815,79,985,170);
  for (let x = 55; x < 970; x += 28) mark(v, [[x,171],[x+15,163]], "#fbe7bb", 2);
  for(let roof=0;roof<3;roof+=1){
    const left=roof*322+24;
    for(let row=0;row<3;row+=1)for(let i=0;i<8-row;i+=1){
      const x=left+21+i*35+row*17,y=151-row*17;
      mark(v,[[x,y],[x+18,y-4]],"#f1d4ad8c",1.5);
    }
  }
  block(v,72,104,34,44,"#a26b61");
  block(v,718,100,33,43,"#789b81");
  v.noFill();v.stroke("#f8e5be");v.strokeWeight(3);
  for(let i=0;i<3;i+=1)v.arc(90+i*7,81-i*15,18,0,Math.PI);
  // Shop displays, doors, and tiny objects make the static plate worth searching.
  for (const x of [39, 358, 681]) {
    block(v, x + 3, 476, 118, 52, "#e8f2dc");
    v.noStroke(); v.fill("#d38869");
    for (let i = 0; i < 4; i += 1) v.ellipse(x+20+i*26, 503, 19, 12);
  }
  // Tiny notices, parcels, bread and a signpost break up the long façade.
  for(const [x,y] of [[288,306],[610,306],[936,306]] as const){
    block(v,x,y,25,31,"#f9e7c4");
    mark(v,[[x+5,y+10],[x+18,y+10]],"#9b7e6d",1.4);
    mark(v,[[x+5,y+18],[x+15,y+18]],"#9b7e6d",1.4);
  }
  // Three distinct windows at pavement level: pastries, mail, and curios.
  for(let i=0;i<5;i+=1){
    v.noStroke();v.fill(i%2?"#e5ad74":"#b66c55");
    v.ellipse(56+i*30,490+i%2*6,24,13);
    v.fill("#f6dda4");v.circle(61+i*30,487+i%2*6,3);
  }
  for(let i=0;i<4;i+=1){
    block(v,376+i*32,482-i%2*7,22,23,"#d2a479");
    mark(v,[[380+i*32,487-i%2*7],[392+i*32,499-i%2*7]],"#9e765f",1.5);
  }
  for(let i=0;i<5;i+=1){
    v.noStroke();v.fill(["#f0d18a","#90b4b0","#d78b73"][i%3]??"#f0d18a");
    v.circle(702+i*34,492+i%2*7,14);
    v.fill("#4d6567");v.circle(702+i*34,492+i%2*7,4);
  }
  for(let i=0;i<3;i+=1){block(v,480+i*22,507-i*7,20,16,"#c9956e");}
  block(v,97,487,24,19,"#e7ad76");
  v.noStroke();v.fill("#8c614d");v.circle(107,489,5);
  mark(v,[[834,533],[834,468]],"#4d6564",4);
  block(v,810,452,53,20,"#f3d69e");
  v.noStroke();v.fill("#475d5c");v.textSize(10);v.textAlign("center");v.text("BUS STOP",836,466);
  block(v, 233, 472, 74, 69, "#765c59");
  block(v, 561, 472, 68, 69, "#668d8b");
  block(v, 878, 472, 76, 69, "#789272");
  v.fill("#f6dfa8"); v.circle(290,505,5); v.circle(611,505,5); v.circle(936,505,5);
  block(v, 0, 537, 1000, 43, "#ead6ab");
  v.noStroke(); v.fill("#7eaaac"); v.rect(0, 580, 1000, 120);
  mark(v, [[0,584],[250,581],[550,584],[1000,581]], "#e8f2d2", 4);
  for (let i = 0; i < 14; i += 1) {
    v.noStroke(); v.fill("#f1e7ba"); v.rect(i*79+7, 634, 41, 5);
  }
  // Lamp posts and planters frame little vignettes.
  for (const x of [17, 329, 650, 980]) {
    mark(v, [[x,561],[x,401]], "#45575a", 6);
    if(dusk){v.blendMode("screen");v.noStroke();v.fill(v.ellipseGradient(x,398,104,104,[[0,"#ffe6a4b3"],[1,"#ffe6a400"]]));v.ellipse(x,398,104,104);v.blendMode("normal");}
    v.noStroke(); v.fill("#f4d994"); v.circle(x,395,17);
    v.fill("#50615d"); v.rect(x-12,383,24,4);
  }
  for (const x of [122, 432, 757, 964]) {
    block(v,x,531,32,30,"#be896a");
    v.noStroke(); v.fill("#6d9b74");
    for (let i=0;i<5;i+=1) v.circle(x+4+i*6,526-i%2*8,14);
    v.fill("#f8c8a2"); v.circle(x+8,516,5); v.circle(x+25,519,5);
  }
  v.paperTexture(0.28);
}
