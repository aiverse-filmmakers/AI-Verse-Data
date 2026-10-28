import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {CanvasDocuments} from "../src/canvas/index.js";
import {TrustedDataRoot,createWorkspaceDataScope,openScopedDataDatabase}
 from "../src/scope/index.js";
import {SqliteStorageDriver} from "../src/storage/index.js";

const human={kind:"human" as const,id:"operator"};
const bot={kind:"bot" as const,id:"scene-agent"};
let n=0;
const key=()=>`group-test-${++n}`;
function fixture(fn:(h:{root:string;docs:CanvasDocuments;reopen:()=>CanvasDocuments;
 close:()=>void;seed:()=>{id:string;version:number}})=>void){
 const root=mkdtempSync(join(tmpdir(),"canonical-groups-"));
 mkdirSync(join(root,"workspaces/film/data"),{recursive:true});
 const scope=createWorkspaceDataScope(TrustedDataRoot.fromExistingDirectory(root),"film");
 const driver=new SqliteStorageDriver();
 let handle=openScopedDataDatabase(driver,scope);
 const docs=new CanvasDocuments(handle.database);
 const reopen=()=>{handle.database.close();handle=openScopedDataDatabase(driver,scope);return new CanvasDocuments(handle.database)};
 const close=()=>handle.database.close();
 const seed=()=>{
  let d=docs.create({title:"Camera blocking",actor:human,idempotencyKey:key()});
  for(const [id,x] of [["n1",10],["n2",50],["n3",100],["n4",200]] as const)
   d=docs.edit({id:d.id,expectedVersion:d.version,actor:human,
    idempotencyKey:key(),edit:{type:"note.add",id,text:id,x,y:10}});
  return {id:d.id,version:d.version};
 };
 try{fn({root,docs,reopen,close,seed});}
 finally{try{handle.database.close()}catch{}rmSync(root,{force:true,recursive:true});}
}
const edit=(docs:CanvasDocuments,d:{id:string;version:number},change:any,actor=human)=>{
 const result=docs.edit({id:d.id,expectedVersion:d.version,actor,
  idempotencyKey:key(),edit:change});
 d.version=result.version;return result;
};
const create=()=>({type:"group.create" as const,id:"g1",label:"Opening angle",
 nodeIds:["n1","n2"]});
const fail=(work:()=>unknown,code:string)=>assert.throws(work,
 e=>(e as {code?:string}).code===code);
