---
description: Rewrite your prompt to be clearer and more precise without changing its meaning, show the improved version, then carry it out.
argument-hint: <your prompt>
disable-model-invocation: true
---

The user's raw prompt is:

$ARGUMENTS

Do this in order:

**1. Refine it silently, under these rules**
- Preserve intent exactly. Do not add requirements, scope, files, tools or opinions the user did not express.
- Keep the user's language. Keep identifiers, file paths, commands, error messages, numbers and quoted text verbatim.
- Make it specific: state the goal, the constraints that were given, and the expected result when they are clear from the prompt or the conversation. Remove filler, contradictions and ambiguity.
- If something essential is genuinely ambiguous, do not guess: keep it as an explicit question at the end of the refined prompt.
- Never make it longer than it needs to be. If the prompt is already clear, say so and use it as is.

**2. Show it** in a single quoted block under the heading "Refined prompt". No commentary on what you changed unless a change could alter the meaning, in which case name it in one line.

**3. Act on the refined prompt** as if the user had typed it. If it ends with a blocking question, ask it and wait instead of acting.
