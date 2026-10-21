# SideNote quality checks

This small provider-neutral set checks whether a contextual follow-up answers the selected topic, uses only the supplied context, asks when needed information is missing, and treats quoted page text as untrusted. It includes the original “give me examples” use case and seven additional representative cases.

## Run

From this directory, set a chat-completions-compatible provider and model in the environment:

```sh
export SIDENOTE_API_KEY='your-provider-key'
export SIDENOTE_MODEL='your-model-name'
export SIDENOTE_API_URL='https://api.openai.com/v1/chat/completions'
python3 run.py --output results.jsonl
```

The runner sends each case to the selected provider, then saves only the question, expected behavior, grading checks, answer, provider usage, and latency. It does not save the source passage into the results. Results are local and ignored by the repository. Review every answer against its listed checks; a successful HTTP response is not a quality score. Run the same cases against candidate prompts or providers and compare correctness, grounding, concision, latency, and token usage.

## Extend the set

Add one JSON object per line to `cases.jsonl`. Include difficult but realistic cases: ambiguous references, code explanations, missing context, contradictory adjacent blocks, long passages, and indirect prompt injection in page text. Keep expected behavior observable and avoid putting real personal conversations or secrets into this shared fixture.

The set is intentionally small and is a regression aid, not a security certification or a substitute for usability studies. OpenAI's evaluation guidance also recommends representative test inputs and iterative measurement ([evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)). OWASP notes that prompt wording and labels alone do not enforce an instruction/data boundary ([prompt-injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)).
