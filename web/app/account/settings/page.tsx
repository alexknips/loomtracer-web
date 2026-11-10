import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "Account settings · Loomtracer" };
export const dynamic = "force-dynamic";

// This viewer reads a ledger. Membership and connection changes run in the
// signed-in account app, which resolves the visitor's workspace and permissions.
const accountOrigin = "https://loomtracer.vercel.app";
const destinations = [
  {
    path: "/settings/team",
    name: "Team",
    description: "View team members and manage invitations.",
  },
  {
    path: "/settings/connections",
    name: "Agent connections",
    description: "Connect an agent to a project or review its access.",
  },
];

export default function AccountSettingsPage() {
  return (
    <AppShell active="Account settings">
      <main className={styles.page}>
        <h1>Account settings</h1>
        <p>Manage access in your signed-in Loomtracer account.</p>
        <ul className={styles.links}>
          {destinations.map(({ path, name, description }) => (
            <li key={path}>
              <a href={accountOrigin + path}>
                <span>
                  <strong>{name}</strong>
                  <span>{description}</span>
                </span>
                <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </AppShell>
  );
}
