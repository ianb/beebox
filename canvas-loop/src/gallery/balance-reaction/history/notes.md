# balance-reaction: cycle notes

## Cycle 1
Intent: first full layout. Title, equation with typed-box coefficients (box A–D labels), two picture panels (reactants, products) with molecules as shaded atom balls repeated by coefficient, an atom-count card with mirrored dot rows per element and an = / ≠ chip, a status bar (hint or "Balanced!"), confetti and bobbing molecules when balanced. Script walks water, methane (overshoot B=3, then a doubled solution), rust (box D unused), propane (B=12 overshoot).
Seen: the structure reads. Problems: in the atom count the left-side number overlaps the element name ("Hydrogen (H4"). Molecules are small in roomy cells (scale cap 15). Fe₂O₃ is a clump with the iron hidden behind oxygen. On the first balanced frame the "Balanced!" title slides down into the subtitle. Draw avg 3.1 ms.

## Cycle 2
Intent: fix cycle 1's overlaps: atom-count numbers moved inboard (dot span 150), molecule size cap 15 → 24, Fe₂O₃ as an O=Fe-O-Fe=O zigzag with iron drawn last, no slide on the "Balanced!" title. Added a green strip behind the equation when balanced, and a red ring around every atom of an element that does not balance.
Seen: layout is clean, numbers clear, molecules big and readable, rust reads as a chain. The red rings on overlapping atoms make doubled, tangled outlines (CH₄'s carbon, H₂O, O₂ pairs). Draw avg 2.7 ms.

## Cycle 3
Intent: replace the red rings with a soft red halo behind each atom of an unbalanced element; show the ignored box D's value ("box D (4): not used"); add paper texture (0.35) to the cached background.
Seen: halos read cleanly and point straight at the problem element. The paper texture at 0.35 greys and speckles the cards: looks dirty. The confetti falls across the equation and the numbers the learner just typed, which is the opposite of what the moment should show. Draw avg 2.5 ms.

## Cycle 4
Intent: paper texture down to 0.12. Replace the confetti with stars that pop out, one after another, at both ends and along the bottom of the green equation strip, then twinkle; add a hand-drawn white tick (ink brush) at the right of the "Balanced!" bar.
Seen: the celebration no longer covers anything the learner needs; the tick and stars read as a reward. Paper texture is now a faint warmth. New problem: the green strip's top edge cuts through the subtitle ("Methane (natural gas) burns"), and the bottom-edge stars sit against the panel border. Draw avg 2.8 ms.

## Cycle 5
Intent: equation down 6 px and the green strip made shorter so it clears the subtitle; dropped the bottom-edge stars (two more small ones at the ends instead).
Seen: subtitle and strip no longer touch; stars sit in the margins. Two smaller faults: the "divide by 2" sentence runs under the tick; in C₃H₈ the top and bottom hydrogens hide behind the carbons, so a learner cannot count 8 H in the picture. Draw avg 2.1 ms.

## Cycle 6
Intent: spread the propane hydrogens outward (±1.2 instead of ±1.05, end ones at ±2.6) so all 8 can be counted; shorten the common-factor sentence so it clears the tick.
Seen: all 8 hydrogens in C₃H₈ visible; the sentence fits. Switching reaction keeps the typed numbers (methane opens as 2, 1, 2, 1 after water) and the page handles that honestly: the counts and halos show what is off. No further faults in the scripted frames. Draw avg 2.2 ms.

## Cycle 7
Intent: no source change; confirmation render with a 2× zoom of the reactant panel, plus lint and typecheck.
Seen: frames byte-identical to cycle 6 (determinism holds). In the zoom the atom shading and halos are clean. The red halo is weakest where it surrounds red oxygen atoms; the tally row still names oxygen in red, so the learner is not left without the signal. Draw avg 2.4 ms. Stopped here, one cycle under budget.
