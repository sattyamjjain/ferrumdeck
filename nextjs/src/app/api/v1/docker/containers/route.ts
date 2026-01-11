import { NextResponse } from "next/server";
import { spawn, spawnSync } from "child_process";

export const dynamic = "force-dynamic";

// Check if docker CLI is available (cached)
let dockerAvailable: boolean | null = null;
function isDockerAvailable(): boolean {
  if (dockerAvailable === null) {
    try {
      const result = spawnSync("docker", ["--version"], { timeout: 5000 });
      dockerAvailable = result.status === 0;
    } catch {
      dockerAvailable = false;
    }
  }
  return dockerAvailable;
}

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: "running" | "exited" | "paused" | "restarting";
  created: string;
  ports: string;
}

async function getContainers(): Promise<ContainerInfo[]> {
  return new Promise((resolve, reject) => {
    const docker = spawn("docker", [
      "ps",
      "-a",
      "--filter",
      "name=fd-",
      "--format",
      '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.CreatedAt}}|{{.Ports}}',
    ]);

    let output = "";
    let error = "";

    docker.stdout.on("data", (data) => {
      output += data.toString();
    });

    docker.stderr.on("data", (data) => {
      error += data.toString();
    });

    docker.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Docker command failed: ${error}`));
        return;
      }

      const containers: ContainerInfo[] = output
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const [id, name, image, status, state, created, ports] = line.split("|");
          return {
            id: id || "",
            name: name || "",
            image: image || "",
            status: status || "",
            state: (state as ContainerInfo["state"]) || "exited",
            created: created || "",
            ports: ports || "",
          };
        });

      resolve(containers);
    });

    docker.on("error", (err) => {
      reject(err);
    });
  });
}

export async function GET() {
  // Check if Docker logs feature is enabled
  if (process.env.DOCKER_LOGS_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Docker logs feature is not enabled" },
      { status: 403 }
    );
  }

  // Check if docker CLI is available
  if (!isDockerAvailable()) {
    return NextResponse.json(
      { error: "Docker CLI is not available in this environment" },
      { status: 503 }
    );
  }

  try {
    const containers = await getContainers();
    return NextResponse.json({ containers });
  } catch (error) {
    console.error("Failed to list containers:", error);
    return NextResponse.json(
      { error: "Failed to list Docker containers", details: String(error) },
      { status: 500 }
    );
  }
}
