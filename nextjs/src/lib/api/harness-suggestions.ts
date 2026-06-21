import { fetchAPI } from "./client";
import type {
  HarnessSuggestion,
  HarnessSuggestionsResponse,
} from "@/types/harness-suggestion";

/**
 * Fetch the harness/policy suggestions for one agent (newest-first), each with
 * its folded review status. Proxies the gateway's audit-backed read endpoint.
 */
export async function fetchHarnessSuggestions(
  agentId: string
): Promise<HarnessSuggestionsResponse> {
  return fetchAPI<HarnessSuggestionsResponse>(
    `/v1/harness-suggestions/agent/${agentId}`
  );
}

/**
 * Approve or reject a proposed suggestion. Records the operator's decision in
 * the audit trail; the gateway does NOT apply the change to any live policy.
 */
export async function resolveHarnessSuggestion(
  suggestionId: string,
  approve: boolean,
  note?: string
): Promise<HarnessSuggestion> {
  return fetchAPI<HarnessSuggestion>(
    `/v1/harness-suggestions/${suggestionId}/resolve`,
    {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }
  );
}