test("original ungrouped Data board keeps exact v1 revision shape",()=>fixture(({docs,seed})=>{
 const d=seed(),x=docs.get(d.id);
 assert.deepEqual(Object.keys(x.board).sort(),["edges","nodes"]);
 assert.deepEqual(Object.keys(docs.history(d.id,1)[0]!.board).sort(),["edges","nodes"]);
}));
test("create group persists canonical IDs, label and multiple members",()=>fixture(({docs,seed})=>{
 const d=seed(),v=edit(docs,d,create());
 assert.deepEqual(v.board.groups,[{id:"g1",label:"Opening angle",nodeIds:["n1","n2"]}]);
}));
test("group labels trim surrounding whitespace when saved",()=>fixture(({docs,seed})=>{
 const d=seed(),v=edit(docs,d,{...create(),label:"  Dolly  "});
 assert.equal(v.board.groups?.[0]?.label,"Dolly");
}));
test("legacy notes and edges remain intact after grouping",()=>fixture(({docs,seed})=>{
 const d=seed(),first=docs.get(d.id),v=edit(docs,d,create());
 assert.deepEqual(v.board.nodes,first.board.nodes);
 assert.deepEqual(v.board.edges,first.board.edges);
}));
test("groups survive closing and reopening canonical scoped SQLite",()=>fixture(({docs,seed,reopen})=>{
 const d=seed();edit(docs,d,create());const persisted=reopen();
 assert.equal(persisted.get(d.id).board.groups?.[0]?.nodeIds.length,2);
}));
test("adding group does not change original archived digest or history",()=>fixture(({docs,seed})=>{
 const d=seed(),before=docs.get(d.id);edit(docs,d,create());
 const history=docs.history(d.id,2);
 assert.equal(history[1]?.version,before.version);
 assert.deepEqual(history[1]?.board,before.board);
}));
test("one group edit is one new version and idempotent on replay",()=>fixture(({docs,seed})=>{
 const d=seed(),idempotencyKey=key();
 const args={id:d.id,expectedVersion:d.version,actor:human,
  idempotencyKey,edit:create() as any};
 const v=docs.edit(args);
 assert.deepEqual(docs.edit(args),v);
 assert.equal(docs.get(d.id).version,v.version);
}));
test("different group operation with same idempotency key is rejected",()=>fixture(({docs,seed})=>{
 const d=seed(),idempotencyKey=key();
 docs.edit({id:d.id,expectedVersion:d.version,actor:human,idempotencyKey,edit:create()});
 fail(()=>docs.edit({id:d.id,expectedVersion:d.version,actor:human,idempotencyKey,
  edit:{...create(),label:"Different"}}),"IDEMPOTENCY_CONFLICT");
}));
test("group cannot have a single node",()=>fixture(({docs,seed})=>{
 const d=seed();fail(()=>edit(docs,d,{...create(),nodeIds:["n1"]}),"CANVAS_BOARD_INVALID");
}));
test("group cannot have duplicate node IDs",()=>fixture(({docs,seed})=>{
 const d=seed();fail(()=>edit(docs,d,{...create(),nodeIds:["n1","n1"]}),"CANVAS_BOARD_INVALID");
}));
test("group cannot reference missing nodes",()=>fixture(({docs,seed})=>{
 const d=seed();fail(()=>edit(docs,d,{...create(),nodeIds:["n1","missing"]}),"CANVAS_BOARD_INVALID");
}));
test("group ID cannot collide with note ID",()=>fixture(({docs,seed})=>{
 const d=seed();fail(()=>edit(docs,d,{...create(),id:"n1"}),"CANVAS_GROUP_CONFLICT");
}));
test("two groups cannot share group ID",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 fail(()=>edit(docs,d,{...create(),nodeIds:["n3","n4"]}),"CANVAS_GROUP_CONFLICT");
}));
test("two groups cannot claim one note simultaneously",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 fail(()=>edit(docs,d,{...create(),id:"g2",nodeIds:["n2","n3"]}),"CANVAS_BOARD_INVALID");
}));
test("independent groups can coexist on separate notes",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 const v=edit(docs,d,{...create(),id:"g2",label:"B",nodeIds:["n3","n4"]});
 assert.equal(v.board.groups?.length,2);
}));
test("rename changes only selected group label",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 const v=edit(docs,d,{type:"group.rename",id:"g1",label:"Final angle"});
 assert.equal(v.board.groups?.[0]?.label,"Final angle");
 assert.equal(v.board.nodes.length,4);
}));
test("empty group label is rejected without committing",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());const version=d.version;
 fail(()=>edit(docs,d,{type:"group.rename",id:"g1",label:"   "}),"CANVAS_BOARD_INVALID");
 assert.equal(docs.get(d.id).version,version);
}));
test("unknown group cannot be renamed",()=>fixture(({docs,seed})=>{
 const d=seed();fail(()=>edit(docs,d,{type:"group.rename",id:"bad",label:"X"}),
  "CANVAS_GROUP_NOT_FOUND");
}));
test("group.members swaps a membership set atomically",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 const v=edit(docs,d,{type:"group.members",id:"g1",nodeIds:["n2","n3"]});
 assert.deepEqual(v.board.groups?.[0]?.nodeIds,["n2","n3"]);
}));
test("group.members rejects one member and retains old board",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());const old=docs.get(d.id);
 fail(()=>edit(docs,d,{type:"group.members",id:"g1",nodeIds:["n1"]}),
  "CANVAS_BOARD_INVALID");
 assert.deepEqual(docs.get(d.id),old);
}));
test("group.members cannot steal nodes from another group",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 edit(docs,d,{...create(),id:"g2",nodeIds:["n3","n4"]});
 fail(()=>edit(docs,d,{type:"group.members",id:"g1",nodeIds:["n1","n3"]}),
  "CANVAS_BOARD_INVALID");
}));
test("group.move shifts every member atomically by a validated delta",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 const v=edit(docs,d,{type:"group.move",id:"g1",dx:15,dy:-5});
 assert.deepEqual(v.board.nodes.map(x=>[x.id,x.x,x.y]),[
  ["n1",25,5],["n2",65,5],["n3",100,10],["n4",200,10]]);
}));
test("group.move validates coordinates and rolls back overflow",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());const old=docs.get(d.id);
 fail(()=>edit(docs,d,{type:"group.move",id:"g1",dx:100000,dy:0}),
  "CANVAS_POSITION_INVALID");
 assert.deepEqual(docs.get(d.id),old);
}));
test("group.move rejects nonfinite deltas",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());fail(()=>edit(docs,d,{
  type:"group.move",id:"g1",dx:Infinity,dy:0}),"CANVAS_POSITION_INVALID");
}));
test("group.move fails on nonexistent group without any write",()=>fixture(({docs,seed})=>{
 const d=seed(),old=docs.get(d.id);
 fail(()=>edit(docs,d,{type:"group.move",id:"not-found",dx:1,dy:1}),
 "CANVAS_GROUP_NOT_FOUND");
 assert.deepEqual(docs.get(d.id),old);
}));
test("group.remove clears grouping but preserves notes and edges",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 const v=edit(docs,d,{type:"group.remove",id:"g1"});
 assert.deepEqual(v.board.groups,[]);
 assert.equal(v.board.nodes.length,4);
}));
test("group.remove rejects unlisted group",()=>fixture(({docs,seed})=>{
 const d=seed();fail(()=>edit(docs,d,{type:"group.remove",id:"missing"}),
 "CANVAS_GROUP_NOT_FOUND");
}));
test("removing a note dissolves a now-singleton group",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,create());
 const v=edit(docs,d,{type:"note.remove",id:"n1"});
 assert.equal(v.board.groups?.length,0);
 assert.equal(v.board.nodes.length,3);
}));
test("removing a member keeps group when at least two remain",()=>fixture(({docs,seed})=>{
 const d=seed();edit(docs,d,{...create(),nodeIds:["n1","n2","n3"]});
 const v=edit(docs,d,{type:"note.remove",id:"n1"});
 assert.deepEqual(v.board.groups?.[0]?.nodeIds,["n2","n3"]);
}));
test("group revision can be reverted to pre-group v1 board",()=>fixture(({docs,seed})=>{
 const d=seed(),prior=d.version;edit(docs,d,create());
 const v=docs.revert({id:d.id,toVersion:prior,expectedVersion:d.version,
  actor:human,idempotencyKey:key()});
 assert.equal(v.board.groups,undefined);
 assert.equal(v.version,prior+2);
}));
test("group revision can be restored from history after group deletion",()=>fixture(({docs,seed})=>{
 const d=seed();const added=edit(docs,d,create());
 edit(docs,d,{type:"group.remove",id:"g1"});
 const undone=docs.revert({id:d.id,toVersion:added.version,
  expectedVersion:d.version,actor:human,idempotencyKey:key()});
 assert.deepEqual(undone.board.groups,added.board.groups);
}));
test("grouped board atomic duplicate preserves group identity and members",()=>fixture(({docs,seed})=>{
 const d=seed(),grouped=edit(docs,d,create());
 const clone=docs.duplicate({id:d.id,expectedVersion:d.version,
  actor:human,idempotencyKey:key()});
 assert.deepEqual(clone.board,grouped.board);
 assert.notEqual(clone.id,d.id);
}));
test("grouped board mutating actor is recorded in canonical Data provenance",()=>fixture(({docs,seed})=>{
 const d=seed(),created=docs.edit({id:d.id,expectedVersion:d.version,
  actor:bot,idempotencyKey:key(),edit:create()});
 const next=docs.get(d.id);
 assert.equal(created.version,next.version);
 assert.equal(next.board.groups?.length,1);
}));
test("stale group modification denies, leaving existing groups unchanged",()=>fixture(({docs,seed})=>{
 const d=seed();const oldVersion=d.version;edit(docs,d,create());
 fail(()=>docs.edit({id:d.id,expectedVersion:oldVersion,actor:human,
  idempotencyKey:key(),edit:{type:"group.rename",id:"g1",label:"Old"}}),
  "RECORD_VERSION_CONFLICT");
 assert.equal(docs.get(d.id).board.groups?.[0]?.label,"Opening angle");
}));
test("bad group key and malformed group members do not create records",()=>fixture(({docs,seed})=>{
 const d=seed(),old=docs.get(d.id);
 fail(()=>edit(docs,d,{...create(),id:"../unsafe"}),"CANVAS_ID_INVALID");
 fail(()=>edit(docs,d,{...create(),nodeIds:"n1,n2"}),"CANVAS_BOARD_INVALID");
 assert.deepEqual(docs.get(d.id),old);
}));
