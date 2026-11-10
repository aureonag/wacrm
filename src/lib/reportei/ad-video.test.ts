import {afterEach,describe,expect,it,vi} from "vitest";
import {fetchAdVideoPreview} from "./ad-video";
import {safeAdVideoPreview} from "./ad-table";
const preview='https://business.facebook.com/ads/api/preview_iframe.php?d=signed&t=1';
const ad={id:'2',account_id:'1',campaign_id:'9',creative:{video_id:'3'}};
const read=(ids?:string[]|null)=>fetchAdVideoPreview('private-token','act_1','2',ids);
const reply=(data:unknown)=>({ok:true,json:async()=>({data})});
function stub(row:unknown=ad,html='<iframe src="'+preview.replaceAll('&','&amp;')+'"></iframe>'){const f=vi.fn(async(raw:URL)=>reply(raw.pathname.endsWith('/ads')?[row]:[{body:html}]));vi.stubGlobal('fetch',f);return f;}
afterEach(()=>vi.unstubAllGlobals());
describe('authorized ad video previews',()=>{
 it('verifies account, ad, campaign and video before returning a signed Meta frame',async()=>{const f=stub();expect(await read(['9'])).toBe(preview);expect(f).toHaveBeenCalledTimes(2);expect(f.mock.calls.every(([u])=>!u.href.includes('private-token'))).toBe(true);});
 it.each([{...ad,account_id:'99'},{...ad,id:'7'},{...ad,campaign_id:'8'},{...ad,creative:{} }])('refuses unlinked or non-video identities without fetching their preview',async(row)=>{const f=stub(row);await expect(read(['9'])).rejects.toMatchObject({code:'permission'});expect(f).toHaveBeenCalledTimes(1);});
 it('rejects invalid saved restrictions before any network read',async()=>{const f=stub();await expect(read(['bad'])).rejects.toMatchObject({code:'invalid_filter'});expect(f).not.toHaveBeenCalled();});
 it('refuses arbitrary iframe HTML and token-bearing URLs',async()=>{stub(ad,'<iframe src="https://evil.example/video"></iframe>');await expect(read()).rejects.toMatchObject({code:'invalid_payload'});for(const url of ['http://business.facebook.com/ads/api/preview_iframe.php?d=x','https://business.facebook.com.evil.org/ads/api/preview_iframe.php?d=x','https://business.facebook.com/ads/api/preview_iframe.php?d=x&access_token=secret','https://business.facebook.com/login?d=x'])expect(safeAdVideoPreview(url)).toBeNull();});
 it('turns provider refusal into an unavailable preview, never fabricated media',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({error:{code:10}})})));await expect(read()).rejects.toMatchObject({code:'request_failed'});});
});
