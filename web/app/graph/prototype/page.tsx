import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { LoomtracerProblem } from "@/components/loomtracer-problem";
import DecisionExplorer from "@/components/prototype/DecisionExplorer";
import { ProjectExplorer } from "@/components/prototype/ProjectExplorer";
import { loomtracer } from "@/lib/loomtracer/client";
import { load } from "@/lib/loomtracer/load";
import { desktopChatAvailable } from "@/lib/prototype/chat-access";

export const metadata: Metadata = { title: "3D viewer prototype · Loomtracer" };

export default async function PrototypePage({ searchParams }: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  const workspaceAvailable = process.env.NEUROFILAMENT_PUBLIC_ONLY !== "true";
  if (workspaceAvailable && typeof project === "string" && project.length > 0) {
    const who = await load(() => loomtracer().whoami());
    if (!who.ok) return <main><LoomtracerProblem error={who.error} /><p className="content-page">
      <Link className="text-button" href="/graph/prototype">Open the fictional Atlas project →</Link>
    </p></main>;
    return <ProjectExplorer workspace={who.value.tenant_id} user={who.value.actor_id} initialProject={project} />;
  }
  const host = (await headers()).get("host");
  return <DecisionExplorer workspaceAvailable={workspaceAvailable} localChatEnabled={desktopChatAvailable(host)} />;
}
