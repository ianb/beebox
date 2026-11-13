import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";

const P = (x: number, y: number): Vec2 => [x, y];

function shape(s: Sketch, points: Vec2[], color: string, edge = "#314542", weight = 3): void {
  s.fill(color);
  s.noStroke();
  s.curve(points, true);
  s.noFill();
  s.stroke(edge);
  s.strokeWeight(weight);
  s.brush("ink", { thinning: 0.18 });
  s.gesture({ pressure: "even", wobble: 0.7 });
  s.curve(points, true);
}

function mark(s: Sketch, points: Vec2[], color: string, weight: number, brush: "ink" | "bristle" | "chalk" | "pencil" | "wash" = "ink"): void {
  s.noFill();
  s.stroke(color);
  s.strokeWeight(weight);
  s.brush(brush);
  s.gesture({ pressure: "taper", wobble: brush === "ink" ? 0.7 : 1.5 });
  s.curve(points);
}

function dot(s: Sketch, x: number, y: number, r: number, color: string): void {
  s.noStroke();
  s.fill(color);
  s.circle(x, y, r * 2);
}

export function setup(s: Sketch): void {
  s.createCanvas(700, 700);
}

export function draw(s: Sketch): void {
  s.paper({ scale: 3.5, contrast: 0.8, seed: 8 });
  s.background(s.linearGradient(0, 0, 0, 700, [
    [0, "#263d68"], [0.4, "#775e87"], [0.7, "#df9b85"], [1, "#f3c293"],
  ]));

  // Brush light into the dusk, then let the distant land cover its lower edge.
  s.group({ opacity: 0.25 }, () => {
    for (let i = 0; i < 18; i += 1) {
      const y = 27 + i * 26;
      mark(s, [P(-30, y + 8), P(140, y - 8), P(330, y + 11), P(560, y - 5), P(735, y + 3)],
        i % 3 === 0 ? "#e5b4ac" : "#bda5bd", 12 + i % 4 * 5, "bristle");
    }
  });
  s.group({ opacity: 0.32 }, () => {
    mark(s, [P(-50, 151), P(48, 140), P(125, 147), P(204, 132)], "#f6ccd1", 18, "wash");
    mark(s, [P(76, 171), P(157, 160), P(256, 171)], "#dfbad3", 12, "bristle");
    mark(s, [P(369, 207), P(445, 202), P(515, 211)], "#f5c8c0", 14, "wash");
    mark(s, [P(398, 226), P(476, 220), P(548, 230)], "#f5c8c0", 8, "bristle");
  });
  s.group({ opacity: 0.5, blend: "screen" }, () => {
    s.noFill();
    s.stroke("#ffd5a5");
    s.strokeWeight(90);
    s.brush("airbrush");
    s.line(540, 128, 540, 128);
  });
  dot(s, 542, 133, 55, "#ffe1ad");
  s.noFill();
  s.stroke("#fff2cf");
  s.strokeWeight(3);
  s.brush("chalk");
  s.circle(542, 133, 108);
  s.group({ opacity: 0.28 }, () => {
    mark(s, [P(513, 114), P(527, 106), P(545, 109)], "#dfac8e", 8, "wash");
    mark(s, [P(548, 154), P(563, 145), P(579, 148)], "#dfac8e", 10, "wash");
    mark(s, [P(512, 156), P(528, 160)], "#fff4d0", 7, "bristle");
  });

  for (let i = 0; i < 34; i += 1) {
    const x = 29 + (i * 107) % 645;
    const y = 25 + (i * 67) % 240;
    if ((x - 542) ** 2 + (y - 133) ** 2 > 85 ** 2) dot(s, x, y, i % 5 === 0 ? 2.2 : 1.1, "#fce3c5");
  }

  shape(s, [P(-50, 440), P(70, 400), P(195, 424), P(335, 381), P(485, 411), P(620, 371), P(760, 413), P(760, 700), P(-50, 700)], "#847b91", "#746e87", 2);
  s.group({ opacity: 0.3 }, () => {
    mark(s, [P(-20, 449), P(95, 423), P(214, 444)], "#c3a6aa", 15, "bristle");
    mark(s, [P(360, 414), P(456, 432), P(558, 406), P(681, 403)], "#c3a6aa", 13, "bristle");
  });
  shape(s, [P(-60, 500), P(105, 465), P(225, 496), P(390, 455), P(565, 489), P(760, 454), P(760, 700), P(-60, 700)], "#546f78", "#526870", 2);
  s.group({ opacity: 0.25 }, () => {
    mark(s, [P(-10, 512), P(110, 482), P(234, 514)], "#91a2a4", 18, "bristle");
    mark(s, [P(386, 484), P(489, 508), P(603, 501), P(709, 481)], "#91a2a4", 15, "bristle");
  });

  // A ribbon of meadow curls toward the ship.
  shape(s, [P(-40, 580), P(120, 536), P(275, 547), P(427, 514), P(590, 547), P(755, 515), P(755, 740), P(-40, 740)], "#536f55", "#405b56", 3);
  s.group({ opacity: 0.27 }, () => {
    mark(s, [P(-20, 594), P(90, 554), P(204, 563)], "#b8ae75", 16, "bristle");
    mark(s, [P(430, 538), P(530, 561), P(647, 549), P(716, 540)], "#b8ae75", 17, "bristle");
  });
  shape(s, [P(-40, 634), P(95, 607), P(247, 625), P(385, 588), P(547, 610), P(740, 568), P(755, 740), P(-40, 740)], "#426850", "#35584f", 2);
  s.group({ opacity: 0.24 }, () => {
    mark(s, [P(-20, 657), P(94, 629), P(174, 643)], "#a3aa71", 19, "bristle");
    mark(s, [P(389, 612), P(495, 631), P(616, 607), P(718, 592)], "#a3aa71", 18, "bristle");
  });
  for (let i = 0; i < 115; i += 1) {
    const x = (i * 83 + 17) % 700;
    const base = 556 + ((i * 67) % 150);
    const h = 9 + i % 6 * 4;
    mark(s, [P(x - 3, base), P(x, base - h), P(x + 3, base - h - 5)], i % 5 === 0 ? "#e9b47a" : i % 3 === 0 ? "#a5a66a" : "#819d68", i % 4 === 0 ? 3 : 2, i % 3 === 0 ? "bristle" : "pencil");
  }

  // The little visitor carries a warm lamp away through the evening.
  s.group({ opacity: 0.55, blend: "screen" }, () => {
    s.noFill(); s.stroke("#ffe0a0"); s.strokeWeight(54); s.brush("airbrush");
    s.line(576, 272, 576, 272);
  });
  mark(s, [P(481, 296), P(505, 300), P(526, 295)], "#ffe1ac", 5, "chalk");
  mark(s, [P(455, 308), P(481, 312)], "#ffe1ac", 3, "chalk");
  shape(s, [P(508, 270), P(533, 253), P(577, 247), P(624, 257), P(647, 275), P(627, 289), P(570, 299), P(527, 287)], "#d9ae8d", "#493d61", 3.5);
  shape(s, [P(534, 256), P(549, 235), P(579, 227), P(610, 239), P(623, 257)], "#8bb6a8", "#493d61", 3);
  mark(s, [P(533, 273), P(572, 281), P(615, 272)], "#fff0c9", 6, "bristle");
  dot(s, 554, 272, 4, "#fff1b4"); dot(s, 590, 276, 4, "#fff1b4"); dot(s, 623, 270, 4, "#fff1b4");
  shape(s, [P(566, 244), P(571, 234), P(581, 233), P(588, 243), P(583, 251), P(571, 251)], "#b9d67b", "#475653", 1.5);
  dot(s, 574, 242, 2, "#253c49"); dot(s, 582, 242, 2, "#253c49");
  mark(s, [P(584, 246), P(593, 240), P(596, 231)], "#475653", 2.5);
  dot(s, 597, 230, 3, "#b9d67b");

  // Cast shadow, legs, and a little satchel precede the body.
  s.noStroke(); s.fill("#304f51"); s.ellipse(266, 615, 218, 31);
  shape(s, [P(214, 545), P(242, 543), P(243, 591), P(234, 605), P(214, 598)], "#6daa69", "#315549", 3);
  shape(s, [P(285, 543), P(313, 538), P(317, 590), P(306, 605), P(286, 599)], "#6daa69", "#315549", 3);
  shape(s, [P(201, 594), P(223, 584), P(249, 593), P(251, 608), P(203, 609)], "#86c779", "#315549", 3);
  shape(s, [P(279, 594), P(301, 584), P(325, 592), P(331, 608), P(282, 609)], "#86c779", "#315549", 3);

  // Far arm, waving arm, then the round pear silhouette.
  mark(s, [P(204, 456), P(173, 497), P(162, 540)], "#315549", 34);
  mark(s, [P(204, 456), P(173, 497), P(162, 540)], "#77b66e", 27);
  dot(s, 160, 544, 16, "#86c779");
  mark(s, [P(311, 454), P(359, 437), P(387, 399), P(403, 363)], "#315549", 38);
  mark(s, [P(311, 454), P(359, 437), P(387, 399), P(403, 363)], "#79ba72", 31);
  shape(s, [P(394, 348), P(413, 341), P(426, 353), P(427, 370), P(410, 379), P(392, 367)], "#91ce77", "#315549", 3);
  mark(s, [P(425, 357), P(434, 343)], "#315549", 3);
  mark(s, [P(419, 347), P(425, 339)], "#4b8055", 1.8, "pencil");
  mark(s, [P(413, 345), P(416, 338)], "#4b8055", 1.8, "pencil");
  shape(s, [P(226, 425), P(257, 410), P(291, 421), P(316, 459), P(327, 519), P(314, 566), P(282, 580), P(223, 576), P(193, 557), P(196, 502)], "#87c979", "#315549", 3.5);
  s.clip(s.curvePath([P(226, 425), P(257, 410), P(291, 421), P(316, 459), P(327, 519), P(314, 566), P(282, 580), P(223, 576), P(193, 557), P(196, 502)], true), () => {
    for (let i = 0; i < 17; i += 1) mark(s, [P(197 + i * 8, 450), P(219 + i * 8, 493), P(220 + i * 8, 565)], i % 2 ? "#a6dd87" : "#5da665", 5, "bristle");
  });
  shape(s, [P(237, 493), P(266, 485), P(287, 503), P(293, 530), P(271, 550), P(244, 540)], "#6cb76e", "#6cb76e", 1);
  // A small travel bag gives the walk a destination.
  mark(s, [P(286, 450), P(320, 476), P(328, 513)], "#d6ad76", 8, "bristle");
  shape(s, [P(313, 504), P(343, 495), P(352, 518), P(343, 545), P(312, 540)], "#dcaa70", "#5e5750", 3);
  shape(s, [P(314, 505), P(342, 501), P(347, 517), P(316, 520)], "#eec48d", "#5e5750", 2);
  dot(s, 332, 519, 3, "#7b6a4e");

  // A yellow scarf catches the last warm light and points back along the path.
  shape(s, [P(213, 407), P(232, 419), P(283, 420), P(314, 407), P(314, 426), P(281, 439), P(235, 435), P(211, 424)], "#eec57d", "#80634d", 2.5);
  shape(s, [P(223, 421), P(205, 435), P(171, 440), P(189, 452), P(218, 445), P(236, 430)], "#eec57d", "#80634d", 2.5);
  mark(s, [P(186, 444), P(206, 439), P(218, 431)], "#fff0b1", 4, "bristle");

  // Antennae rise behind a softly irregular oval head.
  mark(s, [P(223, 323), P(200, 267), P(184, 226)], "#315549", 7);
  mark(s, [P(293, 316), P(320, 261), P(343, 220)], "#315549", 7);
  dot(s, 183, 221, 14, "#f4d66a"); dot(s, 344, 216, 14, "#f4d66a");
  shape(s, [P(172, 331), P(182, 291), P(215, 263), P(259, 250), P(311, 265), P(348, 299), P(357, 342), P(345, 382), P(311, 409), P(258, 417), P(206, 401), P(174, 371)], "#91d47d", "#315549", 4);
  s.clip(s.curvePath([P(172, 331), P(182, 291), P(215, 263), P(259, 250), P(311, 265), P(348, 299), P(357, 342), P(345, 382), P(311, 409), P(258, 417), P(206, 401), P(174, 371)], true), () => {
    for (let i = 0; i < 18; i += 1) mark(s, [P(176 + i * 12, 275), P(187 + i * 12, 329), P(171 + i * 12, 389)], i % 3 ? "#b0df8b" : "#67b876", 5, "bristle");
  });
  mark(s, [P(190, 326), P(213, 285), P(257, 270)], "#d2ed9d", 13, "wash");
  // The eye at right follows the departing friend.
  shape(s, [P(199, 330), P(204, 309), P(221, 298), P(240, 307), P(246, 332), P(238, 352), P(216, 354)], "#fff9e8", "#315549", 3);
  shape(s, [P(278, 325), P(284, 303), P(302, 296), P(322, 307), P(326, 330), P(317, 348), P(295, 348)], "#fff9e8", "#315549", 3);
  dot(s, 228, 329, 12, "#273e3e"); dot(s, 309, 324, 12, "#273e3e");
  dot(s, 232, 321, 4, "#ffffff"); dot(s, 313, 316, 4, "#ffffff");
  s.group({ opacity: 0.48 }, () => { dot(s, 194, 363, 13, "#e99782"); dot(s, 330, 358, 13, "#e99782"); });
  mark(s, [P(247, 366), P(260, 374), P(274, 372), P(284, 364)], "#315549", 3.5);

  mark(s, [P(394, 358), P(401, 364), P(409, 365)], "#4e875a", 2, "pencil");

  // Foreground seed heads and three lit flowers keep the eye on the hill.
  for (const [x, y, c] of [[67, 619, "#f2cb8b"], [112, 665, "#eed997"], [524, 635, "#f4c28a"], [607, 591, "#ebdcaa"]] as const) {
    mark(s, [P(x, y + 58), P(x + 2, y + 27), P(x, y)], "#9eb77b", 3, "bristle");
    for (let j = 0; j < 5; j += 1) dot(s, x + Math.cos(j * 1.256) * 10, y + Math.sin(j * 1.256) * 10, 5, c);
    dot(s, x, y, 5, "#b76e61");
  }
  mark(s, [P(29, 686), P(150, 676), P(246, 687)], "#d0b284", 9, "bristle");
  mark(s, [P(425, 691), P(565, 680), P(710, 685)], "#c0a374", 8, "bristle");
  for (const [x, y, flip] of [[25, 674, 1], [139, 607, -1], [365, 665, 1], [645, 652, -1]] as const) {
    mark(s, [P(x, y + 27), P(x, y + 5), P(x + 4 * flip, y - 19)], "#acc183", 4, "bristle");
    shape(s, [P(x, y + 13), P(x + 12 * flip, y + 2), P(x + 25 * flip, y + 2), P(x + 14 * flip, y + 14)], "#839c6e", "#5f7d62", 1.2);
    shape(s, [P(x, y + 7), P(x - 14 * flip, y - 8), P(x - 26 * flip, y - 4), P(x - 9 * flip, y + 12)], "#90ac78", "#5f7d62", 1.2);
  }
}
