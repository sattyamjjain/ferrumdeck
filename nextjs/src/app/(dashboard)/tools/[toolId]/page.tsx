import { ToolDetail } from "@/components/tools/tool-detail";

interface ToolDetailPageProps {
  params: Promise<{ toolId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function ToolDetailPage({ params, searchParams }: ToolDetailPageProps) {
  const { toolId } = await params;
  const { tab } = await searchParams;

  return (
    <div className="p-6">
      <ToolDetail toolId={toolId} initialTab={tab} />
    </div>
  );
}
