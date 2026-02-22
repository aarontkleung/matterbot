---
name: deep-research
description: Conduct deep, multi-step research on any topic by autonomously planning, searching, reading sources, and synthesizing a comprehensive cited report. Use when the user asks for deep research, thorough investigation, or a detailed report on a topic. Triggered by phrases like "deep research", "research this", "investigate", "write a report on", or when a topic clearly needs more than a single web search.
---

# Deep Research Skill

Conduct autonomous multi-step research: plan → search → read → extract → iterate → synthesize.

## Workflow

### 1. Acknowledge and Clarify

Send an immediate message so the user knows research has started:
```
send_message("Starting deep research on: [topic]. This will take a few minutes...")
```

If the query is ambiguous, ask ONE clarifying question before starting (scope, depth, angle).

### 2. Generate Research Plan

Decompose the topic into 4–6 sub-questions that together would answer it comprehensively:
- Core definitions / background
- Current state / recent developments
- Key players / examples
- Controversies / open questions
- Practical implications

### 3. Iterative Search Loop

Run up to *3 depth levels*, starting with *4 parallel queries* per level (halve breadth each level).

For each query:
1. `WebSearch` — get results
2. `WebFetch` or `agent-browser open <url>` then `agent-browser snapshot` — read the 2–3 most relevant pages
3. Extract: key facts, data points, quotes, and *follow-up questions* this source raises
4. Track visited URLs to avoid re-reading

After each round, assess gaps. If gaps remain and depth budget allows, generate new queries targeting them and repeat.

*Stop when:* sufficient coverage across sub-questions, OR 3 depth levels reached, OR ~15 minutes elapsed.

### 4. Synthesize Report

Write the final report using ONLY gathered information:

```
## [Topic]

### Summary
2–3 sentence executive summary.

### [Section 1]
...

### [Section N]
...

### Conclusion
Key takeaways and open questions.

### Sources
- [Title](url) — one line description
```

Guidelines:
- Cite sources inline: "According to [Source]..."
- Highlight conflicting information between sources
- Note areas of uncertainty
- Target 500–2000 words depending on complexity

## Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| breadth | 4 → 2 → 1 | Queries per depth level |
| depth | max 3 | Recursion levels |
| sources per query | 2–3 | Pages to actually read |
| max total sources | ~15–20 | Avoid diminishing returns |

## State Tracking

Maintain throughout:
- `learnings[]` — key facts extracted
- `visited_urls[]` — URLs already read
- `follow_ups[]` — questions to investigate next
- `gaps[]` — sub-questions not yet answered

## Progress Updates

Send intermediate updates for long tasks:
```
send_message("📚 Researching [sub-topic]... found [N] sources so far")
```

## Example

User: "Deep research on nuclear fusion energy"

1. Send acknowledgment
2. Plan: background, current projects (ITER/NIF/private), recent breakthroughs, timeline, challenges, investment
3. Round 1 (breadth=4): general overview, ITER 2025 status, NIF ignition, private companies
4. Read top sources, extract learnings + follow-ups
5. Round 2 (breadth=2): fill gaps (timeline estimates, cost projections)
6. Synthesize structured report with citations
7. Send final report
