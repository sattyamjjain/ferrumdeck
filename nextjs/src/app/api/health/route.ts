import { NextResponse } from "next/server";
import { getGatewayUrl } from "@/lib/api/config";

export async function GET() {
  try {
    const response = await fetch(`${getGatewayUrl()}/health`, {
      method: "GET",
    });

    if (response.ok) {
      return NextResponse.json({ status: "ok", gateway: "connected" });
    } else {
      return NextResponse.json(
        { status: "degraded", gateway: "unreachable" },
        { status: 503 }
      );
    }
  } catch {
    return NextResponse.json(
      { status: "degraded", gateway: "unreachable" },
      { status: 503 }
    );
  }
}
