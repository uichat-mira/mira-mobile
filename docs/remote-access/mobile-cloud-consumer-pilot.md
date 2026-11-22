# MOB-080 — Dev Cloud Host consumer pilot

Mira Mobile `dev` exposes an explicit **Mira Cloud** source in the SessionList
connection picker when signed into Cloud Account. This is a third entry, not
a replacement for the existing unpaired Local Provider or independent paired
Tailscale Direct entry. The default `all` filter remains Local + Paired;
it does not silently combine separate Cloud account/Host data.

Cloud source uses `CloudHostRuntime -> CloudRemoteBusinessClient -> CloudRelayEntry`.
No paired `mira_device_*` credential, implicit Tailscale fallback, or legacy
Relay admission is used. Both Cloud and paired Remote Host now delegate
Thread/Message/Chat/manifest behavior to the same `RemoteHostBusinessClient`;
only identity, credential storage, Cloud ticket admission and transport
selection remain adapter-specific. A session opened from Cloud retains its explicit
`cloud-host` source when navigating to Chat; its title/messages/chat stream
stay on Cloud. The Cloud account ID is carried as a navigation guard; logout
or account switch invalidates active requests, blanks the Chat view and requires
opening an eligible session again. Cloud media preview is intentionally disabled,
rather than accidentally fetching a similarly named paired-Host attachment.

The Cloud Host manifest is authoritative for thread mutation and chat writes.
A read-only grant still permits browsing threads/history, but disables chat
composition and deletion. The MOB-080 pilot itself does not expose tool
execution; MOB-087 separately adds Local Agent Cloud tool consumption through
Desktop's existing Host grant/Harness enforcement (see below).

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

Cloud Agent threads without an explicit Workspace are not inherently legacy
read-only. Desktop may own a valid private Agent workspace even while
workspaceId is null, so the Cloud consumer defers execution permission and
Agent routing to the Host. Sending requires the separate messages:write
effective Host grant, and Host still enforces all Tool/Harness approvals.
For every Remote Host send (Cloud and paired), Mobile reads the Host-owned
canonical transcript, then submits one user message with
appendAtTail.expectedTailMessageId; Host rejects stale tails rather than
treating the message as a branch-from-root edit.
The Mobile local Agent loop and Cloud Tool approval UI remain separate
follow-ups. History still requires messages:read; threads:read alone is
insufficient.

When the Host manifest and effective Cloud grant provide the Agent scopes,
Mobile now uses the **same DurableHostAgentRuntimeAdapter and AgentChatScreen**
for the Cloud source as for paired Remote Host. The Cloud transport supplies
only the authenticated Host Agent Run requests; all run identity, pending
approval, approve/reject/cancel and safe resume semantics stay in the existing
Host-owned Agent contract. Cloud logout/account switch invalidates the active
Agent observer and pending actions. This change does **not** grant new scopes,
unlock new Mobile-local tools or override Desktop Harness approval policy.
Agent message-send availability still depends on the separate Host append-turn
integration and coordinated Mobile business-client work.

Attachments, alternate entry surfaces (Drawer/Search), full
account-isolation/device-revocation pilot and test/prod release promotion remain
MOB-080 follow-ups; this slice must not close the Issue. Cloud Tool Gateway
invocation/approval for the Mobile Local Agent is tracked by MOB-087.

## MOB-087 — Cloud Tool Gateway for the Mobile Local Agent

When the user is explicitly signed into Mira Cloud, a Local Provider Agent run
resolves its Host remote toolset through Cloud Relay instead of the Legacy
paired path. The Cloud branch is a thin `CloudToolHostClient` implementation of
the same four host methods used by `RemoteToolGatewayClient`:

- `GET /remote/v1/tools`
- `POST /remote/v1/tool-invocations/stream`
- `POST /remote/v1/tool-invocations/:invocationId/approval`
- `POST /remote/v1/tool-invocations/:invocationId/cancel`

The existing protocol parsers, `RemoteToolGatewayClient`,
`CompositeToolGatewayClient` and Mobile approval UI remain authoritative. The
Host manifest's `tools:*` scopes and advertised tool routes gate every
operation, and Relay tickets only admit transport; they are never sent as Host
business credentials. No `mira_device_*` credential or Host Provider key is
sent on this path.

Discovery is fail-closed for tool execution. Exactly one available
account-owned Host is required. Zero/offline Hosts yield a
`cloud-tools-unavailable` mobile notice, more than one online Host yields
`cloud-tools-host-ambiguous` without picking one (reserved for MOB-088), and a
Host without the required tool scope/route yields
`cloud-tools-unauthorized`. In all three cases Mobile keeps its compiled-in
local tools and does not invoke remote tool state. An explicitly signed-out
Cloud account keeps the previous Local + paired Host toolset; a Cloud failure
never silently downgrades to the paired Tailscale credential.

Each Local Agent run gets a fresh gateway bound to its Cloud account, Host and
Relay access. Account logout/switch, Host replacement, authorization loss and
uncertain Relay approval responses stop reuse of the old tool manifest, tool
IDs and pending approval instead of replaying them on another transport.
