import { RunDetail } from "@/components/runs/run-detail";

interface RunDetailPageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;

  return (
    <div className="p-6">
      <RunDetail runId={runId} />
    </div>
  );
}
