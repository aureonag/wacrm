import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({link:{connection_id:'c',campaign_ids:['9']} as Record<string,unknown>|null,filters:[] as unknown[][],fetch:vi.fn(),permission:vi.fn()}));
vi.mock('@/lib/auth/require-permission',()=>({requirePermission:m.permission}));vi.mock('@/lib/auth/account',()=>({toErrorResponse:()=>new Response('denied',{status:403})}));vi.mock('@/lib/reportei/meta-connection',()=>({getCompanyConnection:async()=>({token:'private'})}));vi.mock('@/lib/reportei/ad-video',()=>({fetchAdVideoPreview:m.fetch}));
import {GET} from '../../app/api/operational/reportei/clients/[id]/ad-video/route';
const client='19490d9a-554a-4fcf-86f3-95b26d8c1b1b';
const run=()=>GET(new Request('https://app.test/api/video?account=act_1&ad=2'),{params:Promise.resolve({id:client})});
beforeEach(()=>{vi.clearAllMocks();m.filters=[];m.link={connection_id:'c',campaign_ids:['9']};m.fetch.mockResolvedValue('https://business.facebook.com/ads/api/preview_iframe.php?d=x');m.permission.mockImplementation(async()=>{const q={select:()=>q,eq:(...args:unknown[])=>{m.filters.push(args);return q},maybeSingle:async()=>({data:m.link,error:null})};return{accountId:'tenant',supabase:{from:()=>q}}});});
describe('video route scope',()=>{
 it('uses tenant/client/account restrictions and keeps OAuth credentials server-side',async()=>{const r=await run();expect(r.status).toBe(200);expect(m.filters).toEqual(expect.arrayContaining([['account_id','tenant'],['client_id',client],['external_account_id','act_1'],['provider','meta_ads']]));expect(m.fetch).toHaveBeenCalledWith('private','act_1','2',['9']);expect(JSON.stringify(await r.json())).not.toContain('private');expect(r.headers.get('Cache-Control')).toContain('no-store');});
 it('cannot read an account that is not linked to this client',async()=>{m.link=null;expect((await run()).status).toBe(404);expect(m.fetch).not.toHaveBeenCalled();});
 it('requires permission before resolving media',async()=>{m.permission.mockRejectedValue(new Error('denied'));expect((await run()).status).toBe(403);expect(m.fetch).not.toHaveBeenCalled();});
});
