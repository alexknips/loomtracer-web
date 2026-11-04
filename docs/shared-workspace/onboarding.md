# Join a shared Loomtracer workspace

The goal is that your agent and teammates can retrieve the same project history, and you can
navigate that history in the graph viewer. Joining a workspace should not create a second
independent copy of its shared memory.

**Current availability:** this guide does not establish a provisioned shared workspace. The owner
must first resolve the endpoint, tenant identity and access requirements in the
[workspace overview](README.md). This checklist is the acceptance procedure for the supported
join path; it does not imply a self-service invitation or configured shared workspace exists.
Rust's existing administrative provisioning is one possible join path, subject to the selected
authentication mode and explicit agreement on the enforced identity/authority contract. A
bounded pilot can use existing native decision behavior; it does not establish a completed
historical migration. Keep its scope and recording route explicit.

## What the workspace owner provides

- The verified API and MCP addresses, deployed version/commit, and exact shared tenant/workspace
  and project identifiers.
- Your human identity and separately attributable agent identities, provisioned through the
  supported access mechanism, with a stated and enforced set of capabilities.
- The approved way to receive credentials, viewer access, and the procedure for revocation.
  Do not exchange shared admin credentials or put tokens in source control or chat transcripts.
- The project-specific contribution/review rules, support contact, and whether you are joining
  an existing history or importing a selected history of your own.

Display names alone are not sufficient to verify that two clients use the same workspace.
Do not use a shared login as a substitute for a supported join path.

## Connect and verify

1. **Join the intended boundary.** Verify your identity and tenant/workspace through the
   deployed service's supported identity read. Confirm an agreed existing record is visible
   and an excluded project is inaccessible. Use the service's enforcement, not a UI filter.
2. **Connect your agent.** Install the owner's approved MCP connection and inspect its actual
   exposed tools. Verify a read of the agreed project and record. Scope routing to this project;
   leave unrelated personal projects on their existing connections.
3. **Connect the viewer.** The current Rust-backed viewer uses server-side `LOOMTRACER_API_URL`
   and `LOOMTRACER_API_KEY`, with `LOOMTRACER_TENANT` only when the selected backend/token
   contract supports it. Configure through the approved secret mechanism. The token never goes
   to a browser. The app currently has no login of its own: use loopback locally or an
   owner-provided access-controlled deployment before exposing shared private history.
   One viewer deployment currently uses one backend credential. Its access gate must enforce
   each person's entry and revocation; revoking a person's agent token alone does not revoke
   their viewer access.
4. **Verify navigation.** Open the agreed project, inspect a decision and its source, follow a
   recorded relationship and a replacement, and search for the same record. Confirm the
   agent and viewer agree on its identifier, words, attribution and relevant history.
5. **Connect Gas City if used.** Configure each worker's memory integration to the same shared
   service and project. Verify a worker read and an outcome capture. A local Beads/Dolt task
   store is not the shared Loomtracer memory ledger; task-store synchronization has its own
   ownership policy.
6. **Prove contribution visibility.** Create a small agreed contribution, retrieve it from a
   teammate's independent agent session, and inspect it in the viewer. Repeat in the other
   direction. Test unauthorized operations and access revocation with the owner. Record the
   resulting IDs and evidence; a displayed connected state is insufficient.
7. **Verify the recording route.** Start or resume the real clients and confirm new shared
   records reach the shared workspace once. Remove obsolete project-specific recording routes
   only after this check. Keep historical exports as recovery material.

The owner's run record should show your identity, workspace/project IDs, client versions,
read/contribution evidence and any unresolved capability limits. Credential values never belong
in that record.

## Bring an existing history

Use the [migration runbook](migration-runbook.md) for a scoped complete export, mapping preview,
isolated rehearsal, reconciliation and cutover. Do not upload a whole personal account to join
one shared project. A source file that preserves text but omits server authority history is
not a complete migration export.

The imported history must remain usable through the common API/MCP and viewer. Imported
approval claims, copied labels and archived grants do not grant you or your agent new rights.

## Diagnose a fragmented connection

| Symptom | Check |
| --- | --- |
| Teammates see different histories | Compare actual endpoint, tenant/workspace and project IDs, then deployed version/commit; matching names are not enough. |
| Viewer works but agent cannot find a record | Check the agent's MCP endpoint and project route, retrieval coverage and import mapping; inspect its actual tool schema. |
| Agent sees a record but graph omits it | Check pagination, supported record kinds and preservation/projection coverage. Do not call an omitted record nonexistent. |
| A new sign-in creates an empty workspace | Check the backend's tenant-provisioning behavior. Do not reimport history to work around an identity-routing error. |
| A capture times out | Treat the outcome as unknown, read back by operation/source identity, and follow that endpoint's idempotency contract before retrying. |
| Imported decisions appear newly approved | Stop authority-dependent work and inspect provenance, imported status and server receipt mapping. |
| A worker records to the old service | Check project instructions, scoped profile/hooks and resumed-session configuration; verify a fresh read and write route. |
| An unrelated project is visible | Stop onboarding and resolve the access boundary before further sharing. |
