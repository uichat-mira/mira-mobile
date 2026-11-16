# MOB-080 — Dev Cloud Host consumer pilot

Mira Mobile `dev` exposes an explicit **Mira Cloud** source in the SessionList
connection picker when signed into Cloud Account. This is a third entry, not
a replacement for the existing unpaired Local Provider or independent paired
Tailscale Direct entry. The default `all` filter remains Local + Paired;
it does not silently combine separate Cloud account/Host data.

Cloud source uses `CloudHostRuntime -> CloudRemoteBusinessClient -> CloudRelayEntry`.
No paired `mira_device_*` credential, implicit Tailscale fallback, or legacy
Relay admission is used. A session opened from Cloud retains its explicit
`cloud-host` source when navigating to Chat; its title/messages/chat stream
stay on Cloud. The Cloud account ID is carried as a navigation guard; logout
or account switch invalidates active requests, blanks the Chat view and requires
opening an eligible session again. Cloud media preview is intentionally disabled,
rather than accidentally fetching a similarly named paired-Host attachment.

The Cloud Host manifest is authoritative for thread mutation and chat writes.
A read-only grant still permits browsing threads/history, but disables chat
composition and deletion. Tool execution and approvals are **not** enabled by
this pilot; the separate Cloud Tool Gateway route must be implemented and
validated against Desktop Harness grant enforcement before it can be exposed.

## Environment policy

- Only the `dev` channel is bound to the approved official shared
  Cloud-only Worker `cloud-relay.tomz.io`.
- `test`, `predev`, and `prod` remain fail-closed until their own
  operator-managed Cloud-only service endpoints are provisioned.
- This URL is code-owned release configuration for the dev pilot; users never
  supply Relay URL, token, room, or Worker.
- The Cloud Account dev channel continues to use the documented Cloud Auth
  dev configuration; the dev client now targets the already deployed official Cloud-only Worker.
  The isolated REL-005 Worker remains the rollback environment; the two
  services use distinct Durable Object namespaces. This is not a new
  Cloud Relay deployment or a test/prod promotion.

## Acceptance boundaries

Dev local typecheck/Jest/lint and native package CI are T1–T3/build evidence,
not Mobile T4. Actual two-device T4 requires installing the matching dev build,
signing into the same Cloud Account, selecting Mira Cloud in the source picker,
seeing the Desktop's canonical thread list/history and checking account/Host
offline and scope denied states. Desktop Cloud Host must be connected to the
same official Cloud-only Worker. No readiness/availability may be inferred from sign-in
alone; a connected indicator is set only after a real Cloud list response.

Cloud legacy Agent threads without a valid Workspace may open history read-only
through the Cloud source. Their composer is disabled and the Cloud runtime
itself refuses send attempts on those threads even if the mobile device
later has a broader grant. Paired Remote Host's existing Agent Workspace
contract remains enforced. History still requires the separate
messages:read effective Host grant; threads:read alone is not sufficient.

Tool Gateway, attachments, alternate entry surfaces (Drawer/Search), full
account-isolation/device-revocation pilot, and test/prod release promotion
remain MOB-080 follow-ups; this slice must not close the Issue.
