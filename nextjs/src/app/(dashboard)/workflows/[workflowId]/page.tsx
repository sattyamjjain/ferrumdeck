import { WorkflowDetail } from "@/components/workflows/workflow-detail";
import { Metadata } from "next";

interface WorkflowDetailPageProps {
  params: Promise<{ workflowId: string }>;
}

export async function generateMetadata({
  params,
}: WorkflowDetailPageProps): Promise<Metadata> {
  const { workflowId } = await params;
  const shortId = workflowId.length > 12 ? `${workflowId.slice(0, 12)}...` : workflowId;

  return {
    title: `Workflow ${shortId} | FerrumDeck`,
    description: `View details for workflow ${workflowId}`,
  };
}

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
  const { workflowId } = await params;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkflowDetail workflowId={workflowId} />
    </div>
  );
}
