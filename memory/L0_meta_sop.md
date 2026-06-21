# L0: Memory Management SOP

## Three Core Axioms

1. **Action-Verified Only** — "No Execution, No Memory."
   - Only information from successful tool calls may be written to L1/L2/L3
   - LLM guesses or assumptions are forbidden from being stored as facts

2. **Sanctity of Verified Data**
   - Verified configuration/guidelines/key paths must never be discarded during refactoring
   - Compression or migration between tiers is allowed, but accuracy must be preserved

3. **No Volatile State**
   - Do not store timestamps, session IDs, PIDs, absolute paths
   - Only store long-term effective knowledge

## Memory Routing Decision Tree

New information enters:
  → Environment-specific facts (paths, config) → L2
  → Universal guardrails (red lines, common errors) → L1 RULES
  → Task-level technical experience → L3 SOP
  → Temporary working data → Do not store
  → None of the above → Discard

## Memory Tiers

| Tier | File | Content | Update Frequency |
|------|------|---------|------------------|
| L0 | `memory/L0_meta_sop.md` | Core axioms + decision tree | Rarely |
| L1 | `memory/L1_index.md` | ≤30 line index: keywords → locations | After each run |
| L2 | `memory/L2_facts.md` | Global facts: config, stack, paths | When new facts |
| L3 | `memory/L3_skills/*.md` | Task-level SOPs | Skill crystallization |
| L4 | `memory/L4_sessions/*.md` | Session archives | After each run |
