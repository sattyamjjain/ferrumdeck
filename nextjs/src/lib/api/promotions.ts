import { fetchAPI } from "./client";
import type { PromotionHistoryResponse } from "@/types/promotion";

/**
 * Fetch the champion-challenger promotion history for one agent.
 *
 * Hits the BFF route at `/api/v1/promotions/:agentId`, which proxies the
 * gateway's audit-backed read endpoint. Newest-first.
 */
export async function fetchAgentPromotions(
  agentId: string
): Promise<PromotionHistoryResponse> {
  return fetchAPI<PromotionHistoryResponse>(`/v1/promotions/${agentId}`);
}
