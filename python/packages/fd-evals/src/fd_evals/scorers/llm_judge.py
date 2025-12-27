"""LLM-as-Judge scorer for evaluating output quality.

Uses an LLM to evaluate the quality of agent outputs based on
configurable criteria. Useful for subjective quality assessments
that are difficult to capture with deterministic scorers.
"""

import json
import logging
import os
from typing import Any

import httpx

from fd_evals.scorers.base import BaseScorer
from fd_evals.task import EvalTask, ScorerResult

logger = logging.getLogger(__name__)

# Default evaluation prompt template
DEFAULT_EVAL_PROMPT = """You are an expert evaluator assessing the quality of an AI agent's output.

## Task Description
{task_description}

## Expected Outcome
{expected_outcome}

## Actual Output
{actual_output}

## Evaluation Criteria
{criteria}

## Instructions
Evaluate the actual output against the expected outcome and criteria.
Provide your assessment in the following JSON format:

```json
{{
  "score": <float between 0.0 and 1.0>,
  "passed": <true if score >= 0.7, otherwise false>,
  "reasoning": "<brief explanation of your assessment>",
  "strengths": ["<list of strengths>"],
  "weaknesses": ["<list of weaknesses>"]
}}
```

Be objective and thorough in your evaluation.
"""

# Default evaluation criteria
DEFAULT_CRITERIA = """
1. Correctness: Does the output correctly address the task requirements?
2. Completeness: Does the output include all necessary components?
3. Quality: Is the output well-structured and professional?
4. Safety: Does the output avoid any harmful or inappropriate content?
"""


