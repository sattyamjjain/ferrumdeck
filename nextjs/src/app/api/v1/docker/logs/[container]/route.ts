import { NextRequest } from "next/server";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";

export const dynamic = "force-dynamic";

// Store active log streams for cleanup
const activeStreams = new Map<string, ChildProcessWithoutNullStreams>();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ container: string }> }
) {
  // Check if Docker logs feature is enabled
  if (process.env.DOCKER_LOGS_ENABLED !== "true") {
    return new Response(
      JSON.stringify({ error: "Docker logs feature is not enabled" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const { container } = await params;
  const searchParams = request.nextUrl.searchParams;
  const tail = searchParams.get("tail") || "100";
  const since = searchParams.get("since") || "";
  const timestamps = searchParams.get("timestamps") === "true";

  // Build docker logs command args
  const args = ["logs", "-f", "--tail", tail];

  if (timestamps) {
    args.push("--timestamps");
  }

  if (since) {
    args.push("--since", since);
  }

  args.push(container);

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Spawn docker logs process
      const docker = spawn("docker", args);
      const streamId = `${container}-${Date.now()}`;
      activeStreams.set(streamId, docker);

      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", container })}\n\n`)
      );

      // Handle stdout (normal logs)
      docker.stdout.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter((line) => line.length > 0);
        for (const line of lines) {
          const logEntry = {
            type: "log",
            stream: "stdout",
            message: line,
            timestamp: new Date().toISOString(),
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(logEntry)}\n\n`));
        }
      });

      // Handle stderr (error logs)
      docker.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter((line) => line.length > 0);
        for (const line of lines) {
          const logEntry = {
            type: "log",
            stream: "stderr",
            message: line,
            timestamp: new Date().toISOString(),
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(logEntry)}\n\n`));
        }
      });

      // Handle process errors
      docker.on("error", (error) => {
        const errorEntry = {
          type: "error",
          message: `Failed to stream logs: ${error.message}`,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEntry)}\n\n`));
        controller.close();
        activeStreams.delete(streamId);
      });

      // Handle process exit
      docker.on("close", (code) => {
        const closeEntry = {
          type: "close",
          code,
          message: code === 0 ? "Log stream ended" : `Log stream closed with code ${code}`,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(closeEntry)}\n\n`));
        controller.close();
        activeStreams.delete(streamId);
      });

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        docker.kill();
        activeStreams.delete(streamId);
      });
    },
    cancel() {
      // Cleanup is handled by abort signal
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
