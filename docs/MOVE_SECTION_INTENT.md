# Move section intent

The broader recording workflow and evidence requirements are planned in [Move capture plan](MOVE_CAPTURE_PLAN.md).

Tech → Moves is the user's move list for each character. Every character starts with the same assumed inputs: 2A/2B/2C, 5A/5B/5C, 2F/4F/6F, 236A/236B/236C/236EX, 214A/214B/214C/214EX, and j.236A/j.236B/j.236C/j.236EX. These are starting entries, not measured frame data. Their frame values remain unknown until entered or verified.

Users can add character-specific moves and edit the entries in Tech. The Tech catalog is stored locally and existing move IDs must remain stable so combo references and recorded takes keep their links.

Each move has an editable flow-cancellable property. Command normals start with this property enabled, but the saved toggle value takes precedence over that assumption.

A move with a charged version keeps its standard entry and gets a separate bracketed entry, such as `5C` and `5[C]`. Each entry links to the other by ID and has independent frame data and capture takes. A visible button input alone does not verify hold duration, so a charged take remains unresolved until that evidence is reviewed.

A stance is a parent move with followups. A followup can use a bare button such as `A` when it depends on a stance parent; this bare input only applies in that stance sequence. The older global bare-button stance matching is no longer used. Previously saved rekka parents are read as stance parents; older bare-button entries without a parent remain stored but must be assigned to a stance before capture can select them.

Capture selects from Tech → Moves for the chosen character/support variant. Support choice identifies the take and its storage location; it does not create a separate move list. Capture records the selected move's input, stance/charged flags, and ID when a take is armed. A detected input is checked against that snapshot after processing. Capture does not create or edit move definitions.

Observed timing, hitboxes, and inputs remain evidence until reviewed. Processing must not silently write uncertain observations into Tech → Moves.
