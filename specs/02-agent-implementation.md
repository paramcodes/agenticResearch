- Do what's sugggested in 01

For agents implementation,


## Flow  

<!--User Input Frontend -> Backend -> Agent - Planner -> Writer -> Editor -> Markdown -> Backend -> Frontend-->

```
User Input -> Frontend -> Backend -> LangGraph
                                        |
                                     Planner
                                        |
                                     Writer
                                        |
                                     Editor --(revise)--> back to Writer
                                        |
                                    (approved)
                                        |
                                Markdown -> Backend -> Frontend
```

- State (topic, sources, plan, draft, final_post, etc.) flows directly from node to node inside the graph
- Redis is used only as a checkpointer: it snapshots the state after each node runs, so a run can be resumed by thread_id if it crashes or is paused, instead of starting over.
- The Editor can send the draft back to the Writer with feedback. Cap the number of revisions (e.g. 2) so it can't loop forever.

- use tavily for research during planning and writing also make sure to cite the sources.

### Planner Agent

Input -> topic

Task -> Plan engaging and factually accurate content on {topic} grounded in real search results so the Writer has something true to write from.

Before running the prompt: search the topic (e.g. with Tavily) and number the results. Build a sources_block string like:

```
[1] Title of result — https://example.com/article
    One or two sentence snippet from the result.
[2] Title of result 2 — https://example.com/article2
    Snippet...
```

Prompt -> 

```
"You're working on planning a blog article "
"about the topic: {topic}."
"You collect information that helps the "
"audience learn something "
"and make informed decisions. "
"Your work is the basis for "
"the Content Writer to write an article on this topic."
You are given a numbered list of search results (title, url, snippet) below.
Ground every factual claim in your plan in one of these sources, and mark
which source number supports it, like [2]. Do not invent facts or sources
that are not in the list.

Produce:
1. The latest relevant trends, key players, and noteworthy points on the topic.
2. The target audience and their likely interests/pain points.
3. A detailed outline: introduction, key points (each tagged with a [n]
   source), and a call to action.
4. 5-8 SEO keywords.

Search results:
{sources_block}
```

Expected output -> A content plan with outline, audience analysis, SEO keywords, and every key point tagged with a [n] source reference.


### Content Writer Agent

Input -> output from planner agent

Task -> Write insightful and factually accurate opinion piece from the plan, carrying the [n] citation markers through into the draft.
Prompt ->

```
"You're working on a writing "
"a new opinion piece about the topic: {topic}. "
"You base your writing on the work of "
"the Content Planner, who provides an outline,numbered sources "
"and relevant context about the topic. "
"You follow the main objectives and "
"direction of the outline, "
"as provide by the Content Planner. "
"You also provide objective and impartial insights "
"and back them up with Planner's sources, keeping the same [n] markers inline "
"provide by the Content Planner. "
"You acknowledge in your opinion piece "
"when your statements are opinions "
"as opposed to objective statements."

Requirements:
- Sections/subtitles are engaging and clearly named.
- Structure: engaging introduction, insightful body, summarizing conclusion.
- Each section: 2-3 paragraphs.
- Naturally incorporate the SEO keywords from the plan.
- End with a numbered "Sources" list mapping each [n] to its title and URL.
- Output valid markdown only.

Content plan:
{plan}

Sources (for the closing Sources list):
{sources_block}
{revision_note}

```

Notes:

{revision_note} is "" on the first pass.
If the Editor sends the draft back, set it to something like: "\nEditor feedback to address in this revision:\n{editor_feedback}"

Expected output -> A well-written blog post in markdown, 2-3 paragraphs per section, ready for the Editor.


### Editor Agent

Input -> the Writer's draft

Task -> Review the draft for journalistic quality, balance, and voice, and decide whether it's ready to publish or needs another pass.

Prompt ->

```
"You are an editor who receives a blog post "
"from the Content Writer. "
"Your goal is to review the blog post "
"to ensure that it follows journalistic best practices,"
"provides balanced viewpoints "
"when providing opinions or assertions, "
"and also avoids major controversial topics "
"or opinions when possible."

- Keeps every [n] citation marker intact and matched to a real source in
  the closing Sources list (do not remove citations while editing).
- Is clean, well-structured markdown, 2-3 paragraphs per section.

If the draft is publication-ready, lightly proofread it (grammar, voice)
and respond with:
VERDICT: approved
---
<the final polished markdown>

If it needs real revision (not just typos), respond with:
VERDICT: revise
---
<specific, actionable feedback for the writer>

Draft:
{draft}

```

Expected output -> Either:

VERDICT: approved + the final polished markdown post, or
VERDICT: revise + specific feedback, which goes back to the Writer as editor_feedback and increments a revision_count.

Routing logic (the conditional edge after the Editor node):

if editor_verdict == "revise" and revision_count < MAX_REVISIONS:
    -> go back to Writer
else:
    -> end, output final_post
