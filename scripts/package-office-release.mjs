#!/usr/bin/env node
/** Local transport only: no extraction, transfer, SSH, env loading or service startup. */
import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export const OFFICE_RELEASE_PINS = Object.freeze({
 runtimeManifestSha256:"29010f611599f69485c1a326038c7750e6180bcfef6d26aee1d7f66e277db650",
 gatewayManifestSha256:"fa1983ee7e2333405ceebdb6c84214fe96c97d3729821e1e8312c52f7abdb22d",
 dockerfileSha256:"aafebdc405d1505de4b94684058c21e4abd10960b9cdd9dc404b98e30163161d",
 runtimeFiles:8494,gatewayFiles:18,
});
const GATEWAY_PATHS=Object.freeze(["lib/auth/roles.js","lib/office/gateway/contracts.js","lib/office/gateway/protocol.js","lib/office/gateway/store-callback.js","lib/office/gateway/node-server.js","lib/office/runtime/assets.js","lib/office/runtime/avatar-composition.js","lib/office/runtime/service.cjs","lib/office/runtime/map.cjs","lib/office/runtime/client-state.cjs","lib/office/runtime/vendor/interface-api.cjs","lib/office/runtime/vendor/spotify-links.js","lib/office/runtime/vendor/avatar-portrait.cjs","lib/office/runtime/vendor/profile-details-core.js","lib/office/runtime/vendor/spatial-presence-core.cjs","lib/office/runtime/vendor/spatial-room-core.js","lib/office/runtime/seeds/approved-map.json","start.mjs"]);
const PACKAGE=Buffer.from(JSON.stringify({private:true,type:"commonjs",engines:{node:">=20"}},null,2)+"\n");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
function fail(message){throw Error("Office release: "+message);}
function safeName(value){
 if(typeof value!=="string"||!value||value.length>255||!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value)||value.split("/").some(part=>part.startsWith(".")||part.endsWith(".")||/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)))fail("unsafe archive name");
 if(value.length>100&&![...value.matchAll(/\//g)].some(match=>match.index<=155&&value.length-match.index-1<=100))fail("name cannot fit USTAR");
 return value;
}
async function noLinks(absolute){
 const parsed=path.parse(absolute);let current=parsed.root;
 if((await fs.lstat(current)).isSymbolicLink())fail("linked root");
 for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const info=await fs.lstat(current).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
  if(!info)break;if(info.isSymbolicLink())fail("symlink/junction forbidden");
 }
}
async function checkedFile(absolute,expected,maximum=64*1024*1024){
 await noLinks(absolute);const stat=await fs.lstat(absolute);
 if(!stat.isFile()||stat.size>maximum||expected?.bytes!==undefined&&stat.size!==expected.bytes)fail("file size/type drift");
 const bytes=await fs.readFile(absolute),sha256=hash(bytes);
 if(bytes.length!==stat.size||expected?.sha256&&sha256!==expected.sha256)fail("file hash drift");
 return {bytes,sha256};
}
async function checkDestination(destination,roots){
 if(typeof destination!=="string"||!path.isAbsolute(destination)||!destination.endsWith(".tar.gz"))fail("absolute new .tar.gz destination required");
 const target=path.resolve(destination);
 if(target===path.parse(target).root||target.split(/[\\/]/).some(part=>/^(?:public|public_html|\.git|\.env(?:\..*)?|\.aureon-local)$/i.test(part)))fail("unsafe destination");
 for(const root of roots){const rel=path.relative(root,target);if(!(rel===".."||rel.startsWith(".."+path.sep)||path.isAbsolute(rel)))fail("destination overlaps input");}
 await noLinks(target);if(!(await fs.stat(path.dirname(target))).isDirectory())fail("destination parent missing");
 for(const file of [target,target+".entries.json",target+".report.json"]){if(await fs.lstat(file).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;}))fail("destination exists; never overwrite");}
 return target;
}
export async function planOfficeRelease({runtimeDirectory,gatewayDirectory,dockerfile,destination,pins=OFFICE_RELEASE_PINS,gatewayPaths=GATEWAY_PATHS}={}){
 if(![runtimeDirectory,gatewayDirectory,dockerfile].every(value=>typeof value==="string"&&path.isAbsolute(value))||!object(pins)||![pins.runtimeManifestSha256,pins.gatewayManifestSha256,pins.dockerfileSha256].every(value=>/^[0-9a-f]{64}$/.test(value))||!Number.isSafeInteger(pins.runtimeFiles)||pins.runtimeFiles<1||!Number.isSafeInteger(pins.gatewayFiles)||pins.gatewayFiles<1)fail("invalid pinned inputs");
 const runtimeRoot=path.resolve(runtimeDirectory),gatewayRoot=path.resolve(gatewayDirectory);
 for(const root of [runtimeRoot,gatewayRoot]){await noLinks(root);if(!(await fs.stat(root)).isDirectory())fail("input root missing");}
 const output=await checkDestination(destination,[runtimeRoot,gatewayRoot]);
 const runtimeRaw=await checkedFile(path.join(runtimeRoot,"manifest.json"),{sha256:pins.runtimeManifestSha256},16*1024*1024);
 const gatewayRaw=await checkedFile(path.join(gatewayRoot,"gateway-build.json"),{sha256:pins.gatewayManifestSha256},1024*1024);
 const decode=bytes=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 const runtime=decode(runtimeRaw.bytes),gateway=decode(gatewayRaw.bytes);
 if(runtime.version!==1||runtime.mode!=="written"||runtime.crmBootstrapVersion!==1||runtime.crmSessionRequired!==true||!Array.isArray(runtime.files)||runtime.files.length!==pins.runtimeFiles||runtime.fileCount!==pins.runtimeFiles||gateway.version!==1||gateway.mode!=="written"||gateway.target!=="node20"||gateway.format!=="commonjs"||gateway.nodeModulesRequiredAtRuntime!==false||!Array.isArray(gateway.files)||gateway.files.length!==pins.gatewayFiles)fail("manifest stage/count drift");
 if(gatewayPaths.length!==pins.gatewayFiles||JSON.stringify(gateway.files.map(file=>file.path).sort())!==JSON.stringify([...gatewayPaths].sort()))fail("gateway allowlist drift");
 const entries=[],names=new Set(),folded=new Set();
 function add(name,source,record){
  safeName(name);if(names.has(name)||folded.has(name.toLowerCase())||!Number.isSafeInteger(record.bytes)||record.bytes<0||record.bytes>64*1024*1024||!/^[0-9a-f]{64}$/.test(record.sha256))fail("invalid or duplicate entry");
  names.add(name);folded.add(name.toLowerCase());entries.push({name,source,bytes:record.bytes,sha256:record.sha256,mode:0o644});
 }
 for(const [prefix,directory,records]of [["runtime",runtimeRoot,runtime.files],["gateway-build",gatewayRoot,gateway.files]])for(const record of records){if(!object(record))fail("invalid file record");const name=safeName(record.path);add(prefix+"/"+name,path.join(directory,...name.split("/")),record);}
 add("runtime/manifest.json",path.join(runtimeRoot,"manifest.json"),{bytes:runtimeRaw.bytes.length,sha256:runtimeRaw.sha256});
 add("gateway-build/gateway-build.json",path.join(gatewayRoot,"gateway-build.json"),{bytes:gatewayRaw.bytes.length,sha256:gatewayRaw.sha256});
 add("gateway-build/package.json",path.join(gatewayRoot,"package.json"),{bytes:PACKAGE.length,sha256:hash(PACKAGE)});
 const docker=await checkedFile(path.resolve(dockerfile),{sha256:pins.dockerfileSha256},1024*1024);
 add("Dockerfile",path.resolve(dockerfile),{bytes:docker.bytes.length,sha256:docker.sha256});
 let cursor=0;await Promise.all(Array.from({length:8},async()=>{while(cursor<entries.length){const entry=entries[cursor++];await checkedFile(entry.source,entry);}}));
 const directories=new Set();for(const entry of entries){const parts=entry.name.split("/");for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join("/")+"/");}
 for(const directory of directories){safeName(directory.slice(0,-1));if(names.has(directory.slice(0,-1)))fail("file/directory collision");}
 entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 return {destination:output,runtimeRoot,gatewayRoot,pins,entries,directories:[...directories].sort(),inputBytes:entries.reduce((total,entry)=>total+entry.bytes,0),reviewedProductionPins:JSON.stringify(pins)===JSON.stringify(OFFICE_RELEASE_PINS)&&JSON.stringify(gatewayPaths)===JSON.stringify(GATEWAY_PATHS)};
}
const PYTHON_ARCHIVER="import sys, json, os, stat, tarfile, gzip, hashlib, platform, zlib\nplan = json.load(sys.stdin)\ndef no_links(value):\n    current = os.path.abspath(value)\n    while True:\n        s = os.lstat(current)\n        if stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400: raise ValueError('linked input')\n        parent = os.path.dirname(current)\n        if parent == current: break\n        current = parent\n# Windows 3.12 fstat exposes ctime as mtime; birthtime is stable across path/handle.\ndef stamp(s):\n    identity_time = s.st_birthtime_ns if os.name == 'nt' else s.st_ctime_ns\n    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, identity_time)\nclass CheckedReader:\n    def __init__(self, stream): self.stream, self.digest, self.size = stream, hashlib.sha256(), 0\n    def read(self, size=-1):\n        chunk = self.stream.read(size)\n        self.digest.update(chunk); self.size += len(chunk)\n        return chunk\nno_links(os.path.dirname(plan['destination']))\nfd = os.open(plan['destination'], os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0), 0o644)\nfiles = {entry['name']:entry for entry in plan['entries']}\nwith os.fdopen(fd, 'wb') as target:\n    with gzip.GzipFile(filename='', mode='wb', compresslevel=6, fileobj=target, mtime=0) as compressed:\n        with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as archive:\n            for name in sorted(list(files) + plan['directories']):\n                info = tarfile.TarInfo(name)\n                info.uid = info.gid = info.mtime = 0\n                info.uname = info.gname = 'root'; info.pax_headers = {}\n                if name.endswith('/'):\n                    info.type = tarfile.DIRTYPE; info.mode = 0o755; info.size = 0\n                    archive.addfile(info); continue\n                entry = files[name]; no_links(entry['source']); before = os.lstat(entry['source'])\n                if not stat.S_ISREG(before.st_mode) or before.st_size != entry['bytes']: raise ValueError('input size drift')\n                source_fd = os.open(entry['source'], os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0))\n                with os.fdopen(source_fd, 'rb') as source:\n                    if stamp(os.fstat(source.fileno())) != stamp(before): raise ValueError('input identity drift')\n                    reader = CheckedReader(source)\n                    info.type = tarfile.REGTYPE; info.mode = 0o644; info.size = entry['bytes']\n                    archive.addfile(info, reader)\n                    if reader.size != entry['bytes'] or reader.digest.hexdigest() != entry['sha256'] or source.read(1): raise ValueError('input hash drift')\n                    if stamp(os.fstat(source.fileno())) != stamp(before): raise ValueError('input changed during archive')\n                no_links(entry['source'])\n                if stamp(os.lstat(entry['source'])) != stamp(before): raise ValueError('input path changed during archive')\n# Re-read the completed archive in memory streams only; never extract to disk.\nseen_files, seen_directories = set(), set()\nexpected_directories = {name.rstrip('/') for name in plan['directories']}\nwith tarfile.open(plan['destination'], 'r|gz') as verified:\n    for member in verified:\n        if member.uid != 0 or member.gid != 0 or member.mtime != 0: raise ValueError('archive metadata drift')\n        if member.isdir():\n            name = member.name.rstrip('/')\n            if name not in expected_directories or name in seen_directories or member.mode != 0o755 or member.size != 0: raise ValueError('archive directory drift')\n            seen_directories.add(name); continue\n        if not member.isfile() or member.name not in files or member.name in seen_files or member.mode != 0o644: raise ValueError('archive file drift')\n        expected = files[member.name]\n        if member.size != expected['bytes']: raise ValueError('archive file size drift')\n        stream = verified.extractfile(member)\n        if stream is None: raise ValueError('archive stream unavailable')\n        digest, size = hashlib.sha256(), 0\n        with stream:\n            while True:\n                chunk = stream.read(1024 * 1024)\n                if not chunk: break\n                digest.update(chunk); size += len(chunk)\n        if size != expected['bytes'] or digest.hexdigest() != expected['sha256']: raise ValueError('archive file hash drift')\n        seen_files.add(member.name)\nif seen_files != set(files) or seen_directories != expected_directories: raise ValueError('archive inventory drift')\nprint(json.dumps({'python':platform.python_version(), 'zlib':zlib.ZLIB_VERSION, 'format':'ustar', 'gzipLevel':6, 'gzipMtime':0, 'fileCount':len(files), 'directoryCount':len(plan['directories']), 'archiveRoundTripHashesExact':True}))\n";
async function archiveWithPython(pythonExecutable,plan){
 if(typeof pythonExecutable!=="string"||!path.isAbsolute(pythonExecutable)||!(await fs.stat(pythonExecutable)).isFile())fail("explicit Python executable required");
 return new Promise((resolve,reject)=>{
  const child=spawn(pythonExecutable,["-I","-S","-c",PYTHON_ARCHIVER],{shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"]});let stdout="",stderr="",stderrBytes=0;
  child.stdout.on("data",chunk=>{stdout+=chunk.toString("utf8");if(stdout.length>65536)child.kill();});
  child.stderr.on("data",chunk=>{stderrBytes+=chunk.length;if(stderrBytes<=65536)stderr+=chunk.toString("utf8");else child.kill();});
  child.once("error",()=>reject(Error("Office release: Python archive process unavailable")));
  child.once("close",code=>{if(code!==0){reject(Error("Office release: archive verification failed; partial output must not be delivered",{cause:stderr}));return;}try{resolve(JSON.parse(stdout));}catch{reject(Error("Office release: invalid archiver result"));}});
  child.stdin.on("error",()=>{});child.stdin.end(JSON.stringify(plan));
 });
}
export async function packageOfficeRelease(options={}){
 const plan=await planOfficeRelease(options);
 if(options.write!==true)return {...plan,mode:"dry-run",entries:plan.entries.map(({name,bytes,sha256,mode})=>({name,bytes,sha256,mode}))};
 const archive=await archiveWithPython(options.pythonExecutable,plan);
 let cursor=0;await Promise.all(Array.from({length:8},async()=>{while(cursor<plan.entries.length){const entry=plan.entries[cursor++];await checkedFile(entry.source,entry);}}));
 await noLinks(plan.destination);if(!(await fs.lstat(plan.destination)).isFile())fail("archive type drift");
 const digest=createHash("sha256");let archiveBytes=0;for await(const chunk of createReadStream(plan.destination)){digest.update(chunk);archiveBytes+=chunk.length;}
 const inventory=plan.entries.map(({name,bytes,sha256,mode})=>({name,bytes,sha256,mode}));
 const report={version:1,mode:"written",classification:"C-local-transport-only",archive:plan.destination,archiveSha256:digest.digest("hex"),archiveBytes,inputBytes:plan.inputBytes,fileCount:inventory.length,directoryCount:plan.directories.length,entryCount:inventory.length+plan.directories.length,pins:plan.pins,reviewedProductionPins:plan.reviewedProductionPins,sourceHashesBeforeAndAfterExact:true,archiveInputHashesVerifiedWhileStreaming:true,archiveRoundTripHashesExact:archive.archiveRoundTripHashesExact===true,fileMode:"0644",directoryMode:"0755",uid:0,gid:0,mtime:0,node1000CanReadInsideArchive:true,rootEntries:["Dockerfile","gateway-build/","runtime/"],archiver:archive,extractionPerformed:false,transferPerformed:false,serviceStarted:false,productionReadiness:false};
 await fs.writeFile(plan.destination+".entries.json",JSON.stringify({files:inventory,directories:plan.directories},null,2)+"\n",{flag:"wx"});
 await fs.writeFile(plan.destination+".report.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});return report;
}
export async function runOfficeReleaseCli(args){
 const options={};let mode;const flags={"--runtime":"runtimeDirectory","--gateway":"gatewayDirectory","--dockerfile":"dockerfile","--dest":"destination","--python":"pythonExecutable"};
 for(let i=0;i<args.length;i++){const arg=args[i];if((arg==="--write"||arg==="--dry-run")&&mode===undefined){mode=arg;options.write=arg==="--write";}else if(Object.hasOwn(flags,arg)&&options[flags[arg]]===undefined&&args[i+1]&&!args[i+1].startsWith("--"))options[flags[arg]]=args[++i];else fail("invalid CLI arguments");}return packageOfficeRelease(options);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runOfficeReleaseCli(process.argv.slice(2)).then(result=>console.log(JSON.stringify({...result,entries:Array.isArray(result.entries)?result.entries.length:undefined},null,2))).catch(()=>{console.error("Office release packaging failed. Preserve and review any incomplete output; nothing was transferred.");process.exitCode=1;});
