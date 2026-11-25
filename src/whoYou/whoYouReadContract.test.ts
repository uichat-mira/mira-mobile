import { discoverWhoYouResource, parseIdentity, parseMailboxes, parseMailSearch, parseMailMessage, parseToolStructuredContent } from './whoYouReadContract';
const MCP_URL = 'https://who-you.example.test/mcp';
const CLOUD_AUTH_URL = 'https://cloud-auth.example.test';
const metadata = {
  resource: MCP_URL,
  authorization_servers: [CLOUD_AUTH_URL],
  scopes_supported: ['whoyou.read'],
  bearer_methods_supported: ['header'],
};

const whoami = {
  accountId: 'account-1',
  consumerId: 'account-1',
  scopes: ['whoyou.read'],
};

const identities = {
  identities: [
    {
      mailboxId: 'mailbox-gmail-1',
      address: 'alice@example.test',
      kind: 'third_party',
      provider: 'gmail',
      status: 'active',
      credentialStatus: 'active',
      quotaBytes: 1000,
      bytesUsed: 20,
      messageCount: 3,
      createdAt: 1_790_000_000_000,
    },
    {
      mailboxId: 'mailbox-own-1',
      address: 'alice@tomlab.cn',
      kind: 'own_domain',
      provider: null,
      status: 'active',
      credentialStatus: null,
      quotaBytes: 1000,
      bytesUsed: 0,
      messageCount: 0,
      createdAt: 1_790_000_000_000,
    },
  ],
};


const discover = (body: unknown) => discoverWhoYouResource({
  mcpUrl:MCP_URL, cloudAuthBaseUrl:CLOUD_AUTH_URL,
  fetchImpl: jest.fn(async () => new Response(JSON.stringify(body),{status:200})) as unknown as typeof fetch,
});
describe('Who You read contract after registry cutover', () => {
  it('validates exact RFC9728 resource, issuer, scope and bearer method', async () => {
    await expect(discover(metadata)).resolves.toMatchObject({resource:MCP_URL});
    for (const broken of [
      {...metadata,resource:'https://different.example/mcp'},
      {...metadata,scopes_supported:[]},
      {...metadata,authorization_servers:['https://different.example']},
      {...metadata,bearer_methods_supported:['body']},
    ]) await expect(discover(broken)).rejects.toMatchObject({kind:'invalid_response'});
  });
  it('checks both account and consumer and rejects widened scope', () => {
    expect(parseIdentity(whoami,'account-1')).toEqual(whoami);
    for(const broken of [
      {...whoami,accountId:'another'},
      {...whoami,consumerId:'another'},
      {...whoami,scopes:['whoyou.read','whoyou.mail.write']},
    ]) expect(()=>parseIdentity(broken,'account-1')).toThrow();
  });
  it('parses mailbox identities and rejects unknown providers and impossible timestamps', () => {
    expect(parseMailboxes(identities).map(m=>m.mailboxId)).toEqual(['mailbox-gmail-1','mailbox-own-1']);
    for(const broken of [{...identities.identities[0],provider:'unknown'},{...identities.identities[0],createdAt:1e20}])
      expect(()=>parseMailboxes({identities:[broken]})).toThrow();
  });
  const mail = {id:'msg-1',threadId:'thread-1',direction:'inbound',from:[],subject:'Fixture',receivedAt:1790000000000,snippet:'fixture',attachmentCount:0};
  it('preserves opaque pagination and only accepts untrusted plain text results', () => {
    expect(parseMailSearch({messages:[mail],nextCursor:'opaque-page'}).nextCursor).toBe('opaque-page');
    expect(parseMailMessage({...mail,untrusted:true,bodyKind:'text',body:'fixture body',truncated:false}).body).toBe('fixture body');
    expect(()=>parseMailMessage({...mail,untrusted:false,bodyKind:'text',body:'fixture',truncated:false})).toThrow();
    expect(()=>parseMailSearch({messages:[{...mail,receivedAt:1e20}],nextCursor:null})).toThrow();
    expect(()=>parseMailSearch({messages:[{id:'bad'}],nextCursor:null})).toThrow();
  });
  it('maps tool errors without disclosing arbitrary upstream content', () => {
    expect(()=>parseToolStructuredContent({isError:true,structuredContent:{error:'insufficient_scope'}})).toThrow();
    try {parseToolStructuredContent({isError:true,structuredContent:{error:'insufficient_scope'}});} catch(error){expect(error).toMatchObject({kind:'rejected',code:'insufficient_scope'});}
    expect(()=>parseToolStructuredContent({isError:false})).toThrow();
  });
});
