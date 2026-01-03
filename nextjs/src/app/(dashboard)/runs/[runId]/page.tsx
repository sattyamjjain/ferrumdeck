import { RunDetail } from "@/components/runs/run-detail";
import { Metadata } from "next";

interface RunDetailPageProps {
  params: Promise<{ runId: string }>;
}

export async function generateMetadata({
  params,
}: RunDetailPageProps): Promise<Metadata> {
  const { runId } = await params;
  const shortId = runId.length > 12 ? `${runId.slice(0, 12)}...` : runId;

  return {
    title: `Run ${shortId} | FerrumDeck`,
    description: `View details for run ${runId}`,
  };
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <RunDetail runId={runId} />
    </div>
  );
}