class LLMJudgeScorer(BaseScorer):
    """Uses an LLM to evaluate output quality.

    This scorer sends the task, expected output, and actual output to an LLM
    which then provides a quality assessment score.

    The evaluation is done via API call to an LLM provider.
    """

    def __init__(
        self,
        name: str = "LLMJudge",
        weight: float = 1.0,
        model: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        criteria: str | None = None,
        prompt_template: str | None = None,
        pass_threshold: float = 0.7,
        temperature: float = 0.1,
        max_tokens: int = 1024,
    ):
        """Initialize the LLM judge scorer.

        Args:
            name: Scorer name.
            weight: Weight for composite scoring.
            model: LLM model to use for evaluation (default: claude-3-haiku).
            api_key: API key for LLM provider.
            api_base: Base URL for LLM API.
            criteria: Custom evaluation criteria.
            prompt_template: Custom prompt template.
            pass_threshold: Minimum score to pass (default: 0.7).
            temperature: LLM temperature (default: 0.1 for consistency).
            max_tokens: Maximum tokens for response.
        """
        super().__init__(name=name, weight=weight)
        self.model = model or os.getenv("LLM_JUDGE_MODEL", "claude-3-haiku-20240307")
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.api_base = api_base or os.getenv("LLM_JUDGE_API_BASE", "https://api.anthropic.com/v1")
        self.criteria = criteria or DEFAULT_CRITERIA
        self.prompt_template = prompt_template or DEFAULT_EVAL_PROMPT
        self.pass_threshold = pass_threshold
        self.temperature = temperature
        self.max_tokens = max_tokens

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Score the output using an LLM judge.

        Args:
            task: The evaluation task.
            actual_output: The actual run output (string or dict).
            run_context: Run context including any additional data.

        Returns:
            ScorerResult with LLM evaluation.
        """
        if not self.api_key:
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message="LLM judge not configured: missing API key",
                details={"error": "missing_api_key"},
            )

        # Format actual_output for prompt - handle both string and dict
        if isinstance(actual_output, str):
            formatted_output = actual_output
        else:
            formatted_output = json.dumps(actual_output, indent=2)

        # Build the evaluation prompt
        prompt = self.prompt_template.format(
            task_description=task.description or task.name,
            expected_outcome=json.dumps(task.expected, indent=2),
            actual_output=formatted_output,
            criteria=self.criteria,
        )

        try:
            # Call the LLM for evaluation
            evaluation = self._call_llm(prompt)

            # Parse the evaluation response
            result = self._parse_evaluation(evaluation)

            return ScorerResult(
                scorer_name=self.name,
                passed=result.get("passed", result.get("score", 0) >= self.pass_threshold),
                score=result.get("score", 0.0),
                message=result.get("reasoning", "LLM evaluation complete"),
                details={
                    "strengths": result.get("strengths", []),
                    "weaknesses": result.get("weaknesses", []),
                    "model": self.model,
                    "raw_response": evaluation[:500] if len(evaluation) > 500 else evaluation,
                },
            )

        except Exception as e:
            logger.exception("LLM judge evaluation failed")
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message=f"LLM judge error: {e}",
                details={"error": str(e)},
            )

    def _call_llm(self, prompt: str) -> str:
        """Call the LLM API for evaluation."""
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }

        payload = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "messages": [{"role": "user", "content": prompt}],
        }

        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.api_base}/messages",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

            # Extract text from response
            content = data.get("content", [])
            if content and len(content) > 0:
                return content[0].get("text", "")
            return ""

    def _parse_evaluation(self, response: str) -> dict[str, Any]:
        """Parse the LLM evaluation response."""
        # Try to extract JSON from the response
        try:
            # Look for JSON block in markdown code fence
            if "```json" in response:
                start = response.index("```json") + 7
                end = response.index("```", start)
                json_str = response[start:end].strip()
            elif "```" in response:
                start = response.index("```") + 3
                end = response.index("```", start)
                json_str = response[start:end].strip()
            else:
                # Try to find JSON object directly
                start = response.index("{")
                end = response.rindex("}") + 1
                json_str = response[start:end]

            result = json.loads(json_str)

            # Validate score is in range
            if "score" in result:
                result["score"] = max(0.0, min(1.0, float(result["score"])))

            return result

        except (ValueError, json.JSONDecodeError) as e:
            logger.warning(f"Failed to parse LLM evaluation: {e}")
            # Return a default evaluation based on response content
            lower_response = response.lower()
            if "excellent" in lower_response or "perfect" in lower_response:
                return {"score": 1.0, "passed": True, "reasoning": response[:200]}
            elif "good" in lower_response or "acceptable" in lower_response:
                return {"score": 0.8, "passed": True, "reasoning": response[:200]}
            elif "poor" in lower_response or "fail" in lower_response:
                return {"score": 0.3, "passed": False, "reasoning": response[:200]}
            else:
                return {"score": 0.5, "passed": False, "reasoning": response[:200]}


class CodeQualityJudge(LLMJudgeScorer):
    """Specialized LLM judge for code quality evaluation."""

    def __init__(
        self,
        name: str = "CodeQualityJudge",
        weight: float = 1.0,
        **kwargs: Any,
    ):
        """Initialize with code-specific criteria."""
        code_criteria = """
1. Correctness: Does the code correctly implement the requested functionality?
2. Readability: Is the code clean, well-formatted, and easy to understand?
3. Best Practices: Does the code follow language-specific best practices?
4. Error Handling: Does the code handle edge cases and errors appropriately?
5. Performance: Is the code reasonably efficient for its purpose?
6. Security: Does the code avoid common security vulnerabilities?
7. Testing: If tests are expected, are they comprehensive and well-written?
8. Documentation: Are there appropriate comments and documentation?
"""
        super().__init__(name=name, weight=weight, criteria=code_criteria, **kwargs)


class PRQualityJudge(LLMJudgeScorer):
    """Specialized LLM judge for pull request quality evaluation."""

    def __init__(
        self,
        name: str = "PRQualityJudge",
        weight: float = 1.0,
        **kwargs: Any,
    ):
        """Initialize with PR-specific criteria."""
        pr_criteria = """
1. Scope: Is the PR focused and appropriately sized?
2. Description: Is the PR description clear and informative?
3. Changes: Do the changes address the stated issue or feature request?
4. Testing: Are the changes tested appropriately?
5. Breaking Changes: Are breaking changes documented if any?
6. Review Ready: Is the PR in a reviewable state?
7. Commits: Are commit messages clear and descriptive?
8. CI/CD: Do all automated checks pass?
"""
        super().__init__(name=name, weight=weight, criteria=pr_criteria, **kwargs)
